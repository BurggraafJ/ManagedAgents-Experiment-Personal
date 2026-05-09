import { useState, useMemo, useEffect, useCallback, useRef, Component } from 'react'
import { supabase } from '../../../lib/supabase'
import RagBadge from '../../RagBadge'
import RagHealthPanel from '../../RagHealthPanel'
import { showToast } from '../../Toast'
import { useAutoDraft } from '../../../hooks/useAutoDraft'
import { useSupabaseQuery } from '../../../hooks/useSupabaseQuery'
import {
  AGENT, INTERNAL_DOMAINS,
  FILTER_PRESETS, AUDIENCE_PRESETS,
  isMailAlreadyHandled, isFromShareholder, findMyPosition, recipientsToString,
  inferPseudoAudience, isInternalRecipient, isOutOfOffice, isCanceledInvite,
  isClosingMail, inferOutgoingLabel,
  parseRecipientTokens, chipLabel,
  formatRelative, formatDateTime,
  confTone, colorWithAlpha, groupByAge,
  tagStyle, popoverItemStyle,
} from '../../../lib/autodraft'
import MailingSettings from './MailingSettings'
import { MailImproverButton } from './modals/MailImproverModal'
import ReasonModal from './modals/ReasonModal'
import PreferenceQuickModal from './modals/PreferenceQuickModal'
import SpelcheckPopover from './modals/SpelcheckPopover'
import IconBtn from './inbox/IconBtn'
import ToolbarBtn from './inbox/ToolbarBtn'
import ActionBtn, { btnStyle, kbdStyle } from './inbox/ActionBtn'
import ArrowBtn from './inbox/ArrowBtn'
import DropdownItem from './inbox/DropdownItem'
import QuickActionsBtn from './inbox/QuickActionsBtn'
import QuickActionsToolbarBtn from './inbox/QuickActionsToolbarBtn'
import IgnoreDropdownBtn from './inbox/IgnoreDropdownBtn'
import EmptyState from './inbox/EmptyState'
import SchoonButton from './inbox/SchoonButton'
import MailRow from './inbox/MailRow'
import AgendaCheckBadge from './inbox/AgendaCheckBadge'
import DateReservations from './inbox/DateReservations'
import ActivityLog from './inbox/ActivityLog'
import OutlookChain, { SenderHistory } from './inbox/OutlookChain'

// Mini-ErrorBoundary alleen voor MailDetail zodat een crash in één mail
// de rest van de inbox niet sloopt.
class DetailErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) {
    console.error('[autodraft detail crash]', error, info)
    // Forceer rerender met de info zodat we hem kunnen tonen.
    this.setState({ info })
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{
        padding: 24,
        color: '#000',
        background: '#fee2e2',
        border: '3px solid #dc2626',
        margin: 12,
        borderRadius: 8,
      }}>
        <strong style={{ fontSize: 14, color: '#dc2626' }}>⚠ MailDetail crashed:</strong>
        <pre style={{
          fontSize: 11, marginTop: 8,
          whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: 300,
          background: '#fff', padding: 8, borderRadius: 4,
          fontFamily: 'monospace', color: '#000',
        }}>
          {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
          {this.state.info?.componentStack && '\n\n' + this.state.info.componentStack}
        </pre>
        <button type="button" style={{ marginTop: 12, padding: '6px 12px' }}
          onClick={() => this.setState({ error: null, info: null })}>
          Probeer opnieuw
        </button>
      </div>
    )
  }
}

// AutoDraftView v6 — Outlook-stijl postvak met sub-pagina-router.
//
// Sidebar-groep "Mailing" (App.jsx) heeft 5 children. Deze view dispatcht op
// `subPage` prop naar de juiste subview:
//   - postvak     → full-width Outlook-stijl: lijst + sticky draft + chain
//   - voorstellen → categorie- + lesson-voorstellen + systeem-instructies
//   - categories  → kleur, default-actie, doelmap, instructies per categorie
//   - logboek     → verwerkte mails + recente runs (debug)
//   - regels      → geleerde regels uit amendments
//
// Verschilpunten t.o.v. v5:
//   - Postvak heeft "al verwerkt"-filter (verplaatst uit Inbox of beantwoord
//     via mail_messages) — verbergt mails waar je in Outlook al actie op deed.
//   - Thread-historie staat altijd open in een Outlook-stijl chain, mijn mails
//     rechts uitgelijnd. Geen click-to-expand meer.
//   - Sticky draft-editor bovenaan met variant-pijltjes.

export default function AutoDraftView({ subPage = 'postvak', onNavigate }) {
  // Refactor 05 — hook-migratie: data-prop weggehaald, view leest direct uit
  // useAutoDraft (Refactor 02) + useSupabaseQuery (Refactor 04). Sub-components
  // krijgen scoped props (geen data-shim) — voorkomt de re-render-cascade die
  // de eerste sessie-1 attempt deed crashen.
  const {
    mails,
    mailMessages,
    decisions,
    folders,
    lessons,
    ignoreRules,
    agentInstructions,
    awaitingDismissed: awaitingDismissedRows,
    hubspotCustomerEmails: customerEmailRows,
    lessonProposals: lessonProps,
    categoryProposals: categoryProps,
    categories: rawCategories,
  } = useAutoDraft()
  const { data: recentRuns } = useSupabaseQuery('agent_runs', {
    select: 'id,agent_name,status,started_at,completed_at,summary,stats',
    in: { agent_name: [AGENT, 'auto-draft-execute'] },
    orderBy: ['started_at', { ascending: false }],
    limit: 20,
  })

  const categories = useMemo(() =>
    (rawCategories || []).slice().sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100)),
    [rawCategories])

  // Set van conversation_ids die Jelle als 'afgerond' heeft gemarkeerd —
  // worden verborgen uit de awaiting-tab.
  const dismissedConvIds = useMemo(() =>
    new Set((awaitingDismissedRows || []).map(d => d.conversation_id)),
    [awaitingDismissedRows])
  // Set van klant-emails uit HubSpot Customer Base — als afzender of recipient
  // hierin zit, default target_folder = 'Klanten/Customer Succes'.
  const customerEmails = useMemo(() =>
    new Set((customerEmailRows || []).map(c => (c.email || '').toLowerCase())),
    [customerEmailRows])

  // Reminder-stijl uit agent_config (key='reminder_style', agent='auto-draft').
  // Bewerkbaar in Mailing-instellingen. Wordt getoond bij follow-up als hint.
  const reminderStyle = useMemo(() => {
    const cfg = (agentInstructions || []).find(c =>
      c.config_key === 'reminder_style' && c.agent_name === 'auto-draft')
    if (!cfg) return ''
    const v = cfg.config_value
    return typeof v === 'string' ? v : (v?.text || '')
  }, [agentInstructions])

  // Telling per conversation_id voor thread-badges in lijst
  const threadCounts = useMemo(() => {
    const m = new Map()
    for (const x of (mails || [])) {
      if (!x.conversation_id) continue
      m.set(x.conversation_id, (m.get(x.conversation_id) || 0) + 1)
    }
    return m
  }, [mails])

  const latestScanRun = useMemo(() =>
    (recentRuns || []).find(r => r.agent_name === AGENT) || null,
    [recentRuns])

  if (subPage === 'settings') {
    return (
      <div className="mc-app">
        <MailingSettings
          mails={mails}
          categories={categories}
          categoryProps={categoryProps}
          lessonProps={lessonProps}
          decisions={decisions}
          folders={folders}
          lessons={lessons}
          agentInstructions={agentInstructions}
          recentRuns={recentRuns}
          onNavigate={onNavigate}
        />
      </div>
    )
  }

  // Default: Postvak (full-width Outlook-stijl)
  return (
    <div className="mc-app">
      <InboxPanel
        mails={mails}
        mailMessages={mailMessages}
        categories={categories}
        folders={folders}
        lessons={lessons}
        decisions={decisions}
        ignoreRules={ignoreRules}
        dismissedConvIds={dismissedConvIds}
        customerEmails={customerEmails}
        reminderStyle={reminderStyle}
        threadCounts={threadCounts}
        latestScanRun={latestScanRun}
        onNavigate={onNavigate}
      />
    </div>
  )
}

// =====================================================================
// INBOX PANEL — lijst + detail + demo-banner + zoek + filters + keyboard
// =====================================================================

