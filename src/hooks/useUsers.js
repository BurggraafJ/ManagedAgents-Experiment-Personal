import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { fetchTrustedDevices } from '../lib/mfa'

// Multi-user · gebruiker-overzicht voor de Settings → Gebruikers tab.
// Roept de admin-only RPC list_users_for_admin() aan; die raise't een
// exception als caller geen owner is. SettingsView zit al achter de
// ProtectedAdminRoute-gate, dus de exception zou hier nooit moeten landen.
//
// Bron: public.list_users_for_admin (SECURITY DEFINER, sinds 2026-05-21).
//
// v1.131: per gebruiker ook het aantal geldige vertrouwde apparaten
// (mfa_trusted_devices_overview, owner-only) — dat is de tegenhanger van
// "Dit apparaat 14 dagen onthouden" en het knopje "Alles intrekken" bij een
// verloren laptop. Faalt die RPC, dan blijft de lijst gewoon werken.
export function useUsers() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('list_users_for_admin')
    if (err) {
      setError(err.message)
      setUsers([])
      setLoading(false)
      return
    }
    const rows = data || []
    let devices = []
    try {
      devices = await fetchTrustedDevices()
    } catch { /* geen blokkade voor de lijst zelf */ }
    const byUser = new Map(devices.map(d => [d.user_id, d]))
    setUsers(rows.map(u => ({
      ...u,
      trusted_device_count: byUser.get(u.user_id)?.device_count || 0,
      trusted_device_last_seen: byUser.get(u.user_id)?.last_seen_at || null,
    })))
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  return { users, loading, error, refresh: fetchUsers }
}
