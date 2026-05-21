// Edge Function: invite-user
// ----------------------------------------------------------------------------
// Maakt een nieuwe member aan: verstuurt invite-mail via Supabase Auth Admin
// API en schrijft een rij in public.user_roles met app_role='member'.
//
// Wie mag dit aanroepen: caller-JWT moet horen bij een user met app_role
// 'owner' (gechecked via RPC current_user_role()). Anders 403.
//
// Project — Multi-user Access (Confluence 454819841), 2026-05-22.

// deno-lint-ignore-file no-explicit-any
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method-not-allowed" }, 405);

  try {
    // 1) Verify caller-JWT
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "missing-auth" }, 401);
    const userJwt = authHeader.replace("Bearer ", "");

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${userJwt}` } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return jsonResponse({ error: "invalid-token" }, 401);

    // 2) Check owner-role via RPC (respecteert RLS-context)
    const { data: roleResult, error: rpcErr } = await userClient.rpc("current_user_role");
    if (rpcErr) return jsonResponse({ error: `rpc-failed: ${rpcErr.message}` }, 500);
    if (roleResult !== "owner") return jsonResponse({ error: "forbidden" }, 403);

    // 3) Body parsen
    let payload: { email?: string; display_name?: string };
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: "invalid-json" }, 400);
    }
    const email = (payload.email || "").trim().toLowerCase();
    const display_name = (payload.display_name || "").trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: "invalid-email" }, 400);
    }

    // 4) Invite user via Auth Admin API (service-role)
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: inviteResult, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email);
    if (inviteError) return jsonResponse({ error: `invite-failed: ${inviteError.message}` }, 400);
    const newUserId = inviteResult.user?.id;
    if (!newUserId) return jsonResponse({ error: "no-user-returned" }, 500);

    // 5) Schrijf user_roles rij (member). Idempotent via ON CONFLICT.
    const { error: roleError } = await adminClient
      .from("user_roles")
      .upsert({
        user_id: newUserId,
        app_role: "member",
        display_name: display_name || null,
      }, { onConflict: "user_id" });

    if (roleError) {
      // Auth user bestaat al — semi-succes; meld het zodat owner weet wat te doen.
      return jsonResponse({
        warning: "user-invited-but-role-insert-failed",
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
      message: "Member uitgenodigd. Hij/zij krijgt een email van Supabase met een set-password-link.",
    });
  } catch (e: any) {
    return jsonResponse({ error: e?.message || String(e) }, 500);
  }
});
