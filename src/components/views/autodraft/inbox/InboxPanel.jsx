import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { supabase } from '../../../../lib/supabase'
import RagHealthPanel from '../../../RagHealthPanel'
import styles from '../autodraft.module.css'
import { isFromShareholder } from '../../../../lib/autodraft'
import { buildAwaitingMails, forYouBucketOf } from '../../../../lib/awaitingMails'
import {
  buildPseudoPending, buildSentDrafts, partitionHandled,
  buildMailMessagesById, buildConversationByMyReplyAfter,
  buildThreadMembersByConv,
} from '../../../../lib/inboxLists'
import { useInboxOptimistic } from '../../../../hooks/useInboxOptimistic'
import { useInboxListWidth } from '../../../../hooks/useInboxListWidth'
import { useInboxKeyboard } from '../../../../hooks/useInboxKeyboard'
import { useInboxBuckets } from '../../../../hooks/useInboxBuckets'
import MinimalToolbar from './MinimalToolbar'
import EmptyState from './EmptyState'
import MailDetail, { DetailErrorBoundary } from './MailDetail'
import InboxLog from '../settings/InboxLog'
import InboxList from './InboxList'
import SubFilterBar from './SubFilterBar'

const SUB_FILTER_AUDIENCES = new Set(['for_you', 'awaiting'])

