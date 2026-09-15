// calendar-reconcile v1.0 — Sweeper die DB synchroon houdt met Outlook-kalender.
//
// Pendant van mail-reconcile (zie ../mail-reconcile/index.ts).
//
// Waarom een aparte function naast outlook-calendar-sync-etl?
// - outlook-calendar-sync-etl doet delta + 24u full-scan: pakt INSERTS en
//   UPDATES op via lastModifiedDateTime, maar mist DELETIONS — Outlook stuurt
//   geen "ik heb dit weggegooid"-signaal in de delta.
// - calendar-reconcile draait elke 30 min, haalt alleen event-IDs op (geen
//   bodies), en markeert DB-only IDs als is_deleted=true. Daarna verbergt het
//   frontend ze automatisch (useAgenda/useAdmin/NowAgendaStrip/FocusGrid
//   filteren op is_deleted=false).
//
// Effect: tussen "Jelle verwijdert event in Outlook" en "event verdwijnt uit
// Agenda" zit max ~30 min in plaats van nooit.
//
// Window: 60 dagen terug + 90 dagen vooruit. Reden:
//   - sync-etl gebruikt 12mo back / 6mo fwd voor full-scan. Dat is veel breder
//     dan dagelijks gebruik. Reconcile alleen kleinere window om false-positives
//     te voorkomen — events ouder dan 60d die wel in DB staan maar buiten de
//     reconcile-window vallen, laten we onaangeraakt (geen "outlook fetch
//     returned 0 results so mark everything deleted" disaster).
//   - 60d back dekt veelgebruikte "wat had ik vorige maand"-flows.
//   - 90d fwd dekt geplande events ruim voorbij de gewone agenda-zichtbaarheid.
//
// Cost: 1 Composio-call per pagina (top:999, normaal 1-2 paginas voor 5-mnd
// window), ~2 calls/run × 48 runs/dag = ~100 calls/dag. Ruim binnen rate-limit.
//
// Safety-rail: als de Outlook-fetch < 50 events teruggeeft EN er staan
// > 100 events in de DB-window, slaan we de delete-stap over en loggen een
// warning. Dit voorkomt dat een tijdelijke Composio-fout per ongeluk de hele
// agenda wegnukt.

// ── v1.1 (S5, 2026-09-15) · per-eigenaar én N agenda's per invocatie ─────────
//
// Tot v1.0 wist deze functie niet van `mail_accounts`: hij bouwde de
// Composio-context uit `agent_config` (de org-connectie) en las én schreef
// `calendar_events` ZONDER `user_id`-filter. Met één agenda is dat hetzelfde
// als per-eigenaar werken. Met twee agenda's niet: hij zou de event-ids van
// mailbox #1 ophalen, ze vergelijken met de rijen van iedereen, en de events
// van mailbox #2 als `is_deleted = true` markeren. Dat is de fout die
// `mail-reconcile` in v1.1 al had gehad en die hier nog open stond.
//
// Nu: dezelfde registry-claim en dezelfde begrensde lus als de andere drie
// ETL's, en elke lees en schrijf op `calendar_events` is op `user_id`
// gescopeerd. De veiligheidsrail (weiger te markeren als Outlook bijna leeg
// terugkomt) telt daarmee ook per eigenaar in plaats van over de hele tabel.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { matchesAnySecret } from "../_shared/edge-auth.ts";
import {
  forEachClaimedMailAccount, type AccountPass, type MailAccount,
} from "../_shared/mail-account.ts";

const COMPOSIO_API_BASE = "https://backend.composio.dev/api/v3";
const SKILL_VERSION = "calendar-reconcile-v1.1";

