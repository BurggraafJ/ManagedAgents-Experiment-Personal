import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * usePijplijn — de live cijfers onder de Pijplijn-pagina (v1.183).
 *
 * Drie leesacties in één Promise.all, geen polling en geen realtime — dit is
 * een uitlegpagina, geen bewakingsscherm:
 *   • v_intelligence_hub_summary  → chunks per bron + totaal, edges, aliases,
 *                                   rag_outcomes-samenvatting, checked_at
 *   • sync_health_all()           → versheid per spiegel
 *   • context_bundles (7 d, count) → hoeveel retrieve-calls er waren
 *
 * Returns: { data, error, loading, refresh } met data =
 *   { health, chunksPerSource, chunksTotal, edges, resolutions, outcomes,
 *     bundles7d, checkedAt }
 */
export function usePijplijn() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const since7d = new Date(Date.now() - 7 * 86400_000).toISOString()
      const [health, summary, bundles] = await Promise.all([
        supabase.rpc('sync_health_all'),
        supabase.from('v_intelligence_hub_summary').select('*').maybeSingle(),
        supabase.from('context_bundles').select('*', { count: 'exact', head: true }).gte('created_at', since7d),
      ])
      if (summary.error) throw new Error(`v_intelligence_hub_summary: ${summary.error.message}`)
      const s = summary.data
      setData({
        health: health.error ? null : health.data,
        healthError: health.error?.message || null,
        chunksPerSource: s?.chunks_per_source || [],
        chunksTotal: s?.chunks_total ?? null,
        edges: s?.edges_count ?? null,
        resolutions: s?.resolutions_count ?? null,
        outcomes: s?.outcomes_summary
          ? { total: s.outcomes_summary.total, byOutcome: s.outcomes_summary.by_outcome || {}, avgChunks: s.outcomes_summary.avg_chunks }
          : null,
        bundles7d: bundles.error ? null : bundles.count,
        checkedAt: s?.checked_at ? new Date(s.checked_at) : new Date(),
      })
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return { data, error, loading, refresh: load }
}
