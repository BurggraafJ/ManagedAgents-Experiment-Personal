import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Objects-mode entity-picker. Houdt type-tab (company/contact) + search-query +
// resultaten + selected entity bij. Hergebruikt search_companies en
// search_contactpersonen RPC's. Deep-link company_id wordt eenmalig geladen.
export function useRagV2Entity(initialCompanyId) {
  const [type, setType] = useState('company')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState(null)
  const [bootstrapLoading, setBootstrapLoading] = useState(!!initialCompanyId)

  // Eénmalige deep-link load — bv. /zoeken-v2?mode=objects&company_id=...
  useEffect(() => {
    if (!initialCompanyId) return
    let cancelled = false
    supabase.from('hubspot_companies')
      .select('company_id, name, domain, industry, lifecyclestage, city, country')
      .eq('company_id', initialCompanyId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        if (data) {
          setSelected({ kind: 'company', ...data })
          setType('company')
        }
        setBootstrapLoading(false)
      })
    return () => { cancelled = true }
  }, [initialCompanyId])

  // Debounced live-search bij typen.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        if (type === 'company') {
          const { data, error } = await supabase.rpc('search_companies', { query: q, limit_n: 12 })
          if (error) throw error
          setResults((data || []).map(c => ({ kind: 'company', ...c })))
        } else {
          const { data, error } = await supabase.rpc('search_contactpersonen', { query: q, limit_n: 12 })
          if (error) throw error
          setResults((data || []).map(c => ({ kind: 'contact', ...c })))
        }
      } catch (e) {
        console.error('entity search failed', e)
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 220)
    return () => clearTimeout(t)
  }, [query, type])

  const select = useCallback((entity) => {
    setSelected(entity)
  }, [])

  const clear = useCallback(() => {
    setSelected(null)
    setQuery('')
  }, [])

  return {
    type, setType,
    query, setQuery,
    results, searching,
    selected, select, clear,
    bootstrapLoading,
  }
}
