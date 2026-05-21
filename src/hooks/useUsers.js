import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Multi-user · gebruiker-overzicht voor de Settings → Gebruikers tab.
// Roept de admin-only RPC list_users_for_admin() aan; die raise't een
// exception als caller geen owner is. SettingsView zit al achter de
// ProtectedAdminRoute-gate, dus de exception zou hier nooit moeten landen.
//
// Bron: public.list_users_for_admin (SECURITY DEFINER, sinds 2026-05-21).
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
    } else {
      setUsers(data || [])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchUsers()
  }, [fetchUsers])

  return { users, loading, error, refresh: fetchUsers }
}
