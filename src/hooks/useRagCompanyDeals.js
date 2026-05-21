import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Open HubSpot-deals voor een company. Filtert via associated_company_ids
// ARRAY-veld op hubspot_deals (een deal kan meer companies hebben — wij
// pakken alle deals waar deze company in zit).
//
// Sorteer op laatst-gewijzigd zodat live deals bovenaan staan.
export function useRagV2CompanyDeals(companyId) {
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!companyId) { setDeals([]); return }
    let cancelled = false
    setLoading(true)
    supabase.from('hubspot_deals')
      .select('deal_id, dealname, dealstage, amount, pipeline_id, closedate, hs_lastmodifieddate')
      .contains('associated_company_ids', [companyId])
      .eq('is_archived', false)
      .order('hs_lastmodifieddate', { ascending: false })
      .limit(10)
      .then(({ data }) => {
        if (cancelled) return
        setDeals(Array.isArray(data) ? data : [])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [companyId])

  return { deals, loading }
}
