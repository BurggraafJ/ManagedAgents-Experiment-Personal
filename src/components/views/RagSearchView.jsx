import { useState, useCallback, useRef, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

// =====================================================================
// RagSearchView — Vector RAG zoekbalk
// =====================================================================
// Roept de rag-search Edge Function aan met natuurlijke-taal query.
//
// v2 (2026-05-04): + entity-filter (company/contact/deal autocomplete) →
// switcht backend automatisch naar match_chunks_for_entity (1-hop traversal).
// + meeting/event source-pills (chunks dekt nu 9 source-types).
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
  meeting:    'Meeting',
  event:      'Event',
}

const DATE_PRESETS = [
  { id: 'all',   label: 'Alles',         months: null },
  { id: '12m',   label: '12 mnd',        months: 12 },
  { id: '6m',    label: '6 mnd',         months: 6 },
  { id: '3m',    label: '3 mnd',         months: 3 },
  { id: '1m',    label: '1 mnd',         months: 1 },
]

const ALL_SOURCES = ['mail', 'engagement', 'jira', 'deal', 'company', 'contact', 'meeting', 'event']

const ENTITY_TYPES = [
  { id: 'none',    label: 'Geen filter' },
  { id: 'company', label: 'Company' },
  { id: 'contact', label: 'Contact' },
  { id: 'deal',    label: 'Deal' },
]

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
  const viaEdge = match.entity_path?.via_edge
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
          {viaEdge && viaEdge !== 'self' && (
            <>
              <span>·</span>
              <span style={{ fontStyle: 'italic' }}>via {viaEdge}</span>
            </>
          )}
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }} title="Combined score (vector + BM25 + recency)">
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

