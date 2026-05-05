// daily-admin-future v1.5 — Edge Function
//
// v1.5 (2026-05-05) wijzigingen t.o.v. v1:
//   - Detectie verbreed: ALLE events met externe attendees in window
//     (niet meer alleen kennismaking-keywords). Locatie-of-keyword zijn
//     hints, geen filter.
//   - Categorie-classifier: recruitment / customer / sales / lead /
//     partner / onbekend, op basis van Jira REC name-match,
//     HubSpot deal-pipeline, partner_domains in agent_config.
//   - Acties per categorie: recruitment → REC-card update, customer →
//     kennismaking_datum op bestaande Customer Base-deal, sales/lead →
//     Sales Pipeline-deal-flow zoals v1, partner → filter, onbekend →
//     proposal met needs_info=true (RAG-kandidaat voor v1.6).
//
// Auth: Bearer cron_secret OR service-role key.
// Trigger: pg_cron (`0 7 * * 1-5`) of dashboard manual run via
// agent_schedules.manual_run_requested_at + orchestrator.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SKILL_VERSION = "daily-admin-future-v1.5";
const FUTURE_WINDOW_DAYS = 28;
const PROPOSAL_EXPIRY_DAYS = 14;
const SALES_PIPELINE_ID = "default";
const CUSTOMER_BASE_PIPELINE_ID = "2299277539";
const KENNISMAKING_STAGE = "appointmentscheduled";

const KENNIS_KEYWORDS = [
  "kennismaking", "kennismakingsgesprek", "intake", "intro", "introductie",
  "eerste gesprek", "eerste afspraak", "demo", "pilot", "proefperiode", "prospect",
];

const DEFAULT_PROPERTY_MAPPING = {
  kennismaking_datum: "kennismaking_datum",
  verwachte_omvang: "verwachte_omvang",
  verwachte_kantooromvang: "verwachte_kantooromvang",
};

type Category = "recruitment" | "customer" | "sales" | "lead" | "partner" | "onbekend";

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
interface JiraRecIssue {
  issue_key: string;
  summary: string | null;
  status: string | null;
  status_category: string | null;
  assignee_email: string | null;
}

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<unknown> {
  const { data } = await supabase.from("agent_config").select("config_value")
    .eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  return data?.config_value ?? null;
}
async function getCronSecret(supabase: SupabaseClient): Promise<string | null> {
  const { data: vault } = await supabase.rpc("get_skill_secret_service", {
    p_skill_name: "global", p_secret_name: "cron_secret",
  });
  if (typeof vault === "string" && vault.length > 0) return vault;
  const v = await getCfg(supabase, "global", "cron_secret");
  return typeof v === "string" ? v : null;
}
async function setCfg(supabase: SupabaseClient, agentName: string, key: string, value: unknown): Promise<void> {
  const { error } = await supabase.from("agent_config").upsert({
    agent_name: agentName, config_key: key, config_value: value,
    updated_at: new Date().toISOString(),
  }, { onConflict: "agent_name,config_key" });
  if (error) throw new Error(`agent_config_upsert_failed: ${error.message}`);
}

