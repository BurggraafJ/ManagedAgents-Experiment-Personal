import { useEffect, useState, useCallback } from 'react'
import { supabase, createRealtimeChannel } from '../lib/supabase'

/**
 * useChurnData — laadt churn_customers + churn_categories met realtime updates.
 *
 * Returns:
 *  - churns        Array<row>  (joined met category-label/color)
 *  - categories    Array<row>  (actieve categorieën, gesorteerd op sort_order)
 *  - allCategories Array<row>  (incl. inactieve — voor instellingen-popup)
 *  - loading       boolean
 *  - error         string|null
 *  - refresh       () => Promise<void>
 *  - updateNote    (deal_id, text) => Promise<void>
 *  - updateCategory(deal_id, category_id) => Promise<void>
 *  - upsertCategory(row) => Promise<void>
 *  - deactivateCategory(id) => Promise<void>
 *  - triggerRun    () => Promise<void>  (zet manual_run_requested_at op agent_schedules)
 */
export function useChurnData() {
  const [churns, setChurns] = useState([])
  const [allCategories, setAllCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchAll = useCallback(async () => {
    try {
      setError(null)
      const [{ data: cats, error: e1 }, { data: rows, error: e2 }] = await Promise.all([
        supabase
          .from('churn_categories')
          .select('id, category_key, label, description, color, sort_order, is_active, is_system')
          .order('sort_order', { ascending: true })
          .order('label', { ascending: true }),
        supabase
          .from('churn_customers')
          .select('deal_id, company_id, company_name, dealname, domain, closedate, dealstage, ' +
                  'churn_summary, category_id, category_confidence, user_note, user_note_updated_at, ' +
                  'last_summarized_at, source_notes_count, source_mails_count, detected_at, updated_at')
          .order('closedate', { ascending: false, nullsFirst: false }),
      ])
      if (e1) throw e1
      if (e2) throw e2
      setAllCategories(cats || [])
      setChurns(rows || [])
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchAll()
    const ch = createRealtimeChannel('klantverlies-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'churn_customers' }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'churn_categories' }, () => fetchAll())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [fetchAll])

  const updateNote = useCallback(async (deal_id, text) => {
    const { error } = await supabase
      .from('churn_customers')
      .update({ user_note: text || null, user_note_updated_at: new Date().toISOString() })
      .eq('deal_id', deal_id)
    if (error) throw error
  }, [])

  const updateCategory = useCallback(async (deal_id, category_id) => {
    const { error } = await supabase
      .from('churn_customers')
      .update({ category_id: category_id || null })
      .eq('deal_id', deal_id)
    if (error) throw error
  }, [])

  const upsertCategory = useCallback(async (row) => {
    const payload = {
      ...(row.id ? { id: row.id } : {}),
      category_key: row.category_key,
      label: row.label,
      description: row.description || null,
      color: row.color || '#6b7280',
      sort_order: row.sort_order ?? 100,
      is_active: row.is_active !== false,
    }
    const { error } = row.id
      ? await supabase.from('churn_categories').update(payload).eq('id', row.id)
      : await supabase.from('churn_categories').insert(payload)
    if (error) throw error
  }, [])

  const deactivateCategory = useCallback(async (id) => {
    const { error } = await supabase
      .from('churn_categories')
      .update({ is_active: false })
      .eq('id', id)
    if (error) throw error
  }, [])

  const deleteCategory = useCallback(async (id) => {
    const { error } = await supabase.from('churn_categories').delete().eq('id', id)
    if (error) throw error
  }, [])

  const triggerRun = useCallback(async () => {
    const { error } = await supabase
      .from('agent_schedules')
      .update({ manual_run_requested_at: new Date().toISOString() })
      .eq('agent_name', 'churn-analytics')
    if (error) throw error
  }, [])

  const categories = allCategories.filter(c => c.is_active)
  const categoryMap = Object.fromEntries(allCategories.map(c => [c.id, c]))

  const enrichedChurns = churns.map(c => ({
    ...c,
    category: c.category_id ? categoryMap[c.category_id] : null,
  }))

  return {
    churns: enrichedChurns,
    categories,
    allCategories,
    loading,
    error,
    refresh: fetchAll,
    updateNote,
    updateCategory,
    upsertCategory,
    deactivateCategory,
    deleteCategory,
    triggerRun,
  }
}
