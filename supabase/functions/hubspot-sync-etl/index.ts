// hubspot-sync-etl v1 - HubSpot CRM v3 REST API direct
// TruthOfSource voor HubSpot. Vervangt directe HubSpot-calls vanuit hubspot-daily-sync /
// sales-todos zodra die migreren. Geen Composio (Composio's HubSpot toolkit is OAuth, wij
// gebruiken Private App access_token).
//
// Secrets-storage: agent_config met is_secret=true (consistent met jira-sync-etl).
//   - hubspot-sync-etl.access_token   HubSpot Private App access token (pat-na1-...)
//   - hubspot-sync-etl.client_key     Optioneel, alleen voor OAuth Apps (niet gebruikt door Private)
//   - global.cron_secret              Shared met andere ETL functions
//
// Mirrors:
//   - hubspot_pipelines (pipeline_id PK, label, stages jsonb, sort_order, is_active, ...)
//   - hubspot_users (hubspot_owner_id PK, email, first_name, last_name, full_name, active, is_primary)
//   - hubspot_deals (deal_id PK, dealname, amount, dealstage, pipeline_id, closedate, owner, ...)
//   - hubspot_companies (company_id PK, name, domain, industry, ...)
//   - hubspot_contacts (contact_id PK, email, firstname, lastname, company, ...)
//   - hubspot_sync_state (singleton id=1)
//
// Trigger: pg_cron (delta elke 15 min; full elke 24 u of via `?mode=full`).
//
// Paginabudget: zie MAX_PAGES hieronder. Companies mogen sinds 15-09-2026 tot
// 10.000 records per full run halen in plaats van 2.000; elke afkapping wordt
// als `stats.truncated.<object>` en als warning opgeschreven, zodat een
// onvolledige ronde nooit meer als volledige telling in `hubspot_sync_state`
// belandt.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { matchesAnySecret } from "../_shared/edge-auth.ts";

const SKILL_VERSION = "hubspot-edge-fn-v1";
const PAGE_SIZE = 100;
const MAX_PAGES_PER_OBJECT = 20; // 2000 records max per object per run (safety)
const FULL_SYNC_INTERVAL_HOURS = 24;

// ── Paginabudget per object (backfill-audit 15-09-2026) ─────────────────────
// `MAX_PAGES_PER_OBJECT = 20` gold voor álle objecten en betekende een harde
// muur op 2.000 records per full run. Deals (~1.155) en contacts (~1.573)
// passen daar ruim onder; companies raakten hem exact — `total_companies` stond
// op precies 2000, en dat is geen telling maar een afkapping. Gevolg: een deel
// van de mirror droeg de property `totale_omvang` niet eens, waardoor D1 de
// kantoorgrootte-ontleding als "niet bruikbaar" moest markeren zonder te kunnen
// zeggen waarom.
//
// Companies krijgen daarom 100 pagina's (10.000 records) — precies het plafond
// dat HubSpot's search-API zelf hanteert; verder pagineren levert een 400, dus
// méér budget zou alleen een andere fout opleveren. Deals en contacts houden
// hun 20: die zijn niet stuk, en elke extra pagina is wandkloktijd die de
// gateway niet heeft.
//
// Een groter budget kán alleen omdat `walkSearch` per pagina wegschrijft. De
// eerste poging (15-09-2026 20:09 UTC) verhoogde alleen dit getal en verzamelde
// nog steeds alles in geheugen: de worker viel om met `WORKER_RESOURCE_LIMIT`
// (HTTP 546) en er kwam geen enkele company bij. Zie de noot bij `walkSearch`.
const MAX_PAGES: Record<"deals" | "companies" | "contacts", number> = {
  deals: MAX_PAGES_PER_OBJECT,
  companies: 100,
  contacts: MAX_PAGES_PER_OBJECT,
};

// De Supabase-gateway kapt een request af rond 150 s. Een full run die daar
// overheen gaat wordt gedood vóór de state-update, en dan staat `last_full_sync`
// nog op gisteren: de volgende ronde probeert opnieuw een full, valt opnieuw om,
// en de mirror bevriest stil. Daarom een eigen deadline ruim daarvóór: pagineren
// stopt, de run maakt zichzelf netjes af en meldt `truncated: true`. Liever een
// zichtbaar onvolledige ronde dan een onzichtbaar afgebroken ronde.
const RUN_SOFT_DEADLINE_MS = 110_000;

