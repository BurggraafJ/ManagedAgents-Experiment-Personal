import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { summarize } from '../lib/agentHealth'

/**
 * useAdminCounts — lichte tellers voor de Admin-navigatie (v1.128):
 * desktop AdminSidebar (nav-meta) en het mobiele Admin-hub. Vier kleine
 * reads, poll elke 2 minuten; geen realtime (de tellers zijn oriëntatie,
 * de pagina's zelf verversen live).
 *
 *  - users            aantal gebruikers (list_users_for_admin)
 *  - healthAttention  agents met fouten of waarschuwing (agent_runs_health_7d)
 *  - healthTotal / healthIdle
 *  - securityOpen     open findings (alle severities)
 *  - securityUrgent   open critical/high
 *  - jellemindPending pending lesson-proposals
 */
const POLL_MS = 2 * 60 * 1000

const EMPTY = {
  users: null, healthAttention: null, healthTotal: null, healthIdle: null,
  securityOpen: null, securityUrgent: null, jellemindPending: null,
}

export function useAdminCounts() {
  const [counts, setCounts] = useState(EMPTY)
  const [loading, setLoading] = useState(true)

  const fetchAll = useCallback(async () => {
    const safe = (q) => Promise.resolve(q).then(r => r).catch(e => ({ data: null, error: e }))
    const [usersRes, healthRes, secRes, jmRes] = await Promise.all([
      safe(supabase.rpc('list_users_for_admin')),
      safe(supabase.from('agent_runs_health_7d').select('agent_name,success_pct,runs_total')),
      safe(supabase.from('security_findings').select('id,severity').eq('status', 'open')),
      safe(supabase.from('jellemind_lesson_proposals').select('id').eq('status', 'pending')),
    ])
    const health = Array.isArray(healthRes.data) ? summarize(healthRes.data) : null
    const sec = Array.isArray(secRes.data) ? secRes.data : null
    setCounts({
      users: Array.isArray(usersRes.data) ? usersRes.data.length : null,
      healthAttention: health ? health.critical + health.warning : null,
      healthTotal: health ? health.total : null,
      healthIdle: health ? health.idle : null,
      securityOpen: sec ? sec.length : null,
      securityUrgent: sec ? sec.filter(f => f.severity === 'critical' || f.severity === 'high').length : null,
      jellemindPending: Array.isArray(jmRes.data) ? jmRes.data.length : null,
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, POLL_MS)
    return () => clearInterval(id)
  }, [fetchAll])

  return { ...counts, loading, refresh: fetchAll }
}