// Cron staat op `7,37 * * * *` (elke 30 min). Formule: interval = cron_periode
// × ceil(A / N). Met N = 6 blijft de reconcile 30 minuten tot en met zes
// agenda's, in plaats van drie uur.
//
//   p95 per agenda = 4,1 s  (336 runs, 7 dagen, gemeten 2026-09-15)
//   6 × 4,1 = 24,6 s  →  60 s budget is ruim; worst case 60 + 5,1 = 65 s,
//   ver onder de gateway-idle-timeout van 150 s.
//
// Purpose 'calendar' wordt gedeeld met outlook-calendar-sync-etl. Dat mag: met
// N ≥ A ziet elke invocatie álle agenda's, dus de gedeelde round-robin-wijzer
// kan geen agenda overslaan. Een eigen purpose zou een CHECK-migratie kosten
// voor precies nul gedragsverschil.
const MAX_ACCOUNTS_PER_RUN = 6;
const MAX_WALL_TIME_MS = 60_000;
const TOOL_LIST_EVENTS = "OUTLOOK_OUTLOOK_LIST_EVENTS";
const PAGE_SIZE = 999;
const MAX_PAGES = 10;        // 10 × 999 = ~10k events cap, ruim genoeg voor 150d window
const WINDOW_DAYS_BACK = 60;
const WINDOW_DAYS_FWD = 90;
const SAFETY_MIN_FETCH = 50;    // onder dit getal → safety-skip
const SAFETY_DB_THRESHOLD = 100; // alleen als DB > dit safety-relevant is

interface ComposioContext { apiKey: string; userId: string; connectionId: string; }

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  // Vault first (canonical for secrets), agent_config fallback.
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

// v1.1: de connectie komt uit het geclaimde mail_accounts-record, net als bij
// outlook-calendar-sync-etl. agent_config blijft alleen nog fallback voor een
// registry-rij zonder credential (seed liep vóór agent_config).
async function buildCtx(supabase: SupabaseClient, account: MailAccount): Promise<ComposioContext> {
  const apiKey = await getCfg(supabase, "global", "composio_api_key");
  if (!apiKey) throw new Error("composio_api_key_missing");
  const userId = account.composio_user_id
    ?? (await getCfg(supabase, "outlook-calendar-sync-etl", "composio_user_id"))
    ?? (await getCfg(supabase, "global", "composio_user_id"))
    ?? "user-jelle";
  const connectionId = account.composio_connection_id
    ?? (await getCfg(supabase, "outlook-calendar-sync-etl", "composio_connection_id"))
    ?? (await getCfg(supabase, "mail-sync-etl-v2", "composio_connection_id"));
  if (!connectionId) {
    throw new Error(`composio_connection_id_missing for ${account.mailbox_email ?? account.user_id}`);
  }
  return { apiKey, userId, connectionId };
}

interface ToolResult {
  data?: {
    response_data?: { value?: Array<Record<string, unknown>>; "@odata.nextLink"?: string };
    value?: Array<Record<string, unknown>>;
  };
  error?: string;
}

