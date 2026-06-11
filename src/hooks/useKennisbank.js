import { useCallback, useEffect, useState } from 'react'
import { supabase, createRealtimeChannel } from '../lib/supabase'

const COLS = 'id,title,description,proposed_body,proposed_summary,kb_category,article_type,rationale,evidence,confidence,source_signal_ids,source_mail_ids,deferred_at,created_at,status,amendment,generate_note,written_at,similar_info,needs_review,qa_notes,drafted_model,restyled_at,impact,impact_score,impact_reason,distinct_threads,scope_verdict,scope_reason'

/**
 * useKennisbank — data voor de /kennisbank review-queue (Kennisbank 2.0).
 * Statusflow: pending (licht voorstel: titel+beschrijving) → accepted (Jelle
 * akkoord, AI schrijft) → written (artikel klaar, publiceren/finetunen) →
 * approved/rejected. 'amended' = finetune-instructie, AI herschrijft.
 * - parked: geparkeerde casuïstiek, LAZY geladen via loadParked().
 * Live refresh via postgres_changes.
 */
export function useKennisbank() {
  const [proposals, setProposals] = useState([])
  const [categories, setCategories] = useState([])
  const [parked, setParked] = useState([])
  const [parkedLoaded, setParkedLoaded] = useState(false)
  const [parkedCount, setParkedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const [{ data: props, error: e1 }, { data: cats, error: e2 }, { count }] = await Promise.all([
        supabase.from('kb_article_proposals').select(COLS)
          .in('status', ['pending', 'accepted', 'amended', 'written'])
          .order('impact_score', { ascending: false, nullsFirst: false })
          .order('confidence', { ascending: false, nullsFirst: false }),
        supabase.from('kb_categories').select('id,label,sort_order').eq('active', true).order('sort_order', { ascending: true }),
        supabase.from('kb_article_proposals').select('id', { count: 'exact', head: true }).eq('status', 'parked'),
      ])
      if (e1) throw e1
      if (e2) throw e2
      setProposals(props || [])
      setCategories(cats || [])
      setParkedCount(count || 0)
      setError(null)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  // Lazy: alleen ophalen wanneer de geparkeerd-weergave wordt geopend.
  const loadParked = useCallback(async () => {
    const { data, error: e } = await supabase.from('kb_article_proposals').select(COLS)
      .eq('status', 'parked')
      .order('impact_score', { ascending: false, nullsFirst: false })
    if (!e) { setParked(data || []); setParkedLoaded(true) }
  }, [])

  // Optimistisch: een teruggehaald voorstel meteen uit de parked-lijst halen.
  const dropParked = useCallback((id) => {
    setParked(arr => arr.filter(p => p.id !== id))
    setParkedCount(c => Math.max(0, c - 1))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    const channel = createRealtimeChannel('kennisbank-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kb_article_proposals' }, () => refresh())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [refresh])

  return { proposals, categories, parked, parkedLoaded, parkedCount, loadParked, dropParked, loading, error, refresh }
}
