import { useState, useEffect, useRef, useMemo } from 'react'
import { supabase } from '../../../../lib/supabase'
import { showToast } from '../../../Toast'
import styles from '../autodraft.module.css'
import PreferenceQuickModal from '../modals/PreferenceQuickModal'
import SpelcheckPopover from '../modals/SpelcheckPopover'
import AwaitingActions from './AwaitingActions'
import AgendaCheckBadge from './AgendaCheckBadge'
import DateReservations from './DateReservations'
import DraftEditor from './DraftEditor'
import ActionProposals from './ActionProposals'
import OutlookChain from './OutlookChain'
import SenderTimeline from './SenderTimeline'
import ActivityLog from './ActivityLog'
import Modal from '../../../ui/Modal'
import DetailErrorBoundary from './DetailErrorBoundary'
import MailDetailHeader from './MailDetailHeader'
import MailDetailToolbar from './MailDetailToolbar'
import ReasoningCollapsible from './ReasoningCollapsible'
import { useMailActions } from '../../../../hooks/useMailActions'

function MailDetail({
  mail, categories, folders, lessons, allMails, mailMessages,
  customerEmails = new Set(), decisions = [], reminderStyle = '',
  markActioned, unmarkActioned, isFlagged,
}) {
  const [fullBody, setFullBody] = useState(null)
  // AutoDraft v2 — proposal-state vanuit ActionProposals.
  //   kind: 'reply'|'forward'|'file'|'defer'|'delegate'|'schedule'|null
  //   hasProposals tri-state:
  //     null  = onbekend (loading) — render NIETS extra (geen DraftEditor flicker)
  //     false = fetch klaar, géén voorstellen → DraftEditor (legacy) renderen
  //     true  = voorstellen aanwezig → DraftEditor alleen bij kind='reply'
  //   variantIndex: bij kind='reply' welke draft-variant te tonen (sync met tab)
  const [proposalState, setProposalState] = useState({ kind: null, hasProposals: null, variantIndex: null })
  useEffect(() => {
    setProposalState({ kind: null, hasProposals: null, variantIndex: null })
  }, [mail.mail_id])

  const mmRow = useMemo(() =>
    (mailMessages || []).find(m => m.id === mail.mail_id) || null,
    [mailMessages, mail.mail_id])

  // Full-body uit mail_messages (truth-of-source) als beschikbaar. Named async
  // helper i.p.v. IIFE — vermijdt ASI-bomb (return\n(async..) werd door JS
  // parser gelezen als return (async..)() → useEffect-cleanup werd een Promise
  // i.p.v. function, wat React's effect-handling brak en tot een silent
  // render-fail leidde.
  useEffect(() => {
    let cancelled = false
    setFullBody(null)
    if (!mmRow) return () => { cancelled = true }
    async function fetchFullBody() {
      try {
        const { data } = await supabase
          .from('mail_messages')
          .select('body_html,body_text,body_truncated')
          .eq('id', mail.mail_id)
          .maybeSingle()
        if (!cancelled && data) setFullBody(data)
      } catch (e) { console.warn('[MailDetail] body fetch failed:', e) }
    }
    fetchFullBody()
    return () => { cancelled = true }
  }, [mail.mail_id, mmRow?.synced_at])

  const effHtml = fullBody?.body_html || mail.body_html
  const effText = fullBody?.body_text || mail.body_text
  const effPreview = mmRow?.body_preview || mail.body_preview
  const effTruncated = fullBody?.body_truncated ?? mmRow?.body_truncated ?? false

  // Recipients-defaults: To = afzender (reply-target), Cc = origineel CC.
  function normalizeRecipients(v) {
    if (!v) return ''
    if (Array.isArray(v)) return v.map(x => typeof x === 'string' ? x : (x?.email || x?.address || '')).filter(Boolean).join(', ')
    if (typeof v === 'string') return v
    if (typeof v === 'object') return v.email || v.address || ''
    return ''
  }

  // Customer-Base detectie: als afzender of recipient in de hubspot Customer
  // Base set zit, default target_folder = Klanten/Customer Succes. Overrulet
  // de category-default zodat klant-mails altijd CS-bound zijn.
  function pickInitialFolder(m) {
    if (m.target_folder) return m.target_folder
    const senderLow = (m.from_email || '').toLowerCase()
    if (senderLow && customerEmails.has(senderLow)) return 'Klanten/Customer Succes'
    const recipients = []
    if (Array.isArray(m.to_recipients)) {
      for (const x of m.to_recipients) {
        if (typeof x === 'string') recipients.push(x.toLowerCase())
        else if (x?.email) recipients.push(String(x.email).toLowerCase())
      }
    }
    if (recipients.some(r => customerEmails.has(r))) return 'Klanten/Customer Succes'
    return ''
  }

  const [draftBody, setDraftBody]       = useState(mail.draft_body || '')
  const [draftSubject, setDraftSubject] = useState(mail.draft_subject || '')
  const [draftTo, setDraftTo]           = useState(mail.from_email || '')
  const [draftCc, setDraftCc]           = useState(normalizeRecipients(mail.cc_recipients))
  const [targetFolder, setTargetFolder] = useState(() => pickInitialFolder(mail))
  const [categoryKey, setCategoryKey]   = useState(mail.category_key || '')
  const [amendText, setAmendText]       = useState('')
  const [mode, setMode]                 = useState(null)
  const [variantIndex, setVariantIndex] = useState(mail.selected_variant_index || 0)
  const [prefModalOpen, setPrefModalOpen] = useState(false)
  const [spelcheckOpen, setSpelcheckOpen] = useState(false)
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [keepOpen, setKeepOpen] = useState(false)
  // V1.52 — composer-blok (toolbar + AI-voorstellen + draft) standaard
  // ingeklapt zodat je eerst rustig de mail leest, daarna klikt op
  // "Reageer / Toon voorstel" om de actie-flow te openen (Outlook-stijl).
  const [composerOpen, setComposerOpen] = useState(false)

  const isSkipSuggested = mail.suggested_action === 'skip'
  const isAwaiting = !!mail.__awaiting
  const isSentDraft = !!mail.__sent_draft
  // V1.45 — een sub-row uit een uitgeklapte thread is altijd read-only;
  // verbergt toolbar + DraftEditor, toont alleen de header + OutlookChain.
  const isThreadMember = !!mail.__thread_member
  const isReadOnly = isAwaiting || isSentDraft || isThreadMember
  const [collapsed, setCollapsed] = useState(isSkipSuggested || isReadOnly)

  useEffect(() => {
    setDraftBody(mail.draft_body || '')
    setDraftSubject(mail.draft_subject || '')
    setDraftTo(mail.from_email || '')
    setDraftCc(normalizeRecipients(mail.cc_recipients))
    setTargetFolder(pickInitialFolder(mail))
    setCategoryKey(mail.category_key || '')
    setAmendText('')
    setMode(null)
    setCollapsed(mail.suggested_action === 'skip' || !!mail.__awaiting || !!mail.__sent_draft || !!mail.__thread_member)
    setComposerOpen(false)
    setVariantIndex(mail.selected_variant_index || 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mail.mail_id, mail.selected_variant_index])

  // AutoDraft v2 — sync variantIndex + subject/body met de actieve reply-tab.
  // Tab-klik op reply.kort vs reply.uitgebreid moet de zichtbare draft-tekst
  // ook echt wisselen, niet alleen de index in state.
  useEffect(() => {
    if (proposalState.kind !== 'reply') return
    if (!Number.isInteger(proposalState.variantIndex)) return
    const idx = proposalState.variantIndex
    const variants = Array.isArray(mail.draft_variants) ? mail.draft_variants : []
    if (idx < 0 || idx >= variants.length) return
    const v = variants[idx]
    if (!v) return
    setVariantIndex(idx)
    if (typeof v.subject === 'string') setDraftSubject(v.subject)
    if (typeof v.body    === 'string') setDraftBody(v.body)
    // Persistent maken (best-effort). supabase.rpc() returnt PostgrestBuilder,
    // niet een native Promise — .catch() direct erop crasht. Gebruik .then(null,fn).
    supabase
      .rpc('set_autodraft_variant', { p_mail_id: mail.mail_id, p_variant_index: idx })
      .then(null, () => { /* silent */ })
  }, [proposalState.kind, proposalState.variantIndex, mail.mail_id, mail.draft_variants])

  // Ref-bridge zodat useMailActions de meest recente draft-state ziet zonder
  // de hele callback te invalideren bij elke toetsaanslag in de textarea.
  const draftStateRef = useRef({})
  draftStateRef.current = { variantIndex, amendText, draftSubject, draftBody, targetFolder }
  const {
    busy, err, submit, markProcessed, dismissAwaiting, submitIgnoreWithRule,
    changeCategory: persistCategory, resetToPending,
  } = useMailActions({ mail, markActioned, unmarkActioned, draftStateRef })

  const cat = categories.find(c => c.category_key === categoryKey)
  // Folder-tree gesorteerd op full_path zodat sub-folders direct onder hun
  // parent komen — visueel identiek aan Outlook. Skip 'Inbox/Projecten/*' (legacy).
  const folderTree = useMemo(() => {
    const allPaths = new Set()
    for (const f of (folders || [])) {
      const p = f.full_path || f.display_name
      if (p) allPaths.add(p)
    }
    for (const c of (categories || [])) {
      if (c.default_target_folder) allPaths.add(c.default_target_folder)
    }
    const PROJECTS_LEGACY = /^Inbox\/Projecten(\/|$)/i
    return Array.from(allPaths)
      .filter(p => !PROJECTS_LEGACY.test(p))
      .sort()
      .map(p => ({ path: p, depth: (p.match(/\//g) || []).length, name: p.split('/').pop() }))
  }, [folders, categories])
  const folderOptions = useMemo(() => folderTree.map(f => f.path), [folderTree])

  const activeLessons = useMemo(() => lessons.filter(l =>
    (l.scope === 'global') ||
    (l.scope === 'category' && l.scope_value === categoryKey) ||
    (l.scope === 'domain' && mail.from_email && mail.from_email.endsWith('@' + l.scope_value)) ||
    (l.scope === 'sender' && l.scope_value === mail.from_email)
  ), [lessons, categoryKey, mail.from_email])

  function changeCategory(newKey) {
    setCategoryKey(newKey)
    persistCategory(newKey)
  }

  // Keyboard shortcuts (skip wanneer focus in input/textarea zit).
  useEffect(() => {
    function onKey(e) {
      const tag = document.activeElement?.tagName
      if (['TEXTAREA','INPUT','SELECT'].includes(tag)) return
      if (e.key.toLowerCase() === 's' && !collapsed && draftBody.trim()) { e.preventDefault(); submit('send') }
      else if (e.key.toLowerCase() === 'i') { e.preventDefault(); submit('ignore') }
      else if (e.key.toLowerCase() === 'a') { e.preventDefault(); setMode(m => m === 'amend' ? null : 'amend') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [collapsed, draftBody, submit])

  // AIPromptBar emit `mcm-open-spelcheck` event vanuit Maestro — bridge naar
  // de bestaande SpelcheckPopover (state blijft hier waar de draftBody zit).
  useEffect(() => {
    function onOpen() {
      if (busy || !draftBody.trim()) return
      setSpelcheckOpen(true)
    }
    window.addEventListener('mcm-open-spelcheck', onOpen)
    return () => window.removeEventListener('mcm-open-spelcheck', onOpen)
  }, [busy, draftBody])

  return (
    <div className="md-root">
      <div className="ad-detail__sticky">
        <MailDetailHeader
          mail={mail}
          isAwaiting={isAwaiting}
          isSentDraft={isSentDraft}
          isReadOnly={isReadOnly}
          isSkipSuggested={isSkipSuggested}
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          onOpenTimeline={() => setTimelineOpen(true)}
          onOpenKeep={() => setKeepOpen(true)}
        />

        {!isReadOnly && composerOpen && (
          <MailDetailToolbar
            mail={mail}
            busy={busy}
            err={err}
            collapsed={collapsed}
            draftBody={draftBody}
            mode={mode}
            setMode={setMode}
            amendText={amendText}
            setAmendText={setAmendText}
            cat={cat}
            categoryKey={categoryKey}
            changeCategory={changeCategory}
            categories={categories}
            targetFolder={targetFolder}
            setTargetFolder={setTargetFolder}
            folderOptions={folderOptions}
            folderTree={folderTree}
            onSend={() => submit('send')}
            onIgnore={() => submit('ignore')}
            onIgnoreWithRule={submitIgnoreWithRule}
            onMarkProcessed={markProcessed}
            onSubmitAmend={() => submit('amend')}
            onReset={resetToPending}
            submit={submit}
            onAddPreference={() => setPrefModalOpen(true)}
          />
        )}

        {isAwaiting && (
          <AwaitingActions
            mail={mail}
            cat={cat}
            busy={busy}
            err={err}
            dismissAwaiting={dismissAwaiting}
            submitIgnoreWithRule={submitIgnoreWithRule}
            reminderStyle={reminderStyle}
          />
        )}
        {isSentDraft && cat && (
          <div className={`ad-detail__actions ${styles.detailSentCatRow}`}>
            <span className={styles.detailSentCatText}>
              <span className={styles.detailCatDot} style={{ background: cat.color || 'var(--text-muted)' }} />
              {cat.label}
            </span>
            {err && <span className={styles.detailErrSpan}>⚠ {err}</span>}
          </div>
        )}

        {prefModalOpen && (
          <PreferenceQuickModal
            mail={mail}
            categories={categories}
            onClose={() => setPrefModalOpen(false)}
          />
        )}
        {spelcheckOpen && (
          <SpelcheckPopover
            draftBody={draftBody}
            onClose={() => setSpelcheckOpen(false)}
            onApply={(newBody) => {
              setDraftBody(newBody)
              setSpelcheckOpen(false)
              showToast({ message: 'Draft bijgewerkt', detail: 'Spelcheck toegepast op huidige variant.' })
            }}
          />
        )}
      </div>

      <AgendaCheckBadge result={mail.agenda_check_result} />
      <DateReservations conversationId={mail.conversation_id} />

      {/* V1.52 — composer-blok (voorgestelde acties + draft-editor) staat
       * standaard ingeklapt. Eerst de mail lezen, dan klik op de knop om de
       * actie-flow te openen. Voor read-only mails (awaiting/sent/thread-
       * member) is er geen composer dus knop ook niet. */}
      {!isReadOnly && !composerOpen && (() => {
        const reasoning = typeof mail.suggested_reasoning === 'string' ? mail.suggested_reasoning : null
        const preview = reasoning && reasoning.length > 140
          ? reasoning.slice(0, 140).trim() + '…'
          : reasoning
        return (
          <button
            type="button"
            className={styles.composerOpenBtn}
            onClick={() => setComposerOpen(true)}
          >
            <span className={styles.composerOpenBtnIcon} aria-hidden>✎</span>
            <span className={styles.composerOpenBtnBody}>
              <span className={styles.composerOpenBtnLabel}>Reageer / toon voorgestelde actie</span>
              {preview && (
                <span className={styles.composerOpenBtnReasoning}>
                  <span className={styles.composerOpenBtnReasoningLabel}>Skill denkt:</span>{' '}
                  {preview}
                </span>
              )}
            </span>
            <span className={styles.composerOpenBtnHint}>uitklappen ▾</span>
          </button>
        )
      })()}

      {!isReadOnly && composerOpen && (
        <>
          {mail.suggested_reasoning && (
            <div className={styles.composerReasoningWrap}>
              <ReasoningCollapsible reasoning={String(mail.suggested_reasoning)} />
            </div>
          )}
          <ActionProposals mail={mail} onSelectedChange={setProposalState} />
          <button
            type="button"
            className={styles.composerCloseBtn}
            onClick={() => setComposerOpen(false)}
            title="Voorgestelde actie weer inklappen"
          >
            ▴ inklappen
          </button>
        </>
      )}

      <div className="mc-thread">
        {composerOpen && !collapsed && (proposalState.kind === 'reply' || proposalState.hasProposals === false) && (
          <DraftEditor
            mail={mail}
            draftTo={draftTo}
            setDraftTo={setDraftTo}
            draftCc={draftCc}
            setDraftCc={setDraftCc}
            draftSubject={draftSubject}
            setDraftSubject={setDraftSubject}
            draftBody={draftBody}
            setDraftBody={setDraftBody}
            busy={busy}
            activeLessons={activeLessons}
            variantIndex={variantIndex}
            setVariantIndex={setVariantIndex}
            hideVariantSwitcher={proposalState.hasProposals === true}
          />
        )}
        <OutlookChain
          currentMail={mail}
          currentBody={{ body_html: effHtml, body_text: effText, body_preview: effPreview, body_truncated: effTruncated }}
          allMails={allMails}
          mailMessages={mailMessages}
        />
      </div>

      <Modal
        open={timelineOpen}
        onClose={() => setTimelineOpen(false)}
        title="Tijdlijn — eerder van deze afzender"
        size="lg"
        className="theme-maestro"
      >
        <SenderTimeline mail={mail} allMails={allMails} mailMessages={mailMessages} />
      </Modal>
      <Modal
        open={keepOpen}
        onClose={() => setKeepOpen(false)}
        title="Houden — wat is er met deze mail gedaan"
        size="md"
        className="theme-maestro"
      >
        <ActivityLog mail={mail} decisions={decisions} categories={categories} />
      </Modal>
    </div>
  )
}

export default MailDetail
export { DetailErrorBoundary }
