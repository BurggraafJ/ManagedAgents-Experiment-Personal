// Pure helpers + constants voor HubSpotInboxFutureView (Daily Admin —
// Toekomst). Refactor 11 (2026-05-09): geëxtraheerd uit de monoliete
// HubSpotInboxFutureView.jsx zodat de view-files puur UI zijn.
//
// Geen JSX, geen React-imports, geen Supabase-calls — alleen transformaties
// over de in-memory data uit useAdmin + de hsIndex die door de view geladen
// wordt.

export const FUTURE_AGENT = 'daily-admin-future'
// 3 maanden vooruit — sync met skill v1.14+
export const FUTURE_WINDOW_DAYS = 90

// Externe attendee = niet-LM-domein, geen lege rijen, geen room/resource.
export function isExternalAttendee(att) {
  if (!att?.email) return false
  const e = att.email.toLowerCase()
  if (e.endsWith('@legal-mind.nl')) return false
  if (att.attendee_type === 'resource') return false
  return true
}

// Soft kennismaking-detectie: alleen voor confidence-hint, NIET voor filter.
export const KENNIS_KEYWORDS = [
  'kennismaking', 'kennismakingsgesprek', 'kennismaking gesprek',
  'intake', 'intro', 'introductie', 'eerste gesprek', 'eerste afspraak',
  'demo', 'pilot', 'proefperiode', 'prospect',
]
export function hasKennismakingKeyword(event) {
  const haystack = `${event.subject || ''} ${event.body_preview || ''}`.toLowerCase()
  return KENNIS_KEYWORDS.some(k => haystack.includes(k))
}

export function buildAttendeesByEvent(attendees) {
  const map = new Map()
  for (const a of attendees || []) {
    const eid = a.calendar_event_id
    if (!eid) continue
    if (!map.has(eid)) map.set(eid, [])
    map.get(eid).push(a)
  }
  return map
}

// Lookup: contact-by-email + deal-by-contact uit hubspot_* mirror.
// Initiële lege indices — worden gevuld door de hsIndex-fetch in
// useHubspotFutureIndex (Supabase REST: hubspot_contacts/companies/deals).
export function buildHubspotIndex() {
  return {
    contactByEmail: new Map(),
    companyById:    new Map(),
    dealsByContact: new Map(),
    dealsByCompany: new Map(),
  }
}

// ===== Classifier =====
//
// Categorie-resolutie per event (highest-priority wins):
//   1. recruitment — attendee-naam matcht open REC-issue summary
//   2. partner     — domain in agent_config(daily-admin, partner_domains)
//   3. customer    — contact in HubSpot, deal in 'Customer Base'-pipeline
//   4. sales       — contact in HubSpot, deal in Sales/Leads-pipeline
//   5. lead        — contact in HubSpot, geen deal
//   6. onbekend    — geen enkele match (RAG-kandidaat)
//
// Sales Pipeline-id (HubSpot 'default') en Customer Base-id ('2299277539')
// hardgecodeerd; leads-pipelines herkend via label-prefix 'Leads' via lookup.

export const SALES_PIPELINE_ID = 'default'
export const CUSTOMER_BASE_PIPELINE_ID = '2299277539'

