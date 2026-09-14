import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * usePijplijn — de cijfers onder Instellingen › Uitleg › Pijplijn (v1.195).
 *
 * Drie leesacties in één Promise.all, geen polling en geen realtime — dit is
 * een uitlegpagina, geen bewakingsscherm:
 *   • v_intelligence_hub_summary  → chunks-totaal, edges, aliases, outcomes
 *   • sync_health_all()           → versheid per spiegel
 *   • context_bundles (7 d, count) → hoeveel retrieve-calls er waren
 *
 * `enabled` staat uit voor een member. De drie bronnen zijn org-breed en tot
 * v1.194 owner-oppervlak (Organisatie); onder RLS zou een member er zijn eigen
 * deelverzameling uit lezen en dat naast "chunks in de index" zien staan. Een
 * getal dat iets anders betekent dan zijn label is erger dan geen getal, dus
 * krijgt een member de uitleg zonder de stand.
 *
 * Returns: { data, error, loading, refresh } met data =
 *   { health, healthError, chunksTotal, edges, resolutions, outcomes,
 *     bundles7d, checkedAt }
 */
export function usePijplijn({ enabled = true } = {}) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(enabled)

  const load = useCallback(async () => {
    if (!enabled) { setData(null); setError(null); setLoading(false); return }
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
        chunksTotal: s?.chunks_total ?? null,
        edges: s?.edges_count ?? null,
        resolutions: s?.resolutions_count ?? null,
        outcomes: s?.outcomes_summary?.total ?? null,
        bundles7d: bundles.error ? null : bundles.count,
        checkedAt: s?.checked_at ? new Date(s.checked_at) : new Date(),
      })
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => { load() }, [load])

  return { data, error, loading, refresh: load }
}
