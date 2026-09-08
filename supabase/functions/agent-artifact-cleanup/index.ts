// =============================================================================
// agent-artifact-cleanup — de bewaartermijn daadwerkelijk handhaven  (spoor 05)
// =============================================================================
// `agent_artifacts.expires_at` stond sinds v1.146 op 30 dagen en er was niets
// dat er iets mee deed: 0 van de 42 cronjobs noemde `agent_artifact*`. Vandaag
// is dat 5 rijen en 41 kB, dus onzichtbaar — maar de evalrunner is er net als
// producent bijgekomen (elke rook- en volledige ronde bouwt echte artefacten),
// en de eerste vervaldatum is 2026-10-05. Tot die dag is het verschil tussen
// "opruimer" en "geen opruimer" niet te zien. Dat is exact het patroon van de
// chunker-P0: stilte geeft geen fout.
//
// verify_jwt: FALSE — dit is een cron/server-to-server-functie en hij doet zijn
// eigen auth via requireCronOrServiceRole (hard-rule CLAUDE.md).
//
// EEN EIGEN FUNCTIE, GEEN UITBREIDING VAN `cleanup-nightly`. Die functie is live
// maar heeft geen source in git: de map bevat alleen een README waarin staat dat
// de Management API een lege eszip teruggaf. Hem uitbreiden zou betekenen dat de
// deploy-payload gereconstrueerd wordt uit het geheugen — precies de hard-rule
// uit CLAUDE.md (incident 2026-07-16).
//
// EN HET KAN GEEN SQL-CRON ZIJN. Nul databasefuncties raken `storage.objects`;
// een rij daar verwijderen laat het bestand in de opslag achter. Weggooien kan
// alleen via de Storage-API, dus via een edge function.
//
// Volgorde per run: BESTAND EERST, RIJ DAARNA. Een rij zonder bestand is
// onschuldige administratie; een bestand zonder rij is onzichtbaar en blijft
// eeuwig staan.
// =============================================================================
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireCronOrServiceRole } from "../_shared/edge-auth.ts";

const BUCKET = "agent-artifacts";
const BATCH = 500;          // rijen per run — een harde bovengrens, geen belofte
const CHUNK = 100;          // paden per storage-remove-call
const ORPHAN_GRACE_MS = 24 * 3600 * 1000; // een bestand mag 24 u zonder rij bestaan
const MAX_SCAN = 5000;      // objecten per run; daarboven: volgende nacht verder
const BACKLOG_ALARM = BATCH;

const JSON_HEADERS = { "Content-Type": "application/json" };

interface Obj { path: string; created_at: string; size: number }

/**
 * Alle objecten in de bucket. Het `storage`-schema is niet via PostgREST
 * benaderbaar (gemeten: PGRST106, alleen `public` en `graphql_public` staan
 * open), dus dit gaat via de Storage-API: eerst de mappen — één per eigenaar —
 * en dan de bestanden per map.
 */
async function listAllObjects(supabase: SupabaseClient): Promise<{ objects: Obj[]; complete: boolean }> {
  const objects: Obj[] = [];
  const { data: folders, error } = await supabase.storage.from(BUCKET).list("", { limit: 1000 });
  if (error) throw new Error(`list_root: ${error.message}`);
  for (const f of folders ?? []) {
    if (f.id !== null) { // een bestand direct in de root; hoort niet te bestaan
      objects.push({ path: f.name, created_at: f.created_at ?? f.updated_at ?? "", size: (f as any).metadata?.size ?? 0 });
      continue;
    }
    let offset = 0;
    for (;;) {
      const { data: items, error: e2 } = await supabase.storage.from(BUCKET).list(f.name, { limit: 1000, offset });
      if (e2) throw new Error(`list_${f.name}: ${e2.message}`);
      for (const it of items ?? []) {
        if (it.id === null) continue; // geneste map: niet ons padpatroon
        objects.push({ path: `${f.name}/${it.name}`, created_at: it.created_at ?? it.updated_at ?? "", size: (it as any).metadata?.size ?? 0 });
      }
      if (!items || items.length < 1000) break;
      offset += items.length;
      if (objects.length >= MAX_SCAN) return { objects, complete: false };
    }
    if (objects.length >= MAX_SCAN) return { objects, complete: false };
  }
  return { objects, complete: true };
}

