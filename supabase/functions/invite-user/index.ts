// Edge Function: invite-user
// ----------------------------------------------------------------------------
// Verstuurt de uitnodiging voor een gebruiker die AL BESTAAT, en legt vast dat
// dat gebeurd is (user_roles.invite_sent_at = now()).
//
// Wat er veranderde (2026-09-12, "aanmaken ≠ uitnodigen"):
//   vóór: inviteUserByEmail(email) — dat maakte het account áán en mailde in
//         één beweging. Aanmaken zonder mail bestond dus niet, en er was geen
//         spoor van "is er ooit gemaild".
//   nu:   deze functie mailt alleen naar een bestaand account. Bestaat het
//         adres nog niet, dan komt er een 404 met code 'create-first' terug —
//         aanmaken doet de losse functie create-user, zonder mail.
//
// Welke mail gaat de deur uit:
//   • account nog niet bevestigd (email_confirmed_at NULL) → GoTrue's
//     invite-mail via admin inviteUserByEmail. Dat is het pad van vóór; voor
//     een onbevestigd account stuurt GoTrue de invite gewoon opnieuw.
//   • account al bevestigd (aangemaakt met createUser + email_confirm:true, en
//     dus zonder wachtwoord) → de recovery-mail via POST /auth/v1/recover.
//     Voor zo'n account weigert invite met email_exists; recovery is het
//     documenteerde pad dat wél werkt voor bestaande users en levert precies
//     wat nodig is: een link waarmee je een wachtwoord zet. De app vangt die
//     link op via ?reset=1 (useSupabaseAuth → isRecovery) en toont het
//     wachtwoord-paneel.
//   Admin generateLink() is bewust géén optie: die genereert een link maar
//   verstuurt niets, en er is geen eigen mailer in dit project.
//
// Nooit voor iemand die al ingelogd heeft: dan is de uitnodiging klaar en zou
// de mail een ongevraagde wachtwoord-reset zijn. Die vraag geeft 409 terug.
//
// dry_run: true doet alles behalve mailen en schrijven — zo kun je de gate en
// de routekeuze testen zonder iemand te mailen.
//
// Wie mag dit aanroepen: alleen een ingelogde owner (verify_jwt = true op de
// gateway + requireOwner in de body).

// deno-lint-ignore-file no-explicit-any
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  adminClient,
  corsHeaders,
  EMAIL_RE,
  fetchRoleRow,
  findAuthUserByEmail,
  jsonResponse,
  requireOwner,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from "../_shared/admin-users.ts";

/** Alleen een absolute http(s)-URL doorgeven; GoTrue toetst 'm daarna nog
 *  tegen de Redirect-URL-allowlist van het project. */
function safeRedirect(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return u.toString();
  } catch {
    return undefined;
  }
}

