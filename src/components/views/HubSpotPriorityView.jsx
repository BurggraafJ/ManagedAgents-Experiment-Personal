import { useMemo, useState } from 'react'
import AgentCard from '../AgentCard'
import {
  AGENT,
  CATEGORIES,
  CATEGORY_LABEL,
  CATEGORY_CLASS,
  PipelineLookupContext,
  buildPipelineLookup,
  ProposalCard,
} from './HubSpotView'
import {
  filterAgentProposals,
  groupProposals,
  GROUP_META,
  CardBadge,
  CardCategory,
  CardPipelineStage,
  CardOwnerAvatar,
  CardActionKinds,
  CardConfidence,
} from './hubspot-shared.jsx'

// Priority variant — zelfde sectie-concept, maar met visuele hiërarchie:
// de 3 meest-urgente items krijgen hero-cards bovenaan (groot, veel info).
// Rest wordt in een 2-koloms compact-grid eronder gepresenteerd. Aandacht
// wordt gestuurd naar wat er echt toe doet zonder extra klik.
export default function HubSpotPriorityView({ data }) {
  const pipelineLookup = useMemo(() => buildPipelineLookup(data.pipelines || []), [data.pipelines])
  const schedule  = data.schedules.find(s => s.agent_name === AGENT)
  const latestRun = data.latestRuns[AGENT]
  const history   = data.history[AGENT] || []
  const all = useMemo(() => filterAgentProposals(data), [data])

  const [catFilter, setCatFilter] = useState({ klant: true, partner: true, recruitment: true, overig: true })
  const toggleCat = c => setCatFilter(prev => ({ ...prev, [c]: !prev[c] }))

  const visible = all.filter(p => catFilter[p.category] !== false)
  const buckets = useMemo(() => groupProposals(visible), [visible])

  // Urgentie-score: needs_info + oud + hoge confidence = urgent.
  // Herziene proposals staan ook hoog (jouw feedback is al ingewerkt).
  const urgentPool = [...buckets.need_input, ...buckets.to_review]
  const withUrgency = urgentPool.map(p => {
    const ageHours = (Date.now() - new Date(p.created_at)) / 3_600_000
    const revisedBoost = p.amended_from ? 30 : 0
    const needsBoost   = p.needs_info    ? 20 : 0
    const confBoost    = (p.confidence || 0) * 15
    const ageBoost     = Math.min(ageHours, 72) * 0.8
    return { p, score: revisedBoost + needsBoost + confBoost + ageBoost }
  }).sort((a, b) => b.score - a.score)
  const heroes = withUrgency.slice(0, 3).map(x => x.p)
  const heroIds = new Set(heroes.map(p => p.id))
  const restToReview = buckets.to_review.filter(p => !heroIds.has(p.id))
  const restNeedInput = buckets.need_input.filter(p => !heroIds.has(p.id))

  const perCat = CATEGORIES.reduce((acc, c) => {
    acc[c] = all.filter(p => p.category === c && (p.status === 'pending' || p.status === 'amended')).length
    return acc
  }, {})

  return (
    <PipelineLookupContext.Provider value={pipelineLookup}>
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <AgentCard agent={AGENT} schedule={schedule} latestRun={latestRun}
        history={history} openQuestions={[]} hideOpenQuestions />

      <div className="cat-filter" style={{ marginTop: -8 }}>
        <span className="muted" style={{ fontSize: 11, marginRight: 6 }}>Categorie:</span>
        {CATEGORIES.map(c => (
          <button key={c} type="button" onClick={() => toggleCat(c)}
            className={`cat-filter__chip ${catFilter[c] === false ? 'is-off' : 'is-on'}`}>
            <span className={CATEGORY_CLASS[c]} style={{ marginRight: 6 }}>{CATEGORY_LABEL[c]}</span>
            <span className="cat-filter__count">{perCat[c] || 0}</span>
          </button>
        ))}
      </div>

      {heroes.length > 0 && (
        <section>
          <div className="section__head">
            <h2 className="section__title">Eerst reviewen <span className="section__count">{heroes.length}</span></h2>
            <span className="section__hint">meest urgent — herzien / oud / hoge confidence</span>
          </div>
          <div className="v-hero-grid">
            {heroes.map(p => <HeroCard key={p.id} proposal={p} />)}
          </div>
        </section>
      )}

      {restNeedInput.length > 0 && (
        <PrioritySection id="need_input" items={restNeedInput} label="Ook input nodig" />
      )}
      {restToReview.length > 0 && (
        <PrioritySection id="to_review" items={restToReview} label="Overige voorstellen" />
      )}
      {buckets.in_progress.length > 0 && (
        <PrioritySection id="in_progress" items={buckets.in_progress} />
      )}
      {buckets.done.length > 0 && (
        <PrioritySection id="done" items={buckets.done.slice(0, 12)} />
      )}
    </div>
    </PipelineLookupContext.Provider>
  )
}

function HeroCard({ proposal }) {
  return (
    <div className="v-hero-card">
      <ProposalCard proposal={proposal} />
    </div>
  )
}

function PrioritySection({ id, items, label }) {
  const meta = GROUP_META[id]
  const title = label || meta.label
  return (
    <section className={`v-priority-section v-priority-section--${meta.accent}`}>
      <div className="section__head">
        <h2 className="section__title">{title} <span className="section__count">{items.length}</span></h2>
        <span className="section__hint">{meta.hint}</span>
      </div>
      <div className="v-priority-grid">
        {items.map(p => <CompactCard key={p.id} proposal={p} />)}
      </div>
    </section>
  )
}

// Compact-card — 2 regels info + actie-pill-rij. Klik om te openen in modal.
function CompactCard({ proposal }) {
  const [open, setOpen] = useState(false)
  const isRevised = !!proposal.amended_from && proposal.status === 'pending'
  const needsInfo = proposal.needs_info === true
  return (
    <>
      <button type="button"
        className={`v-compact-card ${isRevised ? 'is-revised' : ''} ${needsInfo ? 'is-needs' : ''}`}
        onClick={() => setOpen(true)}>
        <div className="v-compact-card__row1">
          <CardCategory proposal={proposal} />
          {isRevised && <CardBadge tone="revised">✎ herzien</CardBadge>}
          {needsInfo && <CardBadge tone="warning">input</CardBadge>}
          <CardConfidence proposal={proposal} />
        </div>
        <div className="v-compact-card__subject">{proposal.subject}</div>
        {proposal.summary && (
          <div className="v-compact-card__summary">
            {proposal.summary.length > 120 ? proposal.summary.slice(0, 120) + '…' : proposal.summary}
          </div>
        )}
        <div className="v-compact-card__row3">
          <CardPipelineStage proposal={proposal} />
          <CardOwnerAvatar proposal={proposal} />
          <CardActionKinds proposal={proposal} />
        </div>
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal-panel" onClick={e => e.stopPropagation()}>
            <div className="modal-panel__head">
              <div className="muted" style={{ fontSize: 11 }}>Detail · klik buiten om te sluiten</div>
              <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>✕ sluit</button>
            </div>
            <ProposalCard proposal={proposal} />
          </div>
        </div>
      )}
    </>
  )
}
