// km-distance-lookup v1 - Google Distance Matrix proxy + cache
// Vervangt Claude-for-Chrome google-maps lookups in kilometerregistratie skill.
//
// Endpoint: POST { origin, destination } | { pairs: [{origin, destination}, ...] }
// Response: { km, duration_min, cached } | { results: [{...}], cached_count, fetched_count }
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

interface Pair { origin: string; destination: string; }
interface Result { origin: string; destination: string; km: number | null; duration_min: number | null; cached: boolean; error?: string; }

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  const { data } = await supabase.from("agent_config").select("config_value")
    .eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === "string" ? data.config_value : String(data.config_value);
}

async function lookupCached(supabase: SupabaseClient, origin: string, destination: string): Promise<Result | null> {
  const { data } = await supabase.from("km_distance_cache").select("km,duration_min")
    .eq("origin", origin).eq("destination", destination).maybeSingle();
  if (!data) return null;
  await supabase.from("km_distance_cache")
    .update({ last_used_at: new Date().toISOString() })
    .eq("origin", origin).eq("destination", destination);
  return { origin, destination, km: Number(data.km), duration_min: data.duration_min, cached: true };
}

async function fetchFromGoogle(apiKey: string, origin: string, destination: string): Promise<Result> {
  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destination)}&mode=driving&units=metric&key=${apiKey}`;
  const res = await fetch(url);
  const text = await res.text();
  let body: { rows?: Array<{ elements?: Array<{ status?: string; distance?: { value: number }; duration?: { value: number } }> }>; status?: string; error_message?: string };
  try { body = JSON.parse(text); } catch { return { origin, destination, km: null, duration_min: null, cached: false, error: `non_json_${res.status}` }; }
  if (body.status !== "OK") return { origin, destination, km: null, duration_min: null, cached: false, error: `google_${body.status}_${body.error_message?.slice(0,80) ?? ""}` };
  const el = body.rows?.[0]?.elements?.[0];
  if (!el || el.status !== "OK") return { origin, destination, km: null, duration_min: null, cached: false, error: `element_${el?.status ?? "missing"}` };
  const km = Math.round((el.distance?.value ?? 0) / 100) / 10;
  const dmin = Math.round((el.duration?.value ?? 0) / 60);
  return { origin, destination, km, duration_min: dmin, cached: false };
}

async function storeCache(supabase: SupabaseClient, r: Result, raw?: unknown): Promise<void> {
  if (r.km == null) return;
  await supabase.from("km_distance_cache").upsert({
    origin: r.origin, destination: r.destination,
    km: r.km, duration_min: r.duration_min,
    google_response: raw ?? null,
    queried_at: new Date().toISOString(),
    last_used_at: new Date().toISOString(),
    hits: 1,
  }, { onConflict: "origin,destination" });
}

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const presented = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const cronSecret = (await getCfg(supabase, "global", "cron_secret")) || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!presented || (presented !== cronSecret && presented !== serviceKey)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  let body: { origin?: string; destination?: string; pairs?: Pair[] };
  try { body = await req.json(); } catch { body = {}; }
  const pairs: Pair[] = body.pairs ?? (body.origin && body.destination ? [{ origin: body.origin, destination: body.destination }] : []);
  if (pairs.length === 0) {
    return new Response(JSON.stringify({ error: "no_pairs_provided" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const apiKey = await getCfg(supabase, "global", "google_maps_api_key");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "google_maps_api_key_missing" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const results: Result[] = [];
  let cached_count = 0, fetched_count = 0;
  for (const p of pairs) {
    const cachedHit = await lookupCached(supabase, p.origin, p.destination);
    if (cachedHit) { results.push(cachedHit); cached_count++; continue; }
    const fresh = await fetchFromGoogle(apiKey, p.origin, p.destination);
    if (fresh.km != null) await storeCache(supabase, fresh);
    results.push(fresh);
    fetched_count++;
  }

  if (pairs.length === 1) {
    return new Response(JSON.stringify(results[0]), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify({ results, cached_count, fetched_count }), { status: 200, headers: { "Content-Type": "application/json" } });
});
