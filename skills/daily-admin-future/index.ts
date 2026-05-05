// daily-admin-future v1 — Edge Function
//
// Scant aankomende kennismakings-afspraken (28d vooruit) uit calendar_events,
// kruislinkt met hubspot_* mirror, en schrijft voorstellen naar agent_proposals
// (agent_name='daily-admin-future') voor company/contact/deal-creates en
// kennismaking-datum-property. Voert nooit direct HubSpot-mutaties door.
//
// Auth: Bearer cron_secret OR Bearer service-role key.
// Trigger: pg_cron (`0 7 * * 1-5`) of dashboard manual run via
// agent_schedules.manual_run_requested_at + orchestrator.
//
// Schrijft NIET direct naar HubSpot — alle voorstellen via agent_proposals.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SKILL_VERSION = "daily-admin-future-v1";
const FUTURE_WINDOW_DAYS = 28;
const PROPOSAL_EXPIRY_DAYS = 14;
const SALES_PIPELINE_ID = "default";
const KENNISMAKING_PLANNED_STAGE = "appointmentscheduled"; // Sales Pipeline label "Kennismaking plaatsgevonden" — Sales Pipeline heeft geen "gepland" stage

const KENNIS_KEYWORDS = [
  "kennismaking", "kennismakingsgesprek", "kennismaking gesprek",
  "intake", "intro", "introductie", "eerste gesprek", "eerste afspraak",
  "demo", "pilot", "proefperiode", "prospect",
];

const DEFAULT_PROPERTY_MAPPING = {
  kennismaking_datum: "kennismaking_datum",
  verwachte_omvang: "verwachte_omvang",
  verwachte_kantooromvang: "verwachte_kantooromvang",
};

interface CalendarEvent {
  id: string;
  graph_id: string;
  subject: string | null;
  body_preview: string | null;
  start_time: string;
  end_time: string | null;
  location_text: string | null;
  online_meeting_url: string | null;
  organizer_email: string | null;
  is_cancelled: boolean | null;
  is_recurring: boolean | null;
  series_master_id: string | null;
}

interface CalendarAttendee {
  calendar_event_id: string;
  email: string | null;
  name: string | null;
  attendee_type: string | null;
  is_organizer: boolean | null;
}

interface HubspotContact {
  contact_id: string;
  email: string | null;
  firstname: string | null;
  lastname: string | null;
  jobtitle: string | null;
  associated_company_id: string | null;
  lifecyclestage: string | null;
}

interface HubspotCompany {
  company_id: string;
  name: string | null;
  domain: string | null;
  industry: string | null;
  num_employees: number | null;
  city: string | null;
  lifecyclestage: string | null;
}

interface HubspotDeal {
  deal_id: string;
  dealname: string | null;
  dealstage: string | null;
  pipeline_id: string | null;
  amount: number | null;
  closedate: string | null;
  associated_company_ids: string[] | null;
  associated_contact_ids: string[] | null;
  properties: Record<string, unknown> | null;
}

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<unknown> {
  const { data } = await supabase.from("agent_config").select("config_value")
    .eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  return data?.config_value ?? null;
}

async function getCronSecret(supabase: SupabaseClient): Promise<string | null> {
  const { data: vault } = await supabase.rpc("get_skill_secret_service", {
    p_skill_name: "global",
    p_secret_name: "cron_secret",
  });
  if (typeof vault === "string" && vault.length > 0) return vault;
  const v = await getCfg(supabase, "global", "cron_secret");
  return typeof v === "string" ? v : null;
}

async function setCfg(supabase: SupabaseClient, agentName: string, key: string, value: unknown): Promise<void> {
  const { error } = await supabase.from("agent_config").upsert({
    agent_name: agentName,
    config_key: key,
    config_value: value,
    updated_at: new Date().toISOString(),
  }, { onConflict: "agent_name,config_key" });
  if (error) throw new Error(`agent_config_upsert_failed: ${error.message}`);
}

function isKennismaking(ev: CalendarEvent): boolean {
  const hay = `${ev.subject ?? ""} ${ev.body_preview ?? ""}`.toLowerCase();
  return KENNIS_KEYWORDS.some(k => hay.includes(k));
}

