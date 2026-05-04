import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'

// Health & Issues — fundament-pagina voor agent-observability.
// Leest agent_runs_health_7d (view live sinds Project — Agent Logging & Observability F.2).
// MVP: alleen laag-1 (run-logs). Output-state en decision-trail komen mee in F.4.b.
//
// Kleur-drempels op success_pct:
//   ≥95% → groen (alles ok)
//   80–95% → geel (let op)
//   <80% → rood (echte issue)
//   geen runs in 7d → grijs (idle / disabled)

const TIER_LABELS = {
  source:    'Source (sync)',
  infra:     'Infra (poller / deploy)',
  primary:   'Primary',
  secondary: 'Secondary',
}
const TIER_ORDER = ['primary', 'secondary', 'source', 'infra']

function tone(pct, runs) {
  if (runs === 0 || pct === null) return 'idle'
  if (pct >= 95) return 'success'
  if (pct >= 80) return 'warning'
  return 'error'
}

function relativeTime(iso) {
  if (!iso) return null
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000) return 'zojuist'
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m geleden`
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}u geleden`
  return `${Math.round(ms / 86_400_000)}d geleden`
}

export default function HealthView() {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [tierFilter, setTierFilter] = useState('all')
  const [refreshTick, setRefreshTick] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    let cancelled = false
    setRefreshing(true)
    supabase
      .from('agent_runs_health_7d')
      .select('*')
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(error.message)
        else setRows(data || [])
        setRefreshing(false)
      })
    return () => { cancelled = true }
  }, [refreshTick])

  // Auto-refresh elke 60s — lichte query
  useEffect(() => {
    const id = setInterval(() => setRefreshTick(t => t + 1), 60_000)
    return () => clearInterval(id)
  }, [])

  const summary = useMemo(() => {
    if (!rows) return null
    let critical = 0, warning = 0, idle = 0, ok = 0
    for (const r of rows) {
      const t = tone(r.success_pct === null ? null : Number(r.success_pct), r.runs_total)
      if (t === 'error') critical++
      else if (t === 'warning') warning++
      else if (t === 'idle') idle++
      else ok++
    }
    return { critical, warning, idle, ok, total: rows.length }
  }, [rows])

  const filtered = useMemo(() => {
    if (!rows) return []
    const list = tierFilter === 'all' ? rows : rows.filter(r => r.tier === tierFilter)
    return list.slice().sort((a, b) => {
      // 1. agents met issues bovenaan (rood > geel > idle > groen)
      const ta = tone(a.success_pct === null ? null : Number(a.success_pct), a.runs_total)
      const tb = tone(b.success_pct === null ? null : Number(b.success_pct), b.runs_total)
      const order = { error: 0, warning: 1, idle: 3, success: 2 }
      if (order[ta] !== order[tb]) return order[ta] - order[tb]
      // 2. binnen severity: laagste success_pct eerst
      const pa = a.success_pct === null ? 999 : Number(a.success_pct)
      const pb = b.success_pct === null ? 999 : Number(b.success_pct)
      if (pa !== pb) return pa - pb
      return (a.agent_name || '').localeCompare(b.agent_name || '')
    })
  }, [rows, tierFilter])

  if (error) {
    return (
      <div className="card" style={{ padding: 'var(--s-5)', color: 'var(--error)' }}>
        Kon agent_runs_health_7d niet laden: {error}
      </div>
    )
  }

  if (!rows) {
    return (
      <div className="stack" style={{ gap: 'var(--s-5)' }}>
        <div className="skeleton" style={{ height: 80 }} />
        <div className="skeleton" style={{ height: 320 }} />
      </div>
    )
  }

  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>
      {/* Severity-summary strip */}
      <div className="card" style={{ padding: 'var(--s-5)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-5)', alignItems: 'center' }}>
          <SeverityKpi tone="error"   value={summary.critical} label="agents met fouten" />
          <SeverityKpi tone="warning" value={summary.warning}  label="agents om in de gaten te houden" />
          <SeverityKpi tone="success" value={summary.ok}       label="agents gezond" />
          <SeverityKpi tone="idle"    value={summary.idle}     label="agents zonder runs (7d)" />
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setRefreshTick(t => t + 1)}
              disabled={refreshing}
              title="Ververs nu"
            >
              {refreshing ? 'Verversen…' : 'Ververs'}
            </button>
          </div>
        </div>
      </div>

      {/* Tier-filter */}
      <div className="card" style={{ padding: 'var(--s-4) var(--s-5)' }}>
        <div style={{ display: 'flex', gap: 'var(--s-2)', flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="kpi__label" style={{ marginRight: 'var(--s-3)' }}>Filter op tier:</span>
          <FilterPill active={tierFilter === 'all'}     onClick={() => setTierFilter('all')}     label={`Alle (${rows.length})`} />
          {TIER_ORDER.map(t => {
            const count = rows.filter(r => r.tier === t).length
            if (count === 0) return null
            return (
              <FilterPill
                key={t}
                active={tierFilter === t}
                onClick={() => setTierFilter(t)}
                label={`${TIER_LABELS[t] || t} (${count})`}
              />
            )
          })}
        </div>
      </div>

      {/* Health-tabel */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="health-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface-2)', textAlign: 'left' }}>
              <Th>Agent</Th>
              <Th>Tier</Th>
              <Th align="right">7d runs</Th>
              <Th align="right">✓</Th>
              <Th align="right">⚠</Th>
              <Th align="right">✗</Th>
              <Th align="right">Success</Th>
              <Th align="right">Avg dur</Th>
              <Th>Laatste fout</Th>
              <Th>Laatste run</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={10} style={{ padding: 'var(--s-6)', textAlign: 'center', color: 'var(--text-muted)' }}>
                Geen agents in deze filter.
              </td></tr>
            )}
            {filtered.map(r => {
              const pct = r.success_pct === null ? null : Number(r.success_pct)
              const t = tone(pct, r.runs_total)
              return (
                <tr key={r.agent_name} style={{ borderTop: '1px solid var(--border)' }}>
                  <Td>
                    <div style={{ fontWeight: 500 }}>{r.display_name || r.agent_name}</div>
                    {r.display_name && r.display_name !== r.agent_name && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.agent_name}</div>
                    )}
                    {!r.enabled && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>(disabled)</div>
                    )}
                  </Td>
                  <Td>
                    <span className="pill" style={{ fontSize: 11 }}>{TIER_LABELS[r.tier] || r.tier || '—'}</span>
                  </Td>
                  <Td align="right">{r.runs_total ?? 0}</Td>
                  <Td align="right" style={{ color: r.ok_count > 0 ? 'var(--success)' : 'var(--text-muted)' }}>{r.ok_count ?? 0}</Td>
                  <Td align="right" style={{ color: r.warn_count > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>{r.warn_count ?? 0}</Td>
                  <Td align="right" style={{ color: r.err_count > 0 ? 'var(--error)' : 'var(--text-muted)' }}>{r.err_count ?? 0}</Td>
                  <Td align="right">
                    <span className={`pill s-${t}`} style={{ minWidth: 56, textAlign: 'center' }}>
                      {pct === null ? '—' : `${pct}%`}
                    </span>
                  </Td>
                  <Td align="right" style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {r.avg_dur_s ? `${Number(r.avg_dur_s).toFixed(0)}s` : '—'}
                  </Td>
                  <Td style={{ fontSize: 12, color: r.last_failure_at ? 'var(--error)' : 'var(--text-muted)' }}>
                    {relativeTime(r.last_failure_at) || '—'}
                  </Td>
                  <Td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {relativeTime(r.last_run_at) || '—'}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Frontend Security F.4.4 — Security events sectie */}
      <SecurityEventsSection />

      {/* Footer-info */}
      <div className="card" style={{ padding: 'var(--s-4) var(--s-5)', fontSize: 13, color: 'var(--text-muted)' }}>
        Bron: <code>agent_runs_health_7d</code> (view, 7d window). Ververst automatisch elke 60 seconden.
        Output-state en decision-trail-aggregatie komen in F.4.b — nu zie je alleen run-logs.
      </div>
    </div>
  )
}

// ============================================================
// SecurityEventsSection — Frontend Security F.4.4
// Toont auth-events + CSP-violations + client-errors uit de drie
// security-tabellen via security_events_summary + _recent views.
// ============================================================
function SecurityEventsSection() {
  const [summary, setSummary] = useState(null)
  const [recent, setRecent] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('security_events_summary').select('*'),
      supabase.from('security_events_recent').select('*').order('event_at', { ascending: false }).limit(20),
    ]).then(([s, r]) => {
      if (cancelled) return
      if (s.error) { setError(s.error.message); return }
      if (r.error) { setError(r.error.message); return }
      setSummary(s.data || [])
      setRecent(r.data || [])
    })
    return () => { cancelled = true }
  }, [])

  const totals = useMemo(() => {
    if (!summary) return null
    let last24h = 0, last7d = 0, errors24h = 0
    for (const row of summary) {
      last24h += Number(row.last_24h || 0)
      last7d += Number(row.last_7d || 0)
      if (row.severity === 'error') errors24h += Number(row.last_24h || 0)
    }
    return { last24h, last7d, errors24h }
  }, [summary])

  if (error) {
    return (
      <div className="card" style={{ padding: 'var(--s-5)', color: 'var(--error)' }}>
        Security events kon niet geladen worden: {error}
      </div>
    )
  }

  if (!summary || !recent) {
    return <div className="skeleton" style={{ height: 160 }} />
  }

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
        Security events
        <span className="pill" style={{ fontSize: 11 }}>F.4.4</span>
      </div>

      {/* Tellers */}
      <div className="card" style={{ padding: 'var(--s-5)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-5)', alignItems: 'center' }}>
          <SeverityKpi tone={totals.errors24h > 0 ? 'error' : 'success'} value={totals.errors24h} label="errors (24u)" />
          <SeverityKpi tone="idle" value={totals.last24h} label="events (24u)" />
          <SeverityKpi tone="idle" value={totals.last7d} label="events (7d)" />
        </div>
        {summary.length > 0 && (
          <div style={{ marginTop: 'var(--s-4)', display: 'flex', flexWrap: 'wrap', gap: 'var(--s-2)' }}>
            {summary.map((row, i) => (
              <span key={i} className={`pill s-${row.severity === 'error' ? 'error' : row.severity === 'warning' ? 'warning' : 'idle'}`} style={{ fontSize: 11 }}>
                {row.kind}/{row.severity}: {row.last_24h}/24u · {row.last_7d}/7d
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Recente events */}
      {recent.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="health-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface-2)', textAlign: 'left' }}>
                <Th>Wanneer</Th>
                <Th>Soort</Th>
                <Th>Sev</Th>
                <Th>Code</Th>
                <Th>Detail</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map((e, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                  <Td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{relativeTime(e.event_at) || '—'}</Td>
                  <Td>
                    <span className="pill" style={{ fontSize: 11 }}>{e.kind}</span>
                  </Td>
                  <Td>
                    <span className={`pill s-${e.severity === 'error' ? 'error' : e.severity === 'warning' ? 'warning' : 'success'}`} style={{ fontSize: 11 }}>
                      {e.severity}
                    </span>
                  </Td>
                  <Td style={{ fontSize: 12, fontFamily: 'monospace' }}>{e.event_code || '—'}</Td>
                  <Td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {e.actor || e.ip_address || e.message || '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {recent.length === 0 && (
        <div className="card" style={{ padding: 'var(--s-5)', fontSize: 13, color: 'var(--text-muted)' }}>
          Geen security-events in de laatste 30 dagen. Bron: <code>security_events_recent</code>.
        </div>
      )}
    </div>
  )
}

function SeverityKpi({ tone, value, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
      <span className={`pill s-${tone}`} style={{ minWidth: 36, textAlign: 'center', fontSize: 14, fontWeight: 600 }}>
        {value}
      </span>
      <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{label}</span>
    </div>
  )
}

function FilterPill({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`pill ${active ? 's-success' : ''}`}
      style={{
        cursor: 'pointer',
        border: active ? '1px solid var(--success)' : '1px solid var(--border)',
        background: active ? 'var(--success-dim)' : 'var(--surface-2)',
        color: active ? 'var(--success)' : 'var(--text)',
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

function Td({ children, align = 'left', style = {} }) {
  return (
    <td style={{
      padding: 'var(--s-3) var(--s-5)',
      textAlign: align,
      fontSize: 14,
      verticalAlign: 'top',
      ...style,
    }}>{children}</td>
  )
}
