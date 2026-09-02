import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// useHubspotOwnerMap — welke Maestro-gebruiker is welke HubSpot deal-owner.
//
// HubSpot blijft één org-brede mirror (hubspot_deals.hubspot_owner_id, gevuld
// door hubspot-sync-etl); deze map vertelt de app alleen WIE die owner is in
// Maestro-termen. Geen per-user HubSpot-koppeling, geen tweede sync.
//
// Bronnen: public.hubspot_users (de owner-lijst uit de mirror, read-only) en
// public.hubspot_owner_map (de koppeling; schrijven is owner-only via RLS).
//
// v1.134 (Organisatie): nieuw.
export function useHubspotOwnerMap() {
  const [owners, setOwners] = useState([])
  const [map, setMap] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const [ownersRes, mapRes] = await Promise.all([
      supabase.from('hubspot_users')
        .select('hubspot_owner_id, email, full_name, first_name, last_name, active')
        .order('full_name', { ascending: true }),
      supabase.from('hubspot_owner_map').select('user_id, hubspot_owner_id, updated_at'),
    ])
    const err = ownersRes.error || mapRes.error
    setError(err ? err.message : null)
    setOwners(ownersRes.data || [])
    setMap(mapRes.data || [])
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // user_id → hubspot_owner_id
  const byUser = useMemo(
    () => Object.fromEntries(map.map(m => [m.user_id, m.hubspot_owner_id])),
    [map],
  )
  // hubspot_owner_id → owner-rij uit de mirror
  const ownerById = useMemo(
    () => Object.fromEntries(owners.map(o => [o.hubspot_owner_id, o])),
    [owners],
  )

  // Eén owner hoort bij één gebruiker (unique-constraint op de tabel), dus
  // filteren we in de dropdown de owners weg die al aan iemand anders hangen.
  const takenBy = useMemo(
    () => Object.fromEntries(map.map(m => [m.hubspot_owner_id, m.user_id])),
    [map],
  )

  const setOwnerFor = useCallback(async (userId, hubspotOwnerId) => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!hubspotOwnerId) {
      const { error: err } = await supabase.from('hubspot_owner_map').delete().eq('user_id', userId)
      if (err) return { ok: false, error: err.message }
    } else {
      const { error: err } = await supabase.from('hubspot_owner_map')
        .upsert({ user_id: userId, hubspot_owner_id: hubspotOwnerId, updated_by: user?.id ?? null },
                { onConflict: 'user_id' })
      if (err) return { ok: false, error: err.message }
    }
    await refresh()
    return { ok: true }
  }, [refresh])

  const ownerLabel = useCallback((hubspotOwnerId) => {
    const o = ownerById[hubspotOwnerId]
    if (!o) return hubspotOwnerId || '—'
    return o.full_name || [o.first_name, o.last_name].filter(Boolean).join(' ') || o.email || hubspotOwnerId
  }, [ownerById])

  return { owners, map, byUser, ownerById, takenBy, loading, error, refresh, setOwnerFor, ownerLabel }
}
