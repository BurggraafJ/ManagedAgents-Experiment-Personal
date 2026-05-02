import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'

const SEV_ORDER  = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
const SEV_COLOR  = { critical: 'var(--error)', high: '#f06a25', medium: 'var(--warning)', low: 'var(--text-muted)', info: 'var(--text-muted)' }
const SEV_BG     = { critical: 'rgba(217,83,79,.10)', high: 'rgba(240,106,37,.10)', medium: 'rgba(224,168,0,.10)', low: 'var(--surface-2)', info: 'var(--surface-2)' }
const SEV_LABEL  = { critical: 'Kritiek', high: 'Hoog', medium: 'Medium', low: 'Laag', info: 'Info' }
const CAT_LABEL  = { rls: 'RLS', secrets: 'Secrets', auth: 'Auth', code: 'Code', config: 'Config', network: 'Netwerk' }
const CAT_ICON   = { rls: '🔒', secrets: '🔑', auth: '🛡', code: '💻', config: '⚙️', network: '🌐' }
const SCAN_LABEL = { daily_monitor: 'Dagelijks', weekly_scan: 'Wekelijks', manual: 'Handmatig' }
const STATUS_TONE  = { open: 'error', resolved: 'success', accepted_risk: 'warning', false_positive: 'idle' }
const STATUS_LABEL = { open: 'Open', resolved: 'Opgelost', accepted_risk: 'Geaccepteerd', false_positive: 'Onterecht' }

function relTime(iso) {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000)         return 'zojuist'
  if (ms < 3_600_000)      return `${Math.round(ms / 60_000)}m geleden`
  if (ms < 86_400_000)     return `${Math.round(ms / 3_600_000)}u geleden`
  if (ms < 7 * 86_400_000) return `${Math.round(ms / 86_400_000)}d geleden`
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
}

function absDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function SecurityView() {
  const [findings, setFindings]     = useState(null)
  const [scanLogs, setScanLogs]     = useState(null)
  const [error, setError]           = useState(null)
  const [tab, setTab]               = useState('open')       // 'open' | 'all' | 'logs'
  const [sevFilter, setSevFilter]   = useState('all')
  const [refreshing, setRefreshing] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)
  const [updatingId, setUpdatingId] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [expandedLogId, setExpandedLogId] = useState(null)

  useEffect(() => {
    let cancelled = false
    setRefreshing(true)
    Promise.all([
      supabase.from('security_findings').select('*').order('found_at', { ascending: false }).limit(300),
      supabase.from('agent_runs')
        .select('id,completed_at,started_at,status,summary,stats')
        .eq('agent_name', 'security-monitor')
        .order('completed_at', { ascending: false })
        .limit(30),
    ]).then(([{ data: f, error: fe }, { data: r }]) => {
      if (cancelled) return
      if (fe) setError(fe.message)
      else setFindings(f || [])
      setScanLogs(r || [])
      setRefreshing(false)
    })
    return () => { cancelled = true }
  }, [refreshTick])

  useEffect(() => {
    const id = setInterval(() => setRefreshTick(t => t + 1), 90_000)
    return () => clearInterval(id)
  }, [])

  const summary = useMemo(() => {
    if (!findings) return null
    const open = findings.filter(f => f.status === 'open')
    return {
      critical: open.filter(f => f.severity === 'critical').length,
      high:     open.filter(f => f.severity === 'high').length,
      medium:   open.filter(f => f.severity === 'medium').length,
      low:      open.filter(f => f.severity === 'low' || f.severity === 'info').length,
      resolved: findings.filter(f => f.status === 'resolved').length,
      accepted: findings.filter(f => f.status === 'accepted_risk').length,
      total:    findings.length,
    }
  }, [findings])

  const lastScan = scanLogs?.[0] || null
  const lastWeeklyScan = scanLogs?.find(r => r.stats?.mode === 'weekly_scan') || null

  const filteredFindings = useMemo(() => {
    if (!findings) return []
    let list = findings
    if (tab === 'open')    list = list.filter(f => f.status === 'open')
    if (tab === 'resolved') list = list.filter(f => f.status !== 'open')
    if (sevFilter !== 'all') list = list.filter(f => f.severity === sevFilter)
    return list.sort((a, b) => {
      const sa = SEV_ORDER[a.severity] ?? 9, sb = SEV_ORDER[b.severity] ?? 9
      if (sa !== sb) return sa - sb
      return new Date(b.found_at) - new Date(a.found_at)
    })
  }, [findings, tab, sevFilter])

  async function updateStatus(id, newStatus) {
    setUpdatingId(id)
    const patch = { status: newStatus }
    if (newStatus === 'resolved') patch.resolved_at = new Date().toISOString()
    const { error: ue } = await supabase.from('security_findings').update(patch).eq('id', id)
    if (!ue) setFindings(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f))
    setUpdatingId(null)
  }

  if (error) return (
    <div className="card" style={{ padding: 'var(--s-5)', color: 'var(--error)' }}>
      Fout: {error}
    </div>
  )

  if (!findings) return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <div className="skeleton" style={{ height: 90 }} />
      <div className="skeleton" style={{ height: 48 }} />
      <div className="skeleton" style={{ height: 320 }} />
    </div>
  )

  const openCount = (summary?.critical || 0) + (summary?.high || 0) + (summary?.medium || 0) + (summary?.low || 0)

  return (
    <div className="stack" style={{ gap: 'var(--s-6)' }}>

      {/* ── KPI Strip ── */}
      <div className="card" style={{ padding: 'var(--s-5)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-4)', alignItems: 'center' }}>
          <KpiBadge value={summary.critical} label="kritiek" color="var(--error)" urgent={summary.critical > 0} />
          <KpiBadge value={summary.high}     label="hoog"    color="#f06a25" />
          <KpiBadge value={summary.medium}   label="medium"  color="var(--warning)" />
          <KpiBadge value={summary.resolved} label="opgelost" color="var(--success)" />

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--s-4)', alignItems: 'center', flexWrap: 'wrap' }}>
            {lastScan && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'right', lineHeight: 1.5 }}>
                <div>
                  Laatste scan: <strong style={{ color: 'var(--text)' }}>{relTime(lastScan.completed_at)}</strong>
                  {' '}
                  <span className={`pill s-${lastScan.status === 'success' ? 'success' : lastScan.status === 'warning' ? 'warning' : 'error'}`} style={{ fontSize: 11 }}>
                    {lastScan.status}
                  </span>
                  {' '}
                  <span className="pill" style={{ fontSize: 11 }}>
                    {lastScan.stats?.mode === 'weekly_scan' ? 'Weekly scan' : 'Daily monitor'}
                  </span>
                </div>
                {lastWeeklyScan && lastWeeklyScan !== lastScan && (
                  <div style={{ marginTop: 2 }}>
                    Laatste weekly scan: <strong style={{ color: 'var(--text)' }}>{relTime(lastWeeklyScan.completed_at)}</strong>
                  </div>
                )}
              </div>
            )}
            {!lastScan && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Nog geen scan uitgevoerd</span>
            )}
            <button
              type="button" className="btn btn--ghost"
              onClick={() => setRefreshTick(t => t + 1)} disabled={refreshing}
            >
              {refreshing ? 'Laden…' : 'Ververs'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div style={{ display: 'flex', gap: 'var(--s-2)', borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {[
          { id: 'open',     label: `Open issues (${openCount})` },
          { id: 'all',      label: `Alle bevindingen (${summary.total})` },
          { id: 'resolved', label: `Afgehandeld (${summary.resolved + summary.accepted})` },
          { id: 'logs',     label: `Scan-logs (${scanLogs?.length || 0})` },
        ].map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => { setTab(t.id); setSevFilter('all') }}
            style={{
              padding: 'var(--s-3) var(--s-5)',
              background: 'none',
              border: 'none',
              borderBottom: tab === t.id ? '2px solid var(--accent, #4a9eff)' : '2px solid transparent',
              color: tab === t.id ? 'var(--text)' : 'var(--text-muted)',
              fontWeight: tab === t.id ? 600 : 400,
              fontSize: 13,
              cursor: 'pointer',
              transition: 'color .15s',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Findings tabs ── */}
      {tab !== 'logs' && (
        <>
          {/* Severity filter */}
          <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap', alignItems: 'center' }}>
            <FPill active={sevFilter === 'all'} onClick={() => setSevFilter('all')} label="Alle ernst" />
            {['critical','high','medium','low','info'].filter(s => findings.some(f => f.severity === s)).map(s => (
              <FPill
                key={s}
                active={sevFilter === s}
                onClick={() => setSevFilter(s)}
                label={SEV_LABEL[s]}
                dotColor={SEV_COLOR[s]}
              />
            ))}
          </div>

          {/* Findings list */}
          {filteredFindings.length === 0 ? (
            <div className="card" style={{ padding: 'var(--s-7)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
              {tab === 'open' ? '✅ Geen open bevindingen — alles schoon' : 'Geen bevindingen in deze filter'}
            </div>
          ) : (
            <div className="stack" style={{ gap: 'var(--s-2)' }}>
              {filteredFindings.map(f => {
                const expanded = expandedId === f.id
                return (
                  <div
                    key={f.id}
                    className="card"
                    style={{
                      padding: 0,
                      overflow: 'hidden',
                      borderLeft: `4px solid ${SEV_COLOR[f.severity] || 'var(--border)'}`,
                    }}
                  >
                    {/* Main row */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '100px 1fr auto auto',
                        gap: 'var(--s-4)',
                        padding: 'var(--s-4) var(--s-5)',
                        alignItems: 'center',
                        cursor: f.detail ? 'pointer' : 'default',
                        background: expanded ? SEV_BG[f.severity] : 'transparent',
                        transition: 'background .15s',
                      }}
                      onClick={() => f.detail && setExpandedId(expanded ? null : f.id)}
                    >
                      {/* Severity + category */}
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: SEV_COLOR[f.severity], textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {SEV_LABEL[f.severity]}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {CAT_ICON[f.category]} {CAT_LABEL[f.category] || f.category}
                        </div>
                      </div>

                      {/* Title + object */}
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 14 }}>{f.title}</div>
                        {f.affected_object && (
                          <code style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 3, marginTop: 4, display: 'inline-block' }}>
                            {f.affected_object}
                          </code>
                        )}
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 'var(--s-3)', flexWrap: 'wrap' }}>
                          <span>{relTime(f.found_at)}</span>
                          <span>·</span>
                          <span>{SCAN_LABEL[f.scan_type] || f.scan_type}</span>
                          {f.detail && <span>· {expanded ? '▲ verberg' : '▼ detail'}</span>}
                        </div>
                      </div>

                      {/* Status */}
                      <div>
                        <span className={`pill s-${STATUS_TONE[f.status]}`} style={{ fontSize: 11 }}>
                          {STATUS_LABEL[f.status] || f.status}
                        </span>
                      </div>

                      {/* Actions */}
                      <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 'var(--s-2)', flexShrink: 0 }}>
                        {f.status === 'open' && (
                          <>
                            <ActionBtn label="Opgelost" tone="success" disabled={updatingId === f.id} onClick={() => updateStatus(f.id, 'resolved')} />
                            <ActionBtn label="Accepteer" tone="warning" disabled={updatingId === f.id} onClick={() => updateStatus(f.id, 'accepted_risk')} />
                          </>
                        )}
                        {f.status !== 'open' && (
                          <ActionBtn label="Heropen" tone="idle" disabled={updatingId === f.id} onClick={() => updateStatus(f.id, 'open')} />
                        )}
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {expanded && f.detail && (
                      <div style={{ padding: 'var(--s-4) var(--s-5)', borderTop: '1px solid var(--border)', background: SEV_BG[f.severity] }}>
                        <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace', color: 'var(--text)', lineHeight: 1.6 }}>
                          {f.detail}
                        </pre>
                        {f.notes && (
                          <div style={{ marginTop: 'var(--s-3)', fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            Notitie: {f.notes}
                          </div>
                        )}
                        {f.resolved_at && (
                          <div style={{ marginTop: 'var(--s-2)', fontSize: 11, color: 'var(--success)' }}>
                            Opgelost: {absDate(f.resolved_at)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* ── Scan-logs tab ── */}
      {tab === 'logs' && (
        <div className="stack" style={{ gap: 'var(--s-3)' }}>
          {(!scanLogs || scanLogs.length === 0) ? (
            <div className="card" style={{ padding: 'var(--s-7)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
              Nog geen scan-logs. De agent draait dagelijks 07:00 op werkdagen.
            </div>
          ) : scanLogs.map(log => {
            const isWeekly = log.stats?.mode === 'weekly_scan'
            const expanded = expandedLogId === log.id
            const counts   = log.stats?.counts || {}
            return (
              <div
                key={log.id}
                className="card"
                style={{
                  padding: 0,
                  overflow: 'hidden',
                  borderLeft: `4px solid ${isWeekly ? '#4a9eff' : 'var(--border)'}`,
                }}
              >
                <div
                  style={{ padding: 'var(--s-4) var(--s-5)', cursor: 'pointer', display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 'var(--s-4)', alignItems: 'center' }}
                  onClick={() => setExpandedLogId(expanded ? null : log.id)}
                >
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>
                        {isWeekly ? '🔍 Weekly Deep Scan' : '👁 Daily Monitor'}
                      </span>
                      <span className={`pill s-${log.status === 'success' ? 'success' : log.status === 'warning' ? 'warning' : 'error'}`} style={{ fontSize: 11 }}>
                        {log.status}
                      </span>
                      {counts.findings_new > 0 && (
                        <span className={`pill s-${counts.findings_critical > 0 ? 'error' : counts.findings_high > 0 ? 'warning' : 'idle'}`} style={{ fontSize: 11 }}>
                          {counts.findings_new} nieuw
                        </span>
                      )}
                      {counts.findings_new === 0 && (
                        <span className="pill s-success" style={{ fontSize: 11 }}>✓ schoon</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, display: 'flex', gap: 'var(--s-3)' }}>
                      <span>{absDate(log.completed_at)}</span>
                      {counts.checks_run && <span>· {counts.checks_run} checks</span>}
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>
                    {relTime(log.completed_at)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {expanded ? '▲' : '▼'}
                  </div>
                </div>

                {expanded && (
                  <div style={{ padding: 'var(--s-4) var(--s-5)', borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
                    {log.summary && (
                      <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7, whiteSpace: 'pre-wrap', marginBottom: 'var(--s-4)' }}>
                        {log.summary}
                      </div>
                    )}
                    {log.stats && (
                      <div style={{ display: 'flex', gap: 'var(--s-4)', flexWrap: 'wrap', fontSize: 12 }}>
                        {counts.checks_run     != null && <Stat label="Checks" value={counts.checks_run} />}
                        {counts.findings_new   != null && <Stat label="Nieuw" value={counts.findings_new} color={counts.findings_new > 0 ? 'var(--error)' : 'var(--success)'} />}
                        {counts.findings_critical != null && counts.findings_critical > 0 && <Stat label="Kritiek" value={counts.findings_critical} color="var(--error)" />}
                        {counts.findings_high  != null && counts.findings_high > 0 && <Stat label="Hoog" value={counts.findings_high} color="#f06a25" />}
                      </div>
                    )}
                    {log.stats?.extra?.modus && (
                      <div style={{ marginTop: 'var(--s-3)', fontSize: 11, color: 'var(--text-muted)' }}>
                        Modus: {log.stats.extra.modus === 'weekly_scan' ? 'Weekly deep scan' : 'Daily light monitor'}
                        {log.started_at && <> · Duur: {Math.round((new Date(log.completed_at) - new Date(log.started_at)) / 1000)}s</>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Footer ── */}
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, padding: 'var(--s-2) 0' }}>
        Bron: <code>security_findings</code> + <code>agent_runs</code> (agent <code>security-monitor</code>).
        Schedule: ma–do 07:00 daily monitor · vrijdag 07:00 weekly deep scan. Auto-refresh 90s.
      </div>
    </div>
  )
}

/* ── Sub-components ── */

function KpiBadge({ value, label, color, urgent }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-2)' }}>
      <span style={{
        minWidth: 32, height: 32, borderRadius: 8,
        background: urgent ? color : `${color}22`,
        color: urgent ? '#fff' : color,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: 15,
        border: `1px solid ${color}55`,
      }}>
        {value}
      </span>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
    </div>
  )
}

function FPill({ active, onClick, label, dotColor }) {
  return (
    <button
      type="button" onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '3px 10px', borderRadius: 20, fontSize: 12,
        cursor: 'pointer',
        border: active ? '1px solid var(--text)' : '1px solid var(--border)',
        background: active ? 'var(--surface-2)' : 'transparent',
        color: active ? 'var(--text)' : 'var(--text-muted)',
        fontWeight: active ? 600 : 400,
        transition: 'all .15s',
      }}
    >
      {dotColor && <span style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />}
      {label}
    </button>
  )
}

function ActionBtn({ label, onClick, disabled, tone }) {
  const c = {
    success: { bg: 'rgba(76,175,80,.15)', border: 'var(--success)', color: 'var(--success)' },
    warning: { bg: 'rgba(224,168,0,.15)', border: 'var(--warning)', color: 'var(--warning)' },
    idle:    { bg: 'var(--surface-2)',    border: 'var(--border)',   color: 'var(--text-muted)' },
  }[tone] || {}
  return (
    <button
      type="button" disabled={disabled} onClick={onClick}
      style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: `1px solid ${c.border}`, background: c.bg, color: c.color, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .5 : 1, whiteSpace: 'nowrap' }}
    >
      {label}
    </button>
  )
}

function Stat({ label, value, color }) {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}:</span>
      <strong style={{ color: color || 'var(--text)' }}>{value}</strong>
    </div>
  )
}
