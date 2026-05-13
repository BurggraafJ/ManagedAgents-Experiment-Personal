import { useState, useEffect, useRef, useMemo, useCallback, Component } from 'react'
import { supabase } from '../../../../lib/supabase'
import { showToast } from '../../../Toast'
import styles from '../autodraft.module.css'
import { findMyPosition, recipientsToString, formatDateTime, confTone } from '../../../../lib/autodraft'
import PreferenceQuickModal from '../modals/PreferenceQuickModal'
import SpelcheckPopover from '../modals/SpelcheckPopover'
import ToolbarBtn from './ToolbarBtn'
import IgnoreDropdownBtn from './IgnoreDropdownBtn'
import QuickActionsToolbarBtn from './QuickActionsToolbarBtn'
import MetaChips from './MetaChips'
import AwaitingActions from './AwaitingActions'
import AgendaCheckBadge from './AgendaCheckBadge'
import DateReservations from './DateReservations'
import DraftEditor from './DraftEditor'
import OutlookChain, { SenderHistory } from './OutlookChain'
import ActivityLog from './ActivityLog'
import ActionBtn from './ActionBtn'
import RagDetailsModal from '../../../RagDetailsModal'
import Modal from '../../../ui/Modal'

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
      <div className={styles.detailErrorWrap}>
        <strong className={styles.detailErrorTitle}>⚠ MailDetail crashed:</strong>
        <pre className={styles.detailErrorPre}>
          {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
          {this.state.info?.componentStack && '\n\n' + this.state.info.componentStack}
        </pre>
        <button type="button" className={styles.detailErrorBtn}
          onClick={() => this.setState({ error: null, info: null })}>
          Probeer opnieuw
        </button>
      </div>
    )
  }
}

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
  // V8 (2026-05-12): RAG-modal state. Voorheen zat de klik-trigger op de
  // RagBadge in MailRow links. Jelle wil 'm rechts op de percentage-circle.
  // mail.id (uuid) is de record_id voor record_type='autodraft_mail'.
  const [ragModalOpen, setRagModalOpen] = useState(false)
  // V8.9 (2026-05-13): 3-puntjes menu naast percentage met opties Tijdlijn
  // (= SenderHistory, cross-thread historie) en Houden (= ActivityLog, wat
  // skill met deze mail deed). Vervangt de twee inline-secties onderin de
  // detail-pane zodat de hoofdview compacter wordt — popups op aanvraag.
  const [headDotsOpen, setHeadDotsOpen] = useState(false)
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [keepOpen, setKeepOpen] = useState(false)
  const headDotsRef = useRef(null)
  useEffect(() => {
    if (!headDotsOpen) return
    function onDocClick(e) {
      if (headDotsRef.current && !headDotsRef.current.contains(e.target)) setHeadDotsOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [headDotsOpen])

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

  // V8.2 (2026-05-13): AIPromptBar (Maestro) emit `mcm-open-spelcheck`
  // CustomEvent wanneer Jelle daar op Spelcheck-chip klikt. We luisteren
  // hier en openen de bestaande SpelcheckPopover. Custom-event-bridge
  // ipv prop-drilling / context-action zodat de Spelcheck-state binnen
  // MailDetail blijft (waar hij hoort — heeft draftBody nodig).
  useEffect(() => {
    function onOpen() {
      if (busy || !draftBody.trim()) return
      setSpelcheckOpen(true)
    }
    window.addEventListener('mcm-open-spelcheck', onOpen)
    return () => window.removeEventListener('mcm-open-spelcheck', onOpen)
  }, [busy, draftBody])

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
          <div className={styles.detailQueuedAmend}>
            <strong>✎ Skill schrijft draft opnieuw…</strong>
            {' '}<span className={styles.detailQueuedAmendNote}>
              Je feedback staat in de wachtrij. Volgende run (binnen 10 min) krijg je een nieuwe draft. Mail blijft hier zichtbaar tot het klaar is.
            </span>
          </div>
        )}
        {(mail.status === 'queued_send' || mail.status === 'queued_ignore' || mail.status === 'queued_spam') && (
          <div className={styles.detailQueuedAction}>
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
              <span className={`muted ${styles.detailHeadDate}`}>· {formatDateTime(mail.received_at)}</span>
            </div>
            <div className="ad-detail__head-subject">{safe(mail.subject) || '(geen onderwerp)'}</div>
          </div>
          {/* V8.1 (2026-05-12): percentage-circle blijft een <div> (voor de
              conic-gradient styling die op .detailConfWrap zit) maar krijgt
              een onClick + role=button. Voorheen had ik 'em naar <button>
              geconvert + inline background:transparent — dat killde de ring
              CSS. Nu zonder JSX-element-wijziging: klik werkt, ring blijft. */}
          <div
            role={mail.id ? 'button' : undefined}
            tabIndex={mail.id ? 0 : undefined}
            title={`Confidence: ${Math.round((mail.confidence || 0) * 100)}% — klik voor RAG-detail (inkomende chunks + uitgaand gebruik)`}
            className={styles.detailConfWrap}
            data-pct={Math.round((mail.confidence || 0) * 100)}
            data-tone={confTone(mail.confidence)}
            onClick={() => { if (mail.id) setRagModalOpen(true) }}
            onKeyDown={(e) => {
              if (mail.id && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                setRagModalOpen(true)
              }
            }}
            style={{ cursor: mail.id ? 'pointer' : 'default' }}
          >
            <span className={styles.detailConfCircle} style={{
              color: confTone(mail.confidence) === 'high' ? '#4ade80' : confTone(mail.confidence) === 'mid' ? 'var(--accent)' : 'var(--text-muted)',
            }}>
              {Math.round((mail.confidence || 0) * 100)}%
            </span>
          </div>
          {ragModalOpen && mail.id && (
            <RagDetailsModal
              recordType="autodraft_mail"
              recordId={mail.id}
              onClose={() => setRagModalOpen(false)}
            />
          )}
          {/* V8.9 (2026-05-13): 3-puntjes naast percentage. Twee opties:
              Tijdlijn (cross-thread historie van afzender) en Houden (wat de
              skill met deze mail heeft gedaan). Beide openen in modals. */}
          <span ref={headDotsRef} className="ad-detail__head-dots-wrap">
            <button
              type="button"
              className="ad-detail__head-dots"
              onClick={() => setHeadDotsOpen(v => !v)}
              title="Meer acties — tijdlijn & houden"
              aria-haspopup="menu"
              aria-expanded={headDotsOpen}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                <circle cx="5" cy="12" r="1.6"/>
                <circle cx="12" cy="12" r="1.6"/>
                <circle cx="19" cy="12" r="1.6"/>
              </svg>
            </button>
            {headDotsOpen && (
              <div className="ad-detail__head-dots-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="ad-detail__head-dots-item"
                  onClick={() => { setHeadDotsOpen(false); setTimelineOpen(true) }}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                  <span>Tijdlijn</span>
                  <span className="ad-detail__head-dots-sub">Eerder van deze afzender</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="ad-detail__head-dots-item"
                  onClick={() => { setHeadDotsOpen(false); setKeepOpen(true) }}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 3h18v18H3z"/>
                    <path d="M9 9h6v6H9z"/>
                  </svg>
                  <span>Houden</span>
                  <span className="ad-detail__head-dots-sub">Wat is er met deze mail gedaan</span>
                </button>
              </div>
            )}
          </span>
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
          const youBadge = (active) => active ? (
            <span className={styles.detailRecipientYou}>jij</span>
          ) : null
          return (
            <div className={styles.detailRecipientsBlock}>
              {toStr && <div className={styles.detailRecipientRow}><span className={styles.detailRecipientLabel}>Aan:</span> {toStr}{youBadge(myPos === 'to')}</div>}
              {ccStr && <div className={styles.detailRecipientRow}><span className={styles.detailRecipientLabel}>Cc:</span> {ccStr}{youBadge(myPos === 'cc')}</div>}
              {bccStr && <div className={styles.detailRecipientRow}><span className={styles.detailRecipientLabel}>Bcc:</span> {bccStr}{youBadge(myPos === 'bcc')}</div>}
            </div>
          )
        })()}

        {mail.suggested_reasoning && (
          <ReasoningCollapsible reasoning={safe(mail.suggested_reasoning)} />
        )}

        {mail.has_attachments && (
          <div className={`ad-attachments-hint muted ${styles.detailAttachmentTop}`}>
            📎 Mail bevat bijlagen — niet zichtbaar in dashboard, open Outlook indien nodig.
          </div>
        )}

        {isAwaiting && (
          <div className={styles.detailAwaitingBlock}>
            ⏳ <strong>Wachtend op reactie sinds {mail.days_waiting} {mail.days_waiting === 1 ? 'dag' : 'dagen'}</strong>
            {' '}— jij hebt gemaild, er is nog geen antwoord binnen op deze thread.
          </div>
        )}

        {isSentDraft && (
          <div className={styles.detailSentDraftBlock}>
            📤 <strong>Draft geplaatst{mail.days_since_placed != null ? ` ${mail.days_since_placed === 0 ? 'vandaag' : `${mail.days_since_placed} ${mail.days_since_placed === 1 ? 'dag' : 'dagen'} geleden`}` : ''}</strong>
            {' '}— concept staat in Outlook. Klik daar op verzenden, dan verdwijnt 'ie automatisch hier.
          </div>
        )}

        {!isReadOnly && isSkipSuggested && (
          <div className="ad-detail__skip-banner">
            <span>🗂️ Skill stelt voor: <strong>negeren en archiveren</strong>.</span>
            <button type="button" onClick={() => setCollapsed(v => !v)} className={styles.detailSkipToggleBtn}>
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
          {/* V8.3 (2026-05-13): Spelcheck-knop weg uit toolbar — al
              bereikbaar via Sparkle (✨ Maestro) rechtsonder de composer.
              AIPromptBar emit 'mcm-open-spelcheck' event; useEffect
              hierboven (regel ~378) opent de SpelcheckPopover. Voorkomt
              visueel-dubbele entry-points. */}
          {/* V8 (2026-05-12): aparte Spam-knop weg — verhuisd naar de
              QuickActionsToolbarBtn dropdown ("Snel ▾") zodat de toolbar
              compacter wordt. Functioneel onveranderd: submit('spam') wordt
              vanuit de dropdown aangeroepen. */}
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
          {err && <span className={styles.detailErrSpan}>⚠ {err}</span>}

          {/* Meta-chips rechts uitgelijnd */}
          <div className={styles.detailMetaChipsWrap}>
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

        {!isReadOnly && mode === 'amend' && (
          <div className="ad-detail__amend">
            <label className={styles.detailAmendLabel}>
              Wat moet anders? De skill herschrijft op basis van je correctie.
            </label>
            <textarea value={amendText} onChange={e => setAmendText(e.target.value)} disabled={!!busy}
              rows={3}
              placeholder={'bv. "Korter en informeler", "Stel concrete datum voor", "Niet over prijs beginnen"…'}
              autoFocus
              className={styles.detailAmendTextarea} />
            <div className={styles.detailAmendBtnRow}>
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

      {/* V8.9 (2026-05-13): SenderHistory + ActivityLog verhuisd naar modals
          (Tijdlijn / Houden) achter 3-puntjes-knop naast de percentage-circle.
          Maakt de detail-pane korter — info on-demand. */}
      <Modal
        open={timelineOpen}
        onClose={() => setTimelineOpen(false)}
        title="Tijdlijn — eerder van deze afzender"
        size="lg"
        className="theme-maestro"
      >
        <SenderHistory mail={mail} allMails={allMails} mailMessages={mailMessages} />
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

// ReasoningCollapsible — skill-insight banner als click-to-expand collapsible.
// Mockup: ingeklapt toont preview-text (tot 1 regel), klik klapt uit naar
// volledige reasoning. Ingeklapt-state is default zodat header-strook compact
// blijft; uitklap is opt-in.
//
// V5 (2026-05-10): toegevoegd in plaats van statisch .ad-reasoning blok.
// Functioneel identiek (toont reasoning), alleen visueel collapsible.
function ReasoningCollapsible({ reasoning }) {
  const [open, setOpen] = useState(false)
  const preview = reasoning && reasoning.length > 80
    ? reasoning.slice(0, 80).trim() + '…'
    : reasoning
  return (
    <button
      type="button"
      className={`ad-reasoning ad-reasoning--collapsible ${open ? 'ad-reasoning--open' : ''} ${styles.detailReasoningTop}`}
      onClick={() => setOpen(v => !v)}
      aria-expanded={open}
      title={open ? 'Klik om in te klappen' : 'Klik om volledige reasoning te tonen'}
    >
      <span className="ad-reasoning__label">Skill denkt:</span>{' '}
      <span className="ad-reasoning__text">{open ? reasoning : preview}</span>
      <span className="ad-reasoning__chev" aria-hidden>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </span>
    </button>
  )
}
