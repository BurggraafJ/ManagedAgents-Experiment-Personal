import { useMemo, useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import {
  PipelineLookupContext,
  HubSpotUsersContext,
  buildPipelineLookup,
  formatDateTime,
} from './hubspot-common'
import ProposalCardCompact from '../ProposalCardCompact'
import { groupProposals, GROUP_META } from './hubspot-shared.jsx'

// Daily Admin — Toekomst-tabblad. Los van het Huidig-tabblad zodat de
// bestaande daily-admin-flow ongewijzigd blijft. Twee secties:
//
//   1. Aankomende externe afspraken — tabel uit calendar_events (28 dagen
//      vooruit). Pakt ALLE events met externe attendees (niet meer alleen
//      kennismaking-keywords) en classificeert per categorie:
//      recruitment / customer / sales / partner / lead / onbekend.
//      Per rij: wanneer, deelnemers, locatie, gematchte bron + categorie.
//
//   2. Voorstellen van skill `daily-admin-future` — proposals per categorie
//      (Sales-deal aanmaken, kennismaking_datum invullen, REC-card update).
//      Hergebruikt dezelfde ProposalCardCompact als Huidig.
//
// Bron-keuze: alles read-only uit useDashboard data + één extra fetch voor
// HubSpot-mirror (contacts/companies/deals scoped op de externe e-mails).

const FUTURE_AGENT = 'daily-admin-future'
const FUTURE_WINDOW_DAYS = 28

// Externe attendee = niet-LM-domein, geen lege rijen, geen room/resource.
function isExternalAttendee(att) {
  if (!att?.email) return false
  const e = att.email.toLowerCase()
  if (e.endsWith('@legal-mind.nl')) return false
  if (att.attendee_type === 'resource') return false
  return true
}

// Soft kennismaking-detectie: alleen voor confidence-hint, NIET voor filter.
const KENNIS_KEYWORDS = [
  'kennismaking', 'kennismakingsgesprek', 'kennismaking gesprek',
  'intake', 'intro', 'introductie', 'eerste gesprek', 'eerste afspraak',
  'demo', 'pilot', 'proefperiode', 'prospect',
]
function hasKennismakingKeyword(event) {
  const haystack = `${event.subject || ''} ${event.body_preview || ''}`.toLowerCase()
  return KENNIS_KEYWORDS.some(k => haystack.includes(k))
}

function buildAttendeesByEvent(attendees) {
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
// Bouwt indices over de proposals/data die al in geheugen zit.
function buildHubspotIndex(data) {
  const contactByEmail = new Map()       // lower-email → contact
  const companyById    = new Map()
  const dealsByContact = new Map()       // contact_id → [deal,...]
  const dealsByCompany = new Map()       // company_id → [deal,...]

  // We hebben hubspotCustomerEmails (alleen email) niet voldoende — useDashboard
  // laadt geen hubspot_contacts/companies/deals direct. Daarom proberen we het
  // via Supabase REST in de view zelf te halen (eenmalig). Zie loadHubspot() in
  // de component.
  return { contactByEmail, companyById, dealsByContact, dealsByCompany }
}

export default function HubSpotInboxFutureView({ data, onRefresh }) {
  const pipelineLookup = useMemo(() => buildPipelineLookup(data.pipelines || []), [data.pipelines])
  const hubspotUsers = data.hubspotUsers || []

  // Future-events: window NU → NU+28d, niet cancelled. Geen keyword-filter
  // meer — externe attendees zijn het sterke signaal, "kennismaking" hoeft
  // niet in het subject te staan ("Enschede met klant" telt ook).
  const events = useMemo(() => {
    const now = Date.now()
    const horizon = now + FUTURE_WINDOW_DAYS * 86400000
    return (data.calendarEvents || [])
      .filter(e => !e.is_cancelled)
      .filter(e => {
        const t = new Date(e.start_time).getTime()
        return t >= now && t <= horizon
      })
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
  }, [data.calendarEvents])

  const attendeesByEvent = useMemo(
    () => buildAttendeesByEvent(data.calendarAttendees),
    [data.calendarAttendees],
  )

  // Voor elk event: externe attendees (= prospect-side).
  const eventsWithExt = useMemo(() => {
    return events.map(e => {
      const all = attendeesByEvent.get(e.id) || []
      const externals = all.filter(isExternalAttendee)
      return { ...e, _externals: externals, _allAttendees: all }
    }).filter(e => e._externals.length > 0)
  }, [events, attendeesByEvent])

  // Match-index — éénmalig fetch van HubSpot mirror + Jira REC-issues +
  // partner_domains uit agent_config. Dit voedt de classifier.
  const [hsIndex, setHsIndex] = useState(null)
  useEffect(() => {
    if (eventsWithExt.length === 0) { setHsIndex(buildHubspotIndex(data)); return }
    const emails = Array.from(new Set(
      eventsWithExt.flatMap(e => e._externals.map(a => (a.email || '').toLowerCase())).filter(Boolean)
    ))
    const domains = Array.from(new Set(emails.map(e => e.split('@')[1]).filter(Boolean)))
    if (emails.length === 0) { setHsIndex(buildHubspotIndex(data)); return }

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

      const ix = buildHubspotIndex(data)
      ix.recIssues = recIssues
      ix.partnerDomains = partnerDomains
      for (const c of contacts) ix.contactByEmail.set((c.email || '').toLowerCase(), c)
      for (const co of companies) ix.companyById.set(co.company_id, co)
      for (const co of (await fetchCompaniesByIds(contacts.map(c => c.associated_company_id).filter(Boolean), ix.companyById))) {
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
      setHsIndex(ix)
    })()
    return () => { cancelled = true }
  }, [eventsWithExt, data])

  // Future-proposals filter
  const futureProposals = useMemo(
    () => (data.proposals || []).filter(p => p.agent_name === FUTURE_AGENT),
    [data.proposals],
  )
  const buckets = useMemo(() => groupProposals(futureProposals), [futureProposals])
  const inboxList = useMemo(() => [...buckets.to_review, ...buckets.need_input], [buckets])

  const [selectedId, setSelectedId] = useState(null)
  useEffect(() => {
    if (!selectedId && inboxList.length > 0) setSelectedId(inboxList[0].id)
    if (selectedId && !inboxList.find(p => p.id === selectedId)) setSelectedId(inboxList[0]?.id || null)
  }, [inboxList, selectedId])
  const selected = inboxList.find(p => p.id === selectedId) || null

  // Manual-run trigger — schrijft manual_run_requested_at op agent_schedules
  const [busy, setBusy] = useState(false)
  const [runMsg, setRunMsg] = useState(null)
  async function triggerScan() {
    setBusy(true); setRunMsg(null)
    try {
      const { error } = await supabase
        .from('agent_schedules')
        .update({ manual_run_requested_at: new Date().toISOString() })
        .eq('agent_name', FUTURE_AGENT)
      if (error) throw error
      setRunMsg('Scan ingepland — orchestrator pakt deze in de eerstvolgende poll op.')
      onRefresh && onRefresh()
    } catch (e) {
      setRunMsg(`⚠ ${e.message || 'kon scan niet inplannen'}`)
    } finally {
      setBusy(false)
    }
  }

  const futureSchedule = useMemo(
    () => (data.schedules || []).find(s => s.agent_name === FUTURE_AGENT),
    [data.schedules],
  )

  // Dismissed-events — handmatig weggeklikte rijen.
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
  }, [data.lastRefresh])

  const handleDismiss = async (event) => {
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
        .eq('agent_name', FUTURE_AGENT)
        .eq('status', 'pending')
        .filter('context->>calendar_event_id', 'eq', event.id)
      onRefresh && onRefresh()
    } catch (e) {
      // rollback
      setDismissedSet(prev => { const s = new Set(prev); s.delete(event.id); return s })
    }
  }

  const handleUndoDismiss = async (event) => {
    setDismissedSet(prev => { const s = new Set(prev); s.delete(event.id); return s })
    try {
      await supabase.from('daily_admin_future_dismissed').delete().eq('calendar_event_id', event.id)
      onRefresh && onRefresh()
    } catch (e) {
      setDismissedSet(prev => new Set([...prev, event.id]))
    }
  }

  return (
    <PipelineLookupContext.Provider value={pipelineLookup}>
    <HubSpotUsersContext.Provider value={hubspotUsers}>
    <div className="stack" style={{ gap: 'var(--s-5)' }}>

      {/* Sectie 1 — Aankomende externe afspraken */}
      <section className="va-block" style={{ paddingBottom: 8 }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
          <div>
            <h2 className="va-block__title" style={{ fontSize: 14, fontWeight: 600 }}>
              Aankomende externe afspraken
              <span className="va-block__count" style={{ marginLeft: 8 }}>{eventsWithExt.length}</span>
            </h2>
            <div className="muted" style={{ fontSize: 11 }}>
              Komende {FUTURE_WINDOW_DAYS} dagen uit Outlook · alle events met externe deelnemers · per rij geclassificeerd via Jira-REC + HubSpot-mirror + partner_domains
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {futureSchedule?.last_run_at && (
              <span className="muted" style={{ fontSize: 11 }}>
                laatste scan: {formatDateTime(futureSchedule.last_run_at)}
              </span>
            )}
            <button
              type="button"
              className="btn btn--accent"
              onClick={triggerScan}
              disabled={busy || !futureSchedule}
              title={futureSchedule ? 'Plan een handmatige scan in (orchestrator pakt deze in eerstvolgende poll)' : 'Skill nog niet geregistreerd in agent_schedules'}
            >
              {busy ? 'Bezig…' : '⟳ Scan toekomst nu'}
            </button>
          </div>
        </header>
        {runMsg && <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>{runMsg}</div>}

        {eventsWithExt.length === 0 ? (
          <div className="empty empty--compact" style={{ padding: 20, fontSize: 12 }}>
            Geen aankomende externe afspraken in de eerstkomende {FUTURE_WINDOW_DAYS} dagen.
            <br />
            <span className="muted" style={{ fontSize: 10.5 }}>
              Voorwaarde: agenda-event met minimaal één deelnemer buiten <code>@legal-mind.nl</code>.
            </span>
          </div>
        ) : (
          <KennismakingsTable
            events={eventsWithExt}
            hsIndex={hsIndex}
            pipelineLookup={pipelineLookup}
            dismissedSet={dismissedSet}
            onDismiss={handleDismiss}
            onUndoDismiss={handleUndoDismiss}
          />
        )}
      </section>

      {/* Sectie 2 — Voorstellen daily-admin-future */}
      <section className="va-block" style={{ paddingBottom: 8 }}>
        <header style={{ marginBottom: 8 }}>
          <h2 className="va-block__title" style={{ fontSize: 14, fontWeight: 600 }}>
            Voorstellen — Toekomst
            <span className="va-block__count" style={{ marginLeft: 8 }}>{inboxList.length}</span>
          </h2>
          <div className="muted" style={{ fontSize: 11 }}>
            Voorstellen van skill <code>daily-admin-future</code> — company/contact/deal-creates en kennismaking-velden voor HubSpot. Goedkeuren of aanpassen werkt identiek aan Huidig.
          </div>
        </header>

        {inboxList.length === 0 ? (
          <div className="empty empty--compact" style={{ padding: 30, fontSize: 12, textAlign: 'center' }}>
            Geen open voorstellen. <br />
            <span className="muted" style={{ fontSize: 10.5 }}>Klik "Scan toekomst nu" om een nieuwe scan te starten.</span>
          </div>
        ) : (
          <div className="va-split">
            <aside className="va-list">
              {['to_review', 'need_input'].map(g => (
                buckets[g].length > 0 && (
                  <div key={g} className="va-list-group">
                    <div className={`va-list-group__head va-list-group__head--${GROUP_META[g].accent}`}>
                      {GROUP_META[g].label} <span>{buckets[g].length}</span>
                    </div>
                    {buckets[g].map(p => (
                      <ProposalRow key={p.id} proposal={p} selected={p.id === selectedId} onSelect={() => setSelectedId(p.id)} />
                    ))}
                  </div>
                )
              ))}
            </aside>
            <main className="va-detail">
              {selected && <ProposalCardCompact key={selected.id} proposal={selected} onRefresh={onRefresh} />}
            </main>
          </div>
        )}
      </section>

    </div>
    </HubSpotUsersContext.Provider>
    </PipelineLookupContext.Provider>
  )
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

function ProposalRow({ proposal, selected, onSelect }) {
  const isRevised = !!proposal.amended_from && proposal.status === 'pending'
  const needsInfo = proposal.needs_info === true && !proposal.amended_from
  return (
    <button type="button"
      className={`va-row ${selected ? 'is-selected' : ''} ${isRevised ? 'is-revised' : ''} ${needsInfo ? 'is-needs' : ''}`}
      onClick={onSelect}>
      <div className="va-row__top">
        <span className="va-row__subject">{proposal.subject}</span>
      </div>
      <div className="va-row__meta">
        {needsInfo && <span className="va-row__tag va-row__tag--warn">input</span>}
        {isRevised && <span className="va-row__tag va-row__tag--accent">✎ herzien</span>}
        <span className="va-row__time">{formatDateTime(proposal.created_at)}</span>
      </div>
    </button>
  )
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

const SALES_PIPELINE_ID = 'default'
const CUSTOMER_BASE_PIPELINE_ID = '2299277539'

function normalizeName(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function classifyEvent(event, externals, hsIndex, pipelineLookup) {
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

const CAT_META = {
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
const SALES_STAGES_PAST_KENNISMAKING = new Set([
  '4077073627', '3206386936', 'contractsent', '4075158742',
  '3453858021', '3206386937', '3206387898', '4984103151',
])
const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'hotmail.com', 'hotmail.nl', 'outlook.com', 'live.nl',
  'ziggo.nl', 'kpn.nl', 'planet.nl', 'xs4all.nl', 'icloud.com', 'me.com',
])

// View-side equivalent van skill's shouldSkipProposal — zelfde logica zodat
// tabel en skill consistent zijn over wat een twijfelgeval is.
function computeSkip(event, externals, cls) {
  if (!cls) return null
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

// ===== Tabel =====

function KennismakingsTable({ events, hsIndex, pipelineLookup, dismissedSet, onDismiss, onUndoDismiss }) {
  // Classificeer alle events vooraf
  const classified = useMemo(() =>
    events.map(e => ({ event: e, externals: e._externals || [], cls: classifyEvent(e, e._externals || [], hsIndex, pipelineLookup) })),
    [events, hsIndex, pipelineLookup]
  )

  // Splits in twee groepen: eerste kennismakingen (geen skip) en andere afspraken (met skip-reden)
  const partitioned = useMemo(() => {
    const first = []
    const others = []
    for (const x of classified) {
      const skip = computeSkip(x.event, x.externals, x.cls)
      const isDismissed = dismissedSet?.has(x.event.id)
      if (isDismissed) {
        others.push({ ...x, skip: skip || { reason: 'dismissed_by_user', label: 'Niet meer tonen (door jou)' }, isDismissed: true })
      } else if (skip) {
        others.push({ ...x, skip, isDismissed: false })
      } else {
        first.push({ ...x, skip: null, isDismissed: false })
      }
    }
    return { first, others }
  }, [classified, dismissedSet])

  const [othersOpen, setOthersOpen] = useState(false)

  return (
    <>
      {/* Tabel A — Eerste kennismakingen (uitgeklapt, primair) */}
      <div style={{ marginBottom: 16 }}>
        <header style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>
            Eerste kennismakingen
            <span className="va-block__count" style={{ marginLeft: 8 }}>{partitioned.first.length}</span>
          </h3>
          <span className="muted" style={{ fontSize: 11 }}>
            agenda-events waar dit echt de eerste interactie is — fysiek of online
          </span>
        </header>
        {partitioned.first.length === 0 ? (
          <div className="empty empty--compact" style={{ padding: 14, fontSize: 12 }}>
            Geen openstaande eerste-kennismakingen. <span className="muted" style={{ fontSize: 11 }}>Alle events zijn al-lopende relaties.</span>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 130 }}>Wanneer</th>
                  <th style={{ width: 110 }}>Categorie</th>
                  <th>Onderwerp</th>
                  <th style={{ width: 220 }}>Externe deelnemers</th>
                  <th style={{ width: 200 }}>Bron-match</th>
                  <th style={{ width: 130 }}>Locatie</th>
                  <th style={{ width: 110 }}>Voorgestelde actie</th>
                  <th style={{ width: 50, textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {partitioned.first.map(x => (
                  <KennismakingRow
                    key={x.event.id}
                    event={x.event}
                    externals={x.externals}
                    cls={x.cls}
                    skip={x.skip}
                    isDismissed={x.isDismissed}
                    pipelineLookup={pipelineLookup}
                    onDismiss={onDismiss}
                    onUndoDismiss={onUndoDismiss}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Tabel B — Andere externe afspraken (collapsible, secundair) */}
      <section className="va-block" style={{ paddingBottom: 8 }}>
        <button
          type="button"
          className="va-block__head"
          onClick={() => setOthersOpen(v => !v)}
          style={{ width: '100%' }}
        >
          <span className="va-block__caret">{othersOpen ? '▾' : '▸'}</span>
          <span className="va-block__title">Andere externe afspraken</span>
          <span className="va-block__count">{partitioned.others.length}</span>
          <span className="muted va-block__hint">
            klant al binnen, sales al verder, personal domain, lead al in beweging, of door jou weggeklikt
          </span>
        </button>
        {othersOpen && (
          <div className="va-block__body">
            {partitioned.others.length === 0 ? (
              <div className="empty empty--compact" style={{ padding: 14, fontSize: 12 }}>Geen.</div>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th style={{ width: 130 }}>Wanneer</th>
                      <th style={{ width: 110 }}>Categorie</th>
                      <th>Onderwerp</th>
                      <th style={{ width: 220 }}>Externe deelnemers</th>
                      <th style={{ width: 200 }}>Bron-match</th>
                      <th style={{ width: 130 }}>Locatie</th>
                      <th style={{ width: 150 }}>Reden</th>
                      <th style={{ width: 50, textAlign: 'right' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {partitioned.others.map(x => (
                      <KennismakingRow
                        key={x.event.id}
                        event={x.event}
                        externals={x.externals}
                        cls={x.cls}
                        skip={x.skip}
                        isDismissed={x.isDismissed}
                        pipelineLookup={pipelineLookup}
                        onDismiss={onDismiss}
                        onUndoDismiss={onUndoDismiss}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>
    </>
  )
}

function KennismakingRow({ event, externals, cls, skip, isDismissed, pipelineLookup, onDismiss, onUndoDismiss }) {
  const when = new Date(event.start_time)
  const dateLabel = when.toLocaleDateString('nl-NL', { weekday: 'short', day: '2-digit', month: 'short' })
  const timeLabel = when.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })

  const subjectShort = (event.subject || '(zonder titel)').slice(0, 80)
  const isExternalLocation = !!(event.location_text && !event.online_meeting_url)
  const locShort = event.online_meeting_url ? 'Teams' : (event.location_text || '—')

  const cat = cls?.category || 'pending'
  const meta = CAT_META[cat] || CAT_META.pending
  const ev = cls?.evidence || {}
  const inOthersTable = !!skip || isDismissed

  // Bron-match cell — afhankelijk van categorie
  let sourceCell = null
  if (cat === 'recruitment' && ev?.issue_key) {
    sourceCell = (
      <>
        <div className="mono" style={{ fontSize: 12 }}>{ev.issue_key}</div>
        <div className="muted" style={{ fontSize: 11 }} title={ev.summary}>{(ev.summary || '').slice(0, 32)}{ev.status ? ` · ${ev.status}` : ''}</div>
      </>
    )
  } else if ((cat === 'customer' || cat === 'sales' || cat === 'lead') && (ev?.contact || ev?.company)) {
    const dealLabel = ev?.deal ? pipelineLookup?.resolve(ev.deal.pipeline_id, ev.deal.dealstage) : null
    sourceCell = (
      <>
        <div style={{ fontSize: 12 }}>{ev.company?.name || (ev.contact ? `${ev.contact.firstname || ''} ${ev.contact.lastname || ''}`.trim() : '—')}</div>
        <div className="muted" style={{ fontSize: 11 }}>
          {ev?.deal
            ? `${dealLabel?.pipelineLabel || '?'} · ${dealLabel?.stageLabel || '?'}`
            : (ev?.contact ? 'contact, geen deal' : (ev?.company ? 'company, geen contact' : '—'))}
        </div>
      </>
    )
  } else if (cat === 'partner') {
    sourceCell = <div className="muted" style={{ fontSize: 12 }}>partner_domains</div>
  } else {
    sourceCell = <span className="muted">— geen match</span>
  }

  // Voorgestelde actie per categorie — overruled door skip-reden als die geldt
  const ACTION_HINT = {
    recruitment: 'REC-card update',
    customer: 'Datum op deal',
    sales: 'Datum op deal',
    lead: 'Sales-deal aanmaken',
    partner: 'Geen actie (filter)',
    onbekend: 'Onderzoek nodig',
    pending: '—',
  }
  const actionLabel = skip ? `Skip · ${skip.label}` : ACTION_HINT[cat]

  return (
    <tr>
      <td className="mono" style={{ fontSize: 12 }}>
        <div>{dateLabel}</div>
        <div className="muted" style={{ fontSize: 11 }}>{timeLabel}</div>
      </td>
      <td>
        <span className={`v-badge v-badge--${meta.tone}`} title={meta.hint}>{meta.label}</span>
        {hasKennismakingKeyword(event) && (
          <span className="muted" style={{ fontSize: 10, marginLeft: 4 }} title="Subject bevat kennismaking-keyword">·kennis</span>
        )}
      </td>
      <td style={{ maxWidth: 320 }}>
        <div title={event.subject || ''}>{subjectShort}</div>
        {event.body_preview && (
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{event.body_preview.slice(0, 80)}</div>
        )}
      </td>
      <td style={{ fontSize: 12 }}>
        {externals.map((a, i) => (
          <div key={i} title={a.email}>
            {a.name || a.email}
            {a.email && a.name && <span className="muted" style={{ fontSize: 10.5, marginLeft: 4 }}>{a.email.split('@')[1]}</span>}
          </div>
        ))}
      </td>
      <td style={{ fontSize: 12 }}>{sourceCell}</td>
      <td style={{ fontSize: 12 }} title={event.location_text || ''}>
        {locShort}
        {isExternalLocation && <span className="muted" style={{ fontSize: 10, marginLeft: 4 }}>·extern</span>}
      </td>
      <td className={`muted${skip ? ' is-skip' : ''}`} style={{ fontSize: 11, fontStyle: skip ? 'italic' : 'normal' }} title={skip ? `Skip-reden: ${skip.reason}` : 'Voorstel-categorie bepaalt de actie'}>
        {actionLabel}
      </td>
      <td style={{ textAlign: 'right' }}>
        {isDismissed ? (
          <button
            type="button"
            onClick={() => onUndoDismiss?.(event)}
            title="Terugplaatsen — skill mag dit event weer voorstellen"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 14, padding: 4 }}
          >
            ↶
          </button>
        ) : !inOthersTable && (
          <button
            type="button"
            onClick={() => onDismiss?.(event)}
            title="Niet meer tonen — skill verplaatst dit event naar 'Andere afspraken' en biedt het niet opnieuw aan"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted, #888)', fontSize: 14, padding: 4 }}
          >
            🗑
          </button>
        )}
      </td>
    </tr>
  )
}