export function normalizeName(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

export function classifyEvent(event, externals, hsIndex, pipelineLookup) {
  if (!hsIndex) return { category: 'pending', reason: 'mirror_loading' }

  const recIssues = hsIndex.recIssues || []
  const partnerDomains = hsIndex.partnerDomains || new Set()

  // 1. Recruitment — name-match in REC-summary OF assignee_email = attendee
  for (const a of externals) {
    const name = normalizeName(a.name || (a.email || '').split('@')[0])
    if (!name || name.length < 3) continue
    // Probeer eerst assignee-email match
    const exactEmail = recIssues.find(r => (r.assignee_email || '').toLowerCase() === (a.email || '').toLowerCase())
    if (exactEmail) return { category: 'recruitment', reason: 'rec_assignee_email', evidence: exactEmail }
    // Daarna name-match in summary (tokens)
    const tokens = name.split(/\s+/).filter(t => t.length >= 3)
    if (tokens.length === 0) continue
    const hit = recIssues.find(r => {
      const sum = normalizeName(r.summary || '')
      return tokens.every(t => sum.includes(t))
    })
    if (hit) return { category: 'recruitment', reason: 'rec_name_match', evidence: hit }
  }

  // 2. Partner — domain-match
  for (const a of externals) {
    const dom = (a.email || '').split('@')[1]?.toLowerCase()
    if (dom && partnerDomains.has(dom)) {
      return { category: 'partner', reason: 'partner_domain', evidence: { domain: dom } }
    }
  }

  // 3-5. HubSpot-resolutie
  let contact = null, company = null, deals = []
  for (const a of externals) {
    const c = hsIndex.contactByEmail.get((a.email || '').toLowerCase())
    if (c) { contact = c; break }
  }
  if (contact?.associated_company_id) company = hsIndex.companyById.get(contact.associated_company_id) || null
  if (!company && externals[0]?.email) {
    const dom = externals[0].email.split('@')[1]?.toLowerCase()
    if (dom) {
      for (const co of hsIndex.companyById.values()) {
        if ((co.domain || '').toLowerCase() === dom) { company = co; break }
      }
    }
  }
  if (contact?.contact_id) deals = hsIndex.dealsByContact.get(contact.contact_id) || []
  if (deals.length === 0 && company?.company_id) deals = hsIndex.dealsByCompany.get(company.company_id) || []

  const customerDeal = deals.find(d => d.pipeline_id === CUSTOMER_BASE_PIPELINE_ID)
  if (customerDeal) {
    return { category: 'customer', reason: 'customer_base_deal', evidence: { contact, company, deal: customerDeal, deals } }
  }
  const salesDeal = deals.find(d => {
    if (d.pipeline_id === SALES_PIPELINE_ID) return true
    const lbl = pipelineLookup?.resolve(d.pipeline_id, d.dealstage)?.pipelineLabel || ''
    return lbl.toLowerCase().startsWith('leads')
  })
  if (salesDeal) {
    return { category: 'sales', reason: 'sales_pipeline_deal', evidence: { contact, company, deal: salesDeal, deals } }
  }
  if (contact) {
    return { category: 'lead', reason: 'contact_no_deal', evidence: { contact, company, deals } }
  }
  if (company) {
    return { category: 'lead', reason: 'company_no_contact', evidence: { contact: null, company, deals } }
  }
  return { category: 'onbekend', reason: 'no_match', evidence: { contact: null, company: null, deals: [] } }
}

export const CAT_META = {
  recruitment: { label: 'Recruitment', tone: 'info',     hint: 'Match op een open REC-Jira-issue — kandidaat-flow ipv sales' },
  customer:    { label: 'Klant',       tone: 'success',  hint: 'Bestaande klant — deal in Customer Base-pipeline' },
  sales:       { label: 'Sales',       tone: 'accent',   hint: 'Prospect met deal in Sales of Leads-pipeline' },
  lead:        { label: 'Lead',        tone: 'warning',  hint: 'Contact in HubSpot maar (nog) geen deal' },
  partner:     { label: 'Partner',     tone: 'muted',    hint: 'Domein staat in partner_domains — geen sales-actie' },
  onbekend:    { label: 'Onbekend',    tone: 'danger',   hint: 'Geen match in HubSpot, Jira of partner-list — RAG-kandidaat' },
  pending:     { label: '…',           tone: 'muted',    hint: 'Mirror nog aan het laden' },
}

// Sales-stages waarbij kennismaking al heeft plaatsgevonden (zelfde set als
// in skill v1.7) — events met deal in deze stages krijgen geen voorstel meer.
export const SALES_STAGES_PAST_KENNISMAKING = new Set([
  '4077073627', '3206386936', 'contractsent', '4075158742',
  '3453858021', '3206386937', '3206387898', '4984103151',
])
export const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'hotmail.com', 'hotmail.nl', 'outlook.com', 'live.nl',
  'ziggo.nl', 'kpn.nl', 'planet.nl', 'xs4all.nl', 'icloud.com', 'me.com',
])

// Subject-keywords voor niet-sales meetings — synced met skill v1.10.
export const NON_SALES_KEYWORDS = [
  'aandeelhouder', 'shareholder', 'ava ',
  'stuurgroep', 'raad van advies', 'raad van bestuur', 'rvc ', 'rvb ',
  'boardmeeting', 'board meeting', 'board call',
  'blue ocean', 'strategische sessie', 'strategie sessie', 'strategy session',
  'kickoff', 'kick-off', 'all-hands', 'all hands', 'town hall',
  'review meeting', 'retrospective', 'retro ',
  'team building', 'teambuilding', 'offsite',
  'intern overleg', 'internal meeting',
]
export function isNonSalesMeeting(event) {
  const hay = `${event.subject || ''} ${event.body_preview || ''}`.toLowerCase()
  return NON_SALES_KEYWORDS.some(k => hay.includes(k))
}

// View-side equivalent van skill's shouldSkipProposal — zelfde logica zodat
// tabel en skill consistent zijn over wat een twijfelgeval is.
export function computeSkip(event, externals, cls) {
  if (!cls) return null
  if (isNonSalesMeeting(event)) return { reason: 'non_sales_meeting', label: 'Niet-sales meeting' }
  if (cls.category === 'customer') return { reason: 'customer_already_onboarded', label: 'Klant al binnen' }
  if (cls.category === 'sales' && cls.evidence?.deal) {
    if (SALES_STAGES_PAST_KENNISMAKING.has(cls.evidence.deal.dealstage)) {
      return { reason: 'sales_past_kennismaking', label: 'Sales al verder' }
    }
  }
  const allPersonal = externals.length > 0 && externals.every(a => {
    const dom = (a.email || '').split('@')[1]?.toLowerCase() || ''
    return PERSONAL_DOMAINS.has(dom)
  })
  if (allPersonal) return { reason: 'personal_domain', label: 'Personal domain' }
  return null
}

// Voorgestelde actie per categorie — overruled door skip-reden als die geldt.
export const ACTION_HINT = {
  recruitment: 'REC-card update',
  customer: 'Datum op deal',
  sales: 'Datum op deal',
  lead: 'Sales-deal aanmaken',
  partner: 'Geen actie (filter)',
  onbekend: 'Onderzoek nodig',
  pending: '—',
}
