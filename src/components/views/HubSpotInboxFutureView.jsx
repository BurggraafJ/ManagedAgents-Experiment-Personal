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
import AdminPeriodToggle from './AdminPeriodToggle'

// Daily Admin — Toekomst-tabblad. Los van het Huidig-tabblad zodat de
// bestaande daily-admin-flow ongewijzigd blijft. Twee secties:
//
//   1. Aankomende kennismakingen — tabel uit calendar_events (28 dagen
//      vooruit, gefilterd op kennismaking-keywords + externe attendees).
//      Per rij: datum/tijd, deelnemers, locatie/Teams, gematchte HubSpot
//      deal/company/contact + status. Bedoeld als scanbaar overzicht.
//
//   2. Voorstellen van skill `daily-admin-future` — proposals waar de
//      skill voorstelt company/contact/deal aan te maken of een
//      kennismaking-datum/stage in te vullen. Hergebruikt dezelfde
//      ProposalCardCompact als Huidig.
//
// Bron-keuze: alles read-only uit useDashboard data; geen extra fetch.

const FUTURE_AGENT = 'daily-admin-future'

// Detectie-keywords voor kennismaking-events. Lowercase, simpele substring-
// match op subject + body_preview. Identiek aan skill-side detectie zodat
// frontend-tabel en skill dezelfde scope tonen.
const KENNIS_KEYWORDS = [
  'kennismaking', 'kennismakingsgesprek', 'kennismaking gesprek',
  'intake', 'intro', 'introductie', 'eerste gesprek', 'eerste afspraak',
  'demo', 'pilot', 'proefperiode', 'prospect',
]

const FUTURE_WINDOW_DAYS = 28

function isKennismaking(event) {
  const haystack = `${event.subject || ''} ${event.body_preview || ''}`.toLowerCase()
  return KENNIS_KEYWORDS.some(k => haystack.includes(k))
}

