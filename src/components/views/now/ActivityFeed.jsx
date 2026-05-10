import { useMemo } from 'react'
import { NEVER_SHOW } from '../../../lib/agentFunctions'
import { truncate, prettyAgent, agentTone } from '../../../lib/now'
import Icon from './Icon'

// Recente activity feed — laatste 8 user-facing agent runs.
// Filter NEVER_SHOW (orchestrator/dashboard-refresh/agent-manager + helpers
// chunker/mail-backfill/hubspot-engagements-sync/autodraft-rag-prefill).
export default function ActivityFeed({ history, latestRuns }) {
  const items = useMemo(() => {
    const all = []
    Object.entries(history || {}).forEach(([agent, runs]) => {
      if (NEVER_SHOW.has(agent)) return
      ;(runs || []).forEach(r => all.push({ ...r, agent_name: agent }))
    })
    Object.entries(latestRuns || {}).forEach(([agent, run]) => {
      if (NEVER_SHOW.has(agent) || !run) return
      all.push({ ...run, agent_name: agent })
    })
    const seen = new Set()
    const unique = all.filter(r => {
      if (!r.id || seen.has(r.id)) return false
      seen.add(r.id)
      return true
    })
    unique.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
    return unique.slice(0, 8)
  }, [history, latestRuns])

  return (
    <div className="now-feed">
      <div className="now-feed__head">
        <h3>Recente activity</h3>
        <span className="now-pill now-pill--ok">
          <span className="now-pill__dot" />
          {items.filter(i => i.status === 'success').length} verwerkt
        </span>
      </div>
      {items.length === 0 ? (
        <div className="now-empty">nog geen agent-runs vandaag</div>
      ) : (
        items.map(item => <FeedRow key={item.id} item={item} />)
      )}
    </div>
  )
}

function FeedRow({ item }) {
  const tone = agentTone(item.agent_name)
  const t = new Date(item.started_at)
  const hm = t.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
  const isErr = item.status === 'error'
  return (
    <div className="now-feed__row">
      <div className={`now-feed__icon ${isErr ? 'now-feed__icon--err' : 'now-feed__icon--' + tone}`}>
        <Icon size={14}>{agentIconChildren(item.agent_name)}</Icon>
      </div>
      <div className="now-feed__main">
        <div className="now-feed__t">
          <strong>{prettyAgent(item.agent_name)}</strong>{item.message ? ' — ' + truncate(item.message, 90) : ''}
        </div>
        {isErr && <div className="now-feed__sub">fout — {truncate(item.error_message || 'onbekend', 80)}</div>}
      </div>
      <span className="now-feed__when">{hm}</span>
    </div>
  )
}

function agentIconChildren(agent) {
  const a = String(agent || '').toLowerCase()
  if (a.includes('admin'))    return <><path d="M12 2v20M2 12h20"/></>
  if (a.includes('mail') || a.includes('autodraft')) return <><path d="M3 7h18v12H3z"/><path d="M3 7l9 7 9-7"/></>
  if (a.includes('agenda') || a.includes('plan'))    return <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18"/></>
  return <><circle cx="12" cy="12" r="9"/><path d="M9 12h6"/></>
}