function isExternalAttendee(a: CalendarAttendee): boolean {
  if (!a.email) return false;
  const e = a.email.toLowerCase();
  if (e.endsWith("@legal-mind.nl")) return false;
  if (a.attendee_type === "resource") return false;
  return true;
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

function fmtDateTimeNL(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("nl-NL", { weekday: "long", day: "2-digit", month: "long" });
  const time = d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  return `${day} om ${time}`;
}

function dealnameFor(company: HubspotCompany | null, externals: CalendarAttendee[]): string {
  if (company?.name) return company.name;
  const att = externals[0];
  if (att?.email) {
    const dom = att.email.split("@")[1] ?? "";
    return dom || att.email;
  }
  return "Nieuwe prospect";
}

interface MatchResult {
  contact: HubspotContact | null;
  company: HubspotCompany | null;
  deal: HubspotDeal | null;
  matchedDeals: HubspotDeal[];
}

function resolveMatch(
  externals: CalendarAttendee[],
  contactsByEmail: Map<string, HubspotContact>,
  companiesById: Map<string, HubspotCompany>,
  companiesByDomain: Map<string, HubspotCompany>,
  dealsByContact: Map<string, HubspotDeal[]>,
  dealsByCompany: Map<string, HubspotDeal[]>,
): MatchResult {
  let contact: HubspotContact | null = null;
  for (const a of externals) {
    const c = contactsByEmail.get((a.email ?? "").toLowerCase());
    if (c) { contact = c; break; }
  }
  let company: HubspotCompany | null = null;
  if (contact?.associated_company_id) {
    company = companiesById.get(contact.associated_company_id) ?? null;
  }
  if (!company) {
    for (const a of externals) {
      const dom = (a.email ?? "").split("@")[1]?.toLowerCase();
      if (dom && companiesByDomain.has(dom)) { company = companiesByDomain.get(dom)!; break; }
    }
  }
  let deals: HubspotDeal[] = [];
  if (contact?.contact_id) deals = dealsByContact.get(contact.contact_id) ?? [];
  if (deals.length === 0 && company?.company_id) deals = dealsByCompany.get(company.company_id) ?? [];
  // Sales Pipeline-deal heeft voorrang
  const sales = deals.find(d => d.pipeline_id === SALES_PIPELINE_ID);
  return { contact, company, deal: sales ?? deals[0] ?? null, matchedDeals: deals };
}

interface ProposalActions {
  type: string;
  label: string;
  payload: Record<string, unknown>;
}

function buildActions(
  ev: CalendarEvent,
  externals: CalendarAttendee[],
  match: MatchResult,
  propMap: Record<string, string>,
): { actions: ProposalActions[]; reason: string; subject: string; summary: string; needsInfo: boolean } {
  const startIso = ev.start_time;
  const startDate = fmtDate(startIso);
  const isPast = new Date(startIso).getTime() < Date.now();
  const stageId = KENNISMAKING_PLANNED_STAGE;
  const externalSummary = externals
    .map(a => a.name ?? a.email ?? "?")
    .filter(Boolean)
    .slice(0, 4)
    .join(", ");
  const att0 = externals[0];
  const domain = (att0?.email ?? "").split("@")[1]?.toLowerCase() ?? null;
  const subjectFmt = (ev.subject ?? "(zonder titel)").slice(0, 80);

  const actions: ProposalActions[] = [];
  let reason = "";
  let needsInfo = false;

  // Helper: contact-payload uit attendee
  const contactPayload = (a: CalendarAttendee) => {
    const [first, ...rest] = (a.name ?? "").trim().split(/\s+/);
    return {
      email: a.email,
      firstname: first || null,
      lastname: rest.length > 0 ? rest.join(" ") : null,
      jobtitle: null,
      company_domain: (a.email ?? "").split("@")[1] ?? null,
    };
  };

  // Geval A — geen contact + geen company → maak alles aan
  if (!match.contact && !match.company) {
    reason = "no_match_create_full_set";
    needsInfo = true; // bedrijfsgegevens zijn een educated guess
    if (att0) {
      actions.push({
        type: "company",
        label: `Company: ${domain ?? "(onbekend)"}`,
        payload: { name: domain ?? null, domain, industry: null, num_employees: null, city: null },
      });
      actions.push({ type: "contact", label: `Contact: ${att0.name ?? att0.email}`, payload: contactPayload(att0) });
      // Extra contacten als er meer externals zijn
      for (const a of externals.slice(1, 4)) {
        actions.push({ type: "contact", label: `Contact: ${a.name ?? a.email}`, payload: contactPayload(a) });
      }
      const dealname = domain ?? att0.email ?? "Nieuwe prospect";
      actions.push({
        type: "deal",
        label: `Deal: ${dealname} · Sales Pipeline · Kennismaking ${isPast ? "plaatsgevonden" : "gepland"}`,
        payload: {
          dealname,
          pipeline: SALES_PIPELINE_ID,
          dealstage: stageId,
          amount: null,
          attach_to_company_domain: domain,
          attach_to_contact_email: att0.email,
        },
      });
      actions.push({
        type: "deal_property_update",
        label: `Property: ${propMap.kennismaking_datum} = ${startDate}`,
        payload: { deal_id: null, property: propMap.kennismaking_datum, value: startDate, attach_to_new_deal: true },
      });
    }
  }
  // Geval B — wel contact, geen deal in Sales Pipeline
  else if (match.contact && (!match.deal || match.deal.pipeline_id !== SALES_PIPELINE_ID)) {
    reason = match.deal ? "contact_with_other_pipeline_deal" : "contact_no_deal";
    if (!match.company) {
      actions.push({
        type: "company",
        label: `Company: ${domain ?? "(onbekend)"}`,
        payload: { name: domain ?? null, domain, industry: null, num_employees: null, city: null },
      });
      needsInfo = true;
    }
    const dealname = dealnameFor(match.company, externals);
    actions.push({
      type: "deal",
      label: `Deal: ${dealname} · Sales Pipeline · Kennismaking ${isPast ? "plaatsgevonden" : "gepland"}`,
      payload: {
        dealname,
        pipeline: SALES_PIPELINE_ID,
        dealstage: stageId,
        amount: null,
        attach_to_company_id: match.company?.company_id ?? null,
        attach_to_company_domain: match.company ? null : domain,
        attach_to_contact_id: match.contact.contact_id,
      },
    });
    actions.push({
      type: "deal_property_update",
      label: `Property: ${propMap.kennismaking_datum} = ${startDate}`,
      payload: { deal_id: null, property: propMap.kennismaking_datum, value: startDate, attach_to_new_deal: true },
    });
    if (match.company?.num_employees) {
      const omvang = guessVerwachteOmvang(match.company.num_employees);
      if (omvang) {
        actions.push({
          type: "deal_property_update",
          label: `Property: ${propMap.verwachte_omvang} = ${omvang}`,
          payload: { deal_id: null, property: propMap.verwachte_omvang, value: omvang, attach_to_new_deal: true },
        });
      }
      actions.push({
        type: "deal_property_update",
        label: `Property: ${propMap.verwachte_kantooromvang} = ${match.company.num_employees}`,
        payload: { deal_id: null, property: propMap.verwachte_kantooromvang, value: match.company.num_employees, attach_to_new_deal: true },
      });
    }
  }
  // Geval C — wel deal in Sales Pipeline → check property kennismaking_datum
  else if (match.deal && match.deal.pipeline_id === SALES_PIPELINE_ID) {
    const props = match.deal.properties ?? {};
    const existing = props[propMap.kennismaking_datum];
    if (existing && String(existing).slice(0, 10) === startDate) {
      reason = "already_complete";
      // Geen actie nodig — wordt door caller gefilterd
    } else {
      reason = "deal_exists_property_missing";
      actions.push({
        type: "deal_property_update",
        label: `Property: ${propMap.kennismaking_datum} = ${startDate} (op bestaande deal)`,
        payload: { deal_id: match.deal.deal_id, property: propMap.kennismaking_datum, value: startDate, attach_to_new_deal: false },
      });
      // Stage update als nodig
      if (match.deal.dealstage !== stageId && !isPast) {
        actions.push({
          type: "stage",
          label: `Stage → Kennismaking gepland`,
          payload: {
            deal_id: match.deal.deal_id,
            pipeline: SALES_PIPELINE_ID,
            dealstage: stageId,
            from_stage: match.deal.dealstage,
            from_pipeline: match.deal.pipeline_id,
          },
        });
      }
    }
  }

  const subject = match.deal
    ? `Kennismaking ${match.deal.dealname ?? ""} — ${fmtDateTimeNL(startIso)}`.trim()
    : `Kennismaking ${match.company?.name ?? domain ?? subjectFmt} — ${fmtDateTimeNL(startIso)}`;

  const summaryParts: string[] = [];
  summaryParts.push(`Outlook-event: "${subjectFmt}" op ${fmtDateTimeNL(startIso)}.`);
  if (externalSummary) summaryParts.push(`Externe deelnemers: ${externalSummary}.`);
  if (match.deal) {
    summaryParts.push(`Bestaande deal in Sales Pipeline: "${match.deal.dealname}" — ${reason === "already_complete" ? "kennismaking-datum al ingevuld, geen voorstel nodig" : "kennismaking-datum ontbreekt → voorstel om in te vullen"}.`);
  } else if (match.contact) {
    summaryParts.push(`Contact gevonden in HubSpot, maar geen deal in Sales Pipeline — voorstel om deal aan te maken en kennismaking-datum vast te leggen.`);
  } else {
    summaryParts.push(`Geen match in HubSpot — voorstel om company, contact en deal aan te maken zodat de Power BI-rapportage compleet is.`);
  }
  const summary = summaryParts.join(" ");

  return { actions, reason, subject, summary, needsInfo };
}

function guessVerwachteOmvang(numEmployees: number | null): number | null {
  if (!numEmployees) return null;
  // Heuristiek (kan later vervangen door echte sales-formule):
  // 1-10 medew. → 5k, 11-25 → 12k, 26-50 → 25k, 51-100 → 45k, 100+ → 80k
  if (numEmployees <= 10) return 5000;
  if (numEmployees <= 25) return 12000;
  if (numEmployees <= 50) return 25000;
  if (numEmployees <= 100) return 45000;
  return 80000;
}

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const presented = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const cronSecret = (await getCronSecret(supabase)) || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!presented || (presented !== cronSecret && presented !== serviceKey)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const triggeredBy = req.headers.get("x-trigger-source") || "edge_cron";
  const startedAt = new Date().toISOString();

  const stats = {
    schema_version: "1",
    skill_version: SKILL_VERSION,
    triggered_by: triggeredBy,
    triggered_at: startedAt,
    counts: {
      calendar_events_scanned: 0,
      kennismakingen_detected: 0,
      events_with_externals: 0,
      contacts_matched: 0,
      companies_matched: 0,
      deals_matched: 0,
      proposals_created: 0,
      events_skipped_already_proposed: 0,
      events_skipped_complete: 0,
    },
    warnings: [] as string[],
  };

  const { data: runIns, error: runErr } = await supabase.from("agent_runs").insert({
    agent_name: "daily-admin-future", run_type: "edge_function", status: "running",
    started_at: startedAt, stats, errors: [],
  }).select("id").single();
  if (runErr || !runIns) {
    return new Response(JSON.stringify({ error: `run_record_create_failed: ${runErr?.message}` }), { status: 500 });
  }
  const runId = runIns.id as string;

  try {
    // Property-mapping
    const propMapRaw = await getCfg(supabase, "daily-admin-future", "property_mapping");
    const propMap = { ...DEFAULT_PROPERTY_MAPPING, ...(propMapRaw as Record<string, string> ?? {}) };

    const now = new Date();
    const horizon = new Date(now.getTime() + FUTURE_WINDOW_DAYS * 86400_000);

    // 1. Calendar events
    const { data: events, error: evErr } = await supabase
      .from("calendar_events")
      .select("id,graph_id,subject,body_preview,start_time,end_time,location_text,online_meeting_url,organizer_email,is_cancelled,is_recurring,series_master_id")
      .gte("start_time", now.toISOString())
      .lte("start_time", horizon.toISOString())
      .eq("is_cancelled", false)
      .order("start_time", { ascending: true });
    if (evErr) throw new Error(`calendar_events_fetch_failed: ${evErr.message}`);
    const eventsList = (events ?? []) as CalendarEvent[];
    stats.counts.calendar_events_scanned = eventsList.length;

    // 2. Kennismaking-filter
    const candidates = eventsList.filter(isKennismaking);
    stats.counts.kennismakingen_detected = candidates.length;
    if (candidates.length === 0) {
      await supabase.from("agent_runs").update({
        status: "success", completed_at: new Date().toISOString(),
        summary: "Geen kennismakings-events in de eerstvolgende 28 dagen.", stats,
      }).eq("id", runId);
      await supabase.from("agent_schedules").update({ last_run_at: new Date().toISOString() }).eq("agent_name", "daily-admin-future");
      return new Response(JSON.stringify({ ok: true, runId, stats }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // 3. Attendees voor candidate-events
    const eventIds = candidates.map(e => e.id);
    const { data: attendees, error: atErr } = await supabase
      .from("calendar_attendees")
      .select("calendar_event_id,email,name,attendee_type,is_organizer")
      .in("calendar_event_id", eventIds);
    if (atErr) throw new Error(`calendar_attendees_fetch_failed: ${atErr.message}`);
    const attMap = new Map<string, CalendarAttendee[]>();
    for (const a of (attendees ?? []) as CalendarAttendee[]) {
      if (!a.calendar_event_id) continue;
      if (!attMap.has(a.calendar_event_id)) attMap.set(a.calendar_event_id, []);
      attMap.get(a.calendar_event_id)!.push(a);
    }

    // 4. Filter op events met externe deelnemers
    const eventsWithExt = candidates
      .map(e => ({ event: e, externals: (attMap.get(e.id) ?? []).filter(isExternalAttendee) }))
      .filter(x => x.externals.length > 0);
    stats.counts.events_with_externals = eventsWithExt.length;

    // 5. HubSpot mirror lookups — alleen voor de externe attendees in scope
    const allEmails = Array.from(new Set(
      eventsWithExt.flatMap(x => x.externals.map(a => (a.email ?? "").toLowerCase())).filter(Boolean)
    ));
    const allDomains = Array.from(new Set(allEmails.map(e => e.split("@")[1]).filter(Boolean)));

    const contactsByEmail = new Map<string, HubspotContact>();
    if (allEmails.length > 0) {
      const { data: contacts, error: cErr } = await supabase
        .from("hubspot_contacts")
        .select("contact_id,email,firstname,lastname,jobtitle,associated_company_id,lifecyclestage")
        .in("email", allEmails)
        .eq("is_archived", false);
      if (cErr) throw new Error(`hubspot_contacts_fetch_failed: ${cErr.message}`);
      for (const c of (contacts ?? []) as HubspotContact[]) {
        if (c.email) contactsByEmail.set(c.email.toLowerCase(), c);
      }
    }
    stats.counts.contacts_matched = contactsByEmail.size;

    const companiesById = new Map<string, HubspotCompany>();
    const companiesByDomain = new Map<string, HubspotCompany>();
    const companyIds = Array.from(new Set(
      Array.from(contactsByEmail.values()).map(c => c.associated_company_id).filter(Boolean) as string[]
    ));
    if (companyIds.length > 0 || allDomains.length > 0) {
      const orParts = [];
      if (companyIds.length > 0) orParts.push(`company_id.in.(${companyIds.join(",")})`);
      if (allDomains.length > 0) orParts.push(`domain.in.(${allDomains.map(d => `"${d}"`).join(",")})`);
      let q = supabase.from("hubspot_companies")
        .select("company_id,name,domain,industry,num_employees,city,lifecyclestage")
        .eq("is_archived", false);
      if (orParts.length > 0) q = q.or(orParts.join(","));
      const { data: companies, error: coErr } = await q;
      if (coErr) throw new Error(`hubspot_companies_fetch_failed: ${coErr.message}`);
      for (const co of (companies ?? []) as HubspotCompany[]) {
        companiesById.set(co.company_id, co);
        if (co.domain) companiesByDomain.set(co.domain.toLowerCase(), co);
      }
    }
    stats.counts.companies_matched = companiesById.size;

    const dealsByContact = new Map<string, HubspotDeal[]>();
    const dealsByCompany = new Map<string, HubspotDeal[]>();
    const contactIdList = Array.from(contactsByEmail.values()).map(c => c.contact_id);
    const companyIdList = Array.from(companiesById.keys());
    if (contactIdList.length > 0 || companyIdList.length > 0) {
      const orParts: string[] = [];
      if (contactIdList.length > 0) orParts.push(`associated_contact_ids.ov.{${contactIdList.join(",")}}`);
      if (companyIdList.length > 0) orParts.push(`associated_company_ids.ov.{${companyIdList.join(",")}}`);
      const { data: deals, error: dErr } = await supabase
        .from("hubspot_deals")
        .select("deal_id,dealname,dealstage,pipeline_id,amount,closedate,associated_company_ids,associated_contact_ids,properties")
        .or(orParts.join(","))
        .eq("is_archived", false);
      if (dErr) throw new Error(`hubspot_deals_fetch_failed: ${dErr.message}`);
      for (const d of (deals ?? []) as HubspotDeal[]) {
        for (const cid of (d.associated_contact_ids ?? [])) {
          if (!dealsByContact.has(cid)) dealsByContact.set(cid, []);
          dealsByContact.get(cid)!.push(d);
        }
        for (const coid of (d.associated_company_ids ?? [])) {
          if (!dealsByCompany.has(coid)) dealsByCompany.set(coid, []);
          dealsByCompany.get(coid)!.push(d);
        }
      }
    }
    stats.counts.deals_matched = (dealsByContact.size + dealsByCompany.size); // niet-uniek maar ok als globale teller

    // 6. Bestaande open proposals — om duplicates te voorkomen
    const { data: existingProps, error: pErr } = await supabase
      .from("agent_proposals")
      .select("id,context,status")
      .eq("agent_name", "daily-admin-future")
      .in("status", ["pending", "amended", "accepted"]);
    if (pErr) throw new Error(`existing_proposals_fetch_failed: ${pErr.message}`);
    const existingByEvent = new Set<string>();
    for (const p of existingProps ?? []) {
      const ctx = (p.context ?? {}) as { calendar_event_id?: string };
      if (ctx.calendar_event_id) existingByEvent.add(ctx.calendar_event_id);
    }

    // 7. Voor elk event-with-externals een voorstel bouwen
    const proposalsToInsert: Array<Record<string, unknown>> = [];
    for (const { event, externals } of eventsWithExt) {
      if (existingByEvent.has(event.id)) {
        stats.counts.events_skipped_already_proposed++;
        continue;
      }
      const match = resolveMatch(externals, contactsByEmail, companiesById, companiesByDomain, dealsByContact, dealsByCompany);
      const built = buildActions(event, externals, match, propMap);
      if (built.actions.length === 0) {
        stats.counts.events_skipped_complete++;
        continue;
      }
      const expiresAt = new Date(Date.now() + PROPOSAL_EXPIRY_DAYS * 86400_000).toISOString();
      proposalsToInsert.push({
        agent_name: "daily-admin-future",
        category: "klant",
        subject: built.subject,
        summary: built.summary,
        proposal: { target: { id: event.graph_id, type: "calendar_event" }, actions: built.actions },
        context: {
          calendar_event_id: event.id,
          calendar_event_graph_id: event.graph_id,
          start_time: event.start_time,
          end_time: event.end_time,
          location_text: event.location_text,
          online_meeting_url: event.online_meeting_url,
          attendee_emails: externals.map(a => a.email).filter(Boolean),
          pipeline: SALES_PIPELINE_ID,
          pipeline_stage: KENNISMAKING_PLANNED_STAGE,
          deal_id: match.deal?.deal_id ?? null,
          company_id: match.company?.company_id ?? null,
          contact_id: match.contact?.contact_id ?? null,
          match_reason: built.reason,
        },
        status: "pending",
        needs_info: built.needsInfo,
        confidence: match.deal ? 0.9 : (match.contact ? 0.7 : 0.5),
        expires_at: expiresAt,
      });
    }

    if (proposalsToInsert.length > 0) {
      const { error: insErr } = await supabase.from("agent_proposals").insert(proposalsToInsert);
      if (insErr) throw new Error(`proposals_insert_failed: ${insErr.message}`);
      stats.counts.proposals_created = proposalsToInsert.length;
    }

    // 8. State + run-record
    await setCfg(supabase, "daily-admin-future", "state", { last_processed_at: new Date().toISOString() });
    await supabase.from("agent_schedules").update({
      last_run_at: new Date().toISOString(),
      manual_run_requested_at: null,
    }).eq("agent_name", "daily-admin-future");

    const summary = `${stats.counts.events_with_externals} kennismakings-events gescand, ${stats.counts.proposals_created} nieuwe voorstellen, ${stats.counts.events_skipped_already_proposed} skips (al open), ${stats.counts.events_skipped_complete} skips (al compleet).`;
    await supabase.from("agent_runs").update({
      status: stats.warnings.length > 0 ? "warning" : "success",
      completed_at: new Date().toISOString(),
      summary, stats,
    }).eq("id", runId);

    return new Response(JSON.stringify({ ok: true, runId, stats }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await supabase.from("agent_runs").update({
      status: "error", completed_at: new Date().toISOString(),
      summary: errMsg.slice(0, 500), stats,
      errors: [{ message: errMsg, at: new Date().toISOString() }],
    }).eq("id", runId);
    return new Response(JSON.stringify({ ok: false, error: errMsg }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
