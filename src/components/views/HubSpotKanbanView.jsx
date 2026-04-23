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
  formatDateTime,
} from './HubSpotView'

// Kanban-variant van Daily Admin — voorstellen in 4 verticale kolommen, zodat
// je in één blik ziet wat in welke fase zit. Klik op een mini-kaart → detail-
// modal met volledige ProposalCard + knoppen.
//
// Terminologie bewust aangescherpt:
//   • "Input nodig"     = agent wacht op jou (needs_info=true)
//   • "Te beoordelen"   = concreet plan klaar (pending, non-needs_info)
//                         + paarse band voor "Herzien na feedback"
//   • "In behandeling"  = jij hebt aangepast — wacht op volgende run (amended)
//   • "Afgehandeld"     = historie (executed / rejected / failed)

const COLUMNS = [
  {
    id: 'need_input', title: 'Input nodig', accent: 'warning',
    hint: 'agent mist info — jij beslist richting',
  },
  {
    id: 'to_review', title: 'Te beoordelen', accent: 'accent',
    hint: 'klaar voor ✓ / ✎ / ✕',
  },
  {
    id: 'in_progress', title: 'In behandeling', accent: 'muted',
    hint: 'jouw aanpassing wacht op volgende run',
  },
  {
    id: 'done', title: 'Afgehandeld', accent: 'muted-2',
    hint: 'laatste 15 uitgevoerd/afgewezen',
  },
]

export default function HubSpotKanbanView({ data }) {
  const pipelineLookup = useMemo(() => buildPipelineLookup(data.pipelines || []), [data.pipelines])

  const schedule  = data.schedules.find(s => s.agent_name === AGENT)
  const latestRun = data.latestRuns[AGENT]
  const history   = data.history[AGENT] || []
  const allProposals = useMemo(
    () => (data.proposals || []).filter(p => p.agent_name === AGENT),
    [data.proposals],
  )

  const [catFilter, setCatFilter] = useState({ klant: true, partner: true, recruitment: true, overig: true })
  const toggleCat = c => setCatFilter(prev => ({ ...prev, [c]: !prev[c] }))

  const [openId, setOpenId] = useState(null)

  const visible = allProposals.filter(p => catFilter[p.category] !== false)

  const buckets = useMemo(() => {
    const sortNew = (a, b) => new Date(b.created_at) - new Date(a.created_at)
    const need_input = visible
      .filter(p => p.status === 'pending' && p.needs_info === true)
      .sort(sortNew)
    const to_review = visible
      .filter(p => p.status === 'pending' && p.needs_info !== true)
      .sort((a, b) => {
        // Herziene voorstellen eerst — zijn vaak meest urgent
        const ar = a.amended_from ? 1 : 0
        const br = b.amended_from ? 1 : 0
        if (ar !== br) return br - ar
        return sortNew(a, b)
      })
    const in_progress = visible.filter(p => p.status === 'amended').sort(sortNew)
    const done = visible
      .filter(p => ['accepted', 'rejected', 'executed', 'failed'].includes(p.status))
      .sort(sortNew)
      .slice(0, 15)
    return { need_input, to_review, in_progress, done }
  }, [visible])

  const perCat = useMemo(() => {
    return CATEGORIES.reduce((acc, c) => {
      acc[c] = allProposals.filter(p => p.category === c && (p.status === 'pending' || p.status === 'amended')).length
      return acc
    }, {})
  }, [allProposals])

  const openProposal = openId ? allProposals.find(p => p.id === openId) : null

  return (
    <PipelineLookupContext.Provider value={pipelineLookup}>
    <div className="stack" style={{ gap: 'var(--s-5)' }}>

      {/* Compact status-strip: agent-card + filter-chips op één rij */}
      <section className="hs2-header">
        <div className="hs2-header__agent">
          <AgentCard
            agent={AGENT}
            schedule={schedule}
            latestRun={latestRun}
            history={history}
            openQuestions={[]}
            hideOpenQuestions
          />
        </div>
        <div className="hs2-header__filters">
          <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Categorie</div>
          <div className="hs2-catchips">
            {CATEGORIES.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => toggleCat(c)}
                className={`cat-filter__chip ${catFilter[c] === false ? 'is-off' : 'is-on'}`}
              >
                <span className={CATEGORY_CLASS[c]} style={{ marginRight: 6 }}>{CATEGORY_LABEL[c]}</span>
                <span className="cat-filter__count">{perCat[c] || 0}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Kanban */}
      <div className="kanban">
        {COLUMNS.map(col => (
          <KanbanColumn
            key={col.id}
            column={col}
            items={buckets[col.id]}
            onOpen={id => setOpenId(id)}
          />
        ))}
      </div>

      {openProposal && (
        <DetailModal proposal={openProposal} onClose={() => setOpenId(null)} />
      )}
    </div>
    </PipelineLookupContext.Provider>
  )
}

