import { useMemo, useState } from 'react'
import AgentCard     from '../AgentCard'
import MicButton     from '../MicButton'
import { supabase }  from '../../lib/supabase'

const AGENT = 'hubspot-daily-sync'

const ACTION_STATUSES = new Set(['open', 'pending'])
const AUTO_HANDLED_STATUSES = new Set(['stale', 'expired', 'skipped', 'auto_resolved'])
const ANSWERED_STATUSES = new Set(['answered', 'resolved', 'done'])
// superseded = open_question is opgegaan in een proposal-rij, niet meer tonen
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

const STORAGE_KEY_FILTER = 'lm-dashboard-proposal-categories'

function loadFilterState() {
  if (typeof localStorage === 'undefined') return null
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_FILTER)) } catch { return null }
}

function saveFilterState(s) {
  try { localStorage.setItem(STORAGE_KEY_FILTER, JSON.stringify(s)) } catch {}
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

function extractArtifacts(q) {
  const artifacts = []
  const ctx = q.context || {}
  if (ctx.note_id || ctx.note_created)       artifacts.push('Note')
  if (ctx.task_id || ctx.task_created)       artifacts.push('Task')
  if (ctx.contact_id || ctx.contact_created) artifacts.push('Contact')
  if (ctx.deal_created)                      artifacts.push('Deal')
  if (ctx.stage_before && ctx.stage_after)   artifacts.push(`Stage: ${ctx.stage_before} → ${ctx.stage_after}`)
  else if (ctx.dealstage_after)              artifacts.push(`Stage → ${ctx.dealstage_after}`)
  if (ctx.email_sent)                        artifacts.push('E-mail')
  const text = [q.default_action, q.answer].filter(Boolean).join(' ').toLowerCase()
  if (text) {
    if (!artifacts.some(a => a.toLowerCase().includes('note'))    && /\bnote[s]?\b|notitie/.test(text))    artifacts.push('Note')
    if (!artifacts.some(a => a.toLowerCase().includes('task'))    && /\btask[s]?\b|taak/.test(text))       artifacts.push('Task')
    if (!artifacts.some(a => a.toLowerCase().includes('contact')) && /\bcontact/.test(text))              artifacts.push('Contact')
    if (/uitgesteld|overslaan|sla .* over|skip/i.test(q.default_action || '')) artifacts.push('Overgeslagen')
  }
  return artifacts
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

  const visibleProposals = allProposals.filter(p => catFilter[p.category] !== false)
  // Voorstellen: agent heeft concreet plan (needs_info=false, status=pending).
  const readyProposals   = visibleProposals.filter(p => p.status === 'pending' && !p.needs_info)
  // Aanpassing verstuurd: Jelle heeft amendment opgeslagen, wacht op volgende run.
  const sentAmendments   = visibleProposals.filter(p => p.status === 'amended')
  // Input nodig: agent weet niet wat te doen. Tekstveld + Overslaan.
  const needInfo         = visibleProposals.filter(p => p.status === 'pending' && p.needs_info)
  const reviewedProposals = visibleProposals.filter(p => ['accepted', 'rejected', 'executed', 'failed'].includes(p.status))
  const perCatPending = CATEGORIES.reduce((acc, c) => {
    acc[c] = allProposals.filter(p => p.category === c &&
      ((p.status === 'pending' || p.status === 'amended') || (p.status === 'pending' && p.needs_info))
    ).length
    return acc
  }, {})

  // Chronologisch records-log: alle records die iets had — vragen + proposals + stale items
  // Sorteer op meest recente actie/activiteit.
  const records = useMemo(() => buildRecords(allQs, allProposals), [allQs, allProposals])

  // Samenvatting voor de Status-strip
  const summary = {
    ready:    readyProposals.length,
    needInfo: needInfo.length,
    sent:     sentAmendments.length,
    filtered: (data.filtered || []).filter(f => !f.forced_proposal_id).length,
    done:     reviewedProposals.length,
  }

  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>

      {/* ===== 1. STATUS — compacte agent-card + samenvatting van alle buckets ===== */}
      <section>
        <div className="section__head">
          <h2 className="section__title">Status</h2>
          <span className="section__hint">wat er op Daily Admin klaar ligt voor jou</span>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
          <AgentCard
            agent={AGENT}
            schedule={schedule}
            latestRun={latestRun}
            history={history}
            openQuestions={pendingForCard}
          />
        </div>

        {/* Samenvatting-strip: snel zien hoeveel er in elke bucket zit */}
        <div className="summary-strip">
          <SummaryChip label="Voorstellen"    value={summary.ready}    tone="accent"
            hint="concrete plannen om te accepteren, aanpassen of afwijzen" />
          <SummaryChip label="Input nodig"    value={summary.needInfo} tone="warning"
            hint="agent vraagt om jouw instructies" />
          <SummaryChip label="Verstuurd"      value={summary.sent}
            hint="jouw aanpassingen wachten op de volgende run" />
          <SummaryChip label="Gefilterd"      value={summary.filtered}
            hint="records die de agent wegfilterde (te onzeker)" />
          <SummaryChip label="Beoordeeld"     value={summary.done}    muted
            hint="historie van accepted/rejected/executed" />
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

      {/* ===== 2. INPUT NODIG — hoogste urgentie, jouw input nodig ===== */}
      {needInfo.length > 0 && (
        <section>
          <div className="section__head">
            <h2 className="section__title">
              Input nodig <span className="section__count">{needInfo.length}</span>
            </h2>
            <span className="section__hint">
              agent heeft iets gezien maar weet niet wat — typ (of spreek in) wat er moet gebeuren. Daarna schuift het naar Voorstellen.
            </span>
          </div>
          <div className="stack stack--sm">
            {needInfo.map(p => <NeedsInfoCard key={p.id} proposal={p} />)}
          </div>
        </section>
      )}

      {/* ===== 3. VOORSTELLEN — klaar voor accept/amend/reject (belangrijkste sectie) ===== */}
      <section>
        <div className="section__head">
          <h2 className="section__title">
            Voorstellen {readyProposals.length > 0 && <span className="section__count">{readyProposals.length}</span>}
          </h2>
          <span className="section__hint">
            concrete plannen — accepteer, pas aan of wijs af. Niks wordt doorgevoerd zonder jouw groen licht.
          </span>
        </div>

        <NewProposalForm />

        {readyProposals.length === 0 ? (
          <div className="empty" style={{ marginTop: 'var(--s-3)' }}>
            Geen voorstellen klaar voor review. Voeg hierboven handmatig een nieuw item toe, of wacht op de volgende Daily Admin-run.
          </div>
        ) : (
          <div className="stack stack--sm" style={{ marginTop: 'var(--s-3)' }}>
            {readyProposals.map(p => <ProposalCard key={p.id} proposal={p} />)}
          </div>
        )}
      </section>

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

      {/* ===== 5. GEFILTERD — records die de agent wegfilterde, met forceer-knop ===== */}
      <FilteredSection filtered={data.filtered || []} />

      {/* ===== 6. ALLE CONTACTMOMENTEN — tabel met actie per rij ===== */}
      <section>
        <div className="section__head">
          <h2 className="section__title">
            Alle contactmomenten {records.length > 0 && <span className="section__count">{records.length}</span>}
          </h2>
          <span className="section__hint">
            alles wat Daily Admin heeft aangeraakt — klik op "→ opnieuw voorstellen" om een record terug te brengen naar Voorstellen.
          </span>
        </div>
        {records.length === 0 ? (
          <div className="empty">Nog geen contactmomenten geregistreerd.</div>
        ) : (
          <RecordsTable records={records} />
        )}
      </section>

      {/* ===== 7. BEOORDEELDE voorstellen — historie, compact ===== */}
      {reviewedProposals.length > 0 && (
        <section>
          <div className="section__head">
            <h2 className="section__title">
              Beoordeeld <span className="section__count">{reviewedProposals.length}</span>
            </h2>
            <span className="section__hint">historie — accepted / rejected / executed</span>
          </div>
          <div className="stack stack--sm">
            {reviewedProposals.slice(0, 20).map(p => <ProposalCard key={p.id} proposal={p} compact />)}
          </div>
        </section>
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

// ===== Nieuw voorstel handmatig toevoegen =====

function NewProposalForm() {
  const [open, setOpen] = useState(false)
  const [subject, setSubject] = useState('')
  const [category, setCategory] = useState('overig')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function submit() {
    if (!subject.trim()) return
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc('create_manual_proposal', {
        subject: subject.trim(),
        category,
        description: description.trim() || null,
        target_agent: 'hubspot-daily-sync',
      })
      if (error)                        setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
      else { setSubject(''); setDescription(''); setCategory('overig'); setOpen(false) }
    } catch (e) { setErr(e.message || 'netwerkfout') }
    setBusy(false)
  }

  if (!open) {
    return (
      <button className="btn btn--ghost btn--add-proposal" onClick={() => setOpen(true)}>
        + handmatig voorstel toevoegen
      </button>
    )
  }

  return (
    <div className="new-proposal">
      <div className="new-proposal__row">
        <input
          type="text"
          className="new-proposal__input"
          value={subject}
          onChange={e => setSubject(e.target.value)}
          placeholder="Subject (bv. Dutch Legal Tech)"
          autoFocus
        />
        <select
          className={`cat-select cat-select--${category}`}
          value={category}
          onChange={e => setCategory(e.target.value)}
          disabled={busy}
        >
          {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
      </div>
      <div className="textarea-wrap">
        <textarea
          className="proposal__amend-input"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Wat moet de agent hiermee doen? (optioneel — anders vraagt hij later om details)"
          rows={2}
        />
        <MicButton onTranscript={t => setDescription(prev => (prev ? `${prev} ${t}` : t).trim())} />
      </div>
      <div className="new-proposal__btns">
        <button className="btn btn--accent" onClick={submit} disabled={busy || !subject.trim()}>
          {busy ? 'Toevoegen…' : 'Toevoegen'}
        </button>
        <button className="btn btn--ghost" onClick={() => { setOpen(false); setSubject(''); setDescription('') }}>
          Annuleer
        </button>
        {err && <span className="record-row__msg">⚠ {err}</span>}
      </div>
    </div>
  )
}

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

// ===== Records tabel met "opnieuw voorstellen" actie =====

function RecordsTable({ records }) {
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)

  async function cloneRow(proposalId) {
    setBusy(proposalId); setErr(null)
    try {
      const { data, error } = await supabase.rpc('clone_as_proposal', { source_id: proposalId })
      if (error)                        setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
    } catch (e) { setErr(e.message || 'netwerkfout') }
    setBusy(null)
  }

  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 110 }}>Wanneer</th>
              <th style={{ width: 110 }}>Categorie</th>
              <th>Subject</th>
              <th>Samenvatting</th>
              <th>Status</th>
              <th style={{ width: 150 }}></th>
            </tr>
          </thead>
          <tbody>
            {records.slice(0, 60).map(r => {
              const isProposal = r.key.startsWith('p-')
              const proposalId = isProposal ? r.key.slice(2) : null
              const canClone = isProposal && ['rejected','executed','failed'].includes(r.raw.status)
              const canAmend = isProposal && r.raw.status !== 'amended' && !canClone
              return (
                <tr key={r.key}>
                  <td className="mono" style={{ fontSize: 12 }}>{formatDateTime(r.when)}</td>
                  <td>
                    <span className={CATEGORY_CLASS[r.category] || CATEGORY_CLASS.overig}>
                      {CATEGORY_LABEL[r.category] || r.category}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text)', fontWeight: 500, maxWidth: 220 }} title={r.subject}>
                    {r.subject}
                  </td>
                  <td className="muted" style={{ fontSize: 12, maxWidth: 320 }} title={r.summary}>
                    {(r.summary || '').slice(0, 80)}{(r.summary || '').length > 80 ? '…' : ''}
                  </td>
                  <td>
                    <span className={`record-row__label record-row__label--${r.kind}`} style={{ whiteSpace: 'nowrap' }}>
                      {r.label}
                    </span>
                  </td>
                  <td>
                    {canClone ? (
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => cloneRow(proposalId)}
                        disabled={busy === proposalId}
                        title="Maak een nieuw voorstel op basis van dit record"
                      >
                        {busy === proposalId ? '…' : '→ opnieuw'}
                      </button>
                    ) : canAmend ? (
                      <span className="muted" style={{ fontSize: 11 }}>zie Voorstellen</span>
                    ) : (
                      <span className="muted" style={{ fontSize: 11 }}>—</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {err && <div className="proposal__error" style={{ marginTop: 8 }}>⚠ {err}</div>}
      {records.length > 60 && (
        <div className="muted" style={{ fontSize: 11, textAlign: 'center', marginTop: 8 }}>
          {records.length - 60} oudere records niet getoond
        </div>
      )}
    </>
  )
}

// ===== Input nodig card =====

function NeedsInfoCard({ proposal }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function call(rpc, payload) {
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc(rpc, payload)
      if (error)           setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
    } catch (e) { setErr(e.message || 'netwerkfout') }
    setBusy(false)
  }

  async function submit() {
    if (!text.trim()) return
    await call('amend_proposal', { proposal_id: proposal.id, amendment_text: text.trim() })
    setText('')
  }
  async function skip() {
    await call('reject_proposal', { proposal_id: proposal.id })
  }

  const cat = proposal.category || 'overig'
  const ctxEntries = summarizeContext(proposal.context) || []

  return (
    <div className="needs-info">
      <div className="needs-info__head">
        <span className={CATEGORY_CLASS[cat] || CATEGORY_CLASS.overig}>
          {CATEGORY_LABEL[cat] || cat}
        </span>
        <span className="needs-info__subject">{proposal.subject}</span>
        <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>{formatDateTime(proposal.created_at)}</span>
      </div>
      <div className="needs-info__question">{proposal.summary}</div>

      {ctxEntries.length > 0 && (
        <div className="inbox-item__ctx" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
          {ctxEntries.slice(0, 6).map(([k, v]) => (
            <span key={k} className="inbox-item__ctx-pill">
              <span className="muted">{k}:</span> {String(v)}
            </span>
          ))}
        </div>
      )}

      <div className="textarea-wrap">
        <textarea
          className="proposal__amend-input"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Wat moet er gebeuren? Bijv: 'Note maken dat CV binnenkomt volgende week' — Daily Admin leest dit bij de volgende run en maakt er een voorstel van. Tip: 🎙 om in te spreken."
          rows={3}
        />
        <MicButton onTranscript={t => setText(prev => (prev ? `${prev} ${t}` : t).trim())} />
      </div>
      <div className="needs-info__btns">
        <button className="btn btn--accent" onClick={submit} disabled={busy || !text.trim()}>Versturen</button>
        <button className="btn btn--ghost"  onClick={skip}   disabled={busy}>Overslaan</button>
        {err && <span className="record-row__msg">⚠ {err}</span>}
      </div>
    </div>
  )
}

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

  return (
    <div className={`proposal ${compact ? 'proposal--compact' : ''} proposal--${status}`}>
      <div className="proposal__head">
        {/* Category dropdown — native select */}
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
        <span className={`proposal__status proposal__status--${status}`}>{status}</span>
        <span
          className={`proposal__fireflies ${firefliesOn ? 'is-on' : 'is-off'}`}
          title={firefliesOn
            ? 'Fireflies-notulen gevonden — gebruikt voor note-content'
            : 'Geen Fireflies-koppeling beschikbaar — note op basis van agenda/mail'}
        >
          ff: {firefliesOn ? '✓' : '—'}
        </span>
        <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>{formatDateTime(proposal.created_at)}</span>
      </div>
      <div className="proposal__summary">{proposal.summary}</div>

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
                placeholder="Beschrijf kort wat de agent anders moet doen — dit wordt bij de volgende run uitgevoerd. Tip: klik op 🎙 om in te spreken."
                rows={3}
              />
              <MicButton onTranscript={t => setAmendText(prev => (prev ? `${prev} ${t}` : t).trim())} />
            </div>
            <div className="proposal__btns">
              <button className="btn btn--accent" onClick={onAmend} disabled={busy || !amendText.trim()}>Opslaan</button>
              <button className="btn btn--ghost"  onClick={() => { setMode('view'); setAmendText('') }}>Annuleer</button>
            </div>
          </div>
        ) : (
          <div className="proposal__btns">
            <button className="btn btn--accent" onClick={onAccept} disabled={busy}>✓ Accepteer</button>
            <button className="btn btn--ghost"  onClick={() => setMode('amending')} disabled={busy}>✎ Aanpassen</button>
            <button className="btn btn--ghost proposal__reject" onClick={onReject} disabled={busy}>✕ Afwijzen</button>
          </div>
        )
      )}

      {err && <div className="proposal__error">⚠ {err}</div>}
    </div>
  )
}

