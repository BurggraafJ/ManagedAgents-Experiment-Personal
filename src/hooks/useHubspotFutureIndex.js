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

      // v_hubspot_future_index bundelt per email_key: contact + company + deals.
      // Refresh cron draait elke 15 min (5,20,35,50 * * * *) na hubspot-sync.
      const [indexRows, recIssuesR, partnerDomR] = await Promise.all([
        safe(supabase.from('v_hubspot_future_index')
          .select('*')
          .in('email_key', emails)),
        safe(supabase.from('jira_issues')
          .select('issue_key,summary,status,status_category,assignee_email')
          .eq('project_key', 'REC')
          .eq('is_deleted', false)
          .neq('status_category', 'done')
          .limit(200)),
        safe(supabase.from('agent_config')
          .select('config_value')
          .eq('agent_name', 'daily-admin')
          .eq('config_key', 'partner_domains')
          .maybeSingle()),
      ])

      if (cancelled) return

      const rows = indexRows.data || []
      const recIssues = recIssuesR.data || []
      const partnerDomainsRaw = partnerDomR?.data?.config_value || []
      const partnerDomains = new Set(
        (Array.isArray(partnerDomainsRaw) ? partnerDomainsRaw : (partnerDomainsRaw?.domains ?? []))
          .map(d => String(d).toLowerCase())
      )

      const ix = buildHubspotIndex()
      ix.recIssues = recIssues
      ix.partnerDomains = partnerDomains
      ix.kennismakingDatumByDeal = new Map()

      for (const r of rows) {
        // Rebuild contact-shape (view kolommen → originele contact-velden)
        const contact = {
          contact_id: r.contact_id,
          email: r.email_key,
          firstname: r.firstname,
          lastname: r.lastname,
          jobtitle: r.jobtitle,
          associated_company_id: r.company_id,
          lifecyclestage: r.contact_lifecycle,
          is_archived: false,
        }
        ix.contactByEmail.set(r.email_key, contact)

        if (r.company_id && !ix.companyById.has(r.company_id)) {
          ix.companyById.set(r.company_id, {
            company_id: r.company_id,
            name: r.company_name,
            domain: r.company_domain,
            industry: r.industry,
            num_employees: r.num_employees,
            lifecyclestage: r.company_lifecycle,
            is_archived: false,
          })
        }

        for (const d of (r.deals || [])) {
          if (!ix.dealsByContact.has(r.contact_id)) ix.dealsByContact.set(r.contact_id, [])
          ix.dealsByContact.get(r.contact_id).push(d)
          if (r.company_id) {
            if (!ix.dealsByCompany.has(r.company_id)) ix.dealsByCompany.set(r.company_id, [])
            ix.dealsByCompany.get(r.company_id).push(d)
          }
          if (d.kennismaking_datum != null) {
            ix.kennismakingDatumByDeal.set(d.deal_id, {
              kennismaking_datum: d.kennismaking_datum,
              checked_at: null,
            })
          }
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