function InboxPanel({
  mails, mailMessages, categories, folders, lessons, decisions = [],
  ignoreRules = [], dismissedConvIds = new Set(), customerEmails = new Set(),
  awaitingReplyIndex = [],
  manualCategoryOverrides = new Map(),
  reminderStyle = '', threadCounts, latestScanRun, onNavigate,
  audience, setAudience, query, setQuery,
  showRagHealth = false,
  loading = false,
}) {
  const [filter, setFilter] = useState('all')
  // Verplaatst-mails (sub-folder in Outlook) zijn default verborgen — die zijn
  // toch al afgehandeld door jou, hoeven niet in postvak te zien.
  const [showHandled, setShowHandled] = useState(false)
  const [scanBusy, setScanBusy] = useState(false)
  const [scanMsg, setScanMsg]   = useState(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkMsg, setBulkMsg]   = useState(null)
  const [subFilter, setSubFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  // V1.45 — uitgeklapte threads in de lijst. Set<conversation_id>. Wordt
  // gevoed door de chevron in MailRow; InboxList rendert daarna de overige
  // thread-leden als sub-rows direct onder de hoofdrij (Outlook-stijl).
  const [expandedThreads, setExpandedThreads] = useState(() => new Set())
  const toggleThread = useCallback((convId) => {
    if (!convId) return
    setExpandedThreads(prev => {
      const next = new Set(prev)
      if (next.has(convId)) next.delete(convId)
      else next.add(convId)
      return next
    })
  }, [])
  const rootRef = useRef(null)

  const optimistic = useInboxOptimistic({ mails, mailMessages })
  const {
    actionedIds, markActioned, unmarkActioned,
    categoryOverrides, changeCategoryOptimistic,
    flagOverrides, handleToggleFlag,
  } = optimistic

  const { listWidth, startDrag } = useInboxListWidth()

  // RAG-summaries voor de RagBadge per mail. Bulk-fetch op v_record_rag_summary
  // wanneer de mails-set verandert. Map gekeyed op autodraft_mail.id (uuid).
  const [ragSummaryById, setRagSummaryById] = useState(() => new Map())
  useEffect(() => {
    if (!mails || mails.length === 0) { setRagSummaryById(new Map()); return }
    const ids = mails.map(m => m.id).filter(Boolean)
    if (ids.length === 0) return
    let cancel = false
    supabase
      .from('v_record_rag_summary')
      .select('*')
      .eq('record_type', 'autodraft_mail')
      .in('record_id', ids)
      .then(({ data: rows, error }) => {
        if (cancel || error) return
        const m = new Map()
        for (const r of rows || []) m.set(r.record_id, r)
        setRagSummaryById(m)
      })
    return () => { cancel = true }
  }, [mails])

  const mailMessagesById = useMemo(() => buildMailMessagesById(mailMessages), [mailMessages])
  const conversationByMyReplyAfter = useMemo(() =>
    buildConversationByMyReplyAfter(mailMessages), [mailMessages])

  // Pending = skill-pending + pseudo-pending (mails die mail-sync wel kent maar
  // auto-draft nog niet zag — krijgen __no_draft_yet=true zodat MailRow ze als
  // plain inbox-mail toont). Optimistische categorie-overrides toegepast zodat
  // chip-wissels meteen reflecteren.
  const pending = useMemo(() => {
    const skill = mails.filter(m => m.status === 'pending' || m.status === 'amended')
    const pseudo = buildPseudoPending(mailMessages, mails)
    const merged = [...skill, ...pseudo]
    const withOverride = categoryOverrides.size === 0
      ? merged
      : merged.map(m => categoryOverrides.has(m.mail_id)
          ? { ...m, category_key: categoryOverrides.get(m.mail_id) }
          : m)
    return withOverride.sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
  }, [mails, mailMessages, categoryOverrides])

  // Subject-keyword ignore-rules ook op awaiting toepassen (Teams-uitnodigingen
  // komen door calendar-invite detectie heen).
  const subjectIgnoreNeedles = useMemo(() => {
    return (ignoreRules || [])
      .filter(r => r.active !== false && r.pattern_type === 'subject_keyword' && r.pattern_value)
      .map(r => String(r.pattern_value).toLowerCase().trim())
      .filter(Boolean)
  }, [ignoreRules])
  const subjectMatchesIgnore = useCallback((subject) => {
    if (!subject || subjectIgnoreNeedles.length === 0) return false
    const s = String(subject).toLowerCase()
    return subjectIgnoreNeedles.some(needle => s.includes(needle))
  }, [subjectIgnoreNeedles])

  const awaitingMails = useMemo(() =>
    buildAwaitingMails(mailMessages, {
      dismissedConvIds,
      customerEmails,
      subjectMatchesIgnore,
      awaitingReplyRows: awaitingReplyIndex,
      allAutodraftMails: mails,
      categoryOverrides,
      manualCategoryOverrides,
    }),
    [mailMessages, mails, dismissedConvIds, customerEmails, subjectMatchesIgnore,
     awaitingReplyIndex, categoryOverrides, manualCategoryOverrides])

  // Pinned = Outlook is_pinned OF flag_status='flagged' (legacy 'Flag for
  // follow-up') OF lokale flag-override. Telt mee voor Pinned-sectie bovenaan.
  const flaggedMailIds = useMemo(() => {
    const s = new Set()
    for (const m of (mailMessages || [])) {
      if (m.is_pinned === true || m.flag_status === 'flagged') s.add(m.id)
    }
    for (const [id, entry] of flagOverrides.entries()) {
      if (entry?.val) s.add(id); else s.delete(id)
    }
    return s
  }, [mailMessages, flagOverrides])

  const sentDraftsList = useMemo(() =>
    buildSentDrafts(decisions, mails, mailMessages),
    [decisions, mails, mailMessages])

  const { active, handled } = useMemo(() =>
    partitionHandled(pending, mailMessagesById, conversationByMyReplyAfter),
    [pending, mailMessagesById, conversationByMyReplyAfter])

  // Sub-filter Aandeelhouder/Klant/Intern/Overig binnen 'Voor jou'.
  useEffect(() => { setSubFilter('all') }, [audience])
  const bucketOf = useCallback((m) => forYouBucketOf(m, isFromShareholder), [])

  // Audience-specifieke pools.
  let rawPool = audience === 'awaiting'          ? awaitingMails
              : audience === 'awaiting_klant'    ? awaitingMails.filter(m => m.pending_bucket === 'klant')
              : audience === 'awaiting_algemeen' ? awaitingMails.filter(m => m.pending_bucket !== 'klant')
              : audience === 'sent_drafts'       ? sentDraftsList
              : (showHandled ? pending : active)
  if (audience === 'awaiting' && subFilter !== 'all') {
    rawPool = rawPool.filter(m => m.pending_bucket === subFilter)
  } else if (SUB_FILTER_AUDIENCES.has(audience) && subFilter !== 'all') {
    rawPool = rawPool.filter(m => bucketOf(m) === subFilter)
  }
  const visiblePool = useMemo(() =>
    actionedIds.size === 0 ? rawPool : rawPool.filter(m => !actionedIds.has(m.mail_id)),
    [rawPool, actionedIds])
  const handledIds = useMemo(() => new Set(handled.map(m => m.mail_id)), [handled])

  // Tellers per sub-bucket voor de pillen — awaiting telt op pending_bucket,
  // for_you op forYouBucketOf (aandeelhouder/klant/intern/overig).
  const subCounts = useMemo(() => {
    if (!SUB_FILTER_AUDIENCES.has(audience)) return null
    if (audience === 'awaiting') {
      const out = { all: 0, klant: 0, algemeen: 0 }
      for (const m of awaitingMails) {
        out.all++
        const b = m.pending_bucket === 'klant' ? 'klant' : 'algemeen'
        out[b]++
      }
      return out
    }
    const basePool = (showHandled ? pending : active).filter(m => m.audience === 'for_you')
    const out = { all: 0, aandeelhouder: 0, intern: 0, klant: 0, overig: 0 }
    for (const m of basePool) {
      out.all++
      const b = bucketOf(m)
      out[b] = (out[b] || 0) + 1
    }
    return out
  }, [audience, awaitingMails, pending, active, showHandled, bucketOf])

  const { buckets, flat, visibleFlat, visibleCount, hasMore, loadMore, pageSize } =
    useInboxBuckets({
      pool: visiblePool, filter, audience, query, flaggedMailIds,
      resetKey: `${audience}|${filter}|${query}|${showHandled}`,
    })

  // V1.45 — Map<conv_id, threadMember[]> voor uitgeklapte threads. Sub-rows
  // worden onder de hoofdrij gerenderd. Membership uit mailMessages (live);
  // mails die al als hoofdrij in flat staan worden niet als sub-row herhaald.
  const threadMembersByConv = useMemo(() => {
    const mainIds = new Set(flat.map(m => m.mail_id))
    return buildThreadMembersByConv(expandedThreads, mailMessages, mainIds)
  }, [expandedThreads, mailMessages, flat])

  useEffect(() => {
    if (!selectedId && flat.length > 0) setSelectedId(flat[0].mail_id)
    else if (selectedId && !flat.find(m => m.mail_id === selectedId)) {
      // Voor selectie kan een sub-row (thread-member) ook gelden — laat de
      // selectie staan als hij in een uitgeklapte thread voorkomt.
      let inMembers = false
      for (const members of threadMembersByConv.values()) {
        if (members.some(m => m.mail_id === selectedId)) { inMembers = true; break }
      }
      if (!inMembers) setSelectedId(flat[0]?.mail_id || null)
    }
  }, [flat, selectedId, threadMembersByConv])
  const selected = useMemo(() => {
    const inFlat = flat.find(m => m.mail_id === selectedId)
    if (inFlat) return inFlat
    for (const members of threadMembersByConv.values()) {
      const found = members.find(m => m.mail_id === selectedId)
      if (found) return found
    }
    return null
  }, [flat, threadMembersByConv, selectedId])
  useInboxKeyboard({ flat, selected, setSelectedId })

  // Demo-data detectie — als >50% mails begint met 'demo-' tonen we banner.
  const isDemo = mails.length > 0 && mails.filter(m => String(m.mail_id).startsWith('demo-')).length / mails.length > 0.5

  // F.2.e — Sync-knop forceert mail-sync + auto-draft samen via één RPC.
  // Lost op dat verplaatste mails pas na 30-60 min uit 'Voor jou' verdwenen.
  async function onScan() {
    if (scanBusy) return
    setScanBusy(true); setScanMsg(null)
    try {
      const { data, error } = await supabase.rpc('request_mail_sync_now')
      if (error) setScanMsg({ err: error.message })
      else if (data && data.ok === false) setScanMsg({ err: data.reason })
      else setScanMsg({ ok: 'Mail-sync + scan aangevraagd — refresh over 1-2 min' })
    } catch (e) { setScanMsg({ err: e.message }) }
    setTimeout(() => setScanMsg(null), 8000)
    setScanBusy(false)
  }

  const skipMails = useMemo(() => pending.filter(m => m.suggested_action === 'skip'), [pending])
  async function bulkSkipAll() {
    if (bulkBusy || skipMails.length === 0) return
    if (!confirm(`Alle ${skipMails.length} mails met negeer-voorstel archiveren?`)) return
    setBulkBusy(true); setBulkMsg(null)
    try {
      const ids = skipMails.map(m => m.mail_id)
      const { data, error } = await supabase.rpc('bulk_skip_autodraft_mails', {
        p_mail_ids: ids, p_target_folder: null,
      })
      if (error) setBulkMsg({ err: error.message })
      else if (data && data.ok === false) setBulkMsg({ err: data.reason })
      else setBulkMsg({ ok: `${data.queued} mails in wachtrij` })
    } catch (e) { setBulkMsg({ err: e.message }) }
    setTimeout(() => setBulkMsg(null), 6000)
    setBulkBusy(false)
  }

  const priorityMails = useMemo(() =>
    mails.filter(m => (m.status === 'pending' || m.status === 'amended') && flaggedMailIds.has(m.mail_id)),
    [mails, flaggedMailIds])

  return (
    <section ref={rootRef}>
      {isDemo && (
        <div className="ad-demo-banner">
          🧪 <strong>Demo-data</strong> — deze mails zijn testgegevens (niet uit je Outlook).
          Klik <strong>Scan nu</strong> hierboven om de auto-draft skill echt te laten draaien op je inbox.
        </div>
      )}

      <MinimalToolbar
        pending={pending}
        awaitingCount={awaitingMails.length}
        priorityCount={priorityMails.length}
        sentDraftsCount={sentDraftsList.length}
        audience={audience}
        setAudience={setAudience}
        filter={filter}
        setFilter={setFilter}
        query={query}
        setQuery={setQuery}
        showHandled={showHandled}
        setShowHandled={setShowHandled}
        handledCount={handled.length}
        onScan={onScan}
        scanBusy={scanBusy}
        scanMsg={scanMsg}
        skipCount={skipMails.length}
        bulkSkipAll={bulkSkipAll}
        bulkBusy={bulkBusy}
        bulkMsg={bulkMsg}
        latestScanRun={latestScanRun}
        onNavigate={onNavigate}
      />

      {showRagHealth && <RagHealthPanel recordType="autodraft_mail" weeks={3} compact />}

      <SubFilterBar
        audience={audience}
        subFilter={subFilter}
        setSubFilter={setSubFilter}
        subCounts={subCounts}
      />

      {audience === 'logs' ? (
        <div className={styles.logsWrapper}>
          <InboxLog mails={mails} decisions={decisions} alwaysOpen />
        </div>
      ) : (
        <div className="ad-split" style={{ gridTemplateColumns: `${listWidth}px 6px 1fr`, gap: 0 }}>
          <aside className="ad-list">
            {flat.length === 0 ? (
              loading ? (
                <div className={styles.inboxLoading}>
                  <div className={styles.inboxLoadingSpinner} aria-hidden>⏳</div>
                  <div className={styles.inboxLoadingText}>Mails worden geladen…</div>
                </div>
              ) : (
                <EmptyState
                  hasAnyMails={pending.length > 0}
                  onScan={onScan}
                  scanBusy={scanBusy}
                />
              )
            ) : (
              <InboxList
                buckets={buckets}
                visibleFlat={visibleFlat}
                hasMore={hasMore}
                onLoadMore={loadMore}
                pageSize={pageSize}
                totalCount={flat.length}
                visibleCount={visibleCount}
                categories={categories}
                selectedId={selectedId}
                setSelectedId={setSelectedId}
                threadCounts={threadCounts}
                expandedThreads={expandedThreads}
                onToggleThread={toggleThread}
                threadMembersByConv={threadMembersByConv}
                handledIds={handledIds}
                flaggedIds={flaggedMailIds}
                onToggleFlag={handleToggleFlag}
                ragSummaryById={ragSummaryById}
                onChangeCategory={changeCategoryOptimistic}
              />
            )}
          </aside>
          <div className={`mc-splitter ${styles.splitter}`}
            role="separator" aria-orientation="vertical"
            aria-label="Versleep om kolommen aan te passen"
            onMouseDown={startDrag}
          />
          <div className="ad-detail-pane">
            {selected ? (
              <DetailErrorBoundary key={selected.mail_id}>
                <MailDetail
                  mail={selected}
                  categories={categories}
                  folders={folders}
                  lessons={lessons}
                  allMails={mails}
                  mailMessages={mailMessages}
                  customerEmails={customerEmails}
                  decisions={decisions}
                  reminderStyle={reminderStyle}
                  markActioned={markActioned}
                  unmarkActioned={unmarkActioned}
                  isFlagged={flaggedMailIds.has(selected.mail_id)}
                />
              </DetailErrorBoundary>
            ) : (
              <div className={styles.emptyDetail}>
                {loading ? (
                  <>
                    <div className={styles.inboxLoadingSpinner} aria-hidden>⏳</div>
                    <div className={styles.detailLoadingGap}>Mails worden geladen…</div>
                  </>
                ) : (
                  'Selecteer een mail links om te beginnen.'
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="ad-hotkeys muted">
        ↑/↓ of J/K door lijst · in de detailpane: klik Verstuur/Negeer/Aanpassen
      </div>
    </section>
  )
}

export default InboxPanel
