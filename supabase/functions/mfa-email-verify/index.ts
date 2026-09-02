// =============================================================================
// mfa-email-verify v2 — controleert de tweede-factor-code en markeert de sessie.
// Security review 2026-09-02 · REPORT §3 (F-11).
// Hotfix 2026-09-02: past bij de reauthenticatie-mail van mfa-email-send v2.
// =============================================================================
//
// verify_jwt = TRUE — stap ná login.
//
// Wat er gebeurt:
//   1. Poging aftikken (fail-closed): mfa_challenge_attempt verhoogt de teller
//      vóór we de code controleren, dus een afgebroken request kost ook een
//      poging. Boven max_attempts (5) is de challenge dood.
//   2. Code controleren via de RPC mfa_reauth_verify. Die vergelijkt de code
//      met auth.users.reauthentication_token — het token dat GoTrue zette toen
//      mfa-email-send de reauthenticatie-mail liet versturen — en maakt hem
//      daarna eenmalig ongeldig.
//   3. De oorspronkelijke sessie markeren als MFA-ok (user_session_mfa) — dat
//      is wat session_mfa_ok() in de RLS leest.
//   4. Bij "dit apparaat 14 dagen onthouden": 32 random bytes terug naar de
//      client, alleen de sha256 in de database.
//
// WAAROM NIET MEER `POST /auth/v1/verify` (v1):
//   Dat endpoint controleerde type 'email' — de LOGIN-OTP, een andere kolom dan
//   het reauthenticatie-token dat we nu mailen. Het gaf bovendien een volledige
//   nieuwe sessie terug die we daarna weer moesten uitloggen. Er blijft nu geen
//   tweede sessie meer achter, want er wordt er geen meer gemaakt.
//
//   GoTrue biedt zelf geen los eindpunt voor dit token: /verify kent geen type
//   'reauthentication', en PUT /auth/v1/user controleert de nonce alleen als er
//   óók een wachtwoordwijziging in zit (api/user.go 153-164) — een lege PUT met
//   alleen { nonce } geeft 200 terug, óók bij een verkeerde code. Vandaar de
//   eigen RPC; de afweging staat voluit in de migratie.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  CORS,
  json,
  resolveCaller,
  sha256Hex,
  randomToken,
  clientIp,
} from "../_shared/mfa.ts";

const SKILL_VERSION = "mfa-email-verify-v2";

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const anonClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const caller = await resolveCaller(req, anonClient);
  if (!caller) return json({ error: "unauthorized" }, 401);
  if (!caller.sessionId) return json({ error: "no_session_id_in_jwt" }, 400);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const code = String(body.code ?? "").replace(/\D/g, "");
  const remember = body.remember !== false; // standaard aangevinkt
  const userAgent = req.headers.get("User-Agent");
  const ip = clientIp(req);

  if (code.length < 6) return json({ error: "code_invalid_format" }, 400);

  // ── 1. Poging aftikken vóór de controle (fail-closed). ─────────────────
  const { data: att, error: attErr } = await admin.rpc("mfa_challenge_attempt", {
    p_user_id: caller.userId,
    p_success: false,
  });
  if (attErr) return json({ error: "attempt_register_failed", detail: attErr.message }, 500);
  if (!att?.ok) {
    return json({ error: att?.reason ?? "no_open_challenge" }, 429);
  }
  const attemptsLeft = att.attempts_left ?? 0;

  // ── 2. Code controleren tegen het reauthenticatie-token. ──────────────
  const { data: checked, error: checkErr } = await admin.rpc("mfa_reauth_verify", {
    p_user_id: caller.userId,
    p_code: code,
  });
  if (checkErr) {
    return json({ error: "verify_failed", detail: checkErr.message }, 500);
  }
  if (!checked?.ok) {
    // Verlopen, al gebruikt of simpelweg fout — voor de aanroeper allemaal
    // hetzelfde antwoord, zodat er niets te onderscheiden valt. De precieze
    // reden staat in de functie-logs.
    console.log(`mfa_reauth_verify geweigerd: ${checked?.reason ?? "unknown"}`);
    return json({ error: "code_incorrect", attempts_left: attemptsLeft }, 401);
  }

  // ── 3. Challenge consumeren + oorspronkelijke sessie als MFA-ok markeren.
  await admin.rpc("mfa_challenge_consume", { p_user_id: caller.userId });
  const { data: marked, error: markErr } = await admin.rpc("mfa_session_mark_ok", {
    p_user_id: caller.userId,
    p_session_id: caller.sessionId,
    p_method: "otp",
    p_user_agent: userAgent,
  });
  if (markErr) return json({ error: "session_mark_failed", detail: markErr.message }, 500);

  // ── 4. Optioneel: dit apparaat 14 dagen onthouden. ────────────────────
  let deviceToken: string | null = null;
  let deviceExpiresAt: string | null = null;
  if (remember) {
    const raw = randomToken(32);
    const { data: added, error: addErr } = await admin.rpc("mfa_trusted_device_add", {
      p_user_id: caller.userId,
      p_token_hash: await sha256Hex(raw),
      p_user_agent: userAgent,
      p_ip: ip,
    });
    if (!addErr && added?.ok) {
      deviceToken = raw;
      deviceExpiresAt = added.expires_at ?? null;
    }
  }

  return json({
    ok: true,
    session_mfa_expires_at: marked?.expires_at ?? null,
    device_token: deviceToken,
    device_expires_at: deviceExpiresAt,
    version: SKILL_VERSION,
  });
});
