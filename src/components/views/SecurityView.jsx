import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'

const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 }
const SEV_TONE  = { critical: 'error', high: 'error', medium: 'warning', low: 'idle', info: 'idle' }
const SEV_LABEL = { critical: 'Kritiek', high: 'Hoog', medium: 'Medium', low: 'Laag', info: 'Info' }
const CAT_LABEL = { rls: 'RLS', secrets: 'Secrets', auth: 'Auth', code: 'Code', config: 'Config', network: 'Netwerk' }
const SCAN_LABEL = { daily_monitor: 'Dagelijks', weekly_scan: 'Wekelijks', manual: 'Handmatig' }
const STATUS_TONE = { open: 'error', resolved: 'success', accepted_risk: 'warning', false_positive: 'idle' }
const STATUS_LABEL = { open: 'Open', resolved: 'Opgelost', accepted_risk: 'Geaccepteerd', false_positive: 'Onterecht' }

function relTime(iso) {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000)       return 'zojuist'
  if (ms < 3_600_000)    return `${Math.round(ms / 60_000)}m geleden`
  if (ms < 86_400_000)   return `${Math.round(ms / 3_600_000)}u geleden`
  if (ms < 7 * 86_400_000) return `${Math.round(ms / 86_400_000)}d geleden`
  return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
}

