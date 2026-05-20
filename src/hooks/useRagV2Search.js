import { useState, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { ALL_SOURCES, DATE_PRESETS, INTERNAL_DOMAIN } from '../lib/rag'

// Records-mode (handmatige RAG-zoek) — hergebruikt rag-search Edge Function.
// UI heeft filter-pills per source-type + datum-pills + geavanceerd-popover
// voor min_sim/top_k/rerank/audience.
export function useRagV2Search() {
  const [query, setQuery] = useState('')
  const [sources, setSources] = useState(ALL_SOURCES)
  const [datePresetId, setDatePresetId] = useState('12m')
  const [minSim, setMinSim] = useState(0.3)
  const [topK, setTopK] = useState(20)
  const [enableRerank, setEnableRerank] = useState(false)
  const [maxPerSource, setMaxPerSource] = useState(3)
  const [audienceFilter, setAudienceFilter] = useState('all')
  const [entity, setEntity] = useState(null)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [feedbackState, setFeedbackState] = useState({})

  const run = useCallback(async () => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setError('Type minstens 2 tekens')
      return
    }
    setLoading(true); setError(null); setFeedbackState({})
    try {
      const filterAfter = (() => {
        const p = DATE_PRESETS.find(x => x.id === datePresetId)
        if (!p?.months) return null
        const d = new Date()
        d.setMonth(d.getMonth() - p.months)
        return d.toISOString()
      })()
      const body = {
        query: trimmed,
        top_k: topK,
        filter_sources: sources.length === ALL_SOURCES.length ? null : sources,
        filter_after: filterAfter,
        min_similarity: minSim,
        enable_rerank: enableRerank,
        max_per_source: maxPerSource,
      }
      if (entity) {
        body.filter_entity_type = entity.type
        body.filter_entity_id = entity.id
      }
      const { data, error: invErr } = await supabase.functions.invoke('rag-search', { body })
      if (invErr) throw new Error(invErr.message)
      if (!data?.ok) throw new Error(data?.error || 'unknown_error')
      setResult(data)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [query, sources, datePresetId, minSim, topK, enableRerank, maxPerSource, entity])

  const filteredMatches = useMemo(() => {
    if (!result?.matches) return []
    if (audienceFilter === 'all') return result.matches
    return result.matches.filter(m => {
      if (m.source !== 'mail' && m.source !== 'engagement') return true
      const fe = (m.meta?.from_email || '').toLowerCase()
      if (!fe) return audienceFilter === 'external'
      const internal = fe.endsWith('@' + INTERNAL_DOMAIN)
      return audienceFilter === 'internal' ? internal : !internal
    })
  }, [result, audienceFilter])

  const counts = useMemo(() => {
    const c = { all: filteredMatches.length }
    for (const m of filteredMatches) c[m.source] = (c[m.source] || 0) + 1
    return c
  }, [filteredMatches])

  const submitFeedback = useCallback(async (match, outcome) => {
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
      setFeedbackState(prev => ({ ...prev, [match.chunk_id]: outcome }))
    } catch (e) {
      console.error('feedback failed', e)
    }
  }, [result])

  const reset = useCallback(() => {
    setQuery(''); setResult(null); setError(null); setFeedbackState({})
  }, [])

  return {
    query, setQuery,
    sources, setSources,
    datePresetId, setDatePresetId,
    minSim, setMinSim,
    topK, setTopK,
    enableRerank, setEnableRerank,
    maxPerSource, setMaxPerSource,
    audienceFilter, setAudienceFilter,
    entity, setEntity,
    loading, error, result,
    filteredMatches, counts,
    feedbackState, submitFeedback,
    run, reset,
  }
}
