import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * useIntelligenceHub — bundeled fetch voor IntelligenceHubView.
 *
 * Levert: sync-health (RPC), chunks-counts per source, rag_outcomes-aggregaten,
 * recente RAG-skill agent_runs, edges/resolutions counts, kosten + failing
 * queries uit context_bundles.
 *
 * Returns: { health, chunks, outcomes, runs, edges, resolutions, costStats,
 *            failingQueries, error, refreshing, refresh }.
 */
export function useIntelligenceHub() {
  const [health, setHealth] = useState(null)
  const [chunks, setChunks] = useState(null)
  const [outcomes, setOutcomes] = useState(null)
  const [runs, setRuns] = useState(null)
  const [edges, setEdges] = useState(null)
  const [resolutions, setResolutions] = useState(null)
  const [costStats, setCostStats] = useState(null)
  const [failingQueries, setFailingQueries] = useState(null)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(null)
    try {
      const todayDay = new Date().toISOString().slice(0, 10)

      const [h, summary, costRows, rn, bundlesFail] = await Promise.all([
        supabase.rpc('sync_health_all'),
        supabase.from('v_intelligence_hub_summary').select('*').maybeSingle(),
        supabase.from('v_context_bundles_cost').select('*'),
        supabase.from('agent_runs')
          .select('agent_name, status, summary, started_at, completed_at')
          .in('agent_name', ['chunker', 'autodraft-rag-prefill', 'jellemind-embed'])
          .order('started_at', { ascending: false }).limit(15),
        supabase.from('context_bundles')
          .select('bundle_id, intent, audience, total_chunks, avg_top_similarity, build_ms, created_at, retrieval_meta')
          .gte('created_at', new Date(Date.now() - 30 * 86400_000).toISOString())
          .or('total_chunks.eq.0,avg_top_similarity.lt.0.5')
          .order('created_at', { ascending: false }).limit(15),
      ])

      if (h.error) throw new Error(`sync_health_all: ${h.error.message}`)
      setHealth(h.data)

      const s = summary.data
      setChunks(s?.chunks_per_source || [])
      setOutcomes(s?.outcomes_summary ? {
        total: s.outcomes_summary.total,
        byOutcome: s.outcomes_summary.by_outcome,
        avgChunks: s.outcomes_summary.avg_chunks,
      } : null)
      setEdges(s?.edges_count ?? null)
      setResolutions(s?.resolutions_count ?? null)
      setRuns(rn.data || [])

      if (costRows.data) {
        let tokensToday = 0, tokens30d = 0, callsToday = 0, calls30d = 0, eurToday = 0, eur30d = 0
        for (const r of costRows.data) {
          tokens30d += Number(r.tokens || 0)
          calls30d += Number(r.calls || 0)
          eur30d += Number(r.eur_cost || 0)
          if (r.day === todayDay) {
            tokensToday += Number(r.tokens || 0)
            callsToday += Number(r.calls || 0)
            eurToday += Number(r.eur_cost || 0)
          }
        }
        setCostStats({ tokensToday, tokens30d, callsToday, calls30d, eurToday, eur30d })
      }
      if (bundlesFail.data) setFailingQueries(bundlesFail.data)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return { health, chunks, outcomes, runs, edges, resolutions, costStats, failingQueries, error, refreshing, refresh: load }
}
