import { useMemo, useState, useEffect } from 'react'
import AgentCard from '../AgentCard'
import {
  AGENT,
  CATEGORIES,
  CATEGORY_LABEL,
  CATEGORY_CLASS,
  PipelineLookupContext,
  buildPipelineLookup,
  ProposalCard,
  formatDateTime,
} from './HubSpotView'

// Inbox-variant van Daily Admin — een verticale lijst als een mailbox links,
// en het detail-paneel rechts dat meebeweegt met je selectie. Bedoeld voor
// snelle bulk-review: selecteer een rij en zie alle details.
//
// Terminologie hetzelfde als Kanban-variant:
//   • "Input nodig"     — needs_info=true
//   • "Te beoordelen"   — pending, klaar voor review
//   • "In behandeling"  — amended, wacht op volgende run
//   • "Afgehandeld"     — historie
//
// Lijst-groepering: standaard gesorteerd "eerst jouw actie, dan wacht-op-run,
// dan historie". Toggleable filter-chips bovenaan voor status + categorie.

const STATUS_GROUPS = [
  { id: 'need_input', label: 'Input nodig',    match: p => p.status === 'pending' && p.needs_info === true,  accent: 'warning' },
  { id: 'to_review',  label: 'Te beoordelen',  match: p => p.status === 'pending' && p.needs_info !== true,  accent: 'accent' },
  { id: 'in_progress',label: 'In behandeling', match: p => p.status === 'amended', accent: 'muted' },
  { id: 'done',       label: 'Afgehandeld',    match: p => ['accepted','rejected','executed','failed'].includes(p.status), accent: 'muted-2' },
]