function isExternalAttendee(a: CalendarAttendee): boolean {
  if (!a.email) return false;
  const e = a.email.toLowerCase();
  if (e.endsWith("@legal-mind.nl")) return false;
  if (a.attendee_type === "resource") return false;
  return true;
}
function hasKennismakingKeyword(ev: CalendarEvent): boolean {
  const hay = `${ev.subject ?? ""} ${ev.body_preview ?? ""}`.toLowerCase();
  return KENNIS_KEYWORDS.some(k => hay.includes(k));
}
function fmtDate(iso: string): string { return iso.slice(0, 10); }
function fmtDateTimeNL(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("nl-NL", { weekday: "long", day: "2-digit", month: "long" });
  const time = d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  return `${day} om ${time}`;
}
function normalizeName(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function guessVerwachteOmvang(n: number | null): number | null {
  if (!n) return null;
  if (n <= 10) return 5000;
  if (n <= 25) return 12000;
  if (n <= 50) return 25000;
  if (n <= 100) return 45000;
  return 80000;
}

interface ClassResult {
  category: Category;
  reason: string;
  contact?: HubspotContact | null;
  company?: HubspotCompany | null;
  deal?: HubspotDeal | null;
  recIssue?: JiraRecIssue | null;
}

function classify(
  externals: CalendarAttendee[],
  contactsByEmail: Map<string, HubspotContact>,
  companiesById: Map<string, HubspotCompany>,
  companiesByDomain: Map<string, HubspotCompany>,
  dealsByContact: Map<string, HubspotDeal[]>,
  dealsByCompany: Map<string, HubspotDeal[]>,
  recIssues: JiraRecIssue[],
  partnerDomains: Set<string>,
  pipelineLabels: Map<string, string>,
): ClassResult {
  // 1. Recruitment
  for (const a of externals) {
    if (a.email && recIssues.some(r => (r.assignee_email ?? "").toLowerCase() === a.email!.toLowerCase())) {
      const r = recIssues.find(r => (r.assignee_email ?? "").toLowerCase() === a.email!.toLowerCase())!;
      return { category: "recruitment", reason: "rec_assignee_email", recIssue: r };
    }
    const name = normalizeName(a.name ?? (a.email ?? "").split("@")[0]);
    if (!name || name.length < 3) continue;
    const tokens = name.split(/\s+/).filter(t => t.length >= 3);
    if (tokens.length === 0) continue;
    const hit = recIssues.find(r => {
      const sum = normalizeName(r.summary ?? "");
      return tokens.every(t => sum.includes(t));
    });
    if (hit) return { category: "recruitment", reason: "rec_name_match", recIssue: hit };
  }

  // 2. Partner — domain
  for (const a of externals) {
    const dom = (a.email ?? "").split("@")[1]?.toLowerCase();
    if (dom && partnerDomains.has(dom)) {
      return { category: "partner", reason: "partner_domain" };
    }
  }

  // 3-5. HubSpot
  let contact: HubspotContact | null = null;
  for (const a of externals) {
    const c = contactsByEmail.get((a.email ?? "").toLowerCase());
    if (c) { contact = c; break; }
  }
  let company: HubspotCompany | null = null;
  if (contact?.associated_company_id) company = companiesById.get(contact.associated_company_id) ?? null;
  if (!company && externals[0]?.email) {
    const dom = externals[0].email.split("@")[1]?.toLowerCase();
    if (dom && companiesByDomain.has(dom)) company = companiesByDomain.get(dom)!;
  }
  let deals: HubspotDeal[] = [];
  if (contact?.contact_id) deals = dealsByContact.get(contact.contact_id) ?? [];
  if (deals.length === 0 && company?.company_id) deals = dealsByCompany.get(company.company_id) ?? [];

  const customerDeal = deals.find(d => d.pipeline_id === CUSTOMER_BASE_PIPELINE_ID);
  if (customerDeal) {
    return { category: "customer", reason: "customer_base_deal", contact, company, deal: customerDeal };
  }
  const salesDeal = deals.find(d => {
    if (d.pipeline_id === SALES_PIPELINE_ID) return true;
    const lbl = pipelineLabels.get(d.pipeline_id ?? "") ?? "";
    return lbl.toLowerCase().startsWith("leads");
  });
  if (salesDeal) {
    return { category: "sales", reason: "sales_pipeline_deal", contact, company, deal: salesDeal };
  }
  if (contact || company) {
    return { category: "lead", reason: contact ? "contact_no_deal" : "company_no_contact", contact, company };
  }
  return { category: "onbekend", reason: "no_match" };
}

interface BuiltProposal {
  actions: Array<{ type: string; label: string; payload: Record<string, unknown> }>;
  subject: string;
  summary: string;
  needsInfo: boolean;
  confidence: number;
  category: Category;
}

function buildProposal(
  ev: CalendarEvent,
  externals: CalendarAttendee[],
  cls: ClassResult,
  propMap: Record<string, string>,
): BuiltProposal | null {
  const startDate = fmtDate(ev.start_time);
  const isPast = new Date(ev.start_time).getTime() < Date.now();
  const subjectShort = (ev.subject ?? "(zonder titel)").slice(0, 80);
  const externalSummary = externals.map(a => a.name ?? a.email ?? "?").filter(Boolean).slice(0, 4).join(", ");
  const att0 = externals[0];
  const domain = (att0?.email ?? "").split("@")[1]?.toLowerCase() ?? null;
  const actions: BuiltProposal["actions"] = [];

  if (cls.category === "partner") {
    return null; // filter
  }

  if (cls.category === "recruitment" && cls.recIssue) {
    actions.push({
      type: "jira",
      label: `Comment op ${cls.recIssue.issue_key}: kennismaking gepland`,
      payload: {
        issueKey: cls.recIssue.issue_key,
        operation: "comment",
        description: `Kennismaking ingepland: ${fmtDateTimeNL(ev.start_time)}${ev.location_text ? ` op ${ev.location_text}` : (ev.online_meeting_url ? " via Teams" : "")}.\n\nDeelnemers: ${externalSummary || "—"}.`,
      },
    });
    return {
      actions,
      subject: `${cls.recIssue.summary || "Kandidaat"} — kennismaking ${fmtDateTimeNL(ev.start_time)}`,
      summary: `Recruitment-kennismaking gevonden via Jira REC-issue ${cls.recIssue.issue_key} ("${cls.recIssue.summary}", status ${cls.recIssue.status}). Voorstel: comment op de REC-card met de afspraakdatum, geen HubSpot-actie.`,
      needsInfo: false,
      confidence: 0.85,
      category: "recruitment",
    };
  }

  if (cls.category === "customer" && cls.deal) {
    const props = (cls.deal.properties ?? {}) as Record<string, unknown>;
    const existing = props[propMap.kennismaking_datum];
    if (existing && String(existing).slice(0, 10) === startDate) return null;
    actions.push({
      type: "deal_property_update",
      label: `Property: ${propMap.kennismaking_datum} = ${startDate} (op bestaande Customer-deal)`,
      payload: { deal_id: cls.deal.deal_id, property: propMap.kennismaking_datum, value: startDate, attach_to_new_deal: false },
    });
    return {
      actions,
      subject: `Kennismaking ${cls.deal.dealname ?? cls.company?.name ?? ""} — ${fmtDateTimeNL(ev.start_time)}`.trim(),
      summary: `Bestaande Customer Base-deal "${cls.deal.dealname}". Voorstel: kennismaking-datum invullen op deze deal — geen nieuwe deal aanmaken.`,
      needsInfo: false,
      confidence: 0.9,
      category: "customer",
    };
  }

  if (cls.category === "sales" && cls.deal) {
    const props = (cls.deal.properties ?? {}) as Record<string, unknown>;
    const existing = props[propMap.kennismaking_datum];
    if (existing && String(existing).slice(0, 10) === startDate) return null;
    actions.push({
      type: "deal_property_update",
      label: `Property: ${propMap.kennismaking_datum} = ${startDate} (op bestaande deal)`,
      payload: { deal_id: cls.deal.deal_id, property: propMap.kennismaking_datum, value: startDate, attach_to_new_deal: false },
    });
    if (cls.deal.dealstage !== KENNISMAKING_STAGE && cls.deal.pipeline_id === SALES_PIPELINE_ID && !isPast) {
      actions.push({
        type: "stage",
        label: `Stage → Kennismaking gepland`,
        payload: {
          deal_id: cls.deal.deal_id,
          pipeline: SALES_PIPELINE_ID,
          dealstage: KENNISMAKING_STAGE,
          from_stage: cls.deal.dealstage,
          from_pipeline: cls.deal.pipeline_id,
        },
      });
    }
    return {
      actions,
      subject: `Kennismaking ${cls.deal.dealname ?? cls.company?.name ?? ""} — ${fmtDateTimeNL(ev.start_time)}`.trim(),
      summary: `Bestaande Sales/Leads-deal "${cls.deal.dealname}". Voorstel: kennismaking-datum invullen, eventueel stage updaten.`,
      needsInfo: false,
      confidence: 0.9,
      category: "sales",
    };
  }

  // Lead — contact bekend, geen deal
  if (cls.category === "lead") {
    if (!cls.company && domain) {
      actions.push({
        type: "company",
        label: `Company: ${domain}`,
        payload: { name: domain, domain, industry: null, num_employees: null, city: null },
      });
    }
    const dealname = cls.company?.name ?? domain ?? att0?.email ?? "Nieuwe prospect";
    actions.push({
      type: "deal",
      label: `Deal: ${dealname} · Sales Pipeline · Kennismaking ${isPast ? "plaatsgevonden" : "gepland"}`,
      payload: {
        dealname, pipeline: SALES_PIPELINE_ID, dealstage: KENNISMAKING_STAGE, amount: null,
        attach_to_company_id: cls.company?.company_id ?? null,
        attach_to_company_domain: cls.company ? null : domain,
        attach_to_contact_id: cls.contact?.contact_id ?? null,
      },
    });
    actions.push({
      type: "deal_property_update",
      label: `Property: ${propMap.kennismaking_datum} = ${startDate}`,
      payload: { deal_id: null, property: propMap.kennismaking_datum, value: startDate, attach_to_new_deal: true },
    });
    if (cls.company?.num_employees) {
      const omvang = guessVerwachteOmvang(cls.company.num_employees);
      if (omvang) {
        actions.push({
          type: "deal_property_update",
          label: `Property: ${propMap.verwachte_omvang} = ${omvang}`,
          payload: { deal_id: null, property: propMap.verwachte_omvang, value: omvang, attach_to_new_deal: true },
        });
      }
      actions.push({
        type: "deal_property_update",
        label: `Property: ${propMap.verwachte_kantooromvang} = ${cls.company.num_employees}`,
        payload: { deal_id: null, property: propMap.verwachte_kantooromvang, value: cls.company.num_employees, attach_to_new_deal: true },
      });
    }
    return {
      actions,
      subject: `Kennismaking ${cls.company?.name ?? domain ?? subjectShort} — ${fmtDateTimeNL(ev.start_time)}`,
      summary: `Contact gevonden in HubSpot, maar geen deal in Sales/Customer-pipeline. Voorstel: nieuwe deal in Sales Pipeline + kennismaking-datum.`,
      needsInfo: false,
      confidence: 0.7,
      category: "lead",
    };
  }

  // Onbekend
  if (cls.category === "onbekend" && att0) {
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
    actions.push({ type: "company", label: `Company: ${domain ?? "(onbekend)"}`, payload: { name: domain, domain, industry: null, num_employees: null, city: null } });
    actions.push({ type: "contact", label: `Contact: ${att0.name ?? att0.email}`, payload: contactPayload(att0) });
    for (const a of externals.slice(1, 4)) {
      actions.push({ type: "contact", label: `Contact: ${a.name ?? a.email}`, payload: contactPayload(a) });
    }
    actions.push({
      type: "deal",
      label: `Deal: ${domain ?? att0.email} · Sales Pipeline · Kennismaking ${isPast ? "plaatsgevonden" : "gepland"}`,
      payload: {
        dealname: domain ?? att0.email ?? "Nieuwe prospect",
        pipeline: SALES_PIPELINE_ID, dealstage: KENNISMAKING_STAGE, amount: null,
        attach_to_company_domain: domain, attach_to_contact_email: att0.email,
      },
    });
    actions.push({
      type: "deal_property_update",
      label: `Property: ${propMap.kennismaking_datum} = ${startDate}`,
      payload: { deal_id: null, property: propMap.kennismaking_datum, value: startDate, attach_to_new_deal: true },
    });
    return {
      actions,
      subject: `Kennismaking ${domain ?? subjectShort} — ${fmtDateTimeNL(ev.start_time)}`,
      summary: `Geen match in HubSpot, Jira-REC of partner-list. Voorstel onder voorbehoud: company + contact + deal aanmaken zodat Power BI-rapportage compleet is. Categorie staat op 'onbekend' — bevestig of dit klant of ander type is.`,
      needsInfo: true,
      confidence: 0.4,
      category: "onbekend",
    };
  }

  return null;
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
  const stats: Record<string, unknown> = {
    schema_version: "1",
    skill_version: SKILL_VERSION,
    triggered_by: triggeredBy,
    triggered_at: startedAt,
    counts: {
      calendar_events_scanned: 0,
      events_with_externals: 0,
      kennismaking_keyword_hits: 0,
      external_location_hits: 0,
      classified_recruitment: 0,
      classified_customer: 0,
      classified_sales: 0,
      classified_lead: 0,
      classified_partner: 0,
      classified_onbekend: 0,
      proposals_created: 0,
      events_skipped_already_proposed: 0,
      events_skipped_complete: 0,
      events_skipped_partner: 0,
    },
    warnings: [] as string[],
  };
  const counts = (stats.counts as Record<string, number>);

  const { data: runIns, error: runErr } = await supabase.from("agent_runs").insert({
    agent_name: "daily-admin-future", run_type: "edge_function", status: "running",
    started_at: startedAt, stats, errors: [],
  }).select("id").single();
  if (runErr || !runIns) {
    return new Response(JSON.stringify({ error: `run_record_create_failed: ${runErr?.message}` }), { status: 500 });
  }
  const runId = runIns.id as string;

  try {
    const propMapRaw = await getCfg(supabase, "daily-admin-future", "property_mapping");
    const propMap = { ...DEFAULT_PROPERTY_MAPPING, ...(propMapRaw as Record<string, string> ?? {}) };

    const partnerDomainsRaw = await getCfg(supabase, "daily-admin", "partner_domains");
    const partnerDomains = new Set<string>(
      (Array.isArray(partnerDomainsRaw)
        ? partnerDomainsRaw as unknown[]
        : ((partnerDomainsRaw as { domains?: unknown[] } | null)?.domains ?? []))
        .map(d => String(d).toLowerCase())
    );

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
    counts.calendar_events_scanned = eventsList.length;

    // 2. Attendees voor alle events in window
    const eventIds = eventsList.map(e => e.id);
    const attMap = new Map<string, CalendarAttendee[]>();
    if (eventIds.length > 0) {
      const { data: attendees, error: atErr } = await supabase
        .from("calendar_attendees")
        .select("calendar_event_id,email,name,attendee_type,is_organizer")
        .in("calendar_event_id", eventIds);
      if (atErr) throw new Error(`calendar_attendees_fetch_failed: ${atErr.message}`);
      for (const a of (attendees ?? []) as CalendarAttendee[]) {
        if (!a.calendar_event_id) continue;
        if (!attMap.has(a.calendar_event_id)) attMap.set(a.calendar_event_id, []);
        attMap.get(a.calendar_event_id)!.push(a);
      }
    }

    // 3. Filter op events met externe deelnemers
    const eventsWithExt = eventsList
      .map(e => ({ event: e, externals: (attMap.get(e.id) ?? []).filter(isExternalAttendee) }))
      .filter(x => x.externals.length > 0);
    counts.events_with_externals = eventsWithExt.length;
    counts.kennismaking_keyword_hits = eventsWithExt.filter(x => hasKennismakingKeyword(x.event)).length;
    counts.external_location_hits = eventsWithExt.filter(x => x.event.location_text && !x.event.online_meeting_url).length;

    if (eventsWithExt.length === 0) {
      await supabase.from("agent_runs").update({
        status: "success", completed_at: new Date().toISOString(),
        summary: "Geen externe afspraken in de eerstvolgende 28 dagen.", stats,
      }).eq("id", runId);
      await supabase.from("agent_schedules").update({ last_run_at: new Date().toISOString(), manual_run_requested_at: null }).eq("agent_name", "daily-admin-future");
      return new Response(JSON.stringify({ ok: true, runId, stats }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    // 4. Lookups: HubSpot + Jira-REC + pipelines
    const allEmails = Array.from(new Set(
      eventsWithExt.flatMap(x => x.externals.map(a => (a.email ?? "").toLowerCase())).filter(Boolean)
    ));
    const allDomains = Array.from(new Set(allEmails.map(e => e.split("@")[1]).filter(Boolean)));

    const [contactsR, recIssuesR, pipelinesR] = await Promise.all([
      allEmails.length > 0
        ? supabase.from("hubspot_contacts")
            .select("contact_id,email,firstname,lastname,jobtitle,associated_company_id,lifecyclestage")
            .in("email", allEmails).eq("is_archived", false)
        : Promise.resolve({ data: [] as HubspotContact[], error: null }),
      supabase.from("jira_issues")
        .select("issue_key,summary,status,status_category,assignee_email")
        .eq("project_key", "REC").neq("status_category", "done").limit(200),
      supabase.from("hubspot_pipelines").select("pipeline_id,label"),
    ]);
    const contacts = (contactsR.data ?? []) as HubspotContact[];
    const recIssues = (recIssuesR.data ?? []) as JiraRecIssue[];
    const pipelineLabels = new Map<string, string>(
      ((pipelinesR.data ?? []) as Array<{ pipeline_id: string; label: string }>).map(p => [p.pipeline_id, p.label])
    );

    const contactsByEmail = new Map<string, HubspotContact>();
    for (const c of contacts) if (c.email) contactsByEmail.set(c.email.toLowerCase(), c);

    const companiesById = new Map<string, HubspotCompany>();
    const companiesByDomain = new Map<string, HubspotCompany>();
    const wantedCompanyIds = Array.from(new Set(
      contacts.map(c => c.associated_company_id).filter(Boolean) as string[]
    ));
    if (wantedCompanyIds.length > 0 || allDomains.length > 0) {
      const orParts: string[] = [];
      if (wantedCompanyIds.length > 0) orParts.push(`company_id.in.(${wantedCompanyIds.join(",")})`);
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

    const dealsByContact = new Map<string, HubspotDeal[]>();
    const dealsByCompany = new Map<string, HubspotDeal[]>();
    const contactIdList = contacts.map(c => c.contact_id);
    const companyIdList = Array.from(companiesById.keys());
    if (contactIdList.length > 0 || companyIdList.length > 0) {
      const orParts: string[] = [];
      if (contactIdList.length > 0) orParts.push(`associated_contact_ids.ov.{${contactIdList.join(",")}}`);
      if (companyIdList.length > 0) orParts.push(`associated_company_ids.ov.{${companyIdList.join(",")}}`);
      const { data: deals, error: dErr } = await supabase
        .from("hubspot_deals")
        .select("deal_id,dealname,dealstage,pipeline_id,amount,closedate,associated_company_ids,associated_contact_ids,properties")
        .or(orParts.join(",")).eq("is_archived", false);
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

    // 5. Bestaande open proposals — dedup op calendar_event_id
    const { data: existingProps } = await supabase
      .from("agent_proposals").select("id,context,status")
      .eq("agent_name", "daily-admin-future").in("status", ["pending", "amended", "accepted"]);
    const existingByEvent = new Set<string>();
    for (const p of existingProps ?? []) {
      const ctx = (p.context ?? {}) as { calendar_event_id?: string };
      if (ctx.calendar_event_id) existingByEvent.add(ctx.calendar_event_id);
    }

    // 6. Per event classifier + voorstel
    const proposalsToInsert: Array<Record<string, unknown>> = [];
    for (const { event, externals } of eventsWithExt) {
      if (existingByEvent.has(event.id)) {
        counts.events_skipped_already_proposed++;
        continue;
      }
      const cls = classify(externals, contactsByEmail, companiesById, companiesByDomain, dealsByContact, dealsByCompany, recIssues, partnerDomains, pipelineLabels);
      const catKey = `classified_${cls.category}` as keyof typeof counts;
      counts[catKey] = (counts[catKey] ?? 0) + 1;

      if (cls.category === "partner") { counts.events_skipped_partner++; continue; }

      const built = buildProposal(event, externals, cls, propMap);
      if (!built) { counts.events_skipped_complete++; continue; }

      const expiresAt = new Date(Date.now() + PROPOSAL_EXPIRY_DAYS * 86400_000).toISOString();
      const categoryToProposalCat: Record<Category, string> = {
        recruitment: "recruitment", customer: "klant", sales: "klant",
        lead: "klant", partner: "overig", onbekend: "overig",
      };
      proposalsToInsert.push({
        agent_name: "daily-admin-future",
        category: categoryToProposalCat[cls.category],
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
          future_category: cls.category,
          future_reason: cls.reason,
          deal_id: cls.deal?.deal_id ?? null,
          pipeline: cls.deal?.pipeline_id ?? SALES_PIPELINE_ID,
          pipeline_stage: cls.deal?.dealstage ?? KENNISMAKING_STAGE,
          company_id: cls.company?.company_id ?? null,
          contact_id: cls.contact?.contact_id ?? null,
          jira_key: cls.recIssue?.issue_key ?? null,
        },
        status: "pending",
        needs_info: built.needsInfo,
        confidence: built.confidence,
        expires_at: expiresAt,
      });
    }

    if (proposalsToInsert.length > 0) {
      const { error: insErr } = await supabase.from("agent_proposals").insert(proposalsToInsert);
      if (insErr) throw new Error(`proposals_insert_failed: ${insErr.message}`);
      counts.proposals_created = proposalsToInsert.length;
    }

    await setCfg(supabase, "daily-admin-future", "state", { last_processed_at: new Date().toISOString() });
    await supabase.from("agent_schedules").update({
      last_run_at: new Date().toISOString(), manual_run_requested_at: null,
    }).eq("agent_name", "daily-admin-future");

    const summary = `${counts.events_with_externals} externe events · cat: rec=${counts.classified_recruitment} cust=${counts.classified_customer} sales=${counts.classified_sales} lead=${counts.classified_lead} partner=${counts.classified_partner} onbekend=${counts.classified_onbekend} · ${counts.proposals_created} voorstellen, ${counts.events_skipped_already_proposed} al-open, ${counts.events_skipped_partner} partner-skip.`;
    await supabase.from("agent_runs").update({
      status: "success", completed_at: new Date().toISOString(), summary, stats,
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
