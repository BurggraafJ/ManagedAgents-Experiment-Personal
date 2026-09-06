#!/usr/bin/env node
// =============================================================================
// confluence_acl_eval.cjs — de golden set voor Confluence-RAG      (v1.145)
// =============================================================================
// Tien vragen met een ASSERTIE, niet met een verwachting. Draai hem één keer
// vóór en één keer ná een wijziging aan de ACL, de sync of het recept.
//
//   SBT=<management_token> node scripts/confluence_acl_eval.cjs
//   (zonder SBT wordt ~/.claude/supabase-mcp.json gelezen)
//
// Exit 0 = alles groen. Exit 1 = minstens één assertie rood.
//
// ⚠ PUBLIEKE REPO. Dit bestand bevat geen pagina-inhoud, geen paginatitels,
// geen Atlassian-accountIds en geen e-mailadressen. De MT-vraag wordt op
// runtime uit de database gehaald en alleen als zoekterm gebruikt; hij wordt
// nooit geprint. Space-keys (MT, LM) zijn onschuldig, de inhoud niet.
//
// ⚠ De belangrijkste assertie is G1, de POSITIEVE controle: iemand die
// Management mag lezen MOET MT-fragmenten terugkrijgen. Een A/B-test die alleen
// controleert dat een verboden space nooit opduikt, slaagt ook als de identiteit
// nooit wordt geraadpleegd — dan meet je niets. G1 stond vóór v1.145 op rood.
// =============================================================================
const fs = require('fs');
const REF = process.env.SUPABASE_REF || 'ezxihctobrqoklufawim';
const SBT = process.env.SBT || (() => {
  try {
    return JSON.parse(fs.readFileSync(process.env.HOME + '/.claude/supabase-mcp.json', 'utf8'))
      .mcpServers.supabase.headers.Authorization.split(' ')[1];
  } catch { return null; }
})();
if (!SBT) { console.error('geen management-token: zet SBT= of leg ~/.claude/supabase-mcp.json neer'); process.exit(2); }

const MGMT = `https://api.supabase.com/v1/projects/${REF}`;
const FN = `https://${REF}.supabase.co/functions/v1`;
const UA = { 'User-Agent': 'legal-mind-dashboard-claude/1.0' };
const STRANGER = '00000000-0000-0000-0000-0000000000ff';

