import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Multi-user access — Fase 1 (Project — Multi-user Access, Confluence 454819841).
//
// Leest public.user_roles.app_role voor de current auth-user. RLS-policy
// `user_roles_self_select` staat toe dat een user z'n eigen rij ziet; owners
// zien ook andermans rijen via `user_roles_owner_full`.
//
// Geen rij in user_roles → default 'member' (least privilege). Query-error →
// óók 'member' als failsafe. Pas als role !== null is geladen mag de UI
// admin-views tonen — anders flikkering bij owner-login.
export function useUserRole(userId) {
  const [role, setRole] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!userId) { setRole(null); return }
    let cancelled = false
    ;(async () => {
      const { data, error: err } = await supabase
        .from('user_roles')
        .select('app_role')
        .eq('user_id', userId)
        .maybeSingle()
      if (cancelled) return
      if (err) {
        setError(err.message)
        setRole('member')
        return
      }
      setRole(data?.app_role || 'member')
    })()
    return () => { cancelled = true }
  }, [userId])

  return {
    role,
    error,
    isOwner: role === 'owner',
    isLoadingRole: role === null && !!userId,
  }
}
