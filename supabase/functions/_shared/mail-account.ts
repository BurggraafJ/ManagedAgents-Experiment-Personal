// mail-account.ts — één plek waar de Outlook-mailbox + credential vandaan komt.
//
// Vóór 2026-09-02 haalden mail-sync-etl-v2, mail-backfill, mail-reconcile,
// outlook-calendar-sync-etl en outlook-live alle vijf `composio_user_id` +
// `composio_connection_id` uit dezelfde agent_config-rijen, met hardcoded
// fallback 'user-jelle'. Er was geen registry die "app-user → mailbox →
// connectie" vastlegde, dus "één mailbox per keer" was niet uitdrukbaar.
//
// Nu: `mail_accounts` is de bron, `claim_next_mail_account(purpose)` de
// round-robin-claim (FOR UPDATE SKIP LOCKED, oudste claim eerst). agent_config
// blijft fallback zolang de registry nog leeg is — één account gedraagt zich
// daarmee exact als vandaag.
//
// Zie MAIL-PIPELINE.md §3.1/§3.2 en CLAUDE.md.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type ClaimPurpose = "sync" | "reconcile" | "backfill" | "enrich" | "calendar";

export interface MailAccount {
  account_id: string | null;
  user_id: string;
  mailbox_email: string | null;
  own_domains: string[];
  provider: string;
  composio_user_id: string | null;
  composio_connection_id: string | null;
  scope: string;
  folder_names: string[] | null;
  /** true = uit de registry geclaimd; false = agent_config-fallback. */
  from_registry: boolean;
}

/** Vault-first config-lookup, zelfde patroon als in de ETL's zelf. */
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
 * Fallback voor het één-mailbox-tijdperk: `mail_accounts` is nog LEEG (migratie A
 * niet gelopen). Dan komt de connectie uit agent_config, zoals vóór de registry.
 *
 * De eigenaar wordt NIET geraden: alleen als er precies één distinct
 * `mail_messages.user_id` bestaat is die eenduidig. Bij nul of meerdere gooien
 * we — stil op de kolom-DEFAULT landen is exact de faalmodus die deze
 * wijziging uitbant.
 */
async function legacyAccount(
  supabase: SupabaseClient,
  agentName: string,
): Promise<MailAccount> {
  const userId = (await getCfg(supabase, agentName, "composio_user_id"))
    ?? (await getCfg(supabase, "global", "composio_user_id"))
    ?? "user-jelle";
  const connectionId = (await getCfg(supabase, agentName, "composio_connection_id"))
    ?? (await getCfg(supabase, "mail-sync-etl-v2", "composio_connection_id"));

  const { data: owners } = await supabase.rpc("single_mail_owner_user_id");
  const owner = typeof owners === "string" && owners.length > 0 ? owners : null;
  if (!owner) {
    throw new Error(
      "mail_account_unresolved: mail_accounts is leeg en de eigenaar van de " +
      "bestaande mailbox is niet eenduidig. Run migratie " +
      "mail_accounts_a_registry_2026_09_02.sql (seed) eerst.",
    );
  }

  return {
    account_id: null,
    user_id: owner,
    mailbox_email: null,
    own_domains: [],
    provider: "composio",
    composio_user_id: userId,
    composio_connection_id: connectionId,
    scope: "org",
    folder_names: null,
    from_registry: false,
  };
}

/**
 * Claimt één mailbox voor dit doel.
 *
 * `null` = de registry heeft rijen maar geen enkele claimbare (alles disabled of
 * paused). Dat is een BEWUSTE toestand — de caller hoort te skippen, niet terug
 * te vallen op agent_config: anders zou "mailbox pauzeren" stil niets doen.
 *
 * Gooit als de registry leeg is én de eigenaar niet eenduidig is (zie
 * legacyAccount).
 */
export async function claimMailAccount(
  supabase: SupabaseClient,
  purpose: ClaimPurpose,
  legacyAgentName: string,
): Promise<MailAccount | null> {
  const { data, error } = await supabase.rpc("claim_next_mail_account", { p_purpose: purpose });
  if (error) throw new Error(`claim_next_mail_account_failed: ${error.message}`);

  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  if (row) {
    const folderNames = Array.isArray(row.folder_names)
      ? (row.folder_names as string[]).filter((n) => typeof n === "string")
      : null;
    return {
      account_id: row.account_id as string,
      user_id: row.account_user_id as string,
      mailbox_email: (row.mailbox_email as string) ?? null,
      own_domains: Array.isArray(row.own_domains) ? row.own_domains as string[] : [],
      provider: (row.provider as string) ?? "composio",
      // Registry-rij zonder credential (seed liep vóór agent_config): val terug.
      composio_user_id: (row.composio_user_id as string)
        ?? (await getCfg(supabase, legacyAgentName, "composio_user_id"))
        ?? (await getCfg(supabase, "global", "composio_user_id")),
      composio_connection_id: (row.composio_connection_id as string)
        ?? (await getCfg(supabase, "mail-sync-etl-v2", "composio_connection_id")),
      scope: (row.scope as string) ?? "personal",
      folder_names: folderNames && folderNames.length > 0 ? folderNames : null,
      from_registry: true,
    };
  }

  // Niets geclaimd. Twee heel verschillende situaties, en ze mogen niet
  // dezelfde uitkomst krijgen.
  const { count } = await supabase
    .from("mail_accounts").select("id", { count: "exact", head: true });
  if ((count ?? 0) > 0) return null;   // bewust uitgezet/gepauzeerd → skip

  const legacy = await legacyAccount(supabase, legacyAgentName);
  if (!legacy.composio_connection_id) return null;
  return legacy;
}

