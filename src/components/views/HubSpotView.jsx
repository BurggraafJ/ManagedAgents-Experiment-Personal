import { useMemo, useState } from 'react'
import AgentCard     from '../AgentCard'
import MicButton     from '../MicButton'
import { supabase }  from '../../lib/supabase'

const AGENT = 'hubspot-daily-sync'

const ACTION_STATUSES = new Set(['open', 'pending'])
// superseded = legacy open_question die nu als proposal bestaat, niet meer tonen
const HIDDEN_STATUSES = new Set(['superseded'])

const CATEGORIES = ['klant', 'partner', 'recruitment', 'overig']

const CATEGORY_LABEL = {
  klant:       'Klant',
  partner:     'Partner',
  recruitment: 'Recruitment',
  overig:      'Overig',
}

const CATEGORY_CLASS = {
  klant:       'cat cat--klant',
  partner:     'cat cat--partner',
  recruitment: 'cat cat--recruit',
  overig:      'cat cat--misc',
}

const STORAGE_KEY_FILTER    = 'lm-dashboard-proposal-categories'
const STORAGE_KEY_COLLAPSED = 'lm-dashboard-proposal-collapsed'

// Minimum score voor "Andere contactmomenten" — alles daaronder is te rommelig
// om te tonen. Skill zou het ook niet meer moeten opslaan vanaf v1.3, maar de
// dashboard filtert voor de zekerheid ook zelf.
const FILTERED_MIN_SCORE = 0.15

function loadFilterState() {
  if (typeof localStorage === 'undefined') return null
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_FILTER)) } catch { return null }
}

function saveFilterState(s) {
  try { localStorage.setItem(STORAGE_KEY_FILTER, JSON.stringify(s)) } catch {}
}

function loadCollapsedState() {
  if (typeof localStorage === 'undefined') return null
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_COLLAPSED)) } catch { return null }
}

function saveCollapsedState(s) {
  try { localStorage.setItem(STORAGE_KEY_COLLAPSED, JSON.stringify(s)) } catch {}
}

function formatDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function summarizeContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return null
  const entries = []
  if (ctx.company)      entries.push(['bedrijf', ctx.company])
  else if (ctx.bedrijf) entries.push(['bedrijf', ctx.bedrijf])
  if (ctx.deal_name)    entries.push(['deal', ctx.deal_name])
  if (ctx.dealstage)    entries.push(['stage', ctx.dealstage])
  if (ctx.contact)      entries.push(['contact', ctx.contact])
  if (ctx.email)        entries.push(['email', ctx.email])
  if (Array.isArray(ctx.emails) && ctx.emails.length) entries.push(['emails', ctx.emails.join(', ')])
  if (ctx.meeting_time) entries.push(['tijd', ctx.meeting_time])
  if (ctx.date)         entries.push(['datum', ctx.date])
  if (ctx.signed_by)    entries.push(['getekend door', ctx.signed_by])
  if (ctx.signed_on)    entries.push(['getekend op', ctx.signed_on])
  if (ctx.deal_id)      entries.push(['deal_id', ctx.deal_id])
  return entries.length > 0 ? entries : null
}

