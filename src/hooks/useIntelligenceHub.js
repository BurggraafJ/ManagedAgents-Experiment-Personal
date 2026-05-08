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
      const [h, ch, oc, rn, ed, er] = await Promise.all([
        supabase.rpc('sync_health_all'),
        supabase.from('chunks').select('source', { count: 'exact', head: false }),
        supabase.from('rag_outcomes').select('outcome, total_chunks'),
        supabase.from('agent_runs')
          .select('agent_name, status, summary, started_at, completed_at')
          .in('agent_name', ['chunker', 'autodraft-rag-prefill', 'jellemind-embed'])
          .order('started_at', { ascending: false }).limit(15),
        supabase.from('v_entity_edges_full').select('src_type', { count: 'exact', head: true }),
        supabase.from('entity_resolution').select('alias_type', { count: 'exact', head: true }),
      ])

      if (h.error) throw new Error(`sync_health_all: ${h.error.message}`)
      setHealth(h.data)

      if (ch.data) {
        const counts = {}
        for (const r of ch.data) counts[r.source] = (counts[r.source] || 0) + 1
        setChunks(Object.entries(counts).map(([source, total]) => ({ source, total }))
          .sort((a, b) => b.total - a.total))
      }

      if (oc.data) {
        const byOutcome = {}
        let totalChunks = 0
        for (const r of oc.data) {
          const key = r.outcome || 'pending'
          byOutcome[key] = (byOutcome[key] || 0) + 1
          totalChunks += r.total_chunks || 0
        }
        setOutcomes({
          total: oc.data.length,
          byOutcome,
          avgChunks: oc.data.length > 0 ? totalChunks / oc.data.length : 0,
        })
      }

      setRuns(rn.data || [])
      setEdges(ed.count ?? null)
      setResolutions(er.count ?? null)

      const since30 = new Date(Date.now() - 30 * 86400_000).toISOString()
      const sinceToday = new Date(new Date().setHours(0, 0, 0, 0)).toISOString()
      const [bundlesAll, bundlesFail] = await Promise.all([
        supabase.from('context_bundles')
          .select('tokens_used, build_ms, created_at, intent, audience')
          .gte('created_at', since30)
          .order('created_at', { ascending: false }).limit(2000),
        supabase.from('context_bundles')
          .select('bundle_id, intent, audience, total_chunks, avg_top_similarity, build_ms, created_at, retrieval_meta')
          .gte('created_at', since30)
          .or('total_chunks.eq.0,avg_top_similarity.lt.0.5')
          .order('created_at', { ascending: false }).limit(15),
      ])
      if (bundlesAll.data) {
        let tokensToday = 0, tokens30d = 0, callsToday = 0, calls30d = 0
        for (const b of bundlesAll.data) {
          const t = b.tokens_used || 0
          tokens30d += t; calls30d += 1
          if (b.created_at >= sinceToday) { tokensToday += t; callsToday += 1 }
        }
        // text-embedding-3-large: $0.13 per 1M tokens. EUR ≈ $ × 0.93.
        const usdPerToken = 0.13 / 1_000_000
        setCostStats({
          tokensToday, tokens30d, callsToday, calls30d,
          eurToday: tokensToday * usdPerToken * 0.93,
          eur30d: tokens30d * usdPerToken * 0.93,
        })
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
