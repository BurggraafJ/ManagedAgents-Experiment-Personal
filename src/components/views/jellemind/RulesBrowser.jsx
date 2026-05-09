import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import { LESSON_TYPES, SCOPES, lessonTypeMeta, btnSecondary } from '../../../lib/jellemind'
import RuleRow from './RuleRow'

// RulesBrowser — alle regels per onderwerp (database-readout).
// Filterbaar per lesson_type én mind_scope. Toont default alleen
// actieve lessons; toggle om retired/inactieve mee te tonen.

export default function RulesBrowser() {
  const [allLessons, setAllLessons] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [collapsed, setCollapsed] = useState(true)
  const [typeFilter, setTypeFilter] = useState('all')
  const [scopeFilter, setScopeFilter] = useState('all')
  const [showInactive, setShowInactive] = useState(false)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    let q = supabase.from('jellemind_lessons').select('*').order('created_at', { ascending: false })
    if (!showInactive) q = q.eq('active', true)
    const { data, error } = await q
    if (error) setError(error.message)
    else setAllLessons(data || [])
    setLoading(false)
  }, [showInactive])

  useEffect(() => { if (!collapsed) load() }, [load, collapsed])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return allLessons.filter(l => {
      if (typeFilter !== 'all' && l.lesson_type !== typeFilter) return false
      if (scopeFilter !== 'all' && l.mind_scope !== scopeFilter) return false
      if (needle) {
        const hay = `${l.lesson_text} ${l.evidence_summary || ''} ${(l.applies_to || []).join(' ')}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [allLessons, typeFilter, scopeFilter, search])

  const byType = useMemo(() => {
    const out = new Map()
    for (const t of LESSON_TYPES) out.set(t.key, [])
    for (const l of filtered) {
      if (!out.has(l.lesson_type)) out.set(l.lesson_type, [])
      out.get(l.lesson_type).push(l)
    }
    return out
  }, [filtered])

  const counts = useMemo(() => {
    const total = allLessons.length
    const active = allLessons.filter(l => l.active).length
    const inactive = total - active
    return { total, active, inactive }
  }, [allLessons])

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
          {collapsed ? '▶' : '▼'} Regels per onderwerp
        </span>
        <span className="muted" style={{ fontSize: 11 }}>
          inkijk in de database — filter per onderwerp en scope, toggle inactieve regels
        </span>
        {!collapsed && (
          <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>
            {filtered.length} van {showInactive ? counts.total : counts.active}
            {showInactive && counts.inactive > 0 && ` · ${counts.inactive} inactief`}
          </span>
        )}
      </button>

      {!collapsed && (
        <div style={{ borderTop: '1px solid var(--border)', padding: 'var(--s-4) var(--s-5)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-3)', alignItems: 'center', marginBottom: 'var(--s-4)' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              <FilterPill label="Alle onderwerpen" active={typeFilter === 'all'} onClick={() => setTypeFilter('all')} />
              {LESSON_TYPES.map(t => (
                <FilterPill
                  key={t.key}
                  label={t.label}
                  accent={t.color}
                  active={typeFilter === t.key}
                  onClick={() => setTypeFilter(t.key)}
                />
              ))}
            </div>
            <div style={{ width: 1, height: 18, background: 'var(--border)' }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              <FilterPill label="Alle minds" active={scopeFilter === 'all'} onClick={() => setScopeFilter('all')} />
              {SCOPES.map(s => (
                <FilterPill
                  key={s.key}
                  label={s.label}
                  accent={s.accent}
                  active={scopeFilter === s.key}
                  onClick={() => setScopeFilter(s.key)}
                />
              ))}
            </div>
            <div style={{ width: 1, height: 18, background: 'var(--border)' }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Zoek in tekst…"
              style={{
                padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)',
                background: 'var(--bg-1)', color: 'var(--text)', fontSize: 12, minWidth: 160,
              }}
            />
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
              <input
                type="checkbox"
                checked={showInactive}
                onChange={e => setShowInactive(e.target.checked)}
              />
              ook inactief
            </label>
            <button
              onClick={load}
              disabled={loading}
              style={{ ...btnSecondary, fontSize: 11, marginLeft: 'auto' }}
              title="Opnieuw laden uit database"
            >
              {loading ? '…' : '↻'} Refresh
            </button>
          </div>

          {error && (
            <div style={{ fontSize: 12, color: '#ef4444', marginBottom: 'var(--s-3)' }}>Fout: {error}</div>
          )}
          {loading && allLessons.length === 0 && (
            <div className="muted" style={{ padding: 'var(--s-4)', textAlign: 'center' }}>Laden…</div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="muted" style={{ padding: 'var(--s-4)', textAlign: 'center', fontSize: 12 }}>
              Geen regels die aan deze filters voldoen.
            </div>
          )}

          <div className="stack" style={{ gap: 'var(--s-4)' }}>
            {[...byType.entries()].map(([typeKey, rows]) => {
              if (rows.length === 0) return null
              const meta = lessonTypeMeta(typeKey)
              return (
                <div key={typeKey}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--s-2)',
                    paddingBottom: 4, borderBottom: `1px solid ${meta.color}33`,
                  }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, color: meta.color, textTransform: 'uppercase',
                      letterSpacing: 0.5,
                    }}>{meta.label}</span>
                    <span className="muted" style={{ fontSize: 11 }}>{rows.length}</span>
                  </div>
                  <div className="stack" style={{ gap: 'var(--s-2)' }}>
                    {rows.map(l => (
                      <RuleRow key={l.id} lesson={l} onChanged={load} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function FilterPill({ label, active, accent, onClick }) {
  const tint = accent || '#8b5cf6'
  return (
    <button
      onClick={onClick}
      style={{
        padding: '4px 10px',
        borderRadius: 999,
        border: `1px solid ${active ? tint : 'var(--border)'}`,
        background: active ? `color-mix(in srgb, ${tint} 18%, var(--bg-2))` : 'transparent',
        color: active ? tint : 'var(--text-muted)',
        fontSize: 11, fontWeight: active ? 600 : 500, cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}