export default function HubSpotInboxView({ data }) {
  const pipelineLookup = useMemo(() => buildPipelineLookup(data.pipelines || []), [data.pipelines])

  const schedule  = data.schedules.find(s => s.agent_name === AGENT)
  const latestRun = data.latestRuns[AGENT]
  const history   = data.history[AGENT] || []
  const allProposals = useMemo(
    () => (data.proposals || []).filter(p => p.agent_name === AGENT),
    [data.proposals],
  )

  const [catFilter, setCatFilter] = useState({ klant: true, partner: true, recruitment: true, overig: true })
  const [statusFilter, setStatusFilter] = useState({
    need_input: true, to_review: true, in_progress: true, done: false,
  })
  const [search, setSearch] = useState('')

  const grouped = useMemo(() => {
    const lower = search.trim().toLowerCase()
    const matches = (p) => {
      if (catFilter[p.category] === false) return false
      if (!lower) return true
      const hay = [p.subject, p.summary, JSON.stringify(p.context || {})].join(' ').toLowerCase()
      return hay.includes(lower)
    }
    const sortNew = (a, b) => new Date(b.created_at) - new Date(a.created_at)
    const result = STATUS_GROUPS.map(g => ({
      ...g,
      items: statusFilter[g.id] === false ? [] : allProposals.filter(p => g.match(p) && matches(p)).sort(sortNew),
    }))
    return result
  }, [allProposals, catFilter, statusFilter, search])

  // Default selectie: eerste proposal in eerste niet-lege groep.
  const flatIds = useMemo(() => grouped.flatMap(g => g.items.map(i => i.id)), [grouped])
  const [selectedId, setSelectedId] = useState(null)
  useEffect(() => {
    if (!selectedId && flatIds.length > 0) setSelectedId(flatIds[0])
    if (selectedId && !flatIds.includes(selectedId)) setSelectedId(flatIds[0] || null)
  }, [flatIds, selectedId])

  const selected = allProposals.find(p => p.id === selectedId) || null

  const perCat = CATEGORIES.reduce((acc, c) => {
    acc[c] = allProposals.filter(p => p.category === c && (p.status === 'pending' || p.status === 'amended')).length
    return acc
  }, {})

  return (
    <PipelineLookupContext.Provider value={pipelineLookup}>
    <div className="stack" style={{ gap: 'var(--s-5)' }}>

      {/* Compact header met agent + filters */}
      <section className="hs3-header">
        <AgentCard
          agent={AGENT}
          schedule={schedule}
          latestRun={latestRun}
          history={history}
          openQuestions={[]}
          hideOpenQuestions
        />

        <div className="hs3-header__controls">
          <input
            type="search"
            placeholder="Zoek in subject, summary, context..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="hs3-search"
          />
          <div className="hs3-chips">
            <span className="muted" style={{ fontSize: 11, marginRight: 4 }}>Status</span>
            {STATUS_GROUPS.map(g => (
              <button
                key={g.id}
                type="button"
                className={`cat-filter__chip ${statusFilter[g.id] === false ? 'is-off' : 'is-on'}`}
                onClick={() => setStatusFilter(prev => ({ ...prev, [g.id]: !prev[g.id] }))}
              >
                {g.label}
              </button>
            ))}
          </div>
          <div className="hs3-chips">
            <span className="muted" style={{ fontSize: 11, marginRight: 4 }}>Categorie</span>
            {CATEGORIES.map(c => (
              <button
                key={c}
                type="button"
                className={`cat-filter__chip ${catFilter[c] === false ? 'is-off' : 'is-on'}`}
                onClick={() => setCatFilter(prev => ({ ...prev, [c]: !prev[c] }))}
              >
                <span className={CATEGORY_CLASS[c]} style={{ marginRight: 6 }}>{CATEGORY_LABEL[c]}</span>
                <span className="cat-filter__count">{perCat[c] || 0}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Split: list links, detail rechts */}
      <div className="hs3-split">
        <div className="hs3-list">
          {grouped.map(g => (
            g.items.length > 0 && (
              <div key={g.id} className="hs3-list__group">
                <div className={`hs3-list__header hs3-list__header--${g.accent}`}>
                  <span>{g.label}</span>
                  <span className="hs3-list__count">{g.items.length}</span>
                </div>
                {g.items.map(p => (
                  <InboxRow
                    key={p.id}
                    proposal={p}
                    selected={p.id === selectedId}
                    onSelect={() => setSelectedId(p.id)}
                  />
                ))}
              </div>
            )
          ))}
          {flatIds.length === 0 && (
            <div className="empty empty--compact" style={{ padding: 24 }}>
              Geen items matchen de huidige filters.
            </div>
          )}
        </div>

        <div className="hs3-detail">
          {selected ? (
            <ProposalCard proposal={selected} />
          ) : (
            <div className="empty empty--compact" style={{ padding: 24 }}>
              Selecteer een item links om details te zien.
            </div>
          )}
        </div>
      </div>
    </div>
    </PipelineLookupContext.Provider>
  )
}

function InboxRow({ proposal, selected, onSelect }) {
  const isRevised = !!proposal.amended_from && proposal.status === 'pending'
  const ctx = proposal.context || {}
  const pipelineStage = ctx.pipeline_stage || ctx.deal_stage || null
  const dealOwner = ctx.deal_owner_name || ctx.dealowner || ctx.jira_assignee || null
  const confidencePct = typeof proposal.confidence === 'number'
    ? Math.round(proposal.confidence * 100) : null
  const needsInfo = proposal.needs_info === true

  return (
    <button
      type="button"
      className={`hs3-row ${selected ? 'is-selected' : ''} ${isRevised ? 'is-revised' : ''} ${needsInfo ? 'is-needs-info' : ''}`}
      onClick={onSelect}
    >
      <div className="hs3-row__main">
        <div className="hs3-row__top">
          <span className={CATEGORY_CLASS[proposal.category] || CATEGORY_CLASS.overig} style={{ fontSize: 10 }}>
            {CATEGORY_LABEL[proposal.category] || 'Overig'}
          </span>
          {isRevised && <span className="hs3-row__tag hs3-row__tag--revised">✎ herzien</span>}
          {needsInfo && <span className="hs3-row__tag hs3-row__tag--needs">input nodig</span>}
          <span className="hs3-row__subject">{proposal.subject}</span>
        </div>
        <div className="hs3-row__meta">
          {pipelineStage && <span className="hs3-row__stage">{pipelineStage}</span>}
          {dealOwner && <span className="hs3-row__owner">{dealOwner}</span>}
          {confidencePct != null && <span className="hs3-row__conf">{confidencePct}%</span>}
          <span className="hs3-row__time">{formatDateTime(proposal.created_at)}</span>
        </div>
      </div>
    </button>
  )
}
