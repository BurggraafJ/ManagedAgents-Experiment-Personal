// daily-admin-future v1.16 — Edge Function
//
// v1.16 (2026-05-06):
//   - Recruitment-flow gesplitst van sales/leads. Recruitment-events
//     krijgen GEEN agent_proposals-rij meer (geen "Goedkeuren"-card,
//     geen kennismakingen-tabel-vermelding); skill schrijft ze in plaats
//     daarvan naar de aparte tabel `recruitment_meetings`. De Toekomst-
//     tab toont ze in een eigen sectie. Reden: kennismakingen-bucket gaat
//     puur over sales/leads — kandidaten-flow loopt via Recruitment Kanban
//     en zit nu netjes in een eigen tabel.
//   - Filter `non_sales_meeting` skipt nu ook events die door de
//     classifier op `recruitment` uitkomen — die worden via de
//     recruitment-tak afgehandeld, niet via skip.
//
// v1.13 (2026-05-05):
//   - HubSpot custom-property fetch via Composio REST proxy. Voor elke
//     gematchte deal_id (customer/sales/lead) haalt skill kennismaking_
//     datum op en cached in hubspot_deal_property_cache.
//   - Auto-voorstel bij ontbrekende of mismatched kennismaking_datum:
//     Customer Base-deals worden niet meer geskipt als de datum-property
//     leeg is of niet matcht event-datum — dan komt er ALSNOG een
//     voorstel onder Goedkeuren. Power BI-data klopt dan automatisch.
//   - Bij lead/onbekend-trio (company + contact + deal aanmaken) wordt
//     er ook een NOTE-actie toegevoegd met meta: deal_owner-suggestie,
//     pipeline + stage, datum + locatie + deelnemers — zodat de note
//     direct op de nieuwe deal klaar staat.
//
// v1.12 (2026-05-05): soft cross-agent dedup, kennismaking_datum kolom
// in tabel + cache-tabel hubspot_deal_property_cache.
//
// v1.11 (2026-05-05):
//   - Pipeline-fix: future-flow zit per definitie in toekomst, dus de
//     skill plaatst alle nieuwe lead/onbekend-deals in
//     **Leads (non-campaign) + Kennismaking gepland**. Sales Pipeline
//     (default) heeft GEEN "gepland"-stage; alleen "plaatsgevonden",
//     en die past niet voor afspraken die nog moeten komen.
//   - Cross-agent dedup: vóór INSERT check of er al een open proposal
//     bestaat (daily-admin OF daily-admin-future) met overlap in
//     attendee-emails / domain / deal_id. Marktlink-fix: voorkomt dat
//     beide skills eigen voorstel maken voor zelfde afspraak.
//   - Pipeline_label + stage_label expliciet in context jsonb opgenomen
//     zodat de UI niet hoeft te resolven via pipelineLookup.
//
// v1.10 (2026-05-05): subject-keyword filter voor niet-sales meetings.
// Aandeelhoudersvergaderingen, strategische sessies, stuurgroepen,
// boardmeetings en interne reviews zijn externe events maar GEEN sales-
// kandidaten. Skip met counts.events_skipped_non_sales_meeting zodat ze
// niet als kennismaking voorstel komen.
//
// v1.9 (2026-05-05): pipeline-keuze per lead/onbekend.
//   - Lead met substantial mail/engagement-context (RAG) → Sales Pipeline
//     (default) + stage 'appointmentscheduled' (er is al communicatie).
//   - Lead/onbekend zonder mail-context → Leads (non-campaign) pipeline +
//     stage 'Kennismaking gepland'. De skill kiest tussen Paddles, Website,
//     non-campaign en Leadinfo op basis van bron-signalen (default:
//     non-campaign).
//   - Customer en Sales worden ongewijzigd gelaten (al bestaande deal).
//
// v1.8 (2026-05-05): events die Jelle expliciet weggeklikt heeft via de
// dashboard-knop "Niet meer tonen" worden geskipt. Tabel
// daily_admin_future_dismissed bevat de calendar_event_ids — skill leest
// die set bij elke run.
//
// v1.7 (2026-05-05) wijzigingen t.o.v. v1.6:
//   - Filter-laag toegevoegd vóór proposal-creatie. Alleen ECHTE
//     twijfelgevallen worden voorstellen — events waar de relatie al
//     loopt (Customer Base, Sales-deal voorbij kennismaking, personal
//     domain, of Lead met al ingeplande kennismaking) worden geskipt.
//     Skips komen wél in run-stats per reden, maar niet in
//     agent_proposals — Jelle moet alleen beslissen waar twijfel is.
//
// v1.6 (2026-05-05): RAG-lookup via context-build voor onbekend-events;
// top-3 matches in summary, bundle_id voor R.7-link; heuristiek voor
// upgrade onbekend → lead bij eerder mail/event-contact.
//
// v1.5 (2026-05-05): detectie verbreed naar alle externe-attendee
// events; categorie-classifier (recruitment/customer/sales/lead/partner/
// onbekend) via Jira REC + HubSpot deal-pipeline + partner_domains.
//
// Auth: Bearer cron_secret OR service-role key.
// Trigger: pg_cron (`0 7 * * 1-5`) of dashboard manual run via
// agent_schedules.manual_run_requested_at + orchestrator.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SKILL_VERSION = "daily-admin-future-v1.16";
const COMPOSIO_PROXY_URL = "https://backend.composio.dev/api/v2/actions/proxy";
const COMPOSIO_FETCH_TIMEOUT_MS = 6000;

