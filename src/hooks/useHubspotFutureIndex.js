import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { buildHubspotIndex } from '../lib/hubspotInbox'

// Refactor 11 (2026-05-09) — gebundelde data-fetching voor de Toekomst-tab
// van Daily Admin. Voorheen drie losse useEffects in HubSpotInboxFutureView.
//
// Levert:
//  - recruitmentMeetings : tabel `recruitment_meetings` (upcoming + 7d back)
//  - dismissedSet        : Set van calendar_event_ids waar een dismiss op
//                          staat in `daily_admin_future_dismissed`
//  - hsIndex             : HubSpot mirror + Jira-REC + partner_domains-index
//                          gebouwd over de externe attendees van eventsWithExt
//  - dismissEvent / undoDismissEvent — optimistic mutations
//  - reloadDismissed     : herfetch (na undo/dismiss vanuit elders)
//
// Argumenten:
//  - eventsWithExt : array van events met `_externals` ge-precomputed
//                    (zie HubSpotInboxFutureView container)

export function useHubspotFutureIndex({ eventsWithExt }) {
  // 1. recruitment_meetings (eigen tabel sinds skill v1.16, 2026-05-06).
  const [recruitmentMeetings, setRecruitmentMeetings] = useState([])
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const cutoff = new Date(Date.now() - 7 * 86400000).toISOString()
      const { data } = await supabase
        .from('recruitment_meetings')
        .select('id,calendar_event_id,graph_id,jira_issue_key,jira_summary,jira_status,jira_status_category,match_reason,start_time,end_time,subject,location_text,online_meeting_url,attendee_emails,attendee_names,status,dismissed_at,created_at')
        .neq('status', 'dismissed')
        .gte('start_time', cutoff)
        .order('start_time', { ascending: true })
      if (cancelled) return
      setRecruitmentMeetings(data || [])
    })()
    return () => { cancelled = true }
  }, [])

  // 2. dismissed-events
  const [dismissedSet, setDismissedSet] = useState(new Set())
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: rows } = await supabase
        .from('daily_admin_future_dismissed')
        .select('calendar_event_id')
      if (cancelled) return
      setDismissedSet(new Set((rows || []).map(r => r.calendar_event_id).filter(Boolean)))
    })()
    return () => { cancelled = true }
  }, [])

  const dismissEvent = async (event) => {
    setDismissedSet(prev => new Set([...prev, event.id]))  // optimistic
    try {
      await supabase.from('daily_admin_future_dismissed').upsert({
        calendar_event_id: event.id,
        graph_id: event.graph_id,
        subject: event.subject,
        start_time: event.start_time,
        reason: 'manual_dismiss',
      }, { onConflict: 'calendar_event_id' })
      // Sluit ook eventueel openstaand voorstel voor dit event
      await supabase.from('agent_proposals').update({ status: 'rejected', reviewed_at: new Date().toISOString() })
        .eq('agent_name', 'daily-admin-future')
        .eq('status', 'pending')
        .filter('context->>calendar_event_id', 'eq', event.id)
      return { ok: true }
    } catch (e) {
      // rollback
      setDismissedSet(prev => { const s = new Set(prev); s.delete(event.id); return s })
      return { ok: false, error: e }
    }
  }

  const undoDismissEvent = async (event) => {
    setDismissedSet(prev => { const s = new Set(prev); s.delete(event.id); return s })
    try {
      await supabase.from('daily_admin_future_dismissed').delete().eq('calendar_event_id', event.id)
      return { ok: true }
    } catch (e) {
      setDismissedSet(prev => new Set([...prev, event.id]))
      return { ok: false, error: e }
    }
  }

  // 3. hsIndex — éénmalig fetch van HubSpot mirror + Jira REC + partner_domains
  const [hsIndex, setHsIndex] = useState(null)
  useEffect(() => {
    if (eventsWithExt.length === 0) { setHsIndex(buildHubspotIndex()); return }
    const emails = Array.from(new Set(
      eventsWithExt.flatMap(e => e._externals.map(a => (a.email || '').toLowerCase())).filter(Boolean)
    ))
    const domains = Array.from(new Set(emails.map(e => e.split('@')[1]).filter(Boolean)))
    if (emails.length === 0) { setHsIndex(buildHubspotIndex()); return }

    let cancelled = false
    ;(async () => {
      const safe = (q) => Promise.resolve(q).then(r => r).catch(e => ({ data: [], error: e }))
      const [contactsR, companiesR, recIssuesR, partnerDomR] = await Promise.all([
        safe(supabase.from('hubspot_contacts')
          .select('contact_id,email,firstname,lastname,jobtitle,associated_company_id,lifecyclestage,is_archived')
          .in('email', emails)
          .eq('is_archived', false)),
        safe(supabase.from('hubspot_companies')
          .select('company_id,name,domain,industry,num_employees,lifecyclestage,is_archived')
          .in('domain', domains)
          .eq('is_archived', false)),
        // Open + recent-closed REC-issues — voor name-match op kandidaat
        safe(supabase.from('jira_issues')
          .select('issue_key,summary,status,status_category,assignee_email')
          .eq('project_key', 'REC')
          .eq('is_deleted', false)
          .neq('status_category', 'done')
          .limit(200)),
        // partner_domains uit agent_config (JSON-array)
        safe(supabase.from('agent_config')
          .select('config_value')
          .eq('agent_name', 'daily-admin')
          .eq('config_key', 'partner_domains')
          .maybeSingle()),
      ])
      const contacts = contactsR.data || []
      const companies = companiesR.data || []
      const recIssues = recIssuesR.data || []
      const partnerDomainsRaw = partnerDomR?.data?.config_value || []
      const partnerDomains = new Set(
        (Array.isArray(partnerDomainsRaw) ? partnerDomainsRaw : (partnerDomainsRaw?.domains ?? []))
          .map(d => String(d).toLowerCase())
      )
      const contactIds = contacts.map(c => c.contact_id)
      const companyIds = Array.from(new Set([
        ...contacts.map(c => c.associated_company_id).filter(Boolean),
        ...companies.map(c => c.company_id),
      ]))

      let deals = []
      if (contactIds.length > 0 || companyIds.length > 0) {
        const orParts = []
        if (contactIds.length) orParts.push(`associated_contact_ids.ov.{${contactIds.join(',')}}`)
        if (companyIds.length) orParts.push(`associated_company_ids.ov.{${companyIds.join(',')}}`)
        const dealsR = await safe(supabase.from('hubspot_deals')
          .select('deal_id,dealname,dealstage,pipeline_id,amount,closedate,associated_company_ids,associated_contact_ids,is_archived,properties')
          .or(orParts.join(','))
          .eq('is_archived', false))
        deals = dealsR.data || []
      }

      if (cancelled) return

      const ix = buildHubspotIndex()
      ix.recIssues = recIssues
      ix.partnerDomains = partnerDomains
      ix.kennismakingDatumByDeal = new Map()
      for (const c of contacts) ix.contactByEmail.set((c.email || '').toLowerCase(), c)
      for (const co of companies) ix.companyById.set(co.company_id, co)
      const extraCompanies = await fetchCompaniesByIds(
        contacts.map(c => c.associated_company_id).filter(Boolean),
        ix.companyById,
      )
      for (const co of extraCompanies) {
        ix.companyById.set(co.company_id, co)
      }
      for (const d of deals) {
        for (const cid of (d.associated_contact_ids || [])) {
          if (!ix.dealsByContact.has(cid)) ix.dealsByContact.set(cid, [])
          ix.dealsByContact.get(cid).push(d)
        }
        for (const coid of (d.associated_company_ids || [])) {
          if (!ix.dealsByCompany.has(coid)) ix.dealsByCompany.set(coid, [])
          ix.dealsByCompany.get(coid).push(d)
        }
      }

      // hubspot_deal_property_cache leveren ✓/✗ voor de kennismaking_datum
      // kolom in de tabel. Cache wordt gevuld door (toekomstige) skill-fetch;
      // tot die tijd is alles "—".
      const dealIds = deals.map(d => d.deal_id)
      if (dealIds.length > 0) {
        const propR = await safe(supabase.from('hubspot_deal_property_cache')
          .select('deal_id,kennismaking_datum,checked_at')
          .in('deal_id', dealIds))
        for (const row of (propR.data || [])) {
          ix.kennismakingDatumByDeal.set(row.deal_id, {
            kennismaking_datum: row.kennismaking_datum,
            checked_at: row.checked_at,
          })
        }
      }

      setHsIndex(ix)
    })()
    return () => { cancelled = true }
  }, [eventsWithExt])

  return {
    recruitmentMeetings,
    setRecruitmentMeetings,
    dismissedSet,
    dismissEvent,
    undoDismissEvent,
    hsIndex,
  }
}

// Vermijdt extra DB-call voor companies die al in contacts.associated_company_id
// zitten maar niet via domain matchen — pakt ze in één extra batch op.
async function fetchCompaniesByIds(ids, alreadyHave) {
  const missing = (ids || []).filter(id => id && !alreadyHave.has(id))
  if (missing.length === 0) return []
  const { data, error } = await supabase
    .from('hubspot_companies')
    .select('company_id,name,domain,industry,num_employees,lifecyclestage,is_archived')
    .in('company_id', missing)
    .eq('is_archived', false)
  if (error) return []
  return data || []
}