async function execTool(ctx: ComposioContext, toolName: string, toolArgs: Record<string, unknown>, retry = 0): Promise<ToolResult> {
  const res = await fetch(`${COMPOSIO_API_BASE}/tools/execute/${encodeURIComponent(toolName)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ctx.apiKey },
    body: JSON.stringify({
      user_id: ctx.userId,
      connected_account_id: ctx.connectionId,
      arguments: toolArgs,
    }),
  });
  if (res.status === 429 && retry < 3) {
    const delays = [5000, 15000, 45000];
    await new Promise((r) => setTimeout(r, delays[retry]));
    return execTool(ctx, toolName, toolArgs, retry + 1);
  }
  const text = await res.text();
  let body: ToolResult;
  try { body = JSON.parse(text); } catch { throw new Error(`composio_non_json: ${res.status} ${text.slice(0,200)}`); }
  if (!res.ok) throw new Error(`composio_http_${res.status}: ${(body as { error?: string })?.error ?? text.slice(0,200)}`);
  return body;
}

function extractEvents(result: ToolResult): Array<Record<string, unknown>> {
  // Composio responses can wrap data variably; mirror outlook-calendar-sync-etl.
  const candidates: unknown[] = [
    result?.data,
    result?.data?.response_data,
    result?.data?.response_data?.value,
    result?.data?.value,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c as Array<Record<string, unknown>>;
  }
  const rd = result?.data?.response_data;
  if (rd && typeof rd === "object" && !Array.isArray(rd)) {
    const v = (rd as { value?: unknown }).value;
    if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
  }
  return [];
}

function extractNextLink(result: ToolResult): string | undefined {
  const link = result?.data?.response_data?.["@odata.nextLink"];
  return typeof link === "string" ? link : undefined;
}

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const presentedToken = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const cronSecret = (await getCfg(supabase, "global", "cron_secret")) || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!presentedToken || !matchesAnySecret(presentedToken, [cronSecret, serviceKey])) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" }
    });
  }

  const triggeredBy = req.headers.get("x-trigger-source") || "edge_cron";
  const startedAt = new Date().toISOString();
  const windowStart = new Date(Date.now() - WINDOW_DAYS_BACK * 86400_000);
  const windowEnd   = new Date(Date.now() + WINDOW_DAYS_FWD  * 86400_000);

  const stats: Record<string, unknown> = {
    schema_version: "1",
    skill_version: SKILL_VERSION,
    triggered_by: triggeredBy,
    triggered_at: startedAt,
    window_start: windowStart.toISOString(),
    window_end:   windowEnd.toISOString(),
    outlook_count: 0,
    db_count: 0,
    pages: 0,
    marked_deleted: 0,
    revived: 0,                  // gevallen waar Outlook event terug komt
    outlook_only: 0,             // events die nog niet in DB staan (sync zal ze oppakken)
    skipped_safety: false,
    // v1.1 (S5): meerdere agenda's per invocatie. `accounts[]` is de hele
    // ronde, één rij per eigenaar — daar zie je wélke agenda stilvalt.
    accounts: [] as AccountPass[],
    accounts_claimable: 0,
    accounts_processed: 0,
    accounts_failed: 0,
    max_accounts_per_run: MAX_ACCOUNTS_PER_RUN,
    stop_reason: null as string | null,
    warnings: [] as string[],
  };

  const { data: runIns, error: runErr } = await supabase.from("agent_runs").insert({
    agent_name: "calendar-reconcile", run_type: "edge_function", status: "running",
    started_at: startedAt, stats, errors: [],
  }).select("id").single();
  if (runErr || !runIns) return new Response(`run_record_create_failed: ${runErr?.message}`, { status: 500 });
  const runId = runIns.id as string;

  // Getypeerde optelling naast `stats` (die is `Record<string, unknown>`, dus
  // `+=` erop is geen rekenen maar gokken). Aan het eind van de ronde gaan deze
  // zes in één keer in stats.
  const totaal = {
    outlook_count: 0, db_count: 0, pages: 0,
    marked_deleted: 0, revived: 0, outlook_only: 0,
  };

  // v1.1 (S5): één agenda per pass, N passes per invocatie. Alles binnen deze
  // closure is op ÉÉN eigenaar gescopeerd — dat is de hele reden dat de
  // functie nu langs de registry gaat.
  const reconcileEenAgenda = async (
    account: MailAccount,
    lus: { pass: number; detail: Record<string, unknown> },
  ): Promise<string | null> => {
    const ownerUserId = account.user_id;
    const ctx = await buildCtx(supabase, account);

    // Stap 1 — fetch alle event-IDs in window uit Outlook
    const outlookIds = new Set<string>();
    const filter =
      `start/dateTime ge '${windowStart.toISOString().slice(0, 19)}Z' and ` +
      `start/dateTime le '${windowEnd.toISOString().slice(0, 19)}Z'`;

    let pageToken: string | undefined;
    let pages = 0;
    do {
      const args: Record<string, unknown> = {
        user_id: "me",
        top: PAGE_SIZE,
        filter,
        select: ["id"],
        orderby: ["start/dateTime asc"],
        timezone: "UTC",
        expand_recurring_events: false,
      };
      if (pageToken) args.skip_token = pageToken;

      const result = await execTool(ctx, TOOL_LIST_EVENTS, args);
      const events = extractEvents(result);
      for (const e of events) {
        if (typeof e.id === "string") outlookIds.add(e.id);
      }
      const nextLink = extractNextLink(result);
      if (nextLink) {
        const m = nextLink.match(/[?&]\$skiptoken=([^&]+)/i);
        pageToken = m ? decodeURIComponent(m[1]) : undefined;
      } else {
        pageToken = undefined;
      }
      pages++;
      if (events.length < PAGE_SIZE) break;
    } while (pageToken && pages < MAX_PAGES);

    totaal.outlook_count += outlookIds.size;
    totaal.pages += pages;

    // Stap 2 — DB events in zelfde window, VAN DEZE EIGENAAR.
    // Het `user_id`-filter is de kern van v1.1: zonder dat vergelijkt de
    // functie de agenda van eigenaar A met de rijen van iedereen.
    const { data: dbRows, error: dbErr } = await supabase
      .from("calendar_events")
      .select("graph_id, is_deleted")
      .eq("user_id", ownerUserId)
      .gte("start_time", windowStart.toISOString())
      .lte("start_time", windowEnd.toISOString());
    if (dbErr) throw new Error(`db_select_failed: ${dbErr.message}`);

    const dbActive = new Map<string, boolean>();   // graph_id → is_deleted
    for (const r of (dbRows ?? [])) {
      if (r.graph_id) dbActive.set(r.graph_id, !!r.is_deleted);
    }
    totaal.db_count += dbActive.size;
    lus.detail.outlook_count = outlookIds.size;
    lus.detail.db_count = dbActive.size;

    // Safety: weiger te markeren als Outlook bijna leeg is maar DB vol.
    // v1.1: de rail telt nu per eigenaar en slaat alléén DEZE agenda over —
    // vóór v1.1 stopte hij de hele invocatie, wat bij zes agenda's betekende
    // dat één lege fetch de andere vijf óók zou overslaan.
    if (outlookIds.size < SAFETY_MIN_FETCH && dbActive.size > SAFETY_DB_THRESHOLD) {
      stats.skipped_safety = true;
      lus.detail.skipped_safety = true;
      const reden =
        `safety_skip ${account.mailbox_email ?? ownerUserId}: outlook_count=${outlookIds.size} ` +
        `(<${SAFETY_MIN_FETCH}) vs db_count=${dbActive.size} (>${SAFETY_DB_THRESHOLD}) — refuse to mark`;
      (stats.warnings as string[]).push(reden);
      return reden;
    }

    // Stap 3 — bereken delta
    const toDelete: string[] = [];   // in DB als active maar weg in Outlook
    const toRevive: string[] = [];   // gemarkeerd is_deleted=true maar weer in Outlook
    let outlookOnly = 0;

    for (const [graphId, isDeleted] of dbActive.entries()) {
      const inOutlook = outlookIds.has(graphId);
      if (!inOutlook && !isDeleted) toDelete.push(graphId);
      if (inOutlook  &&  isDeleted) toRevive.push(graphId);
    }
    for (const id of outlookIds) {
      if (!dbActive.has(id)) outlookOnly++;
    }
    totaal.outlook_only += outlookOnly;

    // Stap 4 — mark als is_deleted in batches van 200.
    // `.eq("user_id", …)` naast `.in("graph_id", …)`: de graph_id's komen uit
    // dbActive en zijn dus al van deze eigenaar, maar een write die zelf niet
    // op de eigenaar filtert is precies het soort regel dat later per ongeluk
    // hergebruikt wordt. Twee gordels.
    const nowIso = new Date().toISOString();
    let markedTotal = 0;
    for (let i = 0; i < toDelete.length; i += 200) {
      const batch = toDelete.slice(i, i + 200);
      const { error } = await supabase
        .from("calendar_events")
        .update({ is_deleted: true, deleted_at: nowIso, updated_at: nowIso })
        .eq("user_id", ownerUserId)
        .in("graph_id", batch);
      if (error) throw new Error(`db_mark_deleted_failed: ${error.message}`);
      markedTotal += batch.length;
    }
    totaal.marked_deleted += markedTotal;
    lus.detail.marked_deleted = markedTotal;

    // Stap 5 — revive events die terug zijn in Outlook (rare maar bestaat:
    // Jelle verplaatst event terug, of accepteert weer)
    let revivedTotal = 0;
    for (let i = 0; i < toRevive.length; i += 200) {
      const batch = toRevive.slice(i, i + 200);
      const { error } = await supabase
        .from("calendar_events")
        .update({ is_deleted: false, deleted_at: null, updated_at: nowIso })
        .eq("user_id", ownerUserId)
        .in("graph_id", batch);
      if (error) throw new Error(`db_revive_failed: ${error.message}`);
      revivedTotal += batch.length;
    }
    totaal.revived += revivedTotal;
    lus.detail.revived = revivedTotal;
    return null;
  };

  try {
    const ronde = await forEachClaimedMailAccount(
      supabase, "calendar", "calendar-reconcile",
      { maxAccounts: MAX_ACCOUNTS_PER_RUN, maxWallMs: MAX_WALL_TIME_MS },
      reconcileEenAgenda,
    );
    stats.accounts = ronde.passes;
    stats.accounts_claimable = ronde.claimbaar;
    stats.accounts_processed = ronde.passes.length;
    stats.accounts_failed = ronde.passes.filter((p) => !p.ok).length;
    stats.stop_reason = ronde.stop_reason;

    if (ronde.passes.length === 0) {
      (stats.warnings as string[]).push("no_claimable_account");
      await supabase.from("agent_runs").update({
        status: "warning", completed_at: new Date().toISOString(),
        summary: "geen claimbaar mail_account", stats,
      }).eq("id", runId);
      return new Response(JSON.stringify({ ok: true, runId, skipped: true, reason: "no_claimable_account" }), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    }

    const mboxen = ronde.passes.map((p) => p.mailbox_email ?? p.account_user_id).join(", ");
    Object.assign(stats, totaal);
    const kern = (totaal.marked_deleted > 0 || totaal.revived > 0)
      ? `${totaal.marked_deleted} event(s) gemarkeerd als verwijderd${totaal.revived > 0 ? `, ${totaal.revived} herleefd` : ''} (window: ${WINDOW_DAYS_BACK}d→${WINDOW_DAYS_FWD}d, outlook=${totaal.outlook_count}, db=${totaal.db_count})`
      : `alles synchroon (outlook=${totaal.outlook_count}, db=${totaal.db_count}, window=${WINDOW_DAYS_BACK}d→${WINDOW_DAYS_FWD}d)`;
    const summary = `${stats.accounts_processed}/${ronde.claimbaar} agenda('s) [${mboxen}], ${kern}` +
      (ronde.stop_reason === "wall_budget" ? " — tijd op, rest volgt volgende tik" : "");

    const allesStuk = stats.accounts_failed === stats.accounts_processed;
    const finalStatus = allesStuk
      ? "error"
      : ((stats.warnings as string[]).length > 0 ? "warning" : "success");

    await supabase.from("agent_runs").update({
      status: finalStatus, completed_at: new Date().toISOString(), summary, stats,
      errors: ronde.passes.filter((p) => !p.ok)
        .map((p) => ({ message: `${p.mailbox_email ?? p.account_user_id}: ${p.error}`, at: new Date().toISOString() })),
    }).eq("id", runId);

    return new Response(JSON.stringify({ ok: !allesStuk, runId, stats }), {
      status: allesStuk ? 500 : 200, headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    // Alleen nog fouten buiten een agenda om (claim-RPC, registry-telling).
    const errMsg = err instanceof Error ? err.message : String(err);
    await supabase.from("agent_runs").update({
      status: "error", completed_at: new Date().toISOString(),
      summary: errMsg.slice(0, 500), stats,
      errors: [{ message: errMsg, at: new Date().toISOString() }],
    }).eq("id", runId);
    return new Response(JSON.stringify({ ok: false, error: errMsg }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
});
