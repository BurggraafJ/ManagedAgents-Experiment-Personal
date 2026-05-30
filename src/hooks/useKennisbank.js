import { useCallback, useEffect, useState } from 'react'
import { supabase, createRealtimeChannel } from '../lib/supabase'

/**
 * useKennisbank — data voor de /kennisbank review-queue.
 * Haalt openstaande artikel-voorstellen (kb_article_proposals, status=pending)
 * + categorie-labels op, met live refresh via postgres_changes.
 * Project Kennisbank F.3.
 */
export function useKennisbank() {
  const [proposals, setProposals] = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const [{ data: props, error: e1 }, { data: cats, error: e2 }] = await Promise.all([
        supabase
          .from('kb_article_proposals')
          .select('id,title,proposed_body,proposed_summary,kb_category,article_type,audience,rationale,evidence,confidence,source_signal_ids,source_mail_ids,deferred_at,created_at,status,needs_review,qa_notes,drafted_model,restyled_at')
          .eq('status', 'pending')
          .order('confidence', { ascending: false }),
        supabase
          .from('kb_categories')
          .select('id,label,sort_order')
          .order('sort_order', { ascending: true }),
      ])
      if (e1) throw e1
      if (e2) throw e2
      setProposals(props || [])
      setCategories(cats || [])
      setError(null)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    const channel = createRealtimeChannel('kennisbank-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kb_article_proposals' }, () => refresh())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [refresh])

  return { proposals, categories, loading, error, refresh }
}
