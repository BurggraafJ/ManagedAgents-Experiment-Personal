import { useMemo, useState, useEffect } from 'react'
import AgentCard from '../AgentCard'
import {
  AGENT,
  CATEGORIES,
  CATEGORY_LABEL,
  CATEGORY_CLASS,
  PipelineLookupContext,
  buildPipelineLookup,
  formatDateTime,
} from './HubSpotView'
import ProposalCardV2 from '../ProposalCardV2'
import {
  filterAgentProposals,
  groupProposals,
  GROUP_META,
  CardBadge,
  CardCategory,
  CardPipelineStage,
  CardOwnerAvatar,
  CardConfidence,
} from './hubspot-shared.jsx'

// Inbox · Clean — smalle lijst (260px), dominant detail-paneel. Minimale
// filter-bar bovenaan zodat het detail de aandacht krijgt. Geen sticky
// bottom-bar — actieknoppen staan in de card zelf onderaan (lange scrolls
// krijgen de knoppen automatisch in view). Voor focussed single-item review.

export default function HubSpotInboxCleanView({ data }) {
  const pipelineLookup = useMemo(() => buildPipelineLookup(data.pipelines || []), [data.pipelines])
  const schedule  = data.schedules.find(s => s.agent_name === AGENT)
  const latestRun = data.latestRuns[AGENT]
  const history   = data.history[AGENT] || []
  const all = useMemo(() => filterAgentProposals(data), [data])

  const [catFilter, setCatFilter] = useState({ klant: true, partner: true, recruitment: true, overig: true })
  const [statusFilter, setStatusFilter] = useState({ need_input: true, to_review: true, in_progress: true, done: false })

  const visible = all.filter(p => catFilter[p.category] !== false)
  const buckets = useMemo(() => groupProposals(visible), [visible])
  const flatList = useMemo(() => {
    const out = []
    if (statusFilter.need_input)  out.push(...buckets.need_input)
    if (statusFilter.to_review)   out.push(...buckets.to_review)
    if (statusFilter.in_progress) out.push(...buckets.in_progress)
    if (statusFilter.done)        out.push(...buckets.done.slice(0, 15))
    return out
  }, [buckets, statusFilter])

  const [selectedId, setSelectedId] = useState(null)
  useEffect(() => {
    if (!selectedId && flatList.length > 0) setSelectedId(flatList[0].id)
    if (selectedId && !flatList.find(p => p.id === selectedId)) setSelectedId(flatList[0]?.id || null)
  }, [flatList, selectedId])
  const selected = flatList.find(p => p.id === selectedId) || null

  const perCat = CATEGORIES.reduce((acc, c) => {
    acc[c] = all.filter(p => p.category === c && (p.status === 'pending' || p.status === 'amended')).length
    return acc
  }, {})

  return (
    <PipelineLookupContext.Provider value={pipelineLookup}>
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <AgentCard agent={AGENT} schedule={schedule} latestRun={latestRun}
        history={history} openQuestions={[]} hideOpenQuestions />

      <div className="inbox-clean-filters">
        {['need_input', 'to_review', 'in_progress', 'done'].map(g => (
          <button key={g} type="button"
            className={`cat-filter__chip ${statusFilter[g] === false ? 'is-off' : 'is-on'}`}
            onClick={() => setStatusFilter(prev => ({ ...prev, [g]: !prev[g] }))}>
            {GROUP_META[g].label}
            <span className="cat-filter__count" style={{ marginLeft: 6 }}>{buckets[g].length}</span>
          </button>
        ))}
        <span className="muted" style={{ fontSize: 11, margin: '0 6px' }}>·</span>
        {CATEGORIES.map(c => (
          <button key={c} type="button"
            className={`cat-filter__chip ${catFilter[c] === false ? 'is-off' : 'is-on'}`}
            onClick={() => setCatFilter(prev => ({ ...prev, [c]: !prev[c] }))}>
            <span className={CATEGORY_CLASS[c]} style={{ marginRight: 6 }}>{CATEGORY_LABEL[c]}</span>
            <span className="cat-filter__count">{perCat[c] || 0}</span>
          </button>
        ))}
      </div>

      <div className="inbox-clean-split">
        <aside className="inbox-clean-list">
          {['need_input', 'to_review', 'in_progress', 'done'].map(g => (
            buckets[g].length > 0 && statusFilter[g] !== false && (
              <div key={g} className="inbox-clean-group">
                <div className={`inbox-clean-group__head inbox-clean-group__head--${GROUP_META[g].accent}`}>
                  {GROUP_META[g].label} <span>{buckets[g].length}</span>
                </div>
                {buckets[g].slice(0, g === 'done' ? 15 : buckets[g].length).map(p => (
                  <CleanRow key={p.id} proposal={p} selected={p.id === selectedId} onSelect={() => setSelectedId(p.id)} />
                ))}
              </div>
            )
          ))}
          {flatList.length === 0 && (
            <div className="empty empty--compact" style={{ padding: 20, fontSize: 11 }}>
              Geen items matchen.
            </div>
          )}
        </aside>
        <main className="inbox-clean-detail">
          {selected ? (
            <ProposalCardV2 proposal={selected} />
          ) : (
            <div className="empty empty--compact" style={{ padding: 60 }}>
              Selecteer een item links om te beoordelen.
            </div>
          )}
        </main>
      </div>
    </div>
    </PipelineLookupContext.Provider>
  )
}

function CleanRow({ proposal, selected, onSelect }) {
  const isRevised = !!proposal.amended_from && proposal.status === 'pending'
  const needsInfo = proposal.needs_info === true
  return (
    <button type="button"
      className={`inbox-clean-row ${selected ? 'is-selected' : ''} ${isRevised ? 'is-revised' : ''} ${needsInfo ? 'is-needs' : ''}`}
      onClick={onSelect}>
      <div className="inbox-clean-row__top">
        <CardCategory proposal={proposal} />
        {needsInfo && <CardBadge tone="warning">input</CardBadge>}
        {isRevised && <CardBadge tone="revised">✎</CardBadge>}
      </div>
      <div className="inbox-clean-row__subject">{proposal.subject}</div>
      <div className="inbox-clean-row__meta">
        <CardPipelineStage proposal={proposal} />
        <CardOwnerAvatar proposal={proposal} />
        <CardConfidence proposal={proposal} />
      </div>
      <div className="inbox-clean-row__time">{formatDateTime(proposal.created_at)}</div>
    </button>
  )
}
