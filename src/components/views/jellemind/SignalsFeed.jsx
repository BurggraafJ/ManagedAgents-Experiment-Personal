import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import { SIGNAL_TYPE_LABEL, fmtRelative, preStyle } from '../../../lib/jellemind'

// Signalen-feed (geen scope-filter, gedeeld over alle minds).
export default function SignalsFeed() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showProcessed, setShowProcessed] = useState(false)
  const [collapsed, setCollapsed] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('jellemind_signals')
      .select('*')
      .order('occurred_at', { ascending: false })
      .limit(50)
    if (!showProcessed) q = q.eq('processed', false)
    const { data, error } = await q
    if (error) setError(error.message)
    else setRows(data || [])
    setLoading(false)
  }, [showProcessed])

  useEffect(() => { if (!collapsed) load() }, [load, collapsed])

  return (
    <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
      <button
        onClick={() => setCollapsed(c => !c)}
        style={{
          width: '100%', padding: 'var(--s-4) var(--s-5)',
          background: 'transparent', border: 'none',
          display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
          color: 'var(--text)',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {collapsed ? '▶' : '▼'} Signalen-feed
        </span>
        <span className="muted" style={{ fontSize: 11 }}>
          ruwe correcties die JelleMind heeft geoogst — gedeeld over alle scopes
        </span>
        {!collapsed && (
          <label
            onClick={e => e.stopPropagation()}
            style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)' }}
          >
            <input
              type="checkbox"
              checked={showProcessed}
              onChange={e => setShowProcessed(e.target.checked)}
            />
            ook verwerkte tonen
          </label>
        )}
      </button>

      {!collapsed && (
        <>
          {loading && <div className="muted" style={{ padding: 'var(--s-4)' }}>Signalen laden…</div>}
          {error && <div style={{ padding: 'var(--s-4)', color: '#ef4444' }}>Fout: {error}</div>}
          {!loading && !error && rows.length === 0 && (
            <div className="muted" style={{ padding: 'var(--s-5)', textAlign: 'center' }}>
              Geen signalen — JelleMind heeft nog niets geoogst, of alle signalen zijn verwerkt.
            </div>
          )}
          {rows.map((row, idx) => (
            <SignalRow key={row.id} row={row} isLast={idx === rows.length - 1} />
          ))}
        </>
      )}
    </div>
  )
}

function SignalRow({ row, isLast }) {
  const meta = SIGNAL_TYPE_LABEL[row.signal_type] || SIGNAL_TYPE_LABEL.other
  const [expanded, setExpanded] = useState(false)
  return (
    <div
      style={{
        padding: 'var(--s-3) var(--s-4)',
        borderTop: '1px solid var(--border)',
        borderBottom: isLast ? '1px solid var(--border)' : 'none',
        cursor: 'pointer',
        background: row.processed ? 'transparent' : 'color-mix(in srgb, var(--bg-2) 50%, transparent)',
      }}
      onClick={() => setExpanded(e => !e)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, flexWrap: 'wrap' }}>
        <span style={{ minWidth: 56, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {fmtRelative(row.occurred_at)}
        </span>
        <span
          style={{
            fontSize: 10, fontWeight: 600, padding: '2px 8px',
            borderRadius: 999, color: meta.color,
            background: `color-mix(in srgb, ${meta.color} 15%, var(--bg-2))`,
          }}
        >
          {meta.label}
        </span>
        <span className="muted" style={{ fontSize: 11 }}>· {row.agent_name}</span>
        <span style={{ flex: 1, minWidth: 100, fontSize: 12 }}>
          {row.delta_summary || '—'}
        </span>
        {!row.processed && <span style={{ fontSize: 10, color: '#8b5cf6' }}>nieuw</span>}
      </div>

      {expanded && (
        <div className="stack" style={{ gap: 'var(--s-2)', marginTop: 'var(--s-3)', paddingLeft: 64 }}>
          {row.before_text && (
            <div>
              <div className="muted" style={{ fontSize: 10, marginBottom: 2 }}>Voor:</div>
              <pre style={preStyle}>{row.before_text.slice(0, 400)}</pre>
            </div>
          )}
          {row.after_text && (
            <div>
              <div className="muted" style={{ fontSize: 10, marginBottom: 2 }}>Na:</div>
              <pre style={preStyle}>{row.after_text.slice(0, 400)}</pre>
            </div>
          )}
          <div className="muted" style={{ fontSize: 10 }}>
            bron: {row.source_table} / {row.source_id}
          </div>
        </div>
      )}
    </div>
  )
}
