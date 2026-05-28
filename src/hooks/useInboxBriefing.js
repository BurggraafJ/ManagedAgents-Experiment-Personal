import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * useInboxBriefing — leest dagstand voor Maestro home InboxBriefingCard.
 *
 * AutoDraft v3.0 — Fase 3 Proactive briefing.
 *
 * Geeft per dagstand:
 *   - tier_counts: { autopilot_done, oneclick_waiting, reasoned_waiting, user_acted }
 *   - hot_signals: array van mails met label declared_churn / usage_drop /
 *                  customer_negative / urgent_request / negotiation_active
 *
 * Refetch elke 5 min + optioneel realtime channel (mail_messages updates).
 */
const REFRESH_MS = 5 * 60 * 1000

export function useInboxBriefing({ lookbackHours = 24 } = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchBriefing = useCallback(async () => {
    try {
      setError(null)
      const { data: res, error: err } = await supabase.rpc('get_inbox_briefing', {
        p_lookback_hours: lookbackHours,
      })
      if (err) throw err
      setData(res || null)
    } catch (e) {
      console.warn('[useInboxBriefing] fetch failed:', e)
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [lookbackHours])

  useEffect(() => {
    setLoading(true)
    fetchBriefing()
    const interval = setInterval(fetchBriefing, REFRESH_MS)
    return () => clearInterval(interval)
  }, [fetchBriefing])

  return { data, loading, error, refetch: fetchBriefing }
}
