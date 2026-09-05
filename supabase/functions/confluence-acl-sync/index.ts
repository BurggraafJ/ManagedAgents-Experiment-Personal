// =============================================================================
// confluence-acl-sync — spiegelt Confluence's LEESRECHTEN                v1.0
// =============================================================================
// ⛔ verify_jwt: FALSE. Wordt door pg_cron aangeroepen en doet zijn eigen auth
// (cron_secret OF service-role via `requireCronOrServiceRole`). Op
// verify_jwt:true weigert de gateway de cron-bearer met 401 vóór de body en
// valt de functie stil — de P0 van 2026-06-02 met de chunker. Zie CLAUDE.md.
//
// ── Wat hij doet ────────────────────────────────────────────────────────────
//
// `confluence-sync-etl` spiegelt de INHOUD. Deze functie spiegelt wie die
// inhoud mag ZIEN, want dat is niet vlak: gemeten 2026-09-05 geeft elke
// gespiegelde space read aan `confluence-users-bg-intelligence` (iedereen met
// een licentie) BEHALVE `MT` — daar hangt read aan vijf met naam genoemde
// personen. Zonder deze functie zou elke Maestro-gebruiker MT kunnen bevragen.
//
// Drie stappen:
//   1. spaces        → `confluence_spaces` (naam, type, status, is_mirrored)
//   2. permissies    → read-principals per space, groepen uitgeklapt naar leden
//   3. identiteiten  → Maestro-user ⇄ Atlassian-accountId, dan
//                      `confluence_recompute_grants()`
//
// ── Waarom groepen hier worden uitgeklapt en niet in SQL ────────────────────
//
// `confluence_spaces.read_account_ids` bevat het EFFECTIEVE resultaat: met naam
// genoemde lezers plus de leden van elke leesgroep. Dan is de grant-berekening
// in Postgres één array-vergelijking en hoeft de database niets van Atlassian's
// groepsmodel te weten. Kost hier ~2 extra calls per ronde (de ledenlijst wordt
// gecached over spaces heen), en de rechten wijzigen ~nooit.
//
// ── Waarom e-mail de sleutel is ─────────────────────────────────────────────
//
// Atlassian verbergt `email` van accounts buiten de eigen organisatie (gemeten:
// leeg voor externe leden, gevuld voor `@legal-mind.nl`). Precies de Maestro-
// gebruikers zijn dus matchbaar. Voorkeursbron is
// `user_connectors(provider='confluence').account_email` — heeft de gebruiker
// zélf gekoppeld, dan IS dat zijn identiteit. Anders `auth.users.email`. Geen
// match = geen identiteit = geen enkele space; raden wie iemand in Confluence
// is, is precies de fout die dit moet voorkomen. Handmatig gezette rijen
// (`source='manual'`) worden nooit overschreven.
// =============================================================================

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { requireCronOrServiceRole } from '../_shared/edge-auth.ts';
import { getCfg } from '../_shared/mail-account.ts';

const SKILL_VERSION = 'confluence-acl-sync-v1.0';
const DEFAULT_OPEN_GROUPS = ['confluence-users-bg-intelligence', 'confluence-users-legal-mind'];
const DEFAULT_SPACES = ['LM', 'LM1', 'LE', 'LE1', 'AI', 'MT', 'BI', 'Marketing'];
const SAFE_SPACE_KEY = /^[A-Za-z0-9]{1,64}$/;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_WALL_TIME_MS = 110_000;
const SAFETY_MARGIN_MS = 15_000;
const PAGE_LIMIT = 250;
const MAX_ROUNDS = 20;          // paginering-rem, zoals in confluence-sync-etl

interface Ctx { auth: string; site: string }