const DEAL_PROPERTIES = [
  "dealname", "amount", "dealstage", "pipeline", "closedate", "createdate",
  "hs_lastmodifieddate", "hubspot_owner_id", "dealtype",
  // Licentie/contract-props (Vragenbak W5 data-home, 2026-06-12): landen
  // automatisch in hubspot_deals.properties (jsonb) — geen schema-wijziging.
  // Bron voor analytics_customers_by_price / analytics_started_in_window /
  // analytics_license_value. Zelfde veldset als klantbase_field_definitions.
  "startdatum", "einddatum", "startdatum_proefperiode", "einddatum_proefperiode",
  "contract_start_date", "contract_einddatum",
  "licentieprijs_per_gebruiker", "vaste_licentieprijs_maand",
  "licentieperiode_prijs", "licentieperiode_fee", "vaste_prijs_proefperiode_maand",
  "minimale_licenties_licentieperiode", "minimale_licenties_proefperiode",
  "omvang_licentieperiode", "omvang_proefperiode",
  "korting_licentieperiode_procent", "korting_proefperiode_procent",
  "looptijd_proefperiode_maanden", "type_contract_jm", "permanent_actief",
  "proefperiode_statussen", "dms_actief", "dms_integratie_prijs", "type_dms",
  // Stuurinformatie-velden (dashboarding-onderzoek 2026-09-12, §1.4). Zonder
  // deze regels is D1 geen forecastbord maar een stagetelling, en staat D9 op
  // 8 van 19 checks. Ze landen automatisch in hubspot_deals.properties.
  //   verwachte_start_pilot                     = beslisdatum (D1 forecast, H2/H3)
  //   verwachte_minimumafname_licentieperiode   = bodem pipeline-waarde (H2)
  //   verwachte_omvang_licentieperiode          = plafond pipeline-waarde (H2)
  //   verwachte_prijs                           = prijsdrager waardering
  //   notes_next_activity_date                  = volgende stap (H4)
  //   closed_lost_reason                        = verliesreden (H1, D10)
  //   kennismaking_datum                        = critical number D1
  "verwachte_start_pilot",
  "verwachte_minimumafname_licentieperiode",
  "verwachte_omvang_licentieperiode",
  "verwachte_prijs",
  "notes_next_activity_date",
  "closed_lost_reason",
  "kennismaking_datum",
  // Stage-entry-datums voor tijd-in-fase (D1) en de verliesmaand van soort A
  // (D10). Confluence noemt deze 🟡 "bestaan niet gecheckt" — als HubSpot ze
  // niet kent, filtert de preflight hieronder ze weg en zegt de sync-stat dat.
  "hs_v2_date_entered_3206386937",   // Afgevallen na demo
  "hs_v2_date_entered_3206387898",   // Backburner (na demo)
  "hs_v2_date_entered_3504650455",   // Afgesloten – Beëindigd na gebruik
  // ── Stond alleen op prod (deploy 15-09-2026 04:42 UTC), niet in git ───────
  // Teruggehaald uit de gedeployde eszip bij deze deploy (geheugen
  // `prod-runs-ahead-of-main-v1146` / `edge-bundle-source-recovery`). Zonder
  // deze regels zou een deploy vanaf de repo D1 stilzwijgend slopen: zonder de
  // `hs_v2_date_entered_*`-props is er geen `fase_sinds` en dus geen kaart Tijd
  // in fase, en zonder `hs_analytics_source` valt de kaart Leadsource terug op
  // UNKNOWN voor élke deal.
  //
  // Stage-entry-timestamps actieve sales-pipeline (Fase 2 D1, 2026-09-15).
  // Preflight filtert onbestaande weg — nul risico.
  "hs_v2_date_entered_appointmentscheduled",  // Fase 1 · Kennismaking plaatsgevonden
  "hs_v2_date_entered_4077073627",            // Fase 2 · Offerte sturen
  "hs_v2_date_entered_3206386936",            // Fase 3a · Offerte gestuurd
  "hs_v2_date_entered_5732535537",            // Fase 3b · In afwachting / onderhandeling
  "hs_v2_date_entered_contractsent",          // Fase 3c · Mondeling/mail akkoord
  "hs_v2_date_entered_4075158742",            // Fase 3d · Licentieovereenkomst gestuurd
  "hs_v2_date_entered_3453858021",            // Gewonnen · Gesloten & Gescoord
  // Activiteit + kanaal (D1 aging + bron-signaal, Fase 2 D1, 2026-09-15)
  "hs_last_activity_date",
  "hs_analytics_source",
  "hs_analytics_source_data_1",
  // deal_bron — custom HubSpot property (LS-1, Jelle must create in portal).
  // Preflight drops unknown props safely; once created, ETL picks it up.
  "deal_bron",
];
const COMPANY_PROPERTIES = [
  "name", "domain", "industry", "lifecyclestage", "numberofemployees", "city", "country",
  "hubspot_owner_id", "createdate", "hs_lastmodifieddate",
  // Kantoorgrootte — de dimensie onder élke segment-ontleding (D1, D9-H12, D10).
  "totale_omvang",
];
const CONTACT_PROPERTIES = [
  "email", "firstname", "lastname", "company", "jobtitle", "phone", "lifecyclestage",
  "hubspot_owner_id", "createdate", "hs_lastmodifieddate",
];

