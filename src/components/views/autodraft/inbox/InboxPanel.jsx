import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '../../../../lib/supabase'
import RagHealthPanel from '../../../RagHealthPanel'
import styles from '../autodraft.module.css'
import {
  INTERNAL_DOMAINS, FILTER_PRESETS, AUDIENCE_PRESETS,
  inferPseudoAudience, isOutOfOffice, isCanceledInvite, isClosingMail,
  isInternalRecipient, inferOutgoingLabel, isFromShareholder,
  isMailAlreadyHandled, groupByAge,
} from '../../../../lib/autodraft'
import MinimalToolbar from './MinimalToolbar'
import MailRow from './MailRow'
import EmptyState from './EmptyState'
import MailDetail, { DetailErrorBoundary } from './MailDetail'
import InboxLog from '../settings/InboxLog'

function InboxPanel({
  mails, mailMessages, categories, folders, lessons, decisions = [],
  ignoreRules = [], dismissedConvIds = new Set(), customerEmails = new Set(),
  reminderStyle = '', threadCounts, latestScanRun, onNavigate,
  // Optional controlled-mode props voor audience — wanneer AutoDraftView ze
  // doorgeeft via TabsSidebar / MaestroTopbar, wordt de interne useState
  // genegeerd ten gunste van parent-state.
  audience: audienceProp,
  setAudience: setAudienceProp,
  // Zelfde controlled-mode patroon voor de zoek-query (vanuit TabsSidebar
  // zoek-input).
  query: queryProp,
  setQuery: setQueryProp,
  // V8.4 (2026-05-13): controlled-mode voor RagHealthPanel zichtbaarheid.
  // Default true voor backwards-compat met /postvak (oude route blijft de
  // banner altijd tonen). Maestro-route zet 'm op false en toggle via
  // MaestroListHeader's 3-dots.
  showRagHealth = true,
  // V12-fix (2026-05-21): loading-flag uit useAutoDraft zodat we 'mails
  // laden…' tonen bij eerste mount in plaats van direct EmptyState.
  loading = false,
}) {
  const [filter, setFilter]     = useState('all')
  // Start op 'Voor jou' zodat persoonlijke mails als eerste in beeld komen.
  const [audienceInternal, setAudienceInternal] = useState('for_you')
  const audience    = audienceProp    !== undefined ? audienceProp    : audienceInternal
  const setAudience = setAudienceProp !== undefined ? setAudienceProp : setAudienceInternal
  const [queryInternal, setQueryInternal] = useState('')
  const query    = queryProp    !== undefined ? queryProp    : queryInternal
  const setQuery = setQueryProp !== undefined ? setQueryProp : setQueryInternal
  // Verplaatst-mails (sub-folder in Outlook) zijn default verborgen — die zijn
  // toch al afgehandeld door jou, hoeven niet in postvak te zien.
  const [showHandled, setShowHandled] = useState(false)
  const [scanBusy, setScanBusy] = useState(false)
  const [scanMsg, setScanMsg]   = useState(null)

  // Optimistic loading — wanneer Jelle op send/ignore/spam klikt, voegen we
  // het mail_id meteen toe aan deze set zodat de mail uit de lijst verdwijnt
  // zonder te wachten op de RPC-roundtrip. Bij failure verwijderen we het ID
  // weer (failure flow zit in MailDetail.submit).
  const [actionedIds, setActionedIds] = useState(() => new Set())
  const markActioned = useCallback((mailId) => {
    setActionedIds(prev => {
      const next = new Set(prev)
      next.add(mailId)
      return next
    })
  }, [])
  const unmarkActioned = useCallback((mailId) => {
    setActionedIds(prev => {
      const next = new Set(prev)
      next.delete(mailId)
      return next
    })
  }, [])
  // Wanneer mails-prop verandert (bv. realtime update na execute), gooi de
  // actionedIds-set leeg voor mails die de DB ook al heeft gemarkeerd.
  useEffect(() => {
    setActionedIds(prev => {
      if (prev.size === 0) return prev
      const next = new Set()
      for (const id of prev) {
        const m = mails.find(x => x.mail_id === id)
        // Behoud alleen IDs waar de DB nog 'pending'/'amended' is — dan klopt
        // onze lokale verberg-state nog. Andere zijn door DB gesynced.
        if (m && (m.status === 'pending' || m.status === 'amended')) next.add(id)
      }
      return next
    })
  }, [mails])

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

  // Splitter — breedte van mail-lijst, persisted in localStorage.
  // Range 280-560 om leesbare lijst + ruim detail-veld te garanderen.
  const [listWidth, setListWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('mc-list-width')
      const n = saved ? Number(saved) : 380
      return Number.isFinite(n) ? Math.max(280, Math.min(560, n)) : 380
    } catch { return 380 }
  })
  useEffect(() => {
    try { localStorage.setItem('mc-list-width', String(listWidth)) } catch {}
    // V8.4 (2026-05-13): publiceer listWidth als CSS-var op document-root
    // zodat Maestro-CSS (MaestroListHeader max-width + ad-detail-pane left)
    // dezelfde waarde kan lezen. Anders zaten ze hardcoded op 420px.
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--mcm-list-width', `${listWidth}px`)
    }
  }, [listWidth])
  const startDrag = useCallback((e) => {
    e.preventDefault()
    const startX = e.clientX
    let startW = 0
    setListWidth(w => { startW = w; return w })
    function onMove(ev) {
      const dx = ev.clientX - startX
      const next = Math.max(280, Math.min(560, startW + dx))
      setListWidth(next)
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  // Index voor al-verwerkt-detectie (mail_messages truth-of-source)
  const mailMessagesById = useMemo(() => {
    const m = new Map()
    for (const x of mailMessages) m.set(x.id, x)
    return m
  }, [mailMessages])

  // Per conversation_id: meest recente received_at van een eigen reply.
  const conversationByMyReplyAfter = useMemo(() => {
    const m = new Map()
    for (const x of mailMessages) {
      if (!x.is_from_me || !x.conversation_id || !x.received_at) continue
      const prev = m.get(x.conversation_id)
      if (!prev || new Date(x.received_at) > new Date(prev)) {
        m.set(x.conversation_id, x.received_at)
      }
    }
    return m
  }, [mailMessages])

  // Pending = nog niets met mee gedaan binnen de skill.
  const skillPending = useMemo(() => mails.filter(m => m.status === 'pending' || m.status === 'amended'), [mails])

  // Pseudo-pending: inbox-mails die mail-sync wel heeft binnengehaald maar
  // auto-draft skill nog niet heeft gezien (skill-bug, backlog). Maakt zichtbaar
  // wat er nieuw binnenkomt zonder te wachten op de skill. Mapt naar
  // autodraft-shape met flag __no_draft_yet=true zodat MailRow + MailDetail
  // hem als plain inbox-mail tonen (geen draft, geen draft-acties).
  const pseudoPending = useMemo(() => {
    if (!mailMessages) return []
    const inAutodraft = new Set(mails.map(m => m.mail_id))
    const out = []
    for (const m of mailMessages) {
      if (m.is_from_me) continue
      if (m.is_deleted) continue
      if (!m.folder_path || m.folder_path !== 'Inbox') continue  // alleen root-Inbox
      if (m.is_calendar_invite) continue                          // skip uitnodigingen
      if (inAutodraft.has(m.id)) continue                         // al door skill gezien
      const inferredAudience = inferPseudoAudience(m.from_email)
      const isNotForYou = inferredAudience === 'not_for_you'
      out.push({
        __no_draft_yet: true,
        mail_id: m.id,
        conversation_id: m.conversation_id,
        received_at: m.received_at,
        from_email: m.from_email,
        from_name: m.from_name,
        to_recipients: m.to_recipients,
        cc_recipients: m.cc_recipients,
        subject: m.subject,
        body_preview: m.body_preview,
        body_html: m.body_html,
        body_text: m.body_text,
        has_attachments: m.has_attachments,
        category_key: isNotForYou ? 'notificatie' : '',
        audience: inferredAudience,
        suggested_action: isNotForYou ? 'skip' : null,
        suggested_reasoning: isNotForYou
          ? 'Pre-classificatie: notification/newsletter/marketing — voorgesteld om te negeren.'
          : 'Skill heeft nog geen draft gemaakt — typ zelf je antwoord of klik snel-acties.',
        confidence: isNotForYou ? 0.7 : 0,
        status: 'pending',
        draft_body: '',
        draft_subject: m.subject ? `RE: ${m.subject}` : '',
        draft_variants: [],
        target_folder: null,
      })
    }
    return out
  }, [mailMessages, mails])

  // Gecombineerde poel: skill-pending + pseudo-pending (gesorteerd op received_at desc)
  const pending = useMemo(() => {
    const merged = [...skillPending, ...pseudoPending]
    return merged.sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
  }, [skillPending, pseudoPending])

  // v3 (2026-05-26): bucket-bepaling voor In Afwachting — 'klant' als de
  // recipient (waar Jelle aan mailde) bekend is via customerEmails, anders
  // 'algemeen'. Deterministisch op recipient, niet op category_key.
  // Komt overeen met DB-RPC autodraft_resolve_pending_bucket maar dan
  // client-side voor awaiting (uitgaande) mails.
  const awaitingBucketOf = useCallback((toRecip) => {
    if (!toRecip || !customerEmails || customerEmails.size === 0) return 'algemeen'
    const arr = Array.isArray(toRecip) ? toRecip : [toRecip]
    for (const x of arr) {
      const e = typeof x === 'string' ? x : (x?.email || x?.address || '')
      if (e && customerEmails.has(e.toLowerCase())) return 'klant'
    }
    return 'algemeen'
  }, [customerEmails])

  // "In afwachting" — eigen verzonden mails waar nog geen reply op kwam.
  // Filters: geen calendar-invites, geen volledig-interne mails (alleen
  // legal-mind.nl recipients), 1-30 dagen oud. Label wordt geïnferd op basis
  // van eerdere autodraft_mails-categorie van diezelfde recipient.
  //
  // F.5.e (2026-05-06) — robuuster: out-of-office antwoorden tellen NIET als
  // echte reply, gecancelde uitnodigingen / eigen-afsluitende mails ("tot
  // vrijdag, dank") blokkeren niet meer ten onrechte de awaiting-status.
  // 2026-05-07 — ignore-rules op subject_keyword óók toepassen op awaitingMails.
  // Reden: Jelle's eigen Teams-uitnodigingen mailen door de calendar-invite
  // detect-trigger heen (die kijkt alleen naar prefixes als "Accepted:" /
  // "Declined:" / "Invitation:"). Een ignore-rule "teams" / "teamsmeeting"
  // zou ze moeten verbergen uit het Postvak — ook in afwachting.
  const subjectIgnoreNeedles = useMemo(() => {
    return (ignoreRules || [])
      .filter(r => r.active !== false && r.pattern_type === 'subject_keyword' && r.pattern_value)
      .map(r => String(r.pattern_value).toLowerCase().trim())
      .filter(Boolean)
  }, [ignoreRules])

  function subjectMatchesIgnore(subject) {
    if (!subject || subjectIgnoreNeedles.length === 0) return false
    const s = String(subject).toLowerCase()
    return subjectIgnoreNeedles.some(needle => s.includes(needle))
  }

  const awaitingMails = useMemo(() => {
    if (!mailMessages || mailMessages.length === 0) return []
    const byConv = new Map()
    for (const m of mailMessages) {
      if (!m.conversation_id) continue
      const slot = byConv.get(m.conversation_id) || { mine: null, reply: null }
      if (m.is_from_me) {
        if (!slot.mine || new Date(m.received_at) > new Date(slot.mine.received_at)) slot.mine = m
      } else {
        // F.5.e — out-of-office antwoorden zijn geen echte reply. Negeer ze
        // bij map-build zodat ze niet de "reply"-slot vullen.
        if (isOutOfOffice(m)) continue
        if (!slot.reply || new Date(m.received_at) > new Date(slot.reply.received_at)) slot.reply = m
      }
      byConv.set(m.conversation_id, slot)
    }
    const now = Date.now()
    const out = []
    for (const { mine, reply } of byConv.values()) {
      if (!mine) continue
      if (mine.is_calendar_invite) continue                 // skip Outlook-uitnodigingen
      if (subjectMatchesIgnore(mine.subject)) continue      // skip wat ignore-rules afvangen (teams, teamsmeeting, …)
      // F.5.e — Jelle stuurde een cancellation/annulering: niemand antwoordt daarop
      if (isCanceledInvite(mine)) continue
      // F.5.e — Jelle's laatste mail in de thread sluit het gesprek af
      // ("Top, tot vrijdag", "Dank, prima") — geen antwoord verwacht
      if (isClosingMail(mine)) continue
      if (isInternalRecipient(mine.to_recipients)) continue // skip volledig-interne mails
      if (dismissedConvIds.has(mine.conversation_id)) continue  // door Jelle als afgerond gemarkeerd
      if (reply && new Date(reply.received_at) >= new Date(mine.received_at)) continue
      const ageDays = (now - new Date(mine.received_at).getTime()) / (1000 * 60 * 60 * 24)
      if (ageDays < 1 || ageDays > 30) continue
      // To-recipients normaliseren voor display
      let toLabel = ''
      if (Array.isArray(mine.to_recipients)) {
        toLabel = mine.to_recipients.map(x => typeof x === 'string' ? x : (x?.email || x?.name || '')).filter(Boolean).join(', ')
      } else if (typeof mine.to_recipients === 'string') {
        toLabel = mine.to_recipients
      }
      // Label inferen via eerdere klant-categorisatie van deze recipient
      const inferredCategoryKey = inferOutgoingLabel(mine.to_recipients, mails)
      out.push({
        __awaiting: true,
        mail_id: mine.id,
        conversation_id: mine.conversation_id,
        received_at: mine.received_at,
        from_email: toLabel || '—',
        from_name: toLabel ? `aan ${toLabel}` : 'aan —',
        to_recipients: mine.to_recipients,
        cc_recipients: mine.cc_recipients,
        subject: mine.subject,
        body_preview: mine.body_preview,
        body_html: mine.body_html,
        body_text: mine.body_text,
        has_attachments: mine.has_attachments,
        category_key: inferredCategoryKey || '',
        audience: 'for_you',
        suggested_action: null,
        suggested_reasoning: null,
        confidence: 0,
        status: 'awaiting',
        draft_body: '',
        draft_subject: '',
        draft_variants: [],
        target_folder: null,
        days_waiting: Math.floor(ageDays),
        pending_bucket: awaitingBucketOf(mine.to_recipients),  // v3: klant / algemeen
      })
    }
    return out.sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
  }, [mailMessages, mails, dismissedConvIds, awaitingBucketOf])

  // "Prioriteit" — pending mails waar Outlook-vlag op staat (flag_status='flagged'
  // in mail_messages) plus mails die handmatig met flag-knop gemarkeerd zijn.
  // flagOverrides bevat optimistic state met TTL: { val, setAt }. Cleanup
  // gebeurt pas 30s na laatste klik, of meteen na expliciete failure-revert.
  // Reden voor TTL: bij snel-klikken kon ster instant uitvinken doordat de
  // mail_messages-refetch eerder kwam dan de DB-flag was bijgewerkt door de
  // execute-skill (race condition tussen optimistic en realtime sync).
  const [flagOverrides, setFlagOverrides] = useState(() => new Map())
  // V3.0 (2026-05-21): pinned = is_pinned=true (Outlook 'Pin to top' via
  // PidTagPinTimestamp extended property) OF flag_status='flagged' (legacy
  // 'Flag for follow-up'). Beide tellen mee voor de Pinned-bucket.
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

  const handleToggleFlag = useCallback(async (mailId, newVal) => {
    setFlagOverrides(prev => {
      const next = new Map(prev)
      next.set(mailId, { val: newVal, setAt: Date.now() })
      return next
    })
    try {
      const { data, error } = await supabase.rpc('set_mail_flag', { p_mail_id: mailId, p_flag: newVal })
      if (error || (data && data.ok === false)) {
        setFlagOverrides(prev => {
          const next = new Map(prev)
          next.delete(mailId)
          return next
        })
      }
    } catch {
      setFlagOverrides(prev => {
        const next = new Map(prev)
        next.delete(mailId)
        return next
      })
    }
  }, [])

  // Periodieke cleanup van overrides: alleen verwijderen als > 30s oud EN
  // db-status klopt. Voorkomt de "ster vinkt direct uit"-bug bij race
  // condition tussen optimistic UI en realtime mail_messages-refresh.
  useEffect(() => {
    const interval = setInterval(() => {
      setFlagOverrides(prev => {
        if (prev.size === 0) return prev
        const now = Date.now()
        const dbFlagged = new Set()
        for (const m of (mailMessages || [])) {
          if (m.flag_status === 'flagged') dbFlagged.add(m.id)
        }
        let changed = false
        const next = new Map(prev)
        for (const [id, entry] of prev.entries()) {
          const ageMs = now - (entry?.setAt || 0)
          if (ageMs > 30000 && entry?.val === dbFlagged.has(id)) {
            next.delete(id)
            changed = true
          }
        }
        return changed ? next : prev
      })
    }, 5000)
    return () => clearInterval(interval)
  }, [mailMessages])
  const priorityMails = useMemo(() => {
    return mails.filter(m => (m.status === 'pending' || m.status === 'amended') && flaggedMailIds.has(m.mail_id))
  }, [mails, flaggedMailIds])

  // "Drafts klaar" — autodraft_decisions waar action='send' en uitvoering klaar
  // (execution_status='done'), maar nog niet handmatig in Outlook verstuurd.
  // Detectie 'al verstuurd': een eigen mail met dezelfde conversation_id + sent_at
  // > decided_at. Kortom: als jij de draft hebt aangepast en handmatig verzonden,
  // verdwijnt 'ie hier.
  const sentDraftsList = useMemo(() => {
    const placedDecisions = decisions.filter(d => d.action === 'send' && d.execution_status === 'done')
    const out = []
    for (const d of placedDecisions) {
      const sourceMail = mails.find(m => m.mail_id === d.mail_id)
      if (!sourceMail) continue
      // Heb je daarna in dezelfde conversation een eigen mail verstuurd?
      const myReplyAfter = (mailMessages || []).find(mm =>
        mm.is_from_me &&
        mm.conversation_id === sourceMail.conversation_id &&
        mm.received_at && d.executed_at &&
        new Date(mm.received_at) > new Date(d.executed_at)
      )
      if (myReplyAfter) continue  // al verstuurd, niet meer tonen
      out.push({
        __sent_draft: true,
        mail_id: sourceMail.mail_id,
        conversation_id: sourceMail.conversation_id,
        received_at: d.executed_at || sourceMail.received_at,
        from_email: sourceMail.from_email,
        from_name: sourceMail.from_name,
        to_recipients: sourceMail.to_recipients,
        cc_recipients: sourceMail.cc_recipients,
        subject: d.final_subject || sourceMail.subject,
        body_preview: sourceMail.body_preview,
        body_html: sourceMail.body_html,
        body_text: sourceMail.body_text,
        has_attachments: sourceMail.has_attachments,
        category_key: sourceMail.category_key,
        audience: sourceMail.audience,
        suggested_action: null,
        suggested_reasoning: null,
        confidence: sourceMail.confidence,
        status: 'placed',
        draft_body: d.final_body || sourceMail.draft_body,
        draft_subject: d.final_subject || sourceMail.draft_subject,
        draft_variants: [],
        target_folder: d.target_folder,
        days_since_placed: Math.floor((Date.now() - new Date(d.executed_at).getTime()) / (1000 * 60 * 60 * 24)),
      })
    }
    return out.sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
  }, [decisions, mails, mailMessages])

  // Verdeel: al-verwerkt-in-Outlook vs niet-verwerkt.
  const { active, handled } = useMemo(() => {
    const a = []
    const h = []
    for (const m of pending) {
      if (isMailAlreadyHandled(m, mailMessagesById, conversationByMyReplyAfter)) h.push(m)
      else a.push(m)
    }
    return { active: a, handled: h }
  }, [pending, mailMessagesById, conversationByMyReplyAfter])

  // Sub-filter Aandeelhouder/Klant/Intern/Overig binnen Voor jou / Pin / In afwachting.
  // Categorie-mapping:
  //   aandeelhouder OF isFromShareholder  → 'aandeelhouder' (eigen rode bucket, prio)
  //   intern/partner/recruitment/leverancier → 'intern'
  //   klant_* → 'klant'
  //   rest → 'overig'
  const [subFilter, setSubFilter] = useState('all')
  useEffect(() => { setSubFilter('all') }, [audience])
  const INTERN_KEYS = new Set(['intern', 'partner', 'recruitment', 'leverancier'])
  function bucketOf(m) {
    const k = m.category_key || ''
    // Aandeelhouder krijgt eigen bucket (rood, eerste prio)
    if (k === 'aandeelhouder' || isFromShareholder(m.from_email)) return 'aandeelhouder'
    if (INTERN_KEYS.has(k)) return 'intern'
    if (k.startsWith('klant_')) return 'klant'
    // Email-domain heuristiek voor pseudo-mails zonder categorie
    const dom = (m.from_email || '').split('@')[1] || ''
    if (INTERNAL_DOMAINS.includes(dom)) return 'intern'
    return 'overig'
  }

  // Audience-specifieke pools.
  // 2026-05-21: Star-tab verwijderd. Gepinde mails BLIJVEN in for_you-pool
  // en worden als 'Pinned'-bucket bovenaan getoond (Outlook-stijl).
  let rawPool = audience === 'awaiting'    ? awaitingMails
              : audience === 'sent_drafts' ? sentDraftsList
              : (showHandled ? pending : active)
  // Apply sub-filter:
  // v3 (2026-05-26): voor 'awaiting' filteren we op pending_bucket
  //   (deterministisch: klant = recipient zit in customerEmails)
  // voor 'for_you' blijft de oude bucketOf-logica (Aandeelhouder/Klant/Intern/Overig)
  const SUB_FILTER_AUDIENCES = new Set(['for_you', 'awaiting'])
  if (audience === 'awaiting' && subFilter !== 'all') {
    rawPool = rawPool.filter(m => m.pending_bucket === subFilter)
  } else if (SUB_FILTER_AUDIENCES.has(audience) && subFilter !== 'all') {
    rawPool = rawPool.filter(m => bucketOf(m) === subFilter)
  }
  const visiblePool = useMemo(() =>
    actionedIds.size === 0 ? rawPool : rawPool.filter(m => !actionedIds.has(m.mail_id)),
    [rawPool, actionedIds])
  const handledIds = useMemo(() => new Set(handled.map(m => m.mail_id)), [handled])

  // Counts per sub-bucket voor de pillen.
  // v3 (2026-05-26): awaiting telt op pending_bucket (klant/algemeen),
  // for_you telt op de oude bucketOf (aandeelhouder/klant/intern/overig).
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
    let basePool = []
    if (audience === 'for_you') {
      basePool = (showHandled ? pending : active)
        .filter(m => m.audience === 'for_you')
    }
    const out = { all: 0, aandeelhouder: 0, intern: 0, klant: 0, overig: 0 }
    for (const m of basePool) {
      out.all++
      const b = bucketOf(m)
      out[b] = (out[b] || 0) + 1
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience, awaitingMails, pending, active, showHandled])

  const filtered = useMemo(() => {
    const preset = FILTER_PRESETS.find(f => f.id === filter) || FILTER_PRESETS[0]
    const audPreset = AUDIENCE_PRESETS.find(f => f.id === audience) || AUDIENCE_PRESETS[0]
    const q = query.trim().toLowerCase()
    return visiblePool.filter(m => {
      if (!audPreset.match(m)) return false
      if (!preset.match(m)) return false
      if (!q) return true
      // V8.9 (2026-05-13): search uitgebreid naar mail-content (body_preview
      // + body_text + body_html). Body_html wordt eerst gestript van tags voor
      // de match zodat <p>Hallo</p> matched op "hallo". body_preview is meestal
      // 100-150 chars cap; body_text/_html bevat full content.
      const bodyText = m.body_text || ''
      const bodyHtmlStripped = m.body_html ? String(m.body_html).replace(/<[^>]+>/g, ' ') : ''
      return (m.subject || '').toLowerCase().includes(q) ||
             (m.from_email || '').toLowerCase().includes(q) ||
             (m.from_name  || '').toLowerCase().includes(q) ||
             (m.body_preview || '').toLowerCase().includes(q) ||
             bodyText.toLowerCase().includes(q) ||
             bodyHtmlStripped.toLowerCase().includes(q)
    })
  }, [visiblePool, filter, audience, query])

  // 2026-05-21: bij audience='for_you' krijgt 'Pinned' (gepinde mails) een
  // eigen bucket BOVENAAN __order — Outlook-stijl. Andere audiences gebruiken
  // standaard age-buckets.
  const buckets = useMemo(() => {
    if (audience !== 'for_you' || flaggedMailIds.size === 0) {
      return groupByAge(filtered)
    }
    const pinned = filtered.filter(m => flaggedMailIds.has(m.mail_id))
    const rest   = filtered.filter(m => !flaggedMailIds.has(m.mail_id))
    if (pinned.length === 0) return groupByAge(rest)
    const restBuckets = groupByAge(rest)
    return {
      ...restBuckets,
      '📌 Pinned': pinned,
      __order: ['📌 Pinned', ...(restBuckets.__order || [])],
    }
  }, [audience, filtered, flaggedMailIds])
  const flat    = useMemo(() => {
    const out = []
    for (const k of buckets.__order || []) out.push(...buckets[k])
    return out
  }, [buckets])

  // Pagination — render eerst 25, knop "laad meer" voegt 25 toe. Reset bij
  // audience- of filter-wissel zodat je niet onverwacht ver in de lijst zit.
  const PAGE = 25
  const [visibleCount, setVisibleCount] = useState(PAGE)
  useEffect(() => { setVisibleCount(PAGE) }, [audience, filter, query, showHandled])
  const visibleFlat = useMemo(() => flat.slice(0, visibleCount), [flat, visibleCount])
  const hasMore = flat.length > visibleCount

  const [selectedId, setSelectedId] = useState(null)
  useEffect(() => {
    if (!selectedId && flat.length > 0) setSelectedId(flat[0].mail_id)
    else if (selectedId && !flat.find(m => m.mail_id === selectedId)) setSelectedId(flat[0]?.mail_id || null)
  }, [flat, selectedId])
  const selected = flat.find(m => m.mail_id === selectedId) || null

  // Demo-data detectie — als >50% mails begint met 'demo-', tonen we banner
  const demoCount = mails.filter(m => String(m.mail_id).startsWith('demo-')).length
  const isDemo = mails.length > 0 && demoCount / mails.length > 0.5

  // Keyboard navigatie
  const rootRef = useRef(null)
  useEffect(() => {
    function onKey(e) {
      // Alleen ingrijpen als focus niet in textarea/input zit
      const tag = document.activeElement?.tagName
      if (['TEXTAREA','INPUT','SELECT'].includes(tag)) return
      if (!selected) return
      const idx = flat.findIndex(m => m.mail_id === selected.mail_id)
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        const next = flat[Math.min(flat.length - 1, idx + 1)]
        if (next) setSelectedId(next.mail_id)
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        const prev = flat[Math.max(0, idx - 1)]
        if (prev) setSelectedId(prev.mail_id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flat, selected])

  // F.2.e — Sync-knop triggert mail-sync + auto-draft samen via één RPC.
  // Lost Jelle's klacht op: verplaatste mails verdwenen pas na 30-60 min uit
  // 'Voor jou' (orchestrator-cadence). Nu kan hij direct forceren.
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

  // Bulk-skip: alleen actief bij filter='skip' of als er meer dan 1 skip-voorstel is
  const skipMails = useMemo(() => pending.filter(m => m.suggested_action === 'skip'), [pending])
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkMsg, setBulkMsg]   = useState(null)
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

      {/* RAG-coverage trend voor de mail-drafts (compact, 1 regel).
          Alleen renderen wanneer showRagHealth=true. AutoDraftView geeft false
          door — de RAG-gegevens hangen daar onder de 3-dots in MaestroListHeader. */}
      {showRagHealth && <RagHealthPanel recordType="autodraft_mail" weeks={3} compact />}

      {/* Verplaatst-mails-strook is bewust weggehaald — handled mails worden
          gewoon stil verborgen (showHandled blijft als toggle in ⋯-menu). */}

      {/* Sub-filter — voor 'awaiting' twee tabs (Klanten/Algemeen, deterministisch
          op recipient via customerEmails). Voor 'for_you' de oude 4-bucket
          filter (Aandeelhouder/Klant/Intern/Overig op category_key). */}
      {subCounts && subCounts.all > 0 && (
        <div className={styles.subFilterBar}>
          {(audience === 'awaiting'
            ? [
                { id: 'all',      label: 'Alles',      n: subCounts.all },
                { id: 'klant',    label: '🟢 Klanten',  n: subCounts.klant },
                { id: 'algemeen', label: '⚪ Algemeen', n: subCounts.algemeen },
              ]
            : [
                { id: 'all',           label: 'Alles',           n: subCounts.all },
                { id: 'aandeelhouder', label: '🔴 Aandeelhouder', n: subCounts.aandeelhouder },
                { id: 'klant',         label: '🟢 Klant',         n: subCounts.klant },
                { id: 'intern',        label: '🔵 Intern',        n: subCounts.intern },
                { id: 'overig',        label: '⚪ Overig',         n: subCounts.overig },
              ]
          ).filter(p => p.id === 'all' || p.n > 0).map(p => {
            const on = subFilter === p.id
            return (
              <button key={p.id} type="button" onClick={() => setSubFilter(p.id)}
                className={`${styles.subFilterPill} ${on ? styles.subFilterPillActive : ''}`}>
                {p.label} <span className={styles.subFilterCount}>{p.n}</span>
              </button>
            )
          })}
        </div>
      )}

      {audience === 'logs' ? (
        <div className={styles.logsWrapper}>
          <InboxLog mails={mails} decisions={decisions} alwaysOpen />
        </div>
      ) : (
      <div className="ad-split" style={{
        gridTemplateColumns: `${listWidth}px 6px 1fr`,
        gap: 0,
      }}>
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
            <>
              {(() => {
                const visibleSet = new Set(visibleFlat.map(m => m.mail_id))
                const slice = items => items.filter(m => visibleSet.has(m.mail_id))
                return <>
                  {(buckets.__order || []).map(label =>
                    renderBucket(label, slice(buckets[label] || []), categories, selectedId, setSelectedId, threadCounts, handledIds, flaggedMailIds, handleToggleFlag, ragSummaryById)
                  )}
                </>
              })()}
              {hasMore && (
                <button type="button"
                  onClick={() => setVisibleCount(c => c + PAGE)}
                  className={styles.loadMoreBtn}>
                  ↓ Laad meer ({flat.length - visibleCount} {flat.length - visibleCount === 1 ? 'mail' : 'mails'} over)
                </button>
              )}
            </>
          )}
        </aside>
        {/* Drag-handle tussen lijst en detail. Breedte 6px, hover-accent
            voor zichtbaarheid. localStorage-persist via effect hierboven. */}
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
                  <div style={{ marginTop: 8 }}>Mails worden geladen…</div>
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

function renderBucket(label, items, categories, selectedId, setSelectedId, threadCounts, handledIds, flaggedIds, onToggleFlag, ragSummaryById) {
  if (items.length === 0) return null
  // V12 (2026-05-21): bucket-headers krijgen accent-classes voor visuele
  // scheiding tussen Pinned-sectie en de tijdslijn daaronder (Outlook-stijl).
  const isPinned = label === '📌 Pinned'
  const isToday  = label === 'Vandaag'
  const headCls  = [
    'ad-list-group__head',
    isPinned ? 'ad-list-group__head--pinned' : '',
    isToday  ? 'ad-list-group__head--today'  : '',
  ].filter(Boolean).join(' ')
  return (
    <div key={label} className={`ad-list-group ${isPinned ? 'ad-list-group--pinned' : ''}`}>
      <div className={headCls}>
        <span>{label}</span>
        <span className="ad-list-group__count">{items.length}</span>
      </div>
      {items.map(m => (
        <MailRow key={m.mail_id} mail={m} categories={categories}
          threadCount={threadCounts?.get(m.conversation_id) || 0}
          isHandled={handledIds?.has(m.mail_id)}
          isFlagged={flaggedIds?.has(m.mail_id)}
          onToggleFlag={onToggleFlag}
          ragSummary={ragSummaryById?.get(m.id) || null}
          selected={m.mail_id === selectedId} onSelect={() => setSelectedId(m.mail_id)} />
      ))}
    </div>
  )
}

export default InboxPanel
