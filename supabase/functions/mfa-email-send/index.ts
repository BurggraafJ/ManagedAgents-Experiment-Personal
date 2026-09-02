// =============================================================================
// mfa-email-send v2 — stuurt de tweede-factor-code (e-mail-OTP) na login.
// Security review 2026-09-02 · REPORT §3 (F-11).
// Hotfix 2026-09-02: v1 mailde een Magic Link i.p.v. een code — zie hieronder.
// =============================================================================
//
// verify_jwt = TRUE. De gateway eist dus eerst een geldige login-JWT: dit is
// een stap ná login, geen inlogmethode.
//
// Transport van de code: GoTrue's REAUTHENTICATIE-mail
// (`GET /auth/v1/reauthenticate`, mét de JWT van de aanroeper). Dat is de enige
// GoTrue-mail die bedoeld is voor "bevestig dat jij het bent" ván een al
// ingelogde gebruiker: de template bevat `{{ .Token }}` en géén link, en het
// token is niet inwisselbaar voor een sessie.
//
// WAAROM NIET MEER `POST /auth/v1/otp` (v1):
//   /otp zonder gebruikers-JWT is het passwordless-LOGIN-endpoint. GoTrue pakt
//   daarvoor de Magic-Link-template, en die bevat alleen ConfirmationURL — geen
//   `{{ .Token }}`. Jelle kreeg dus "Follow this link to login" terwijl het
//   scherm om 6 cijfers vroeg: de code bestond wel, maar stond niet in de mail.
//   Bijkomend: dat token is een volwaardig login-token, wat voor een tweede
//   factor precies de verkeerde eigenschap is.
//
// Vertrouwd apparaat: de client stuurt zijn device_token mee. Wij zien alleen
// de sha256 daarvan; klopt die en is hij niet verlopen of ingetrokken, dan
// slaan we de code over en markeren de sessie direct als MFA-ok.
//
// Rate-limits: 3 codes per 15 minuten (public.app_mfa_config), plus GoTrue's
// eigen smtp_max_frequency van 60s — dat is precies de resend-cooldown die de
// UI aanhoudt. Reauthenticate handhaaft die 60s op reauthentication_sent_at
// (validateSentWithinFrequencyLimit, internal/api/mail.go) en geeft dan 429.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { CORS, json, resolveCaller, sha256Hex, clientIp } from "../_shared/mfa.ts";

const SKILL_VERSION = "mfa-email-send-v2";
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
  // De JWT van de aanroeper gaat mee: reauthenticate leidt de gebruiker daaruit
  // af (getUser in de context), er staat bewust geen e-mailadres in de body.
  const sendRes = await fetch(`${url}/auth/v1/reauthenticate`, {
    method: "GET",
    headers: { apikey: anonKey, Authorization: `Bearer ${caller.token}` },
  });
  if (!sendRes.ok) {
    const detail = (await sendRes.text()).slice(0, 300);
    // De challenge weer weggooien — een mislukte verzending mag geen van de
    // 3 codes per 15 minuten opeten.
    if (started.challenge_id) {
      await admin.rpc("mfa_challenge_abort", { p_challenge_id: started.challenge_id });
    }
    // GoTrue's eigen cooldown (smtp_max_frequency, 60s) is geen storing maar
    // een rate-limit — die geven we als 429 door zodat de UI kan aftellen.
    if (sendRes.status === 429) {
      const secs = Number(detail.match(/after (\d+) seconds?/)?.[1]) || RESEND_COOLDOWN_SECONDS;
      return json({ error: "rate_limited", retry_after_seconds: secs }, 429);
    }
    // Bewust géén 200: de UI moet kunnen zeggen "code kon niet verstuurd worden"
    // in plaats van eindeloos op een mail te wachten die er niet komt.
    return json({ error: "otp_send_failed", status: sendRes.status, detail }, 502);
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
