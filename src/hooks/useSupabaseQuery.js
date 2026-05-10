import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, createRealtimeChannel } from '../lib/supabase'

/**
 * useSupabaseQuery — generic Supabase fetch met loading/error/refresh state.
 *
 * Vervangt het patroon `useEffect + supabase.from(...) + useState x3` dat in
 * de codebase ~50x voorkomt. Voor multi-tabel feature-hooks (zoals useAgents,
 * useAdmin) blijven de hand-geschreven Promise.all-fetches; deze hook is voor
 * losstaande tabel-queries in één view.
 *
 * @param {string} table — Supabase tabel-naam
 * @param {object} [options]
 * @param {string} [options.select='*']     — kolommen
 * @param {object} [options.filters]        — { column: value } voor `.eq()`
 * @param {object} [options.in]             — { column: [v1, v2] } voor `.in()`
 * @param {object} [options.gte]            — { column: value } voor `.gte()`
 * @param {object} [options.lte]            — { column: value } voor `.lte()`
 * @param {[string, object?]} [options.orderBy] — bv. ['created_at', { ascending: false }]
 * @param {number} [options.limit]          — row-limit
 * @param {boolean} [options.maybeSingle]   — gebruik .maybeSingle() voor exact-één
 * @param {boolean} [options.realtime]      — abonneer op postgres_changes (default false)
 * @param {Array} [options.deps=[]]         — extra deps die fetch retriggeren
 * @param {boolean} [options.skip]          — skip de fetch helemaal (conditioneel)
 * @param {*} [options.initialData]         — start-waarde voor `data` (default: [] of null voor maybeSingle).
 *                                            Geef `null` om "nog niet geladen" uit te drukken via `data === null`.
 * @returns {{ data, loading, error, refresh }}
 */
const REALTIME_DEBOUNCE_MS = 1500

export function useSupabaseQuery(table, options = {}) {
  const {
    select = '*',
    filters,
    in: inFilters,
    gte,
    lte,
    orderBy,
    limit,
    maybeSingle = false,
    realtime = false,
    deps = [],
    skip = false,
    initialData,
  } = options

  const startValue = initialData !== undefined ? initialData : (maybeSingle ? null : [])
  const [data, setData] = useState(startValue)
  const [loading, setLoading] = useState(!skip)
  const [error, setError] = useState(null)
  const debounceRef = useRef(null)

  // Stabiele deps-key zodat objects in options geen oneindige re-fetch geven
  const depsKey = JSON.stringify({ select, filters, inFilters, gte, lte, orderBy, limit, maybeSingle, ...deps.reduce((a, v, i) => (a[i] = v, a), {}) })

  const fetchOnce = useCallback(async () => {
    if (skip) return
    try {
      let q = supabase.from(table).select(select)
      if (filters) for (const [col, val] of Object.entries(filters)) q = q.eq(col, val)
      if (inFilters) for (const [col, vals] of Object.entries(inFilters)) q = q.in(col, vals)
      if (gte) for (const [col, val] of Object.entries(gte)) q = q.gte(col, val)
      if (lte) for (const [col, val] of Object.entries(lte)) q = q.lte(col, val)
      if (orderBy) q = q.order(orderBy[0], orderBy[1] || {})
      if (limit) q = q.limit(limit)
      if (maybeSingle) q = q.maybeSingle()
      const { data: rows, error: err } = await q
      if (err) throw err
      setData(maybeSingle ? rows : (rows || []))
      setError(null)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, depsKey, skip])

  useEffect(() => { fetchOnce() }, [fetchOnce])

  useEffect(() => {
    if (!realtime || skip) return
    const channel = createRealtimeChannel(`q-${table}`)
      .on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(fetchOnce, REALTIME_DEBOUNCE_MS)
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [table, realtime, skip, fetchOnce])

  return { data, loading, error, refresh: fetchOnce }
}
