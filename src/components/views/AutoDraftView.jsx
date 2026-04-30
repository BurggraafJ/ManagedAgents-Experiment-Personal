import { useState, useMemo, useEffect, useCallback, useRef, Component } from 'react'
import { supabase } from '../../lib/supabase'

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

const AGENT = 'auto-draft'

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

export default function AutoDraftView({ data, subPage = 'postvak', onNavigate }) {
  const mails            = data.autodraftMails       || []
  const mailMessages     = data.mailMessages         || []
  const categories       = useMemo(() =>
    (data.autodraftCategories || []).slice().sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100)),
    [data.autodraftCategories])
  const categoryProps    = data.autodraftCategoryProposals || []
  const lessonProps      = data.autodraftLessonProposals   || []
  const decisions        = data.autodraftDecisions         || []
  const folders          = data.autodraftFolders           || []
  const lessons          = data.autodraftLessons           || []

  // Telling per conversation_id voor thread-badges in lijst
  const threadCounts = useMemo(() => {
    const m = new Map()
    for (const x of mails) {
      if (!x.conversation_id) continue
      m.set(x.conversation_id, (m.get(x.conversation_id) || 0) + 1)
    }
    return m
  }, [mails])

  const latestScanRun = useMemo(() =>
    (data.recentRuns || []).find(r => r.agent_name === AGENT) || null,
    [data.recentRuns])

  if (subPage === 'settings') {
    return (
      <div className="mc-app">
        <MailingSettings
          data={data}
          mails={mails}
          categories={categories}
          categoryProps={categoryProps}
          lessonProps={lessonProps}
          decisions={decisions}
          folders={folders}
          lessons={lessons}
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
        threadCounts={threadCounts}
        latestScanRun={latestScanRun}
        onNavigate={onNavigate}
      />
    </div>
  )
}

// =====================================================================
// HELPERS — al-verwerkt detectie, Outlook-stijl reusable bits
// =====================================================================

// Folder-naam = Inbox/Postvak IN (case-insensitive). Sub-folders ("Inbox/Sales")
// zijn dus NIET de inbox-root → daar staat de mail al verwerkt.
const INBOX_ROOT_RE = /^\s*(Inbox|Postvak[\s-]?IN)\s*$/i

// Geeft true als jij in Outlook al actie op de mail hebt genomen — verplaatst
// naar een andere map, of in dezelfde thread al geantwoord. Beide signalen komen
// uit mail_messages (truth-of-source). Conservatief: bij ontbrekende data
// retourneert false zodat we niets onterecht verbergen.
function isMailAlreadyHandled(mail, mailMessagesById, conversationByMyReplyAfter) {
  // Bron-mail in mail_messages
  const mm = mailMessagesById.get(mail.mail_id)
  if (mm) {
    const folder = mm.folder_path
    if (folder && !INBOX_ROOT_RE.test(folder)) return true
  }
  // Antwoord van jou in dezelfde thread, ná received_at?
  if (mail.conversation_id) {
    const myLastReplyIso = conversationByMyReplyAfter.get(mail.conversation_id)
    if (myLastReplyIso && new Date(myLastReplyIso) > new Date(mail.received_at)) return true
  }
  return false
}

function EmptyHero({ icon, title, hint }) {
  return (
    <div className="ad-empty" style={{ minHeight: 280 }}>
      <div className="ad-empty__icon">{icon}</div>
      <div className="ad-empty__title">{title}</div>
      <div className="ad-empty__hint">{hint}</div>
    </div>
  )
}

// =====================================================================
// MAILING SETTINGS — sub-pagina met 4 intra-tabs
// =====================================================================

const SETTINGS_TABS = [
  { id: 'voorstellen', label: '✨ Voorstellen', hint: 'wachten op review' },
  { id: 'categories',  label: '🏷 Categorieën' },
  { id: 'regels',      label: '🧠 Regels' },
  { id: 'logboek',     label: '📜 Logboek' },
]

function MailingSettings({ data, mails, categories, categoryProps, lessonProps, decisions, folders, lessons, onNavigate }) {
  const proposalsCount = categoryProps.length + lessonProps.length
  // Default: open de tab met de meeste reden om gezien te worden.
  const [activeTab, setActiveTab] = useState(() => proposalsCount > 0 ? 'voorstellen' : 'categories')

  const tabCount = (id) => {
    if (id === 'voorstellen') return proposalsCount
    if (id === 'categories')  return categories.length
    if (id === 'regels')      return lessons.length
    if (id === 'logboek')     return mails.filter(m =>
      ['sent','ignored','failed','stale'].includes(m.status) || String(m.status).startsWith('queued_')
    ).length
    return 0
  }

  return (
    <div className="ad-settings">
      {onNavigate && (
        <button type="button" className="btn btn--ghost"
          onClick={() => onNavigate('autodraft')}
          style={{ alignSelf: 'flex-start', fontSize: 12 }}
          title="Terug naar Postvak">
          <span aria-hidden style={{ marginRight: 6 }}>←</span>Postvak
        </button>
      )}
      <div className="ad-settings__tabs" role="tablist">
        {SETTINGS_TABS.map(t => {
          const active = activeTab === t.id
          const n = tabCount(t.id)
          return (
            <button key={t.id} type="button" role="tab" aria-selected={active}
              className={`ad-settings__tab ${active ? 'is-active' : ''}`}
              onClick={() => setActiveTab(t.id)}>
              <span>{t.label}</span>
              {n > 0 && <span className="ad-settings__tab-count">{n}</span>}
              {t.hint && active && <span className="ad-settings__tab-hint">· {t.hint}</span>}
            </button>
          )
        })}
      </div>

      <div className="ad-settings__panel">
        {activeTab === 'voorstellen' && (
          <div className="stack" style={{ gap: 'var(--s-5)' }}>
            {proposalsCount === 0 ? (
              <EmptyHero
                icon="✨"
                title="Geen openstaande voorstellen"
                hint="De skill stelt nieuwe categorieën en schrijfregels voor wanneer hij patronen herkent in jouw beslissingen. Verwerk eerst wat mails — dan komen hier vanzelf voorstellen binnen."
              />
            ) : (
              <div className="ad-proposals-row">
                {categoryProps.length > 0 && <CategoryProposalsBlock proposals={categoryProps} />}
                {lessonProps.length   > 0 && <LessonProposalsBlock   proposals={lessonProps} categories={categories} />}
              </div>
            )}
            <SystemInstructionsBlock data={data} />
          </div>
        )}

        {activeTab === 'categories' && (
          <CategoriesBlock categories={categories} folders={folders} alwaysOpen />
        )}

        {activeTab === 'regels' && (
          <LessonsBlock lessons={lessons} categories={categories} alwaysOpen />
        )}

        {activeTab === 'logboek' && (
          <div className="stack" style={{ gap: 'var(--s-5)' }}>
            <InboxLog mails={mails} decisions={decisions} alwaysOpen />
            <DebugBlock data={data} alwaysOpen />
          </div>
        )}
      </div>
    </div>
  )
}

// =====================================================================
// INBOX PANEL — lijst + detail + demo-banner + zoek + filters + keyboard
// =====================================================================

const FILTER_PRESETS = [
  { id: 'all',   label: 'Alles',          match: () => true },
  { id: 'draft', label: '✎ Draft klaar',  match: m => m.suggested_action === 'draft' },
  { id: 'skip',  label: '🗂 Negeer-voorstel', match: m => m.suggested_action === 'skip' },
  { id: 'flag',  label: '⚠ Vlaggen',      match: m => m.suggested_action === 'flag' },
]

// Audience-tabs: 'Alle' is verwijderd op verzoek (te ruime poel, weinig nut).
// Volgorde matcht user-flow: actiegericht → minder actiegericht.
const AUDIENCE_PRESETS = [
  { id: 'for_you',     label: '👤 Voor jou',     match: m => m.audience === 'for_you' },
  { id: 'priority',    label: '⭐ Prioriteit',    match: () => true },  // pool wordt apart bepaald
  { id: 'awaiting',    label: '⏳ In afwachting', match: () => true },
  { id: 'not_for_you', label: '🤖 Niet voor jou', match: m => m.audience === 'not_for_you' },
  { id: 'sent_drafts', label: '📤 Drafts klaar',  match: () => true },
]

// Domeinen die intern zijn — geen mails naar deze domeinen tellen als awaiting.
const INTERNAL_DOMAINS = ['legal-mind.nl']

function isInternalRecipient(emailOrJsonb) {
  if (!emailOrJsonb) return false
  const list = []
  if (typeof emailOrJsonb === 'string') list.push(emailOrJsonb)
  else if (Array.isArray(emailOrJsonb)) {
    for (const x of emailOrJsonb) {
      if (typeof x === 'string') list.push(x)
      else if (x?.email) list.push(x.email)
      else if (x?.address) list.push(x.address)
    }
  } else if (emailOrJsonb?.email) list.push(emailOrJsonb.email)
  if (list.length === 0) return false
  return list.every(e => INTERNAL_DOMAINS.some(d => e.toLowerCase().endsWith('@' + d)))
}

