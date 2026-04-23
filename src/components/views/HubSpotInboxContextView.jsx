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

// Inbox · Context — lijst links, detail midden, "gerelateerde items" rechts.
// Gerelateerd = andere proposals over zelfde company_id / contact_id / deal_id
// / Jira-issue / sender-domain. Timeline-view helpt bij bulk-situaties
// (meerdere signalen dezelfde dag over hetzelfde record) die tijdens dedup
// al samen hadden moeten komen maar historisch toch gescheiden zijn.

export default function HubSpotInboxContextView({ data }) {
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

  // Bouw gerelateerde-items-lijst voor het geselecteerde voorstel.
  const related = useMemo(() => {
    if (!selected) return []
    const ctx = selected.context || {}
    const keys = {
      company_id: ctx.existing_company_id,
      contact_id: ctx.existing_contact_id,
      deal_id:    ctx.existing_deal_id || ctx.deal_id,
      jira:       ctx.existing_jira_issue,
      domain:     ctx.sender_domain || (ctx.sender && ctx.sender.includes('@') ? ctx.sender.split('@')[1] : null),
      company:    (ctx.company_guess || ctx.company || '').toLowerCase() || null,
    }
    return all.filter(p => {
      if (p.id === selected.id) return false
      const c = p.context || {}
      if (keys.company_id && (c.existing_company_id === keys.company_id)) return true
      if (keys.contact_id && (c.existing_contact_id === keys.contact_id)) return true
      if (keys.deal_id    && (c.existing_deal_id === keys.deal_id || c.deal_id === keys.deal_id)) return true
      if (keys.jira       && c.existing_jira_issue === keys.jira) return true
      if (keys.domain     && (c.sender_domain === keys.domain ||
                              (c.sender && c.sender.endsWith('@' + keys.domain)))) return true
      if (keys.company    && (c.company_guess || c.company || '').toLowerCase() === keys.company) return true
      return false
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  }, [selected, all])

  const perCat = CATEGORIES.reduce((acc, c) => {
    acc[c] = all.filter(p => p.category === c && (p.status === 'pending' || p.status === 'amended')).length
    return acc
  }, {})

  return (
    <PipelineLookupContext.Provider value={pipelineLookup}>
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <AgentCard agent={AGENT} schedule={schedule} latestRun={latestRun}
        history={history} openQuestions={[]} hideOpenQuestions />

      <div className="inbox-context-filters">
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

      <div className="inbox-context-split">
        <aside className="inbox-context-list">
          {flatList.map(p => (
            <button key={p.id} type="button"
              className={`inbox-context-row ${p.id === selectedId ? 'is-selected' : ''}`}
              onClick={() => setSelectedId(p.id)}>
              <div className="inbox-context-row__top">
                <CardCategory proposal={p} />
                {p.needs_info && <CardBadge tone="warning">input</CardBadge>}
                {!!p.amended_from && p.status === 'pending' && <CardBadge tone="revised">✎</CardBadge>}
              </div>
              <div className="inbox-context-row__subject">{p.subject}</div>
              <div className="inbox-context-row__meta">
                <CardPipelineStage proposal={p} />
                <CardOwnerAvatar proposal={p} />
                <CardConfidence proposal={p} />
              </div>
            </button>
          ))}
        </aside>

        <main className="inbox-context-detail">
          {selected ? (
            <ProposalCardV2 proposal={selected} />
          ) : (
            <div className="empty empty--compact" style={{ padding: 60 }}>
              Geen selectie.
            </div>
          )}
        </main>

        <aside className="inbox-context-related">
          <div className="inbox-context-related__head">
            Gerelateerd
            <span className="inbox-context-related__count">{related.length}</span>
          </div>
          <div className="inbox-context-related__hint muted">
            Andere voorstellen over hetzelfde bedrijf, contact, deal, Jira-kaart of email-domein.
          </div>
          {related.length === 0 ? (
            <div className="empty empty--compact" style={{ padding: 16, fontSize: 11 }}>
              Geen gerelateerde items gevonden.
            </div>
          ) : (
            <div className="inbox-context-related__list">
              {related.map(p => (
                <button key={p.id} type="button"
                  className={`inbox-context-related__item inbox-context-related__item--${p.status}`}
                  onClick={() => setSelectedId(p.id)}>
                  <div className="inbox-context-related__item-top">
                    <span className="inbox-context-related__item-status">{p.status}</span>
                    <span className="inbox-context-related__item-time">{formatDateTime(p.created_at)}</span>
                  </div>
                  <div className="inbox-context-related__item-subject">{p.subject}</div>
                </button>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
    </PipelineLookupContext.Provider>
  )
}