/**
 * Hoeveel mailboxen zijn er op dit moment claimbaar?
 *
 * `0` betekent twee heel verschillende dingen en de caller moet ze uit elkaar
 * kunnen houden: de registry is leeg (→ `claimMailAccount` valt terug op
 * agent_config, één pass) of alles staat bewust uit/gepauzeerd (→ skippen).
 * Vandaar `{ claimbaar, registry_leeg }` in plaats van één getal.
 */
export async function countClaimableMailAccounts(
  supabase: SupabaseClient,
): Promise<{ claimbaar: number; registry_leeg: boolean }> {
  const { count: totaal } = await supabase
    .from("mail_accounts").select("id", { count: "exact", head: true });
  if ((totaal ?? 0) === 0) return { claimbaar: 0, registry_leeg: true };

  const { count: open } = await supabase
    .from("mail_accounts").select("id", { count: "exact", head: true })
    .eq("enabled", true).eq("paused", false);
  return { claimbaar: open ?? 0, registry_leeg: false };
}

/** Begrenzing van één invocatie. Beide grenzen zijn hard; de eerste die raakt wint. */
export interface AccountLoopLimits {
  /** Bovengrens op het aantal mailboxen in deze aanroep. Zet de cadans-formule. */
  maxAccounts: number;
  /** Wall-clock budget in ms. Ná deze grens claimt de lus geen nieuwe mailbox meer. */
  maxWallMs: number;
}

/** Wat één mailbox in deze invocatie heeft gedaan — telemetrie per eigenaar. */
export interface AccountPass {
  account_id: string | null;
  mailbox_email: string | null;
  account_user_id: string;
  account_source: "mail_accounts" | "agent_config_fallback";
  account_scope: string;
  ok: boolean;
  error: string | null;
  duration_ms: number;
  /** Tellers van de ETL zelf (mails, folders, events). Door `handle` gevuld. */
  detail: Record<string, unknown>;
}

export interface AccountLoopResult {
  passes: AccountPass[];
  /** Waarom de lus stopte. Staat in stats, zodat "te weinig tijd" zichtbaar is. */
  stop_reason:
    | "max_accounts"        // de bovengrens uit AccountLoopLimits
    | "wall_budget"         // tijd op — de rest komt de volgende cron-tik
    | "ronde_rond"          // elke claimbare mailbox is geweest
    | "geen_claimbaar_account";  // registry heeft rijen, allemaal uit/gepauzeerd
  claimbaar: number;
}

/**
 * Draait `handle` over MEERDERE mailboxen in één invocatie, begrensd.
 *
 * ── Waarom (S5) ─────────────────────────────────────────────────────────────
 * Tot v1.219 claimde elke ETL-aanroep precies één mailbox. De cadans deelde
 * daarmee door het aantal mailboxen: bij zes mailboxen kwam mail elke 30 min
 * binnen in plaats van elke 5, en de agenda elke 90 min. Dat is geen
 * beveiligingsgat maar wel het eerste wat een tweede gebruiker merkt.
 *
 * De knop die hier omgaat is *alleen* het aantal mailboxen per aanroep. De
 * cron-schema's blijven ongemoeid — één knop tegelijk, zodat een meting ná de
 * merge over precies één oorzaak gaat.
 *
 * ── Wat behouden blijft ─────────────────────────────────────────────────────
 *  • `FOR UPDATE SKIP LOCKED` en de round-robin-ordening: de lus roept dezelfde
 *    `claim_next_mail_account(purpose)` N keer aan. Elke claim zet
 *    `last_claim_at[purpose] = now()`, dus de volgende aanroep krijgt per
 *    definitie de volgende mailbox. Er is geen tweede kopie van de claim-regel
 *    in SQL — die staat op één plek en dat blijft zo.
 *  • **Per-eigenaar-isolatie.** Eén kapotte mailbox laat de andere niet vallen:
 *    de `handle` draait per mailbox in een eigen try/catch en de fout landt in
 *    `finish_mail_account_claim` van díe mailbox.
 *  • **Retries.** Een mislukte mailbox houdt zijn plek in de round-robin: de
 *    claim is al gezet, dus hij komt gewoon weer aan de beurt.
 *  • **Begrensde looptijd.** `maxWallMs` stopt het claimen vóór de
 *    gateway-idle-timeout. Zelfde vorm als `mail-backfill` (5 buckets × 60 s),
 *    die dit patroon sinds v1.4 draait.
 *
 * `handle` geeft `null` terug bij succes, of een korte foutregel — die gaat
 * één-op-één naar `finish_mail_account_claim`, net als vóór deze wijziging.
 * In `ctx.detail` mag de ETL zijn eigen tellers voor déze mailbox kwijt; die
 * landen in de `AccountPass` en dus in `agent_runs.stats`.
 */