// Subject-keywords die "geen sales-kennismaking" signaleren. Externe
// attendees zijn dan vaak adviseurs/aandeelhouders/strategie-collega's,
// niet prospects. Lowercase substring-match op subject + body_preview.
const NON_SALES_KEYWORDS = [
  "aandeelhouder", "shareholder", "ava ",  // Algemene Vergadering Aandeelhouders
  "stuurgroep", "raad van advies", "raad van bestuur", "rvc ", "rvb ",
  "boardmeeting", "board meeting", "board call",
  "blue ocean", "strategische sessie", "strategie sessie", "strategy session",
  "kickoff", "kick-off", "all-hands", "all hands", "town hall",
  "review meeting", "retrospective", "retro ",
  "team building", "teambuilding", "offsite",
  "intern overleg", "internal meeting",
];

function isNonSalesMeeting(ev: CalendarEvent): boolean {
  const hay = `${ev.subject ?? ""} ${ev.body_preview ?? ""}`.toLowerCase();
  return NON_SALES_KEYWORDS.some(k => hay.includes(k));
}

// Leads-pipelines voor echt nieuwe contacten (geen mail-historie). Skill
// kiest tussen deze als er geen substantial RAG-mail-context is.
const LEADS_NON_CAMPAIGN_PIPELINE = "2562718926";
const LEADS_NON_CAMPAIGN_STAGE_GEPLAND = "3504565487"; // "Kennismaking gepland"
const LEADS_WEBSITE_PIPELINE = "3534570692";
const LEADS_WEBSITE_STAGE_GEPLAND = "4839586031"; // "Kennismaking gepland"
const LEADS_PADDLES_PIPELINE = "2557844668";
const LEADS_PADDLES_STAGE_GEPLAND = "3499060457"; // "Kennismaking gepland"
const CONTEXT_BUILD_URL = "https://ezxihctobrqoklufawim.supabase.co/functions/v1/context-build";
const RAG_TOP_K = 3;
const RAG_TIMEOUT_MS = 8000;

// Sales Pipeline-stages waarvan kennismaking al heeft plaatsgevonden of
// de deal voorbij is. Bij match: skip, want voorstel om kennismaking_datum
// te zetten heeft geen waarde meer.
const SALES_STAGES_PAST_KENNISMAKING = new Set([
  "4077073627",  // Offerte sturen
  "3206386936",  // Offerte gestuurd
  "contractsent",
  "4075158742",  // Licentieovereenkomst gestuurd
  "3453858021",  // Gesloten & Gescoord
  "3206386937",  // Afgevallen na demo
  "3206387898",  // Backburner na demo
  "4984103151",  // Afgevallen 1-pitters
]);

// Personal e-mail domains — events met deze externe attendees als enige
// 'externe' partij zijn meestal privé/familie en geen kennismaking.
const PERSONAL_DOMAINS = new Set([
  "gmail.com", "hotmail.com", "hotmail.nl", "outlook.com", "live.nl",
  "ziggo.nl", "kpn.nl", "planet.nl", "xs4all.nl", "icloud.com", "me.com",
]);
const FUTURE_WINDOW_DAYS = 90; // 3 maanden vooruit voor demo's en geplande sales
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
// =====
// RAG-helper — context-build aanroepen voor onbekend-events.
// Retourneert top-K matches + bundle_id + sentinel voor mogelijke re-classify.
// Faalt softly: bij timeout/fout retourneert null en de skill gaat door
// zonder RAG-context (logt warning in stats).
// =====
interface RagMatch {
  source: string;
  preview: string | null;
  similarity: number | null;
  occurred_at: string | null;
  metadata: Record<string, unknown> | null;
}
interface RagResult {
  bundleId: string | null;
  matches: RagMatch[];
}

