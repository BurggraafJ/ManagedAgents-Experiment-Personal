// outlook-ctx.ts — welke mailbox hoort bij de INGELOGDE caller.
//
// Gelicht uit `outlook-live/index.ts` (v3, 2026-09-02) zodat beide
// browser-functies — `outlook-live` en `outlook-calendar-live` — dezelfde
// B3-fix delen in plaats van er elk een kopie van te hebben. Dat is dezelfde
// les als bij de slugs: twee kopieën van een beveiligingsregel lopen uit
// elkaar, en de helft die achterblijft merk je niet.
//
// ── Wat B3 was ──────────────────────────────────────────────────────────────
// Tot v2 checkte `outlook-live` alleen `role === 'authenticated'` en pakte dan
// de vaste org-connectie uit `agent_config`. Elke tweede dashboard-gebruiker
// las daarmee Jelle's mailbox — en zou nu, met de agenda-schrijfbaan erbij, in
// Jelle's agenda schrijven. De mailbox wordt daarom bepaald door de `sub` uit
// de (door de gateway al gevalideerde) JWT. Geen rij in `mail_accounts` = geen
// mailbox: expliciet `no_mailbox_for_user`, nooit een stille terugval op de
// org-connectie. Dat laatste is het hele punt — een fallback die "meestal goed
// gaat" is hier een lek.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { OutlookCtx } from "./outlook-exec.ts";

export interface CallerCtx extends OutlookCtx {
  /** `mail_accounts.user_id` — de eigenaar van deze mailbox (= de caller). */
  ownerUserId: string;
  mailboxEmail: string | null;
}

/** Gateway (verify_jwt) checkt de handtekening al; hier alleen de claims lezen. */
export function jwtClaims(req: Request): { role: string | null; sub: string | null } {
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    return {
      role: typeof payload.role === "string" ? payload.role : null,
      sub: typeof payload.sub === "string" ? payload.sub : null,
    };
  } catch {
    return { role: null, sub: null };
  }
}

export async function getCfg(
  supabase: SupabaseClient,
  agentName: string,
  key: string,
): Promise<string | null> {
  const { data: vaultValue } = await supabase.rpc("get_skill_secret_service", {
    p_skill_name: agentName,
    p_secret_name: key,
  });
  if (typeof vaultValue === "string" && vaultValue.length > 0) return vaultValue;
  const { data } = await supabase.from("agent_config").select("config_value")
    .eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === "string" ? data.config_value : String(data.config_value);
}

/**
 * De mailbox van de ingelogde gebruiker. `caller` is de `sub` uit de door de
 * gateway gevalideerde JWT.
 *
 * Geen `maybeSingle()`: met twee mailboxen zijn dat twee rijen en dan faalt die
 * hard met PGRST116 — precies de eerste zichtbare crash bij mailbox #2.
 */
export async function buildCtxForCaller(
  supabase: SupabaseClient,
  caller: string,
): Promise<CallerCtx> {
  const apiKey = await getCfg(supabase, "global", "composio_api_key");
  if (!apiKey) throw new Error("composio_api_key_missing");

  const { data: acct } = await supabase.from("mail_accounts")
    .select("user_id, mailbox_email, composio_user_id, composio_connection_id, enabled, paused")
    .eq("user_id", caller).eq("enabled", true).eq("paused", false)
    .order("created_at", { ascending: true })
    .limit(1);
  const account = Array.isArray(acct) && acct.length > 0 ? acct[0] : null;
  if (!account) throw new Error("no_mailbox_for_user");

  const userId = (account.composio_user_id as string)
    ?? (await getCfg(supabase, "mail-sync-etl-v2", "composio_user_id"))
    ?? (await getCfg(supabase, "global", "composio_user_id")) ?? "user-jelle";
  const connectionId = (account.composio_connection_id as string)
    ?? (await getCfg(supabase, "mail-sync-etl-v2", "composio_connection_id"));
  if (!connectionId) throw new Error("composio_connection_id_missing");

  return {
    apiKey,
    userId,
    connectionId,
    ownerUserId: account.user_id as string,
    mailboxEmail: (account.mailbox_email as string) ?? null,
  };
}
