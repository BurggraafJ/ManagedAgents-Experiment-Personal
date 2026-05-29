import { useCallback, useEffect, useState } from 'react'
import { supabase, createRealtimeChannel } from '../lib/supabase'

/**
 * useKbArticles — data voor het /kennisbank overzicht (gepubliceerde artikelen).
 * Haalt kb_articles + categorie-labels + het aantal openstaande voorstellen
 * (voor de stat-tegel → review-queue). Live refresh via postgres_changes.
 */
const COLS =
  'id,title,summary,kb_category,article_type,audience,status,confidence,' +
  'source_mail_ids,last_verified_at,review_due_at,needs_review_reason,created_at'

export function useKbArticles() {
  const [articles, setArticles] = useState([])
  const [categories, setCategories] = useState([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const [{ data: arts, error: e1 }, { data: cats, error: e2 }, { count, error: e3 }] = await Promise.all([
        supabase.from('kb_articles').select(COLS).order('last_verified_at', { ascending: false, nullsFirst: false }),
        supabase.from('kb_categories').select('id,label,sort_order').order('sort_order', { ascending: true }),
        supabase.from('kb_article_proposals').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      ])
      if (e1) throw e1
      if (e2) throw e2
      if (e3) throw e3
      setArticles(arts || [])
      setCategories(cats || [])
      setPendingCount(count || 0)
      setError(null)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    const channel = createRealtimeChannel('kb-overview-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kb_articles' }, () => refresh())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [refresh])

  return { articles, categories, pendingCount, loading, error, refresh }
}
