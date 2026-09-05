// =============================================================================
// confluence-sync-etl — org-brede Confluence-spiegel                    v1.0
// =============================================================================
// ⛔ verify_jwt: FALSE. Deze functie wordt door pg_cron aangeroepen en doet zijn
// eigen auth (cron_secret OF service-role via `requireCronOrServiceRole`). Op
// verify_jwt:true weigert de gateway de cron-bearer met 401 vóór de body en valt
// de functie stil — precies de P0 van 2026-06-02 met de chunker. Zie CLAUDE.md.
//
// ── Wat hij doet ────────────────────────────────────────────────────────────
//
// Leest Confluence-pagina's uit de geconfigureerde spaces en zet ze in
// `confluence_pages` als PLATTE TEKST. De chunker pakt ze daarna op als
// `source='confluence'` en dán — en pas dán — vindt de chat ze via
// `semantic_search`. Er is geen live Confluence-zoektool in `rag-chat`, en die
// komt er ook niet: zie de kop van de migratie 20260904091000 voor de meting.
//
// ── Auth: het ORG-token, niet de per-user grant ─────────────────────────────
//
// Basic auth met Vault `skill:global:atlassian_api_token` +
// `agent_config(global, atlassian_email)` tegen
// `agent_config(global, atlassian_site)`. Dat is hetzelfde pad dat de
// documentatie-agents al gebruiken.
//
// Bewust NIET de per-user Composio-grant uit `user_connectors`: de wiki is voor
// iedereen dezelfde inhoud, dus met een per-user ETL stond elke pagina N keer
// in de index. `owner_user_id` op de chunks blijft daarom NULL = org-breed
// zichtbaar. De per-user Confluence-koppeling blijft wat hij is: connect-status.
//
// ── Space-scope ─────────────────────────────────────────────────────────────
//
// `bg-intelligence.atlassian.net` is een GEDEELDE site (50+ spaces). Welke
// spaces meedoen staat in `agent_config('confluence-sync-etl','spaces')`.
// Persoonlijke spaces (`~…`) worden hier hard geweigerd, ongeacht die config —
// andermans aantekeningen horen niet in Jelle's RAG-antwoorden.
//
// ── Modes ───────────────────────────────────────────────────────────────────
//
//   delta (default)  alleen pagina's met `lastmodified >= now("-<lookback>d")`.
//                    `?days=N` stelt het venster in (default 3).
//   full  (?full=1)  alle pagina's in scope, én archiveren wat niet meer
//                    bestaat (+ chunks van die pagina's opruimen). Bij ~600
//                    pagina's is dat gewoon betaalbaar; nachtelijk is prima.
//   `?spaces=LM,AI`  versmalt de ronde tot deze spaces (nooit verbreden — de
//                    config blijft de scope). Voor een eerste backfill, zodat
//                    één space ruim binnen de wall-time past.
//
// Loopt een ronde tegen de deadline aan, dan zegt `stats.extra.truncated` dat,
// staat er een warning bij welke space is afgekapt, en wordt er NIET
// gearchiveerd — anders zou een time-out halverwege de rest van de wiki als
// verdwenen bestempelen.
//
// ── Voor de documentatie-monitor / hosted Claude-routine ────────────────────
//
// `documentation-monitor` blijft LIVE REST lezen. Hij controleert juist op drift
// en op `page_stale` (>60 dagen), en een spiegel die een halve dag achterloopt
// zou daar bevindingen genereren die morgen niet meer kloppen.
//
// Wat deze tabel hem wél goedkoop kan geven is de INVENTARIS: welke pagina's
// bestaan, met welke `version` en welke `confluence_updated_at` — dat is het
// grootste deel van zijn scan, zonder 600 REST-calls. De pagina-INHOUD hoort hij
// live te halen als hij drift wil vaststellen. Dit is een aanbod, geen
// wijziging: `~/.claude/skills` is niet aangeraakt.
//
// Cron: `0 5,17 * * *` (2×/dag). Bij het gemeten tempo (~2 gewijzigde pagina's
// per dag) is dat ruim; het venster waarin de index verouderd kan zijn is
// maximaal een halve dag en `confluence_updated_at` staat op de rij, dus een
// antwoord kán zeggen hoe oud de pagina is.
// =============================================================================

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { requireCronOrServiceRole } from '../_shared/edge-auth.ts';
import { getCfg } from '../_shared/mail-account.ts';

const SKILL_VERSION = 'confluence-sync-etl-v1.1';
const DEFAULT_SPACES = ['LM', 'LM1', 'LE', 'LE1', 'AI', 'MT', 'BI', 'Marketing'];
const DEFAULT_LOOKBACK_DAYS = 3;
const PAGE_LIMIT = 50;              // Confluence-paginering; body's zijn groot
const MAX_WALL_TIME_MS = 110_000;
const SAFETY_MARGIN_MS = 15_000;
const MAX_BODY_CHARS = 60_000;      // gemeten max op de site was 59.714
const FETCH_TIMEOUT_MS = 30_000;