interface HubSpotContext {
  accessToken: string;
  authHeader: string;
  baseUrl: string;
}

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  // Secrets live in Supabase Vault (encrypted, audit-logged).
  // Non-secret config (project IDs, settings, watermarks) lives in agent_config.
  // Try Vault first; if not present, read non-secret from agent_config.
  const { data: vaultValue } = await supabase.rpc("get_skill_secret_service", {
    p_skill_name: agentName,
    p_secret_name: key,
  });
  if (typeof vaultValue === "string" && vaultValue.length > 0) return vaultValue;

  const { data } = await supabase.from("agent_config").select("config_value")
    .eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === "string" ? data.config_value : String(data.config_value);
}

async function buildCtx(supabase: SupabaseClient): Promise<HubSpotContext> {
  const accessToken = await getCfg(supabase, "hubspot-sync-etl", "access_token");
  if (!accessToken) throw new Error("hubspot_access_token_missing in agent_config(hubspot-sync-etl, access_token)");
  return {
    accessToken,
    authHeader: `Bearer ${accessToken}`,
    baseUrl: "https://api.hubapi.com",
  };
}

async function hsFetch(ctx: HubSpotContext, path: string, init?: RequestInit, retry = 0): Promise<unknown> {
  const url = `${ctx.baseUrl}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: ctx.authHeader,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if ((res.status === 429 || res.status >= 500) && retry < 3) {
    const delays = [3000, 10000, 30000];
    await new Promise((r) => setTimeout(r, delays[retry]));
    return hsFetch(ctx, path, init, retry + 1);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`hs_http_${res.status}_${path.slice(0, 60)}: ${text.slice(0, 300)}`);
  }
  try { return JSON.parse(text); }
  catch { throw new Error(`hs_non_json_${path.slice(0, 60)}: ${text.slice(0, 200)}`); }
}

// ── Owners ──────────────────────────────────────────────────────────────────
interface HsOwner {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  userId?: number;
  archived?: boolean;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function syncOwners(
  supabase: SupabaseClient,
  ctx: HubSpotContext,
  state: Record<string, unknown> | null,
): Promise<{ upserted: number; hash: string; skipped: boolean; total_seen: number }> {
  // Fetch all owners first (small set, ~16). Then hash-check against last sync.
  const all: HsOwner[] = [];
  let after: string | null = null;
  let safety = 0;
  while (safety++ < MAX_PAGES_PER_OBJECT) {
    const path = `/crm/v3/owners?limit=${PAGE_SIZE}${after ? `&after=${encodeURIComponent(after)}` : ""}&archived=false`;
    const res = await hsFetch(ctx, path) as { results?: HsOwner[]; paging?: { next?: { after?: string } } };
    const page = res.results ?? [];
    if (page.length === 0) break;
    all.push(...page);
    const nextAfter = res.paging?.next?.after;
    if (!nextAfter) break;
    after = nextAfter;
  }

  // Build canonical content hash (excludes synced_at / updated_at).
  const canonical = all
    .map((o) => ({
      id: o.id,
      email: o.email ?? null,
      firstName: o.firstName ?? null,
      lastName: o.lastName ?? null,
      active: o.archived !== true,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const hash = await sha256Hex(JSON.stringify(canonical));
  const lastHash = (state?.last_owners_hash as string | undefined) ?? null;

  if (lastHash && lastHash === hash) {
    return { upserted: 0, hash, skipped: true, total_seen: all.length };
  }

  if (all.length === 0) return { upserted: 0, hash, skipped: false, total_seen: 0 };
  const nowIso = new Date().toISOString();
  const rows = all.map((o) => ({
    hubspot_owner_id: o.id,
    email: o.email ?? null,
    first_name: o.firstName ?? null,
    last_name: o.lastName ?? null,
    // full_name is GENERATED in DB - niet zelf zetten
    active: o.archived !== true,
    synced_at: nowIso,
    updated_at: nowIso,
  }));
  const { error } = await supabase.from("hubspot_users").upsert(rows, { onConflict: "hubspot_owner_id" });
  if (error) throw new Error(`hubspot_users_upsert_failed: ${error.message}`);
  return { upserted: rows.length, hash, skipped: false, total_seen: all.length };
}

// ── Pipelines ───────────────────────────────────────────────────────────────
interface HsPipeline {
  id: string;
  label: string;
  displayOrder?: number;
  stages?: Array<{ id: string; label: string; displayOrder?: number; metadata?: Record<string, string> }>;
  archived?: boolean;
}

async function syncPipelines(
  supabase: SupabaseClient,
  ctx: HubSpotContext,
  state: Record<string, unknown> | null,
): Promise<{ upserted: number; hash: string; skipped: boolean; total_seen: number }> {
  const res = await hsFetch(ctx, "/crm/v3/pipelines/deals") as { results?: HsPipeline[] };
  const pipes = res.results ?? [];

  // Canonical hash (excludes timestamps).
  const canonical = pipes
    .map((p) => ({
      id: p.id,
      label: p.label,
      displayOrder: p.displayOrder ?? 0,
      archived: p.archived === true,
      stages: (p.stages ?? [])
        .map((s) => ({
          id: s.id,
          label: s.label,
          displayOrder: s.displayOrder ?? 0,
          probability: s.metadata?.probability ?? null,
          isClosed: s.metadata?.isClosed === "true",
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const hash = await sha256Hex(JSON.stringify(canonical));
  const lastHash = (state?.last_pipelines_hash as string | undefined) ?? null;

  if (lastHash && lastHash === hash) {
    return { upserted: 0, hash, skipped: true, total_seen: pipes.length };
  }

  if (pipes.length === 0) return { upserted: 0, hash, skipped: false, total_seen: 0 };

  const rows = pipes.map((p) => ({
    pipeline_id: p.id,
    label: p.label,
    sort_order: p.displayOrder ?? 0,
    is_active: p.archived !== true,
    stages: (p.stages ?? []).map((s) => ({
      id: s.id, label: s.label, displayOrder: s.displayOrder ?? 0,
      probability: s.metadata?.probability ?? null,
      isClosed: s.metadata?.isClosed === "true",
    })),
    updated_at: new Date().toISOString(),
    updated_by: SKILL_VERSION,
  }));
  const { error } = await supabase.from("hubspot_pipelines").upsert(rows, { onConflict: "pipeline_id" });
  if (error) throw new Error(`hubspot_pipelines_upsert_failed: ${error.message}`);
  return { upserted: rows.length, hash, skipped: false, total_seen: pipes.length };
}

// ── Search-based sync (deals / companies / contacts) ────────────────────────
interface HsSearchResponse {
  results?: Array<{ id: string; properties: Record<string, string | null>; archived?: boolean }>;
  paging?: { next?: { after?: string } };
  total?: number;
}

// ── Property-preflight ──────────────────────────────────────────────────────
// De allowlists hierboven zijn hard-gecodeerd; HubSpot is dat niet. Een veld
// dat in deze portal anders heet (of nog niet bestaat) mag de hele mirror niet
// stil laten vallen — dat is precies de faalwijze van de chunker-P0 van
// 2026-06-02: stilte geeft geen error. Daarom vragen we per objecttype eerst de
// property-catalogus op en sturen we alleen namen mee die echt bestaan. Wat
// eruit valt, landt in de run-stats onder `properties_missing`; dát is meteen
// het antwoord op "bestaan de hs_v2_date_entered_*-velden hier?".
//
// Bewust geen cache: drie extra GET's per run (elke 30 min) is verwaarloosbaar,
// en een cache in een hergebruikte isolate zou een net aangemaakt veld dagen
// kunnen blijven negeren.
async function resolveProperties(
  ctx: HubSpotContext,
  objectType: "deals" | "companies" | "contacts",
  wanted: string[],
): Promise<{ props: string[]; missing: string[] }> {
  let known: Set<string> | null = null;
  try {
    const res = await hsFetch(ctx, `/crm/v3/properties/${objectType}`) as {
      results?: Array<{ name?: string }>;
    };
    const names = (res.results ?? []).map((p) => p.name).filter((n): n is string => !!n);
    // Leeg antwoord = onverwacht; dan liever het oude gedrag dan een sync die
    // stilletjes zonder velden draait.
    if (names.length > 0) known = new Set(names);
  } catch {
    // Catalogus niet op te halen → ongewijzigd gedrag: stuur alles mee.
  }
  if (!known) return { props: wanted, missing: [] };
  return {
    props: wanted.filter((p) => known!.has(p)),
    missing: wanted.filter((p) => !known!.has(p)),
  };
}

interface SearchWalk {
  /** Hoeveel records de callback heeft weggeschreven. */
  upserted: number;
  /** Er was nog een volgende pagina toen we stopten — de uitkomst is onvolledig. */
  truncated: boolean;
  /** Waaróm we stopten; null als HubSpot zelf klaar was. */
  truncated_reason: "page_budget" | "deadline" | null;
  pages: number;
}

type HsItem = { id: string; properties: Record<string, string | null> };

/**
 * Paginateer door de search-API en geef elke pagina meteen door aan `onPage`.
 *
 * **Pagina voor pagina, niet alles-dan-één-upsert.** De eerste versie van deze
 * functie verzamelde álle records in één array en gaf die aan de aanroeper.
 * Dat werkte tot 2.000 records en viel om zodra het budget voor companies naar
 * 10.000 ging: de worker werd afgeschoten met `WORKER_RESOURCE_LIMIT` (546,
 * gemeten 15-09-2026 20:09 UTC), de run bleef op `running` staan en er kwam
 * geen enkele company bij. Een edge-worker heeft een paar honderd MB; 6.000
 * HubSpot-objecten mét hun volledige `properties`-jsonb passen daar niet in,
 * en de upsert-payload eroverheen al helemaal niet.
 *
 * Nu houdt de lus per moment één pagina van honderd vast. Het geheugen groeit
 * niet meer met het aantal records, dus het paginabudget is weer een keuze over
 * tijd in plaats van over geheugen.
 */
async function walkSearch(
  ctx: HubSpotContext,
  objectType: "deals" | "companies" | "contacts",
  properties: string[],
  modifiedSinceMs: number | null,
  deadlineAt: number,
  onPage: (items: HsItem[]) => Promise<number>,
): Promise<SearchWalk> {
  let after: string | null = null;
  let pages = 0;
  let upserted = 0;
  let truncatedReason: "page_budget" | "deadline" | null = null;
  const budget = MAX_PAGES[objectType];

  // Filter: hs_lastmodifieddate >= since (ms timestamp). Bij full sync: geen filter.
  const filterGroups = modifiedSinceMs !== null
    ? [{ filters: [{ propertyName: "hs_lastmodifieddate", operator: "GTE", value: String(modifiedSinceMs) }] }]
    : [];

  while (pages < budget) {
    const body = {
      filterGroups,
      properties,
      limit: PAGE_SIZE,
      after: after ?? "0",
      sorts: [{ propertyName: "hs_lastmodifieddate", direction: "DESCENDING" }],
    };
    const res = await hsFetch(ctx, `/crm/v3/objects/${objectType}/search`, {
      method: "POST",
      body: JSON.stringify(body),
    }) as HsSearchResponse;
    pages++;
    const batch = (res.results ?? []).map((r) => ({ id: r.id, properties: r.properties }));
    if (batch.length === 0) break;
    upserted += await onPage(batch);

    const nextAfter = res.paging?.next?.after;
    if (!nextAfter) break;
    // Stoppen mét een volgende pagina in de hand = afkapping, en die hoort
    // opgeschreven te worden. Precies dit gebeurde stil bij companies: 2.000
    // records, geen fout, geen waarschuwing, en `total_companies = 2000` las
    // als een telling.
    if (pages >= budget) { truncatedReason = "page_budget"; break; }
    if (Date.now() >= deadlineAt) { truncatedReason = "deadline"; break; }
    after = nextAfter;
  }
  return { upserted, truncated: truncatedReason !== null, truncated_reason: truncatedReason, pages };
}

function tsParse(v: string | null | undefined): string | null {
  if (!v) return null;
  // HubSpot returneert ISO strings of millisecond timestamps.
  const n = Number(v);
  if (!Number.isNaN(n) && /^\d{10,16}$/.test(v.trim())) {
    return new Date(n).toISOString();
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function numParse(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

// Batch-read associations: returns Map<fromId, toIds[]>
async function batchReadAssociations(
  ctx: HubSpotContext,
  fromObjectType: string,
  toObjectType: string,
  fromIds: string[],
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  if (fromIds.length === 0) return result;
  const chunkSize = 100;
  for (let i = 0; i < fromIds.length; i += chunkSize) {
    const chunk = fromIds.slice(i, i + chunkSize);
    const body = { inputs: chunk.map((id) => ({ id })) };
    type AssocResponse = { results?: Array<{ from: { id: string }; to: Array<{ toObjectId: string }> }> };
    const res = await hsFetch(ctx,
      `/crm/v4/associations/${fromObjectType}/${toObjectType}/batch/read`,
      { method: "POST", body: JSON.stringify(body) },
    ) as AssocResponse;
    for (const r of res.results ?? []) {
      result.set(r.from.id, (r.to ?? []).map((t) => t.toObjectId));
    }
  }
  return result;
}

interface SyncResult {
  upserted: number;
  missing: string[];
  /** De zoekopdracht is afgekapt (paginabudget of deadline) — de ronde is onvolledig. */
  truncated: boolean;
  truncated_reason: "page_budget" | "deadline" | null;
  pages: number;
}

async function syncDeals(supabase: SupabaseClient, ctx: HubSpotContext, modifiedSinceMs: number | null, deadlineAt: number): Promise<SyncResult> {
  const { props, missing } = await resolveProperties(ctx, "deals", DEAL_PROPERTIES);
  const walk = await walkSearch(ctx, "deals", props, modifiedSinceMs, deadlineAt, async (items) => {
    const now = new Date().toISOString();
    // Associaties per pagina: honderd id's is precies één batch-call, dus dit
    // is niet méér werk dan de oude verzamel-dan-vraag-aanpak — alleen eerder.
    const dealIds = items.map((it) => it.id);
    const [contactAssoc, companyAssoc] = await Promise.all([
      batchReadAssociations(ctx, "deals", "contacts", dealIds),
      batchReadAssociations(ctx, "deals", "companies", dealIds),
    ]);
    const rows = items.map((it) => ({
      deal_id: it.id,
      dealname: it.properties.dealname,
      amount: numParse(it.properties.amount),
      dealstage: it.properties.dealstage,
      pipeline_id: it.properties.pipeline,
      closedate: tsParse(it.properties.closedate),
      hubspot_owner_id: it.properties.hubspot_owner_id,
      dealtype: it.properties.dealtype,
      hs_created_at: tsParse(it.properties.createdate),
      hs_lastmodifieddate: tsParse(it.properties.hs_lastmodifieddate),
      associated_contact_ids: contactAssoc.get(it.id) ?? [],
      associated_company_ids: companyAssoc.get(it.id) ?? [],
      properties: it.properties,
      is_archived: false,
      synced_at: now,
    }));
    const { error } = await supabase.from("hubspot_deals").upsert(rows, { onConflict: "deal_id" });
    if (error) throw new Error(`hubspot_deals_upsert_failed: ${error.message}`);
    return rows.length;
  });
  return { ...walk, missing };
}

async function syncCompanies(supabase: SupabaseClient, ctx: HubSpotContext, modifiedSinceMs: number | null, deadlineAt: number): Promise<SyncResult> {
  const { props, missing } = await resolveProperties(ctx, "companies", COMPANY_PROPERTIES);
  const walk = await walkSearch(ctx, "companies", props, modifiedSinceMs, deadlineAt, async (items) => {
    const now = new Date().toISOString();
    const rows = items.map((it) => ({
      company_id: it.id,
      name: it.properties.name,
      domain: it.properties.domain,
      industry: it.properties.industry,
      lifecyclestage: it.properties.lifecyclestage,
      num_employees: numParse(it.properties.numberofemployees) !== null ? Math.round(numParse(it.properties.numberofemployees)!) : null,
      city: it.properties.city,
      country: it.properties.country,
      hubspot_owner_id: it.properties.hubspot_owner_id,
      hs_created_at: tsParse(it.properties.createdate),
      hs_lastmodifieddate: tsParse(it.properties.hs_lastmodifieddate),
      properties: it.properties,
      is_archived: false,
      synced_at: now,
    }));
    const { error } = await supabase.from("hubspot_companies").upsert(rows, { onConflict: "company_id" });
    if (error) throw new Error(`hubspot_companies_upsert_failed: ${error.message}`);
    return rows.length;
  });
  return { ...walk, missing };
}

async function syncContacts(supabase: SupabaseClient, ctx: HubSpotContext, modifiedSinceMs: number | null, deadlineAt: number): Promise<SyncResult> {
  const { props, missing } = await resolveProperties(ctx, "contacts", CONTACT_PROPERTIES);
  const walk = await walkSearch(ctx, "contacts", props, modifiedSinceMs, deadlineAt, async (items) => {
    const now = new Date().toISOString();
    // Primary company association per contact
    const contactIds = items.map((it) => it.id);
    const companyAssoc = await batchReadAssociations(ctx, "contacts", "companies", contactIds);
    const rows = items.map((it) => {
      const cmpIds = companyAssoc.get(it.id) ?? [];
      return {
        contact_id: it.id,
        email: it.properties.email,
        firstname: it.properties.firstname,
        lastname: it.properties.lastname,
        company: it.properties.company,
        jobtitle: it.properties.jobtitle,
        phone: it.properties.phone,
        lifecyclestage: it.properties.lifecyclestage,
        hubspot_owner_id: it.properties.hubspot_owner_id,
        associated_company_id: cmpIds[0] ?? null,
        hs_created_at: tsParse(it.properties.createdate),
        hs_lastmodifieddate: tsParse(it.properties.hs_lastmodifieddate),
        properties: it.properties,
        is_archived: false,
        synced_at: now,
      };
    });
    const { error } = await supabase.from("hubspot_contacts").upsert(rows, { onConflict: "contact_id" });
    if (error) throw new Error(`hubspot_contacts_upsert_failed: ${error.message}`);
    return rows.length;
  });
  return { ...walk, missing };
}

// ── Main handler ────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const presentedToken = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const cronSecret = (await getCfg(supabase, "global", "cron_secret")) || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!presentedToken || !matchesAnySecret(presentedToken, [cronSecret, serviceKey])) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  // Allow ?mode=full query-param to force full sync (smoke-test convenience)
  const url = new URL(req.url);
  const forceFull = url.searchParams.get("mode") === "full";

  const triggeredBy = req.headers.get("x-trigger-source") || "edge_cron";
  const startedAt = new Date().toISOString();
  // Eén deadline voor de hele ronde, doorgegeven aan elke pagineerlus. Zo telt
  // de tijd die deals al opmaakten mee wanneer companies aan de beurt zijn —
  // een deadline per object zou samen alsnog over de gateway-limiet gaan.
  const deadlineAt = Date.now() + RUN_SOFT_DEADLINE_MS;
  const stats = {
    schema_version: "1",
    skill_version: "hubspot-sync-etl",
    triggered_by: triggeredBy, triggered_at: startedAt,
    sync_mode: "delta" as "delta" | "full",
    owners_upserted: 0, pipelines_upserted: 0,
    deals_upserted: 0, companies_upserted: 0, contacts_upserted: 0,
    // Per object: is de zoekopdracht afgekapt, en waarom. Stond dit er eerder
    // wel, dan was de companies-muur van 2.000 op de dag zelf opgevallen in
    // plaats van pas bij een audit (backfill-audit 15-09-2026).
    truncated: {} as Record<string, { truncated: boolean; reason: string | null; pages: number; upserted: number }>,
    warnings: [] as string[],
  };

  const { data: runIns, error: runErr } = await supabase.from("agent_runs").insert({
    agent_name: "hubspot-sync", run_type: "edge_function", status: "running",
    started_at: startedAt, stats, errors: [],
  }).select("id").single();
  if (runErr || !runIns) return new Response(`run_record_create_failed: ${runErr?.message}`, { status: 500 });
  const runId = runIns.id as string;

  try {
    const ctx = await buildCtx(supabase);

    // Bepaal full vs delta
    const { data: state } = await supabase.from("hubspot_sync_state").select("*").eq("id", 1).maybeSingle();
    const needsFull = forceFull
      || !state
      || !state.last_full_sync
      || new Date(state.last_full_sync).getTime() < Date.now() - FULL_SYNC_INTERVAL_HOURS * 3_600_000;

    let modifiedSinceMs: number | null;
    if (needsFull) {
      modifiedSinceMs = null;
      stats.sync_mode = "full";
    } else {
      const since = new Date((state!.last_delta_sync as string) ?? Date.now() - 3_600_000);
      // Trek 5 min af voor lichte overlap (eventual consistency)
      modifiedSinceMs = since.getTime() - 5 * 60 * 1000;
      stats.sync_mode = "delta";
    }

    // 1. Owners (kleine set — hash-check skip wanneer onveranderd)
    const ownersResult = await syncOwners(supabase, ctx, state ?? null);
    stats.owners_upserted = ownersResult.upserted;
    (stats as Record<string, unknown>).owners_total_seen = ownersResult.total_seen;
    (stats as Record<string, unknown>).owners_skipped_unchanged = ownersResult.skipped;

    // 2. Pipelines (kleine set — hash-check skip wanneer onveranderd)
    const pipesResult = await syncPipelines(supabase, ctx, state ?? null);
    stats.pipelines_upserted = pipesResult.upserted;
    (stats as Record<string, unknown>).pipelines_total_seen = pipesResult.total_seen;
    (stats as Record<string, unknown>).pipelines_skipped_unchanged = pipesResult.skipped;

    // 3. Deals
    const dealsResult = await syncDeals(supabase, ctx, modifiedSinceMs, deadlineAt);
    stats.deals_upserted = dealsResult.upserted;

    // 4. Companies
    const companiesResult = await syncCompanies(supabase, ctx, modifiedSinceMs, deadlineAt);
    stats.companies_upserted = companiesResult.upserted;

    // 5. Contacts
    const contactsResult = await syncContacts(supabase, ctx, modifiedSinceMs, deadlineAt);
    stats.contacts_upserted = contactsResult.upserted;

    // 5a. Afkapping expliciet maken. Een onvolledige ronde is geen fout — de
    // volgende ronde haalt de rest op — maar hij mag niet als volledige telling
    // in `hubspot_sync_state` belanden zonder dat iemand het kan zien.
    for (const [obj, r] of Object.entries({ deals: dealsResult, companies: companiesResult, contacts: contactsResult })) {
      stats.truncated[obj] = { truncated: r.truncated, reason: r.truncated_reason, pages: r.pages, upserted: r.upserted };
      if (r.truncated) {
        stats.warnings.push(
          `${obj}: afgekapt na ${r.pages} pagina's (${r.upserted} records, reden ${r.truncated_reason}) — HubSpot had nog meer`,
        );
      }
    }

    // 5b. Welke gevraagde properties kent deze portal niet? Dit is de enige
    // plek waar dat zichtbaar wordt — D9 leest het niet, want een veld dat
    // HubSpot niet kent, komt ook nooit in de mirror.
    const propsMissing = {
      deals: dealsResult.missing,
      companies: companiesResult.missing,
      contacts: contactsResult.missing,
    };
    (stats as Record<string, unknown>).properties_missing = propsMissing;
    for (const [obj, list] of Object.entries(propsMissing)) {
      if (list.length > 0) stats.warnings.push(`${obj}: onbekende properties overgeslagen — ${list.join(", ")}`);
    }

    // 6. State update
    const nowState = new Date().toISOString();
    const stateRow: Record<string, unknown> = {
      id: 1,
      last_delta_sync: nowState,
      total_owners: ownersResult.total_seen,
      total_pipelines: pipesResult.total_seen,
      last_owners_hash: ownersResult.hash,
      last_pipelines_hash: pipesResult.hash,
      last_owners_hash_at: ownersResult.skipped
        ? (state?.last_owners_hash_at as string | null) ?? nowState
        : nowState,
      last_pipelines_hash_at: pipesResult.skipped
        ? (state?.last_pipelines_hash_at as string | null) ?? nowState
        : nowState,
      last_error: null,
      last_error_at: null,
      updated_at: nowState,
    };
    if (needsFull) {
      stateRow.last_full_sync = new Date().toISOString();
      stateRow.total_deals = stats.deals_upserted;
      stateRow.total_companies = stats.companies_upserted;
      stateRow.total_contacts = stats.contacts_upserted;
    }
    const { error: stateErr } = await supabase.from("hubspot_sync_state").upsert(stateRow, { onConflict: "id" });
    if (stateErr) throw new Error(`hubspot_sync_state_upsert_failed: ${stateErr.message}`);

    const ownersLabel = ownersResult.skipped ? `${ownersResult.total_seen} owners (unchanged)` : `${ownersResult.upserted} owners`;
    const pipesLabel = pipesResult.skipped ? `${pipesResult.total_seen} pipelines (unchanged)` : `${pipesResult.upserted} pipelines`;
    const afgekapt = Object.entries(stats.truncated).filter(([, v]) => v.truncated).map(([k]) => k);
    const summary = `${stats.sync_mode}: ${ownersLabel}, ${pipesLabel}, ${stats.deals_upserted} deals, ${stats.companies_upserted} companies, ${stats.contacts_upserted} contacts`
      + (afgekapt.length > 0 ? ` — afgekapt: ${afgekapt.join(", ")}` : "");
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
    // Persist the error in sync_state so dashboard sees it
    await supabase.from("hubspot_sync_state").upsert({
      id: 1, last_error: errMsg.slice(0, 500), last_error_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" });
    return new Response(JSON.stringify({ ok: false, error: errMsg }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
