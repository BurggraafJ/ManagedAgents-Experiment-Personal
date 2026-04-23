import { useMemo, useState, useEffect } from 'react'
import AgentCard from '../AgentCard'
import { supabase } from '../../lib/supabase'
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
  CardActionKinds,
  CardConfidence,
} from './hubspot-shared.jsx'

// Inbox · Triage — brede lijst (520px) met inline quick-actions per rij
// (✓ accepteer / ✕ afwijzen) voor rap doorzetten. Detail is collapsed naast
// zich; klik de subject om de full V2-card te zien. Rows geven de belangrijkste
// signalen in één blik: category, pipeline, owner, confidence, acties-icons.

export default function HubSpotInboxTriageView({ data }) {
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
    if (selectedId && !flatList.find(p => p.id === selectedId)) setSelectedId(null)
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

      <div className="inbox-triage-filters">
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

      <div className="inbox-triage-split">
        <div className="inbox-triage-list">
          {['need_input', 'to_review', 'in_progress', 'done'].map(g => (
            buckets[g].length > 0 && statusFilter[g] !== false && (
              <div key={g} className="inbox-triage-group">
                <div className={`inbox-triage-group__head inbox-triage-group__head--${GROUP_META[g].accent}`}>
                  <span>{GROUP_META[g].label}</span>
                  <span className="inbox-triage-group__count">{buckets[g].length}</span>
                  <span className="muted inbox-triage-group__hint">{GROUP_META[g].hint}</span>
                </div>
                {buckets[g].slice(0, g === 'done' ? 15 : buckets[g].length).map(p => (
                  <TriageRow key={p.id} proposal={p}
                    selected={p.id === selectedId}
                    onSelect={() => setSelectedId(p.id === selectedId ? null : p.id)} />
                ))}
              </div>
            )
          ))}
          {flatList.length === 0 && (
            <div className="empty empty--compact" style={{ padding: 40 }}>
              Geen items matchen de huidige filters.
            </div>
          )}
        </div>

        {selected && (
          <aside className="inbox-triage-detail">
            <div className="inbox-triage-detail__head">
              <span className="muted" style={{ fontSize: 11 }}>Detail</span>
              <button type="button" className="btn btn--ghost" style={{ fontSize: 11, padding: '4px 10px' }}
                onClick={() => setSelectedId(null)}>✕ sluit</button>
            </div>
            <ProposalCardV2 proposal={selected} />
          </aside>
        )}
      </div>
    </div>
    </PipelineLookupContext.Provider>
  )
}

function TriageRow({ proposal, selected, onSelect }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [optimisticStatus, setOptimisticStatus] = useState(null)

  async function quickAction(rpc) {
    setBusy(true); setErr(null)
    const targetStatus = rpc === 'accept_proposal' ? 'accepted' : 'rejected'
    setOptimisticStatus(targetStatus)
    try {
      const { data, error } = await supabase.rpc(rpc, { proposal_id: proposal.id })
      if (error) { setErr(error.message); setOptimisticStatus(null) }
      else if (data && data.ok === false) { setErr(data.reason || 'mislukt'); setOptimisticStatus(null) }
    } catch (e) {
      setErr(e.message || 'netwerkfout'); setOptimisticStatus(null)
    }
    setBusy(false)
  }

  const isRevised = !!proposal.amended_from && proposal.status === 'pending'
  const needsInfo = proposal.needs_info === true
  const status = optimisticStatus || proposal.status
  const isPending = status === 'pending' || status === 'amended'

  return (
    <div className={`inbox-triage-row ${selected ? 'is-selected' : ''} ${isRevised ? 'is-revised' : ''} ${needsInfo ? 'is-needs' : ''} ${!isPending ? 'is-closed' : ''}`}>
      <button type="button" className="inbox-triage-row__main" onClick={onSelect}>
        <div className="inbox-triage-row__top">
          <CardCategory proposal={proposal} />
          {needsInfo && <CardBadge tone="warning">input</CardBadge>}
          {isRevised && <CardBadge tone="revised">✎ herzien</CardBadge>}
          <span className="inbox-triage-row__subject">{proposal.subject}</span>
          <span className="inbox-triage-row__time">{formatDateTime(proposal.created_at)}</span>
        </div>
        {proposal.summary && (
          <div className="inbox-triage-row__summary">
            {proposal.summary.length > 180 ? proposal.summary.slice(0, 180) + '…' : proposal.summary}
          </div>
        )}
        <div className="inbox-triage-row__meta">
          <CardPipelineStage proposal={proposal} />
          <CardOwnerAvatar proposal={proposal} />
          <CardActionKinds proposal={proposal} max={6} />
          <CardConfidence proposal={proposal} />
        </div>
      </button>
      {isPending && (
        <div className="inbox-triage-row__actions">
          {needsInfo ? (
            <button type="button" className="inbox-triage-btn inbox-triage-btn--warning"
              onClick={onSelect} disabled={busy}
              title="Open detail om antwoord te geven">
              ✎ antwoord
            </button>
          ) : (
            <button type="button" className="inbox-triage-btn inbox-triage-btn--accept"
              onClick={() => quickAction('accept_proposal')} disabled={busy}
              title="Accepteer direct (zonder detail)">
              {busy && optimisticStatus === 'accepted' ? '…' : '✓'}
            </button>
          )}
          <button type="button" className="inbox-triage-btn inbox-triage-btn--reject"
            onClick={() => quickAction('reject_proposal')} disabled={busy}
            title="Wijs af">
            {busy && optimisticStatus === 'rejected' ? '…' : '✕'}
          </button>
        </div>
      )}
      {err && <div className="inbox-triage-row__error">⚠ {err}</div>}
    </div>
  )
}
