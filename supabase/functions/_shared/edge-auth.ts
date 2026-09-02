// =============================================================================
// _shared/edge-auth.ts — één plek voor de auth-gate van server-to-server
// Edge Functions.
//
// Security review 2026-09-02 · findings F-05, F-07, F-08, F-20.
//
// Waarom deze helper bestaat:
//   • `presented !== cronSecret` is een niet-constante-tijd-vergelijking. Het
//     praktische risico over HTTP is klein, maar `timingSafeEqual` is gratis.
//   • De gate zelf was in 36 functies gekopieerd en in 3 functies vergeten
//     (context-build, hubspot-deal-files-sync, transcribe). Eén helper maakt
//     "vergeten" een stuk moeilijker.
//
// Gebruik in een cron/server-to-server functie (verify_jwt = false, conform de
// hard-rule in CLAUDE.md — deze functies doen hun eigen interne auth):
//
//   import { requireCronOrServiceRole } from "../_shared/edge-auth.ts";
//
//   const gate = await requireCronOrServiceRole(req, supabase);
//   if (!gate.ok) return gate.response;
//
// Gebruik in een browser-functie: zet verify_jwt = true en laat de gateway het
// werk doen (zie kb-compose / invite-user).
// =============================================================================

/** Constante-tijd string-vergelijking. Lengteverschil lekt (onvermijdelijk). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

/** Vergelijkt tegen meerdere toegestane secrets, altijd in constante tijd. */
export function matchesAnySecret(presented: string, allowed: (string | null | undefined)[]): boolean {
  let hit = false;
  for (const candidate of allowed) {
    if (!candidate) continue;
    if (timingSafeEqual(presented, candidate)) hit = true;
  }
  return hit;
}

/** Bearer-token uit de Authorization-header (of de apikey-header). */
export function presentedToken(req: Request): string {
  const auth = req.headers.get("Authorization") || "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  if (bearer) return bearer;
  return (req.headers.get("apikey") || "").trim();
}

async function cronSecretFrom(supabase: any): Promise<string> {
  try {
    const { data: vaultValue } = await supabase.rpc("get_skill_secret_service", {
      p_skill_name: "global",
      p_secret_name: "cron_secret",
    });
    if (typeof vaultValue === "string" && vaultValue.length > 0) return vaultValue;
  } catch { /* val terug op agent_config */ }
  try {
    const { data } = await supabase
      .from("agent_config")
      .select("config_value")
      .eq("agent_name", "global")
      .eq("config_key", "cron_secret")
      .maybeSingle();
    const v = data?.config_value;
    if (!v) return "";
    return typeof v === "string" ? v : String(v);
  } catch {
    return "";
  }
}

export interface GateResult {
  ok: boolean;
  response: Response;
  via?: "cron_secret" | "service_role";
}

/**
 * Laat alleen pg_cron (cron_secret) en server-to-server (service-role key) door.
 * Bewust géén anon-key-pad: de anon-key staat in de publieke browser-bundle en
 * is dus geen authenticatie (F-07).
 */
export async function requireCronOrServiceRole(
  req: Request,
  supabase: any,
  extraHeaders: Record<string, string> = {},
): Promise<GateResult> {
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  const presented = presentedToken(req);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (presented && serviceKey && timingSafeEqual(presented, serviceKey)) {
    return { ok: true, response: new Response(null), via: "service_role" };
  }

  const cronSecret = await cronSecretFrom(supabase);
  if (presented && matchesAnySecret(presented, [cronSecret])) {
    return { ok: true, response: new Response(null), via: "cron_secret" };
  }

  return {
    ok: false,
    response: new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers }),
  };
}