export default function HubSpotView({ data }) {
  const schedule  = data.schedules.find(s => s.agent_name === AGENT)
  const latestRun = data.latestRuns[AGENT]
  const history   = data.history[AGENT] || []

  const allQs = data.questions.filter(q => q.agent_name === AGENT && !HIDDEN_STATUSES.has(q.status))
  // AgentCard "actie nodig" badge: legacy open_questions + pending/amended proposals.
  // Proposals met needs_info=true tellen ook mee (jouw input is daar nodig).
  const pendingForCard = [
    ...allQs.filter(q => ACTION_STATUSES.has(q.status)),
    ...(data.proposals || []).filter(p =>
      p.agent_name === AGENT && (p.status === 'pending' || p.status === 'amended')
    ),
  ]

  // Proposals — nieuw model
  const allProposals = (data.proposals || []).filter(p => p.agent_name === AGENT)

  // Filter-state: welke categorieën wil Jelle zien. Default: alles aan.
  const [catFilter, setCatFilter] = useState(() => {
    const saved = loadFilterState()
    return saved || { klant: true, partner: true, recruitment: true, overig: true }
  })
  const toggleCat = (c) => {
    setCatFilter(prev => {
      const next = { ...prev, [c]: !prev[c] }
      saveFilterState(next)
      return next
    })
  }

  // Collapsed-state per sectie. Default: actie_needed + ready beide
  // **ingeklapt** zodat het overzicht eerst compact is (Jelle klikt wat hij
  // wil bekijken). Andere contactmomenten + Log blijven als eerst normaal.
  const [collapsed, setCollapsed] = useState(() => {
    const saved = loadCollapsedState()
    return saved || { action: true, ready: true, log: true, filtered: false }
  })
  const toggleCollapsed = (key) => {
    setCollapsed(prev => {
      const next = { ...prev, [key]: !prev[key] }
      saveCollapsedState(next)
      return next
    })
  }

  const visibleProposals = allProposals.filter(p => catFilter[p.category] !== false)
  // Twee afzonderlijke bakken binnen "Voorstellen":
  //   • needs_info=true   → "Actie nodig" — agent mist info, Jelle moet antwoord geven
  //   • needs_info=false  → "Te accepteren" — concreet plan, Jelle kiest ✓/✎/✕
  // Binnen "Te accepteren" staan herziene voorstellen (amended_from != null)
  // bovenaan — dat zijn voorstellen die voortkomen uit Jelles eerdere amendment
  // en waar hij expliciet een nieuw plan voor moet beoordelen.
  const sortByCreated = (a, b) => new Date(b.created_at) - new Date(a.created_at)
  const sortReviseFirst = (a, b) => {
    const ar = a.amended_from ? 1 : 0
    const br = b.amended_from ? 1 : 0
    if (ar !== br) return br - ar
    return sortByCreated(a, b)
  }
  const actionNeeded = visibleProposals
    .filter(p => p.status === 'pending' && p.needs_info === true)
    .sort(sortByCreated)
  const readyToReview = visibleProposals
    .filter(p => p.status === 'pending' && p.needs_info !== true)
    .sort(sortReviseFirst)
  const needInfoCount = actionNeeded.length
  const readyCount    = readyToReview.length
  // Aanpassing verstuurd: Jelle heeft amendment opgeslagen, wacht op volgende run.
  const sentAmendments   = visibleProposals.filter(p => p.status === 'amended')
  // Log-sectie: voorstellen die definitief zijn afgehandeld (geschiedenis)
  const logProposals = visibleProposals.filter(p => ['accepted', 'rejected', 'executed', 'failed'].includes(p.status))
  const perCatPending = CATEGORIES.reduce((acc, c) => {
    acc[c] = allProposals.filter(p => p.category === c && (p.status === 'pending' || p.status === 'amended')).length
    return acc
  }, {})

  // Samenvatting voor de Status-strip
  const summary = {
    ready:    readyCount,
    needInfo: needInfoCount,
    sent:     sentAmendments.length,
    filtered: (data.filtered || []).filter(f => !f.forced_proposal_id).length,
    done:     logProposals.length,
  }

  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>

      {/* ===== 1. STATUS — agent-card + samenvatting. Geen dubbele namen; die staan
                        in de secties hieronder. ===== */}
      <section>
        <div className="section__head">
          <h2 className="section__title">Status</h2>
          <span className="section__hint">draait de agent, en hoeveel items wachten in elke bak hieronder</span>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
          <AgentCard
            agent={AGENT}
            schedule={schedule}
            latestRun={latestRun}
            history={history}
            openQuestions={pendingForCard}
            hideOpenQuestions
          />
        </div>

        {/* Samenvatting-strip: één getal per sectie die eronder volgt */}
        <div className="summary-strip">
          <SummaryChip label="Input nodig"    value={summary.needInfo} tone="warning"
            hint="agent vraagt om jouw instructies" />
          <SummaryChip label="Voorstellen"    value={summary.ready}    tone="accent"
            hint="concrete plannen om te accepteren, aanpassen of afwijzen" />
          <SummaryChip label="Verstuurd"      value={summary.sent}
            hint="jouw aanpassingen wachten op de volgende run" />
          <SummaryChip label="Gefilterd"      value={summary.filtered}
            hint="records die de agent wegfilterde (te onzeker)" />
          <SummaryChip label="Log"            value={summary.done}    muted
            hint="geschiedenis — welke voorstellen zijn accepted / rejected / executed" />
        </div>
      </section>

      {/* Categorie-filter — geldt voor alle secties onder */}
      <div className="cat-filter">
        <span className="muted" style={{ fontSize: 11, marginRight: 6 }}>Filter categorie:</span>
        {CATEGORIES.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => toggleCat(c)}
            className={`cat-filter__chip ${catFilter[c] === false ? 'is-off' : 'is-on'}`}
            title={catFilter[c] === false ? `Toon ${CATEGORY_LABEL[c]}-items` : `Verberg ${CATEGORY_LABEL[c]}-items`}
          >
            <span className={CATEGORY_CLASS[c]} style={{ marginRight: 6 }}>{CATEGORY_LABEL[c]}</span>
            <span className="cat-filter__count">{perCatPending[c] || 0}</span>
          </button>
        ))}
      </div>

      {/* ===== 2a. VOORSTELLEN — ACTIE NODIG ===== */}
      <CollapsibleSection
        id="action"
        collapsed={collapsed.action}
        onToggle={() => toggleCollapsed('action')}
        className="proposal-bucket proposal-bucket--action"
        dot="action"
        title="Actie nodig"
        count={needInfoCount}
        hint="agent mist informatie en kan niet zelf een plan bedenken. Geef antwoord via Antwoord geven — de volgende run zet dat om in een concreet voorstel."
      >
        {actionNeeded.length === 0 ? (
          <div className="empty empty--compact">Geen openstaande vragen van de agent.</div>
        ) : (
          <div className="stack stack--sm">
            {actionNeeded.map(p => <ProposalCard key={p.id} proposal={p} />)}
          </div>
        )}
      </CollapsibleSection>

      {/* ===== 2b. VOORSTELLEN — TE ACCEPTEREN ===== */}
      <CollapsibleSection
        id="ready"
        collapsed={collapsed.ready}
        onToggle={() => toggleCollapsed('ready')}
        className="proposal-bucket proposal-bucket--ready"
        dot="ready"
        title="Te accepteren"
        count={readyCount}
        hint="concrete plannen die je kan accepteren, aanpassen of afwijzen. Herziene voorstellen (na jouw aanpassing) staan bovenaan met een paarse rand."
      >
        {readyToReview.length === 0 ? (
          <div className="empty empty--compact">
            Niks klaar voor review. Klik <strong>+</strong> bij een record onderaan "Andere contactmomenten" om 'm alsnog toe te voegen.
          </div>
        ) : (
          <div className="stack stack--sm">
            {readyToReview.map(p => <ProposalCard key={p.id} proposal={p} />)}
          </div>
        )}
      </CollapsibleSection>

      {/* ===== 4. AANPASSING VERSTUURD — onder Voorstellen, per-record inklapbaar ===== */}
      {sentAmendments.length > 0 && (
        <section>
          <div className="section__head">
            <h2 className="section__title">
              Aanpassing verstuurd <span className="section__count">{sentAmendments.length}</span>
            </h2>
            <span className="section__hint">
              jouw aanpassingen wachten op de volgende Daily Admin-run. Klik op een rij voor detail.
            </span>
          </div>
          <div className="sent-list">
            {sentAmendments.map(p => <SentRow key={p.id} proposal={p} />)}
          </div>
        </section>
      )}

      {/* ===== 4. ANDERE CONTACTMOMENTEN — records die agent níet oppakte, met + knop ===== */}
      <FilteredSection filtered={data.filtered || []} />

      {/* ===== 5. LOG — wat er uiteindelijk is gepushed/afgehandeld ===== */}
      {logProposals.length > 0 && (
        <CollapsibleSection
          id="log"
          collapsed={collapsed.log}
          onToggle={() => toggleCollapsed('log')}
          title="Log"
          count={logProposals.length}
          hint="geschiedenis — wat er uiteindelijk naar HubSpot/Jira is gepushed (executed) of is afgewezen (rejected/failed). Laatste 20."
        >
          <div className="log-list">
            {logProposals.slice(0, 20).map(p => <LogRow key={p.id} proposal={p} />)}
          </div>
        </CollapsibleSection>
      )}
    </div>
  )
}

