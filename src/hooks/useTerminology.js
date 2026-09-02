import { useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useSupabaseQuery } from './useSupabaseQuery'

/**
 * useTerminology — spraak-naar-tekst correcties (terminology_corrections)
 * + mutaties via de bestaande RPC's upsert_terminology / delete_terminology.
 *
 * Gebruikt door de mobiele Terminologie-lijst; de desktop TerminologiePage
 * praat nog rechtstreeks met dezelfde RPC's. Mutaties geven `null` terug bij
 * succes en anders een foutmelding (string).
 */
export function useTerminology() {
  const { data, loading, refresh } = useSupabaseQuery('terminology_corrections', {
    orderBy: ['incorrect', { ascending: true }],
    realtime: true,
  })

  const rows = useMemo(
    () => (data || []).slice().sort((a, b) => a.incorrect.localeCompare(b.incorrect)),
    [data],
  )

  const run = useCallback(async (fn) => {
    try {
      const { data: res, error } = await fn()
      if (error) return error.message
      if (res && res.ok === false) return res.reason || 'mislukt'
      refresh()
      return null
    } catch (e) {
      return e.message || 'netwerkfout'
    }
  }, [refresh])

  const save = useCallback((f) => run(() => supabase.rpc('upsert_terminology', {
    p_id: f.id || null,
    p_incorrect: (f.incorrect || '').trim(),
    p_correct: (f.correct || '').trim(),
    p_category: (f.category || '').trim() || null,
    p_notes: (f.notes || '').trim() || null,
    p_case_sensitive: !!f.case_sensitive,
    p_is_active: f.is_active ?? true,
    p_updated_by: 'dashboard',
  })), [run])

  const toggle = useCallback((row) => save({ ...row, is_active: !row.is_active }), [save])

  const remove = useCallback((id) => run(() => supabase.rpc('delete_terminology', { p_id: id })), [run])

  return { rows, loading, save, toggle, remove, refresh }
}