/** Alle bekende storage_paths, gepagineerd — de vergelijkingsbasis voor wezen. */
async function knownPaths(supabase: SupabaseClient): Promise<Set<string>> {
  const set = new Set<string>();
  for (let from = 0; from < 50_000; from += 1000) {
    const { data, error } = await supabase.from("agent_artifacts").select("storage_path").range(from, from + 999);
    if (error) throw new Error(`known_paths: ${error.message}`);
    for (const r of data ?? []) if (r.storage_path) set.add(r.storage_path);
    if (!data || data.length < 1000) break;
  }
  return set;
}

async function removeInChunks(supabase: SupabaseClient, paths: string[], dryRun: boolean): Promise<{ removed: number; errors: string[] }> {
  const errors: string[] = [];
  let removed = 0;
  for (let i = 0; i < paths.length; i += CHUNK) {
    const slice = paths.slice(i, i + CHUNK);
    if (dryRun) { removed += slice.length; continue; }
    const { error } = await supabase.storage.from(BUCKET).remove(slice);
    if (error) { errors.push(`remove: ${error.message}`.slice(0, 200)); continue; }
    removed += slice.length;
  }
  return { removed, errors };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: JSON_HEADERS });

  const supabase: SupabaseClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const gate = await requireCronOrServiceRole(req, supabase);
  if (!gate.ok) return gate.response;

  let body: any = {};
  try { body = await req.json(); } catch { /* een lege body is een gewone cron-aanroep */ }
  const dryRun = body?.dry_run === true;

  const t0 = Date.now();
  const errors: string[] = [];
  const stats: Record<string, unknown> = { dry_run: dryRun };

  try {
    // ── 1. verlopen rijen ────────────────────────────────────────────────────
    // Uitsluitend op `expires_at < now()`, met een harde limiet. Eén verkeerde
    // WHERE en de bucket is leeg; deze is zo smal als hij kan zijn.
    const { data: expired, error: selErr } = await supabase
      .from("agent_artifacts")
      .select("id, storage_path, bytes, expires_at")
      .lt("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: true })
      .limit(BATCH);
    if (selErr) throw new Error(`select_expired: ${selErr.message}`);

    const rows = expired ?? [];
    stats.scanned = rows.length;
    stats.bytes_freed = rows.reduce((a, r) => a + (r.bytes ?? 0), 0);

    // Bestand eerst.
    const rm = await removeInChunks(supabase, rows.map((r) => r.storage_path).filter(Boolean), dryRun);
    stats.removed_objects = rm.removed;
    errors.push(...rm.errors);

    // Rij daarna, per blok — niet in één klap, zodat een fout halverwege niet
    // de hele administratie meesleept.
    let removedRows = 0;
    if (!dryRun) {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const ids = rows.slice(i, i + CHUNK).map((r) => r.id);
        const { error } = await supabase.from("agent_artifacts").delete().in("id", ids);
        if (error) { errors.push(`delete_rows: ${error.message}`.slice(0, 200)); continue; }
        removedRows += ids.length;
      }
    } else removedRows = rows.length;
    stats.removed_rows = removedRows;

    // ── 2. wezensweep ────────────────────────────────────────────────────────
    // De builder geeft 200 terug als het bestand er staat maar de rij-insert
    // faalt ("het bestand staat er al; de rij is de administratie"). Dat is de
    // juiste keuze voor de gebruiker en het maakt een wees mogelijk. Vandaag
    // zijn het er 0 — de opruimer moet ze blijven tellen, niet aannemen dat ze
    // niet bestaan.
    const cutoff = Date.now() - ORPHAN_GRACE_MS;
    const { objects, complete } = await listAllObjects(supabase);
    const known = await knownPaths(supabase);
    stats.objects_seen = objects.length;
    stats.scan_complete = complete;

    const orphanObjects = objects.filter((o) => !known.has(o.path) && (Date.parse(o.created_at || "") || 0) < cutoff);
    const orm = await removeInChunks(supabase, orphanObjects.map((o) => o.path), dryRun);
    stats.orphans_removed = orm.removed;
    stats.orphan_bytes_freed = orphanObjects.reduce((a, o) => a + (o.size ?? 0), 0);
    errors.push(...orm.errors);

    // 2b. de spiegelbeeldige wees: een rij die naar niets meer wijst. Onschuldig
    // (niemand kan hem downloaden) maar het is dode administratie, en zolang hij
    // blijft staan is "0 wezen" niet te meten. Zelfde respijt van 24 u, zodat we
    // nooit een bouw inhalen die net bezig is.
    let deadRows = 0;
    if (complete) {
      const present = new Set(objects.map((o) => o.path));
      const { data: candidates, error: cErr } = await supabase
        .from("agent_artifacts")
        .select("id, storage_path")
        .lt("created_at", new Date(cutoff).toISOString())
        .limit(BATCH);
      if (cErr) errors.push(`select_dead_rows: ${cErr.message}`.slice(0, 200));
      const dead = (candidates ?? []).filter((r) => r.storage_path && !present.has(r.storage_path));
      if (dead.length > 0 && !dryRun) {
        const { error } = await supabase.from("agent_artifacts").delete().in("id", dead.map((r) => r.id));
        if (error) errors.push(`delete_dead_rows: ${error.message}`.slice(0, 200));
        else deadRows = dead.length;
      } else deadRows = dead.length;
    }
    stats.dead_rows_removed = deadRows;

    // ── 3. blijft er werk liggen? ────────────────────────────────────────────
    const { count: backlog } = await supabase
      .from("agent_artifacts")
      .select("id", { count: "exact", head: true })
      .lt("expires_at", new Date().toISOString());
    stats.backlog = backlog ?? 0;
    stats.duration_ms = Date.now() - t0;

    // ── 4. een cron die uitvalt moet zichzelf melden ─────────────────────────
    // De chunker-P0 in het klein: 11 dagen 401 en niemand zag het, want stilte
    // geeft geen fout. Blijft er na een volle run nog een batch liggen, dan
    // groeit de bucket sneller dan deze functie hem leegt.
    //
    // `scan_type` en `category` zijn CHECK-beperkt op deze tabel
    // (scan_type ∈ daily_monitor|weekly_scan|manual, category ∈ rls|secrets|
    // auth|code|config|network). Het onderzoek stelde `artifact-retention` /
    // `housekeeping` voor; die zou de INSERT weigeren en het alarm juist stil
    // maken. Vandaar de bestaande woordenschat, met de specificiteit in de
    // titel en in affected_object.
    if (!dryRun && (backlog ?? 0) > BACKLOG_ALARM) {
      await supabase.from("security_findings").insert({
        scan_type: "manual",
        severity: "medium",
        category: "config",
        title: `agent_artifacts: ${backlog} verlopen artefacten blijven liggen`,
        detail: `Eén opruimrun verwerkt maximaal ${BATCH} rijen. Na deze run staat de achterstand op ${backlog}. Groeit die door, dan haalt de nachtelijke cron het niet en loopt de private bucket vol.`,
        affected_object: "agent_artifacts",
      });
      stats.alarm_raised = true;
    }

    // ── 5. administratie ─────────────────────────────────────────────────────
    if (!dryRun) {
      await supabase.from("agent_runs").insert({
        agent_name: "agent-artifact-cleanup",
        run_type: "edge_function",
        status: errors.length > 0 ? "warning" : "success",
        summary: `${stats.removed_rows} verlopen · ${stats.orphans_removed} wezen · ${stats.dead_rows_removed} dode rijen · ${stats.bytes_freed} bytes`,
        stats,
        errors,
        completed_at: new Date().toISOString(),
      });
    }

    return new Response(JSON.stringify({ ok: true, via: gate.via, stats, errors }), { status: 200, headers: JSON_HEADERS });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[agent-artifact-cleanup]", msg);
    if (!dryRun) {
      await supabase.from("agent_runs").insert({
        agent_name: "agent-artifact-cleanup", run_type: "edge_function", status: "error",
        summary: msg.slice(0, 200), stats, errors: [...errors, msg.slice(0, 500)],
        completed_at: new Date().toISOString(),
      }).then(() => {}, () => {});
    }
    return new Response(JSON.stringify({ ok: false, error: msg.slice(0, 300), stats }), { status: 500, headers: JSON_HEADERS });
  }
});