// ===== Gefilterd — records die de agent wegfilterde, met forceer-knop =====

function FilteredSection({ filtered }) {
  const [domainFilter, setDomainFilter] = useState('')
  const [busy, setBusy] = useState(null) // id van rij die nu wordt geforceerd
  const [err, setErr] = useState(null)

  const open = filtered.filter(f => !f.forced_proposal_id)
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
          Gefilterd {open.length > 0 && <span className="section__count">{open.length}</span>}
        </h2>
        <span className="section__hint">
          records die de agent zag maar wegfilterde (te onzeker). Geen klanten/partners/recruitment herkend — klik → voorstel als je ze alsnog wilt oppakken.
        </span>
      </div>

      {open.length === 0 ? (
        <div className="empty">
          Geen weggefilterde records. Zodra Daily Admin draait en records met confidence &lt; 0.4 tegenkomt, verschijnen ze hier.
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
                  <th style={{ width: 110 }}>Wanneer</th>
                  <th>Onderwerp / gesprek</th>
                  <th>Afzender / domein</th>
                  <th className="num">Conf.</th>
                  <th>Reden</th>
                  <th style={{ width: 120 }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredByDomain.slice(0, 60).map(f => (
                  <tr key={f.id}>
                    <td className="mono" style={{ fontSize: 12 }}>{formatDateTime(f.scanned_at)}</td>
                    <td style={{ color: 'var(--text)', maxWidth: 280 }} title={f.subject || ''}>
                      {f.subject || f.company_guess || '—'}
                      {f.source && <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>· {f.source}</span>}
                    </td>
                    <td className="muted" style={{ fontSize: 12 }}>
                      {f.sender_domain || f.sender || '—'}
                    </td>
                    <td className="num muted">{f.confidence != null ? Number(f.confidence).toFixed(2) : '—'}</td>
                    <td className="muted" style={{ fontSize: 12, maxWidth: 260 }} title={f.reason || ''}>
                      {(f.reason || '').slice(0, 60) || '—'}
                    </td>
                    <td>
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={() => force(f.id)}
                        disabled={busy === f.id}
                        title="Maak hier alsnog een voorstel van — Daily Admin pakt het bij volgende run op"
                      >
                        {busy === f.id ? '…' : '→ voorstel'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {err && <div className="proposal__error" style={{ marginTop: 8 }}>⚠ {err}</div>}
        </>
      )}
    </section>
  )
}

// ===== Chronologisch records-log =====

function buildRecords(questions, proposals) {
  const rows = []

  for (const q of questions) {
    const subject = q.context?.company || q.context?.bedrijf || q.context?.deal_name || null
    let kind, label
    if (ACTION_STATUSES.has(q.status))      { kind = 'needs_action';   label = 'actie nodig' }
    else if (ANSWERED_STATUSES.has(q.status)) { kind = 'answered';     label = 'door jou beantwoord' }
    else                                    { kind = 'auto_handled';  label = 'auto-afgehandeld' }
    rows.push({
      key: `q-${q.id}`,
      kind,
      label,
      subject: subject || '(geen bedrijf)',
      summary: q.question,
      artifacts: extractArtifacts(q),
      default_action: q.default_action,
      answer: q.answer,
      when: q.answered_at || q.expires_at || q.asked_at,
      category: 'klant',
      raw: q,
    })
  }

  for (const p of proposals) {
    let kind, label
    if (p.status === 'pending' || p.status === 'amended') { kind = 'needs_action';  label = 'voorstel open' }
    else if (p.status === 'accepted')                      { kind = 'accepted';     label = 'geaccepteerd' }
    else if (p.status === 'rejected')                      { kind = 'rejected';     label = 'afgewezen' }
    else if (p.status === 'executed')                      { kind = 'auto_handled'; label = 'uitgevoerd' }
    else                                                   { kind = 'auto_handled'; label = p.status }
    rows.push({
      key: `p-${p.id}`,
      kind,
      label,
      subject: p.subject,
      summary: p.summary,
      artifacts: (p.proposal?.actions || []).map(a => a.label || a.type).filter(Boolean),
      default_action: p.default_action,
      answer: p.amendment,
      when: p.reviewed_at || p.created_at,
      category: p.category || 'overig',
      raw: p,
    })
  }

  rows.sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0))
  return rows
}

// Oude RecordRow (card-layout) verwijderd in v18 — vervangen door RecordsTable.
