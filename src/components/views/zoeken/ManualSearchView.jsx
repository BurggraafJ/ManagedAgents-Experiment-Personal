import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import {
  ALL_SOURCES,
  SOURCE_LABEL,
  SOURCE_ICONS,
  DATE_PRESETS,
  AUDIENCE_FILTERS,
  INTERNAL_DOMAIN,
} from '../../../lib/rag'
import { useLinkedEntities } from '../../../hooks/useLinkedEntities'
import EntityPicker from './EntityPicker'
import QualityBar from './QualityBar'
import JelleMindGroup from './JelleMindGroup'
import SourceGroup from './SourceGroup'

// Hoofdpagina voor handmatig RAG-zoeken — natural-language input, source/date/audience
// filters, entity-pinning, score-breakdown per resultaat, feedback-knoppen.
export default function ManualSearchView() {
  const [query, setQuery] = useState('')
  const [sources, setSources] = useState(ALL_SOURCES)
  const [datePreset, setDatePreset] = useState('12m')
  const [minSim, setMinSim] = useState(0.3)
  const [topK, setTopK] = useState(20)
  const [enableRerank, setEnableRerank] = useState(false)
  const [maxPerSource, setMaxPerSource] = useState(3)
  const [audienceFilter, setAudienceFilter] = useState('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [feedbackState, setFeedbackState] = useState({})
  const [entityType, setEntityType] = useState('none')
  const [selectedEntity, setSelectedEntity] = useState(null)
  const inputRef = useRef(null)
  const linkedEntities = useLinkedEntities(result?.matches)

  useEffect(() => { inputRef.current?.focus() }, [])

  const toggleSource = (s) => {
    setSources((prev) => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  const runSearch = useCallback(async () => {
    if (!query.trim() || query.trim().length < 2) {
      setError('Type minstens 2 tekens')
      return
    }
    setLoading(true); setError(null); setFeedbackState({})
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
        enable_rerank: enableRerank,
        max_per_source: maxPerSource,
      }
      if (selectedEntity) {
        requestBody.filter_entity_type = selectedEntity.type
        requestBody.filter_entity_id = selectedEntity.id
      }

      const { data, error: invErr } = await supabase.functions.invoke('rag-search', { body: requestBody })
      if (invErr) throw new Error(invErr.message)
      if (!data?.ok) throw new Error(data?.error || 'unknown_error')
      setResult(data)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [query, sources, datePreset, minSim, topK, selectedEntity, enableRerank, maxPerSource])

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runSearch() }
  }

  // Audience filter — alleen toepassen op mail/engagement waar from_email bekend is.
  const filteredMatches = useMemo(() => {
    if (!result?.matches) return []
    if (audienceFilter === 'all') return result.matches
    return result.matches.filter((m) => {
      if (m.source !== 'mail' && m.source !== 'engagement') return true
      const fe = (m.meta?.from_email || '').toLowerCase()
      if (!fe) return audienceFilter === 'external'
      const isInternal = fe.endsWith('@' + INTERNAL_DOMAIN)
      return audienceFilter === 'internal' ? isInternal : !isInternal
    })
  }, [result, audienceFilter])

  const grouped = useMemo(() => {
    if (!filteredMatches || filteredMatches.length === 0) return []
    const groups = {}
    for (const m of filteredMatches) {
      const s = m.source
      if (!groups[s]) groups[s] = []
      groups[s].push(m)
    }
    return Object.entries(groups).sort((a, b) => b[1].length - a[1].length)
  }, [filteredMatches])

  const onFeedback = useCallback(async (match, outcome) => {
    if (!result?.bundle_id || !match.chunk_id) return
    try {
      await supabase.rpc('log_search_feedback', {
        p_bundle_id: result.bundle_id,
        p_chunk_id: match.chunk_id,
        p_chunk_source: match.source,
        p_chunk_score: match.similarity,
        p_outcome: outcome,
        p_query: result.query,
      })
      setFeedbackState((prev) => ({ ...prev, [match.chunk_id]: outcome }))
    } catch (e) {
      console.error('feedback failed', e)
    }
  }, [result])

  const feedbackCount = Object.keys(feedbackState).length

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <section className="card" style={{ padding: 'var(--s-5)', display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <input ref={inputRef} type="text" value={query}
            onChange={(e) => setQuery(e.target.value)} onKeyDown={onKeyDown}
            placeholder="Stel je vraag in natuurlijke taal — bv. 'wat besprak ik recent met Wintertaling'"
            style={{ flex: 1, fontSize: 16, padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-input, var(--bg))', color: 'var(--text)' }}
          />
          <button className="btn btn--accent" onClick={runSearch} disabled={loading || !query.trim()}>
            {loading ? 'Zoeken…' : 'Zoek'}
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-4)', alignItems: 'center', fontSize: 12 }}>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {ALL_SOURCES.map((s) => {
              const active = sources.includes(s)
              return (
                <button key={s} type="button" className="btn"
                  onClick={() => toggleSource(s)}
                  style={{
                    padding: '4px 10px', fontSize: 12,
                    background: active ? 'var(--bg-input, rgba(0,0,0,0.05))' : 'transparent',
                    color: active ? 'var(--text)' : 'var(--text-muted)',
                    border: `1px solid ${active ? 'var(--text-muted)' : 'var(--border)'}`,
                    opacity: active ? 1 : 0.6,
                  }}
                  title={`${active ? 'Verberg' : 'Toon'} ${SOURCE_LABEL[s]}`}
                >
                  {SOURCE_ICONS[s]} {SOURCE_LABEL[s].replace(/s$/, '')}
                </button>
              )
            })}
          </div>

          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {DATE_PRESETS.map((p) => (
              <button key={p.id} type="button" className="btn" onClick={() => setDatePreset(p.id)}
                style={{
                  padding: '4px 10px', fontSize: 12,
                  background: datePreset === p.id ? 'var(--bg-input, rgba(0,0,0,0.05))' : 'transparent',
                  color: datePreset === p.id ? 'var(--text)' : 'var(--text-muted)',
                  border: `1px solid ${datePreset === p.id ? 'var(--text-muted)' : 'var(--border)'}`,
                }}>
                {p.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {AUDIENCE_FILTERS.map((f) => (
              <button key={f.id} type="button" className="btn" onClick={() => setAudienceFilter(f.id)}
                title={f.desc}
                style={{
                  padding: '4px 10px', fontSize: 12,
                  background: audienceFilter === f.id ? 'rgba(34,197,94,0.10)' : 'transparent',
                  color: audienceFilter === f.id ? 'var(--text)' : 'var(--text-muted)',
                  border: `1px solid ${audienceFilter === f.id ? '#22c55e' : 'var(--border)'}`,
                }}>
                {f.label}
              </button>
            ))}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)' }}>
            min sim:&nbsp;
            <input type="range" min="0.2" max="0.9" step="0.05" value={minSim}
              onChange={(e) => setMinSim(parseFloat(e.target.value))} style={{ width: 90 }} />
            <span style={{ fontFamily: 'var(--font-mono)', minWidth: 38, textAlign: 'right' }}>
              {(minSim * 100).toFixed(0)}%
            </span>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)' }}>
            top:&nbsp;
            <select value={topK} onChange={(e) => setTopK(parseInt(e.target.value))}
              style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-input, var(--bg))', color: 'var(--text)' }}>
              {[10, 20, 30, 50].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)' }}>
            max/source:&nbsp;
            <select value={maxPerSource} onChange={(e) => setMaxPerSource(parseInt(e.target.value))}
              style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-input, var(--bg))', color: 'var(--text)' }}>
              {[1, 2, 3, 5, 10].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={enableRerank} onChange={(e) => setEnableRerank(e.target.checked)} />
            rerank (Haiku)
          </label>
        </div>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--s-3)' }}>
          <EntityPicker
            entityType={entityType}
            onTypeChange={setEntityType}
            selectedEntity={selectedEntity}
            onSelect={(e) => { setSelectedEntity(e); if (!e) setEntityType('none') }}
          />
        </div>
      </section>

      {error && (
        <div className="card" style={{ borderLeft: '3px solid #ef4444', color: '#ef4444', padding: 'var(--s-4)' }}>
          {error}
        </div>
      )}

      {result && (
        <>
          <QualityBar result={result} feedbackCount={feedbackCount} />

          <div className="stack" style={{ gap: 'var(--s-4)' }}>
            {result.knowledge_lessons && result.knowledge_lessons.length > 0 && (
              <JelleMindGroup
                lessons={result.knowledge_lessons}
                defaultOpen={result.knowledge_lessons.length <= 5}
              />
            )}

            {result.match_count === 0 && (!result.knowledge_lessons || result.knowledge_lessons.length === 0) ? (
              <div className="card" style={{ textAlign: 'center', padding: 'var(--s-6)', color: 'var(--text-muted)' }}>
                Niets gevonden boven {(result.min_similarity * 100).toFixed(0)}% similarity.<br/>
                <small>Probeer de slider lager te zetten of een volledige zin te typen.</small>
              </div>
            ) : (
              grouped.map(([source, matches]) => (
                <SourceGroup
                  key={source}
                  source={source}
                  matches={matches}
                  onFeedback={onFeedback}
                  feedbackState={feedbackState}
                  linkedEntities={linkedEntities}
                  defaultOpen={matches.length <= 5}
                />
              ))
            )}
          </div>
        </>
      )}

      {!result && !loading && !error && (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--s-7)', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 13, marginBottom: 6 }}>Stel een vraag in natuurlijke taal — de RAG zoekt door alle bronnen.</div>
          <div style={{ fontSize: 12, marginBottom: 12 }}>
            <em>"wat besprak ik recent met Wintertaling"</em> · <em>"openstaande offertes Q1"</em> · <em>"betalingsherinneringen"</em>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 600, margin: '0 auto' }}>
            <strong>Tips:</strong> kies een entity (bedrijf/contact/deal) om alleen 1-hop chunks te zien.
            Klik op een rij om volledige content + score-breakdown te zien.
            Markeer per resultaat ✓ (nuttig) of ✕ (ruis) — dit verbetert de quality-loop in <Link to="/intelligence/quality">Intelligence Quality</Link>.
          </div>
        </div>
      )}
    </div>
  )
}