async function ragLookup(
  cronSecret: string,
  query: string,
  options: Record<string, unknown>,
): Promise<RagResult | null> {
  if (!cronSecret) return null;
  if (!query || query.length < 2) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), RAG_TIMEOUT_MS);
    const res = await fetch(CONTEXT_BUILD_URL, {
      method: "POST",
      headers: { "Authorization": `Bearer ${cronSecret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "enrich_record",
        audience: "daily-admin-future",
        trigger_type: "calendar_event",
        query_text: query.slice(0, 500),
        options: { top_k: RAG_TOP_K, ...options },
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json() as { ok?: boolean; bundle_id?: string; matches?: RagMatch[] };
    if (!json.ok) return null;
    return { bundleId: json.bundle_id ?? null, matches: (json.matches ?? []).slice(0, RAG_TOP_K) };
  } catch {
    return null;
  }
}

// Bundel matches in een korte tekst voor in de proposal-summary.
function ragSnippet(matches: RagMatch[]): string {
  if (matches.length === 0) return "";
  const lines = matches.map((m, i) => {
    const date = m.occurred_at ? new Date(m.occurred_at).toLocaleDateString("nl-NL") : "";
    const head = `[${i + 1}] ${m.source}${date ? ` · ${date}` : ""}`;
    const body = (m.preview ?? "").trim().replace(/\s+/g, " ").slice(0, 160);
    return `${head} — ${body}`;
  });
  return `\n\nRAG-context (top-${matches.length}):\n${lines.join("\n")}`;
}

// Heuristiek voor automatische re-classify op basis van RAG-resultaten.
// Top-match in mail/engagements/fireflies = signaal van eerder contact →
// upgrade naar 'lead' (we hebben een gespreks-historie, dus dit is geen
// volledig nieuwe prospect).
function ragHintsAtLead(matches: RagMatch[]): boolean {
  if (matches.length === 0) return false;
  const top = matches[0];
  // Combined-score threshold (vector + recency + bm25). In productie liggen
  // top-scores rond 0.22-0.30 omdat min_similarity in match_chunks al filtert.
  // We willen liever te ruim upgraden dan te streng — een onbekend-event
  // upgraden naar 'lead' is laag-risico (Jelle ziet de RAG-context en kan
  // alsnog weigeren).
  if ((top.similarity ?? 0) < 0.20) return false;
  const sourceTypes = new Set(matches.map(m => m.source));
  // chunks-tabel source-namen (single, geen 'hubspot_'-prefix):
  // mail / engagement / event / meeting / contact / company / deal / jira / lesson
  return sourceTypes.has("mail")
      || sourceTypes.has("engagement")
      || sourceTypes.has("meeting")
      || sourceTypes.has("event");
}

// =====
// v1.7 Filter-laag: alleen echte twijfelgevallen worden voorstellen.
// Events waar de relatie al loopt (Customer Base klant, Sales-deal voorbij
// kennismaking, personal domain, lead met kennismaking_datum al ingevuld)
// worden geskipt. Skip-reden komt in run-stats; geen rij in agent_proposals.
// =====
interface SkipResult {
  skip: boolean;
  reason: string; // human-friendly key, bv 'customer_base_already_onboarded'
}

function shouldSkipProposal(
  event: CalendarEvent,
  externals: CalendarAttendee[],
  cls: ClassResult,
  ragMatches: RagMatch[],
  propMap: Record<string, string>,
  cachedDatum: string | null = null,
): SkipResult {
  // 0. Niet-sales meeting (aandeelhoudersvergadering, strategie-sessie,
  // stuurgroep, boardmeeting, etc.) → skip. Externe attendees zijn dan
  // adviseurs/aandeelhouders, geen prospects.
  if (isNonSalesMeeting(event)) {
    return { skip: true, reason: "non_sales_meeting" };
  }

  // 1. Customer Base — klant is al binnen. kennismaking_datum is een
  // ÉÉNMALIGE property: gevuld bij eerste kennismaking, daarna nooit
  // overschrijven. Skip wanneer de property al een datum heeft (ongeacht
  // welke). ALLEEN als de property leeg is, fall-through naar
  // buildProposal die een datum-vul-voorstel genereert.
  if (cls.category === "customer") {
    if (cachedDatum && cachedDatum.length >= 8) {
      return { skip: true, reason: "customer_already_onboarded" };
    }
    // datum is null/leeg → voorstel maken (eerste vulling)
  }

  // 2. Sales-deal in stage al voorbij kennismaking → skip
  if (cls.category === "sales" && cls.deal) {
    if (cls.deal.dealstage && SALES_STAGES_PAST_KENNISMAKING.has(cls.deal.dealstage)) {
      return { skip: true, reason: "sales_past_kennismaking_stage" };
    }
    // Sales-deal mét kennismaking_datum al ingevuld op deze datum → al gedaan
    const props = (cls.deal.properties ?? {}) as Record<string, unknown>;
    const existing = props[propMap.kennismaking_datum];
    if (existing && String(existing).slice(0, 10) === fmtDate(event.start_time)) {
      return { skip: true, reason: "sales_kennismaking_datum_already_set" };
    }
  }

  // 3. Recruitment — REC-card update is altijd gewenst, geen skip
  // (recruitment events willen we wel altijd vastleggen)

  // 4. Personal domains — alle externe attendees @gmail/@hotmail/etc.
  // Of organizer = Jelle én alle externals zijn personal-domain → skip.
  const allPersonal = externals.every(a => {
    const dom = (a.email ?? "").split("@")[1]?.toLowerCase() ?? "";
    return PERSONAL_DOMAINS.has(dom);
  });
  if (allPersonal && externals.length > 0) {
    return { skip: true, reason: "personal_or_family_domain" };
  }

  // 5. Lead/onbekend met substantial RAG-historie waar event al ingepland is.
  // Heuristiek: top-match in 'event' source (= eerder calendar-event) met
  // similarity ≥ 0.25 betekent dat de afspraak al lang in beweging is — de
  // kennismaking IS deze meeting, niet iets nieuws om vooraf in HubSpot in
  // te plannen. Lead-flow is dan geen voorstel maar 'reeds in beweging'.
  if ((cls.category === "lead" || cls.category === "onbekend") && ragMatches.length >= 2) {
    const eventMatches = ragMatches.filter(m => m.source === "event").length;
    const top = ragMatches[0];
    if (eventMatches >= 1 && (top?.similarity ?? 0) >= 0.25) {
      return { skip: true, reason: "lead_already_in_motion" };
    }
  }

  return { skip: false, reason: "" };
}

// =====
// Pipeline-keuze voor nieuwe lead/onbekend-events:
// - Substantial mail/engagement-context (RAG) → Sales Pipeline + stage
//   'appointmentscheduled' (er is al communicatie geweest, deze afspraak
//   zit verder dan een rauwe lead).
// - Geen mail-context, alleen agenda → Leads (non-campaign) + 'Kennismaking
//   gepland' (echt eerste contact, hoort nog in leads-funnel).
// Verfijning: bron-signalen voor Paddles / Website / Leadinfo zijn niet
// betrouwbaar te detecteren uit de agenda alleen — Jelle kan in dashboard
// de pipeline corrigeren als de skill verkeerd kiest.
// =====
interface PipelineChoice {
  pipeline: string;
  stage: string;
  pipelineLabel: string;
  stageLabel: string;
  reason: string;
}

function pickLeadPipeline(ragMatches: RagMatch[]): PipelineChoice {
  // Future-flow per definitie: scope = events met start_time >= NOW(),
  // dus elke afspraak moet nog komen. Sales Pipeline (default) heeft
  // alleen "Kennismaking plaatsgevonden" als stage en NIET "gepland",
  // dus daar past dit niet in. Leads (non-campaign) + "Kennismaking
  // gepland" is de juiste landing-zone, ongeacht of er al mail-historie
  // is of niet. Mail-historie (RAG) komt wel terug in de summary als
  // hint, en Jelle kan altijd amenden naar Sales Pipeline als hij vindt
  // dat de deal verder is.
  const hasMailHistory = ragMatches.some(m =>
    (m.source === "mail" || m.source === "engagement") && (m.similarity ?? 0) >= 0.20
  );
  return {
    pipeline: LEADS_NON_CAMPAIGN_PIPELINE,
    stage: LEADS_NON_CAMPAIGN_STAGE_GEPLAND,
    pipelineLabel: "Leads (non-campaign)",
    stageLabel: "Kennismaking gepland",
    reason: hasMailHistory ? "lead_with_mail_history" : "fresh_lead_no_history",
  };
}

// =====
// HubSpot Composio fetch — custom-property kennismaking_datum batch.
// Voor elke deal_id roept skill Composio aan (REST proxy) en cached
// het resultaat in hubspot_deal_property_cache. Niet-blokkerend: bij
// timeout/error retourneert null en gaan we door zonder cache-update.
// =====
async function fetchKennismakingDatum(
  composioApiKey: string,
  connectedAccountId: string,
  dealId: string,
): Promise<string | null> {
  if (!composioApiKey || !dealId) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), COMPOSIO_FETCH_TIMEOUT_MS);
    const res = await fetch(COMPOSIO_PROXY_URL, {
      method: "POST",
      headers: {
        "x-api-key": composioApiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        connectedAccountId,
        endpoint: `/crm/v3/objects/deals/${dealId}?properties=kennismaking_datum,verwachte_omvang,verwachte_kantooromvang`,
        method: "GET",
      }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = await res.json() as { data?: { properties?: Record<string, string> } };
    const props = json?.data?.properties ?? {};
    const datum = props["kennismaking_datum"];
    return (datum && datum.length >= 8) ? datum : null;
  } catch {
    return null;
  }
}

async function updateDealPropertyCache(
  supabase: SupabaseClient,
  dealId: string,
  kennismakingDatum: string | null,
): Promise<void> {
  await supabase.from("hubspot_deal_property_cache").upsert({
    deal_id: dealId,
    kennismaking_datum: kennismakingDatum,
    checked_at: new Date().toISOString(),
  }, { onConflict: "deal_id" });
}

// =====
// v1.16 Recruitment-tabel: upsert per (event, REC-issue). Status volgt
// is_cancelled. Skill maakt hier GEEN proposal meer voor (kandidaten-flow
// loopt los van sales/leads). Het dashboard leest deze tabel voor de
// "Recruitment-kennismakingen"-sectie.
// =====
async function upsertRecruitmentMeeting(
  supabase: SupabaseClient,
  ev: CalendarEvent,
  externals: CalendarAttendee[],
  recIssue: JiraRecIssue,
  matchReason: string,
): Promise<void> {
  const status = ev.is_cancelled ? "cancelled"
    : (new Date(ev.start_time).getTime() < Date.now() ? "past" : "upcoming");
  const { error } = await supabase.from("recruitment_meetings").upsert({
    calendar_event_id: ev.id,
    graph_id: ev.graph_id,
    jira_issue_key: recIssue.issue_key,
    jira_summary: recIssue.summary,
    jira_status: recIssue.status,
    jira_status_category: recIssue.status_category,
    match_reason: matchReason,
    start_time: ev.start_time,
    end_time: ev.end_time,
    subject: ev.subject,
    body_preview: ev.body_preview,
    location_text: ev.location_text,
    online_meeting_url: ev.online_meeting_url,
    attendee_emails: externals.map(a => a.email).filter(Boolean) as string[],
    attendee_names: externals.map(a => a.name).filter(Boolean) as string[],
    status,
  }, { onConflict: "calendar_event_id" });
  if (error) throw new Error(`recruitment_meetings_upsert_failed: ${error.message}`);
}

// =====
// Note-content voor lead/onbekend-trio. Volgt de daily-admin tone_guide
// voor sales_pipeline: derde persoon, geen tijdstempels, geen
// pipeline-info in body (die staat in submeta-strip). Wel: kort sentiment-
// en context-blok dat een collega in HubSpot direct kan lezen.
// =====
interface TrioNoteParams {
  dealname: string;
  pipelineLabel: string;
  stageLabel: string;
  startDate: string;
  startTimeNL: string;
  locationText: string | null;
  online: boolean;
  externals: CalendarAttendee[];
  ragMatches: RagMatch[];
  dealOwner: string;
}

function buildLeadTrioNoteContent(p: TrioNoteParams): string {
  const externalsList = p.externals
    .map(a => a.name ?? a.email ?? "")
    .filter(Boolean)
    .slice(0, 6)
    .join(", ");
  const locationLine = p.online
    ? "Locatie: Microsoft Teams"
    : (p.locationText ? `Locatie: ${p.locationText}` : "Locatie: nog niet bevestigd");
  const ragLine = p.ragMatches.length > 0
    ? `Eerder contact via ${p.ragMatches[0].source} (${p.ragMatches.length} match${p.ragMatches.length === 1 ? "" : "es"} in RAG-archief)`
    : "Geen eerder contact-spoor in RAG-archief — verse lead.";
  return [
    `**Kennismaking ${p.startTimeNL}**`,
    "",
    `Nieuwe afspraak in de agenda met ${externalsList || "externe deelnemer(s)"}. ${ragLine}`,
    locationLine,
    "",
    `Deal-owner: ${p.dealOwner}.`,
    "",
    "Bespreekpunten voor het gesprek: kennismaking met het bedrijf, scope van de behoefte, beslissingsproces, mogelijke proefperiode-fit.",
    "",
    "Na het gesprek: deze note aanvullen met sentiment en next steps; deal-stage doorzetten naar Sales Pipeline 'Kennismaking plaatsgevonden' bij positief gesprek.",
  ].join("\n");
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
  ragMatches: RagMatch[] = [],
  cachedDatum: string | null = null,
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

  // v1.16: recruitment-events worden niet meer als agent_proposals geschreven.
  // Ze landen via upsertRecruitmentMeeting() in tabel recruitment_meetings,
  // afgehandeld in de hoofd-loop. Hier dus geen voorstel-output.
  if (cls.category === "recruitment") {
    return null;
  }

  if (cls.category === "customer" && cls.deal) {
    // kennismaking_datum is een ÉÉNMALIGE property — gevuld bij de eerste
    // kennismaking, daarna niet overschrijven. Een afwijkende datum
    // betekent meestal dat Jelle al lang met deze klant zit en dit een
    // vervolg/follow-up is, geen nieuwe kennismaking.
    //
    // Skill voorstelt ALLEEN te vullen als HubSpot leeg is. Mismatch
    // met event-datum = vervolggesprek = geen actie nodig.
    const propsFromMirror = (cls.deal.properties ?? {}) as Record<string, unknown>;
    const existingDatum = cachedDatum ?? (propsFromMirror[propMap.kennismaking_datum] as string | undefined);
    if (existingDatum && String(existingDatum).length >= 8) return null;
    // Alleen LEEG → voorstel om in te vullen
    actions.push({
      type: "deal_property_update",
      label: `Property: ${propMap.kennismaking_datum} = ${startDate} (op bestaande Customer-deal)`,
      payload: { deal_id: cls.deal.deal_id, property: propMap.kennismaking_datum, value: startDate, attach_to_new_deal: false },
    });
    return {
      actions,
      subject: `Kennismaking ${cls.deal.dealname ?? cls.company?.name ?? ""} — ${fmtDateTimeNL(ev.start_time)}`.trim(),
      summary: `Bestaande Customer Base-deal "${cls.deal.dealname}". HubSpot-property kennismaking_datum is leeg in HubSpot — voorstel: invullen op ${startDate} zodat Power BI-rapportage compleet wordt. (Bij een afwijkende datum overschrijven we niet — kennismaking_datum is éénmalig.)`,
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
    const pipe = pickLeadPipeline(ragMatches);
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
      label: `Deal: ${dealname} · ${pipe.pipelineLabel} · ${pipe.stageLabel}`,
      payload: {
        dealname, pipeline: pipe.pipeline, dealstage: pipe.stage, amount: null,
        attach_to_company_id: cls.company?.company_id ?? null,
        attach_to_company_domain: cls.company ? null : domain,
        attach_to_contact_id: cls.contact?.contact_id ?? null,
        deal_owner: "Jelle Burggraaf",
      },
    });
    actions.push({
      type: "deal_property_update",
      label: `Property: ${propMap.kennismaking_datum} = ${startDate}`,
      payload: { deal_id: null, property: propMap.kennismaking_datum, value: startDate, attach_to_new_deal: true },
    });
    actions.push({
      type: "note",
      label: `Note op nieuwe deal: kennismaking-context`,
      payload: {
        attach_to_deal: true,
        deal_id: null,
        content: buildLeadTrioNoteContent({
          dealname, pipelineLabel: pipe.pipelineLabel, stageLabel: pipe.stageLabel,
          startDate, startTimeNL: fmtDateTimeNL(ev.start_time),
          locationText: ev.location_text, online: !!ev.online_meeting_url,
          externals, ragMatches, dealOwner: "Jelle Burggraaf",
        }),
      },
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
      summary: `Contact gevonden${cls.company ? " + bedrijf" : ""}, geen deal in HubSpot. Voorstel: nieuwe deal in **${pipe.pipelineLabel}** (stage "${pipe.stageLabel}") + kennismaking-datum. Pipeline-keuze: *${pipe.reason === "rag_mail_context_present" ? "er is al mail-historie, dit is verder dan een rauwe lead" : "geen eerdere historie, dit is een eerste lead"}*.`,
      needsInfo: false,
      confidence: 0.7,
      category: "lead",
    };
  }

  // Onbekend — geen contact, geen company, geen REC
  if (cls.category === "onbekend" && att0) {
    const pipe = pickLeadPipeline(ragMatches);
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
    const dealnameOnbekend = domain ?? att0.email ?? "Nieuwe prospect";
    actions.push({
      type: "deal",
      label: `Deal: ${dealnameOnbekend} · ${pipe.pipelineLabel} · ${pipe.stageLabel}`,
      payload: {
        dealname: dealnameOnbekend,
        pipeline: pipe.pipeline, dealstage: pipe.stage, amount: null,
        attach_to_company_domain: domain, attach_to_contact_email: att0.email,
        deal_owner: "Jelle Burggraaf",
      },
    });
    actions.push({
      type: "deal_property_update",
      label: `Property: ${propMap.kennismaking_datum} = ${startDate}`,
      payload: { deal_id: null, property: propMap.kennismaking_datum, value: startDate, attach_to_new_deal: true },
    });
    actions.push({
      type: "note",
      label: `Note op nieuwe deal: kennismaking-context`,
      payload: {
        attach_to_deal: true,
        deal_id: null,
        content: buildLeadTrioNoteContent({
          dealname: dealnameOnbekend, pipelineLabel: pipe.pipelineLabel, stageLabel: pipe.stageLabel,
          startDate, startTimeNL: fmtDateTimeNL(ev.start_time),
          locationText: ev.location_text, online: !!ev.online_meeting_url,
          externals, ragMatches, dealOwner: "Jelle Burggraaf",
        }),
      },
    });
    return {
      actions,
      subject: `Kennismaking ${domain ?? subjectShort} — ${fmtDateTimeNL(ev.start_time)}`,
      summary: `Nieuwe entiteit (geen match in HubSpot, Jira-REC of partner-list). Voorstel: company + contact + deal aanmaken in **${pipe.pipelineLabel}** (stage "${pipe.stageLabel}"), kennismaking-datum invullen, en context-note klaar zetten. Pipeline-keuze: *${pipe.reason === "rag_mail_context_present" ? "RAG vond mail-historie met dit domein, dus geen rauwe lead" : "geen eerdere historie — past in de leads-funnel"}*.`,
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
      rag_lookups_attempted: 0,
      rag_lookups_with_matches: 0,
      rag_reclassified_to_lead: 0,
      proposals_created: 0,
      events_skipped_already_proposed: 0,
      events_skipped_complete: 0,
      events_skipped_partner: 0,
      // v1.7 skip-filter — alleen echte twijfelgevallen worden voorstel
      events_skipped_customer_already_onboarded: 0,
      events_skipped_sales_past_kennismaking: 0,
      events_skipped_sales_datum_already_set: 0,
      events_skipped_personal_domain: 0,
      events_skipped_lead_already_in_motion: 0,
      events_skipped_dismissed_by_user: 0,
      events_skipped_non_sales_meeting: 0,
      events_skipped_cross_agent_dup: 0,
      hubspot_datum_fetched: 0,
      hubspot_datum_present: 0,
      hubspot_datum_missing_or_mismatch: 0,
      recruitment_meetings_recorded: 0,
      recruitment_meetings_failed: 0,
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

    // Composio credentials voor HubSpot REST proxy (kennismaking_datum fetch)
    let composioApiKey = "";
    {
      const { data: vaultV } = await supabase.rpc("get_skill_secret_service", {
        p_skill_name: "global", p_secret_name: "composio_api_key",
      });
      if (typeof vaultV === "string") composioApiKey = vaultV;
    }
    const hubspotConnectedAccountId = await getCfg(supabase, "global", "composio_connection_id_hubspot");
    const composioReady = !!composioApiKey && typeof hubspotConnectedAccountId === "string";

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

    // 5. Bestaande open proposals — cross-agent dedup, MET nuancering.
    //
    // We bouwen TWEE soorten dedup-sets:
    //   - 'hard' (entiteit-niveau): zelfde calendar_event_id, OR een
    //     bestaande proposal die ZELF een nieuwe company/deal aanmaakt
    //     voor zelfde domain/contact_id. Dan is overlap echt — skip.
    //   - 'soft' (note/contact-only): bestaande proposal heeft alleen
    //     note/task/contact-koppel-acties. Future-voorstel mag DAARNAAST
    //     bestaan want het maakt een NIEUWE entity (company/deal) aan.
    //     Geen skip — beide zijn complementair.
    const { data: existingProps } = await supabase
      .from("agent_proposals").select("id,agent_name,context,proposal,status")
      .in("agent_name", ["daily-admin", "daily-admin-future"])
      .in("status", ["pending", "amended", "accepted"]);
    const existingByEvent = new Set<string>();   // hard: zelfde calendar event
    const hardDealIds = new Set<string>();
    const hardContactIds = new Set<string>();
    const hardDomains = new Set<string>();       // hard: bestaande company-create voor zelfde domein
    for (const p of existingProps ?? []) {
      const ctx = (p.context ?? {}) as Record<string, unknown>;
      if (typeof ctx.calendar_event_id === "string") existingByEvent.add(ctx.calendar_event_id);
      const actions = (p.proposal as { actions?: Array<{ type?: string; payload?: Record<string, unknown> }> })?.actions;
      if (!Array.isArray(actions)) continue;
      const hasCompanyCreate = actions.some(a => a?.type === "company");
      const hasDealCreate = actions.some(a => a?.type === "deal");
      // Alleen 'hard' dedup als bestaande proposal écht een nieuwe entity
      // aanmaakt — anders zijn beide complementair.
      if (hasCompanyCreate || hasDealCreate) {
        if (typeof ctx.deal_id === "string") hardDealIds.add(ctx.deal_id);
        if (typeof ctx.contact_id === "string") hardContactIds.add(ctx.contact_id);
        const emails = ctx.attendee_emails;
        if (Array.isArray(emails)) {
          for (const e of emails) {
            if (typeof e === "string" && e.includes("@")) {
              const dom = e.split("@")[1]?.toLowerCase();
              if (dom) hardDomains.add(dom);
            }
          }
        }
        // Plus: bekijk de payloads van company/deal-creates voor expliciete
        // domain-match (de meest accurate signaal).
        for (const a of actions) {
          const dom = a?.payload?.domain || a?.payload?.attach_to_company_domain;
          if (typeof dom === "string") hardDomains.add(String(dom).toLowerCase());
        }
      }
    }

    // 5b. Door Jelle weggeklikte events (knop "Niet meer tonen" in dashboard)
    const { data: dismissedRows } = await supabase
      .from("daily_admin_future_dismissed")
      .select("calendar_event_id");
    const dismissedSet = new Set<string>(
      (dismissedRows ?? []).map(r => r.calendar_event_id).filter(Boolean) as string[]
    );

    // 6. Per event classifier + voorstel (+ RAG voor onbekend)
    // Dedup binnen-run op deal_id: zelfde HubSpot-deal mag maximaal ÉÉN
    // voorstel krijgen, ook als er meerdere events voor zijn (bv.
    // Kneppelhout 11 mei + 26 mei → één voorstel met beide event-ids
    // in context, niet twee aparte voorstellen).
    const seenDealIds = new Set<string>();
    const proposalsToInsert: Array<Record<string, unknown>> = [];
    for (const { event, externals } of eventsWithExt) {
      if (dismissedSet.has(event.id)) {
        counts.events_skipped_dismissed_by_user++;
        continue;
      }
      if (existingByEvent.has(event.id)) {
        counts.events_skipped_already_proposed++;
        continue;
      }
      // Cross-agent dedup (HARD) — alleen skippen als er al een proposal is
      // die zelf een company/deal-create voor zelfde domein/deal heeft.
      // Note/contact-koppel-only proposals zijn complementair en krijgen
      // GEEN skip (Marktlink-fix: daily-admin koppelt contacten, future
      // voegt company-create toe als die nog mist).
      const eventDomains = Array.from(new Set(
        externals.map(a => (a.email ?? "").toLowerCase().split("@")[1]).filter(Boolean)
      ));
      if (eventDomains.some(d => hardDomains.has(d))) {
        counts.events_skipped_cross_agent_dup++;
        continue;
      }
      const cls = classify(externals, contactsByEmail, companiesById, companiesByDomain, dealsByContact, dealsByCompany, recIssues, partnerDomains, pipelineLabels);
      if (cls.deal?.deal_id && hardDealIds.has(cls.deal.deal_id)) {
        counts.events_skipped_cross_agent_dup++;
        continue;
      }
      if (cls.contact?.contact_id && hardContactIds.has(cls.contact.contact_id)) {
        counts.events_skipped_cross_agent_dup++;
        continue;
      }
      // Within-run dedup: zelfde deal mag niet 2× een voorstel krijgen
      if (cls.deal?.deal_id && seenDealIds.has(cls.deal.deal_id)) {
        counts.events_skipped_cross_agent_dup++;
        continue;
      }
      const catKey = `classified_${cls.category}` as keyof typeof counts;
      counts[catKey] = (counts[catKey] ?? 0) + 1;

      if (cls.category === "partner") { counts.events_skipped_partner++; continue; }

      // === v1.16 Recruitment-tak: schrijf naar recruitment_meetings, GEEN proposal ===
      if (cls.category === "recruitment" && cls.recIssue) {
        try {
          await upsertRecruitmentMeeting(supabase, event, externals, cls.recIssue, cls.reason);
          counts.recruitment_meetings_recorded++;
        } catch (e) {
          counts.recruitment_meetings_failed++;
          (stats.warnings as string[]).push(
            `recruitment_upsert_failed event=${event.id}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        continue;
      }

      // === v1.6 RAG-laag: onbekend-events verrijken via context-build ===
      let ragMatches: RagMatch[] = [];
      let ragBundleId: string | null = null;
      let reclassifiedFromRag = false;
      if (cls.category === "onbekend") {
        counts.rag_lookups_attempted++;
        const att0 = externals[0];
        const dom = (att0?.email ?? "").split("@")[1] ?? null;
        const names = externals.map(a => a.name).filter(Boolean).join(" ");
        const query = [event.subject, names, dom].filter(Boolean).join(" ").trim();
        const ragOpts: Record<string, unknown> = { top_k: RAG_TOP_K };
        if (att0?.email) ragOpts.from_email = att0.email.toLowerCase();
        if (dom) ragOpts.from_domain = dom.toLowerCase();
        const ragRes = await ragLookup(cronSecret, query, ragOpts);
        if (ragRes && ragRes.matches.length > 0) {
          ragMatches = ragRes.matches;
          ragBundleId = ragRes.bundleId;
          counts.rag_lookups_with_matches++;
          // Heuristiek: als top-match in mail/engagement/fireflies van een
          // attendee-domein, dan upgrade naar 'lead' — eerder contact-historie.
          if (ragHintsAtLead(ragMatches)) {
            cls.category = "lead";
            cls.reason = `${cls.reason}|rag_upgraded`;
            counts.rag_reclassified_to_lead++;
            reclassifiedFromRag = true;
            // Hertel categorie-counters: af van onbekend, op naar lead
            counts.classified_onbekend = Math.max(0, (counts.classified_onbekend ?? 0) - 1);
            counts.classified_lead = (counts.classified_lead ?? 0) + 1;
          }
        }
      }

      // v1.13: voor events met gematchte deal — fetch kennismaking_datum
      // via Composio HubSpot proxy en cache. Datum-uitkomst gebruiken we
      // bij skip-check (customer met datum-OK = skip; ontbrekend = voorstel)
      // en bij buildProposal (summary-tekst over datum-state).
      let cachedDatum: string | null = null;
      if (cls.deal?.deal_id && composioReady) {
        counts.hubspot_datum_fetched++;
        cachedDatum = await fetchKennismakingDatum(
          composioApiKey, hubspotConnectedAccountId as string, cls.deal.deal_id,
        );
        // Cache resultaat (ook als null) zodat de view-tabel weet dat we
        // gecheckt hebben.
        await updateDealPropertyCache(supabase, cls.deal.deal_id, cachedDatum);
        const startDate = fmtDate(event.start_time);
        if (cachedDatum && cachedDatum.slice(0, 10) === startDate) counts.hubspot_datum_present++;
        else counts.hubspot_datum_missing_or_mismatch++;
      }

      // === v1.7 filter-laag: skip al-lopende relaties + v1.10 non-sales meetings ===
      const skip = shouldSkipProposal(event, externals, cls, ragMatches, propMap, cachedDatum);
      if (skip.skip) {
        const skipKey = `events_skipped_${skip.reason === "customer_already_onboarded" ? "customer_already_onboarded"
          : skip.reason === "sales_past_kennismaking_stage" ? "sales_past_kennismaking"
          : skip.reason === "sales_kennismaking_datum_already_set" ? "sales_datum_already_set"
          : skip.reason === "personal_or_family_domain" ? "personal_domain"
          : skip.reason === "lead_already_in_motion" ? "lead_already_in_motion"
          : skip.reason === "non_sales_meeting" ? "non_sales_meeting"
          : "complete"}` as keyof typeof counts;
        counts[skipKey] = (counts[skipKey] ?? 0) + 1;
        continue;
      }

      const built = buildProposal(event, externals, cls, propMap, ragMatches, cachedDatum);
      if (!built) { counts.events_skipped_complete++; continue; }

      // RAG-context aan summary toevoegen
      let finalSummary = built.summary;
      if (ragMatches.length > 0) {
        finalSummary += ragSnippet(ragMatches);
        if (reclassifiedFromRag) {
          finalSummary = `Op basis van RAG-context (eerder mail- of meeting-contact) gehaald uit onbekend → lead.\n\n${finalSummary}`;
        }
      }
      // RAG-bump confidence wanneer RAG hits oplevert
      const finalConfidence = (ragMatches.length > 0 && cls.category === "onbekend")
        ? Math.max(built.confidence, 0.55)
        : built.confidence;

      const expiresAt = new Date(Date.now() + PROPOSAL_EXPIRY_DAYS * 86400_000).toISOString();
      const categoryToProposalCat: Record<Category, string> = {
        recruitment: "recruitment", customer: "klant", sales: "klant",
        lead: "klant", partner: "overig", onbekend: "overig",
      };
      proposalsToInsert.push({
        agent_name: "daily-admin-future",
        category: categoryToProposalCat[cls.category],
        subject: built.subject,
        summary: finalSummary,
        proposal: { target: { id: event.graph_id, type: "calendar_event" }, actions: built.actions },
        // RagBadge in dashboard joint op deze top-level kolom (sinds 2026-05-06).
        // Dezelfde waarde wordt OOK in context.rag_bundle_id gezet voor backward compat.
        context_bundle_id: ragBundleId,
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
          // Pipeline + stage van het VOORSTEL (niet de bestaande deal). Bij
          // lead/onbekend is dit Leads (non-campaign) + Kennismaking gepland;
          // bij customer/sales is dit de pipeline van de bestaande deal.
          pipeline: cls.deal?.pipeline_id ?? (built.actions.find(a => a.type === "deal")?.payload?.pipeline as string ?? null),
          pipeline_stage: cls.deal?.dealstage ?? (built.actions.find(a => a.type === "deal")?.payload?.dealstage as string ?? null),
          pipeline_label: cls.deal?.pipeline_id
            ? (pipelineLabels.get(cls.deal.pipeline_id) ?? null)
            : (cls.category === "lead" || cls.category === "onbekend" ? "Leads (non-campaign)" : null),
          stage_label: cls.deal
            ? null  // dashboard resolveert via lookup
            : (cls.category === "lead" || cls.category === "onbekend" ? "Kennismaking gepland" : null),
          company_id: cls.company?.company_id ?? null,
          contact_id: cls.contact?.contact_id ?? null,
          jira_key: cls.recIssue?.issue_key ?? null,
          rag_bundle_id: ragBundleId,
          rag_match_count: ragMatches.length,
          rag_avg_similarity: ragMatches.length > 0
            ? Math.round(
                (ragMatches.reduce((s, m) => s + (m.similarity ?? 0), 0) / ragMatches.length) * 1000
              ) / 1000
            : 0,
          rag_top_similarity: ragMatches.length > 0 ? (ragMatches[0].similarity ?? 0) : 0,
          rag_reclassified: reclassifiedFromRag,
        },
        status: "pending",
        needs_info: built.needsInfo,
        confidence: finalConfidence,
        expires_at: expiresAt,
      });
      if (cls.deal?.deal_id) seenDealIds.add(cls.deal.deal_id);
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

    const totalFiltered = counts.events_skipped_customer_already_onboarded
      + counts.events_skipped_sales_past_kennismaking
      + counts.events_skipped_sales_datum_already_set
      + counts.events_skipped_personal_domain
      + counts.events_skipped_lead_already_in_motion;
    const summary = `${counts.events_with_externals} externe events · cat: rec=${counts.classified_recruitment} cust=${counts.classified_customer} sales=${counts.classified_sales} lead=${counts.classified_lead} partner=${counts.classified_partner} onbekend=${counts.classified_onbekend} · RAG: ${counts.rag_lookups_attempted}/${counts.rag_lookups_with_matches} (${counts.rag_reclassified_to_lead} herclass.) · ${counts.proposals_created} voorstellen · ${counts.recruitment_meetings_recorded} recruitment-meetings · ${totalFiltered} relaties al lopend (cust=${counts.events_skipped_customer_already_onboarded}, sales=${counts.events_skipped_sales_past_kennismaking}, sales-datum=${counts.events_skipped_sales_datum_already_set}, personal=${counts.events_skipped_personal_domain}, lead-in-motion=${counts.events_skipped_lead_already_in_motion}) · ${counts.events_skipped_already_proposed} al-open · ${counts.events_skipped_partner} partner-skip.`;
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