/** GoTrue's recovery-mail: bestaand (bevestigd) account, set-wachtwoord-link. */
async function sendRecoveryMail(email: string, redirectTo?: string) {
  const qs = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : "";
  const res = await fetch(`${SUPABASE_URL}/auth/v1/recover${qs}`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (res.ok) return { ok: true as const };
  const detail = (await res.text()).slice(0, 300);
  return { ok: false as const, status: res.status, detail };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method-not-allowed" }, 405);

  try {
    const gate = await requireOwner(req);
    if (!gate.ok) return gate.response!;

    let payload: {
      email?: string;
      display_name?: string;
      redirect_to?: string;
      dry_run?: boolean;
    };
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: "invalid-json" }, 400);
    }
    const email = (payload.email || "").trim().toLowerCase();
    const display_name = (payload.display_name || "").trim();
    const redirectTo = safeRedirect(payload.redirect_to);
    if (!email || !EMAIL_RE.test(email)) return jsonResponse({ error: "invalid-email" }, 400);

    // 1) Uitnodigen doet alleen bestaande accounts. Aanmaken is create-user.
    const target = await findAuthUserByEmail(email);
    if (!target) {
      return jsonResponse({
        error: "user-not-found",
        code: "create-first",
        email,
        message: "Dit adres heeft nog geen account. Maak de gebruiker eerst aan (Gebruiker aanmaken) en verstuur daarna de uitnodiging.",
      }, 404);
    }

    // 2) Al eens ingelogd = uitnodiging is af. Geen ongevraagde reset-mail.
    if (target.last_sign_in_at) {
      return jsonResponse({
        error: "already-signed-in",
        user_id: target.id,
        email,
        last_sign_in_at: target.last_sign_in_at,
        message: "Deze gebruiker is al eens ingelogd. Een uitnodiging is niet meer nodig; wachtwoord vergeten doet hij zelf op het inlogscherm.",
      }, 409);
    }

    const mode = target.email_confirmed_at ? "recovery" : "invite";

    if (payload.dry_run) {
      return jsonResponse({
        success: true,
        dry_run: true,
        mode,
        user_id: target.id,
        email,
        redirect_to: redirectTo ?? null,
        would: mode === "invite" ? "send-gotrue-invite-mail" : "send-gotrue-recovery-mail",
      });
    }

    // 3) Mailen.
    if (mode === "invite") {
      const { error } = await adminClient().auth.admin.inviteUserByEmail(email, {
        data: display_name ? { display_name } : undefined,
        redirectTo,
      });
      if (error) {
        const status = /rate|too many/i.test(error.message) ? 429 : 400;
        return jsonResponse({ error: `invite-failed: ${error.message}` }, status);
      }
    } else {
      const sent = await sendRecoveryMail(email, redirectTo);
      if (!sent.ok) {
        // 429 is GoTrue's smtp_max_frequency, geen storing: doorgeven zodat de
        // UI "even wachten" kan zeggen in plaats van "mislukt".
        if (sent.status === 429) {
          return jsonResponse({ error: "rate-limited", detail: sent.detail }, 429);
        }
        return jsonResponse({ error: "recovery-mail-failed", status: sent.status, detail: sent.detail }, 502);
      }
    }

    const sentAt = new Date().toISOString();
    const admin = adminClient();

    // 4) Vastleggen dat de mail weg is. Bestaat de rol-rij al, dan raken we
    //    app_role níet aan (een owner mag hier niet gedemoveerd worden — dat
    //    deed de oude versie wel, via een blinde upsert op 'member').
    const existingRole = await fetchRoleRow(admin, target.id);
    let roleWarning: string | null = null;
    if (existingRole) {
      const patch: Record<string, unknown> = { invite_sent_at: sentAt };
      if (display_name && display_name !== existingRole.display_name) patch.display_name = display_name;
      const { error } = await admin.from("user_roles").update(patch).eq("user_id", target.id);
      if (error) roleWarning = error.message;
    } else {
      const { error } = await admin.from("user_roles").insert({
        user_id: target.id,
        app_role: "member",
        display_name: display_name || null,
        invite_sent_at: sentAt,
      });
      if (error) roleWarning = error.message;
    }

    // 5) Metadata bijwerken zodat "bewust uitgestelde invite" niet blijft
    //    staan nadat de mail alsnog verstuurd is. GoTrue merge't user_metadata.
    try {
      await admin.auth.admin.updateUserById(target.id, {
        user_metadata: { invite_deferred: false, invite_sent_at: sentAt },
      });
    } catch { /* metadata is een hint, geen waarheid — invite_sent_at staat in user_roles */ }

    if (roleWarning) {
      return jsonResponse({
        warning: "mail-sent-but-invite-timestamp-not-stored",
        mode,
        user_id: target.id,
        email,
        error: roleWarning,
        message: "De mail is verstuurd, maar het tijdstip kon niet worden opgeslagen. De lijst zegt daarom nog 'nog niet uitgenodigd'.",
      }, 207);
    }

    return jsonResponse({
      success: true,
      mode,
      user_id: target.id,
      email,
      display_name: display_name || existingRole?.display_name || null,
      invite_sent_at: sentAt,
      message: mode === "invite"
        ? "Uitnodiging verstuurd. De gebruiker krijgt een mail met een set-wachtwoord-link."
        : "Uitnodiging verstuurd. De gebruiker krijgt een mail waarmee hij zijn wachtwoord kan instellen.",
    });
  } catch (e: any) {
    return jsonResponse({ error: e?.message || String(e) }, 500);
  }
});