async function sql(query) {
  const r = await fetch(`${MGMT}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SBT}`, 'Content-Type': 'application/json', ...UA },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`sql ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}

const results = [];
function assert(id, wat, ok, gemeten, verwacht) {
  results.push({ id, wat, ok, gemeten: String(gemeten), verwacht });
  console.log(`${ok ? ' OK ' : 'ROOD'}  ${id.padEnd(4)} ${wat.padEnd(52)} ${String(gemeten).padEnd(28)} ${verwacht}`);
}

async function contextBuild(secret, { query, callerUserId, intent = 'search_docs', sources = ['confluence'], topK = 25 }) {
  const t0 = Date.now();
  const res = await fetch(`${FN}/context-build`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    body: JSON.stringify({
      intent, audience: 'confluence-golden-set', trigger_type: 'eval', trigger_id: null,
      query_text: query, caller_user_id: callerUserId,
      options: { top_k: topK, filter_sources: sources, min_similarity: 0.20 },
    }),
    signal: AbortSignal.timeout(90000),
  });
  const ms = Date.now() - t0;
  const txt = await res.text();
  if (!res.ok) return { ok: false, status: res.status, ms, matches: [], err: txt.slice(0, 120) };
  let j = {};
  try { j = JSON.parse(txt); } catch { return { ok: false, status: res.status, ms, matches: [], err: 'geen json' }; }
  // context-build antwoordt met HTTP 200 én ok:false als de bundel faalt. Dat
  // stil als "0 fragmenten" tellen is precies de fout die deze golden set moet
  // vangen — een lege uitkomst en een mislukte call zijn niet hetzelfde.
  return {
    ok: j.ok !== false, status: res.status, ms,
    matches: Array.isArray(j.matches) ? j.matches : [],
    bundle_id: j.bundle_id ?? null,
    strategy: j.retrieval_strategy ?? null,
    err: j.error ? String(j.error).slice(0, 120) : null,
  };
}
const spaceOf = (m) => m.metadata?.space_key || m.source_subtype || '?';
const countMT = (ms) => ms.filter((m) => spaceOf(m) === 'MT').length;

(async () => {
  console.log('Confluence golden set — ' + new Date().toISOString() + '\n');
  console.log('      id   assertie                                             gemeten                      verwacht');
  console.log('      ' + '-'.repeat(112));

  // ── opzet: identiteiten en een MT-onderwerp om naar te vragen ──────────────
  const secret = (await sql(`select public.get_skill_secret_service('global','cron_secret') as s`))[0].s;
  const owner = (await sql(
    `select u.id::text as id, u.email
       from auth.users u join public.confluence_identities i on i.user_id = u.id
      order by u.created_at limit 1`))[0];
  if (!owner) throw new Error('geen gebruiker met een confluence_identities-rij — de ACL is niet te testen');

  // Alleen als zoekterm gebruikt; nooit geprint (publieke repo).
  const mtRow = (await sql(
    `select p.title as t, p.page_id as id from public.confluence_pages p
      where p.space_key='MT' and not p.is_archived
        and exists (select 1 from public.chunks c where c.source='confluence' and c.source_id=p.page_id)
      order by p.confluence_updated_at desc limit 1`))[0];
  const lmRow = (await sql(
    `select p.title as t, p.page_id as id from public.confluence_pages p
      where p.space_key='LM' and not p.is_archived
        and exists (select 1 from public.chunks c where c.source='confluence' and c.source_id=p.page_id)
      order by p.confluence_updated_at desc limit 1`))[0];

  // ── G1-G3: dezelfde vraag, drie identiteiten ──────────────────────────────
  const asOwner = await contextBuild(secret, { query: mtRow.t, callerUserId: owner.id });
  assert('G1', 'eigenaar met MT-grant krijgt MT-fragmenten', countMT(asOwner.matches) > 0,
    `${countMT(asOwner.matches)} MT / ${asOwner.matches.length} totaal`, '> 0  [POSITIEVE CONTROLE]');

  const asStranger = await contextBuild(secret, { query: mtRow.t, callerUserId: STRANGER });
  assert('G2', 'onbekende uuid krijgt geen MT', countMT(asStranger.matches) === 0,
    `${countMT(asStranger.matches)} MT / ${asStranger.matches.length} totaal`, '0 MT');
  assert('G2b', 'onbekende uuid krijgt helemaal niets (fail-closed)', asStranger.matches.length === 0,
    `${asStranger.matches.length} fragmenten`, '0');

  const asCron = await contextBuild(secret, { query: mtRow.t, callerUserId: null });
  assert('G3', 'cron-aanroeper krijgt geen MT', countMT(asCron.matches) === 0,
    `${countMT(asCron.matches)} MT`, '0 MT');
  assert('G3b', 'cron-aanroeper krijgt wel de open spaces', asCron.matches.length > 0,
    `${asCron.matches.length} fragmenten`, '> 0');

  // ── G4: bron-hint-routing ─────────────────────────────────────────────────
  const hint = await contextBuild(secret, {
    query: `Wat staat er in de documentatie over ${lmRow.t}?`, callerUserId: owner.id,
    sources: null, intent: 'search_docs', topK: 20,
  });
  const cfHits = hint.matches.filter((m) => m.source === 'confluence').length;
  assert('G4', 'documentatievraag levert confluence-treffers', hint.ok && cfHits > 0,
    hint.ok ? `${cfHits} confluence-hits van ${hint.matches.length} (${hint.strategy || '?'}, bundle ${String(hint.bundle_id || '-').slice(0, 8)})`
            : `call mislukt: ${hint.status} ${hint.err || ''}`, '>= 1');

  // ── G5: recency mag documentatie niet wegdrukken ──────────────────────────
  const mixed = await contextBuild(secret, {
    query: `Wat is er vastgelegd over ${lmRow.t}?`, callerUserId: owner.id, sources: null, topK: 20,
  });
  const bronnen = new Set(mixed.matches.map((m) => m.source));
  const wikiInMixed = mixed.matches.filter((m) => m.source === 'confluence').length;
  assert('G5', 'gemengde vraag: wiki wordt niet weggedrukt door verse mail', mixed.ok && wikiInMixed > 0,
    mixed.ok ? `${wikiInMixed} wiki van ${mixed.matches.length}, bronnen: ${[...bronnen].join('+') || 'geen'} (${mixed.strategy || '?'})`
             : `call mislukt: ${mixed.status} ${mixed.err || ''}`, 'wiki >= 1');

  // ── G6: versheid van de spiegel ───────────────────────────────────────────
  // Geen live wiki-edit vanuit dit script (we schrijven niet in andermans wiki);
  // wel de mechaniek meten waar die belofte op rust.
  const h = (await sql(`select sync_health('confluence') as h`))[0].h;
  const age = Number(h.age_minutes);
  assert('G6', 'spiegel is jonger dan 10 minuten', Number.isFinite(age) && age < 10,
    `${age.toFixed(1)} min oud`, '< 10 min');
  const cron = await sql(`select schedule, active from cron.job where jobname='confluence-sync-fast'`);
  assert('G6b', 'volledige ronde (incl. archiveren) staat op */5', cron.length === 1 && cron[0].schedule === '*/5 * * * *' && cron[0].active,
    cron.length ? `${cron[0].schedule} actief=${cron[0].active}` : 'geen cron', '*/5 * * * *');

  // ── G7: gearchiveerde pagina valt onmiddellijk uit retrieval ──────────────
  // Bewijs in een transactie die terugdraait: markeer een pagina gearchiveerd
  // en kijk of match_chunks hem meteen laat vallen — zonder op een her-chunk of
  // op de nachtelijke full te wachten.
  const g7 = (await sql(`
    begin;
    update public.confluence_pages set is_archived = true where page_id = '${lmRow.id}';
    select count(*)::int as n
      from public.match_chunks(
             query_embedding := (select c.embedding from public.chunks c where c.source='confluence' and c.source_id='${lmRow.id}' limit 1),
             query_text := null, top_k := 50, filter_sources := array['confluence'],
             min_similarity := 0.0, p_caller_user_id := '${owner.id}'::uuid) m
     where m.out_source_id = '${lmRow.id}';
    rollback;`)).slice(-1)[0];
  assert('G7', 'gearchiveerde pagina verdwijnt direct uit retrieval', Number(g7.n) === 0,
    `${g7.n} fragmenten na archiveren`, '0');

  // ── G8: tijd, en time-out te onderscheiden van leeg ───────────────────────
  // Drie warme metingen; de eerste call van een run draagt de cold start van de
  // edge function en zegt niets over het recept. Mediaan telt.
  const tijden = [];
  for (let i = 0; i < 3; i++) tijden.push((await contextBuild(secret, { query: mtRow.t, callerUserId: owner.id })).ms);
  tijden.sort((a, b) => a - b);
  const mediaan = tijden[1];
  assert('G8', 'documentatievraag past binnen de 6s-grens van rag-chat', mediaan < 6000,
    `mediaan ${mediaan} ms (${tijden.join('/')}), koud ${asOwner.ms} ms`, '< 6000 ms');
  const logCols = await sql(`
    select count(*)::int as n from information_schema.columns
     where table_schema='public' and table_name='rag_chat_query_log' and column_name='meta'`);
  assert('G8b', 'query-log kan time-out van leeg onderscheiden', Number(logCols[0].n) === 1,
    'meta-kolom aanwezig', 'vector_timed_out wordt erin geschreven');

  // ── G9: provenance ────────────────────────────────────────────────────────
  const prov = asOwner.matches[0] || {};
  const heeft = ['space_key', 'title', 'url', 'version'].filter((k) => prov.metadata && prov.metadata[k] != null);
  assert('G9', 'treffer draagt space, titel, url en versie', heeft.length === 4,
    heeft.join(',') || 'niets', 'space_key,title,url,version');
  const gp = await sql(`
    select count(*)::int as n from public.confluence_get_page('${mtRow.id}', null, '${owner.id}'::uuid)`);
  const gpDeny = await sql(`
    select count(*)::int as n from public.confluence_get_page('${mtRow.id}', null, null)`);
  assert('G9b', 'confluence_get_page respecteert de ACL', Number(gp[0].n) === 1 && Number(gpDeny[0].n) === 0,
    `rechthebbende=${gp[0].n}, cron=${gpDeny[0].n}`, '1 en 0');

  // ── G10: niet-gespiegelde space ───────────────────────────────────────────
  const notMirrored = await sql(`
    select array_agg(space_key order by space_key)::text as keys
      from public.confluence_spaces where is_mirrored = false and status='current' limit 1`);
  const ghost = await contextBuild(secret, {
    query: 'Wat staat er in de documentatie over de space PT?', callerUserId: owner.id,
  });
  const ghostSpaces = new Set(ghost.matches.map(spaceOf));
  const mirrored = new Set((await sql(`select space_key from public.confluence_spaces where is_mirrored`)).map((r) => r.space_key));
  const leak = [...ghostSpaces].filter((s) => s !== '?' && !mirrored.has(s));
  assert('G10', 'geen treffers uit niet-gespiegelde spaces', leak.length === 0,
    leak.length ? leak.join(',') : 'alleen gespiegelde spaces', 'geen');

  // ── datalaag-controle naast het HTTP-pad ──────────────────────────────────
  const dbg = (await sql(`select public.confluence_acl_debug('${owner.id}'::uuid) as a, public.confluence_acl_debug(null) as b`))[0];
  assert('D1', 'acl_debug: rechthebbende ziet meer chunks dan cron', dbg.a.visible_chunks > dbg.b.visible_chunks,
    `${dbg.a.visible_chunks} vs ${dbg.b.visible_chunks}`, 'strikt meer');
  assert('D2', 'acl_debug: restricted space niet in de cron-baseline',
    !(dbg.b.allowed_spaces || []).includes('MT'), (dbg.b.allowed_spaces || []).join(','), 'zonder MT');

  // ── uitslag ───────────────────────────────────────────────────────────────
  const rood = results.filter((r) => !r.ok);
  console.log('\n' + '='.repeat(120));
  console.log(`${results.length - rood.length}/${results.length} groen`);

  // Vastleggen in rag_eval_runs/rag_eval_results — die tabellen hebben al
  // signal_hit, assert_detail en signal_pass_rate en zijn dus precies voor
  // assertie-evals gemaakt. (NIET in rag_quality_baselines: dat is ondanks de
  // naam een autodraft-A/B-tabel met draft_body en reviewer_decision.)
  // Alleen assertie-tekst en meting; nooit de vraag zelf, want die bevat een
  // paginatitel.
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const runId = (await sql(`
    insert into public.rag_eval_runs (label, suite, status, started_at, finished_at, context_build_version, n_questions, n_asserted, signal_pass_rate, notes)
    values ('confluence-golden-set', 'acl', 'done', now(), now(), 'context-build-v2.7-caller-acl', ${results.length}, ${results.length},
            ${((results.length - rood.length) / results.length).toFixed(4)},
            ${q(`v1.145 Confluence space-ACL. ${results.length - rood.length}/${results.length} groen. G1 = positieve controle (rechthebbende krijgt MT) en stond vóór v1.145 op rood.`)})
    returning id`))[0].id;
  const waarden = results.map((r) => `(${q(runId)}::uuid, ${q(r.id)}, ${q(r.wat)}, 'confluence-acl', ${r.ok}, ${q(`gemeten: ${r.gemeten} | verwacht: ${r.verwacht}`)})`).join(',\n');
  await sql(`insert into public.rag_eval_results (run_id, question_id, question, dimension, signal_hit, assert_detail)
             values ${waarden}`);
  console.log(`vastgelegd in rag_eval_runs ${runId}`);

  if (rood.length) {
    console.log('ROOD: ' + rood.map((r) => r.id).join(', '));
    process.exit(1);
  }
  console.log('golden set groen');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
