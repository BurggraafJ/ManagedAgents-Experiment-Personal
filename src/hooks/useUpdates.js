import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// useUpdates — leest platform_updates met dag-groepering.
// RLS bepaalt zichtbaarheid: members krijgen alleen area='platform', owner
// ziet beide via is_admin_or_higher(). Geen extra filter nodig in de query.
//
// limit = hoeveelheid rijen (per area-dag); default 60 = ~30 dagen × 2 areas.
export function useUpdates({ limit = 60 } = {}) {
  const [days, setDays] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchUpdates = useCallback(async () => {
    setLoading(true); setError(null)
    const { data, error: err } = await supabase
      .from('platform_updates')
      .select('release_date,area,commits,updated_at')
      .order('release_date', { ascending: false })
      .order('area', { ascending: true })
      .limit(limit)
    if (err) {
      setError(err.message)
      setDays([])
    } else {
      // Groepeer per dag — vorm { release_date, areas: { platform, admin } }
      const map = new Map()
      for (const row of data || []) {
        if (!map.has(row.release_date)) map.set(row.release_date, { release_date: row.release_date, areas: {} })
        map.get(row.release_date).areas[row.area] = row
      }
      setDays(Array.from(map.values()))
    }
    setLoading(false)
  }, [limit])

  useEffect(() => { fetchUpdates() }, [fetchUpdates])

  return { days, loading, error, refresh: fetchUpdates }
}
