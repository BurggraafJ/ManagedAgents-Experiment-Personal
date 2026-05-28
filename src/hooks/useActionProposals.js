import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, createRealtimeChannel } from '../lib/supabase'

/**
 * useActionProposals — leest autodraft_action_decisions per mail_id.
 *
 * AutoDraft v2 Fase 3 — Postvak Maestro action-cards.
 *
 * Hoe gebruiken:
 *   const { proposals, catalog, loading, error, refetch } = useActionProposals(mail.mail_id)
 *
 * proposals is een gesorteerde array (suggested_rank ASC) van max 3 voorstellen
 * + alle eventuele backfill-rijen (was_suggested=false, outcome='manual').
 * catalog is de enabled-set uit autodraft_actions zodat de UI display_name +
 * target_value kan tonen zonder per-rij JOIN.
 *
 * Live: realtime-channel debounce 1.5s op INSERT/UPDATE in action_decisions.
 */
const REALTIME_DEBOUNCE_MS = 1500

export function useActionProposals(mailId) {
  const [proposals, setProposals] = useState([])
  const [catalog, setCatalog] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const debounceRef = useRef(null)

  const fetchAll = useCallback(async () => {
    if (!mailId) {
      setProposals([])
      setLoading(false)
      return
    }
    try {
      setError(null)
      const [pRes, cRes] = await Promise.all([
        supabase
          .from('autodraft_action_decisions')
          .select('id, action_slug, payload, was_suggested, suggested_rank, classifier_confidence, classifier_reasoning, outcome, decided_at, executed_at, linked_entities, created_at, tier, undo_until, metadata_match, classifier_source')
          .eq('mail_id', mailId)
          .order('was_suggested', { ascending: false })
          .order('suggested_rank', { ascending: true, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('autodraft_actions')
          .select('slug, category, display_name, description, target_type, target_value, prompt_hint, confidence_threshold, enabled, suggested_count, accepted_count')
          .eq('enabled', true)
          .order('category')
          .order('slug'),
      ])
      if (pRes.error) throw pRes.error
      if (cRes.error) throw cRes.error
      setProposals(pRes.data || [])
      setCatalog(cRes.data || [])
    } catch (e) {
      console.warn('[useActionProposals] fetch failed:', e)
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [mailId])

  useEffect(() => {
    // Reset proposals bij mail-wisseling — voorkomt dat oude data van vorige
    // mail kort blijft staan terwijl nieuwe fetch loopt (flicker).
    setProposals([])
    setLoading(true)
    fetchAll()
  }, [fetchAll])

  // Realtime — debounced refetch wanneer rijen veranderen voor deze mail.
  useEffect(() => {
    if (!mailId) return undefined
    const channel = createRealtimeChannel(`action-proposals-${mailId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'autodraft_action_decisions', filter: `mail_id=eq.${mailId}` },
        () => {
          if (debounceRef.current) clearTimeout(debounceRef.current)
          debounceRef.current = setTimeout(fetchAll, REALTIME_DEBOUNCE_MS)
        },
      )
      .subscribe()
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      supabase.removeChannel(channel)
    }
  }, [mailId, fetchAll])

  return { proposals, catalog, loading, error, refetch: fetchAll }
}
