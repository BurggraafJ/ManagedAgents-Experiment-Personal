// =============================================================================
// _shared/admin-users.ts — gedeelde bouwstenen voor de twee owner-only
// gebruikersfuncties: create-user (aanmaken, géén mail) en invite-user
// (uitnodigen, wél mail).
// =============================================================================
//
// Waarom gesplitst: aanmaken ≠ uitnodigen. Een account mag bestaan zonder dat
// er ooit een mail de deur uit is gegaan; de mail gaat pas als de owner op
// "Uitnodigen" klikt. Daarom staan hier alleen de stukken die ze écht delen —
// de auth-gate, het opzoeken van een bestaande auth-user en de user_roles-rij.
// De mail-logica zit uitsluitend in invite-user.
//
// Beide functies staan op verify_jwt = true: ze worden door de browser van een
// ingelogde owner aangeroepen, niet door cron (zie CLAUDE.md → hard-rule
// RAG-cron / verify_jwt).

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
export const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
export const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

export interface OwnerGate {
  ok: boolean;
  response?: Response;
  userId?: string;
}

/**
 * Caller-JWT moet bij een user met app_role 'owner' horen (RPC
 * current_user_role, die de RLS-context van de aanroeper gebruikt). Zelfde
 * gate als de oude invite-user had — hier één keer, voor beide functies.
 */
export async function requireOwner(req: Request): Promise<OwnerGate> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, response: jsonResponse({ error: "missing-auth" }, 401) };
  }
  const userJwt = authHeader.replace("Bearer ", "");
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${userJwt}` } },
    auth: { persistSession: false },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return { ok: false, response: jsonResponse({ error: "invalid-token" }, 401) };

  const { data: role, error: rpcErr } = await userClient.rpc("current_user_role");
  if (rpcErr) return { ok: false, response: jsonResponse({ error: `rpc-failed: ${rpcErr.message}` }, 500) };
  if (role !== "owner") return { ok: false, response: jsonResponse({ error: "forbidden" }, 403) };
  return { ok: true, userId: user.id };
}

export interface AuthUserSummary {
  id: string;
  email: string;
  created_at: string | null;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
  user_metadata: Record<string, any>;
}

function toSummary(u: any): AuthUserSummary {
  return {
    id: u.id,
    email: String(u.email || "").toLowerCase(),
    created_at: u.created_at ?? null,
    email_confirmed_at: u.email_confirmed_at ?? null,
    last_sign_in_at: u.last_sign_in_at ?? null,
    user_metadata: u.user_metadata ?? u.raw_user_meta_data ?? {},
  };
}

/**
 * Bestaat er al een auth-user met dit adres? Twee sporen, want we willen geen
 * "bestaat niet" horen terwijl hij er wél is (dat zou create-user een tweede
 * account laten proberen en invite-user "maak eerst aan" laten zeggen):
 *   1. GoTrue's admin-lijst met `filter` — één call, exact-match in het
 *      antwoord (filter is een LIKE, dus we checken het adres zelf na).
 *   2. Blijft dat leeg, dan pagineren over de admin-lijst. Gemaximeerd op
 *      10 × 200 users; dit project heeft er een handvol.
 */
export async function findAuthUserByEmail(email: string): Promise<AuthUserSummary | null> {
  const needle = email.trim().toLowerCase();
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  try {
    const res = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?per_page=50&filter=${encodeURIComponent(needle)}`,
      { headers },
    );
    if (res.ok) {
      const body = await res.json();
      const hit = (body?.users || []).find((u: any) => String(u.email || "").toLowerCase() === needle);
      if (hit) return toSummary(hit);
    }
  } catch { /* val terug op pagineren */ }

  const admin = adminClient();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`list-users-failed: ${error.message}`);
    const users = data?.users || [];
    const hit = users.find((u: any) => String(u.email || "").toLowerCase() === needle);
    if (hit) return toSummary(hit);
    if (users.length < 200) break;
  }
  return null;
}

export interface RoleRow {
  user_id: string;
  app_role: string;
  display_name: string | null;
  invite_sent_at: string | null;
}

export async function fetchRoleRow(admin: any, userId: string): Promise<RoleRow | null> {
  const { data, error } = await admin
    .from("user_roles")
    .select("user_id, app_role, display_name, invite_sent_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`role-read-failed: ${error.message}`);
  return (data as RoleRow) ?? null;
}
