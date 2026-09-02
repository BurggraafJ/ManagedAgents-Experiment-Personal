// =============================================================================
// mfa-email-send v1 — stuurt de tweede-factor-code (e-mail-OTP) na login.
// Security review 2026-09-02 · REPORT §3 (F-11).
// =============================================================================
//
// verify_jwt = TRUE. De gateway eist dus eerst een geldige login-JWT: dit is
// een stap ná login, geen inlogmethode.
//
// Transport van de code: GoTrue's eigen e-mail-OTP (`POST /auth/v1/otp`), dus
// via de SMTP-afzender die al geconfigureerd staat (Resend). Er komt geen nieuw
// secret bij en de code zelf raakt onze database nooit — wij houden alleen bij
// dát er een challenge liep, voor rate-limiting en het pogingen-plafond.
//
// Vertrouwd apparaat: de client stuurt zijn device_token mee. Wij zien alleen
// de sha256 daarvan; klopt die en is hij niet verlopen of ingetrokken, dan
// slaan we de code over en markeren de sessie direct als MFA-ok.
//
// Rate-limits: 3 codes per 15 minuten (public.app_mfa_config), plus GoTrue's
// eigen smtp_max_frequency van 60s — dat is precies de resend-cooldown die de
// UI aanhoudt.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { CORS, json, resolveCaller, sha256Hex, clientIp } from "../_shared/mfa.ts";

const SKILL_VERSION = "mfa-email-send-v1";
const RESEND_COOLDOWN_SECONDS = 60;

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
  const deviceToken = typeof body.device_token === "string" ? body.device_token : "";
  const userAgent = req.headers.get("User-Agent");
  const ip = clientIp(req);

  // ── 1. Vertrouwd apparaat? Dan geen code. ──────────────────────────────
  if (deviceToken.length >= 32) {
    const hash = await sha256Hex(deviceToken);
    const { data: trusted } = await admin.rpc("mfa_trusted_device_check", {
      p_user_id: caller.userId,
      p_token_hash: hash,
    });
    if (trusted === true) {
      await admin.rpc("mfa_session_mark_ok", {
        p_user_id: caller.userId,
        p_session_id: caller.sessionId,
        p_method: "trusted_device",
        p_user_agent: userAgent,
      });
      return json({ status: "skipped", reason: "trusted_device", version: SKILL_VERSION });
    }
  }

  // ── 2. Mag er een code de deur uit? ───────────────────────────────────
  const { data: started, error: startErr } = await admin.rpc("mfa_challenge_start", {
    p_user_id: caller.userId,
    p_session_id: caller.sessionId,
    p_ip: ip,
    p_user_agent: userAgent,
  });
  if (startErr) return json({ error: "challenge_start_failed", detail: startErr.message }, 500);
  if (!started?.ok) {
    return json(
      {
        error: started?.reason ?? "challenge_refused",
        retry_after_seconds: started?.retry_after_seconds ?? RESEND_COOLDOWN_SECONDS,
        max_codes_per_window: started?.max_codes_per_window,
      },
      429,
    );
  }

  // ── 3. GoTrue mailt de code via de geconfigureerde SMTP-afzender. ─────
  const otpRes = await fetch(`${url}/auth/v1/otp`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: caller.email, create_user: false }),
  });
  if (!otpRes.ok) {
    const detail = (await otpRes.text()).slice(0, 300);
    // De challenge weer weggooien — een mislukte verzending mag geen van de
    // 3 codes per 15 minuten opeten.
    if (started.challenge_id) {
      await admin.rpc("mfa_challenge_abort", { p_challenge_id: started.challenge_id });
    }
    // GoTrue's eigen cooldown (smtp_max_frequency, 60s) is geen storing maar
    // een rate-limit — die geven we als 429 door zodat de UI kan aftellen.
    if (otpRes.status === 429) {
      const secs = Number(detail.match(/after (\d+) seconds?/)?.[1]) || RESEND_COOLDOWN_SECONDS;
      return json({ error: "rate_limited", retry_after_seconds: secs }, 429);
    }
    // Bewust géén 200: de UI moet kunnen zeggen "code kon niet verstuurd worden"
    // in plaats van eindeloos op een mail te wachten die er niet komt.
    return json({ error: "otp_send_failed", status: otpRes.status, detail }, 502);
  }

  return json({
    status: "sent",
    expires_at: started.expires_at,
    ttl_seconds: started.ttl_seconds,
    max_attempts: started.max_attempts,
    cooldown_seconds: RESEND_COOLDOWN_SECONDS,
    version: SKILL_VERSION,
  });
});
