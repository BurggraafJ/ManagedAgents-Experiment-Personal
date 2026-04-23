import { useMemo, useState } from 'react'
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
  CardPipelineStage,
  CardOwnerAvatar,
  CardActionKinds,
  CardConfidence,
  CardTime,
} from './hubspot-shared.jsx'

// Dense variant — zelfde sectie-concept als origineel, maar ruimte-efficient:
// 1 rij per voorstel (category · subject · pipeline · owner · kinds · conf ·
// time), klik op een rij om volledige ProposalCard inline uit te klappen.
// Veel meer items tegelijk in beeld dan de originele weergave.
export default function HubSpotDenseView({ data }) {
  const pipelineLookup = useMemo(() => buildPipelineLookup(data.pipelines || []), [data.pipelines])
  const schedule  = data.schedules.find(s => s.agent_name === AGENT)
  const latestRun = data.latestRuns[AGENT]
  const history   = data.history[AGENT] || []
  const all = useMemo(() => filterAgentProposals(data), [data])

  const [catFilter, setCatFilter] = useState({ klant: true, partner: true, recruitment: true, overig: true })
  const toggleCat = c => setCatFilter(prev => ({ ...prev, [c]: !prev[c] }))

  const visible = all.filter(p => catFilter[p.category] !== false)
  const buckets = useMemo(() => groupProposals(visible), [visible])

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

      {['need_input', 'to_review', 'in_progress', 'done'].map(id => (
        <DenseSection key={id} id={id} items={buckets[id].slice(0, id === 'done' ? 20 : buckets[id].length)} />
      ))}
    </div>
    </PipelineLookupContext.Provider>
  )
}

function DenseSection({ id, items }) {
  const meta = GROUP_META[id]
  const [collapsed, setCollapsed] = useState(id === 'done')
  return (
    <section className={`v-dense-section v-dense-section--${meta.accent}`}>
      <button type="button" className="v-dense-section__head" onClick={() => setCollapsed(v => !v)}>
        <span className="v-dense-section__caret">{collapsed ? '▸' : '▾'}</span>
        <span className="v-dense-section__title">{meta.label}</span>
        <span className="v-dense-section__count">{items.length}</span>
        <span className="v-dense-section__hint muted">{meta.hint}</span>
      </button>
      {!collapsed && (
        <div className="v-dense-section__body">
          {items.length === 0 ? (
            <div className="v-dense-section__empty">— leeg —</div>
          ) : (
            items.map(p => <DenseRow key={p.id} proposal={p} />)
          )}
        </div>
      )}
    </section>
  )
}

function DenseRow({ proposal }) {
  const [open, setOpen] = useState(false)
  const isRevised = !!proposal.amended_from && proposal.status === 'pending'
  const needsInfo = proposal.needs_info === true
  const rowClass = [
    'v-dense-row',
    open ? 'is-open' : '',
    isRevised ? 'is-revised' : '',
    needsInfo ? 'is-needs' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={rowClass}>
      <button type="button" className="v-dense-row__head" onClick={() => setOpen(v => !v)}>
        <span className="v-dense-row__caret">{open ? '▾' : '▸'}</span>
        <CardCategory proposal={proposal} />
        {isRevised && <CardBadge tone="revised">✎ herzien</CardBadge>}
        {needsInfo && <CardBadge tone="warning">input</CardBadge>}
        <span className="v-dense-row__subject">{proposal.subject}</span>
        <CardPipelineStage proposal={proposal} />
        <CardOwnerAvatar proposal={proposal} />
        <CardActionKinds proposal={proposal} />
        <CardConfidence proposal={proposal} />
        <CardTime proposal={proposal} />
      </button>
      {open && (
        <div className="v-dense-row__body">
          <ProposalCardV2 proposal={proposal} />
        </div>
      )}
    </div>
  )
}
