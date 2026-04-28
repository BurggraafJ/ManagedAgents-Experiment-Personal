import { useState, useCallback, useRef, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

// =====================================================================
// RagSearchView — Vector RAG zoekbalk
// =====================================================================
// Roept de rag-search Edge Function aan met natuurlijke-taal query.
// Resultaten komen uit match_all_sources (6 truth-of-source tabellen).
//
// UI:
//   [Zoekbalk + filter-strip]
//   [Sync-health badge]
//   [Resultatenlijst met source-icoon + similarity + subject + preview]
// =====================================================================

const SOURCE_META = {
  mail:       { label: 'Mail',        icon: '📬', color: '#3b82f6' },
  engagement: { label: 'Engagement',  icon: '💬', color: '#a855f7' },
  jira:       { label: 'Jira',        icon: '🎫', color: '#0ea5e9' },
  deal:       { label: 'Deal',        icon: '💼', color: '#10b981' },
  company:    { label: 'Company',     icon: '🏢', color: '#f59e0b' },
  contact:    { label: 'Contact',     icon: '👤', color: '#ec4899' },
}

const DATE_PRESETS = [
  { id: 'all',   label: 'Alles',         months: null },
  { id: '12m',   label: '12 mnd',        months: 12 },
  { id: '6m',    label: '6 mnd',         months: 6 },
  { id: '3m',    label: '3 mnd',         months: 3 },
  { id: '1m',    label: '1 mnd',         months: 1 },
]

const ALL_SOURCES = ['mail', 'engagement', 'jira', 'deal', 'company', 'contact']

function relTime(iso) {
  if (!iso) return '–'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}u`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d`
  const mo = Math.floor(day / 30)
  if (mo < 12) return `${mo}mnd`
  return `${Math.floor(mo / 12)}j`
}

function fmtSim(sim) {
  if (sim == null) return '–'
  return (Number(sim) * 100).toFixed(1) + '%'
}

function ResultCard({ match, onOpen }) {
  const meta = SOURCE_META[match.source] || { label: match.source, icon: '❔', color: '#6b7280' }
  const occurredRel = relTime(match.occurred_at)
  return (
    <div
      className="card"
      style={{ padding: 'var(--s-4)', display: 'flex', flexDirection: 'column', gap: 6, cursor: onOpen ? 'pointer' : 'default' }}
      onClick={onOpen ? () => onOpen(match) : undefined}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span title={meta.label} style={{ fontSize: 18 }}>{meta.icon}</span>
          <span
            className="status-pill"
            style={{ background: meta.color + '22', color: meta.color, border: `1px solid ${meta.color}55`, fontWeight: 500 }}
          >
            {meta.label}
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{occurredRel} geleden</span>
        </div>
        <span
          className="status-pill"
          style={{ background: 'var(--accent-bg, rgba(59,130,246,0.1))', color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}
          title="Cosine similarity"
        >
          {fmtSim(match.similarity)}
        </span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.4, wordBreak: 'break-word' }}>
        {match.subject || <em style={{ color: 'var(--text-muted)' }}>(geen onderwerp)</em>}
      </div>
      {match.preview && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {match.preview}
        </div>
      )}
      {match.from_label && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {match.source === 'mail' ? 'Van: ' : ''}{match.from_label}
        </div>
      )}
    </div>
  )
}

function HealthBadge({ health }) {
  if (!health) return null
  const allFresh = health.all_fresh === true
  const stale = Object.entries(health)
    .filter(([k, v]) => v && typeof v === 'object' && v.is_fresh === false)
    .map(([k]) => k)
  return (
    <div
      className="status-pill"
      style={{
        background: allFresh ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
        color: allFresh ? '#10b981' : '#f59e0b',
        fontSize: 12,
      }}
      title={allFresh ? 'Alle bronnen vers gesynced' : `Stale: ${stale.join(', ')}`}
    >
      {allFresh ? '🟢 alle bronnen vers' : `🟡 ${stale.length} bron(nen) stale`}
    </div>
  )
}

