// Edge Function: create-user
// ----------------------------------------------------------------------------
// Maakt een gebruiker aan ZONDER één mail te versturen. Dat is het hele punt
// van deze functie: aanmaken is een andere handeling dan uitnodigen.
//
//   createUser({ email, email_confirm: true, user_metadata: {
//     display_name, invite_deferred: true, invite_sent_at: null } })
//   + rij in public.user_roles met app_role 'member' en invite_sent_at NULL
//
// Wat hier NIET mag staan, nu of later: inviteUserByEmail, generateLink,
// /auth/v1/recover, of enige andere call die GoTrue laat mailen. De
// uitnodigingsmail hoort in invite-user, achter een expliciete klik van de
// owner. Belandt er hier ooit een mail-call in, dan is "aangemaakt ≠
// uitgenodigd" weer weg en mailt het systeem mensen aan die daar nog niet
// klaar voor zijn.
//
// email_confirm: true — het adres komt van de owner uit de admin-UI, niet van
// een zelfregistratie. De gebruiker zet zijn wachtwoord straks via de
// set-wachtwoord-mail die invite-user stuurt.
//
// Wie mag dit aanroepen: alleen een ingelogde owner (verify_jwt = true op de
// gateway + requireOwner in de body). Rol is altijd 'member': een tweede owner
// aanmaken is een bewuste uitzondering die niet via deze knop hoort te lopen
// (single-owner-model, migratie security_hardening_b).
//
// Project — Gebruikers: aanmaken ≠ uitnodigen, 2026-09-12.

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
} from "../_shared/admin-users.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method-not-allowed" }, 405);

  try {
    const gate = await requireOwner(req);
    if (!gate.ok) return gate.response!;

    let payload: { email?: string; display_name?: string; dry_run?: boolean };
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: "invalid-json" }, 400);
    }
    const email = (payload.email || "").trim().toLowerCase();
    const display_name = (payload.display_name || "").trim();
    if (!email || !EMAIL_RE.test(email)) return jsonResponse({ error: "invalid-email" }, 400);

    // Bestaat hij al? Dan geen tweede account en geen aanpassing van de rol —
    // de owner moet zien wat er is, niet stilzwijgend iets overschrijven.
    const existing = await findAuthUserByEmail(email);
    if (existing) {
      const admin = adminClient();
      const role = await fetchRoleRow(admin, existing.id);
      return jsonResponse({
        error: "user-already-exists",
        user_id: existing.id,
        email,
        app_role: role?.app_role ?? null,
        invite_sent_at: role?.invite_sent_at ?? null,
        message: "Deze gebruiker bestaat al. Uitnodigen kan via de knop Uitnodigen in de lijst.",
      }, 409);
    }

    // Dry-run: alles behalve schrijven. Handig om de gate en de validatie te
    // testen zonder een account achter te laten.
    if (payload.dry_run) {
      return jsonResponse({
        success: true,
        dry_run: true,
        email,
        display_name: display_name || null,
        would: "create-auth-user-and-member-role-without-mail",
      });
    }

    const admin = adminClient();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        display_name: display_name || null,
        // Expliciet in de metadata zodat je ook buiten de app ziet dat dit
        // account bewust zonder mail is aangemaakt.
        invite_deferred: true,
        invite_sent_at: null,
      },
    });
    if (createErr) return jsonResponse({ error: `create-failed: ${createErr.message}` }, 400);
    const newUserId = created.user?.id;
    if (!newUserId) return jsonResponse({ error: "no-user-returned" }, 500);

    // user_roles: member, invite_sent_at bewust NULL — de lijst laat dat zien
    // als "Uitnodiging: nog niet".
    const { error: roleError } = await admin
      .from("user_roles")
      .upsert({
        user_id: newUserId,
        app_role: "member",
        display_name: display_name || null,
        invite_sent_at: null,
      }, { onConflict: "user_id" });

    if (roleError) {
      // Auth-user staat er wel, rol-rij niet. Half werk, dus melden met 207:
      // de owner moet weten dat deze gebruiker nog geen rol heeft.
      return jsonResponse({
        warning: "user-created-but-role-insert-failed",
        user_id: newUserId,
        email,
        error: roleError.message,
      }, 207);
    }

    return jsonResponse({
      success: true,
      user_id: newUserId,
      email,
      display_name: display_name || null,
      invite_sent_at: null,
      message: "Gebruiker aangemaakt. Er is geen mail verstuurd — gebruik Uitnodigen zodra hij erin mag.",
    });
  } catch (e: any) {
    return jsonResponse({ error: e?.message || String(e) }, 500);
  }
});
