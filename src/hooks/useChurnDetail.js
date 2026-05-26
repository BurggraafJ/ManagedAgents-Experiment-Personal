import { useEffect, useState, useCallback } from 'react'
import { supabase, createRealtimeChannel } from '../lib/supabase'

/**
 * useChurnDetail — data voor de detail-pagina van één gechurnte klant.
 *
 * - churn        churn_customers row + .mrr (joined met hubspot_deals.amount)
 *                en .company_created_at (uit hubspot_companies.hs_created_at)
 * - notes        array van churn_notes (DESC op created_at)
 * - sources      array van hubspot_engagements gefilterd op deal_id
 *                + recente mails gefilterd op company-domain (laatste 60d, limit 8)
 * - loading      boolean
 * - error        string | null
 * - addNote      (body) => Promise<void>
 * - updateNote   (id, body) => Promise<void>
 * - deleteNote   (id) => Promise<void>
 */
export function useChurnDetail(dealId) {
  const [churn, setChurn] = useState(null)
  const [notes, setNotes] = useState([])
  const [sources, setSources] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchAll = useCallback(async () => {
    if (!dealId) return
    try {
      setError(null)
      // 1) Hoofd-row
      const { data: row, error: e1 } = await supabase
        .from('churn_customers')
        .select('deal_id, company_id, company_name, dealname, domain, closedate, churned_at, dealstage, ' +
                'churn_summary, category_id, category_confidence, new_provider, user_note, ' +
                'last_summarized_at, source_notes_count, source_mails_count, detected_at, updated_at')
        .eq('deal_id', dealId)
        .maybeSingle()
      if (e1) throw e1
      if (!row) { setChurn(null); setLoading(false); return }
      // Effectieve churn-datum: stage-entry (churned_at) als beschikbaar, anders closedate.
      if (row.churned_at) { row.raw_closedate = row.closedate; row.closedate = row.churned_at }

      // 2) MRR + company-aanvulling
      const [{ data: dealRow }, { data: companyRow }] = await Promise.all([
        supabase.from('hubspot_deals').select('amount, createdate').eq('deal_id', dealId).maybeSingle(),
        row.company_id
          ? supabase.from('hubspot_companies').select('hs_created_at').eq('company_id', row.company_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ])

      setChurn({
        ...row,
        mrr: dealRow?.amount ?? null,
        deal_created_at: dealRow?.createdate ?? null,
        company_created_at: companyRow?.hs_created_at ?? null,
      })

      // 3) Notes (DESC)
      const { data: notesData, error: e2 } = await supabase
        .from('churn_notes')
        .select('id, body, created_at, updated_at')
        .eq('deal_id', dealId)
        .order('created_at', { ascending: false })
      if (e2) throw e2
      setNotes(notesData || [])

      // 4) Sources — hubspot_engagements voor deze deal + recente mails op company-domain
      const [{ data: engagements }, { data: mails }] = await Promise.all([
        supabase
          .from('hubspot_engagements')
          .select('id, engagement_type, subject, body_text, hs_timestamp, hubspot_owner_id')
          .contains('associated_deal_ids', [dealId])
          .order('hs_timestamp', { ascending: false })
          .limit(15),
        row.domain
          ? supabase
              .from('mail_messages')
              .select('id, subject, body_preview, received_at, from_name, from_email, is_from_me')
              .eq('from_domain', row.domain)
              .order('received_at', { ascending: false })
              .limit(8)
          : Promise.resolve({ data: [] }),
      ])

      const eng = (engagements || []).map(e => ({
        kind: 'engagement',
        id: e.id,
        type: e.engagement_type === 'email' ? 'mail' : (e.engagement_type === 'task' ? 'note' : 'note'),
        when: e.hs_timestamp,
        who: e.hubspot_owner_id ? 'HubSpot' : 'Systeem',
        label: e.subject || (e.body_text ? e.body_text.slice(0, 160) : '—'),
      }))
      const mailItems = (mails || []).map(m => ({
        kind: 'mail',
        id: m.id,
        type: 'mail',
        when: m.received_at,
        who: m.is_from_me ? 'Jij' : (m.from_name || m.from_email || '—'),
        label: m.subject ? `${m.subject} — ${m.body_preview || ''}`.trim() : (m.body_preview || '—'),
      }))
      const combined = [...eng, ...mailItems]
        .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())
        .slice(0, 12)
      setSources(combined)
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }, [dealId])

  useEffect(() => {
    setLoading(true)
    fetchAll()
    if (!dealId) return
    const ch = createRealtimeChannel('klantverlies-detail-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'churn_notes', filter: `deal_id=eq.${dealId}` }, () => fetchAll())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'churn_customers', filter: `deal_id=eq.${dealId}` }, () => fetchAll())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [fetchAll, dealId])

  const addNote = useCallback(async (body) => {
    const text = (body || '').trim()
    if (!text) return
    const { error } = await supabase.from('churn_notes').insert({ deal_id: dealId, body: text })
    if (error) throw error
  }, [dealId])

  const updateNote = useCallback(async (id, body) => {
    const text = (body || '').trim()
    const { error } = await supabase.from('churn_notes').update({ body: text }).eq('id', id)
    if (error) throw error
  }, [])

  const deleteNote = useCallback(async (id) => {
    const { error } = await supabase.from('churn_notes').delete().eq('id', id)
    if (error) throw error
  }, [])

  return { churn, notes, sources, loading, error, addNote, updateNote, deleteNote, refresh: fetchAll }
}
