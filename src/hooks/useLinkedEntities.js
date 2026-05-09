import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// Batch-resolve "verbonden aan" per RAG-search match: from_email → contact, domain → company,
// deal_id/contact_id/company_id → entity-naam. Eén pass per matches-array.
// Output: { [chunk_id]: { person, company, extra } }
export function useLinkedEntities(matches) {
  const [linked, setLinked] = useState({})

  useEffect(() => {
    if (!matches || matches.length === 0) { setLinked({}); return }
    let cancelled = false
    ;(async () => {
      const fromEmails = new Set()
      const fromDomains = new Set()
      const dealIds = new Set()
      const companyIds = new Set()
      const contactIds = new Set()
      for (const m of matches) {
        const meta = m.meta || {}
        if (m.source === 'mail' && meta.from_email) {
          fromEmails.add(meta.from_email.toLowerCase())
          const d = meta.from_email.split('@')[1]?.toLowerCase()
          if (d) fromDomains.add(d)
        }
        if (m.source === 'deal') dealIds.add(m.id)
        if (m.source === 'company') companyIds.add(m.id)
        if (m.source === 'contact') contactIds.add(m.id)
      }
      const lookups = await Promise.all([
        fromEmails.size > 0
          ? supabase.from('hubspot_contacts').select('contact_id, email, firstname, lastname, jobtitle, associated_company_id')
              .in('email', [...fromEmails])
          : Promise.resolve({ data: [] }),
        fromDomains.size > 0
          ? supabase.from('hubspot_companies').select('company_id, name, domain').in('domain', [...fromDomains])
          : Promise.resolve({ data: [] }),
        dealIds.size > 0
          ? supabase.from('hubspot_deals').select('deal_id, dealname, dealstage').in('deal_id', [...dealIds])
          : Promise.resolve({ data: [] }),
        companyIds.size > 0
          ? supabase.from('hubspot_companies').select('company_id, name, domain, industry').in('company_id', [...companyIds])
          : Promise.resolve({ data: [] }),
        contactIds.size > 0
          ? supabase.from('hubspot_contacts').select('contact_id, firstname, lastname, email, jobtitle, associated_company_id').in('contact_id', [...contactIds])
          : Promise.resolve({ data: [] }),
      ])
      if (cancelled) return
      const contactsByEmail = new Map()
      for (const c of (lookups[0].data ?? [])) {
        if (c.email) contactsByEmail.set(c.email.toLowerCase(), c)
      }
      const companiesByDomain = new Map()
      for (const c of (lookups[1].data ?? [])) {
        if (c.domain) companiesByDomain.set(c.domain.toLowerCase(), c)
      }
      const dealsById = new Map((lookups[2].data ?? []).map(d => [d.deal_id, d]))
      const companiesById = new Map((lookups[3].data ?? []).map(c => [c.company_id, c]))
      const contactsById = new Map((lookups[4].data ?? []).map(c => [c.contact_id, c]))

      const extraCompanyIds = new Set()
      for (const c of contactsByEmail.values()) {
        if (c.associated_company_id && !companiesById.has(c.associated_company_id)) {
          extraCompanyIds.add(c.associated_company_id)
        }
      }
      for (const c of contactsById.values()) {
        if (c.associated_company_id && !companiesById.has(c.associated_company_id)) {
          extraCompanyIds.add(c.associated_company_id)
        }
      }
      if (extraCompanyIds.size > 0) {
        const { data: extraCompanies } = await supabase.from('hubspot_companies')
          .select('company_id, name, domain').in('company_id', [...extraCompanyIds])
        for (const c of (extraCompanies ?? [])) companiesById.set(c.company_id, c)
      }

      const out = {}
      for (const m of matches) {
        const meta = m.meta || {}
        let person = null, company = null, extra = null
        if ((m.source === 'mail' || m.source === 'engagement') && meta.from_email) {
          const c = contactsByEmail.get(meta.from_email.toLowerCase())
          if (c) {
            person = [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email
            if (c.associated_company_id && companiesById.has(c.associated_company_id)) {
              company = companiesById.get(c.associated_company_id).name
            }
          } else {
            person = meta.from_email
          }
          if (!company) {
            const d = meta.from_email.split('@')[1]?.toLowerCase()
            if (d && companiesByDomain.has(d)) company = companiesByDomain.get(d).name
          }
        } else if (m.source === 'deal' && dealsById.has(m.id)) {
          const d = dealsById.get(m.id)
          person = d.dealname; extra = d.dealstage
        } else if (m.source === 'company' && companiesById.has(m.id)) {
          const c = companiesById.get(m.id)
          person = c.name; extra = c.industry || c.domain
        } else if (m.source === 'contact' && contactsById.has(m.id)) {
          const c = contactsById.get(m.id)
          person = [c.firstname, c.lastname].filter(Boolean).join(' ') || c.email
          extra = c.jobtitle
          if (c.associated_company_id && companiesById.has(c.associated_company_id)) {
            company = companiesById.get(c.associated_company_id).name
          }
        }
        if (person || company || extra) {
          out[m.chunk_id] = { person, company, extra }
        }
      }
      setLinked(out)
    })()
    return () => { cancelled = true }
  }, [matches])

  return linked
}