// Externe attendee = niet-LM-domein, geen Jelle, geen lege rijen, geen room/resource.
function isExternalAttendee(att) {
  if (!att?.email) return false
  const e = att.email.toLowerCase()
  if (e.endsWith('@legal-mind.nl')) return false
  if (att.attendee_type === 'resource') return false
  return true
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

  // Future-events: window NU → NU+28d, kennismaking-keywords, niet cancelled,
  // niet recurring-master. Sorteer op start.
  const events = useMemo(() => {
    const now = Date.now()
    const horizon = now + FUTURE_WINDOW_DAYS * 86400000
    return (data.calendarEvents || [])
      .filter(e => !e.is_cancelled)
      .filter(e => {
        const t = new Date(e.start_time).getTime()
        return t >= now && t <= horizon
      })
      .filter(e => isKennismaking(e))
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

  // HubSpot match-index — laad eenmalig contacts/deals/companies uit mirror.
  // Dit is een lichte select gefiltered op de e-mailadressen die we nodig
  // hebben, zodat we geen 600+ deals binnenhalen. Domain-based fallback.
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
      const [contactsR, companiesR] = await Promise.all([
        safe(supabase.from('hubspot_contacts')
          .select('contact_id,email,firstname,lastname,jobtitle,associated_company_id,lifecyclestage,is_archived')
          .in('email', emails)
          .eq('is_archived', false)),
        safe(supabase.from('hubspot_companies')
          .select('company_id,name,domain,industry,num_employees,lifecyclestage,is_archived')
          .in('domain', domains)
          .eq('is_archived', false)),
      ])
      const contacts = contactsR.data || []
      const companies = companiesR.data || []
      const contactIds = contacts.map(c => c.contact_id)
      const companyIds = Array.from(new Set([
        ...contacts.map(c => c.associated_company_id).filter(Boolean),
        ...companies.map(c => c.company_id),
      ]))

      let deals = []
      if (contactIds.length > 0 || companyIds.length > 0) {
        // PostgREST: array overlap voor associated_*_ids — gebruik or-syntax
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

  return (
    <PipelineLookupContext.Provider value={pipelineLookup}>
    <HubSpotUsersContext.Provider value={hubspotUsers}>
    <div className="stack" style={{ gap: 'var(--s-5)' }}>

      <div><AdminPeriodToggle /></div>

      {/* Sectie 1 — Kennismakings-tabel */}
      <section className="va-block" style={{ paddingBottom: 8 }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
          <div>
            <h2 className="va-block__title" style={{ fontSize: 14, fontWeight: 600 }}>
              Aankomende kennismakingen
              <span className="va-block__count" style={{ marginLeft: 8 }}>{eventsWithExt.length}</span>
            </h2>
            <div className="muted" style={{ fontSize: 11 }}>
              Komende {FUTURE_WINDOW_DAYS} dagen uit Outlook · gefilterd op kennismaking-keywords + externe deelnemers · bron: <code>calendar_events</code>
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
            Geen aankomende kennismakingen in de eerstkomende {FUTURE_WINDOW_DAYS} dagen.
            <br />
            <span className="muted" style={{ fontSize: 10.5 }}>
              Detectie op subject/body — gebruik woorden als "kennismaking", "intake", "demo", "intro" in je agenda-uitnodiging.
            </span>
          </div>
        ) : (
          <KennismakingsTable events={eventsWithExt} hsIndex={hsIndex} pipelineLookup={pipelineLookup} />
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

// ===== Tabel =====

function KennismakingsTable({ events, hsIndex, pipelineLookup }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 130 }}>Wanneer</th>
            <th>Onderwerp</th>
            <th style={{ width: 220 }}>Externe deelnemers</th>
            <th style={{ width: 200 }}>Bedrijf</th>
            <th style={{ width: 200 }}>Deal · Pipeline · Stage</th>
            <th style={{ width: 100 }}>Locatie</th>
            <th style={{ width: 90 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {events.map(e => (
            <KennismakingRow key={e.id} event={e} hsIndex={hsIndex} pipelineLookup={pipelineLookup} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function KennismakingRow({ event, hsIndex, pipelineLookup }) {
  // Match-resolutie: probeer eerste externe attendee → contact → deal/company.
  // Bij geen match: domein → company → deal.
  const ix = hsIndex
  const externals = event._externals || []

  let contact = null, company = null, deals = []
  if (ix) {
    for (const a of externals) {
      const c = ix.contactByEmail.get((a.email || '').toLowerCase())
      if (c) { contact = c; break }
    }
    if (contact?.associated_company_id) company = ix.companyById.get(contact.associated_company_id) || null
    if (!company && externals[0]?.email) {
      const dom = externals[0].email.split('@')[1]?.toLowerCase()
      if (dom) {
        for (const co of ix.companyById.values()) {
          if ((co.domain || '').toLowerCase() === dom) { company = co; break }
        }
      }
    }
    if (contact?.contact_id) deals = ix.dealsByContact.get(contact.contact_id) || []
    if (deals.length === 0 && company?.company_id) deals = ix.dealsByCompany.get(company.company_id) || []
  }
  // Beste deal = actieve in Sales Pipeline (default), anders eerste niet-archived
  const bestDeal = useMemo(() => {
    if (!deals || deals.length === 0) return null
    const sales = deals.find(d => d.pipeline_id === 'default')
    return sales || deals[0]
  }, [deals])

  const status = computeStatus({ contact, company, deal: bestDeal })

  const when = new Date(event.start_time)
  const dateLabel = when.toLocaleDateString('nl-NL', { weekday: 'short', day: '2-digit', month: 'short' })
  const timeLabel = when.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })

  const locShort = event.online_meeting_url ? 'Teams' : (event.location_text || '—')
  const subjectShort = (event.subject || '(zonder titel)').slice(0, 80)

  const stageLabel = bestDeal
    ? pipelineLookup.resolve(bestDeal.pipeline_id, bestDeal.dealstage).stageLabel
    : null
  const pipelineLabel = bestDeal
    ? pipelineLookup.resolve(bestDeal.pipeline_id, bestDeal.dealstage).pipelineLabel
    : null

  return (
    <tr>
      <td className="mono" style={{ fontSize: 12 }}>
        <div>{dateLabel}</div>
        <div className="muted" style={{ fontSize: 11 }}>{timeLabel}</div>
      </td>
      <td style={{ maxWidth: 320 }}>
        <div title={event.subject || ''}>{subjectShort}</div>
        {event.body_preview && (
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
            {event.body_preview.slice(0, 80)}
          </div>
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
      <td style={{ fontSize: 12 }}>
        {company ? (
          <>
            <div>{company.name}</div>
            <div className="muted" style={{ fontSize: 11 }}>
              {[company.industry, company.num_employees && `${company.num_employees} medew.`].filter(Boolean).join(' · ') || company.domain}
            </div>
          </>
        ) : (
          <span className="muted">— niet gevonden</span>
        )}
      </td>
      <td style={{ fontSize: 12 }}>
        {bestDeal ? (
          <>
            <div title={bestDeal.dealname}>{(bestDeal.dealname || '').slice(0, 40) || '—'}</div>
            <div className="muted" style={{ fontSize: 11 }}>
              {[pipelineLabel, stageLabel].filter(Boolean).join(' · ') || '—'}
            </div>
          </>
        ) : (
          <span className="muted">— geen deal</span>
        )}
      </td>
      <td style={{ fontSize: 12 }} title={event.location_text || ''}>{locShort}</td>
      <td>
        <StatusPill status={status} />
      </td>
    </tr>
  )
}

function computeStatus({ contact, company, deal }) {
  if (deal) return 'deal_ok'
  if (contact && company) return 'no_deal'
  if (company || contact) return 'partial'
  return 'unknown'
}

function StatusPill({ status }) {
  const meta = {
    deal_ok:  { label: '✓ in HubSpot',  tone: 'success', hint: 'Contact + company + deal aanwezig' },
    no_deal:  { label: '⚠ deal mist',   tone: 'warning', hint: 'Contact en company gevonden, geen deal — kandidaat voor proposal' },
    partial:  { label: '⚠ incompleet',  tone: 'warning', hint: 'Of contact óf company gevonden, niet beide' },
    unknown:  { label: '✗ onbekend',    tone: 'danger',  hint: 'Geen match in HubSpot — kandidaat voor company + contact + deal create' },
  }[status] || { label: '—', tone: 'muted', hint: '' }
  return (
    <span className={`v-badge v-badge--${meta.tone}`} title={meta.hint}>{meta.label}</span>
  )
}
