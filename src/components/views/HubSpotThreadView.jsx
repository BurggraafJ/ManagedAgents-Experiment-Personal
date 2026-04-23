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
  CardTime,
} from './hubspot-shared.jsx'

// Thread variant — inbox-achtige lijst die IN-PLACE uitklapt bij klik (zoals
// Gmail-threads). Geen los detail-paneel. Voordeel: je houdt de omliggende
// items zichtbaar tijdens het beoordelen van één. Kan meerdere tegelijk open.
export default function HubSpotThreadView({ data }) {
  const pipelineLookup = useMemo(() => buildPipelineLookup(data.pipelines || []), [data.pipelines])
  const schedule  = data.schedules.find(s => s.agent_name === AGENT)
  const latestRun = data.latestRuns[AGENT]
  const history   = data.history[AGENT] || []
  const all = useMemo(() => filterAgentProposals(data), [data])

  const [catFilter, setCatFilter] = useState({ klant: true, partner: true, recruitment: true, overig: true })
  const [statusFilter, setStatusFilter] = useState({ need_input: true, to_review: true, in_progress: true, done: false })
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(new Set())

  const visible = useMemo(() => {
    const lower = search.trim().toLowerCase()
    return all.filter(p => {
      if (catFilter[p.category] === false) return false
      if (!lower) return true
      const hay = [p.subject, p.summary, JSON.stringify(p.context || {})].join(' ').toLowerCase()
      return hay.includes(lower)
    })
  }, [all, catFilter, search])

  const buckets = useMemo(() => groupProposals(visible), [visible])

  function toggleExpand(id) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const perCat = CATEGORIES.reduce((acc, c) => {
    acc[c] = all.filter(p => p.category === c && (p.status === 'pending' || p.status === 'amended')).length
    return acc
  }, {})

  const displayGroups = ['need_input', 'to_review', 'in_progress', 'done']
    .filter(g => statusFilter[g] !== false && buckets[g].length > 0)

  return (
    <PipelineLookupContext.Provider value={pipelineLookup}>
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <AgentCard agent={AGENT} schedule={schedule} latestRun={latestRun}
        history={history} openQuestions={[]} hideOpenQuestions />

      <div className="v-thread-filters">
        <input type="search" placeholder="Zoek in subject / summary / context..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="v-thread-search" />
        <div className="v-thread-chips">
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
        {expanded.size > 0 && (
          <button type="button" className="btn btn--ghost"
            style={{ fontSize: 11, padding: '4px 10px' }}
            onClick={() => setExpanded(new Set())}>
            Alles sluiten ({expanded.size})
          </button>
        )}
      </div>

      <div className="v-thread-list">
        {displayGroups.map(g => (
          <div key={g} className={`v-thread-group v-thread-group--${GROUP_META[g].accent}`}>
            <div className="v-thread-group__head">
              <span>{GROUP_META[g].label}</span>
              <span className="v-thread-group__count">{buckets[g].length}</span>
              <span className="muted v-thread-group__hint">{GROUP_META[g].hint}</span>
            </div>
            {buckets[g].slice(0, g === 'done' ? 15 : buckets[g].length).map(p => (
              <ThreadRow key={p.id} proposal={p}
                open={expanded.has(p.id)}
                onToggle={() => toggleExpand(p.id)} />
            ))}
          </div>
        ))}
        {displayGroups.length === 0 && (
          <div className="empty empty--compact" style={{ padding: 24 }}>
            Geen items matchen de huidige filters.
          </div>
        )}
      </div>
    </div>
    </PipelineLookupContext.Provider>
  )
}

function ThreadRow({ proposal, open, onToggle }) {
  const isRevised = !!proposal.amended_from && proposal.status === 'pending'
  const needsInfo = proposal.needs_info === true
  const rowClass = [
    'v-thread-row',
    open ? 'is-open' : '',
    isRevised ? 'is-revised' : '',
    needsInfo ? 'is-needs' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={rowClass}>
      <button type="button" className="v-thread-row__head" onClick={onToggle}>
        <span className="v-thread-row__caret">{open ? '▾' : '▸'}</span>
        <div className="v-thread-row__summary">
          <div className="v-thread-row__top">
            <CardCategory proposal={proposal} />
            {isRevised && <CardBadge tone="revised">✎ herzien</CardBadge>}
            {needsInfo && <CardBadge tone="warning">input</CardBadge>}
            <span className="v-thread-row__subject">{proposal.subject}</span>
            <CardTime proposal={proposal} />
          </div>
          {!open && proposal.summary && (
            <div className="v-thread-row__preview">
              {proposal.summary.length > 160 ? proposal.summary.slice(0, 160) + '…' : proposal.summary}
            </div>
          )}
          <div className="v-thread-row__meta">
            <CardPipelineStage proposal={proposal} />
            <CardOwnerAvatar proposal={proposal} />
            <CardActionKinds proposal={proposal} max={6} />
            <CardConfidence proposal={proposal} />
          </div>
        </div>
      </button>
      {open && (
        <div className="v-thread-row__body">
          <ProposalCard proposal={proposal} />
        </div>
      )}
    </div>
  )
}