/** Alleen deze vorm van space-key mag door: geen `~` (persoonlijk), geen CQL-injectie. */
const SAFE_SPACE_KEY = /^[A-Za-z0-9]{1,64}$/;

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

async function confluence(ctx: Ctx, path: string): Promise<any> {
  const res = await fetch(`https://${ctx.site}.atlassian.net${path}`, {
    headers: { Authorization: `Basic ${ctx.auth}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`confluence_${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { throw new Error(`confluence_non_json: ${text.slice(0, 200)}`); }
}

/**
 * Storage-XHTML → platte tekst.
 *
 * Confluence's storage-formaat is XHTML met eigen macro's. Twee dingen die je
 * NIET zomaar mag weggooien:
 *   • `<ac:structured-macro ac:name="code">` — de inhoud van een code-macro is
 *     echte kennis, dus we houden `ac:plain-text-body` en `CDATA`.
 *   • tabellen — `</td>` zonder scheidingsteken plakt cellen aan elkaar en
 *     maakt "12" en "34" tot "1234". Daarom eerst cel-/rij-grenzen naar
 *     leestekens, dan pas tags strippen.
 */
function storageToText(xhtml: string): string {
  let s = xhtml ?? '';
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  // Macro-parameters (layout, id's, kleurcodes) zijn ruis; de body niet.
  s = s.replace(/<ac:parameter\b[^>]*>[\s\S]*?<\/ac:parameter>/g, ' ');
  s = s.replace(/<(ri|ac):[^>]*\/>/g, ' ');
  s = s.replace(/<\/(td|th)>/gi, ' | ');
  s = s.replace(/<\/(tr|p|h[1-6]|li|div|blockquote)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  s = s.replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim().slice(0, MAX_BODY_CHARS);
}

/**
 * De spaces die meedoen. `only` (query-param `?spaces=LM,AI`) mag de set
 * VERSMALLEN maar nooit verbreden: de geconfigureerde lijst blijft de enige
 * bron van waarheid voor scope. Handig voor een eerste backfill, die per space
 * ruim binnen de wall-time blijft; en het archiveer-pad kijkt alleen naar de
 * spaces die deze ronde daadwerkelijk zijn afgelopen, dus dat blijft kloppen.
 */
async function loadSpaces(supabase: SupabaseClient, only: string[] | null): Promise<string[]> {
  const { data } = await supabase.from('agent_config').select('config_value')
    .eq('agent_name', 'confluence-sync-etl').eq('config_key', 'spaces').maybeSingle();
  const raw = data?.config_value;
  const list = Array.isArray(raw) ? raw : DEFAULT_SPACES;
  // Persoonlijke spaces zijn hier niet te configureren. Dat is opzet.
  const configured = list.map((x: unknown) => String(x)).filter((k) => SAFE_SPACE_KEY.test(k));
  if (!only || only.length === 0) return configured;
  return configured.filter((k) => only.includes(k));
}

interface PageRow {
  page_id: string; space_key: string; title: string; body_text: string;
  version: number; confluence_updated_at: string | null; url: string | null;
  parent_id: string | null; is_archived: boolean; synced_at: string;
  ancestor_ids: string[]; ancestor_titles: string[]; labels: string[];
}

function toRow(p: any, spaceKey: string, site: string): PageRow | null {
  const id = p?.id ? String(p.id) : null;
  if (!id) return null;
  const body = storageToText(p?.body?.storage?.value ?? '');
  const webui = p?._links?.webui ?? null;
  const ancestors: any[] = Array.isArray(p?.ancestors) ? p.ancestors : [];
  return {
    page_id: id,
    space_key: p?.space?.key ? String(p.space.key) : spaceKey,
    title: String(p?.title ?? '(zonder titel)').slice(0, 500),
    body_text: body,
    version: Number(p?.version?.number ?? 1) || 1,
    confluence_updated_at: p?.version?.when ?? null,
    url: webui ? `https://${site}.atlassian.net/wiki${webui}` : null,
    parent_id: ancestors.length > 0 ? String(ancestors[ancestors.length - 1]?.id ?? '') || null : null,
    // De hele keten, van root naar direct-ouder. Stond al in de respons en werd
    // weggegooid; `path=` in de chunk-leader leunt hierop, want wiki-titels zijn
    // vaak generiek ("Overzicht", "Proces") en het pad is wat ze onderscheidt.
    ancestor_ids: ancestors.map((a) => String(a?.id ?? '')).filter(Boolean),
    ancestor_titles: ancestors.map((a) => String(a?.title ?? '')).filter(Boolean),
    // Site-breed 0 labels gemeten op 2026-09-05 (0/366). Wordt nergens op
    // gefilterd of gerankt; staat er zodat het veld zich vult als er ooit
    // gelabeld wordt. `metadata.labels` is één expand-term op deze v1-API,
    // geen extra request.
    labels: (Array.isArray(p?.metadata?.labels?.results) ? p.metadata.labels.results : [])
      .map((l: any) => String(l?.name ?? '')).filter(Boolean),
    is_archived: false,
    synced_at: new Date().toISOString(),
  };
}

/**
 * Eén space doorlopen. `lookbackDays === null` = alles, anders CQL-delta.
 *
 * ⚠ Paginering gaat via `_links.next`, NIET via `start`. Gemeten 2026-09-04 op
 * de eigen site: `/wiki/rest/api/content/search` NEGEERT `start` en geeft bij
 * `start=0` en `start=3` exact dezelfde drie id's terug. De eerste versie van
 * deze functie telde `start` op en haalde daardoor eindeloos pagina 1 opnieuw
 * op — 2351 "upserts" voor een delta van ~30 pagina's, tot de deadline hem
 * afkapte. Cursor-paginering is hier de enige die werkt.
 *
 * `_links.next` draagt de expand-parameters NIET mee, dus die plakken we er
 * weer aan. En omdat een paging-bug een cron-functie stil kan laten rondjes
 * draaien, staan er twee onafhankelijke rem-mechanismen op: een harde
 * `MAX_PAGES_PER_SPACE` en de eis dat elke ronde minstens één NIEUW id oplevert.
 */
// `metadata.labels` is op deze v1-API (/wiki/rest/api/content) een geldige
// expand in dezelfde call — géén apart /labels-endpoint zoals bij v2. Levert
// vandaag site-breed nul labels op; staat erin zodat het veld zich vult zodra
// er gelabeld wordt. Zie migratie 20260905173000.
const EXPAND = 'body.storage,version,space,ancestors,metadata.labels';
const MAX_PAGES_PER_SPACE = 60;   // 60 × PAGE_LIMIT = 1500 pagina's per space

async function syncSpace(
  ctx: Ctx, supabase: SupabaseClient, spaceKey: string, lookbackDays: number | null,
  deadline: number, seen: Set<string>,
): Promise<{ upserted: number; scanned: number; truncated: boolean }> {
  let upserted = 0;
  let scanned = 0;

  // `?spaceKey=` is een parameter, geen CQL-string: geen injectie-oppervlak. De
  // delta-filter gaat wél via CQL, en daar is de space-key op SAFE_SPACE_KEY
  // gevalideerd.
  let path: string | null = lookbackDays == null
    ? `/wiki/rest/api/content?spaceKey=${encodeURIComponent(spaceKey)}&type=page&status=current`
      + `&expand=${EXPAND}&limit=${PAGE_LIMIT}`
    : `/wiki/rest/api/content/search?cql=`
      + encodeURIComponent(`type=page and space="${spaceKey}" and lastmodified >= now("-${lookbackDays}d")`)
      + `&expand=${EXPAND}&limit=${PAGE_LIMIT}`;

  for (let round = 0; path && round < MAX_PAGES_PER_SPACE; round++) {
    if (Date.now() > deadline) return { upserted, scanned, truncated: true };

    const page = await confluence(ctx, path);
    const results: any[] = Array.isArray(page?.results) ? page.results : [];
    if (results.length === 0) break;
    scanned += results.length;

    const rows = results.map((p) => toRow(p, spaceKey, ctx.site)).filter((r): r is PageRow => r != null);
    const fresh = rows.filter((r) => !seen.has(r.page_id));
    for (const r of rows) seen.add(r.page_id);

    if (fresh.length > 0) {
      const { error } = await supabase.from('confluence_pages')
        .upsert(fresh, { onConflict: 'page_id' });
      if (error) throw new Error(`confluence_pages_upsert_failed: ${error.message}`);
      upserted += fresh.length;
    } else {
      // Alles al gezien: de API herhaalt zichzelf. Doorlopen zou de vorige bug
      // terugbrengen.
      break;
    }

    const next = page?._links?.next;
    path = typeof next === 'string' && next.length > 0
      ? `/wiki${next}${next.includes('expand=') ? '' : `&expand=${EXPAND}`}`
      : null;
  }
  return { upserted, scanned, truncated: false };
}

Deno.serve(async (req) => {
  const startTime = Date.now();
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const gate = await requireCronOrServiceRole(req, supabase);
  if (!gate.ok) return gate.response;

  const url = new URL(req.url);
  const full = url.searchParams.get('full') === '1';
  const lookbackDays = full ? null : Number(url.searchParams.get('days') ?? DEFAULT_LOOKBACK_DAYS);
  const onlySpaces = (url.searchParams.get('spaces') ?? '')
    .split(',').map((s) => s.trim()).filter((s) => SAFE_SPACE_KEY.test(s));

  const startedAt = new Date().toISOString();
  const counts = {
    spaces: 0, pages_scanned: 0, pages_upserted: 0,
    pages_archived: 0, chunks_deleted: 0,
  };
  const stats: Record<string, unknown> = {
    schema_version: '1',
    skill_version: SKILL_VERSION,
    mode: full ? 'full' : 'delta',
    triggered_by: gate.via ?? 'unknown',
    triggered_at: startedAt,
    counts,
    extra: { lookback_days: lookbackDays, only_spaces: onlySpaces.length ? onlySpaces : null, truncated: false },
    warnings: [] as string[],
  };

  const { data: runIns } = await supabase.from('agent_runs').insert({
    agent_name: 'confluence-sync-etl', run_type: 'edge_function', status: 'running',
    started_at: startedAt, stats, errors: [],
  }).select('id').single();
  const runId = runIns?.id ?? null;

  try {
    const ctx = await buildCtx(supabase);
    const spaces = await loadSpaces(supabase, onlySpaces);
    if (spaces.length === 0) throw new Error('no_valid_spaces_configured');
    counts.spaces = spaces.length;

    const deadline = startTime + MAX_WALL_TIME_MS - SAFETY_MARGIN_MS;
    const seen = new Set<string>();

    for (const key of spaces) {
      if (Date.now() > deadline) {
        (stats.extra as any).truncated = true;
        (stats.warnings as string[]).push(`deadline_before_space_${key}`);
        break;
      }
      try {
        const r = await syncSpace(ctx, supabase, key, lookbackDays, deadline, seen);
        counts.pages_scanned += r.scanned;
        counts.pages_upserted += r.upserted;
        if (r.truncated) {
          (stats.extra as any).truncated = true;
          (stats.warnings as string[]).push(`deadline_in_space_${key}`);
        }
      } catch (e) {
        // Eén space die weigert (rechten, 400 op een rare key) mag de rest niet
        // meesleuren — stilte is geen error, dus wel als warning vastleggen.
        (stats.warnings as string[]).push(`space_${key}: ${String((e as Error).message || e).slice(0, 160)}`);
      }
    }

    // Archiveren kan ALLEEN na een volledige, niet-afgekapte ronde: anders zou
    // een time-out halverwege de rest van de wiki als verdwenen bestempelen.
    if (full && !(stats.extra as any).truncated && seen.size > 0) {
      const { data: gone } = await supabase.from('confluence_pages')
        .select('page_id').in('space_key', spaces).eq('is_archived', false);
      const goneIds = (gone ?? []).map((r: any) => String(r.page_id)).filter((id) => !seen.has(id));
      if (goneIds.length > 0) {
        await supabase.from('confluence_pages')
          .update({ is_archived: true, synced_at: new Date().toISOString() })
          .in('page_id', goneIds);
        counts.pages_archived = goneIds.length;
        // Uit de index halen, niet alleen uit de spiegel: een verwijderde pagina
        // die nog opduikt in een chat-antwoord is erger dan geen antwoord.
        const { count } = await supabase.from('chunks')
          .delete({ count: 'exact' }).eq('source', 'confluence').in('source_id', goneIds);
        counts.chunks_deleted = count ?? 0;
      }
    }

    const nowIso = new Date().toISOString();
    const { count: total } = await supabase.from('confluence_pages')
      .select('page_id', { count: 'exact', head: true }).eq('is_archived', false);

    await supabase.from('confluence_sync_state').upsert({
      id: 1,
      ...(full ? { last_full_sync: nowIso } : { last_delta_sync: nowIso }),
      total_pages: total ?? 0,
      last_error: null,
      updated_at: nowIso,
    }, { onConflict: 'id' });

    const warned = (stats.warnings as string[]).length > 0;
    const summary = `${counts.pages_upserted} pagina's bijgewerkt uit ${counts.spaces} spaces`
      + (counts.pages_archived ? `, ${counts.pages_archived} gearchiveerd (${counts.chunks_deleted} chunks weg)` : '')
      + ` · ${stats.mode}`;

    if (runId) {
      await supabase.from('agent_runs').update({
        status: warned ? 'warning' : 'success',
        completed_at: nowIso, summary, stats,
      }).eq('id', runId);
    }
    return new Response(JSON.stringify({ ok: true, runId, summary, stats }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const nowIso = new Date().toISOString();
    await supabase.from('confluence_sync_state').upsert({
      id: 1, last_error: msg.slice(0, 500), last_error_at: nowIso, updated_at: nowIso,
    }, { onConflict: 'id' });
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