// Infer label voor uitgaande mail door te kijken of de ontvanger ooit zelf
// is gecategoriseerd in autodraft_mails (= klant Y mailde ooit en kreeg label).
function inferOutgoingLabel(toRecipients, allAutodraftMails) {
  const emails = []
  if (Array.isArray(toRecipients)) {
    for (const x of toRecipients) {
      if (typeof x === 'string') emails.push(x)
      else if (x?.email) emails.push(x.email)
      else if (x?.address) emails.push(x.address)
    }
  } else if (typeof toRecipients === 'string') {
    emails.push(...toRecipients.split(',').map(s => s.trim()))
  }
  for (const e of emails) {
    const match = allAutodraftMails.find(m => m.from_email && m.from_email.toLowerCase() === e.toLowerCase() && m.category_key)
    if (match) return match.category_key
  }
  return null
}

function TopStats({ mails, decisions, latestScanRun, latestExecuteRun }) {
  const todayStart = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d
  }, [])
  const pending  = mails.filter(m => m.status === 'pending' || m.status === 'amended').length
  const queued   = mails.filter(m => String(m.status).startsWith('queued_')).length
  const todaySent = decisions.filter(d => d.action === 'send' && d.executed_at && new Date(d.executed_at) >= todayStart).length
  const failed   = decisions.filter(d => d.execution_status === 'failed').length

  const scanAgo = latestScanRun ? formatRelative(latestScanRun.started_at) : 'nog nooit'
  const scanMode = latestScanRun?.stats?.mode || 'scan'
  const scanFailed = latestScanRun?.status === 'error'

  return (
    <div className="ad-topstats">
      <Stat label="Wacht op jou"        value={pending} tone={pending > 10 ? 'warn' : 'accent'} />
      <Stat label="In wachtrij"         value={queued}  tone="muted" />
      <Stat label="Verstuurd vandaag"   value={todaySent} tone="success" />
      <Stat label={`Laatste scan (${scanMode})`} value={scanAgo} tone={scanFailed ? 'error' : 'muted'} smallValue />
      {failed > 0 && <Stat label="Gefaalde acties" value={failed} tone="error" />}
    </div>
  )
}

function Stat({ label, value, tone, smallValue }) {
  const color = tone === 'accent'  ? 'var(--accent)'
              : tone === 'success' ? 'var(--success)'
              : tone === 'warn'    ? 'var(--warning, #f59e0b)'
              : tone === 'error'   ? 'var(--error)'
              : 'var(--text)'
  return (
    <div className="ad-stat">
      <div className="ad-stat__value" style={{ color, fontSize: smallValue ? 14 : 22 }}>{value}</div>
      <div className="ad-stat__label">{label}</div>
    </div>
  )
}