async function buildCtx(supabase: SupabaseClient): Promise<Ctx> {
  const token = await getCfg(supabase, 'global', 'atlassian_api_token');
  if (!token) throw new Error('atlassian_api_token_missing in Vault(skill:global:atlassian_api_token)');
  const email = await getCfg(supabase, 'global', 'atlassian_email');
  if (!email) throw new Error('atlassian_email_missing in agent_config(global, atlassian_email)');
  const siteRaw = await getCfg(supabase, 'global', 'atlassian_site');
  if (!siteRaw) throw new Error('atlassian_site_missing in agent_config(global, atlassian_site)');
  const site = siteRaw.replace(/^https?:\/\//, '').replace(/\.atlassian\.net.*$/i, '');
  return { auth: btoa(`${email}:${token}`), site };
}

async function cf(ctx: Ctx, path: string): Promise<any> {
  const res = await fetch(`https://${ctx.site}.atlassian.net${path}`, {
    headers: { Authorization: `Basic ${ctx.auth}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`confluence_${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { throw new Error(`confluence_non_json: ${text.slice(0, 200)}`); }
}

/**
 * Cursor-paginering over een v2-endpoint. `_links.next` is hier de betrouwbare
 * weg (net als in confluence-sync-etl); de rem "elke ronde moet iets nieuws
 * opleveren" zit erop omdat een paging-bug een cron-functie stil kan laten
 * rondjes draaien.
 */
async function pageAll(ctx: Ctx, first: string, key: (row: any) => string): Promise<any[]> {
  const out: any[] = [];
  const seen = new Set<string>();
  let path: string | null = first;
  for (let round = 0; path && round < MAX_ROUNDS; round++) {
    const j = await cf(ctx, path);
    const rows: any[] = Array.isArray(j?.results) ? j.results : [];
    let fresh = 0;
    for (const r of rows) {
      const k = key(r);
      if (k && !seen.has(k)) { seen.add(k); out.push(r); fresh++; }
    }
    if (rows.length === 0 || fresh === 0) break;
    const next = j?._links?.next;
    path = typeof next === 'string' && next.length > 0
      ? (next.startsWith('/wiki') ? next : `/wiki${next}`)
      : null;
  }
  return out;
}

/** Leden van een groep, gecached over spaces heen. */
const groupMembers = new Map<string, string[]>();
async function membersOf(ctx: Ctx, groupId: string): Promise<string[]> {
  if (groupMembers.has(groupId)) return groupMembers.get(groupId)!;
  let ids: string[] = [];
  try {
    const rows = await pageAll(
      ctx,
      `/wiki/rest/api/group/${encodeURIComponent(groupId)}/membersByGroupId?limit=200`,
      (r) => String(r?.accountId ?? ''),
    );
    ids = rows.map((r) => String(r.accountId)).filter(Boolean);
  } catch (_e) { ids = []; }
  groupMembers.set(groupId, ids);
  return ids;
}

/** accountId → e-mail (leeg als Atlassian hem verbergt), gecached. */
const accountEmail = new Map<string, { email: string; name: string }>();
async function accountInfo(ctx: Ctx, accountId: string): Promise<{ email: string; name: string }> {
  if (accountEmail.has(accountId)) return accountEmail.get(accountId)!;
  let info = { email: '', name: '' };
  try {
    const j = await cf(ctx, `/wiki/rest/api/user?accountId=${encodeURIComponent(accountId)}`);
    info = { email: String(j?.email ?? '').toLowerCase(), name: String(j?.displayName ?? j?.publicName ?? '') };
  } catch (_e) { /* verborgen of verwijderd account: leeg laten */ }
  accountEmail.set(accountId, info);
  return info;
}

Deno.serve(async (req) => {
  const startTime = Date.now();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const gate = await requireCronOrServiceRole(req, supabase);
  if (!gate.ok) return gate.response;

  const startedAt = new Date().toISOString();
  const counts = {
    spaces_seen: 0, spaces_mirrored: 0, spaces_restricted: 0,
    identities: 0, identities_new: 0, grants: 0, groups_expanded: 0,
  };
  const stats: Record<string, unknown> = {
    schema_version: '1', skill_version: SKILL_VERSION,
    triggered_by: gate.via ?? 'unknown', triggered_at: startedAt,
    counts, extra: {}, warnings: [] as string[],
  };
  const warn = (m: string) => (stats.warnings as string[]).push(m.slice(0, 200));

  const { data: runIns } = await supabase.from('agent_runs').insert({
    agent_name: 'confluence-acl-sync', run_type: 'edge_function', status: 'running',
    started_at: startedAt, stats, errors: [],
  }).select('id').single();
  const runId = runIns?.id ?? null;

  try {
    const ctx = await buildCtx(supabase);
    const deadline = startTime + MAX_WALL_TIME_MS - SAFETY_MARGIN_MS;

    // ── config ───────────────────────────────────────────────────────────────
    const { data: spaceCfg } = await supabase.from('agent_config').select('config_value')
      .eq('agent_name', 'confluence-sync-etl').eq('config_key', 'spaces').maybeSingle();
    const mirrored = (Array.isArray(spaceCfg?.config_value) ? spaceCfg!.config_value : DEFAULT_SPACES)
      .map((x: unknown) => String(x)).filter((k: string) => SAFE_SPACE_KEY.test(k));

    const { data: groupCfg } = await supabase.from('agent_config').select('config_value')
      .eq('agent_name', 'confluence-acl').eq('config_key', 'open_groups').maybeSingle();
    const openGroups = (Array.isArray(groupCfg?.config_value) ? groupCfg!.config_value : DEFAULT_OPEN_GROUPS)
      .map((x: unknown) => String(x).toLowerCase());

    // ── 1. spaces ────────────────────────────────────────────────────────────
    const spaces = await pageAll(ctx, `/wiki/api/v2/spaces?limit=${PAGE_LIMIT}`, (r) => String(r?.id ?? ''));
    counts.spaces_seen = spaces.length;

    // Pagina-aantallen uit de spiegel, niet uit Confluence: dit is de kolom die
    // zegt hoeveel er van deze space in de INDEX zit.
    const { data: pageCounts } = await supabase.rpc('confluence_space_page_counts');
    const countBySpace = new Map<string, number>(
      (pageCounts ?? []).map((r: any) => [String(r.space_key), Number(r.n)]),
    );

    // Groepsnaam per id, één keer opgehaald: de permissie-rijen dragen alleen id's.
    const groupNames = new Map<string, string>();
    try {
      const groups = await pageAll(ctx, '/wiki/rest/api/group?limit=200', (r) => String(r?.id ?? ''));
      for (const g of groups) groupNames.set(String(g.id), String(g.name ?? ''));
    } catch (e) { warn(`groups_list: ${(e as Error).message}`); }

    const rows: Record<string, unknown>[] = [];
    for (const s of spaces) {
      const key = String(s?.key ?? '');
      if (!key) continue;
      const isMirrored = mirrored.includes(key);
      // De drie array-kolommen staan EXPLICIET in elke rij, ook als we ze niet
      // vullen. PostgREST maakt van een bulk-upsert één INSERT met de VERENIGING
      // van alle keys; een rij die een key mist krijgt daar `null` — en dat
      // botst met `not null default '{}'`. Eén niet-gespiegelde space liet
      // daarmee de hele ronde klappen (gemeten: HTTP 500 op de eerste run).
      const base = {
        space_key: key,
        space_id: String(s?.id ?? ''),
        name: String(s?.name ?? '').slice(0, 300),
        space_type: String(s?.type ?? ''),
        status: String(s?.status ?? 'current'),
        is_mirrored: isMirrored,
        page_count: countBySpace.get(key) ?? 0,
        synced_at: new Date().toISOString(),
        direct_account_ids: [] as string[],
        read_group_names: [] as string[],
        read_account_ids: [] as string[],
      };

      if (!isMirrored) {
        // Niet gespiegeld = geen chunks = permissies niet nodig. `restricted`
        // houden zodat een space die later in scope komt niet per ongeluk als
        // open in de tabel staat.
        rows.push({ ...base, visibility: 'restricted', org_baseline: false });
        continue;
      }
      counts.spaces_mirrored++;

      // Deadline: NIET wegschrijven. `base` draagt lege arrays, en die zouden
      // de bestaande — nog geldige — leesrechten van deze space overschrijven.
      // Een ronde die halverwege stopt mag rechten niet intrekken; de volgende
      // ronde pakt hem gewoon op.
      if (Date.now() > deadline) { warn(`deadline_before_space_${key}`); continue; }

      try {
        const perms = await pageAll(
          ctx, `/wiki/api/v2/spaces/${encodeURIComponent(String(s.id))}/permissions?limit=${PAGE_LIMIT}`,
          (r) => String(r?.id ?? ''),
        );
        const readers = perms.filter((p) =>
          p?.operation?.key === 'read' && p?.operation?.targetType === 'space');

        const direct: string[] = [];
        const gIds: string[] = [];
        for (const p of readers) {
          const t = String(p?.principal?.type ?? '');
          const id = String(p?.principal?.id ?? '');
          if (!id) continue;
          if (t === 'user') direct.push(id);
          else if (t === 'group') gIds.push(id);
        }
        const gNames = gIds.map((id) => groupNames.get(id) ?? id);
        const isOpen = gNames.some((n) => openGroups.includes(String(n).toLowerCase()));

        const effective = new Set<string>(direct);
        for (const gid of gIds) {
          const members = await membersOf(ctx, gid);
          if (members.length > 0) counts.groups_expanded++;
          for (const m of members) effective.add(m);
        }

        if (!isOpen) counts.spaces_restricted++;
        rows.push({
          ...base,
          visibility: isOpen ? 'open' : 'restricted',
          org_baseline: isOpen,
          direct_account_ids: direct,
          read_group_names: gNames,
          read_account_ids: Array.from(effective),
        });
      } catch (e) {
        // Eén space die weigert mag de rest niet meesleuren, maar hem stil op
        // de oude waarde laten staan is erger: dan denkt de ACL dat de rechten
        // nog kloppen. Warning én de bestaande rij ongemoeid laten.
        warn(`space_${key}: ${(e as Error).message}`);
      }
    }

    if (rows.length > 0) {
      const { error } = await supabase.from('confluence_spaces').upsert(rows, { onConflict: 'space_key' });
      if (error) throw new Error(`confluence_spaces_upsert_failed: ${error.message}`);
    }

    // ── 2. identiteiten ──────────────────────────────────────────────────────
    // Kandidaat-accounts: alles wat we in de permissies of in een leesgroep zijn
    // tegengekomen. Bounded (~40 op deze site) en daarmee goedkoop te resolven.
    const candidates = new Set<string>();
    for (const r of rows) {
      for (const id of (r.read_account_ids as string[] | undefined) ?? []) candidates.add(id);
    }
    const byEmail = new Map<string, { id: string; name: string }>();
    for (const id of candidates) {
      if (Date.now() > deadline) { warn('deadline_in_identity_resolution'); break; }
      const info = await accountInfo(ctx, id);
      if (info.email) byEmail.set(info.email, { id, name: info.name });
    }
    (stats.extra as any).resolvable_accounts = byEmail.size;

    const { data: userList, error: userErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (userErr) throw new Error(`list_users_failed: ${userErr.message}`);
    const users = userList?.users ?? [];

    const { data: conns } = await supabase.from('user_connectors')
      .select('user_id, account_email').eq('provider', 'confluence');
    const connEmail = new Map<string, string>(
      (conns ?? []).filter((c: any) => c.account_email)
        .map((c: any) => [String(c.user_id), String(c.account_email).toLowerCase()]),
    );

    const { data: existing } = await supabase.from('confluence_identities').select('user_id, source');
    const manual = new Set<string>(
      (existing ?? []).filter((r: any) => r.source === 'manual').map((r: any) => String(r.user_id)),
    );
    const known = new Set<string>((existing ?? []).map((r: any) => String(r.user_id)));

    for (const u of users) {
      if (manual.has(u.id)) continue;   // door Jelle gezet: niet overschrijven
      const connected = connEmail.get(u.id);
      const authEmail = String(u.email ?? '').toLowerCase();
      const hit = (connected && byEmail.get(connected)) || (authEmail && byEmail.get(authEmail)) || null;
      if (!hit) {
        // Geen match: geen identiteit, dus geen enkele space. Zichtbaar maken,
        // want dit is de reden dat iemand "niets uit de wiki" krijgt.
        warn(`no_atlassian_identity: ${authEmail || u.id}`);
        continue;
      }
      const source = connected && byEmail.get(connected) ? 'connector' : 'email_match';
      const { error } = await supabase.from('confluence_identities').upsert({
        user_id: u.id,
        atlassian_account_id: hit.id,
        atlassian_email: connected ?? authEmail,
        display_name: hit.name,
        source,
        resolved_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });
      if (error) { warn(`identity_${authEmail}: ${error.message}`); continue; }
      counts.identities++;
      if (!known.has(u.id)) counts.identities_new++;
    }

    // ── 3. grants herberekenen ───────────────────────────────────────────────
    const { data: granted, error: grantErr } = await supabase.rpc('confluence_recompute_grants');
    if (grantErr) throw new Error(`recompute_grants_failed: ${grantErr.message}`);
    counts.grants = Number(granted ?? 0);

    const nowIso = new Date().toISOString();
    const warned = (stats.warnings as string[]).length > 0;
    const summary = `${counts.spaces_mirrored} spaces (${counts.spaces_restricted} restricted)`
      + ` · ${counts.identities} identiteiten · ${counts.grants} grants`;

    if (runId) {
      await supabase.from('agent_runs').update({
        status: warned ? 'warning' : 'success', completed_at: nowIso, summary, stats,
      }).eq('id', runId);
    }
    return new Response(JSON.stringify({ ok: true, runId, summary, stats }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const nowIso = new Date().toISOString();
    if (runId) {
      await supabase.from('agent_runs').update({
        status: 'error', completed_at: nowIso, summary: msg.slice(0, 500), stats,
        errors: [{ message: msg, at: nowIso }],
      }).eq('id', runId);
    }
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