export default function SecurityView() {
  const [findings, setFindings]         = useState(null)
  const [lastScan, setLastScan]         = useState(null)
  const [error, setError]               = useState(null)
  const [statusFilter, setStatusFilter] = useState('open')
  const [sevFilter, setSevFilter]       = useState('all')
  const [refreshing, setRefreshing]     = useState(false)
  const [refreshTick, setRefreshTick]   = useState(0)
  const [updatingId, setUpdatingId]     = useState(null)
  const [expandedId, setExpandedId]     = useState(null)

  useEffect(() => {
    let cancelled = false
    setRefreshing(true)

    Promise.all([
      supabase.from('security_findings').select('*').order('found_at', { ascending: false }).limit(200),
      supabase.from('agent_runs').select('completed_at, status, summary').eq('agent_name', 'security-monitor').order('completed_at', { ascending: false }).limit(1),
    ]).then(([{ data: f, error: fe }, { data: r }]) => {
      if (cancelled) return
      if (fe) setError(fe.message)
      else setFindings(f || [])
      setLastScan(r?.[0] || null)
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
      low:      open.filter(f => f.severity === 'low').length,
      resolved: findings.filter(f => f.status === 'resolved').length,
      total:    findings.length,
    }
  }, [findings])

  const filtered = useMemo(() => {
    if (!findings) return []
    return findings
      .filter(f => statusFilter === 'all' || f.status === statusFilter)
      .filter(f => sevFilter === 'all' || f.severity === sevFilter)
      .sort((a, b) => {
        const sa = SEV_ORDER[a.severity] ?? 9
        const sb = SEV_ORDER[b.severity] ?? 9
        if (sa !== sb) return sa - sb
        return new Date(b.found_at) - new Date(a.found_at)
      })
  }, [findings, statusFilter, sevFilter])

  async function updateStatus(id, newStatus) {
    setUpdatingId(id)
    const patch = { status: newStatus }
    if (newStatus === 'resolved') patch.resolved_at = new Date().toISOString()
    const { error: ue } = await supabase.from('security_findings').update(patch).eq('id', id)
    if (!ue) setFindings(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f))
    setUpdatingId(null)
  }

  if (error) {
    return (
      <div className="card" style={{ padding: 'var(--s-5)', color: 'var(--error)' }}>
        Kon security_findings niet laden: {error}
      </div>
    )
  }

  if (!findings) {
    return (
      <div className="stack" style={{ gap: 'var(--s-5)' }}>
        <div className="skeleton" style={{ height: 80 }} />
        <div className="skeleton" style={{ height: 380 }} />
      </div>
    )
  }

  const openCount = summary.critical + summary.high + summary.medium + summary.low

  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>

      {/* KPI strip */}
      <div className="card" style={{ padding: 'var(--s-5)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-5)', alignItems: 'center' }}>
          <SevKpi tone="error"   value={summary.critical} label="kritiek open"  />
          <SevKpi tone="error"   value={summary.high}     label="hoog open"     />
          <SevKpi tone="warning" value={summary.medium}   label="medium open"   />
          <SevKpi tone="idle"    value={summary.low}      label="laag/info open" />
          <SevKpi tone="success" value={summary.resolved} label="opgelost"      />
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
            {lastScan && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Laatste scan: {relTime(lastScan.completed_at)}
                {' '}
                <span className={`pill s-${lastScan.status === 'success' ? 'success' : lastScan.status === 'warning' ? 'warning' : 'error'}`} style={{ fontSize: 11 }}>
                  {lastScan.status}
                </span>
              </span>
            )}
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setRefreshTick(t => t + 1)}
              disabled={refreshing}
            >
              {refreshing ? 'Laden…' : 'Ververs'}
            </button>
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="card" style={{ padding: 'var(--s-4) var(--s-5)' }}>
        <div style={{ display: 'flex', gap: 'var(--s-3)', flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="kpi__label" style={{ marginRight: 'var(--s-2)' }}>Status:</span>
          {[
            { v: 'open',     label: `Open (${openCount})` },
            { v: 'all',      label: `Alle (${summary.total})` },
            { v: 'resolved', label: `Opgelost (${summary.resolved})` },
            { v: 'accepted_risk', label: 'Geaccepteerd' },
          ].map(({ v, label }) => (
            <FPill key={v} active={statusFilter === v} onClick={() => setStatusFilter(v)} label={label} />
          ))}
          <span style={{ margin: '0 var(--s-3)', color: 'var(--border)' }}>|</span>
          <span className="kpi__label" style={{ marginRight: 'var(--s-2)' }}>Ernst:</span>
          <FPill active={sevFilter === 'all'} onClick={() => setSevFilter('all')} label="Alle" />
          {['critical','high','medium','low','info'].map(s => (
            <FPill key={s} active={sevFilter === s} onClick={() => setSevFilter(s)} label={SEV_LABEL[s]} tone={SEV_TONE[s]} />
          ))}
        </div>
      </div>

      {/* Findings tabel */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 'var(--s-7)', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            {statusFilter === 'open' && openCount === 0
              ? '✅ Geen open bevindingen — alles schoon'
              : 'Geen bevindingen in deze filter'}
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)', textAlign: 'left' }}>
                <Th>Ernst</Th>
                <Th>Bevinding</Th>
                <Th>Categorie</Th>
                <Th>Scan</Th>
                <Th>Gevonden</Th>
                <Th>Status</Th>
                <Th>Acties</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(f => {
                const expanded = expandedId === f.id
                return [
                  <tr
                    key={f.id}
                    style={{ borderTop: '1px solid var(--border)', cursor: f.detail ? 'pointer' : 'default' }}
                    onClick={() => f.detail && setExpandedId(expanded ? null : f.id)}
                  >
                    <Td>
                      <span className={`pill s-${SEV_TONE[f.severity]}`} style={{ fontSize: 11, minWidth: 56, textAlign: 'center' }}>
                        {SEV_LABEL[f.severity] || f.severity}
                      </span>
                    </Td>
                    <Td>
                      <div style={{ fontWeight: 500, fontSize: 13 }}>{f.title}</div>
                      {f.affected_object && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'monospace' }}>
                          {f.affected_object}
                        </div>
                      )}
                      {f.detail && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                          {expanded ? '▲ verberg detail' : '▼ toon detail'}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <span className="pill" style={{ fontSize: 11 }}>{CAT_LABEL[f.category] || f.category}</span>
                    </Td>
                    <Td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {SCAN_LABEL[f.scan_type] || f.scan_type}
                    </Td>
                    <Td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {relTime(f.found_at)}
                    </Td>
                    <Td>
                      <span className={`pill s-${STATUS_TONE[f.status]}`} style={{ fontSize: 11 }}>
                        {STATUS_LABEL[f.status] || f.status}
                      </span>
                    </Td>
                    <Td onClick={e => e.stopPropagation()}>
                      {f.status === 'open' && (
                        <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
                          <ActionBtn
                            label="Opgelost"
                            disabled={updatingId === f.id}
                            onClick={() => updateStatus(f.id, 'resolved')}
                            tone="success"
                          />
                          <ActionBtn
                            label="Accepteer"
                            disabled={updatingId === f.id}
                            onClick={() => updateStatus(f.id, 'accepted_risk')}
                            tone="warning"
                          />
                        </div>
                      )}
                      {f.status !== 'open' && (
                        <ActionBtn
                          label="Heropen"
                          disabled={updatingId === f.id}
                          onClick={() => updateStatus(f.id, 'open')}
                          tone="idle"
                        />
                      )}
                    </Td>
                  </tr>,
                  expanded && f.detail && (
                    <tr key={`${f.id}-detail`} style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border)' }}>
                      <td colSpan={7} style={{ padding: 'var(--s-4) var(--s-5)' }}>
                        <pre style={{
                          margin: 0,
                          fontSize: 12,
                          color: 'var(--text)',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          fontFamily: 'monospace',
                          lineHeight: 1.6,
                        }}>{f.detail}</pre>
                        {f.notes && (
                          <div style={{ marginTop: 'var(--s-3)', fontSize: 12, color: 'var(--text-muted)' }}>
                            <strong>Notities:</strong> {f.notes}
                          </div>
                        )}
                        {f.resolved_at && (
                          <div style={{ marginTop: 'var(--s-2)', fontSize: 11, color: 'var(--text-muted)' }}>
                            Opgelost: {relTime(f.resolved_at)}
                          </div>
                        )}
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div className="card" style={{ padding: 'var(--s-4) var(--s-5)', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        Bron: <code>security_findings</code> tabel. Agent <code>security-monitor</code> draait dagelijks 07:00 (ma–do: lichte check, vr: full scan).
        Klik op een bevinding om het detail uit te klappen. Ververst automatisch elke 90 seconden.
      </div>
    </div>
  )
}

function SevKpi({ tone, value, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
      <span className={`pill s-${tone}`} style={{ minWidth: 36, textAlign: 'center', fontSize: 14, fontWeight: 600 }}>
        {value}
      </span>
      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{label}</span>
    </div>
  )
}

function FPill({ active, onClick, label, tone }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`pill ${active && tone ? `s-${tone}` : active ? 's-success' : ''}`}
      style={{
        cursor: 'pointer',
        border: active ? `1px solid var(--${tone || 'success'})` : '1px solid var(--border)',
        background: active ? `var(--${tone || 'success'}-dim, var(--surface-2))` : 'var(--surface-2)',
        color: active ? `var(--${tone || 'success'})` : 'var(--text)',
      }}
    >
      {label}
    </button>
  )
}

function ActionBtn({ label, onClick, disabled, tone }) {
  const colors = {
    success: { bg: 'var(--success-dim, rgba(76,175,80,.15))', border: 'var(--success)', color: 'var(--success)' },
    warning: { bg: 'var(--warning-dim, rgba(224,168,0,.15))', border: 'var(--warning)', color: 'var(--warning)' },
    idle:    { bg: 'var(--surface-2)',                         border: 'var(--border)',   color: 'var(--text-muted)' },
  }
  const c = colors[tone] || colors.idle
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        fontSize: 11,
        padding: '2px 8px',
        borderRadius: 'var(--r-sm)',
        border: `1px solid ${c.border}`,
        background: c.bg,
        color: c.color,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  )
}

function Th({ children, align = 'left' }) {
  return (
    <th style={{
      padding: 'var(--s-3) var(--s-5)',
      textAlign: align,
      fontWeight: 500,
      fontSize: 12,
      color: 'var(--text-muted)',
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
    }}>{children}</th>
  )
}

function Td({ children, align = 'left', style = {}, onClick }) {
  return (
    <td onClick={onClick} style={{
      padding: 'var(--s-3) var(--s-5)',
      textAlign: align,
      fontSize: 14,
      verticalAlign: 'top',
      ...style,
    }}>{children}</td>
  )
}
