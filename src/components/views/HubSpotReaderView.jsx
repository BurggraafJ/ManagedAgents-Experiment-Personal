import { useMemo, useState, useEffect, useCallback } from 'react'
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
  CardConfidence,
  CardTime,
} from './hubspot-shared.jsx'

// Reader variant — één voorstel groot in het midden, minimale lijst rechts
// voor navigatie. Pijltoetsen (↑/↓ of j/k) springen naar volgende/vorige.
// Bedoeld voor focused one-at-a-time review zonder afleiding.
export default function HubSpotReaderView({ data }) {
  const pipelineLookup = useMemo(() => buildPipelineLookup(data.pipelines || []), [data.pipelines])
  const schedule  = data.schedules.find(s => s.agent_name === AGENT)
  const latestRun = data.latestRuns[AGENT]
  const history   = data.history[AGENT] || []
  const all = useMemo(() => filterAgentProposals(data), [data])

  const [catFilter, setCatFilter] = useState({ klant: true, partner: true, recruitment: true, overig: true })
  const [statusFilter, setStatusFilter] = useState({ need_input: true, to_review: true, in_progress: true, done: false })

  const visible = all.filter(p => catFilter[p.category] !== false)
  const buckets = useMemo(() => groupProposals(visible), [visible])

  // Platte lijst — respecteert groep-volgorde + filter.
  const flatList = useMemo(() => {
    const order = []
    if (statusFilter.need_input)  order.push(...buckets.need_input)
    if (statusFilter.to_review)   order.push(...buckets.to_review)
    if (statusFilter.in_progress) order.push(...buckets.in_progress)
    if (statusFilter.done)        order.push(...buckets.done.slice(0, 15))
    return order
  }, [buckets, statusFilter])

  const [idx, setIdx] = useState(0)
  useEffect(() => { if (idx >= flatList.length) setIdx(Math.max(0, flatList.length - 1)) }, [flatList, idx])
  const current = flatList[idx] || null

  const goPrev = useCallback(() => setIdx(i => Math.max(0, i - 1)), [])
  const goNext = useCallback(() => setIdx(i => Math.min(flatList.length - 1, i + 1)), [flatList.length])

  useEffect(() => {
    function onKey(e) {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); goNext() }
      else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); goPrev() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goNext, goPrev])

  const perCat = CATEGORIES.reduce((acc, c) => {
    acc[c] = all.filter(p => p.category === c && (p.status === 'pending' || p.status === 'amended')).length
    return acc
  }, {})

  return (
    <PipelineLookupContext.Provider value={pipelineLookup}>
    <div className="stack" style={{ gap: 'var(--s-4)' }}>

      <div className="v-reader-top">
        <AgentCard agent={AGENT} schedule={schedule} latestRun={latestRun}
          history={history} openQuestions={[]} hideOpenQuestions />
        <div className="v-reader-topbar">
          <div className="v-reader-chips">
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
        </div>
      </div>

      <div className="v-reader-split">
        {/* Focus-paneel */}
        <div className="v-reader-focus">
          {current ? (
            <>
              <div className="v-reader-nav">
                <button type="button" className="btn btn--ghost" onClick={goPrev} disabled={idx === 0}>
                  ← vorige
                </button>
                <span className="muted" style={{ fontSize: 12 }}>
                  {idx + 1} van {flatList.length}
                  <span className="v-reader-kbd">↑↓ of j/k</span>
                </span>
                <button type="button" className="btn btn--ghost" onClick={goNext} disabled={idx >= flatList.length - 1}>
                  volgende →
                </button>
              </div>
              <div className="v-reader-card">
                <ProposalCard proposal={current} />
              </div>
            </>
          ) : (
            <div className="empty empty--compact" style={{ padding: 60 }}>
              Geen items matchen de huidige filters.
            </div>
          )}
        </div>

        {/* Mini-lijst voor navigatie */}
        <aside className="v-reader-list">
          <div className="v-reader-list__head">Wachtrij</div>
          {flatList.map((p, i) => {
            const isRevised = !!p.amended_from && p.status === 'pending'
            const needsInfo = p.needs_info === true
            return (
              <button key={p.id} type="button"
                className={`v-reader-list__item ${i === idx ? 'is-active' : ''} ${isRevised ? 'is-revised' : ''} ${needsInfo ? 'is-needs' : ''}`}
                onClick={() => setIdx(i)}>
                <div className="v-reader-list__item-top">
                  <CardCategory proposal={p} />
                  {needsInfo && <CardBadge tone="warning">input</CardBadge>}
                  {isRevised && <CardBadge tone="revised">✎</CardBadge>}
                </div>
                <div className="v-reader-list__subject">{p.subject}</div>
                <div className="v-reader-list__meta">
                  <CardPipelineStage proposal={p} />
                  <CardOwnerAvatar proposal={p} />
                  <CardConfidence proposal={p} />
                </div>
              </button>
            )
          })}
        </aside>
      </div>
    </div>
    </PipelineLookupContext.Provider>
  )
}
