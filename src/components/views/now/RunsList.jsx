import { useMemo } from 'react'
import { NEVER_SHOW } from '../../../lib/agentFunctions'
import { truncate, prettyAgent, agentTone } from '../../../lib/now'

// RunsList — "Runs vandaag" sectie uit Dashboard.html mockup.
// Toont alle agent-runs van vandaag met status, message, bar en verdict.
// Bovenin telling-pills (success/error/in-progress) en "Bekijk alle"-link.
//
// Filtert NEVER_SHOW agents (orchestrator/dashboard-refresh/etc).
// Sorteert op started_at desc, max 8 zichtbaar.
export default function RunsList({ todayRuns = [] }) {
  const visibleRuns = useMemo(() => {
    return (todayRuns || [])
      .filter(r => !NEVER_SHOW.has(r.agent_name))
      .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
  }, [todayRuns])

  const counts = useMemo(() => {
    const c = { ok: 0, err: 0, run: 0 }
    for (const r of visibleRuns) {
      if (r.status === 'success') c.ok++
      else if (r.status === 'error' || r.status === 'failed') c.err++
      else c.run++
    }
    return c
  }, [visibleRuns])

  const items = visibleRuns.slice(0, 8)

  return (
    <section className="now-runs">
      <div className="now-runs__head">
        <h3>Runs vandaag</h3>
        <span className="now-pill now-pill--ok">{counts.ok} ✓</span>
        {counts.err > 0 && <span className="now-pill now-pill--err">{counts.err} fout</span>}
        {counts.run > 0 && <span className="now-pill">{counts.run} in voortgang</span>}
        <button type="button" className="now-btn now-btn--ghost now-runs__cta" disabled>
          Bekijk alle
        </button>
      </div>
      {items.length === 0 ? (
        <div className="now-empty now-empty--small">geen runs vandaag</div>
      ) : (
        items.map(r => <RunRow key={r.id} run={r} />)
      )}
    </section>
  )
}

function RunRow({ run }) {
  const tone = agentTone(run.agent_name)
  const t = new Date(run.started_at)
  const hm = t.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })

  const verdict =
    run.status === 'success' ? { tone: 'ok',  text: '✓ ok' } :
    run.status === 'error' || run.status === 'failed' ? { tone: 'err', text: '× fout' } :
    { tone: 'run', text: 'in voortgang' }

  // Bar-fill: success volledig, error 60% met error-color, anders pulse.
  const barWidth = run.status === 'success' ? '100%' : run.status === 'error' || run.status === 'failed' ? '60%' : '100%'
  const barTone = run.status === 'success' ? 'ok' : run.status === 'error' || run.status === 'failed' ? 'err' : 'info'

  const initials = (() => {
    const name = String(run.agent_name || '').replace(/[-_]/g, ' ').split(' ').filter(Boolean)
    if (name.length === 0) return '?'
    if (name.length === 1) return name[0].slice(0, 2).toUpperCase()
    return (name[0][0] + name[1][0]).toUpperCase()
  })()

  const message = run.message || run.error_message || run.summary || ''

  return (
    <div className="now-run-row">
      <span className={`now-run-row__name now-run-row__name--${tone}`}>
        <span className="now-run-row__ic">{initials}</span>
        {prettyAgent(run.agent_name)}
      </span>
      <span className="now-run-row__when">{hm}</span>
      <span className="now-run-row__msg" title={message}>{truncate(message, 80) || '—'}</span>
      <div className="now-run-row__bar">
        <span className={`now-run-row__bar-fill now-run-row__bar-fill--${barTone}`} style={{ width: barWidth }} />
      </div>
      <span className={`now-run-row__verdict now-run-row__verdict--${verdict.tone}`}>
        {verdict.text}
      </span>
      <span className="now-run-row__more" aria-hidden="true">⋯</span>
    </div>
  )
}