export async function forEachClaimedMailAccount(
  supabase: SupabaseClient,
  purpose: ClaimPurpose,
  legacyAgentName: string,
  limits: AccountLoopLimits,
  handle: (
    account: MailAccount,
    ctx: { pass: number; detail: Record<string, unknown> },
  ) => Promise<string | null>,
): Promise<AccountLoopResult> {
  const startedMs = Date.now();
  const { claimbaar, registry_leeg } = await countClaimableMailAccounts(supabase);

  // Lege registry = het één-mailbox-tijdperk: precies één pass langs de
  // agent_config-fallback. Anders nooit méér passes dan er mailboxen zijn —
  // dat scheelt een overbodige claim die `last_sync_started_at` zou verzetten
  // voor een sync die niet meer gaat lopen.
  const rondes = registry_leeg ? 1 : Math.min(limits.maxAccounts, claimbaar);

  const passes: AccountPass[] = [];
  const gezien = new Set<string>();
  let stopReason: AccountLoopResult["stop_reason"] =
    rondes === 0 ? "geen_claimbaar_account" : "ronde_rond";

  for (let i = 0; i < rondes; i++) {
    if (i > 0 && Date.now() - startedMs >= limits.maxWallMs) { stopReason = "wall_budget"; break; }

    const account = await claimMailAccount(supabase, purpose, legacyAgentName);
    if (!account) { stopReason = i === 0 ? "geen_claimbaar_account" : "ronde_rond"; break; }

    // Vangnet: als de registry tijdens de lus krimpt (iemand pauzeert een
    // mailbox) geeft de claim dezelfde rij terug. Twee keer dezelfde mailbox
    // in één invocatie is geen cadans-winst maar dubbel werk.
    const sleutel = account.account_id ?? `legacy:${account.user_id}`;
    if (gezien.has(sleutel)) { stopReason = "ronde_rond"; break; }
    gezien.add(sleutel);

    const t0 = Date.now();
    const detail: Record<string, unknown> = {};
    let fout: string | null = null;
    try {
      fout = await handle(account, { pass: i, detail });
    } catch (err) {
      fout = err instanceof Error ? err.message : String(err);
    }
    await finishMailAccountClaim(supabase, account, fout ? fout.slice(0, 300) : null);

    passes.push({
      account_id: account.account_id,
      mailbox_email: account.mailbox_email,
      account_user_id: account.user_id,
      account_source: account.from_registry ? "mail_accounts" : "agent_config_fallback",
      account_scope: account.scope,
      ok: fout === null,
      error: fout,
      duration_ms: Date.now() - t0,
      detail,
    });

    if (i === rondes - 1 && rondes === limits.maxAccounts && claimbaar > rondes) {
      stopReason = "max_accounts";
    }
  }

  return { passes, stop_reason: stopReason, claimbaar };
}

/** Sluit de claim af (telemetrie + stilval-detectie per mailbox). */
export async function finishMailAccountClaim(
  supabase: SupabaseClient,
  account: MailAccount | null,
  errorMessage: string | null,
): Promise<void> {
  if (!account?.account_id) return;
  await supabase.rpc("finish_mail_account_claim", {
    p_account_id: account.account_id,
    p_error: errorMessage,
  });
}

/**
 * Adressen die als "van mij" gelden. Exact-match op de mailbox zelf plus de
 * expliciete alias-lijst uit agent_config('mail-sync','from_addresses').
 *
 * NIET op own_domains matchen: dan zou elke collega op hetzelfde domein
 * is_from_me=true krijgen en het Sent-corpus (stijlprofiel,
 * analyze_sent_style_corpus, mail_threads.has_my_reply) vervuilen.
 */
export async function ownFromAddresses(
  supabase: SupabaseClient,
  account: MailAccount,
): Promise<string[]> {
  const addrs = new Set<string>();
  if (account.mailbox_email) addrs.add(account.mailbox_email.toLowerCase());

  const { data: cfg } = await supabase.from("agent_config").select("config_value")
    .eq("agent_name", "mail-sync").eq("config_key", "from_addresses").maybeSingle();
  if (cfg?.config_value && Array.isArray(cfg.config_value)) {
    for (const a of cfg.config_value as string[]) {
      if (typeof a === "string" && a) addrs.add(a.toLowerCase());
    }
  }

  // Laatste redmiddel: het gedrag van vóór de registry.
  if (addrs.size === 0) addrs.add("burggraaf@legal-mind.nl");
  return Array.from(addrs);
}
