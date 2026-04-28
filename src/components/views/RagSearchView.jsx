import { useState, useCallback, useRef, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

// =====================================================================
// RagSearchView — Vector RAG zoekbalk
// =====================================================================
// Roept de rag-search Edge Function aan met natuurlijke-taal query.
// Resultaten komen uit match_all_sources (6 truth-of-source tabellen).
//
// Sober ontwerp: tekstpills, geen kleur per source, geen emoji-iconen.
// =====================================================================

const SOURCE_LABEL = {
  mail:       'Mail',
  engagement: 'Engagement',
  jira:       'Jira',
  deal:       'Deal',
  company:    'Company',
  contact:    'Contact',
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

// Client-side fallback HTML-strip (database doet 't ook, maar oude data kan nog HTML bevatten)
function cleanText(s) {
  if (!s) return ''
  return s
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

function ResultCard({ match }) {
  const label = SOURCE_LABEL[match.source] || match.source
  const occurredRel = relTime(match.occurred_at)
  const cleanPreview = cleanText(match.preview)
  return (
    <div
      className="card"
      style={{ padding: 'var(--s-4)', display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, color: 'var(--text-muted)', fontSize: 12 }}>
          <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{label}</span>
          <span>·</span>
          <span>{occurredRel} geleden</span>
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }} title="Cosine similarity">
          {fmtSim(match.similarity)}
        </span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.4, wordBreak: 'break-word' }}>
        {match.subject || <em style={{ color: 'var(--text-muted)' }}>(geen onderwerp)</em>}
      </div>
      {cleanPreview && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {cleanPreview}
        </div>
      )}
      {match.from_label && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 2 }}>
          {match.from_label}
        </div>
      )}
    </div>
  )
}

function HealthNote({ health }) {
  if (!health) return null
  const stale = Object.entries(health)
    .filter(([k, v]) => v && typeof v === 'object' && v.is_fresh === false)
    .map(([k]) => k)
  if (stale.length === 0) return null
  return (
    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
      ⚠ stale: {stale.join(', ')}
    </span>
  )
}

export default function RagSearchView() {
  const [query, setQuery] = useState('')
  const [sources, setSources] = useState(ALL_SOURCES)
  const [datePreset, setDatePreset] = useState('12m')
  const [minSim, setMinSim] = useState(0.3)
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
            placeholder="Tip: gebruik een volledige zin — bv. 'wat heb ik recent met Wintertaling besproken'"
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

        {/* Filters: alles in muted tones */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-4)', alignItems: 'center', fontSize: 12 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {ALL_SOURCES.map((s) => {
              const active = sources.includes(s)
              return (
                <button
                  key={s}
                  type="button"
                  className="btn"
                  onClick={() => toggleSource(s)}
                  style={{
                    padding: '4px 10px', fontSize: 12,
                    background: active ? 'var(--bg-input, rgba(0,0,0,0.05))' : 'transparent',
                    color: active ? 'var(--text)' : 'var(--text-muted)',
                    border: `1px solid ${active ? 'var(--text-muted)' : 'var(--border)'}`,
                    opacity: active ? 1 : 0.7,
                  }}
                  title={`${active ? 'Verberg' : 'Toon'} ${SOURCE_LABEL[s]}`}
                >
                  {SOURCE_LABEL[s]}
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
                  background: datePreset === p.id ? 'var(--bg-input, rgba(0,0,0,0.05))' : 'transparent',
                  color: datePreset === p.id ? 'var(--text)' : 'var(--text-muted)',
                  border: `1px solid ${datePreset === p.id ? 'var(--text-muted)' : 'var(--border)'}`,
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
            min sim:&nbsp;
            <input
              type="range" min="0.2" max="0.9" step="0.05"
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

      {error && (
        <div className="card" style={{ borderLeft: '3px solid var(--error, #ef4444)', color: 'var(--error, #ef4444)', padding: 'var(--s-4)' }}>
          {error}
        </div>
      )}

      {result && (
        <section>
          <div className="section__head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--s-4)', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h2 className="section__title" style={{ marginBottom: 2 }}>
                {result.match_count > 0 ? `${result.match_count} match${result.match_count === 1 ? '' : 'es'}` : 'Geen matches'}
              </h2>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {result.tokens_used} tokens · embed {result.timing_ms.embed}ms · search {result.timing_ms.search}ms
              </div>
            </div>
            <HealthNote health={result.health} />
          </div>

          {result.match_count === 0 && (
            <div className="card" style={{ textAlign: 'center', padding: 'var(--s-6)', color: 'var(--text-muted)' }}>
              Niets gevonden boven {(result.min_similarity * 100).toFixed(0)}% similarity.<br/>
              <small>Probeer de slider lager te zetten of een volledige zin te typen.</small>
            </div>
          )}

          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 'var(--s-4)' }}>
            {(result.matches || []).map((m, i) => (
              <ResultCard key={`${m.source}-${m.id}-${i}`} match={m} />
            ))}
          </div>
        </section>
      )}

      {!result && !loading && !error && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--s-7)', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 13, marginBottom: 6 }}>Stel een vraag in natuurlijke taal — de RAG zoekt door alle bronnen.</div>
          <small>
            Voorbeelden: <em>"wat besprak ik recent met Wintertaling"</em>, <em>"openstaande offertes Q1"</em>, <em>"betalingsherinneringen"</em>
          </small>
        </div>
      )}
    </div>
  )
}