function InboxPanel({ mails, mailMessages, categories, folders, lessons, decisions = [], ignoreRules = [], dismissedConvIds = new Set(), customerEmails = new Set(), reminderStyle = '', threadCounts, latestScanRun, onNavigate }) {
  const [filter, setFilter]     = useState('all')
  // Start op 'Voor jou' zodat persoonlijke mails als eerste in beeld komen.
  const [audience, setAudience] = useState('for_you')
  const [query, setQuery]       = useState('')
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
      })
    }
    return out.sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
  }, [mailMessages, mails, dismissedConvIds])

  // "Prioriteit" — pending mails waar Outlook-vlag op staat (flag_status='flagged'
  // in mail_messages) plus mails die handmatig met flag-knop gemarkeerd zijn.
  // flagOverrides bevat optimistic state met TTL: { val, setAt }. Cleanup
  // gebeurt pas 30s na laatste klik, of meteen na expliciete failure-revert.
  // Reden voor TTL: bij snel-klikken kon ster instant uitvinken doordat de
  // mail_messages-refetch eerder kwam dan de DB-flag was bijgewerkt door de
  // execute-skill (race condition tussen optimistic en realtime sync).
  const [flagOverrides, setFlagOverrides] = useState(() => new Map())
  const flaggedMailIds = useMemo(() => {
    const s = new Set()
    for (const m of (mailMessages || [])) {
      if (m.flag_status === 'flagged') s.add(m.id)
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

  // Audience-specifieke pools. Voor jou: gepinde mails verbergen want die
  // zitten al in Pin-tab — geen dubbele zichtbaarheid.
  let rawPool = audience === 'awaiting'    ? awaitingMails
              : audience === 'priority'    ? priorityMails
              : audience === 'sent_drafts' ? sentDraftsList
              : (showHandled ? pending : active)
  if (audience === 'for_you') {
    rawPool = rawPool.filter(m => !flaggedMailIds.has(m.mail_id))
  }
  // Apply sub-filter (intern/klant) — alleen voor for_you/priority/awaiting
  const SUB_FILTER_AUDIENCES = new Set(['for_you', 'priority', 'awaiting'])
  if (SUB_FILTER_AUDIENCES.has(audience) && subFilter !== 'all') {
    rawPool = rawPool.filter(m => bucketOf(m) === subFilter)
  }
  const visiblePool = useMemo(() =>
    actionedIds.size === 0 ? rawPool : rawPool.filter(m => !actionedIds.has(m.mail_id)),
    [rawPool, actionedIds])
  const handledIds = useMemo(() => new Set(handled.map(m => m.mail_id)), [handled])

  // Counts per sub-bucket voor de pillen — basePool moet de FILTER-MATCH-poel
  // zijn van de huidige audience, anders krijg je nonsens cijfers (Voor jou
  // toont 44 maar 'Alles' subcount toont 166 want hele pending werd gepakt).
  const subCounts = useMemo(() => {
    if (!SUB_FILTER_AUDIENCES.has(audience)) return null
    let basePool = []
    if (audience === 'awaiting') basePool = awaitingMails
    else if (audience === 'priority') basePool = priorityMails
    else if (audience === 'for_you') {
      basePool = (showHandled ? pending : active)
        .filter(m => m.audience === 'for_you')
        .filter(m => !flaggedMailIds.has(m.mail_id))
    }
    const out = { all: 0, aandeelhouder: 0, intern: 0, klant: 0, overig: 0 }
    for (const m of basePool) {
      out.all++
      const b = bucketOf(m)
      out[b] = (out[b] || 0) + 1
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience, awaitingMails, priorityMails, pending, active, showHandled, flaggedMailIds])

  const filtered = useMemo(() => {
    const preset = FILTER_PRESETS.find(f => f.id === filter) || FILTER_PRESETS[0]
    const audPreset = AUDIENCE_PRESETS.find(f => f.id === audience) || AUDIENCE_PRESETS[0]
    const q = query.trim().toLowerCase()
    return visiblePool.filter(m => {
      if (!audPreset.match(m)) return false
      if (!preset.match(m)) return false
      if (!q) return true
      return (m.subject || '').toLowerCase().includes(q) ||
             (m.from_email || '').toLowerCase().includes(q) ||
             (m.from_name  || '').toLowerCase().includes(q)
    })
  }, [visiblePool, filter, audience, query])

  const buckets = useMemo(() => groupByAge(filtered), [filtered])
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

      {/* RAG-coverage trend voor de mail-drafts (compact, 1 regel) */}
      <RagHealthPanel recordType="autodraft_mail" weeks={3} compact />

      {/* Verplaatst-mails-strook is bewust weggehaald — handled mails worden
          gewoon stil verborgen (showHandled blijft als toggle in ⋯-menu). */}

      {/* Sub-filter Intern/Klant bij Voor jou / Pin / In afwachting */}
      {subCounts && subCounts.all > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', fontSize: 11.5 }}>
          {[
            { id: 'all',           label: 'Alles',         n: subCounts.all },
            { id: 'aandeelhouder', label: '🔴 Aandeelhouder', n: subCounts.aandeelhouder },
            { id: 'klant',         label: '🟢 Klant',       n: subCounts.klant },
            { id: 'intern',        label: '🔵 Intern',      n: subCounts.intern },
            { id: 'overig',        label: '⚪ Overig',      n: subCounts.overig },
          ].filter(p => p.id === 'all' || p.n > 0).map(p => {
            const on = subFilter === p.id
            return (
              <button key={p.id} type="button" onClick={() => setSubFilter(p.id)}
                style={{
                  padding: '3px 10px', borderRadius: 999,
                  border: '1px solid var(--border)',
                  background: on ? 'var(--accent-soft)' : 'var(--bg)',
                  color: on ? 'var(--accent)' : 'var(--text)',
                  fontFamily: 'inherit', fontSize: 11.5, fontWeight: on ? 600 : 400,
                  cursor: 'pointer',
                }}>
                {p.label} <span style={{ opacity: 0.6, marginLeft: 3 }}>{p.n}</span>
              </button>
            )
          })}
        </div>
      )}

      {audience === 'logs' ? (
        <div style={{ padding: '12px 24px 32px' }}>
          <InboxLog mails={mails} decisions={decisions} alwaysOpen />
        </div>
      ) : (
      <div className="ad-split" style={{
        gridTemplateColumns: `${listWidth}px 6px 1fr`,
        gap: 0,
      }}>
        <aside className="ad-list">
          {flat.length === 0 ? (
            <EmptyState
              hasAnyMails={pending.length > 0}
              onScan={onScan}
              scanBusy={scanBusy}
            />
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
                  style={{
                    display: 'block', width: '100%',
                    padding: '12px', margin: '8px 0',
                    border: '1px dashed var(--border)',
                    borderRadius: 6,
                    background: 'var(--surface-1)',
                    color: 'var(--accent)',
                    fontFamily: 'inherit', fontSize: 12.5, fontWeight: 500,
                    cursor: 'pointer',
                  }}>
                  ↓ Laad meer ({flat.length - visibleCount} {flat.length - visibleCount === 1 ? 'mail' : 'mails'} over)
                </button>
              )}
            </>
          )}
        </aside>
        {/* Drag-handle tussen lijst en detail. Breedte 6px, hover-accent
            voor zichtbaarheid. localStorage-persist via effect hierboven. */}
        <div className="mc-splitter"
          role="separator" aria-orientation="vertical"
          aria-label="Versleep om kolommen aan te passen"
          onMouseDown={startDrag}
          style={{
            cursor: 'col-resize',
            background: 'var(--border)',
            position: 'relative',
            transition: 'background 80ms',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--accent)'}
          onMouseLeave={e => e.currentTarget.style.background = 'var(--border)'}
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
            <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>
              Selecteer een mail links om te beginnen.
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

// MinimalToolbar — één compacte rij. Voor jou/Niet voor jou tabs links,
// search-icoon dat klapt uit, ⋯ menu voor advanced filters.
function MinimalToolbar({
  pending, awaitingCount, priorityCount, sentDraftsCount,
  audience, setAudience, filter, setFilter, query, setQuery,
  showHandled, setShowHandled, handledCount,
  onScan, scanBusy, scanMsg, skipCount, bulkSkipAll, bulkBusy, bulkMsg,
  latestScanRun, onNavigate,
}) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const forCount    = pending.filter(m => m.audience === 'for_you').length
  const notForCount = pending.filter(m => m.audience === 'not_for_you').length
  const filterActive = filter !== 'all'
  const scanAgo = latestScanRun ? formatRelative(latestScanRun.started_at) : null

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 0', marginBottom: 6,
      fontSize: 12,
    }}>
      {/* Audience-tabs */}
      <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        {[
          { id: 'for_you',     label: 'Voor jou',     n: forCount },
          { id: 'priority',    label: '⭐ Pin',         n: priorityCount || 0 },
          { id: 'awaiting',    label: '⏳ In afwachting', n: awaitingCount || 0 },
          { id: 'not_for_you', label: 'Niet voor jou', n: notForCount },
          { id: 'sent_drafts', label: '📤 Drafts',     n: sentDraftsCount || 0 },
          { id: 'logs',        label: '📜 Logs',       n: null },
        ].map(t => {
          const on = audience === t.id
          return (
            <button key={t.id} type="button" onClick={() => setAudience(t.id)}
              style={{
                padding: '5px 12px',
                background: on ? 'var(--accent-soft)' : 'transparent',
                color: on ? 'var(--accent)' : 'var(--text)',
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                fontSize: 12, fontWeight: on ? 600 : 400,
                borderLeft: t.id !== 'for_you' ? '1px solid var(--border)' : 'none',
              }}>
              {t.label} <span style={{ opacity: 0.65, marginLeft: 4, fontVariantNumeric: 'tabular-nums' }}>{t.n}</span>
            </button>
          )
        })}
      </div>

      {/* Search */}
      {searchOpen ? (
        <input type="search" autoFocus
          value={query} onChange={e => setQuery(e.target.value)}
          onBlur={() => { if (!query) setSearchOpen(false) }}
          placeholder="zoeken…"
          style={{
            padding: '5px 10px', border: '1px solid var(--border)',
            borderRadius: 8, background: 'var(--bg)', color: 'var(--text)',
            fontFamily: 'inherit', fontSize: 12, width: 200,
          }} />
      ) : (
        <IconBtn onClick={() => setSearchOpen(true)} title="Zoek (afzender of onderwerp)">🔍</IconBtn>
      )}

      {/* ⋯ More — geeft toegang tot draft/skip/flag-filter en bulk-archive */}
      <div style={{ position: 'relative' }}>
        <IconBtn onClick={() => setMoreOpen(v => !v)} title="Meer filters" active={moreOpen || filterActive}>
          ⋯ {filterActive && <span style={{ marginLeft: 2, color: 'var(--accent)' }}>•</span>}
        </IconBtn>
        {moreOpen && (
          <div style={{
            position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 5,
            background: 'var(--surface-1)', border: '1px solid var(--border)',
            borderRadius: 8, padding: 8, minWidth: 220,
            boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          }}>
            <div style={{
              fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em',
              color: 'var(--text-muted)', marginBottom: 4, paddingLeft: 4,
            }}>Filter op voorstel</div>
            {FILTER_PRESETS.map(p => {
              const n = pending.filter(m => p.match(m)).length
              const on = filter === p.id
              return (
                <button key={p.id} type="button"
                  onClick={() => { setFilter(p.id); setMoreOpen(false) }}
                  style={{
                    display: 'flex', justifyContent: 'space-between', width: '100%',
                    padding: '6px 8px', fontSize: 12, borderRadius: 4,
                    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    background: on ? 'var(--accent-soft)' : 'transparent',
                    color: on ? 'var(--accent)' : 'var(--text)',
                    textAlign: 'left',
                  }}>
                  <span>{p.label}</span>
                  <span style={{ opacity: 0.65 }}>{n}</span>
                </button>
              )
            })}
            {handledCount > 0 && (
              <>
                <div style={{ borderTop: '1px solid var(--border)', margin: '6px 0' }} />
                <div style={{
                  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em',
                  color: 'var(--text-muted)', marginBottom: 4, paddingLeft: 4,
                }}>Al afgehandeld in Outlook</div>
                <button type="button"
                  onClick={() => { setShowHandled(!showHandled); setMoreOpen(false) }}
                  style={{
                    display: 'flex', justifyContent: 'space-between', width: '100%',
                    padding: '6px 8px', fontSize: 12, borderRadius: 4,
                    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    background: showHandled ? 'var(--accent-soft)' : 'transparent',
                    color: showHandled ? 'var(--accent)' : 'var(--text)',
                    textAlign: 'left',
                  }}>
                  <span>{showHandled ? '✓ Verberg afgehandelde' : 'Toon afgehandelde'}</span>
                  <span style={{ opacity: 0.65 }}>{handledCount}</span>
                </button>
              </>
            )}
            {skipCount >= 2 && (
              <>
                <div style={{ borderTop: '1px solid var(--border)', margin: '6px 0' }} />
                <button type="button" disabled={bulkBusy}
                  onClick={() => { bulkSkipAll(); setMoreOpen(false) }}
                  style={{
                    width: '100%', padding: '6px 8px', fontSize: 12, borderRadius: 4,
                    border: 'none', cursor: bulkBusy ? 'default' : 'pointer',
                    fontFamily: 'inherit', textAlign: 'left',
                    background: 'transparent', color: 'var(--warning, #f59e0b)',
                  }}>
                  🗂️ Archiveer alle {skipCount} negeer-voorstellen
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div style={{ flex: 1 }} />

      {/* Status + scan rechts */}
      {scanAgo && (
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }} title={`Laatste scan: ${scanAgo}`}>
          ↻ {scanAgo}
        </span>
      )}
      <IconBtn onClick={onScan} disabled={scanBusy} title="Ververs Outlook nu — mail-sync + scan binnen ~30s">
        {scanBusy ? '⏳' : '🔄'}
      </IconBtn>
      {scanMsg?.ok && <span style={{ color: 'var(--success)', fontSize: 11 }}>✓</span>}
      {scanMsg?.err && <span style={{ color: 'var(--error)', fontSize: 11 }} title={scanMsg.err}>⚠</span>}
      {bulkMsg?.ok && <span style={{ color: 'var(--success)', fontSize: 11 }}>✓ {bulkMsg.ok}</span>}
      {bulkMsg?.err && <span style={{ color: 'var(--error)', fontSize: 11 }}>⚠ {bulkMsg.err}</span>}

      {/* F.6.d — Schoon-indicator: groen als Postvak in sync met Outlook,
          geel/rood als sync veroudert of ghost-rows. Klik = trigger sync. */}
      <SchoonButton onTrigger={onScan} busy={scanBusy} />

      <MailImproverButton />

      {onNavigate && (
        <button type="button"
          onClick={() => onNavigate('autodraft_settings')}
          title="Mailing-instellingen — voorstellen, categorieen, regels, logboek"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 12px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface-1)',
            color: 'var(--text)',
            fontFamily: 'inherit', fontSize: 12, fontWeight: 500,
            cursor: 'pointer',
          }}>
          <span aria-hidden style={{ fontSize: 14 }}>⚙</span>
          <span>Instellingen</span>
        </button>
      )}
    </div>
  )
}