function KanbanColumn({ column, items, onOpen }) {
  return (
    <div className={`kanban-col kanban-col--${column.accent}`}>
      <div className="kanban-col__head">
        <div className="kanban-col__title">{column.title}</div>
        <div className="kanban-col__count">{items.length}</div>
      </div>
      <div className="kanban-col__hint">{column.hint}</div>
      <div className="kanban-col__body">
        {items.length === 0 ? (
          <div className="kanban-col__empty">— leeg —</div>
        ) : (
          items.map(p => <MiniCard key={p.id} proposal={p} onOpen={() => onOpen(p.id)} />)
        )}
      </div>
    </div>
  )
}

function MiniCard({ proposal, onOpen }) {
  const actions = Array.isArray(proposal.proposal?.actions) ? proposal.proposal.actions : []
  const actionKinds = Array.from(new Set(actions.map(a => a?.type).filter(Boolean)))
  const isRevised = !!proposal.amended_from && proposal.status === 'pending'
  const confidencePct = typeof proposal.confidence === 'number'
    ? Math.round(proposal.confidence * 100) : null

  // Owner + pipeline compact uit context
  const ctx = proposal.context || {}
  const dealOwner = ctx.deal_owner_name || ctx.dealowner || ctx.jira_assignee || null
  const pipelineStage = ctx.pipeline_stage || ctx.deal_stage || null

  return (
    <button
      type="button"
      className={`kanban-card ${isRevised ? 'is-revised' : ''}`}
      onClick={onOpen}
    >
      <div className="kanban-card__row1">
        <span className={CATEGORY_CLASS[proposal.category] || CATEGORY_CLASS.overig}>
          {CATEGORY_LABEL[proposal.category] || 'Overig'}
        </span>
        {isRevised && <span className="kanban-card__revised" title="Herzien na jouw feedback">✎ herzien</span>}
        {confidencePct != null && (
          <span className="kanban-card__conf" title={`Confidence ${confidencePct}%`}>{confidencePct}%</span>
        )}
      </div>
      <div className="kanban-card__subject">{proposal.subject}</div>
      {proposal.summary && (
        <div className="kanban-card__summary">
          {proposal.summary.length > 100 ? proposal.summary.slice(0, 100) + '…' : proposal.summary}
        </div>
      )}
      <div className="kanban-card__row3">
        {pipelineStage && <span className="kanban-card__stage">{pipelineStage}</span>}
        {dealOwner && <span className="kanban-card__owner">{dealOwner.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()}</span>}
        {actionKinds.length > 0 && (
          <span className="kanban-card__kinds">
            {actionKinds.slice(0, 4).map(k => <span key={k} className={`kanban-card__kind kanban-card__kind--${k}`}>{kindIcon(k)}</span>)}
          </span>
        )}
        <span className="kanban-card__time">{formatDateTime(proposal.created_at)}</span>
      </div>
    </button>
  )
}

function kindIcon(type) {
  switch (type) {
    case 'note':    return '✎'
    case 'task':    return '✓'
    case 'stage':   return '↗'
    case 'contact': return '⊕'
    case 'company': return '⌂'
    case 'deal':    return '◆'
    case 'jira':    return '⊞'
    case 'card':    return '⊠'
    case 'comment': return '💬'
    default: return '•'
  }
}

function DetailModal({ proposal, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-panel__head">
          <div className="muted" style={{ fontSize: 11 }}>Detail-weergave · klik buiten om te sluiten</div>
          <button type="button" className="btn btn--ghost" onClick={onClose}>✕ sluit</button>
        </div>
        <ProposalCard proposal={proposal} />
      </div>
    </div>
  )
}
