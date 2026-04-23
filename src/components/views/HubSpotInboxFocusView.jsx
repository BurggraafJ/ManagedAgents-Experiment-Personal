import { useMemo, useState, useEffect, useCallback } from 'react'
import AgentCard from '../AgentCard'
import {
  AGENT,
  CATEGORIES,
  CATEGORY_LABEL,
  CATEGORY_CLASS,
  PipelineLookupContext,
  buildPipelineLookup,
} from './HubSpotView'
import ProposalCardV2 from '../ProposalCardV2'
import {
  filterAgentProposals,
  groupProposals,
  GROUP_META,
  CardBadge,
  CardCategory,
} from './hubspot-shared.jsx'

// Inbox · Focus — single-item reader met smalle queue bovenaan (horizontaal).
// Voorstel neemt volledige breedte centraal, max 820px voor leesbaarheid.
// Navigatie: pijltjes / j-k, of klik op queue-item. Ideaal voor diepgaande
// review van complexe voorstellen.

export default function HubSpotInboxFocusView({ data }) {
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

  const [idx, setIdx] = useState(0)
  useEffect(() => { if (idx >= flatList.length) setIdx(Math.max(0, flatList.length - 1)) }, [flatList, idx])
  const current = flatList[idx] || null

  const goPrev = useCallback(() => setIdx(i => Math.max(0, i - 1)), [])
  const goNext = useCallback(() => setIdx(i => Math.min(flatList.length - 1, i + 1)), [flatList.length])
  useEffect(() => {
    function onKey(e) {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); goNext() }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); goPrev() }
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
      <AgentCard agent={AGENT} schedule={schedule} latestRun={latestRun}
        history={history} openQuestions={[]} hideOpenQuestions />

      <div className="inbox-focus-filters">
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

      {/* Horizontale queue bovenaan */}
      <div className="inbox-focus-queue">
        <div className="inbox-focus-queue__scroll">
          {flatList.map((p, i) => {
            const isRevised = !!p.amended_from && p.status === 'pending'
            const needsInfo = p.needs_info === true
            return (
              <button key={p.id} type="button"
                className={`inbox-focus-queue__item ${i === idx ? 'is-active' : ''} ${isRevised ? 'is-revised' : ''} ${needsInfo ? 'is-needs' : ''}`}
                onClick={() => setIdx(i)}>
                <div className="inbox-focus-queue__item-top">
                  <CardCategory proposal={p} />
                  {needsInfo && <CardBadge tone="warning">input</CardBadge>}
                  {isRevised && <CardBadge tone="revised">✎</CardBadge>}
                </div>
                <div className="inbox-focus-queue__item-subject">{p.subject}</div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="inbox-focus-nav">
        <button type="button" className="btn btn--ghost" onClick={goPrev} disabled={idx === 0}>← vorige</button>
        <span className="muted" style={{ fontSize: 12 }}>
          {flatList.length > 0 ? `${idx + 1} van ${flatList.length}` : '0'}
          <span className="inbox-focus-kbd">← → of j/k</span>
        </span>
        <button type="button" className="btn btn--ghost" onClick={goNext} disabled={idx >= flatList.length - 1}>volgende →</button>
      </div>

      <main className="inbox-focus-main">
        {current ? (
          <ProposalCardV2 proposal={current} />
        ) : (
          <div className="empty empty--compact" style={{ padding: 80 }}>
            Geen items matchen de huidige filters.
          </div>
        )}
      </main>
    </div>
    </PipelineLookupContext.Provider>
  )
}