function renderBucket(label, items, categories, selectedId, setSelectedId, threadCounts, handledIds, flaggedIds, onToggleFlag, ragSummaryById) {
  if (items.length === 0) return null
  return (
    <div key={label} className="ad-list-group">
      <div className="ad-list-group__head">
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

// =====================================================================
// MAIL DETAIL
// =====================================================================

function MailDetail({ mail, categories, folders, lessons, allMails, mailMessages, customerEmails = new Set(), decisions = [], reminderStyle = '', markActioned, unmarkActioned, isFlagged }) {
  // Vol-body uit mail_messages (truth-of-source) als beschikbaar.
  const [fullBody, setFullBody] = useState(null)
  const mmRow = useMemo(() =>
    (mailMessages || []).find(m => m.id === mail.mail_id) || null,
    [mailMessages, mail.mail_id])

  useEffect(() => {
    let cancelled = false
    setFullBody(null)
    if (!mmRow) {
      return () => { cancelled = true }
    }
    // Named async helper i.p.v. IIFE — vermijdt ASI-bomb (return\n(async..)
    // werd door JS parser gelezen als `return (async..)()` → useEffect-cleanup
    // werd een Promise i.p.v. function, wat React's effect-handling brak en
    // tot een silent render-fail leidde voor MailDetail.
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

  // Effective body voor de geselecteerde mail
  const effHtml = fullBody?.body_html || mail.body_html
  const effText = fullBody?.body_text || mail.body_text
  const effPreview = mmRow?.body_preview || mail.body_preview
  const effTruncated = fullBody?.body_truncated ?? mmRow?.body_truncated ?? false

  // Recipients-defaults: To = afzender (reply-target), Cc = origineel CC.
  // Beide jsonb-velden kunnen array of string zijn — normaliseer veilig.
  function normalizeRecipients(v) {
    if (!v) return ''
    if (Array.isArray(v)) return v.map(x => typeof x === 'string' ? x : (x?.email || x?.address || '')).filter(Boolean).join(', ')
    if (typeof v === 'string') return v
    if (typeof v === 'object') return v.email || v.address || ''
    return ''
  }

  // Customer-Base detectie: als afzender of een van de recipients in de
  // hubspot Customer Base set zit, default target_folder = Klanten/Customer Succes.
  // Dit overrulet de category-default zodat klant-mails altijd CS-bound zijn.
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
  const [busy, setBusy]                 = useState(null)
  const [err, setErr]                   = useState(null)
  // F.1.b — track welke variant Jelle ziet bij send/amend, voor variant-stats.
  // Lift state up zodat submit() de variant-index/label kent. DraftEditor leest + setst via props.
  const [variantIndex, setVariantIndex] = useState(mail.selected_variant_index || 0)
  // Modals voor de nieuwe quick-Voorkeur en AI-Spelcheck flows.
  const [prefModalOpen, setPrefModalOpen] = useState(false)
  const [spelcheckOpen, setSpelcheckOpen] = useState(false)

  const isSkipSuggested = mail.suggested_action === 'skip'
  const isAwaiting = !!mail.__awaiting
  const isSentDraft = !!mail.__sent_draft
  const isReadOnly = isAwaiting || isSentDraft
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
    setCollapsed(mail.suggested_action === 'skip' || !!mail.__awaiting || !!mail.__sent_draft)
    setErr(null)
    setVariantIndex(mail.selected_variant_index || 0)
  }, [mail.mail_id, mail.selected_variant_index])

  const cat = categories.find(c => c.category_key === categoryKey)
  // Folder-tree: lijst van { path, depth, name } gesorteerd op full_path zodat
  // sub-folders direct onder hun parent komen. Indent op depth — visueel
  // identiek aan Outlook's mappenboom. Skip 'Inbox/Projecten/*' (legacy).
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
      .map(p => ({
        path: p,
        depth: (p.match(/\//g) || []).length,
        name: p.split('/').pop(),
      }))
  }, [folders, categories])
  // Backwards-compat: simpele lijst voor fallback-gebruik
  const folderOptions = useMemo(() => folderTree.map(f => f.path), [folderTree])

  const activeLessons = useMemo(() => lessons.filter(l =>
    (l.scope === 'global') ||
    (l.scope === 'category' && l.scope_value === categoryKey) ||
    (l.scope === 'domain' && mail.from_email && mail.from_email.endsWith('@' + l.scope_value)) ||
    (l.scope === 'sender' && l.scope_value === mail.from_email)
  ), [lessons, categoryKey, mail.from_email])

  const submit = useCallback(async (action, opts = {}) => {
    if (busy) return
    setErr(null); setBusy(opts.busyTag || action)
    // Optimistic: voor send/ignore/spam verbergen we de mail meteen uit de lijst.
    // Bij amend houden we 'm zichtbaar (skill schrijft een nieuwe variant terug).
    const optimisticHide = ['send','ignore','spam'].includes(action)
    if (optimisticHide && markActioned) markActioned(mail.mail_id)
    try {
      // F.1.b — variant-tracking: meet welke draft-variant Jelle koos bij send/amend.
      // Voor 'send' en 'amend' is de actieve variant relevant; voor ignore/spam niet.
      const variants = Array.isArray(mail.draft_variants) ? mail.draft_variants : []
      const trackVariant = ['send','amend'].includes(action) && variants.length > 0
      const chosenIdx = trackVariant ? Math.max(0, Math.min(variantIndex, variants.length - 1)) : null
      const chosenLabel = trackVariant ? (variants[chosenIdx]?.label ?? null) : null

      const { data: rpcRes, error } = await supabase.rpc('submit_autodraft_decision', {
        p_mail_id: mail.mail_id,
        p_action: action,
        p_amend: action === 'amend' ? amendText : null,
        p_final_subject: action === 'send' ? (opts.subject ?? draftSubject) : null,
        p_final_body:    action === 'send' ? (opts.body    ?? draftBody)    : null,
        p_target_folder: opts.target_folder ?? (targetFolder || null),
        p_decision_kind: opts.decision_kind || 'reply',
        p_final_to:      opts.final_to || null,
        p_chosen_variant_index: chosenIdx,
        p_chosen_variant_label: chosenLabel,
      })
      if (error) {
        setErr(error.message)
        if (optimisticHide && unmarkActioned) unmarkActioned(mail.mail_id)
        showToast({ kind: 'error', message: 'Actie mislukt', detail: error.message })
      } else if (rpcRes && rpcRes.ok === false) {
        setErr(rpcRes.reason || 'mislukt')
        if (optimisticHide && unmarkActioned) unmarkActioned(mail.mail_id)
        showToast({ kind: 'error', message: 'Actie geweigerd', detail: rpcRes.reason || 'mislukt' })
      } else {
        // Succes — kort visueel signaal per actie-type. Voor 'send' apart, want
        // dat is de hoofd-actie en je wil weten dat je concept onderweg is.
        if (action === 'send') {
          showToast({
            message: 'Concept onderweg naar Outlook',
            detail: 'Instant-trigger maakt de Outlook-draft binnen enkele seconden.',
          })
        } else if (action === 'ignore') {
          showToast({ kind: 'info', message: 'Mail genegeerd', detail: opts.target_folder ? `Verplaatst naar ${opts.target_folder}` : null })
        } else if (action === 'spam') {
          showToast({ kind: 'info', message: 'Gemarkeerd als spam' })
        } else if (action === 'amend') {
          showToast({ kind: 'info', message: 'Amend ingediend', detail: 'Skill schrijft nieuwe varianten.' })
        }
      }
    } catch (e) {
      setErr(e.message)
      if (optimisticHide && unmarkActioned) unmarkActioned(mail.mail_id)
      showToast({ kind: 'error', message: 'Netwerkfout', detail: e.message })
    }
    setBusy(null)
  }, [busy, mail.mail_id, mail.draft_variants, amendText, draftSubject, draftBody, targetFolder, variantIndex, markActioned, unmarkActioned])

  // markProcessed — voor mails die je al handmatig in Outlook hebt
  // afgehandeld. Verbergt zonder Outlook-actie (Outlook-sync is anders soms
  // traag waardoor verplaatste mails toch nog in 'Voor jou' verschijnen).
  const markProcessed = useCallback(async () => {
    if (busy) return
    setBusy('processed'); setErr(null)
    if (markActioned) markActioned(mail.mail_id)
    try {
      const { data, error } = await supabase.rpc('mark_mail_processed', {
        p_mail_id: mail.mail_id,
        p_reason: 'Al verwerkt in Outlook',
      })
      if (error) {
        setErr(error.message)
        if (unmarkActioned) unmarkActioned(mail.mail_id)
      } else if (data && data.ok === false) {
        setErr(data.reason || 'mislukt')
        if (unmarkActioned) unmarkActioned(mail.mail_id)
      }
    } catch (e) {
      setErr(e.message)
      if (unmarkActioned) unmarkActioned(mail.mail_id)
    }
    setBusy(null)
  }, [busy, mail.mail_id, markActioned, unmarkActioned])

  // Awaiting-dismiss — markeer thread als afgerond. Verbergt deze + alle
  // andere mails in dezelfde conversation_id uit de awaiting-poel.
  // Optimistic: markActioned meteen zodat de mail uit de lijst verdwijnt
  // zonder te wachten op de RPC-roundtrip + realtime refresh.
  const dismissAwaiting = useCallback(async (reason) => {
    if (busy) return
    if (!mail.conversation_id) {
      setErr('Geen conversation_id')
      return
    }
    setBusy('dismiss'); setErr(null)
    if (markActioned) markActioned(mail.mail_id)
    try {
      const { data, error } = await supabase.rpc('dismiss_awaiting', {
        p_conversation_id: mail.conversation_id,
        p_reason: reason || null,
      })
      if (error) {
        setErr(error.message)
        if (unmarkActioned) unmarkActioned(mail.mail_id)
      } else if (data && data.ok === false) {
        setErr(data.reason || 'mislukt')
        if (unmarkActioned) unmarkActioned(mail.mail_id)
      }
    } catch (e) {
      setErr(e.message)
      if (unmarkActioned) unmarkActioned(mail.mail_id)
    }
    setBusy(null)
  }, [busy, mail.conversation_id, mail.mail_id, markActioned, unmarkActioned])

  // Negeer met reden + leerregel. Wanneer Jelle zegt "type mail wil ik niet
  // meer zien", schrijven we een autodraft_ignore_rules-row zodat de skill
  // 'm volgende keer auto-skipt.
  const submitIgnoreWithRule = useCallback(async (opts) => {
    if (busy) return
    setBusy('ignore'); setErr(null)
    if (markActioned) markActioned(mail.mail_id)
    try {
      const { data, error } = await supabase.rpc('submit_ignore_with_rule', {
        p_mail_id: mail.mail_id,
        p_target_folder: targetFolder || null,
        p_pattern_type: opts.pattern_type,
        p_pattern_value: opts.pattern_value,
        p_reason: opts.reason || null,
        p_reason_kind: opts.reason_kind || 'unwanted',
      })
      if (error) {
        setErr(error.message)
        if (unmarkActioned) unmarkActioned(mail.mail_id)
      } else if (data && data.ok === false) {
        setErr(data.reason || 'mislukt')
        if (unmarkActioned) unmarkActioned(mail.mail_id)
      }
    } catch (e) {
      setErr(e.message)
      if (unmarkActioned) unmarkActioned(mail.mail_id)
    }
    setBusy(null)
  }, [busy, mail.mail_id, targetFolder, markActioned, unmarkActioned])

  // Flag-toggle — direct via set_mail_flag RPC (geen autodraft_decision-roundtrip).
  // Optimistic: lokale state via UI; DB updatet flag_status meteen in mail_messages,
  // realtime channel updates de prop op zijn beurt.
  const toggleFlag = useCallback(async () => {
    if (busy) return
    const newVal = !isFlagged
    setBusy(newVal ? 'flag' : 'unflag'); setErr(null)
    try {
      const { data, error } = await supabase.rpc('set_mail_flag', {
        p_mail_id: mail.mail_id, p_flag: newVal,
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }, [busy, mail.mail_id, isFlagged])

  const changeCategory = useCallback(async (newKey) => {
    setCategoryKey(newKey)
    try { await supabase.rpc('set_autodraft_mail_category', { p_mail_id: mail.mail_id, p_category_key: newKey }) } catch {}
  }, [mail.mail_id])

  async function resetToPending() {
    setBusy('reset'); setErr(null)
    try {
      const { data: rpcRes, error } = await supabase.rpc('reset_autodraft_mail_to_pending', { p_mail_id: mail.mail_id })
      if (error) setErr(error.message)
      else if (rpcRes && rpcRes.ok === false) setErr(rpcRes.reason || 'mislukt')
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }

  // Keyboard shortcuts (alleen als niet in input)
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

  // Defensief: jsonb-velden uit Postgres kunnen object i.p.v. string zijn,
  // direct renderen in JSX = React error #31 + silent crash. Wrap in safe()
  // zodat we zeker een string krijgen.
  const safe = (v) => {
    if (v == null) return ''
    if (typeof v === 'string' || typeof v === 'number') return String(v)
    try { return JSON.stringify(v) } catch { return '[unrenderable]' }
  }

  return (
    <div className="md-root">
      <div className="ad-detail__sticky">
        {mail.status === 'amended' && (
          <div className="ad-detail__amended-banner">
            ✎ Dit is een herschreven versie op basis van je vorige aanpassingsvoorstel.
          </div>
        )}
        {mail.status === 'queued_amend' && (
          <div style={{
            padding: '10px 14px', borderRadius: 6,
            background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
            border: '1px dashed color-mix(in srgb, var(--accent) 30%, var(--border))',
            color: 'var(--text)', fontSize: 13, lineHeight: 1.5,
          }}>
            <strong>✎ Skill schrijft draft opnieuw…</strong>
            {' '}<span style={{ color: 'var(--text-muted)' }}>
              Je feedback staat in de wachtrij. Volgende run (binnen 10 min) krijg je een nieuwe draft. Mail blijft hier zichtbaar tot het klaar is.
            </span>
          </div>
        )}
        {(mail.status === 'queued_send' || mail.status === 'queued_ignore' || mail.status === 'queued_spam') && (
          <div style={{
            padding: '10px 14px', borderRadius: 6,
            background: 'color-mix(in srgb, var(--text-muted) 6%, transparent)',
            border: '1px dashed var(--border)',
            color: 'var(--text-muted)', fontSize: 12.5,
            lineHeight: 1.5,
          }}>
            ⏳ <strong>Actie staat in de wachtrij.</strong>{' '}
            {mail.status === 'queued_send'
              ? <>Instant-trigger maakt de Outlook-draft normaal binnen seconden. Bij Composio-uitval valt 't terug op de lokale orchestrator (binnen 30 min). Daarna verschijnt de groene "concept geplaatst"-banner.</>
              : <>Skill verwerkt 'm bij de eerstvolgende run (binnen 30 min).</>}
          </div>
        )}

        <div className="ad-detail__head">
          <div className="ad-detail__head-text">
            <div className="ad-detail__head-meta">
              <strong>{safe(mail.from_name) || '—'}</strong>{' '}
              <span className="muted">&lt;{safe(mail.from_email) || '—'}&gt;</span>
              <span className="muted" style={{ marginLeft: 8 }}>· {formatDateTime(mail.received_at)}</span>
            </div>
            <div className="ad-detail__head-subject">{safe(mail.subject) || '(geen onderwerp)'}</div>
          </div>
          <div title={`Confidence: ${Math.round((mail.confidence || 0) * 100)}%`}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{
              width: 36, height: 36, borderRadius: '50%',
              display: 'grid', placeItems: 'center',
              border: `2px solid ${confTone(mail.confidence) === 'high' ? '#4ade80' : confTone(mail.confidence) === 'mid' ? 'var(--accent)' : 'var(--text-muted)'}`,
              color: confTone(mail.confidence) === 'high' ? '#4ade80' : confTone(mail.confidence) === 'mid' ? 'var(--accent)' : 'var(--text-muted)',
              fontWeight: 600, fontSize: 10,
            }}>
              {Math.round((mail.confidence || 0) * 100)}%
            </span>
          </div>
        </div>

        {/* Compacte header-strook: To/Cc/Bcc — alleen tonen als er iets is.
            Highlight waar jij staat zodat je in 1 oogopslag ziet of je primair
            of secondair geadresseerde bent. */}
        {(() => {
          const toStr = recipientsToString(mail.to_recipients)
          const ccStr = recipientsToString(mail.cc_recipients)
          const bccStr = recipientsToString(mail.bcc_recipients)
          const myPos = findMyPosition(mail.to_recipients, mail.cc_recipients, mail.bcc_recipients)
          if (!toStr && !ccStr && !bccStr) return null
          const rowStyle = { fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.45 }
          const labelStyle = { display: 'inline-block', minWidth: 32, fontWeight: 500 }
          const youBadge = (active) => active ? (
            <span style={{
              marginLeft: 4, padding: '0 5px', borderRadius: 3,
              fontSize: 10, fontWeight: 600,
              background: 'var(--accent-soft)', color: 'var(--accent)',
            }}>jij</span>
          ) : null
          return (
            <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {toStr && <div style={rowStyle}><span style={labelStyle}>Aan:</span> {toStr}{youBadge(myPos === 'to')}</div>}
              {ccStr && <div style={rowStyle}><span style={labelStyle}>Cc:</span> {ccStr}{youBadge(myPos === 'cc')}</div>}
              {bccStr && <div style={rowStyle}><span style={labelStyle}>Bcc:</span> {bccStr}{youBadge(myPos === 'bcc')}</div>}
            </div>
          )
        })()}

        {mail.suggested_reasoning && (
          <div className="ad-reasoning" style={{ marginTop: 6, fontSize: 11.5 }}>
            <span className="ad-reasoning__label">Skill denkt:</span>{' '}{safe(mail.suggested_reasoning)}
          </div>
        )}

        {mail.has_attachments && (
          <div className="ad-attachments-hint muted" style={{ marginTop: 6, fontSize: 11.5 }}>
            📎 Mail bevat bijlagen — niet zichtbaar in dashboard, open Outlook indien nodig.
          </div>
        )}

        {isAwaiting && (
          <div style={{
            padding: '8px 12px', borderRadius: 6, fontSize: 12.5,
            background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
            border: '1px dashed color-mix(in srgb, var(--accent) 30%, var(--border))',
            color: 'var(--text)',
          }}>
            ⏳ <strong>Wachtend op reactie sinds {mail.days_waiting} {mail.days_waiting === 1 ? 'dag' : 'dagen'}</strong>
            {' '}— jij hebt gemaild, er is nog geen antwoord binnen op deze thread.
          </div>
        )}

        {isSentDraft && (
          <div style={{
            padding: '8px 12px', borderRadius: 6, fontSize: 12.5,
            background: 'color-mix(in srgb, var(--success, #22c55e) 10%, transparent)',
            border: '1px dashed color-mix(in srgb, var(--success, #22c55e) 30%, var(--border))',
            color: 'var(--text)',
          }}>
            📤 <strong>Draft geplaatst{mail.days_since_placed != null ? ` ${mail.days_since_placed === 0 ? 'vandaag' : `${mail.days_since_placed} ${mail.days_since_placed === 1 ? 'dag' : 'dagen'} geleden`}` : ''}</strong>
            {' '}— concept staat in Outlook. Klik daar op verzenden, dan verdwijnt 'ie automatisch hier.
          </div>
        )}

        {!isReadOnly && isSkipSuggested && (
          <div className="ad-detail__skip-banner">
            <span>🗂️ Skill stelt voor: <strong>negeren en archiveren</strong>.</span>
            <button type="button" onClick={() => setCollapsed(v => !v)}
              style={{ fontSize: 11, padding: '2px 8px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', color: 'var(--text)' }}>
              {collapsed ? 'toch draft tonen' : 'weer inklappen'}
            </button>
          </div>
        )}

        {/* OUTLOOK-TOOLBAR — Outlook-stijl ribbon met iconen + labels.
            Voor awaiting/sent-drafts wordt 'ie verborgen (read-only mode). */}
        {!isReadOnly && <div className="ad-detail__actions">
          <ToolbarBtn
            icon="📧"
            label={busy === 'send' ? 'Bezig…' : 'Plaats concept'}
            primary
            disabled={!!busy || collapsed || !draftBody.trim()}
            onClick={() => submit('send')}
            title="Maakt een concept-reply in Outlook. Jij klikt zelf send."
          />
          <IgnoreDropdownBtn
            mail={mail}
            busy={busy}
            onIgnore={() => submit('ignore')}
            onIgnoreWithRule={submitIgnoreWithRule}
            onMarkProcessed={markProcessed}
          />
          <ToolbarBtn
            icon="✎"
            label="Aanpassen"
            active={mode === 'amend'}
            disabled={!!busy}
            onClick={() => setMode(m => m === 'amend' ? null : 'amend')}
          />
          <ToolbarBtn
            icon="✨"
            label="Spelcheck"
            active={spelcheckOpen}
            disabled={!!busy || !draftBody.trim()}
            onClick={() => setSpelcheckOpen(v => !v)}
            title="AI checkt op spel- en typefouten — desgewenst met extra voorkeur voor deze keer."
          />
          <ToolbarBtn
            icon="⛔"
            label={busy === 'spam' ? 'Markeren…' : 'Spam'}
            danger
            disabled={!!busy}
            onClick={() => submit('spam')}
            title="Verplaats naar Junk Email + leer Outlook spam-afzender."
          />
          <span className="ot-sep" />
          <QuickActionsToolbarBtn
            mail={mail}
            submit={submit}
            busy={busy}
            disabled={!!busy}
            onAddPreference={() => setPrefModalOpen(true)}
          />
          {(mail.status !== 'pending') && (
            <ToolbarBtn icon="↺" label="Reset" disabled={!!busy} onClick={resetToPending} />
          )}
          {err && <span style={{ color: 'var(--error)', fontSize: 12, marginLeft: 8, alignSelf: 'center' }}>⚠ {err}</span>}

          {/* Meta-chips rechts uitgelijnd */}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            <MetaChips
              cat={cat}
              categoryKey={categoryKey}
              changeCategory={changeCategory}
              categories={categories}
              targetFolder={targetFolder}
              setTargetFolder={setTargetFolder}
              folderOptions={folderOptions}
              folderTree={folderTree}
              busy={busy}
            />
          </div>
        </div>}

        {/* Voor awaiting: Afgerond + Regel-met-reden + Follow-up-uitklap */}
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
        {/* Voor sent-drafts: alleen categorie-chip rechts */}
        {isSentDraft && cat && (
          <div className="ad-detail__actions" style={{ alignItems: 'center', justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
              <span style={{
                display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                background: cat.color || 'var(--text-muted)', marginRight: 6, verticalAlign: 'middle',
              }} />
              {cat.label}
            </span>
            {err && <span style={{ color: 'var(--error)', fontSize: 12, marginLeft: 8 }}>⚠ {err}</span>}
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

        {!isReadOnly && mode === 'amend' && (
          <div className="ad-detail__amend">
            <label style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Wat moet anders? De skill herschrijft op basis van je correctie.
            </label>
            <textarea value={amendText} onChange={e => setAmendText(e.target.value)} disabled={!!busy}
              rows={3}
              placeholder={'bv. "Korter en informeler", "Stel concrete datum voor", "Niet over prijs beginnen"…'}
              autoFocus
              style={{
                width: '100%', padding: '10px 12px', border: '1px solid var(--border)',
                borderRadius: 6, background: 'var(--bg)', color: 'var(--text)',
                fontFamily: 'inherit', fontSize: 13, lineHeight: 1.55, resize: 'vertical',
              }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <ActionBtn label={busy === 'amend' ? 'Indienen…' : 'Stuur naar skill'}
                variant="primary" disabled={!!busy || !amendText.trim()} onClick={() => submit('amend')} />
              <ActionBtn label="Annuleer" variant="ghost"
                onClick={() => { setMode(null); setAmendText('') }} disabled={!!busy} />
            </div>
          </div>
        )}
      </div>

      {/* F.4.c — agenda-check op draft-datums */}
      <AgendaCheckBadge result={mail.agenda_check_result} />

      {/* F.2.c — uitstaande datumvoorstellen voor deze conversation_id */}
      <DateReservations conversationId={mail.conversation_id} />

      {/* THREAD — draft + chain in één doorlopend leesblok. Eén border, geen
          gap, dunne dividers tussen items. Voelt als één lange Outlook-thread. */}
      <div className="mc-thread">
        {!collapsed && (
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
          />
        )}
        <OutlookChain
          currentMail={mail}
          currentBody={{ body_html: effHtml, body_text: effText, body_preview: effPreview, body_truncated: effTruncated }}
          allMails={allMails}
          mailMessages={mailMessages}
        />
      </div>

      {/* CROSS-THREAD HISTORIE — eerder van deze afzender, andere conversaties */}
      <SenderHistory mail={mail} allMails={allMails} />

      {/* ACTIVITEIT-LOG — wat is er met deze mail gedaan? Cruciaal als Jelle
          ooit volledig overstapt: hij moet kunnen zien dat de skill een mail
          niet per ongeluk weggegooid heeft. Toont alle decisions chronologisch. */}
      <ActivityLog mail={mail} decisions={decisions} categories={categories} />
    </div>
  )
}

// MetaChips — compacte chips voor categorie + doelmap. Klik = popover.
// Folder-popover toont een mappenboom met indents (Outlook-stijl) ipv
// flat datalist; folderTree wordt opgebouwd in MailDetail.
function MetaChips({ cat, categoryKey, changeCategory, categories, targetFolder, setTargetFolder, folderOptions, folderTree, busy }) {
  const [openCat, setOpenCat] = useState(false)
  const [openFolder, setOpenFolder] = useState(false)
  const [folderQuery, setFolderQuery] = useState('')
  const catRef = useRef(null)
  const folderRef = useRef(null)

  useEffect(() => {
    function onDocClick(e) {
      if (catRef.current && !catRef.current.contains(e.target)) setOpenCat(false)
      if (folderRef.current && !folderRef.current.contains(e.target)) setOpenFolder(false)
    }
    if (openCat || openFolder) {
      document.addEventListener('mousedown', onDocClick)
      return () => document.removeEventListener('mousedown', onDocClick)
    }
  }, [openCat, openFolder])

  const chipBtn = (active) => ({
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '3px 10px', borderRadius: 999,
    border: '1px solid var(--border)',
    background: active ? 'var(--accent-soft)' : 'var(--bg)',
    color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 11.5, lineHeight: 1.4,
  })
  const popover = {
    position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 6,
    background: 'var(--surface-1)', border: '1px solid var(--border)',
    borderRadius: 8, padding: 6, minWidth: 220,
    boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
  }

  return (
    <div className="mc-meta-chips" style={{
      display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
    }}>
      <div ref={catRef} style={{ position: 'relative' }}>
        <button type="button" disabled={!!busy}
          onClick={() => setOpenCat(v => !v)}
          style={chipBtn(openCat)}
          title={cat?.handling_instructions || 'Categorie wijzigen'}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: cat?.color || 'var(--text-muted)',
          }} />
          <span>{cat?.label || '— ongecategoriseerd —'}</span>
          <span style={{ opacity: 0.6, fontSize: 9 }}>▾</span>
        </button>
        {openCat && (
          <div style={popover}>
            <button type="button"
              onClick={() => { changeCategory(''); setOpenCat(false) }}
              style={popoverItemStyle(categoryKey === '')}>
              — niet gecategoriseerd —
            </button>
            {categories.filter(c => c.active !== false).map(c => (
              <button key={c.category_key} type="button"
                onClick={() => { changeCategory(c.category_key); setOpenCat(false) }}
                style={popoverItemStyle(c.category_key === categoryKey)}>
                <span style={{
                  display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                  background: c.color || 'var(--text-muted)', marginRight: 8,
                }} />
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={folderRef} style={{ position: 'relative' }}>
        <button type="button" disabled={!!busy}
          onClick={() => setOpenFolder(v => !v)}
          style={chipBtn(openFolder)}
          title="Doelmap na verwerken">
          <span aria-hidden>📁</span>
          <span>{targetFolder || cat?.default_target_folder || '— map kiezen —'}</span>
          <span style={{ opacity: 0.6, fontSize: 9 }}>▾</span>
        </button>
        {openFolder && (
          <div style={{ ...popover, minWidth: 320, padding: 8 }}>
            <input type="text" value={folderQuery} onChange={e => setFolderQuery(e.target.value)}
              autoFocus
              placeholder="Zoek map…"
              style={{
                width: '100%', padding: '6px 8px', border: '1px solid var(--border)',
                borderRadius: 4, background: 'var(--bg)', color: 'var(--text)',
                fontFamily: 'inherit', fontSize: 12, marginBottom: 6,
              }} />
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              {(!folderTree || folderTree.length === 0) && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 8px' }}>
                  Geen mappen gesynct.
                </div>
              )}
              {(folderTree || [])
                .filter(f => !folderQuery || f.path.toLowerCase().includes(folderQuery.toLowerCase()))
                .slice(0, 100)
                .map(f => (
                  <button key={f.path} type="button"
                    onClick={() => { setTargetFolder(f.path); setOpenFolder(false); setFolderQuery('') }}
                    style={{
                      ...popoverItemStyle(f.path === targetFolder),
                      paddingLeft: 8 + f.depth * 14,
                    }}
                    title={f.path}>
                    <span style={{ opacity: f.depth > 0 ? 0.55 : 1, marginRight: 6 }}>
                      {f.depth === 0 ? '📂' : '📁'}
                    </span>
                    {f.name}
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>

      {cat?.handling_instructions && (
        <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}
          title={cat.handling_instructions}>ℹ</span>
      )}
    </div>
  )
}

// Toont elke recipient als pill met × om te verwijderen; chips wrappen op
// nieuwe regel zodat 2+ adressen ruim passen. Autocomplete via search_contacts
// RPC op de actieve edit-buffer (debounced 200ms).
//
// Backwards compatible: props-signature ongewijzigd (`value` blijft een
// comma-separated string die parent zelf opslaat in DB).
function ContactInput({ value, onChange, disabled, placeholder, style }) {
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [highlightIdx, setHighlightIdx] = useState(0)
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)

  const tokens = parseRecipientTokens(value)

  function commitDraft(text) {
    const t = (text ?? draft).trim().replace(/^[,;\s]+|[,;\s]+$/g, '')
    if (!t) return
    const newTokens = [...tokens, t]
    onChange(newTokens.join(', '))
    setDraft('')
  }

  function removeToken(idx) {
    const newTokens = tokens.filter((_, i) => i !== idx)
    onChange(newTokens.join(', '))
    inputRef.current?.focus()
  }

  function pickContact(c) {
    const formatted = c.display_name && c.display_name !== c.email
      ? `${c.display_name} <${c.email}>`
      : c.email
    commitDraft(formatted)
    setOpen(false)
    setSuggestions([])
    inputRef.current?.focus()
  }

  // Debounced search op de edit-buffer (niet meer op de hele value)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!draft || draft.trim().length < 2) {
      setSuggestions([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const { data } = await supabase.rpc('search_contacts', { p_query: draft.trim(), p_limit: 8 })
        setSuggestions(Array.isArray(data) ? data : [])
        setHighlightIdx(0)
      } catch { setSuggestions([]) }
    }, 200)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [draft])

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    if (open) {
      document.addEventListener('mousedown', onDocClick)
      return () => document.removeEventListener('mousedown', onDocClick)
    }
  }, [open])

  function onKeyDown(e) {
    // Backspace op lege buffer → laatste chip verwijderen
    if (e.key === 'Backspace' && !draft && tokens.length > 0) {
      e.preventDefault()
      onChange(tokens.slice(0, -1).join(', '))
      return
    }
    // Suggestie kiezen heeft prio bij Enter/Tab
    if ((e.key === 'Enter' || e.key === 'Tab') && open && suggestions.length > 0) {
      const c = suggestions[highlightIdx]
      if (c) { e.preventDefault(); pickContact(c); return }
    }
    // Komma / puntkomma / Enter / Tab op niet-lege buffer → commit als ruwe text
    if ((e.key === ',' || e.key === ';' || e.key === 'Enter' || e.key === 'Tab') && draft.trim()) {
      e.preventDefault()
      commitDraft()
      return
    }
    if (open && suggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx(i => Math.min(i + 1, suggestions.length - 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIdx(i => Math.max(i - 1, 0)) }
      else if (e.key === 'Escape') { setOpen(false) }
    }
  }

  function onBlurInput() {
    // Geef suggestion-mousedown voorrang; commit alleen als gebruiker écht weg is
    setTimeout(() => {
      if (draft.trim()) commitDraft()
    }, 120)
  }

  return (
    <div ref={wrapRef} style={{
      flex: 1, position: 'relative',
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4,
      minHeight: 22, paddingTop: 2, paddingBottom: 2,
    }}>
      {tokens.map((t, idx) => (
        <span key={`${t}-${idx}`} title={t} style={{
          display: 'inline-flex', alignItems: 'center', gap: 2,
          padding: '1px 4px 1px 8px', borderRadius: 12,
          background: 'var(--accent-soft)', color: 'var(--text)',
          fontSize: 12, lineHeight: 1.45, maxWidth: '100%',
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
            {chipLabel(t)}
          </span>
          {!disabled && (
            <button type="button" onClick={() => removeToken(idx)} aria-label="Verwijder ontvanger" style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: 'var(--text-muted)', padding: '0 2px', fontFamily: 'inherit',
              fontSize: 13, lineHeight: 1,
            }}>×</button>
          )}
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={e => { setDraft(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={onBlurInput}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder={tokens.length === 0 ? placeholder : ''}
        style={{
          ...style,
          flex: '1 1 80px',
          minWidth: 80,
          width: 'auto',
        }}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 2px)', left: 0,
          minWidth: 320, maxWidth: 480, zIndex: 10,
          background: 'var(--surface-1)', border: '1px solid var(--border)',
          borderRadius: 6, padding: 4,
          boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
          maxHeight: 280, overflowY: 'auto',
        }}>
          {suggestions.map((c, idx) => (
            <button key={c.email} type="button"
              onMouseDown={e => { e.preventDefault(); pickContact(c) }}
              onMouseEnter={() => setHighlightIdx(idx)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '6px 8px', borderRadius: 4,
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                background: idx === highlightIdx ? 'var(--accent-soft)' : 'transparent',
                color: 'var(--text)', textAlign: 'left',
              }}>
              <span style={{
                width: 24, height: 24, borderRadius: '50%',
                background: c.source === 'hubspot' ? 'var(--accent-soft)' : 'color-mix(in srgb, var(--text-muted) 15%, transparent)',
                color: c.source === 'hubspot' ? 'var(--accent)' : 'var(--text-muted)',
                display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600,
                flexShrink: 0,
              }}>
                {(c.display_name || c.email).slice(0, 1).toUpperCase()}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.display_name || c.email}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.email}{c.company ? ` · ${c.company}` : ''}
                </div>
              </span>
              {c.source === 'hubspot' && (
                <span style={{ fontSize: 10, color: 'var(--accent)', flexShrink: 0 }}>HubSpot</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// DraftEditor — inline compose-blok, geen eigen border. Wordt wrapped in
// `.md-thread` zodat draft + chain als één doorlopend leesblok voelen.
// className-prefix `mc-` om CSS-cache-stickyness van oude selectoren te vermijden.
function DraftEditor({
  mail, draftTo, setDraftTo, draftCc, setDraftCc,
  draftSubject, setDraftSubject, draftBody, setDraftBody,
  busy, activeLessons,
  variantIndex, setVariantIndex,
}) {
  const variants = Array.isArray(mail.draft_variants) ? mail.draft_variants : []
  const hasVariants = variants.length > 1
  const [ccOpen, setCcOpen] = useState(() => !!(draftCc && draftCc.trim()))

  useEffect(() => {
    setCcOpen(!!(draftCc && draftCc.trim()))
  }, [mail.mail_id])

  async function switchVariant(newIndex) {
    if (newIndex === variantIndex) return
    if (newIndex < 0 || newIndex >= variants.length) return
    const v = variants[newIndex]
    setVariantIndex(newIndex)
    setDraftSubject(v?.subject || '')
    setDraftBody(v?.body || '')
    try {
      await supabase.rpc('set_autodraft_variant', {
        p_mail_id: mail.mail_id,
        p_variant_index: newIndex,
      })
    } catch (e) { /* best-effort, UI is al bijgewerkt */ }
  }

  const activeVariant = variants[variantIndex]
  const fieldRow = {
    display: 'flex', alignItems: 'flex-start', gap: 8,
    borderBottom: '1px solid var(--border)', padding: '6px 16px',
    minHeight: 30,
  }
  const labelStyle = {
    width: 64, color: 'var(--text-muted)', fontSize: 11.5, flexShrink: 0,
    fontWeight: 500,
  }
  const inputStyle = {
    flex: 1, border: 'none', outline: 'none', background: 'transparent',
    color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, padding: 0,
  }

  return (
    <div className="mc-compose">
      {hasVariants && (
        <div className="mc-variants" style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 16px', borderBottom: '1px solid var(--border)',
          background: 'color-mix(in srgb, var(--accent) 4%, var(--bg))',
          fontSize: 11, color: 'var(--text-muted)',
        }}>
          {/* F.5.a — vaste breedte op label-pill zodat pijltjes niet meer
              verschuiven bij wisselen tussen varianten met verschillende
              labellengtes ("Kort & direct" vs "Afgerond initiatief nemen"). */}
          <ArrowBtn dir="left" disabled={variantIndex <= 0} onClick={() => switchVariant(variantIndex - 1)} />
          <span style={{
            fontSize: 11, color: 'var(--text)',
            padding: '2px 10px', borderRadius: 999,
            background: 'var(--accent-soft)',
            fontWeight: 500, textAlign: 'center',
            width: 240, flexShrink: 0,
            display: 'inline-block',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
          title={activeVariant?.label || `Variant ${variantIndex + 1}`}>
            {activeVariant?.label || `Variant ${variantIndex + 1}`}
            {' '}<span style={{ color: 'var(--text-muted)' }}>· {variantIndex + 1}/{variants.length}</span>
          </span>
          <ArrowBtn dir="right" disabled={variantIndex >= variants.length - 1} onClick={() => switchVariant(variantIndex + 1)} />
          {activeLessons.length > 0 && (
            <span style={{ marginLeft: 'auto', fontSize: 11 }}>
              {activeLessons.length} {activeLessons.length === 1 ? 'regel' : 'regels'} toegepast
            </span>
          )}
        </div>
      )}

      <div style={fieldRow}>
        <span style={labelStyle}>Aan</span>
        <ContactInput value={draftTo} onChange={setDraftTo}
          disabled={!!busy} placeholder={mail.from_email || 'ontvanger@…'}
          style={inputStyle} />
        {!ccOpen && (
          <button type="button" onClick={() => setCcOpen(true)}
            style={{
              border: 'none', background: 'transparent',
              color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer',
              padding: '2px 6px', fontFamily: 'inherit',
            }}>+ Cc</button>
        )}
      </div>

      {ccOpen && (
        <div style={fieldRow}>
          <span style={labelStyle}>Cc</span>
          <ContactInput value={draftCc} onChange={setDraftCc}
            disabled={!!busy} placeholder="cc@…"
            style={inputStyle} />
          <button type="button" onClick={() => { setDraftCc(''); setCcOpen(false) }}
            style={{
              border: 'none', background: 'transparent',
              color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer',
              padding: '2px 6px', fontFamily: 'inherit',
            }}>×</button>
        </div>
      )}

      <div style={fieldRow}>
        <span style={labelStyle}>Onderwerp</span>
        <input type="text" value={draftSubject} onChange={e => setDraftSubject(e.target.value)}
          disabled={!!busy} placeholder="Onderwerp"
          style={{ ...inputStyle, fontWeight: 600 }} />
      </div>

      <textarea value={draftBody} onChange={e => setDraftBody(e.target.value)} disabled={!!busy}
        rows={Math.max(10, Math.min(24, (draftBody.split('\n').length || 1) + 2))}
        placeholder="Skill heeft nog geen draft gemaakt — typ zelf je antwoord."
        style={{
          width: '100%', padding: '14px 16px',
          border: 'none', outline: 'none',
          background: 'transparent', color: 'var(--text)',
          fontFamily: 'inherit', fontSize: 13.5, lineHeight: 1.6,
          resize: 'vertical', minHeight: 200,
          display: 'block',
        }} />
    </div>
  )
}

// AwaitingActions — actie-rij voor In Afwachting mails:
//  - ✓ Afgerond (optimistic, dismiss conversation_id)
//  - 🚫 Regel (opent ReasonModal: subject_keyword pattern + reden, dismiss + leerregel)
//  - ✎ Schrijf follow-up (uitklapbaar, generates template, mailto-link)
function AwaitingActions({ mail, cat, busy, err, dismissAwaiting, submitIgnoreWithRule, reminderStyle }) {
  const [reasonModal, setReasonModal] = useState(null)
  const [showFollowup, setShowFollowup] = useState(false)
  const [variantIdx, setVariantIdx] = useState(0)
  const [followupText, setFollowupText] = useState('')

  // 2 follow-up varianten: kort & direct vs warm & uitgebreid. Geen em-dashes
  // (komt te AI-achtig over). Variatie in begroeting per mail-id zodat het
  // niet altijd 'Hoi' is. Optionele reminderStyle-richtlijn uit Instellingen
  // toegevoegd als hint, maar template blijft hard-coded zodat Jelle weet
  // wat-ie krijgt.
  const variants = useMemo(() => {
    // 2026-05-07 — voor awaiting-mails is `mail.from_name` op 'aan <recipients>'
    // gezet (zie awaitingMails-builder), waardoor firstName 'aan' werd en de
    // opener "Hé aan," produceerde. Pak de echte recipient uit to_recipients.
    function firstRecipient(toRecip) {
      if (!toRecip) return ''
      const arr = Array.isArray(toRecip) ? toRecip : [toRecip]
      for (const x of arr) {
        if (typeof x === 'string') return x
        if (x?.name) return x.name
        if (x?.email) return x.email
        if (x?.address) return x.address
      }
      return ''
    }
    const stripAanPrefix = (s) => String(s || '').replace(/^aan\s+/i, '').trim()
    const recipientRaw = mail.__awaiting
      ? (firstRecipient(mail.to_recipients) || stripAanPrefix(mail.from_name) || (mail.from_email || '').split('@')[0] || '')
      : (mail.from_name || (mail.from_email || '').split('@')[0] || '')
    const recipientLabel = recipientRaw.includes('@')
      ? recipientRaw.split('@')[0].replace(/[._-]+/g, ' ')
      : recipientRaw
    const firstName = (recipientLabel.split(/[\s,]+/)[0] || recipientLabel || '').trim()
    const days = mail.days_waiting || 0
    const subj = (mail.subject || '').replace(/^(re|fw|fwd):\s*/i, '')
    const ago = days === 0 ? 'recent' : days === 1 ? 'gisteren' : `${days} dagen geleden`
    // Begroeting variatie op basis van mail_id zodat 'ie consistent maar niet
    // statisch is. 4 stijlen waar 'Hoi' niet altijd in zit.
    const greetings = ['Hi', 'Hé', 'Hallo', firstName ? `Beste ${firstName}` : 'Beste']
    const hashIdx = (mail.mail_id || '').split('').reduce((a, c) => (a + c.charCodeAt(0)) % greetings.length, 0)
    const greet = greetings[hashIdx]
    const opener = greet.startsWith('Beste') ? `${greet},` : `${greet}${firstName && !greet.includes(firstName) ? ' ' + firstName : ''},`
    return [
      {
        label: 'Kort en direct',
        body:
`${opener}

Even een korte reminder. Ik mailde je ${ago}${subj ? ` over "${subj}"` : ''} en heb nog geen reactie ontvangen. Lukt het om er deze week naar te kijken?

Groet,
Jelle`,
      },
      {
        label: 'Warm en uitgebreid',
        body:
`${opener}

Geen druk hoor, maar ik wilde even checken of mijn mail van ${ago}${subj ? ` over "${subj}"` : ''} bij je is binnengekomen. Soms verdwijnt zoiets in de drukte. Mocht je er nog naar willen kijken, dan hoor ik graag van je. Geen reactie nodig als het nog even duurt, dan stuur ik later opnieuw een reminder.

Vriendelijke groet,
Jelle`,
      },
    ]
  }, [mail])

  // Initial: variant 0
  useEffect(() => {
    if (showFollowup && !followupText) {
      setFollowupText(variants[variantIdx].body)
    }
  }, [showFollowup, followupText, variants, variantIdx])

  function switchVariant(newIdx) {
    if (newIdx < 0 || newIdx >= variants.length) return
    setVariantIdx(newIdx)
    setFollowupText(variants[newIdx].body)
  }

  const mailtoHref = useMemo(() => {
    const to = mail.to_recipients
      ? recipientsToString(mail.to_recipients).replace(/\s\+\d+\s\w+$/, '')
      : ''
    const subj = mail.subject ? `RE: ${mail.subject.replace(/^(re|fw|fwd):\s*/i, '')}` : ''
    const params = new URLSearchParams()
    if (subj) params.set('subject', subj)
    if (followupText) params.set('body', followupText)
    return `mailto:${encodeURIComponent(to)}?${params.toString()}`
  }, [mail, followupText])

  return (
    <>
      <div className="ad-detail__actions" style={{ alignItems: 'center' }}>
        <ToolbarBtn
          icon="✓"
          label={busy === 'dismiss' ? 'Afronden…' : 'Afgerond'}
          primary
          disabled={!!busy}
          onClick={() => dismissAwaiting()}
          title="Markeer als afgerond — thread verdwijnt uit In Afwachting."
        />
        <ToolbarBtn
          icon="🚫"
          label="Regel"
          disabled={!!busy}
          onClick={() => setReasonModal({
            pattern_type: 'subject_keyword',
            pattern_value: '',
            reason_kind: 'unwanted',
            prompt: 'Waarom rond je deze af zónder antwoord? Optioneel een leerregel maken zodat soortgelijke mails niet meer in In Afwachting komen.',
            askPattern: true,
            forAwaiting: true,
          })}
          title="Voeg leerregel toe + markeer afgerond"
        />
        <ToolbarBtn
          icon="✎"
          label={showFollowup ? 'Verberg follow-up' : 'Schrijf follow-up'}
          active={showFollowup}
          disabled={!!busy}
          onClick={() => setShowFollowup(v => !v)}
          title="Genereer een korte herinneringsmail."
        />
        {err && <span style={{ color: 'var(--error)', fontSize: 12, marginLeft: 8, alignSelf: 'center' }}>⚠ {err}</span>}
        {cat && (
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-muted)' }}>
            <span style={{
              display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
              background: cat.color || 'var(--text-muted)', marginRight: 6, verticalAlign: 'middle',
            }} />
            {cat.label}
          </span>
        )}
      </div>

      {showFollowup && (
        <div style={{
          marginTop: 10, padding: '10px 12px',
          border: '1px solid var(--border)', borderRadius: 6,
          background: '#F8FBFF',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Follow-up
            </span>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <ArrowBtn dir="left" disabled={variantIdx <= 0} onClick={() => switchVariant(variantIdx - 1)} />
              <span style={{
                fontSize: 11, padding: '2px 10px', borderRadius: 999,
                background: 'var(--accent-soft)', color: 'var(--text)',
                fontWeight: 500, minWidth: 130, textAlign: 'center',
              }}>
                {variants[variantIdx].label}
                {' '}<span style={{ color: 'var(--text-muted)' }}>· {variantIdx + 1}/{variants.length}</span>
              </span>
              <ArrowBtn dir="right" disabled={variantIdx >= variants.length - 1} onClick={() => switchVariant(variantIdx + 1)} />
            </div>
          </div>
          {reminderStyle && (
            <div style={{
              fontSize: 11, color: 'var(--text-muted)',
              marginBottom: 8, padding: '6px 10px',
              background: 'color-mix(in srgb, var(--accent) 5%, transparent)',
              border: '1px dashed var(--border)', borderRadius: 4,
              lineHeight: 1.4,
            }}>
              💡 Jouw reminder-stijl: {reminderStyle}
            </div>
          )}
          <textarea value={followupText} onChange={e => setFollowupText(e.target.value)}
            rows={Math.max(8, followupText.split('\n').length + 1)}
            style={{
              width: '100%', padding: '10px 12px',
              border: '1px solid var(--border)', borderRadius: 6,
              background: 'var(--bg)', color: 'var(--text)',
              fontFamily: 'inherit', fontSize: 13, lineHeight: 1.55, resize: 'vertical',
            }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
            <a href={mailtoHref}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 4,
                border: '1px solid var(--accent)',
                background: 'var(--accent)', color: '#fff',
                fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600,
                textDecoration: 'none',
              }}>
              📧 Open in Outlook
            </a>
            <button type="button"
              onClick={async () => {
                try { await navigator.clipboard.writeText(followupText) } catch {}
              }}
              style={{
                padding: '6px 14px', borderRadius: 4,
                border: '1px solid var(--border)',
                background: 'var(--bg)', color: 'var(--text)',
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5,
              }}>
              📋 Kopieer
            </button>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Mail blijft in In Afwachting tot er een reactie binnenkomt.
            </span>
          </div>
        </div>
      )}

      {reasonModal && (
        <ReasonModal
          opts={reasonModal}
          onCancel={() => setReasonModal(null)}
          onConfirm={async (extra) => {
            const payload = reasonModal
            setReasonModal(null)
            if (payload.forAwaiting) {
              if (extra.pattern && extra.pattern.length >= 2) {
                try {
                  await supabase.rpc('add_ignore_rule', {
                    p_mail_id: mail.mail_id,
                    p_pattern_type: payload.pattern_type,
                    p_pattern_value: extra.pattern,
                    p_reason: extra.text || null,
                    p_reason_kind: payload.reason_kind,
                  })
                } catch {}
              }
              await dismissAwaiting(extra.text)
            } else {
              await submitIgnoreWithRule({
                pattern_type: payload.pattern_type,
                pattern_value: extra.pattern || payload.pattern_value,
                reason_kind: payload.reason_kind,
                reason: extra.text,
              })
            }
          }}
        />
      )}
    </>
  )
}

// Afhandelen-knop: enkele knop die een dropdown opent met 3 opties (zelfde
// patroon als Snel-knop). Geen split-button meer — gebruiker had moeite met
// het kleine pijltje. Klik = dropdown open. Opties:
//   1. 📂 Afhandelen (= directe ignore zonder leerregel)
//   2. ✏ Afhandelen + eigen leerregel
//   3. 👥 Afgehandeld door collega