function InboxPanel({ mails, mailMessages, categories, folders, lessons, decisions = [], threadCounts, latestScanRun, onNavigate }) {
  const [filter, setFilter]     = useState('all')
  // Start op Prioriteit zodat je gevlagde mails als eerste ziet bij openen.
  const [audience, setAudience] = useState('priority')
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
        category_key: '',
        audience: 'for_you',
        suggested_action: null,
        suggested_reasoning: 'Skill heeft nog geen draft gemaakt — typ zelf je antwoord of klik snel-acties.',
        confidence: 0,
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
  const awaitingMails = useMemo(() => {
    if (!mailMessages || mailMessages.length === 0) return []
    const byConv = new Map()
    for (const m of mailMessages) {
      if (!m.conversation_id) continue
      const slot = byConv.get(m.conversation_id) || { mine: null, reply: null }
      if (m.is_from_me) {
        if (!slot.mine || new Date(m.received_at) > new Date(slot.mine.received_at)) slot.mine = m
      } else {
        if (!slot.reply || new Date(m.received_at) > new Date(slot.reply.received_at)) slot.reply = m
      }
      byConv.set(m.conversation_id, slot)
    }
    const now = Date.now()
    const out = []
    for (const { mine, reply } of byConv.values()) {
      if (!mine) continue
      if (mine.is_calendar_invite) continue                 // skip Outlook-uitnodigingen
      if (isInternalRecipient(mine.to_recipients)) continue // skip volledig-interne mails
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
  }, [mailMessages, mails])

  // "Prioriteit" — pending mails waar Outlook-vlag op staat (flag_status='flagged'
  // in mail_messages) plus mails die handmatig met flag-knop gemarkeerd zijn.
  // Lokale flagOverrides voor optimistic UI: mail_id -> true|false; merged
  // bovenop de DB-status zodat klik-feedback meteen zichtbaar is.
  const [flagOverrides, setFlagOverrides] = useState(() => new Map())
  const flaggedMailIds = useMemo(() => {
    const s = new Set()
    for (const m of (mailMessages || [])) {
      if (m.flag_status === 'flagged') s.add(m.id)
    }
    // Apply overrides
    for (const [id, val] of flagOverrides.entries()) {
      if (val) s.add(id); else s.delete(id)
    }
    return s
  }, [mailMessages, flagOverrides])

  // Toggle-flag callback voor MailRow + MailDetail. Optimistic: zet lokale
  // override meteen, RPC schrijft door naar mail_messages.flag_status. Bij
  // succes laten we de override staan tot de prop refresht (mail_messages
  // realtime channel pikt 't op).
  const handleToggleFlag = useCallback(async (mailId, newVal) => {
    setFlagOverrides(prev => {
      const next = new Map(prev)
      next.set(mailId, newVal)
      return next
    })
    try {
      const { data, error } = await supabase.rpc('set_mail_flag', { p_mail_id: mailId, p_flag: newVal })
      if (error || (data && data.ok === false)) {
        // Revert
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

  // Wanneer mailMessages-prop refresht en de DB-status klopt met de override,
  // mogen we de override loslaten — zo houden we de Map klein.
  useEffect(() => {
    if (flagOverrides.size === 0) return
    const dbFlagged = new Set()
    for (const m of (mailMessages || [])) {
      if (m.flag_status === 'flagged') dbFlagged.add(m.id)
    }
    let changed = false
    const next = new Map(flagOverrides)
    for (const [id, val] of flagOverrides.entries()) {
      if (val === dbFlagged.has(id)) {
        next.delete(id)
        changed = true
      }
    }
    if (changed) setFlagOverrides(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Audience-specifieke pools. Filter optimistic-actioned IDs altijd uit.
  const rawPool = audience === 'awaiting'    ? awaitingMails
                : audience === 'priority'    ? priorityMails
                : audience === 'sent_drafts' ? sentDraftsList
                : (showHandled ? pending : active)
  const visiblePool = useMemo(() =>
    actionedIds.size === 0 ? rawPool : rawPool.filter(m => !actionedIds.has(m.mail_id)),
    [rawPool, actionedIds])
  const handledIds = useMemo(() => new Set(handled.map(m => m.mail_id)), [handled])

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
  const flat    = useMemo(() => [
    ...buckets.today, ...buckets.yesterday, ...buckets.week, ...buckets.older,
  ], [buckets])

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

  async function onScan() {
    if (scanBusy) return
    setScanBusy(true); setScanMsg(null)
    try {
      const { data, error } = await supabase.rpc('trigger_autodraft_scan')
      if (error) setScanMsg({ err: error.message })
      else if (data && data.ok === false) setScanMsg({ err: data.reason })
      else setScanMsg({ ok: 'Scan aangevraagd — orchestrator pikt binnen 10 min op' })
    } catch (e) { setScanMsg({ err: e.message }) }
    setTimeout(() => setScanMsg(null), 6000)
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

      {handled.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px', marginBottom: 8,
          borderRadius: 6, fontSize: 11.5,
          background: showHandled ? 'var(--accent-soft)' : 'color-mix(in srgb, var(--text-muted) 8%, transparent)',
          color: 'var(--text-muted)',
          border: '1px dashed var(--border)',
        }}>
          <span style={{ opacity: 0.85 }}>💼</span>
          <span>
            {showHandled
              ? <><strong>{handled.length}</strong> afgehandelde mails worden ook getoond — al verplaatst of beantwoord in Outlook.</>
              : <><strong>{handled.length}</strong> {handled.length === 1 ? 'mail verborgen' : 'mails verborgen'} — je hebt ze al verplaatst of beantwoord in Outlook.</>
            }
          </span>
          <button type="button" onClick={() => setShowHandled(v => !v)}
            style={{
              marginLeft: 'auto', padding: '2px 10px', fontSize: 11,
              border: '1px solid var(--border)', borderRadius: 4,
              background: 'var(--bg)', color: 'var(--text)',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>
            {showHandled ? 'Verberg' : 'Toon ook'}
          </button>
        </div>
      )}

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
              {renderBucket('Vandaag',    buckets.today,     categories, selectedId, setSelectedId, threadCounts, handledIds, flaggedMailIds, handleToggleFlag)}
              {renderBucket('Gisteren',   buckets.yesterday, categories, selectedId, setSelectedId, threadCounts, handledIds, flaggedMailIds, handleToggleFlag)}
              {renderBucket('Deze week',  buckets.week,      categories, selectedId, setSelectedId, threadCounts, handledIds, flaggedMailIds, handleToggleFlag)}
              {renderBucket('Ouder',      buckets.older,     categories, selectedId, setSelectedId, threadCounts, handledIds, flaggedMailIds, handleToggleFlag)}
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
      {/* Audience-tabs — 'Alle' verwijderd; nieuwe tabs 'Prioriteit' (vlag),
          'In afwachting' (uitgaand zonder reply), 'Drafts' (geplaatst, nog
          niet handmatig verstuurd vanuit Outlook). */}
      <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        {[
          { id: 'for_you',     label: 'Voor jou',     n: forCount },
          { id: 'priority',    label: '⭐ Prioriteit', n: priorityCount || 0 },
          { id: 'awaiting',    label: '⏳ In afwachting', n: awaitingCount || 0 },
          { id: 'not_for_you', label: 'Niet voor jou', n: notForCount },
          { id: 'sent_drafts', label: '📤 Drafts',     n: sentDraftsCount || 0 },
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
      <IconBtn onClick={onScan} disabled={scanBusy} title="Scan inbox nu">
        {scanBusy ? '⏳' : '↻'}
      </IconBtn>
      {scanMsg?.ok && <span style={{ color: 'var(--success)', fontSize: 11 }}>✓</span>}
      {scanMsg?.err && <span style={{ color: 'var(--error)', fontSize: 11 }} title={scanMsg.err}>⚠</span>}
      {bulkMsg?.ok && <span style={{ color: 'var(--success)', fontSize: 11 }}>✓ {bulkMsg.ok}</span>}
      {bulkMsg?.err && <span style={{ color: 'var(--error)', fontSize: 11 }}>⚠ {bulkMsg.err}</span>}

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

function IconBtn({ children, onClick, title, disabled, active }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      style={{
        padding: '5px 9px', borderRadius: 6,
        border: '1px solid var(--border)',
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1, fontFamily: 'inherit', fontSize: 12,
      }}>
      {children}
    </button>
  )
}

function renderBucket(label, items, categories, selectedId, setSelectedId, threadCounts, handledIds, flaggedIds, onToggleFlag) {
  if (items.length === 0) return null
  return (
    <div className="ad-list-group">
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
          selected={m.mail_id === selectedId} onSelect={() => setSelectedId(m.mail_id)} />
      ))}
    </div>
  )
}

function EmptyState({ hasAnyMails, onScan, scanBusy }) {
  return (
    <div className="ad-empty">
      <div className="ad-empty__icon">📭</div>
      <div className="ad-empty__title">
        {hasAnyMails ? 'Geen mails matchen je filter' : 'Nog geen mails gescand'}
      </div>
      <div className="ad-empty__hint">
        {hasAnyMails
          ? 'Pas de filter-chips of zoekbalk aan.'
          : 'De auto-draft skill haalt je inbox binnen zodra hij draait. Je kan nu triggeren.'}
      </div>
      {!hasAnyMails && (
        <button type="button" className="btn btn--accent" disabled={scanBusy} onClick={onScan}>
          {scanBusy ? 'Wordt aangevraagd…' : '↻ Scan nu'}
        </button>
      )}
    </div>
  )
}

// =====================================================================
// MAIL ROW
// =====================================================================

function MailRow({ mail, categories, selected, onSelect, threadCount, isHandled, isFlagged, onToggleFlag }) {
  const cat = categories.find(c => c.category_key === mail.category_key)
  const isSkip = mail.suggested_action === 'skip'
  const isFlag = mail.suggested_action === 'flag'
  const isAwaiting = !!mail.__awaiting
  const isSentDraft = !!mail.__sent_draft
  const age = formatRelative(mail.received_at)
  const catColor = cat?.color || 'var(--border)'
  const bg = selected ? 'var(--accent-soft)' : 'var(--bg)'

  return (
    <div role="button" tabIndex={0}
      onClick={onSelect}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
      style={{
        display: 'flex', flexDirection: 'row', alignItems: 'stretch',
        width: '100%', minHeight: 64, cursor: 'pointer',
        background: bg,
        borderBottom: '1px solid var(--border)',
        opacity: isHandled ? 0.55 : (isSkip ? 0.7 : 1),
        transition: 'background 80ms',
      }}>
      <div style={{ width: 4, background: catColor, flexShrink: 0 }} title={cat?.label || 'ongecategoriseerd'} />
      <div style={{ flex: 1, padding: '10px 14px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, alignItems: 'center' }}>
          <span style={{
            fontWeight: 500, color: 'var(--text)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            textDecoration: isHandled ? 'line-through' : 'none',
          }}>
            {mail.from_name || mail.from_email || '—'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {/* Flag-toggle, klikbaar zonder de rij te selecteren */}
            {onToggleFlag && (
              <button type="button"
                onClick={e => { e.stopPropagation(); onToggleFlag(mail.mail_id, !isFlagged) }}
                aria-label={isFlagged ? 'Vlaggetje uit' : 'Markeer als prioriteit'}
                title={isFlagged ? 'Vlaggetje uit' : 'Markeer als prioriteit'}
                style={{
                  border: 'none', background: 'transparent', cursor: 'pointer',
                  padding: '2px 4px', fontSize: 14, lineHeight: 1,
                  color: isFlagged ? '#f59e0b' : 'var(--text-muted)',
                  opacity: isFlagged ? 1 : 0.55,
                }}>
                {isFlagged ? '★' : '☆'}
              </button>
            )}
            <span style={{ color: 'var(--text-muted)', fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
              {age}
            </span>
          </div>
        </div>
        <div style={{
          fontSize: 13, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          textDecoration: isHandled ? 'line-through' : 'none',
        }}>
          {mail.subject || '(geen onderwerp)'}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
          {isHandled && <span style={tagStyle('dim')} title="Al verplaatst of beantwoord in Outlook">✓ afgehandeld</span>}
          {isAwaiting && <span style={tagStyle('warn')} title="Wachtend op reactie">⏳ {mail.days_waiting}d</span>}
          {isSentDraft && <span style={tagStyle('accent')} title="Draft staat in Outlook, nog niet verstuurd">📤 draft</span>}
          {cat && (
            <span style={{
              padding: '1px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 500,
              background: colorWithAlpha(cat.color, 0.15), color: cat.color, whiteSpace: 'nowrap',
            }}>{cat.label}</span>
          )}
          {isSkip && !isAwaiting && !isSentDraft && <span style={tagStyle('dim')}>negeer-voorstel</span>}
          {isFlag && <span style={tagStyle('warn')}>vraag</span>}
          {mail.status === 'amended' && <span style={tagStyle('accent')}>✎ herschreven</span>}
          {threadCount > 1 && (
            <span style={tagStyle('thread')} title={`Thread van ${threadCount}`}>💬 {threadCount}</span>
          )}
        </div>
      </div>
    </div>
  )
}

function tagStyle(variant) {
  const base = { padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em' }
  if (variant === 'warn')   return { ...base, background: 'color-mix(in srgb, var(--warning, #f59e0b) 18%, transparent)', color: 'var(--warning, #f59e0b)' }
  if (variant === 'accent') return { ...base, background: 'var(--accent-soft)', color: 'var(--accent)' }
  if (variant === 'thread') return { ...base, background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }
  return { ...base, background: 'color-mix(in srgb, var(--text-muted) 15%, transparent)', color: 'var(--text-muted)' }
}

// =====================================================================
// MAIL DETAIL
// =====================================================================

function MailDetail({ mail, categories, folders, lessons, allMails, mailMessages, markActioned, unmarkActioned, isFlagged }) {
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

  const [draftBody, setDraftBody]       = useState(mail.draft_body || '')
  const [draftSubject, setDraftSubject] = useState(mail.draft_subject || '')
  const [draftTo, setDraftTo]           = useState(mail.from_email || '')
  const [draftCc, setDraftCc]           = useState(normalizeRecipients(mail.cc_recipients))
  const [targetFolder, setTargetFolder] = useState(mail.target_folder || '')
  const [categoryKey, setCategoryKey]   = useState(mail.category_key || '')
  const [amendText, setAmendText]       = useState('')
  const [mode, setMode]                 = useState(null)
  const [busy, setBusy]                 = useState(null)
  const [err, setErr]                   = useState(null)

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
    setTargetFolder(mail.target_folder || '')
    setCategoryKey(mail.category_key || '')
    setAmendText('')
    setMode(null)
    setCollapsed(mail.suggested_action === 'skip' || !!mail.__awaiting || !!mail.__sent_draft)
    setErr(null)
  }, [mail.mail_id])

  const cat = categories.find(c => c.category_key === categoryKey)
  // Folder-tree: lijst van { path, depth, name } gesorteerd op full_path zodat
  // sub-folders direct onder hun parent komen. Indent op depth — visueel
  // identiek aan Outlook's mappenboom.
  const folderTree = useMemo(() => {
    const allPaths = new Set()
    for (const f of (folders || [])) {
      const p = f.full_path || f.display_name
      if (p) allPaths.add(p)
    }
    for (const c of (categories || [])) {
      if (c.default_target_folder) allPaths.add(c.default_target_folder)
    }
    return Array.from(allPaths)
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
      const { data: rpcRes, error } = await supabase.rpc('submit_autodraft_decision', {
        p_mail_id: mail.mail_id,
        p_action: action,
        p_amend: action === 'amend' ? amendText : null,
        p_final_subject: action === 'send' ? (opts.subject ?? draftSubject) : null,
        p_final_body:    action === 'send' ? (opts.body    ?? draftBody)    : null,
        p_target_folder: opts.target_folder ?? (targetFolder || null),
        p_decision_kind: opts.decision_kind || 'reply',
        p_final_to:      opts.final_to || null,
      })
      if (error) {
        setErr(error.message)
        if (optimisticHide && unmarkActioned) unmarkActioned(mail.mail_id)
      } else if (rpcRes && rpcRes.ok === false) {
        setErr(rpcRes.reason || 'mislukt')
        if (optimisticHide && unmarkActioned) unmarkActioned(mail.mail_id)
      }
    } catch (e) {
      setErr(e.message)
      if (optimisticHide && unmarkActioned) unmarkActioned(mail.mail_id)
    }
    setBusy(null)
  }, [busy, mail.mail_id, amendText, draftSubject, draftBody, targetFolder, markActioned, unmarkActioned])

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
          <ToolbarBtn
            icon="📂"
            label={busy === 'ignore' ? 'Archiveren…' : 'Negeer'}
            disabled={!!busy}
            onClick={() => submit('ignore')}
          />
          <ToolbarBtn
            icon="✎"
            label="Aanpassen"
            active={mode === 'amend'}
            disabled={!!busy}
            onClick={() => setMode(m => m === 'amend' ? null : 'amend')}
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
          <QuickActionsToolbarBtn mail={mail} submit={submit} busy={busy} disabled={!!busy} />
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

        {/* Voor awaiting/sent-drafts: alleen categorie-chip rechts (vlag staat in MailRow) */}
        {isReadOnly && cat && (
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

function popoverItemStyle(active) {
  return {
    display: 'flex', width: '100%', alignItems: 'center',
    padding: '5px 8px', borderRadius: 4,
    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
    background: active ? 'var(--accent-soft)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text)',
    fontSize: 12, textAlign: 'left',
  }
}

// ContactInput — text-input met autocomplete-dropdown via search_contacts RPC.
// Werkt voor To en Cc velden in DraftEditor. Gebruikt debounced server-search
// over hubspot_contacts + mail_messages historie (982+ contacten).
function ContactInput({ value, onChange, disabled, placeholder, style }) {
  const [open, setOpen] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [highlightIdx, setHighlightIdx] = useState(0)
  const wrapRef = useRef(null)
  const debounceRef = useRef(null)

  // Debounced search: 200ms na laatste typ-event. Filter op laatste term
  // (na komma) zodat je meerdere recipients kunt typen.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const lastTerm = (value || '').split(',').pop().trim()
    if (!lastTerm || lastTerm.length < 2) {
      setSuggestions([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const { data } = await supabase.rpc('search_contacts', { p_query: lastTerm, p_limit: 8 })
        setSuggestions(Array.isArray(data) ? data : [])
        setHighlightIdx(0)
      } catch { setSuggestions([]) }
    }, 200)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [value])

  // Sluit dropdown bij klik buiten
  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    if (open) {
      document.addEventListener('mousedown', onDocClick)
      return () => document.removeEventListener('mousedown', onDocClick)
    }
  }, [open])

  function pickContact(c) {
    // Vervang de laatste term in value met de gekozen email (Naam <email>)
    const parts = (value || '').split(',')
    const formatted = c.display_name && c.display_name !== c.email
      ? `${c.display_name} <${c.email}>`
      : c.email
    parts[parts.length - 1] = ' ' + formatted
    onChange(parts.join(',').trim())
    setOpen(false)
    setSuggestions([])
  }

  function onKeyDown(e) {
    if (!open || suggestions.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx(i => Math.min(i + 1, suggestions.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' || e.key === 'Tab') {
      const c = suggestions[highlightIdx]
      if (c) { e.preventDefault(); pickContact(c) }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={wrapRef} style={{ flex: 1, position: 'relative' }}>
      <input type="text"
        value={value || ''}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        style={style}
        autoComplete="off" />
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
}) {
  const variants = Array.isArray(mail.draft_variants) ? mail.draft_variants : []
  const hasVariants = variants.length > 1
  const [variantIndex, setVariantIndex] = useState(mail.selected_variant_index || 0)
  const [ccOpen, setCcOpen] = useState(() => !!(draftCc && draftCc.trim()))

  useEffect(() => {
    setVariantIndex(mail.selected_variant_index || 0)
  }, [mail.mail_id, mail.selected_variant_index])

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
    display: 'flex', alignItems: 'center', gap: 8,
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
          <ArrowBtn dir="left" disabled={variantIndex <= 0} onClick={() => switchVariant(variantIndex - 1)} />
          <span style={{
            fontSize: 11, color: 'var(--text)',
            padding: '2px 10px', borderRadius: 999,
            background: 'var(--accent-soft)',
            fontWeight: 500, minWidth: 120, textAlign: 'center',
          }}>
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

function ArrowBtn({ dir, disabled, onClick }) {
  return (
    <div role="button" tabIndex={disabled ? -1 : 0}
      onClick={() => { if (!disabled) onClick() }}
      onKeyDown={e => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick() } }}
      style={{
        width: 24, height: 24, borderRadius: 6,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '1px solid var(--border)', background: 'var(--bg)',
        color: disabled ? 'var(--text-muted)' : 'var(--text)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        userSelect: 'none', fontSize: 12,
      }}
      aria-label={dir === 'left' ? 'vorige variant' : 'volgende variant'}>
      {dir === 'left' ? '←' : '→'}
    </div>
  )
}

// QuickActionsBtn — dropdown met snelle pre-baked acties (forward-to-finance etc).
// Ontworpen om uitbreidbaar te zijn: voeg gewoon een nieuw item toe aan de QUICK_ACTIONS array.
const FINANCE_FORWARD_TEMPLATE = (mail) =>
  `Dag Finance,\n\nDit is bedoeld voor de administratie. Indien vragen weet je me te vinden.\n\nGroet,\nJelle\n\n` +
  `--- Doorgestuurd bericht ---\n` +
  `Van: ${mail.from_name ? `${mail.from_name} <${mail.from_email}>` : mail.from_email}\n` +
  `Onderwerp: ${mail.subject || '(geen onderwerp)'}\n` +
  `Datum: ${formatDateTime(mail.received_at)}\n\n` +
  `${mail.body_text || mail.body_preview || '(originele body niet beschikbaar — open Outlook)'}`

const QUICK_ACTIONS = [
  {
    id: 'forward_finance',
    label: '📨 Stuur door naar Finance',
    description: 'Forward naar finance@legal-mind.nl met admin-template',
    run: (mail, submit) => submit('send', {
      busyTag: 'forward_finance',
      decision_kind: 'forward',
      final_to: ['finance@legal-mind.nl'],
      subject: `FW: ${mail.subject || '(geen onderwerp)'}`,
      body: FINANCE_FORWARD_TEMPLATE(mail),
      target_folder: 'Verwijderd',
    }),
  },
]

function QuickActionsBtn({ mail, submit, busy, disabled }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function onDocClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    if (open) {
      document.addEventListener('mousedown', onDocClick)
      return () => document.removeEventListener('mousedown', onDocClick)
    }
  }, [open])

  const isBusy = !!busy && QUICK_ACTIONS.some(a => busy === a.id)
  const baseStyle = btnStyle('ghost')

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div role="button" tabIndex={disabled ? -1 : 0}
        onClick={() => { if (!disabled) setOpen(v => !v) }}
        onKeyDown={e => {
          if (disabled) return
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(v => !v) }
        }}
        style={{
          ...baseStyle,
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
          userSelect: 'none',
        }}
        title="Snel-acties (forward, etc)">
        <span>{isBusy ? 'Bezig…' : '⚡ Snel'}</span>
        <span style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 8,
          background: 'var(--surface-1)', border: '1px solid var(--border)',
          borderRadius: 8, padding: 6, minWidth: 280,
          boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
        }}>
          {QUICK_ACTIONS.map(a => (
            <div key={a.id} role="button" tabIndex={0}
              onClick={() => { setOpen(false); a.run(mail, submit) }}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(false); a.run(mail, submit) }
              }}
              style={{
                padding: '8px 10px', borderRadius: 4, cursor: 'pointer',
                fontFamily: 'inherit', userSelect: 'none',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-soft)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{a.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{a.description}</div>
            </div>
          ))}
          <div style={{
            marginTop: 4, paddingTop: 4, borderTop: '1px solid var(--border)',
            fontSize: 10.5, color: 'var(--text-muted)', padding: '6px 10px',
          }}>
            Quick-actions schrijven concept-mails — AI verstuurt nooit zelf.
          </div>
        </div>
      )}
    </div>
  )
}

// Outlook-toolbar button — icon-boven-label, ribbon-style. Gebruikt .ot-btn
// CSS-klasse die alleen binnen .mc-app de Outlook-look pakt.
function ToolbarBtn({ icon, label, primary, danger, active, disabled, onClick, title }) {
  const cls = ['ot-btn']
  if (primary) cls.push('ot-btn--primary')
  else if (danger) cls.push('ot-btn--danger')
  else if (active) cls.push('ot-btn--accent')
  return (
    <button type="button" disabled={disabled} onClick={onClick} title={title}
      className={cls.join(' ')}
      style={{ background: active && !primary && !danger ? 'var(--accent-soft)' : undefined }}>
      <span className="ot-btn__icon" aria-hidden>{icon}</span>
      <span className="ot-btn__label">{label}</span>
    </button>
  )
}

// QuickActions als toolbar-knop met dropdown (zelfde icon-boven-label-stijl).
function QuickActionsToolbarBtn({ mail, submit, busy, disabled }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    function onDocClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    if (open) {
      document.addEventListener('mousedown', onDocClick)
      return () => document.removeEventListener('mousedown', onDocClick)
    }
  }, [open])
  const isBusy = !!busy && QUICK_ACTIONS.some(a => busy === a.id)
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" disabled={disabled}
        onClick={() => { if (!disabled) setOpen(v => !v) }}
        className="ot-btn"
        title="Snel-acties (forward, etc)">
        <span className="ot-btn__icon" aria-hidden>⚡</span>
        <span className="ot-btn__label">{isBusy ? 'Bezig…' : 'Snel ▾'}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 8,
          background: 'var(--bg)', border: '1px solid var(--border)',
          borderRadius: 6, padding: 4, minWidth: 280,
          boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
        }}>
          {QUICK_ACTIONS.map(a => (
            <button key={a.id} type="button"
              onClick={() => { setOpen(false); a.run(mail, submit) }}
              style={{
                display: 'block', width: '100%', padding: '8px 10px', borderRadius: 4,
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                background: 'transparent', color: 'var(--text)', textAlign: 'left',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#F3F2F1'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{a.label}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{a.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ActionBtn({ label, kbd, variant = 'ghost', disabled, onClick, title }) {
  const base = btnStyle(variant)
  return (
    <div role="button" tabIndex={disabled ? -1 : 0}
      title={title}
      onClick={() => { if (!disabled && onClick) onClick() }}
      onKeyDown={e => {
        if (disabled) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick && onClick() }
      }}
      style={{
        ...base,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        userSelect: 'none',
      }}>
      <span>{label}</span>
      {kbd && <span style={kbdStyle}>{kbd}</span>}
    </div>
  )
}

const kbdStyle = {
  display: 'inline-block', padding: '0 5px', minWidth: 16, textAlign: 'center',
  border: '1px solid color-mix(in srgb, currentColor 35%, transparent)',
  borderBottomWidth: 2, borderRadius: 4, fontSize: 10,
  fontFamily: "'SF Mono', Menlo, monospace", opacity: 0.75, lineHeight: 1.35,
}

function btnStyle(variant) {
  const base = {
    minWidth: 120, padding: '8px 14px', borderRadius: 8,
    fontSize: 13, fontWeight: 500, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 8,
    fontFamily: 'inherit',
  }
  if (variant === 'primary') return { ...base, background: 'var(--accent)', color: 'white', border: '1px solid var(--accent)' }
  if (variant === 'ghost')   return { ...base, background: 'var(--surface-1)', color: 'var(--text)', border: '1px solid var(--border)' }
  if (variant === 'dim')     return { ...base, background: 'var(--surface-1)', color: 'var(--text-muted)', border: '1px solid var(--border)', opacity: 0.45 }
  return base
}

// =====================================================================
// OUTLOOK-CHAIN — volledige conversatie inline, oudste-onder, mijn mails accent
// =====================================================================

// Maakt zowel een mail_messages-row als een autodraft_mails-row uniform werkbaar
function normalizeThreadMail(m) {
  return {
    id: m.mail_id || m.id,
    received_at: m.received_at,
    from_name: m.from_name,
    from_email: m.from_email,
    to_recipients: m.to_recipients || null,
    body_preview: m.body_preview,
    body_html: m.body_html || null,
    body_text: m.body_text || null,
    is_from_me: m.is_from_me === true,
    body_truncated: m.body_truncated || false,
  }
}

function OutlookChain({ currentMail, currentBody, allMails, mailMessages }) {
  // Threadbron: voorkeur mail_messages (truth-of-source met is_from_me),
  // fallback autodraft_mails. Voor full bodies van eerdere berichten:
  // RPC get_thread_messages — direct triggered bij conversation_id-verandering.
  const [threadFull, setThreadFull] = useState(null)
  const [threadLoading, setThreadLoading] = useState(false)

  useEffect(() => {
    if (!currentMail.conversation_id) { setThreadFull(null); return }
    let cancelled = false
    setThreadLoading(true)
    setThreadFull(null)
    ;(async () => {
      try {
        const { data } = await supabase.rpc('get_thread_messages', { p_conversation_id: currentMail.conversation_id })
        if (!cancelled) setThreadFull(Array.isArray(data) ? data : [])
      } catch { /* best-effort, valt terug op mailMessages */ }
      if (!cancelled) setThreadLoading(false)
    })()
    return () => { cancelled = true }
  }, [currentMail.conversation_id])

  const otherMessages = useMemo(() => {
    if (!currentMail.conversation_id) return []
    if (threadFull && threadFull.length > 0) {
      return threadFull
        .filter(m => m.id !== currentMail.mail_id)
        .map(normalizeThreadMail)
    }
    if (mailMessages && mailMessages.length > 0) {
      return mailMessages
        .filter(m => m.conversation_id === currentMail.conversation_id && m.id !== currentMail.mail_id)
        .map(normalizeThreadMail)
    }
    if (allMails && allMails.length > 0) {
      return allMails
        .filter(m => m.conversation_id === currentMail.conversation_id && m.mail_id !== currentMail.mail_id)
        .map(normalizeThreadMail)
    }
    return []
  }, [threadFull, mailMessages, allMails, currentMail.conversation_id, currentMail.mail_id])

  const currentNormalized = {
    id: currentMail.mail_id,
    received_at: currentMail.received_at,
    from_name: currentMail.from_name,
    from_email: currentMail.from_email,
    to_recipients: currentMail.to_recipients || null,
    body_preview: currentBody.body_preview,
    body_html: currentBody.body_html,
    body_text: currentBody.body_text,
    is_from_me: false,
    body_truncated: currentBody.body_truncated,
  }

  // Nieuwste boven (Outlook-stijl conversation): geselecteerde mail meestal eerst.
  const allInChain = useMemo(() => {
    const list = [currentNormalized, ...otherMessages]
    return list.sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otherMessages, currentMail.mail_id, currentBody.body_html, currentBody.body_text])

  const myCount  = allInChain.filter(m => m.is_from_me).length
  const allCount = allInChain.length

  return (
    <>
      <div className="mc-thread__divider">
        <span>{allCount} {allCount === 1 ? 'bericht' : 'berichten'} in conversatie{myCount > 0 ? ` · ${myCount} van jou` : ''}</span>
        {threadLoading && <span className="muted" style={{ marginLeft: 'auto' }}>laden…</span>}
      </div>
      {allInChain.map((m, idx) => (
        <ChainItem key={m.id} mail={m}
          isCurrent={m.id === currentMail.mail_id}
          isFirst={idx === 0} />
      ))}
    </>
  )
}

// ChainItem — één bericht als rij in het doorlopende leesblok. Geen border per
// item, alleen border-top wanneer het niet de eerste is — geeft de Outlook-feel
// van één doorlopend lange thread waar je doorheen scrollt.
function ChainItem({ mail, isCurrent, isFirst }) {
  const fromMe = mail.is_from_me
  const hasFullBody = !!(mail.body_html || mail.body_text)
  return (
    <article className={`mc-thread__item${isCurrent ? ' mc-thread__item--current' : ''}${fromMe ? ' mc-thread__item--mine' : ''}`}
      style={isFirst ? { borderTop: 'none' } : undefined}>
      <header className="mc-thread__head">
        <span className="mc-thread__from">
          <strong>{fromMe ? 'Jij' : (mail.from_name || mail.from_email || '—')}</strong>
          {!fromMe && mail.from_email && (
            <span className="muted" style={{ marginLeft: 6, fontWeight: 400 }}>&lt;{mail.from_email}&gt;</span>
          )}
        </span>
        <span className="mc-thread__time muted">{formatDateTime(mail.received_at)}</span>
      </header>
      <div className="mc-thread__body">
        {hasFullBody ? (
          <div className="mc-thread__html" dangerouslySetInnerHTML={{
            __html: sanitizeHtml(mail.body_html || `<pre>${escapeHtml(mail.body_text || '')}</pre>`)
          }} />
        ) : mail.body_preview ? (
          <pre className="mc-thread__preview">{mail.body_preview}</pre>
        ) : (
          <div className="muted" style={{ fontSize: 12 }}>(geen inhoud opgeslagen — open Outlook voor volledige tekst)</div>
        )}
      </div>
      {mail.body_truncated && (
        <div className="mc-thread__trunc muted">⚠ Body ingekort tot 200KB — open Outlook voor de volledige mail.</div>
      )}
    </article>
  )
}

// Cross-thread historie van dezelfde afzender — kleine info-strook onderaan.
function SenderHistory({ mail, allMails }) {
  const senderHistory = useMemo(() => {
    if (!mail.from_email || !allMails) return []
    return allMails
      .filter(m => m.from_email === mail.from_email && m.mail_id !== mail.mail_id
              && m.conversation_id !== mail.conversation_id)
      .sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
      .slice(0, 5)
  }, [mail, allMails])

  if (senderHistory.length === 0) return null

  return (
    <div className="ad-detail__sender-history">
      <strong>Eerder van {mail.from_name || mail.from_email}:</strong>{' '}
      {senderHistory.slice(0, 3).map((m, i) => {
        const status = m.status === 'sent' ? '✓' : m.status === 'ignored' ? '🗂' : m.status === 'pending' ? '⏳' : '·'
        return (
          <span key={m.mail_id} style={{ marginRight: 8 }}>
            {status} {formatRelative(m.received_at)}{i < Math.min(2, senderHistory.length - 1) ? ' · ' : ''}
          </span>
        )
      })}
      {senderHistory.length > 3 && <span> +{senderHistory.length - 3}</span>}
    </div>
  )
}

// =====================================================================
// VOORSTELLEN (categorieën + lessen)
// =====================================================================

function CategoryProposalsBlock({ proposals }) {
  return (
    <section className="va-block ad-proposal-block">
      <div className="va-block__head" style={{ cursor: 'default' }}>
        <span className="va-block__caret">·</span>
        <span className="va-block__title">✨ Nieuwe categorie voorgesteld</span>
        <span className="va-block__count">{proposals.length}</span>
      </div>
      <div className="va-block__body">
        {proposals.map(p => <CategoryProposalCard key={p.id} proposal={p} />)}
      </div>
    </section>
  )
}

function CategoryProposalCard({ proposal }) {
  const [keyVal, setKeyVal]     = useState(proposal.proposed_key)
  const [label, setLabel]       = useState(proposal.proposed_label)
  const [instr, setInstr]       = useState(proposal.proposed_instructions || '')
  const [folder, setFolder]     = useState(proposal.proposed_folder || '')
  const [busy, setBusy]         = useState(null)
  const [err, setErr]           = useState(null)
  const [mode, setMode]         = useState(null)
  const [rejectReason, setRR]   = useState('')

  async function accept() {
    setBusy('accept'); setErr(null)
    try {
      const { data, error } = await supabase.rpc('accept_autodraft_category_proposal', {
        p_proposal_id: proposal.id,
        p_category_key_override: keyVal,
        p_label_override: label,
        p_instructions_override: instr,
        p_folder_override: folder,
        p_reviewed_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }

  async function reject() {
    setBusy('reject'); setErr(null)
    try {
      const { data, error } = await supabase.rpc('reject_autodraft_category_proposal', {
        p_proposal_id: proposal.id, p_reason: rejectReason || null, p_reviewed_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }

  return (
    <div className="ad-proposal">
      <div className="ad-proposal__head">
        <strong>{proposal.proposed_label}</strong>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>
          {new Date(proposal.created_at).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      {proposal.reasoning && (
        <div className="ad-proposal__reasoning">
          <span className="ad-reasoning__label">Waarom:</span> {proposal.reasoning}
        </div>
      )}
      {proposal.example_subjects?.length > 0 && (
        <ul className="ad-proposal__examples">
          {proposal.example_subjects.slice(0, 3).map((s, i) => <li key={i}>{s}</li>)}
        </ul>
      )}
      <div className="ad-proposal__edit">
        <label><span>key</span><input value={keyVal} onChange={e => setKeyVal(e.target.value)} className="ad-input" /></label>
        <label><span>label</span><input value={label} onChange={e => setLabel(e.target.value)} className="ad-input" /></label>
        <label style={{ gridColumn: '1 / -1' }}>
          <span>instructies</span>
          <textarea value={instr} onChange={e => setInstr(e.target.value)} rows={3} className="ad-textarea" />
        </label>
        <label><span>map</span><input value={folder} onChange={e => setFolder(e.target.value)} className="ad-input" /></label>
      </div>
      <div className="ad-proposal__actions">
        <button className="btn btn--accent" disabled={!!busy} onClick={accept}>
          {busy === 'accept' ? 'Accepteren…' : '✓ Accepteer'}
        </button>
        <button className="btn btn--ghost" disabled={!!busy} onClick={() => setMode(m => m === 'reject' ? null : 'reject')}>
          ✕ Afwijzen
        </button>
        {err && <span style={{ color: 'var(--error)', fontSize: 12 }}>⚠ {err}</span>}
      </div>
      {mode === 'reject' && (
        <div className="ad-amend">
          <textarea value={rejectReason} onChange={e => setRR(e.target.value)} rows={2}
            className="ad-textarea" placeholder="reden (optioneel)" />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn--accent" disabled={!!busy} onClick={reject}>Bevestig</button>
            <button className="btn btn--ghost" onClick={() => setMode(null)} disabled={!!busy}>Annuleer</button>
          </div>
        </div>
      )}
    </div>
  )
}

function LessonProposalsBlock({ proposals, categories }) {
  return (
    <section className="va-block ad-proposal-block">
      <div className="va-block__head" style={{ cursor: 'default' }}>
        <span className="va-block__caret">·</span>
        <span className="va-block__title">🧠 Nieuwe schrijfregel voorgesteld</span>
        <span className="va-block__count">{proposals.length}</span>
      </div>
      <div className="va-block__body">
        {proposals.map(p => <LessonProposalCard key={p.id} proposal={p} categories={categories} />)}
      </div>
    </section>
  )
}

function LessonProposalCard({ proposal, categories }) {
  const [text, setText] = useState(proposal.proposed_lesson)
  const [busy, setBusy] = useState(null)
  const [err, setErr]   = useState(null)
  const [rejectReason, setRR] = useState('')
  const [mode, setMode] = useState(null)

  const scopeLabel = proposal.scope === 'category'
    ? (categories.find(c => c.category_key === proposal.scope_value)?.label || proposal.scope_value)
    : proposal.scope === 'domain' ? `@${proposal.scope_value}`
    : proposal.scope === 'sender' ? proposal.scope_value
    : 'globaal'

  async function accept() {
    setBusy('accept'); setErr(null)
    try {
      const { data, error } = await supabase.rpc('accept_autodraft_lesson_proposal', {
        p_proposal_id: proposal.id,
        p_lesson_override: text,
        p_reviewed_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }

  async function reject() {
    setBusy('reject'); setErr(null)
    try {
      const { data, error } = await supabase.rpc('reject_autodraft_lesson_proposal', {
        p_proposal_id: proposal.id, p_reason: rejectReason || null, p_reviewed_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
    } catch (e) { setErr(e.message) }
    setBusy(null)
  }

  return (
    <div className="ad-proposal">
      <div className="ad-proposal__head">
        <span className="ad-row__cat" style={{
          background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
          color: 'var(--accent)',
        }}>{scopeLabel}</span>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>
          {new Date(proposal.created_at).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={2} className="ad-textarea" />
      {proposal.evidence && (
        <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
          <span className="ad-reasoning__label">Bewijs:</span> {proposal.evidence}
        </div>
      )}
      <div className="ad-proposal__actions">
        <button className="btn btn--accent" disabled={!!busy || !text.trim()} onClick={accept}>
          {busy === 'accept' ? 'Accepteren…' : '✓ Voeg regel toe'}
        </button>
        <button className="btn btn--ghost" disabled={!!busy} onClick={() => setMode(m => m === 'reject' ? null : 'reject')}>
          ✕ Afwijzen
        </button>
        {err && <span style={{ color: 'var(--error)', fontSize: 12 }}>⚠ {err}</span>}
      </div>
      {mode === 'reject' && (
        <div className="ad-amend">
          <textarea value={rejectReason} onChange={e => setRR(e.target.value)} rows={2}
            className="ad-textarea" placeholder="reden (optioneel)" />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn btn--accent" disabled={!!busy} onClick={reject}>Bevestig</button>
            <button className="btn btn--ghost" onClick={() => setMode(null)} disabled={!!busy}>Annuleer</button>
          </div>
        </div>
      )}
    </div>
  )
}

// =====================================================================
// CATEGORIEBEHEER
// =====================================================================

function CategoriesBlock({ categories, folders, alwaysOpen }) {
  const [openLocal, setOpen] = useState(!!alwaysOpen)
  const open = alwaysOpen ? true : openLocal
  const [editingKey, setEditingKey] = useState(null)
  return (
    <section className="va-block">
      {alwaysOpen ? (
        <div className="va-block__head" style={{ cursor: 'default' }}>
          <span className="va-block__title">Categorieën</span>
          <span className="va-block__count">{categories.length}</span>
          <span className="muted va-block__hint">kleur · instructies · doelmap · default actie</span>
        </div>
      ) : (
        <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
          <span className="va-block__caret">{open ? '▾' : '▸'}</span>
          <span className="va-block__title">Categorieën</span>
          <span className="va-block__count">{categories.length}</span>
          <span className="muted va-block__hint">kleur · instructies · doelmap · default actie</span>
        </button>
      )}
      {open && (
        <div className="va-block__body">
          <div className="ad-cat-grid">
            {categories.map(c => (
              <button key={c.category_key} type="button"
                className={`ad-cat-chip ${c.active === false ? 'is-off' : ''} ${editingKey === c.category_key ? 'is-selected' : ''}`}
                onClick={() => setEditingKey(c.category_key)}>
                <span className="ad-cat-chip__color" style={{ background: c.color || 'var(--border)' }} />
                <div className="ad-cat-chip__label">{c.label}</div>
                <div className="ad-cat-chip__key mono">{c.category_key}</div>
                <div className="ad-cat-chip__meta">
                  {c.default_action} · {c.default_target_folder || '(geen map)'}
                </div>
              </button>
            ))}
            <button type="button" className="ad-cat-chip ad-cat-chip--new" onClick={() => setEditingKey('__new__')}>
              + nieuwe categorie
            </button>
          </div>
          {editingKey && (
            <CategoryEditor key={editingKey}
              category={editingKey === '__new__' ? null : categories.find(c => c.category_key === editingKey)}
              onDone={() => setEditingKey(null)} folders={folders} />
          )}
        </div>
      )}
    </section>
  )
}

function CategoryEditor({ category, onDone }) {
  const [keyVal, setKeyVal]         = useState(category?.category_key || '')
  const [label, setLabel]           = useState(category?.label || '')
  const [description, setDescr]     = useState(category?.description || '')
  const [instructions, setInstr]    = useState(category?.handling_instructions || '')
  const [folder, setFolder]         = useState(category?.default_target_folder || '')
  const [defaultAction, setDA]      = useState(category?.default_action || 'draft')
  const [active, setActive]         = useState(category?.active !== false)
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState(null)
  const [ok, setOk]     = useState(false)

  async function save() {
    setBusy(true); setErr(null); setOk(false)
    try {
      const { data, error } = await supabase.rpc('upsert_autodraft_category', {
        p_category_key: keyVal, p_label: label, p_description: description,
        p_handling_instructions: instructions, p_default_target_folder: folder || null,
        p_default_action: defaultAction, p_active: active,
        p_sort_order: category?.sort_order ?? 100, p_updated_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
      else { setOk(true); setTimeout(onDone, 600) }
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div className="ad-cat-editor">
      <div className="ad-proposal__edit">
        <label><span>key</span>
          <input value={keyVal} onChange={e => setKeyVal(e.target.value)} className="ad-input"
            disabled={!!category} placeholder="bv. klant_offerte" />
        </label>
        <label><span>label</span><input value={label} onChange={e => setLabel(e.target.value)} className="ad-input" /></label>
        <label style={{ gridColumn: '1 / -1' }}>
          <span>korte beschrijving</span>
          <input value={description} onChange={e => setDescr(e.target.value)} className="ad-input" />
        </label>
        <label style={{ gridColumn: '1 / -1' }}>
          <span>instructies (hoe behandelt de skill dit type mail?)</span>
          <textarea value={instructions} onChange={e => setInstr(e.target.value)} rows={5} className="ad-textarea" />
        </label>
        <label><span>default map</span>
          <input value={folder} onChange={e => setFolder(e.target.value)} className="ad-input" list="ad-folder-suggestions" />
        </label>
        <label><span>default actie</span>
          <select value={defaultAction} onChange={e => setDA(e.target.value)} className="ad-select">
            <option value="draft">draft schrijven</option>
            <option value="skip">negeren/archiveren</option>
            <option value="flag">vraag aan Jelle stellen</option>
          </select>
        </label>
        <label>
          <span>status</span>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> actief
          </label>
        </label>
      </div>
      <div className="ad-proposal__actions">
        <button className="btn btn--accent" disabled={busy || !keyVal || !label} onClick={save}>
          {busy ? 'Opslaan…' : 'Opslaan'}
        </button>
        <button className="btn btn--ghost" onClick={onDone} disabled={busy}>Annuleer</button>
        {ok  && <span style={{ color: 'var(--success)', fontSize: 12 }}>✓ opgeslagen</span>}
        {err && <span style={{ color: 'var(--error)', fontSize: 12 }}>⚠ {err}</span>}
      </div>
    </div>
  )
}

// =====================================================================
// LOGBOEK + LESSEN
// =====================================================================

function InboxLog({ mails, decisions, alwaysOpen }) {
  const [openLocal, setOpen] = useState(!!alwaysOpen)
  const open = alwaysOpen ? true : openLocal
  const processed = useMemo(() => mails
    .filter(m => ['sent','ignored','failed','stale'].includes(m.status) ||
                 String(m.status).startsWith('queued_'))
    .sort((a, b) => new Date(b.updated_at || b.scanned_at) - new Date(a.updated_at || a.scanned_at))
    .slice(0, 50),
    [mails])

  const latestDecisionByMail = useMemo(() => {
    const m = new Map()
    for (const d of decisions) if (!m.has(d.mail_id)) m.set(d.mail_id, d)
    return m
  }, [decisions])

  return (
    <section className="va-block">
      {alwaysOpen ? (
        <div className="va-block__head" style={{ cursor: 'default' }}>
          <span className="va-block__title">Logboek · Verwerkt</span>
          <span className="va-block__count">{processed.length}</span>
          <span className="muted va-block__hint">alles wat uit je postvak is — verstuurd, genegeerd of gefaald</span>
        </div>
      ) : (
        <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
          <span className="va-block__caret">{open ? '▾' : '▸'}</span>
          <span className="va-block__title">Logboek · Verwerkt</span>
          <span className="va-block__count">{processed.length}</span>
          <span className="muted va-block__hint">alles wat uit je postvak is — verstuurd, genegeerd of gefaald</span>
        </button>
      )}
      {open && (
        <div className="va-block__body">
          {processed.length === 0 ? (
            <div className="empty empty--compact" style={{ padding: 14, fontSize: 11 }}>Nog niks verwerkt.</div>
          ) : (
            <div className="va-log-list">
              {processed.map(m => <LogLine key={m.mail_id} mail={m} decision={latestDecisionByMail.get(m.mail_id)} />)}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

const STATUS_META = {
  queued_send:   { label: 'Wacht op verzending',       cls: 'amended'  },
  queued_ignore: { label: 'Wacht op archivering',      cls: 'amended'  },
  queued_amend:  { label: 'Wacht op herschrijf',       cls: 'accepted' },
  sent:          { label: 'Verstuurd ✓',               cls: 'executed' },
  ignored:       { label: 'Gearchiveerd',              cls: 'rejected' },
  failed:        { label: 'Gefaald',                   cls: 'failed'   },
  stale:         { label: 'Verdwenen',                 cls: 'rejected' },
}

function LogLine({ mail, decision }) {
  const [open, setOpen] = useState(false)
  const meta = STATUS_META[mail.status] || { label: mail.status, cls: 'rejected' }
  const when = mail.updated_at || mail.scanned_at
  const hasDetails = !!decision
  return (
    <div className={`va-log-line va-log-line--${meta.cls} ${open ? 'is-open' : ''}`}>
      <button type="button" className="va-log-line__row" disabled={!hasDetails}
        onClick={() => hasDetails && setOpen(v => !v)}>
        <span className="va-log-line__caret">{hasDetails ? (open ? '▾' : '▸') : ''}</span>
        <span className="va-log-line__status">{meta.label}</span>
        <span className="va-log-line__subject">{mail.subject || '(geen onderwerp)'}</span>
        <span className="va-log-line__time">{formatDateTime(when)}</span>
      </button>
      {open && decision && (
        <div className="va-log-line__body">
          <div style={{ fontSize: 12, display: 'grid', gap: 4 }}>
            <div><span className="muted">Actie:</span> {decision.action}</div>
            {decision.target_folder && <div><span className="muted">Map:</span> {decision.target_folder}</div>}
            {decision.amend_instructions && <div><span className="muted">Jouw correctie:</span> <em>{decision.amend_instructions}</em></div>}
            {decision.execution_error && <div style={{ color: 'var(--error)' }}>⚠ {decision.execution_error}</div>}
            {decision.executed_at && <div className="muted">Uitgevoerd: {formatDateTime(decision.executed_at)}</div>}
          </div>
        </div>
      )}
    </div>
  )
}

function LessonsBlock({ lessons, categories, alwaysOpen }) {
  const [openLocal, setOpen] = useState(!!alwaysOpen)
  const open = alwaysOpen ? true : openLocal
  const grouped = useMemo(() => {
    const m = new Map()
    for (const l of lessons) {
      const key = l.scope === 'category' ? (l.scope_value || 'onbekend') : l.scope
      if (!m.has(key)) m.set(key, [])
      m.get(key).push(l)
    }
    return m
  }, [lessons])

  return (
    <section className="va-block">
      {alwaysOpen ? (
        <div className="va-block__head" style={{ cursor: 'default' }}>
          <span className="va-block__title">Geleerde regels</span>
          <span className="va-block__count">{lessons.length}</span>
          <span className="muted va-block__hint">uit amendments · skill leest ze bij elke draft</span>
        </div>
      ) : (
        <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
          <span className="va-block__caret">{open ? '▾' : '▸'}</span>
          <span className="va-block__title">Geleerde regels</span>
          <span className="va-block__count">{lessons.length}</span>
          <span className="muted va-block__hint">uit amendments · skill leest ze bij elke draft</span>
        </button>
      )}
      {open && (
        <div className="va-block__body">
          {lessons.length === 0 ? (
            <div className="empty empty--compact" style={{ padding: 14, fontSize: 11 }}>
              Nog geen regels. Zodra je een aanpassingsvoorstel indient, distilleert de skill er regels uit
              en vraagt hij ze via "Nieuwe schrijfregel voorgesteld" aan jou.
            </div>
          ) : (
            <div className="stack stack--sm">
              {[...grouped.entries()].map(([scope, items]) => {
                const cat = categories.find(c => c.category_key === scope)
                return (
                  <div key={scope}>
                    <div className="kpi__label" style={{ marginBottom: 6 }}>
                      {cat ? cat.label : scope === 'global' ? 'Globaal' : scope}
                    </div>
                    <ul className="ad-lessons">
                      {items.map(l => (
                        <li key={l.id}>
                          <span>{l.lesson}</span>
                          <span className="muted" style={{ fontSize: 11 }}>{l.times_applied}× toegepast</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// =====================================================================
// SYSTEEM-INSTRUCTIES + DEBUG
// =====================================================================

function SystemInstructionsBlock({ data, alwaysOpen }) {
  const [openLocal, setOpen] = useState(!!alwaysOpen)
  const open = alwaysOpen ? true : openLocal
  const instructionsRow = (data.agentInstructions || []).find(r => r.agent_name === AGENT)
  const [text, setText] = useState(instructionsRow?.config_value?.text || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setText(instructionsRow?.config_value?.text || '')
    setErr(null); setSaved(false)
  }, [instructionsRow?.updated_at])

  const dirty = text !== (instructionsRow?.config_value?.text || '')

  async function save() {
    setBusy(true); setErr(null); setSaved(false)
    try {
      const { data: rpcRes, error } = await supabase.rpc('upsert_agent_instructions', {
        p_agent_name: AGENT, p_instructions: text, p_updated_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (rpcRes && rpcRes.ok === false) setErr(rpcRes.reason || 'mislukt')
      else setSaved(true)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <section className="va-block">
      <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
        <span className="va-block__caret">{open ? '▾' : '▸'}</span>
        <span className="va-block__title">Systeem-instructies</span>
        <span className="muted va-block__hint">globaal · wordt door elke run bovenop categorieën gelezen</span>
      </button>
      {open && (
        <div className="va-block__body" style={{ display: 'grid', gap: 10 }}>
          <textarea value={text} onChange={e => setText(e.target.value)} disabled={busy} rows={8}
            className="ad-textarea"
            placeholder={'Bijvoorbeeld:\n- Nederlandse mails altijd tutoyeren.\n- Max 6 zinnen tenzij de mail lang is.\n- Nooit mijn telefoonnummer sturen.'} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn--accent" onClick={save} disabled={busy || !dirty}>
              {busy ? 'Opslaan…' : 'Opslaan'}
            </button>
            {saved && <span style={{ color: 'var(--success)', fontSize: 12 }}>✓ opgeslagen</span>}
            {err   && <span style={{ color: 'var(--error)', fontSize: 12 }}>⚠ {err}</span>}
          </div>
        </div>
      )}
    </section>
  )
}

function DebugBlock({ data, alwaysOpen }) {
  const [openLocal, setOpen] = useState(!!alwaysOpen)
  const open = alwaysOpen ? true : openLocal
  const runs = (data.recentRuns || [])
    .filter(r => r.agent_name === AGENT || r.agent_name === 'auto-draft-execute')
    .slice(0, 20)
  return (
    <section className="va-block">
      {alwaysOpen ? (
        <div className="va-block__head" style={{ cursor: 'default' }}>
          <span className="va-block__title">Debug · recente runs</span>
          <span className="muted va-block__hint">alleen om te zien waar iets faalt</span>
        </div>
      ) : (
        <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
          <span className="va-block__caret">{open ? '▾' : '▸'}</span>
          <span className="va-block__title">Debug · recente runs</span>
          <span className="muted va-block__hint">alleen om te zien waar iets faalt</span>
        </button>
      )}
      {open && (
        <div className="va-block__body">
          {runs.length === 0 ? (
            <div className="empty empty--compact" style={{ padding: 10 }}>Geen runs.</div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Skill</th><th>Start</th><th>Status</th><th>Opmerking</th></tr></thead>
                <tbody>
                  {runs.map(r => {
                    const s = r.stats || {}
                    const note = s.error || s.blocker || s.note || ''
                    return (
                      <tr key={r.id || r.started_at}>
                        <td className="mono" style={{ fontSize: 11 }}>{r.agent_name}</td>
                        <td className="mono" style={{ fontSize: 11 }}>
                          {new Date(r.started_at).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td><span className={`pill s-${r.status}`}>{r.status}</span></td>
                        <td className="muted" style={{ fontSize: 11, maxWidth: 400 }}>
                          {typeof note === 'string' ? note.slice(0, 120) : ''}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// =====================================================================
// UTILS
// =====================================================================

function groupByAge(mails) {
  const now = new Date()
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
  const yStart = new Date(todayStart); yStart.setDate(yStart.getDate() - 1)
  const wStart = new Date(todayStart); wStart.setDate(wStart.getDate() - 6)
  const out = { today: [], yesterday: [], week: [], older: [] }
  for (const m of mails) {
    const d = new Date(m.received_at)
    if (d >= todayStart) out.today.push(m)
    else if (d >= yStart) out.yesterday.push(m)
    else if (d >= wStart) out.week.push(m)
    else out.older.push(m)
  }
  return out
}

function formatRelative(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const min = Math.round((now - d) / 60000)
  if (min < 1) return 'net'
  if (min < 60) return `${min}m`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}u`
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' })
}

function formatDateTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('nl-NL', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

function confTone(c) {
  const n = Number(c || 0)
  if (n >= 0.75) return 'high'
  if (n >= 0.5) return 'mid'
  return 'low'
}

function colorWithAlpha(color, alpha) {
  if (!color) return 'var(--border)'
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]))
}

function sanitizeHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/ on\w+="[^"]*"/gi, '')
    .replace(/ on\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '')
}