// =====================================================================
// EntityPicker — autocomplete voor company / contact / deal
// =====================================================================
function EntityPicker({ entityType, onTypeChange, selectedEntity, onSelect }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const debounceRef = useRef(null)
  const wrapperRef = useRef(null)

  // Klik buiten dropdown → close
  useEffect(() => {
    const onClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  // Debounce search
  useEffect(() => {
    if (entityType === 'none' || !searchQuery || searchQuery.length < 2) {
      setSuggestions([])
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        let result = []
        if (entityType === 'company') {
          const { data } = await supabase
            .from('hubspot_companies')
            .select('company_id, name, domain')
            .ilike('name', `%${searchQuery}%`)
            .limit(10)
          result = (data ?? []).map(r => ({
            id: r.company_id,
            label: r.name,
            sub: r.domain,
          }))
        } else if (entityType === 'contact') {
          const { data } = await supabase
            .from('hubspot_contacts')
            .select('contact_id, firstname, lastname, email, jobtitle')
            .or(`firstname.ilike.%${searchQuery}%,lastname.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%`)
            .limit(10)
          result = (data ?? []).map(r => ({
            id: r.contact_id,
            label: [r.firstname, r.lastname].filter(Boolean).join(' ') || r.email,
            sub: r.email + (r.jobtitle ? ` · ${r.jobtitle}` : ''),
          }))
        } else if (entityType === 'deal') {
          const { data } = await supabase
            .from('hubspot_deals')
            .select('deal_id, dealname, dealstage, amount')
            .ilike('dealname', `%${searchQuery}%`)
            .eq('is_archived', false)
            .limit(10)
          result = (data ?? []).map(r => ({
            id: r.deal_id,
            label: r.dealname,
            sub: r.dealstage + (r.amount ? ` · €${r.amount}` : ''),
          }))
        }
        setSuggestions(result)
        setShowDropdown(true)
      } catch (e) {
        // soft fail
      } finally {
        setLoading(false)
      }
    }, 250)
    return () => debounceRef.current && clearTimeout(debounceRef.current)
  }, [entityType, searchQuery])

  const handleSelect = (item) => {
    onSelect({ type: entityType, id: item.id, label: item.label, sub: item.sub })
    setSearchQuery('')
    setShowDropdown(false)
  }

  if (selectedEntity) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
        <span>Entity:</span>
        <span
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 4,
            background: 'var(--bg-input, rgba(0,0,0,0.05))',
            border: '1px solid var(--text-muted)',
            color: 'var(--text)',
          }}
        >
          <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, fontSize: 10 }}>
            {selectedEntity.type}
          </span>
          <span>{selectedEntity.label}</span>
          <button
            type="button"
            onClick={() => onSelect(null)}
            style={{
              background: 'none', border: 'none', color: 'var(--text-muted)',
              cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1,
            }}
            title="Reset entity-filter"
          >
            ✕
          </button>
        </span>
      </div>
    )
  }

  return (
    <div ref={wrapperRef} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', position: 'relative' }}>
      <span>Entity:</span>
      <select
        value={entityType}
        onChange={(e) => { onTypeChange(e.target.value); setSearchQuery(''); setSuggestions([]); }}
        style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-input, var(--bg))', color: 'var(--text)', fontSize: 12 }}
      >
        {ENTITY_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
      {entityType !== 'none' && (
        <>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
            placeholder={`zoek ${entityType}…`}
            style={{
              padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4,
              background: 'var(--bg-input, var(--bg))', color: 'var(--text)', fontSize: 12, width: 220,
            }}
          />
          {loading && <span style={{ fontSize: 11 }}>…</span>}
          {showDropdown && suggestions.length > 0 && (
            <div
              style={{
                position: 'absolute', top: '100%', left: 60, marginTop: 4,
                background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 10,
                minWidth: 320, maxHeight: 320, overflowY: 'auto',
              }}
            >
              {suggestions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelect(item)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '6px 10px', border: 'none', background: 'transparent',
                    cursor: 'pointer', borderBottom: '1px solid var(--border)',
                    color: 'var(--text)', fontSize: 12,
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-input, rgba(0,0,0,0.05))'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  <div style={{ fontWeight: 500 }}>{item.label}</div>
                  {item.sub && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.sub}</div>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
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
  // v2: entity-filter
  const [entityType, setEntityType] = useState('none')
  const [selectedEntity, setSelectedEntity] = useState(null)
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

      const requestBody = {
        query: query.trim(),
        top_k: topK,
        filter_sources: sources.length === ALL_SOURCES.length ? null : sources,
        filter_after: filterAfter,
        min_similarity: minSim,
      }
      // v2: entity-filter wanneer geselecteerd
      if (selectedEntity) {
        requestBody.filter_entity_type = selectedEntity.type
        requestBody.filter_entity_id = selectedEntity.id
        requestBody.max_per_source = 3
      }

      const { data, error: invErr } = await supabase.functions.invoke('rag-search', {
        body: requestBody,
      })
      if (invErr) throw new Error(invErr.message)
      if (!data?.ok) throw new Error(data?.error || 'unknown_error')
      setResult(data)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [query, sources, datePreset, minSim, topK, selectedEntity])

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

        {/* v2: entity-filter row */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--s-3)' }}>
          <EntityPicker
            entityType={entityType}
            onTypeChange={setEntityType}
            selectedEntity={selectedEntity}
            onSelect={(e) => {
              setSelectedEntity(e)
              if (!e) setEntityType('none')
            }}
          />
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
                {result.filter_entity_type && (
                  <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 'normal', marginLeft: 8 }}>
                    via {result.filter_entity_type}-filter
                  </span>
                )}
              </h2>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {result.tokens_used} tokens · embed {result.timing_ms.embed}ms · search {result.timing_ms.search}ms
                {result.retrieval_strategy && (
                  <> · <span style={{ fontFamily: 'var(--font-mono)' }}>{result.retrieval_strategy}</span></>
                )}
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
          <div style={{ fontSize: 12, marginTop: 12, color: 'var(--text-muted)' }}>
            <em>Tip:</em> kies een entity (company / contact / deal) om alleen chunks te zien die 1-hop verbonden zijn met die klant.
          </div>
        </div>
      )}
    </div>
  )
}