// ===== Samenvatting-chip voor Status-strip =====

function SummaryChip({ label, value, tone, muted, hint }) {
  const color = tone === 'accent'  ? 'var(--accent)'
              : tone === 'warning' ? 'var(--warning)'
              : muted ? 'var(--text-muted)'
              : 'var(--text)'
  return (
    <div className="summary-chip" title={hint || ''}>
      <div className="summary-chip__value" style={{ color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div className="summary-chip__label">{label}</div>
    </div>
  )
}

// NewProposalForm verwijderd in v19 — handmatig toevoegen via + knop op
// contactmomenten of via Chat-view (categorie 'action_request').

// ===== Verstuurd rij (per-record inklapbaar) =====

function SentRow({ proposal }) {
  const [open, setOpen] = useState(false)
  const amendmentPreview = proposal.amendment
    ? proposal.amendment.split('\n')[0].slice(0, 80) + (proposal.amendment.length > 80 ? '…' : '')
    : '(geen tekst)'

  return (
    <div className="sent-row">
      <button
        type="button"
        className="sent-row__head"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <span className="sent-row__caret">{open ? '▾' : '▸'}</span>
        <span className={CATEGORY_CLASS[proposal.category] || CATEGORY_CLASS.overig}>
          {CATEGORY_LABEL[proposal.category] || proposal.category}
        </span>
        <span className="sent-row__subject">{proposal.subject}</span>
        <span className="sent-row__amend-preview muted">{amendmentPreview}</span>
        <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
          {formatDateTime(proposal.reviewed_at || proposal.created_at)}
        </span>
      </button>
      {open && (
        <div className="sent-row__body">
          <ProposalCard proposal={proposal} />
        </div>
      )}
    </div>
  )
}

// v20: RecordsTable, NeedsInfoCard en buildRecords/extractArtifacts weggehaald.
// Proposal-historie staat in Voorstellen / Verstuurd / Beoordeeld secties.
// needs_info items hebben nu gewoon een ProposalCard met aangepaste knoppen.

// ===== Proposal card =====

function ProposalCard({ proposal, compact }) {
  const [mode, setMode] = useState('view') // view | amending | recategorizing
  const [amendText, setAmendText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState(null)

  const cat = proposal.category || 'overig'
  const status = proposal.status
  const isPending = status === 'pending' || status === 'amended'

  async function call(rpc, payload) {
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc(rpc, payload)
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
      // realtime refetch updatet de UI — geen lokale state nodig
    } catch (e) {
      setErr(e.message || 'netwerkfout')
    }
    setBusy(false)
  }

  async function onAccept() { await call('accept_proposal', { proposal_id: proposal.id }) }
  async function onReject() { await call('reject_proposal', { proposal_id: proposal.id }) }
  async function onAmend()  {
    if (!amendText.trim()) return
    await call('amend_proposal', { proposal_id: proposal.id, amendment_text: amendText.trim() })
    setMode('view'); setAmendText('')
  }
  async function onRecategorize(newCat) {
    if (newCat === cat) { setMode('view'); return }
    await call('recategorize_proposal', { proposal_id: proposal.id, new_category: newCat })
    setMode('view')
  }

  const actions = Array.isArray(proposal.proposal?.actions) ? proposal.proposal.actions : []
  const firefliesOn = proposal.has_fireflies_context === true
  const isRevised   = !!proposal.amended_from && status === 'pending'
  const classes = [
    'proposal',
    compact ? 'proposal--compact' : '',
    `proposal--${status}`,
    isRevised ? 'proposal--revised' : '',
  ].filter(Boolean).join(' ')

  // Expanded note-content — laat alle action.payload.content volledig zien
  // i.p.v. alleen een label. Jelle wil beter kunnen inschatten wat er in
  // de daadwerkelijke note/task komt te staan.
  const notePayloads = actions
    .map(a => a?.payload?.content || a?.payload?.description)
    .filter(Boolean)
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={classes}>
      {/* Twee-koloms head: links info/labels, rechts de grote confidence */}
      <div className="proposal__head">
        <div className="proposal__head-left">
          <select
            className={`cat-select cat-select--${cat}`}
            value={cat}
            onChange={(e) => onRecategorize(e.target.value)}
            disabled={busy || compact}
            title="Wijzig categorie"
            aria-label="Categorie"
          >
            {CATEGORIES.map(c => (
              <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
            ))}
          </select>
          <span className="proposal__subject">{proposal.subject}</span>
          {isRevised && (
            <span className="proposal__revised-tag" title="Dit is een herzien voorstel dat voortkomt uit jouw eerdere aanpassing. Beoordeel het opnieuw.">
              ✎ herzien
            </span>
          )}
          <span className={`proposal__status proposal__status--${status}`}>{status}</span>
          <span
            className={`proposal__fireflies ${firefliesOn ? 'is-on' : 'is-off'}`}
            title={firefliesOn
              ? 'Fireflies-notulen gevonden — gebruikt voor note-content'
              : 'Geen Fireflies-koppeling beschikbaar — note op basis van agenda/mail'}
          >
            ff: {firefliesOn ? '✓' : '—'}
          </span>
          <span className="muted" style={{ fontSize: 11 }}>{formatDateTime(proposal.created_at)}</span>
        </div>
        <div className="proposal__head-right">
          <ConfidenceBadge
            confidence={proposal.confidence}
            reasons={proposal.confidence_reasons}
            needsInfo={proposal.needs_info}
            prominent
          />
        </div>
      </div>

      {/* Plannings-pills: welke elementen zou de agent aanmaken? Extra
           prominent bij needs_info zodat Jelle direct de richting ziet.  */}
      {actions.length > 0 && (
        <PlannedElements actions={actions} needsInfo={proposal.needs_info} />
      )}

      <div className="proposal__summary">{proposal.summary}</div>

      {/* Uitgebreide note-content — laat de daadwerkelijke tekst zien die
           straks in HubSpot/Jira terechtkomt, zodat Jelle kan beoordelen
           of het klopt vóór hij accepteert. */}
      {!compact && notePayloads.length > 0 && (
        <div className="proposal__notes">
          {notePayloads.map((content, i) => {
            const long = content.length > 240
            const shown = expanded || !long ? content : content.slice(0, 240) + '…'
            return (
              <div key={i} className="proposal__note-block">
                <div className="proposal__note-label">note-inhoud</div>
                <div className="proposal__note-content">{shown}</div>
                {long && (
                  <button type="button" className="proposal__note-toggle" onClick={() => setExpanded(v => !v)}>
                    {expanded ? '↑ inklappen' : '↓ toon volledig'}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {actions.length > 0 && (
        <ul className="proposal__actions">
          {actions.map((a, i) => (
            <li key={i}>
              <span className="proposal__action-kind">{a.type || 'actie'}</span>
              <span>{a.label || a.description || JSON.stringify(a)}</span>
            </li>
          ))}
        </ul>
      )}

      {proposal.amendment && (
        <div className="proposal__amendment">
          <span className="muted">Jouw aanpassing: </span>{proposal.amendment}
        </div>
      )}

      {isPending && !compact && (
        mode === 'amending' ? (
          <div className="proposal__amend-form">
            <div className="textarea-wrap">
              <textarea
                className="proposal__amend-input"
                value={amendText}
                onChange={e => setAmendText(e.target.value)}
                placeholder={proposal.needs_info
                  ? "Wat moet de agent met dit record doen? Schrijf (of spreek in) je instructie. De volgende run maakt er een voorstel van."
                  : "Beschrijf kort wat de agent anders moet doen — dit wordt bij de volgende run uitgevoerd. Tip: klik op 🎙 om in te spreken."}
                rows={3}
              />
              <MicButton onTranscript={t => setAmendText(prev => (prev ? `${prev} ${t}` : t).trim())} />
            </div>
            <div className="proposal__btns">
              <button className="btn btn--accent" onClick={onAmend} disabled={busy || !amendText.trim()}>Opslaan</button>
              <button className="btn btn--ghost"  onClick={() => { setMode('view'); setAmendText('') }}>Annuleer</button>
            </div>
          </div>
        ) : proposal.needs_info ? (
          // needs_info=true — agent heeft een richting maar geen volledig plan.
          // Accepteren kan niet, maar Jelle kan wel antwoord geven of afwijzen.
          <div className="proposal__btns">
            <button className="btn btn--warning" onClick={() => setMode('amending')} disabled={busy}>✎ Antwoord geven</button>
            <button className="btn btn--danger"  onClick={onReject} disabled={busy}>✕ Afwijzen</button>
          </div>
        ) : (
          <div className="proposal__btns">
            <button className="btn btn--success" onClick={onAccept} disabled={busy}>✓ Accepteer</button>
            <button className="btn btn--warning" onClick={() => setMode('amending')} disabled={busy}>✎ Aanpassen</button>
            <button className="btn btn--danger"  onClick={onReject} disabled={busy}>✕ Afwijzen</button>
          </div>
        )
      )}

      {err && <div className="proposal__error">⚠ {err}</div>}
    </div>
  )
}

// ===== Inklapbare sectie — gedeelde wrapper voor Actie nodig / Te accepteren / Log =====

function CollapsibleSection({ id, collapsed, onToggle, className = '', dot, title, count, hint, children }) {
  return (
    <section className={`collapsible ${collapsed ? 'is-collapsed' : 'is-expanded'} ${className}`}>
      <button
        type="button"
        className="collapsible__head"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-controls={`collapsible-body-${id}`}
      >
        <span className={`collapsible__caret ${collapsed ? 'is-collapsed' : ''}`} aria-hidden="true">▾</span>
        <h2 className="section__title">
          {dot && <span className={`bucket-dot bucket-dot--${dot}`} aria-hidden="true" />}
          {title} {count > 0 && <span className="section__count">{count}</span>}
        </h2>
        <span className="collapsible__toggle-label">
          {collapsed ? 'klik om uit te klappen' : 'klik om in te klappen'}
        </span>
        {hint && <span className="section__hint collapsible__hint">{hint}</span>}
      </button>
      {!collapsed && (
        <div className="collapsible__body" id={`collapsible-body-${id}`}>
          {children}
        </div>
      )}
    </section>
  )
}

// ===== Log-rij — toont UITEINDELIJK resultaat (execution_result), niet wat Jelle typte =====

function LogRow({ proposal }) {
  const status = proposal.status
  const result = proposal.execution_result || {}
  const cat    = proposal.category || 'overig'

  // Bepaal wat er daadwerkelijk gepushed is per systeem
  const pushedItems = []
  if (result.hubspot_deal_id)   pushedItems.push({ label: 'HubSpot deal',     value: result.hubspot_deal_id })
  if (result.hubspot_company_id) pushedItems.push({ label: 'HubSpot company', value: result.hubspot_company_id })
  if (result.note_id)           pushedItems.push({ label: 'Note',            value: result.note_id })
  if (result.task_id)           pushedItems.push({ label: 'Task',            value: result.task_id })
  if (result.contact_id)        pushedItems.push({ label: 'Contact',         value: result.contact_id })
  if (result.jira_key)          pushedItems.push({ label: 'Jira',            value: result.jira_key })
  if (result.card_id)           pushedItems.push({ label: 'Kanban-kaart',    value: result.card_id })

  const whenISO = proposal.executed_at || proposal.reviewed_at || proposal.created_at

  return (
    <div className={`log-row log-row--${status}`}>
      <div className="log-row__head">
        <span className={`log-row__dot log-row__dot--${status}`} aria-hidden="true" />
        <span className={CATEGORY_CLASS[cat] || CATEGORY_CLASS.overig}>{CATEGORY_LABEL[cat] || cat}</span>
        <span className="log-row__subject">{proposal.subject}</span>
        <span className={`proposal__status proposal__status--${status}`}>{status}</span>
        <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>{formatDateTime(whenISO)}</span>
      </div>
      <div className="log-row__body">
        {status === 'executed' && pushedItems.length > 0 ? (
          <ul className="log-row__pushed">
            {pushedItems.map((p, i) => (
              <li key={i}>
                <span className="log-row__pushed-label">{p.label}</span>
                <span className="log-row__pushed-value mono">{p.value}</span>
              </li>
            ))}
          </ul>
        ) : status === 'executed' ? (
          <div className="log-row__meta muted">uitgevoerd — geen specifiek resultaat vastgelegd</div>
        ) : status === 'failed' ? (
          <div className="log-row__error">⚠ {result.error || 'onbekende fout'}</div>
        ) : status === 'rejected' ? (
          <div className="log-row__meta muted">afgewezen — geen actie doorgevoerd</div>
        ) : status === 'accepted' ? (
          <div className="log-row__meta muted">geaccepteerd — wacht op volgende run voor uitvoering</div>
        ) : null}
      </div>
    </div>
  )
}

// ===== Confidence-badge — laat zien hoe zeker de agent is én waarom =====

function ConfidenceBadge({ confidence, reasons, needsInfo, prominent }) {
  const [open, setOpen] = useState(false)
  if (confidence == null) {
    return (
      <span className={`confidence confidence--unknown ${prominent ? 'confidence--prominent' : ''}`} title="Agent heeft geen confidence-score opgegeven">
        —
      </span>
    )
  }
  const pct = Math.round(Number(confidence) * 100)
  const tone = needsInfo ? 'warning'
             : pct >= 80 ? 'high'
             : pct >= 60 ? 'mid'
             :             'low'

  const reasonList = Array.isArray(reasons)
    ? reasons.filter(r => r && (r.factor || r.reason))
    : []

  return (
    <span className="confidence-wrap">
      <button
        type="button"
        className={`confidence confidence--${tone} ${prominent ? 'confidence--prominent' : ''}`}
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v) }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        title={`Confidence ${pct}% — klik voor uitleg waarom`}
        aria-expanded={open}
      >
        <span className="confidence__pct">{pct}%</span>
        <span className="confidence__info" aria-hidden="true">ⓘ</span>
      </button>
      {open && (
        <div className={`confidence__popover ${prominent ? 'confidence__popover--right' : ''}`} role="tooltip">
          <div className="confidence__popover-head">Waarom {pct}%?</div>
          {reasonList.length === 0 ? (
            <div className="muted" style={{ fontSize: 12 }}>
              Geen toelichting beschikbaar. Agent heeft geen redenen vastgelegd bij dit voorstel.
            </div>
          ) : (
            <ul className="confidence__reasons">
              {reasonList.map((r, i) => {
                const label  = r.factor || r.reason || 'factor'
                const weight = typeof r.weight === 'number' ? r.weight : null
                return (
                  <li key={i}>
                    <span className="confidence__factor">{label}</span>
                    {weight != null && (
                      <span className="confidence__weight">
                        {weight > 0 ? '+' : ''}{Math.round(weight * 100)}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </span>
  )
}

// ===== PlannedElements — pills die samenvatten welke elementen de agent wil aanmaken =====

const ELEMENT_LABELS = {
  stage:   { label: 'Stage-update',     icon: '↗',  className: 'plan-pill--stage'   },
  note:    { label: 'Note',             icon: '✎',  className: 'plan-pill--note'    },
  task:    { label: 'Task',             icon: '✓',  className: 'plan-pill--task'    },
  contact: { label: 'Contact',          icon: '⊕',  className: 'plan-pill--contact' },
  jira:    { label: 'Jira-ticket',      icon: '⊞',  className: 'plan-pill--jira'    },
  card:    { label: 'Recruitment-kaart', icon: '⊠', className: 'plan-pill--card'    },
  comment: { label: 'Comment',          icon: '💬', className: 'plan-pill--note'    },
}

function PlannedElements({ actions, needsInfo }) {
  // Tel per element-type zodat dubbele acties één pill met (2x) worden
  const counts = actions.reduce((acc, a) => {
    const key = a?.type || 'overig'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
  const keys = Object.keys(counts)
  if (keys.length === 0) return null

  return (
    <div className={`plan-pills ${needsInfo ? 'plan-pills--needs-info' : ''}`}>
      <span className="plan-pills__prefix">
        {needsInfo ? 'wil waarschijnlijk aanmaken:' : 'voorgestelde acties:'}
      </span>
      {keys.map(k => {
        const meta = ELEMENT_LABELS[k] || { label: k, icon: '•', className: 'plan-pill--overig' }
        const c = counts[k]
        return (
          <span key={k} className={`plan-pill ${meta.className}`} title={`${meta.label}${c > 1 ? ` (${c}×)` : ''}`}>
            <span className="plan-pill__icon" aria-hidden="true">{meta.icon}</span>
            <span className="plan-pill__label">{meta.label}</span>
            {c > 1 && <span className="plan-pill__count">{c}×</span>}
          </span>
        )
      })}
    </div>
  )
}

// ===== Andere contactmomenten — records die agent NIET oppakte (score 0-100) =====

function FilteredSection({ filtered }) {
  const [domainFilter, setDomainFilter] = useState('')
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)

  // Alleen items die nog niet als voorstel zijn opgepakt EN die boven de
  // minimum-score (FILTERED_MIN_SCORE) zitten — onder die drempel is het
  // rommel die niet eens in "Andere contactmomenten" hoeft (marketing-mail,
  // nieuwsbrieven, bulk-uitnodigingen). De skill schrijft ze vanaf v1.3 niet
  // meer weg, maar voor oude records filtert de dashboard zelf ook.
  const open = filtered
    .filter(f => !f.forced_proposal_id)
    .filter(f => (Number(f.confidence) || 0) >= FILTERED_MIN_SCORE)
    .sort((a, b) => (Number(b.confidence) || 0) - (Number(a.confidence) || 0))
  const hiddenLowCount = filtered
    .filter(f => !f.forced_proposal_id)
    .filter(f => (Number(f.confidence) || 0) < FILTERED_MIN_SCORE).length
  const filteredByDomain = domainFilter
    ? open.filter(f => (f.sender_domain || '').includes(domainFilter))
    : open
  const uniqueDomains = [...new Set(open.map(f => f.sender_domain).filter(Boolean))].sort()

  async function force(id) {
    setBusy(id); setErr(null)
    try {
      const { data, error } = await supabase.rpc('force_propose', { record_id: id })
      if (error)                        setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
    } catch (e) { setErr(e.message || 'netwerkfout') }
    setBusy(null)
  }

  return (
    <section>
      <div className="section__head">
        <h2 className="section__title">
          Andere contactmomenten {open.length > 0 && <span className="section__count">{open.length}</span>}
        </h2>
        <span className="section__hint">
          contacten uit mail/agenda die de agent zag maar níet als voorstel oppakte (score te laag voor automatisch plan). Klik <strong>+</strong> om er alsnog een voorstel van te maken.
          {hiddenLowCount > 0 && (
            <> <span className="muted">({hiddenLowCount} extra met score &lt; {Math.round(FILTERED_MIN_SCORE * 100)} verborgen — vrijwel zeker rommel)</span></>
          )}
        </span>
      </div>

      {open.length === 0 ? (
        <div className="empty">
          Niks om nog toe te voegen. Zodra Daily Admin scant en records tegenkomt die de filter niet haalden, verschijnen ze hier.
        </div>
      ) : (
        <>
          {uniqueDomains.length > 5 && (
            <div className="filter-domain">
              <input
                type="text"
                className="filter-domain__input"
                placeholder="Filter op domein (bv. ritense.com)"
                value={domainFilter}
                onChange={e => setDomainFilter(e.target.value)}
              />
              {domainFilter && (
                <button className="btn btn--ghost" onClick={() => setDomainFilter('')}>wis</button>
              )}
            </div>
          )}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="num" style={{ width: 60 }}>Score</th>
                  <th style={{ width: 110 }}>Wanneer</th>
                  <th>Onderwerp / gesprek</th>
                  <th>Afzender / domein</th>
                  <th>Reden niet-opgepakt</th>
                  <th style={{ width: 50 }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredByDomain.slice(0, 60).map(f => {
                  const score = f.confidence != null ? Math.round(Number(f.confidence) * 100) : null
                  const scoreClass = score == null ? 'muted'
                                   : score >= 50 ? 'score--high'
                                   : score >= 30 ? 'score--mid'
                                   : 'score--low'
                  return (
                    <tr key={f.id}>
                      <td className={`num score ${scoreClass}`}>{score != null ? score : '—'}</td>
                      <td className="mono" style={{ fontSize: 12 }}>{formatDateTime(f.scanned_at)}</td>
                      <td style={{ color: 'var(--text)', maxWidth: 280 }} title={f.subject || ''}>
                        {f.subject || f.company_guess || '—'}
                        {f.source && <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>· {f.source}</span>}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {f.sender_domain || f.sender || '—'}
                      </td>
                      <td className="muted" style={{ fontSize: 12, maxWidth: 260 }} title={f.reason || ''}>
                        {(f.reason || '').slice(0, 60) || '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          className="plus-btn"
                          onClick={() => force(f.id)}
                          disabled={busy === f.id}
                          title="Maak hier alsnog een voorstel van — Daily Admin pakt het bij volgende run op"
                          aria-label="Toevoegen aan voorstellen"
                        >
                          {busy === f.id ? '…' : '+'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {err && <div className="proposal__error" style={{ marginTop: 8 }}>⚠ {err}</div>}
        </>
      )}
    </section>
  )
}

// RecordRow, buildRecords, extractArtifacts weggehaald in v20.
