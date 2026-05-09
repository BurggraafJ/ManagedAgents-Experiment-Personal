import { relTime } from '../../../lib/agentFunctions'

export default function FunctionTile({ fn, latestRun }) {
  const status = fn.noTracking ? 'idle' : (latestRun?.status || 'idle')
  const statusLabel = fn.noTracking ? 'on-demand'
                    : status === 'success' ? 'ok'
                    : status === 'error'   ? 'fout'
                    : status === 'warning' ? 'let op'
                    : status === 'running' ? 'draait'
                    : 'geen logs'
  const tone = fn.noTracking ? 's-idle'
             : status === 'success' ? 's-success'
             : status === 'error'   ? 's-error'
             : status === 'warning' ? 's-warning'
             : status === 'running' ? 's-running'
             : 's-idle'

  return (
    <div className="card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{fn.label}</div>
          <div className="mono muted" style={{ fontSize: 10, marginTop: 2 }}>{fn.agent}</div>
        </div>
        <span className={`status-pill ${tone}`} style={{ fontSize: 10, flexShrink: 0 }}>
          {statusLabel}
        </span>
      </div>
      <div style={{ fontSize: 11, lineHeight: 1.4, color: 'var(--text)' }}>{fn.desc}</div>
      <div className="muted" style={{ fontSize: 10, lineHeight: 1.4 }}>
        <strong style={{ color: 'var(--text-muted)' }}>Door:</strong> {fn.usedBy}
      </div>
      {!fn.noTracking && (
        <div className="muted" style={{ fontSize: 10, fontFamily: 'var(--font-mono)', borderTop: '1px solid var(--border)', paddingTop: 4 }}>
          laatste run {relTime(latestRun?.started_at)}
        </div>
      )}
    </div>
  )
}