export default function RagSearchView() {
  const [query, setQuery] = useState('')
  const [sources, setSources] = useState(ALL_SOURCES)
  const [datePreset, setDatePreset] = useState('12m')
  const [minSim, setMinSim] = useState(0.5)
  const [topK, setTopK] = useState(15)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const toggleSource = (s) => {
    setSources((prev) => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  const runSearch = useCallback(async () => {
    if (!query.trim() || query.trim().length < 2) {
      setError('Type minstens 2 tekens')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const filterAfter = (() => {
        const p = DATE_PRESETS.find(x => x.id === datePreset)
        if (!p?.months) return null
        const d = new Date()
        d.setMonth(d.getMonth() - p.months)
        return d.toISOString()
      })()

      const { data, error: invErr } = await supabase.functions.invoke('rag-search', {
        body: {
          query: query.trim(),
          top_k: topK,
          filter_sources: sources.length === ALL_SOURCES.length ? null : sources,
          filter_after: filterAfter,
          min_similarity: minSim,
        },
      })
      if (invErr) throw new Error(invErr.message)
      if (!data?.ok) throw new Error(data?.error || 'unknown_error')
      setResult(data)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [query, sources, datePreset, minSim, topK])

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      runSearch()
    }
  }

  return (
    <div className="stack" style={{ gap: 'var(--s-6)' }}>
      {/* ===== Search bar ===== */}
      <section className="card" style={{ padding: 'var(--s-5)', display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Zoek in mail, HubSpot, Jira… bv. 'kennismaking Wintertaling'"
            style={{
              flex: 1,
              fontSize: 16,
              padding: '12px 14px',
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--bg-input, var(--bg))',
              color: 'var(--text)',
            }}
          />
          <button className="btn btn--accent" onClick={runSearch} disabled={loading || !query.trim()}>
            {loading ? 'Zoeken…' : 'Zoek'}
          </button>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-4)', alignItems: 'center', fontSize: 12 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {ALL_SOURCES.map((s) => {
              const active = sources.includes(s)
              const meta = SOURCE_META[s]
              return (
                <button
                  key={s}
                  type="button"
                  className="btn"
                  onClick={() => toggleSource(s)}
                  style={{
                    padding: '4px 10px', fontSize: 12,
                    background: active ? meta.color + '22' : 'transparent',
                    color: active ? meta.color : 'var(--text-muted)',
                    border: `1px solid ${active ? meta.color + '55' : 'var(--border)'}`,
                  }}
                  title={`${active ? 'Verberg' : 'Toon'} ${meta.label}`}
                >
                  {meta.icon} {meta.label}
                </button>
              )
            })}
          </div>

          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {DATE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="btn"
                onClick={() => setDatePreset(p.id)}
                style={{
                  padding: '4px 10px', fontSize: 12,
                  background: datePreset === p.id ? 'var(--accent-bg, rgba(59,130,246,0.15))' : 'transparent',
                  color: datePreset === p.id ? 'var(--accent)' : 'var(--text-muted)',
                  border: `1px solid ${datePreset === p.id ? 'var(--accent)' : 'var(--border)'}`,
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
            min sim:&nbsp;
            <input
              type="range" min="0.3" max="0.95" step="0.05"
              value={minSim}
              onChange={(e) => setMinSim(parseFloat(e.target.value))}
              style={{ width: 100 }}
            />
            <span style={{ fontFamily: 'var(--font-mono)', minWidth: 38, textAlign: 'right' }}>
              {(minSim * 100).toFixed(0)}%
            </span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)' }}>
            top:&nbsp;
            <select
              value={topK}
              onChange={(e) => setTopK(parseInt(e.target.value))}
              style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-input, var(--bg))', color: 'var(--text)' }}
            >
              {[5, 10, 15, 25, 50].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
      </section>

      {/* ===== Status / errors ===== */}
      {error && (
        <div className="card" style={{ borderLeft: '3px solid var(--error, #ef4444)', color: 'var(--error, #ef4444)', padding: 'var(--s-4)' }}>
          {error}
        </div>
      )}

      {/* ===== Results ===== */}
      {result && (
        <section>
          <div className="section__head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--s-4)' }}>
            <div>
              <h2 className="section__title" style={{ marginBottom: 2 }}>
                {result.match_count > 0 ? `${result.match_count} match${result.match_count === 1 ? '' : 'es'}` : 'Geen matches'}
              </h2>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {result.tokens_used} tokens · embed {result.timing_ms.embed}ms · search {result.timing_ms.search}ms
              </div>
            </div>
            <HealthBadge health={result.health} />
          </div>

          {result.match_count === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 'var(--s-6)', color: 'var(--text-muted)' }}>
              Niets gevonden boven {(result.min_similarity * 100).toFixed(0)}% similarity.<br/>
              <small>Probeer de slider lager te zetten of bredere woorden te kiezen.</small>
            </div>
          )}

          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 'var(--s-4)' }}>
            {(result.matches || []).map((m, i) => (
              <ResultCard key={`${m.source}-${m.id}-${i}`} match={m} />
            ))}
          </div>
        </section>
      )}

      {/* ===== Empty state ===== */}
      {!result && !loading && !error && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--s-7)', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🔍</div>
          <div>Vraag iets in natuurlijke taal — de RAG zoekt door alle 6 truth-of-sources.</div>
          <small style={{ display: 'block', marginTop: 8 }}>
            Voorbeelden: "wat besprak ik recent met Wintertaling", "openstaande offertes Q1", "betalingsherinneringen"
          </small>
        </div>
      )}
    </div>
  )
}
