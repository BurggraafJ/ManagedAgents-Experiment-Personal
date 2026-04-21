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
  // Eén "Voorstellen"-lijst: zowel concrete plannen als needs_info items.
  // needs_info=true komt eerst (urgenter — wacht op jouw input), daarna
  // concrete plannen gesorteerd op created_at desc.
  const openProposals = visibleProposals
    .filter(p => p.status === 'pending')
    .sort((a, b) => {
      if (a.needs_info !== b.needs_info) return a.needs_info ? -1 : 1
      return new Date(b.created_at) - new Date(a.created_at)
    })
  const needInfoCount = openProposals.filter(p => p.needs_info).length
  const readyCount    = openProposals.length - needInfoCount
  // Aanpassing verstuurd: Jelle heeft amendment opgeslagen, wacht op volgende run.
  const sentAmendments   = visibleProposals.filter(p => p.status === 'amended')
  const reviewedProposals = visibleProposals.filter(p => ['accepted', 'rejected', 'executed', 'failed'].includes(p.status))
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
    done:     reviewedProposals.length,
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

      {/* ===== 2. VOORSTELLEN (inclusief items met actie nodig) ===== */}
      <section>
        <div className="section__head">
          <h2 className="section__title">
            Voorstellen {openProposals.length > 0 && <span className="section__count">{openProposals.length}</span>}
            {needInfoCount > 0 && (
              <span className="pill s-warning" style={{ marginLeft: 10, fontSize: 10 }}>
                {needInfoCount} actie nodig
              </span>
            )}
          </h2>
          <span className="section__hint">
            items met "actie nodig" staan bovenaan (agent mist info — geef antwoord via Aanpassen). Daarna concrete plannen die je kan accepteren, aanpassen of afwijzen.
          </span>
        </div>

        {openProposals.length === 0 ? (
          <div className="empty">
            Niks klaar voor review. Klik op <strong>+</strong> bij een record onderaan "Andere contactmomenten" om 'm alsnog toe te voegen.
          </div>
        ) : (
          <div className="stack stack--sm">
            {openProposals.map(p => <ProposalCard key={p.id} proposal={p} />)}
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

      {/* ===== 4. ANDERE CONTACTMOMENTEN — records die agent níet oppakte, met + knop ===== */}
      <FilteredSection filtered={data.filtered || []} />

      {/* ===== 5. BEOORDEELDE voorstellen — historie, compact ===== */}
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
          // needs_info=true — agent heeft geen plan, dus Accepteer is onmogelijk
          <div className="proposal__btns">
            <button className="btn btn--accent" onClick={() => setMode('amending')} disabled={busy}>✎ Antwoord geven</button>
            <button className="btn btn--ghost proposal__reject" onClick={onReject} disabled={busy}>✕ Afwijzen</button>
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

// ===== Andere contactmomenten — records die agent NIET oppakte (score 0-100) =====

function FilteredSection({ filtered }) {
  const [domainFilter, setDomainFilter] = useState('')
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)

  // Alleen items die nog niet als voorstel zijn opgepakt, gesorteerd op
  // confidence DESC (hoogste score bovenaan — meest waarschijnlijk relevant).
  const open = filtered
    .filter(f => !f.forced_proposal_id)
    .sort((a, b) => (Number(b.confidence) || 0) - (Number(a.confidence) || 0))
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
          contacten uit mail/agenda die de agent zag maar níet als voorstel oppakte. Score 0-100 = hoe waarschijnlijk relevant. Klik <strong>+</strong> om er alsnog een voorstel van te maken; de volgende run werkt het uit. Items die al bij Voorstellen staan verschijnen hier niet.
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
