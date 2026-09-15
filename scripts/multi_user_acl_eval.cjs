#!/usr/bin/env node
// =============================================================================
// multi_user_acl_eval.cjs — de poort voor multi-user toegang        (v1.219)
// =============================================================================
// Zeventien asserties. M2 bracht M9/M10; SECURITY PR-A brengt M11 (doorkijk over
// de juiste persoon — S1) en M12 (het vinkje `levert_vandaag` dekt wat er echt
// wordt afgedwongen — S4); SECURITY PR-B brengt M13 (shared catalogi +
// persoonlijke task_projects — S2); SECURITY PR-C brengt M3b (de GEDEPLOYDE
// bundel draagt de poort — S11), M12b (de edge-tak van M12, afgeleid uit die
// bundels in plaats van uit een handlijst) en M14 (de rekenregel staat op drie
// plekken en zegt op alle drie hetzelfde — S9). Draai hem vóór én ná elke
// wijziging aan RLS, een view, een RPC-grant of een edge function.
//
//   SBT=<management_token> node scripts/multi_user_acl_eval.cjs
//   (zonder SBT wordt ~/.claude/supabase-mcp.json gelezen)
//
//   --skip-mfa   sla M5/M6 over (die schrijven kort een MFA-testsessie)
//
// Exit 0 = alles groen. Exit 1 = minstens één assertie rood.
//
// ⚠ PUBLIEKE REPO. Dit bestand bevat geen e-mailadressen, geen namen en geen
// data-inhoud. De personas worden op runtime uit user_roles gehaald; er worden
// alleen aantallen geprint.
//
// ⚠ De belangrijkste asserties zijn M5 en M6, de POSITIEVE controles. Een ACL
// die alles dichttimmert haalt M1 t/m M4 moeiteloos — en breekt het product.
// Geheugen `confluence-per-user-space-acl`: fail-closed, positieve controle is
// de enige assertie die telt.
//
// ⚠ Minten is inloggen. `/auth/v1/verify` maakt een echte sessie en schuift
// `auth.users.last_sign_in_at` naar nu — daar stond Julia's valse "Vandaag
// actief" op (v1.192). De twee sessies worden daarom in `klaar()` weer
// ingetrokken, scope LOCAL: global zou ook Jelle's browsertabblad uitloggen.
//
// ⚠ Een geminte JWT draagt géén tweede factor, dus session_mfa_ok() is false en
// zelfs de owner ziet nul. Daarom registreren M5/M6 kort een MFA-sessie voor de
// twee geminte session_ids (methode 'otp', user_agent 'multi-user P0
// verificatie', 10 minuten geldig) en ruimen die in een finally weer op. Zonder
// die stap meet je vals groen: je ziet nul en denkt dat het de ACL is.
// =============================================================================
const fs = require('fs');
const path = require('path');
const { mintUserJwt, revokeMintedSessions } = require(path.join(__dirname, 'lib', 'user-jwt.cjs'));
const { leesBundel, inPool } = require(path.join(__dirname, 'lib', 'edge-bundle.cjs'));

const REF = process.env.SUPABASE_REF || 'ezxihctobrqoklufawim';
const SBT = process.env.SBT || (() => {
  try {
    return JSON.parse(fs.readFileSync(process.env.HOME + '/.claude/supabase-mcp.json', 'utf8'))
      .mcpServers.supabase.headers.Authorization.split(' ')[1];
  } catch { return null; }
})();
if (!SBT) { console.error('geen management-token: zet SBT= of leg ~/.claude/supabase-mcp.json neer'); process.exit(2); }

const SKIP_MFA = process.argv.includes('--skip-mfa');
const UA = { 'User-Agent': 'legal-mind-dashboard-claude/1.0' };
const MGMT = `https://api.supabase.com/v1/projects/${REF}`;
const REST = `https://${REF}.supabase.co/rest/v1`;
const TESTMERK = 'multi-user P0 verificatie';

// ── Uitzonderingslijsten en poort-patronen: uit de DATABASE ────────────────
//
// Tot v1.196 stonden deze lijsten hier als constanten, en dezelfde definitie
// stond een tweede keer in `invite_readiness()` — de RPC die de Uitnodigen-knop
// tegenhoudt. Twee kopieën van dezelfde regel lopen uit elkaar en je merkt het
// pas als ze iets anders zeggen (geheugen `doc12-definition-lives-in-three-places`:
// DOC-12 stond op drie plekken en liep in PR #90 één commit lang uit de pas).
//
// Ze staan nu in `public.acl_poort_config` (migratie 20260914180000), met per
// regel een reden die niet leeg mág zijn — een CHECK-constraint dwingt dat af.
// Dit script en de invite-poort lezen dezelfde rijen. Valt de tabel weg, dan
// stopt het script: doorgaan met een lege uitzonderingslijst geeft een
// scherm vol vals rood, doorgaan met een lege poort-regex geeft vals rood op
// élke functie.
let VIEW_UITZONDERING = {};
let RPC_UITZONDERING = {};
let EDGE_UITZONDERING = {};
let POORT = null;
let PGVECTOR = null;
let STORAGE_POORT = null;
let EDGE_POORT = null;

async function laadPoortConfig() {
  const rijen = await sql(`select soort, naam, waarde, reden from public.acl_poort_config`);
  if (!rijen.length) throw new Error('acl_poort_config is leeg — zonder die rijen meet dit script niets');
  for (const r of rijen) {
    if (r.soort === 'view') VIEW_UITZONDERING[r.naam] = r.reden;
    else if (r.soort === 'rpc') RPC_UITZONDERING[r.naam] = r.reden;
    else if (r.soort === 'edge') EDGE_UITZONDERING[r.naam] = r.reden;
    else if (r.soort === 'patroon') {
      if (r.naam === 'poort') POORT = new RegExp(r.waarde, 'i');
      if (r.naam === 'pgvector') PGVECTOR = new RegExp(r.waarde);
      if (r.naam === 'storage_poort') STORAGE_POORT = new RegExp(r.waarde);
      if (r.naam === 'edge_poort') EDGE_POORT = new RegExp(r.waarde);
    }
  }
  for (const [naam, re] of [['poort', POORT], ['pgvector', PGVECTOR], ['storage_poort', STORAGE_POORT], ['edge_poort', EDGE_POORT]]) {
    if (!re) throw new Error(`patroon '${naam}' ontbreekt in acl_poort_config`);
  }
}

/** De bron van een edge function plus de `../_shared/*.ts` die hij direct importeert. */
function bronMetShared(indexPad) {
  const hoofd = fs.readFileSync(indexPad, 'utf8');
  const uit = [hoofd];
  const sharedDir = path.join(path.dirname(indexPad), '..', '_shared');
  for (const m of hoofd.matchAll(/from\s+['"]\.\.\/_shared\/([\w.-]+)['"]/g)) {
    const p = path.join(sharedDir, m[1]);
    if (fs.existsSync(p)) uit.push(fs.readFileSync(p, 'utf8'));
  }
  return uit;
}

// ⚠ Bounded retry op 5xx — niet op 4xx.
//
// De Management-API geeft na onderhoud minutenlang losse 500'en terug
// ("Failed to perform authorization check", "Failed to check user auth status";
// waargenomen 2026-09-15 21:52 UTC). Eén zo'n hik maakte de hele poort rood én
// brak de opruiming halverwege af — een infrastoring die zich voordoet als een
// bevinding, dezelfde faalmodus als geheugen `g1-gate-counts-502-as-silence`.
//
// Dit mág hier omdat élke statement in dit script idempotent is: SELECT,
// DELETE op een testmerk, UPDATE op één id, of INSERT … ON CONFLICT DO UPDATE.
// Een tweede poging kan niets dubbel doen. Blijft de 500 staan, dan valt de
// poort alsnog om — een hardnekkige fout blijft een fout.
async function mgmt(p, init = {}, poging = 1) {
  const r = await fetch(`${MGMT}${p}`, {
    ...init, headers: { Authorization: `Bearer ${SBT}`, 'Content-Type': 'application/json', ...UA, ...(init.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) {
    if (r.status >= 500 && poging < 3) {
      await new Promise(res => setTimeout(res, poging * 2000));
      return mgmt(p, init, poging + 1);
    }
    throw new Error(`mgmt ${p} ${r.status}: ${t.slice(0, 300)}`);
  }
  return JSON.parse(t);
}
const sql   = (q) => mgmt('/database/query', { method: 'POST', body: JSON.stringify({ query: q, read_only: true }) });
const sqlRw = (q) => mgmt('/database/query', { method: 'POST', body: JSON.stringify({ query: q }) });

const uitslagen = [];
function assert(id, wat, ok, gemeten, verwacht) {
  uitslagen.push({ id, ok });
  console.log(`${ok ? ' OK ' : 'ROOD'}  ${id.padEnd(4)} ${wat.padEnd(50)} ${String(gemeten).padEnd(30)} ${verwacht}`);
}
function overslaan(id, wat, reden) {
  uitslagen.push({ id, ok: true, overgeslagen: true });
  console.log(`OVER  ${id.padEnd(4)} ${wat.padEnd(50)} ${reden}`);
}

async function count(jwt, apikey, rel) {
  const r = await fetch(`${REST}/${rel}?select=*`, {
    headers: { apikey, Authorization: `Bearer ${jwt}`, Prefer: 'count=exact', Range: '0-0', ...UA },
  });
  if (!r.ok) return { status: r.status, n: null };
  return { status: 200, n: Number((r.headers.get('content-range') || '').split('/')[1] ?? -1) };
}
/**
 * Rijen ophalen als een persona. `kolommen` blijft expres klein: van
 * `agent_config` lezen we alléén de sleutels, nooit `config_value` — een poort
 * die de waarde ophaalt om te bewijzen dat je hem niet mag zien is zelf het lek.
 */
async function rowsAs(jwt, apikey, rel, kolommen, query = '') {
  const r = await fetch(`${REST}/${rel}?select=${kolommen}${query}`, {
    headers: { apikey, Authorization: `Bearer ${jwt}`, ...UA },
  });
  if (!r.ok) return { status: r.status, rijen: null };
  try { return { status: 200, rijen: JSON.parse(await r.text()) }; } catch { return { status: 200, rijen: [] }; }
}
/** Eén RPC-aanroep als een persona. Alleen voor LEZENDE functies. */
async function callRpc(jwt, apikey, naam, args) {
  const r = await fetch(`${REST}/rpc/${naam}`, {
    method: 'POST',
    headers: { apikey, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', ...UA },
    body: JSON.stringify(args),
  });
  const tekst = await r.text();
  if (!r.ok) return { status: r.status, data: null };
  try { return { status: 200, data: JSON.parse(tekst) }; } catch { return { status: 200, data: tekst }; }
}

const claims = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString('utf8'));

(async () => {
  console.log(`\nmulti_user_acl_eval — ${REF} — ${new Date().toISOString()}\n`);
  await laadPoortConfig();
  console.log(`config uit acl_poort_config: ${Object.keys(VIEW_UITZONDERING).length} views · `
    + `${Object.keys(RPC_UITZONDERING).length} rpc's · ${Object.keys(EDGE_UITZONDERING).length} edge · 4 patronen\n`);

  // ── M1 · views ────────────────────────────────────────────────────────────
  const views = await sql(`
    select c.relname as naam, c.relkind::text as soort,
           coalesce((select o from unnest(c.reloptions) o where o like 'security_invoker%'),'') as si,
           has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('v','m')
     order by 1`);
  const m1Fout = views.filter(v => v.auth_select && v.si !== 'security_invoker=on' && !VIEW_UITZONDERING[v.naam]);
  assert('M1', 'elke leesbare view respecteert de RLS eronder', m1Fout.length === 0,
    m1Fout.length ? m1Fout.map(v => v.naam).join(', ').slice(0, 28) : `0 van ${views.length} views`,
    'geen enkele zonder invoker of uitzondering');

  // ── M2 · SECURITY DEFINER-RPC's ───────────────────────────────────────────
  const fns = await sql(`
    select p.proname as naam, p.prosrc as src,
           exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE') as publiek
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
     where p.prosecdef and p.prorettype <> 'trigger'::regtype
       and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     order by 1`);
  const m2Fout = fns.filter(f => !POORT.test(f.src || '') && !RPC_UITZONDERING[f.naam]);
  assert('M2', 'geen DEFINER-RPC zonder poort voor authenticated', m2Fout.length === 0,
    m2Fout.length ? m2Fout.map(f => f.naam).join(', ').slice(0, 28) : `0 van ${fns.length} functies`,
    'alleen de uitzonderingslijst');

  // ── M2b · PUBLIC execute ──────────────────────────────────────────────────
  const pub = await sql(`
    select p.proname as naam
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
     where p.prorettype <> 'trigger'::regtype
       and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
     order by 1`);
  const m2bFout = pub.filter(f => !PGVECTOR.test(f.naam) && !RPC_UITZONDERING[f.naam]);
  assert('M2b', 'geen app-functie met EXECUTE voor PUBLIC', m2bFout.length === 0,
    m2bFout.length ? m2bFout.map(f => f.naam).join(', ').slice(0, 28) : '0',
    'alleen pgvector + uitzonderingen');

  // ── M3 · Edge Functions ───────────────────────────────────────────────────
  let jwtOn = [];
  try {
    const efs = await mgmt('/functions');
    jwtOn = efs.filter(f => f.verify_jwt);
    const repoDir = path.join(__dirname, '..', 'supabase', 'functions');
    const m3Fout = jwtOn.map(f => f.slug).filter((slug) => {
      if (EDGE_UITZONDERING[slug]) return false;
      const f = path.join(repoDir, slug, 'index.ts');
      if (!fs.existsSync(f)) return true;                     // niet in de repo = niet te beoordelen
      // De poort mag in een gedeelde module staan: `connectors-outlook` is een
      // schil van twintig regels om `_shared/connector-composio.ts`, en dáár zit
      // de check. Alleen index.ts lezen zou dus precies de juiste architectuur
      // afstraffen en copy-paste belonen. We volgen de ../_shared-imports één
      // niveau diep — dieper is niet nodig en maakt de regel vaag.
      return !bronMetShared(f).some((tekst) => EDGE_POORT.test(tekst));
    });
    assert('M3', 'elke verify_jwt-functie doet een rolcheck of staat op de lijst', m3Fout.length === 0,
      m3Fout.length ? m3Fout.join(', ').slice(0, 28) : `0 van ${jwtOn.length} op verify_jwt`,
      'alleen de uitzonderingslijst');
  } catch (e) {
    assert('M3', 'edge functions opvraagbaar', false, e.message.slice(0, 30), 'HTTP 200');
  }

  // ── M3b · de GEDEPLOYDE bundel draagt de poort (SECURITY PR-C / S11) ──────
  //
  // M3 hierboven leest de repo. Dat bewijst dat de regel is opgeschreven, niet
  // dat hij draait. Op 2026-09-14 stond M3 zeven uur groen terwijl productie de
  // óngepoorte bundels serveerde: iemand had `_shared/user-gate.ts` aangevuld en
  // de functies die hem importeren niet opnieuw gedeployd. Precies dat gat is
  // deze assertie.
  //
  // Dezelfde `edge_poort`-regex, dezelfde uitzonderingslijst, andere BRON: de
  // eszip van de Management API in plaats van `supabase/functions/<slug>/index.ts`.
  // De twee horen bij elkaar te staan — M3 rood betekent "iemand schreef geen
  // poort", M3b rood betekent "iemand vergat te deployen", en dat zijn twee
  // verschillende gesprekken.
  //
  // ⚠ Rood bij een onbereikbare bundel, niet groen. Een 500 van de Management
  // API of een timeout is geen bewijs dat de poort erin zit; stil doorgaan zou
  // precies het vals groen zijn dat deze assertie moest wegnemen. Er zit één
  // herkansing in (`edge-bundle.cjs`), en de reden staat in de uitslagregel.
  //
  // Bewezen rood op 2026-09-15: `connectors-confluence` (v4) en
  // `connectors-hubspot` (v1) draaiden bundels van vóór de M2-poort, terwijl
  // `connectors-outlook` (v7) — dezelfde `_shared/connector-composio.ts` — hem
  // wél had. Geheugen `grep-is-ugrep`: een poort die je niet één keer rood hebt
  // gezien bewaakt niets. Deze zag ik rood en daarna, ná de redeploy, groen.
  const probes = (tekst) => ({
    poort: EDGE_POORT.test(tekst),
    // M12b hieronder: welke capability-keys worden in DEZE bundel afgedwongen?
    // Afgeleid uit de bundel, niet uit een handlijst — dat was de reden dat M12
    // de edge-tak oversloeg (zie de kop van M12).
    keys: [...new Set([
      ...[...tekst.matchAll(/require(?:Capability|PaidUse)\s*\(\s*[\w.$]+\s*,\s*['"]([\w.-]+)['"]/g)].map(m => m[1]),
      // `requirePaidUse(req)` zonder tweede argument valt terug op de default in
      // de helper-signatuur; die staat letterlijk in dezelfde bundel.
      ...(/requirePaidUse\s*\(\s*[\w.$]+\s*\)/.test(tekst)
        ? [...tekst.matchAll(/function requirePaidUse\s*\([^)]*?=\s*['"]([\w.-]+)['"]/g)].map(m => m[1])
        : []),
    ])],
  });
  probes.versie = 2;   // bij elke wijziging aan `probes` ophogen — anders leest hij oude cache

  const m3bMist = [];
  const m3bStuk = [];
  const edgeKeys = new Set();
  if (jwtOn.length) {
    const uitslag = await inPool(jwtOn, 3, (f) =>
      leesBundel({ ref: REF, token: SBT, slug: f.slug, version: f.version, probes }));
    for (let i = 0; i < jwtOn.length; i++) {
      const f = jwtOn[i], r = uitslag[i];
      if (!r.ok) { m3bStuk.push(`${f.slug}:${r.reden}`); continue; }
      for (const k of r.uit.keys) edgeKeys.add(k);
      if (EDGE_UITZONDERING[f.slug]) continue;
      if (!r.uit.poort) m3bMist.push(`${f.slug}@v${f.version}`);
    }
  } else {
    m3bStuk.push('geen functielijst (M3 faalde)');
  }
  assert('M3b', 'de GEDEPLOYDE bundel draagt diezelfde poort', m3bMist.length === 0 && m3bStuk.length === 0,
    (m3bMist.length || m3bStuk.length)
      ? [...m3bMist.map(s => 'mist ' + s), ...m3bStuk.map(s => 'stuk ' + s)].join(' ').slice(0, 60)
      : `0 van ${jwtOn.length} eszips zonder poort`,
    'geen enkele bundel zonder poort, geen enkele onleesbaar');

  // ── M8 · storage ──────────────────────────────────────────────────────────
  const buckets = await sql(`
    select p.policyname as naam, coalesce(p.qual,'') as qual
      from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects' and p.cmd in ('SELECT','ALL')`);
  const m8Fout = buckets.filter(b => /bucket_id/.test(b.qual) && !STORAGE_POORT.test(b.qual));
  assert('M8', 'geen storage-policy die alleen op bucket_id test', m8Fout.length === 0,
    m8Fout.length ? m8Fout.map(b => b.naam).join(', ').slice(0, 28) : `0 van ${buckets.length} policies`, '0');

  // ── M12 · `levert_vandaag` liegt niet (SECURITY PR-A / S4) ────────────────
  //
  // S4 zet negen vinkjes op true. Een vinkje is een belofte aan de owner: "dit
  // recht doet vandaag iets". De kolom is handwerk en loopt dus uit de pas met
  // de handhaving zodra iemand een policy verplaatst of een capability toevoegt
  // — en dan liegt het Uitnodigen-scherm, want `rechten_zonder_dekking` in
  // invite_readiness() leest exact deze kolom.
  //
  // Vier regels, allevier read-only en allevier aantoonbaar rood te krijgen
  // (gemeten 2026-09-15 met een verzonnen rijenset: 1/1/1/1 waar de echte tabel
  // 0/0/0/0 geeft — geheugen `grep-is-ugrep`: een poort die je niet één keer
  // rood hebt gezien bewaakt niets):
  //
  //   a. tegenspraak       — levert_vandaag=true terwijl afdwingen_in leeg is of
  //                          met 'nog niet' begint. De kolom spreekt zichzelf tegen.
  //   b. claim_zonder_policy — afdwingen_in noemt capability_gate, maar geen
  //                          pg_policy zet die poort op die key.
  //   c. claim_zonder_guard  — afdwingen_in noemt assert_capability, maar geen
  //                          functiebron roept hem aan met die key.
  //   d. afgedwongen_zonder_vinkje — omgekeerd: de poort staat er wél (policy of
  //                          guard) en het vinkje staat uit. Dan ónderschat het
  //                          scherm wat de persoon krijgt.
  //
  // ⚠ Postgres bewaart een policy-expressie mét cast: `capability_gate('x'::text)`.
  // Matchen op `capability_gate('x')` geeft stil nul treffers op élke key en
  // daarmee vals groen op (d) en vals rood op (b). Daarom matcht het patroon op
  // het prefix `capability_gate('x'` — dat dekt beide vormen. In `prosrc` staat
  // de ruwe broncode, dus daar is de cast er niet; hetzelfde prefix dekt ook dat.
  //
  // BEWUST NIET gedekt: de edge-tak. RESEARCH §7.1 noemt die erbij, maar een
  // edge-poort heet `requirePaidUse()` en draagt de capability-key niet in zijn
  // naam. Dat koppelen vraagt een handlijst (key → functie), en dat is precies de
  // tweede kopie van dezelfde regel waar `acl_poort_config` vanaf wilde. Zolang
  // die lijst niet uit de code afleidbaar is, dekt M12 alleen wat de database
  // zelf kan bewijzen — policy en RPC-guard. `modellen.gebruiken` valt daarmee
  // onder (a): de tegenspraak-regel houdt hem eerlijk, de vindplaats niet.
  const m12 = (await sql(`
    with bron as (
      select coalesce(pr.prosrc,'') as src from pg_proc pr
        join pg_namespace n on n.oid = pr.pronamespace and n.nspname = 'public'
    ),
    beleid as (
      select coalesce(p.qual,'')||' '||coalesce(p.with_check,'') as expr
        from pg_policies p where p.schemaname = 'public'
    ),
    echt as (
      select c.key, c.levert_vandaag, coalesce(c.afdwingen_in,'') as afdwingen_in,
             exists (select 1 from beleid b where b.expr like '%capability_gate('''||c.key||'''%') as in_policy,
             exists (select 1 from bron s where s.src like '%assert_capability('''||c.key||'''%') as in_guard
        from public.capabilities c
    )
    select
      (select count(*)::int from echt
        where levert_vandaag and (afdwingen_in = '' or afdwingen_in like 'nog niet%')) as tegenspraak,
      (select count(*)::int from echt
        where levert_vandaag and afdwingen_in like '%capability_gate%' and not in_policy) as claim_zonder_policy,
      (select count(*)::int from echt
        where levert_vandaag and afdwingen_in like '%assert_capability%' and not in_guard) as claim_zonder_guard,
      (select count(*)::int from echt
        where not levert_vandaag and (in_policy or in_guard)) as afgedwongen_zonder_vinkje,
      (select count(*)::int from echt where levert_vandaag) as vinkjes,
      (select count(*)::int from echt) as totaal`))[0];
  assert('M12', 'levert_vandaag dekt wat er echt wordt afgedwongen',
    m12.tegenspraak === 0 && m12.claim_zonder_policy === 0
      && m12.claim_zonder_guard === 0 && m12.afgedwongen_zonder_vinkje === 0,
    `tegenspraak=${m12.tegenspraak} claim=${m12.claim_zonder_policy}/${m12.claim_zonder_guard} `
      + `stil_afgedwongen=${m12.afgedwongen_zonder_vinkje} (${m12.vinkjes}/${m12.totaal} aan)`,
    '0 0 0 0');

  // ── M12b · de edge-tak van M12, uit de bundel (SECURITY PR-C, optie 4) ────
  //
  // De kop van M12 legt uit waaróm de edge-tak daar ontbrak: een poort in een
  // edge function heet `requirePaidUse()` en draagt de capability-key niet in
  // zijn naam, dus koppelen vroeg een handlijst (key → functie) — precies de
  // tweede kopie van dezelfde regel waar `acl_poort_config` vanaf wilde.
  //
  // M3b maakt die handlijst overbodig. De key stáát in de bundel, als letterlijk
  // argument: `requireCapability(req, 'instellingen.eigen')`, en bij
  // `requirePaidUse(req)` als default in de helper-signatuur die in dezelfde
  // bundel is meegebakken. `edgeKeys` hierboven is dus een gemeten lijst, geen
  // afspraak.
  //
  // Twee armen, allebei rood te krijgen:
  //   a. stil_afgedwongen — de bundel dwingt een key af die `levert_vandaag`
  //      op false heeft staan. Dan ónderschat het Rechten-scherm wat de persoon
  //      krijgt (en wat hem geweigerd wordt).
  //   b. claim_zonder_bundel — `afdwingen_in` belooft een edge-poort en géén
  //      gedeployde bundel dwingt die key af. Dat is S11 vanaf de andere kant:
  //      het vinkje zegt "dit werkt", de deploy zegt niets.
  //
  // Arm (b) slaat over zodra M3b al stuk is: zonder leesbare bundels is een lege
  // `edgeKeys` geen bewijs, en zou hij élke edge-claim vals rood maken.
  const caps = await sql(`select key, levert_vandaag, coalesce(afdwingen_in,'') as afdwingen_in
                            from public.capabilities`);
  const m12bStil = caps.filter(c => edgeKeys.has(c.key) && !c.levert_vandaag).map(c => c.key);
  const m12bClaim = m3bStuk.length ? [] : caps
    .filter(c => c.levert_vandaag && /\bedge\b/i.test(c.afdwingen_in) && !/^nog niet/i.test(c.afdwingen_in))
    .filter(c => !edgeKeys.has(c.key)).map(c => c.key);
  assert('M12b', 'de edge-poorten in de bundels kloppen met het vinkje',
    m12bStil.length === 0 && m12bClaim.length === 0,
    (m12bStil.length || m12bClaim.length)
      ? `stil=${m12bStil.join(',')} claim=${m12bClaim.join(',')}`.slice(0, 60)
      : `${edgeKeys.size} key(s) in bundels: ${[...edgeKeys].sort().join(', ')}`.slice(0, 60),
    m3bStuk.length ? 'arm (b) over — M3b stuk' : '0 0');

  // ── Personas ──────────────────────────────────────────────────────────────
  const keys = await mgmt('/api-keys?reveal=true');
  const serviceKey = keys.find(k => k.name === 'service_role')?.api_key;
  const anonKey = keys.find(k => k.name === 'anon')?.api_key;
  if (!serviceKey || !anonKey) { assert('M4', 'sleutels opvraagbaar', false, 'geen', 'service_role + anon'); return await klaar(); }

  const users = await sql(`select r.app_role, u.email, r.user_id,
                                  u.last_sign_in_at::text as laatst
                             from public.user_roles r join auth.users u on u.id = r.user_id
                            order by r.app_role, u.last_sign_in_at desc nulls last`);
  const owner = users.find(u => u.app_role === 'owner');
  const member = users.find(u => u.app_role === 'member');
  if (!owner || !member) { assert('M4', 'owner- en member-persona aanwezig', false, users.length + ' users', 'minstens 1 van elk'); return await klaar(); }

  // ⚠ Minten IS inloggen (geheugen `minted-jwt-counts-as-a-login`):
  // `/auth/v1/verify` schuift `last_sign_in_at` naar nu. `revokeMintedSessions()`
  // haalt de sessie weg maar zet die datum niet terug — en dan staat er "Vandaag
  // actief" bij een owner die zat te werken en bij een member die niets deed.
  // De waarden hieronder zijn GEMETEN, niet geraden: precies terugzetten wat er
  // stond, of `null` als er niets stond. (PR-C liet dit bewust open in
  // `SECURITY-PRC-IMPL-NOTES.md` §6.1; PR-D sluit het.)
  const laatstVoor = [owner, member].map(u => ({
    user_id: u.user_id,
    waarde: u.laatst === null || u.laatst === undefined ? 'null' : `'${u.laatst}'::timestamptz`,
  }));
  const laatstTerug = async () => {
    for (const r of laatstVoor) {
      await sqlRw(`update auth.users set last_sign_in_at = ${r.waarde} where id = '${r.user_id}'::uuid;`);
    }
  };

  const o = await mintUserJwt({ ref: REF, serviceKey, email: owner.email });
  const m = await mintUserJwt({ ref: REF, serviceKey, email: member.email });

  // ── M4 · negatieve controle (zonder tweede factor — strenger dan de praktijk)
  const GEHEIM = ['v_mail_chunk_source', 'v_entity_edges_full', 'v_hubspot_deal_chunk_source',
    'v_hubspot_future_index', 'hubspot_deals', 'mail_messages', 'agent_runs', 'rag_chat_query_log'];
  const m4 = [];
  for (const v of GEHEIM) {
    const r = await count(m.jwt, anonKey, v);
    if (r.status === 200 && r.n > 0) m4.push(`${v}=${r.n}`);
  }
  assert('M4', 'member ziet niets van de gedeelde wereld', m4.length === 0,
    m4.length ? m4.join(' ').slice(0, 28) : `0 rijen over ${GEHEIM.length} relaties`, '0 rijen of 403');

  // ── M7 · has_capability faalt closed ──────────────────────────────────────
  // ⚠ `hard_owner_only` moet een recht zijn dat ÉCHT `grantable = false` is,
  // anders meet die kolom niets: een member is dan sowieso false omdat hij het
  // recht niet in zijn preset heeft, en de assertie staat groen zonder de regel
  // te raken die ze zegt te bewaken. Tot v1.192 stond hier
  // `organisatie.platform`; die werd in v1.193 uitdeelbaar (hij zit nu in de
  // Organisatie-bundel) en de test was daarmee stilletjes hol. De extra kolom
  // `probe_is_vast` maakt dat onmogelijk: wordt ook `secrets.beheren` ooit
  // uitdeelbaar, dan valt M7 om in plaats van groen te blijven.
  const m7 = (await sqlRw(`
    select public.has_capability('bestaat.echt.niet') as onbekend,
           public.has_capability('home') as zonder_uid,
           public.has_capability('secrets.beheren', '${member.user_id}'::uuid) as hard_owner_only,
           (select not grantable from public.capabilities where key = 'secrets.beheren') as probe_is_vast,
           public.has_capability('home', '${member.user_id}'::uuid) as member_preset,
           public.has_capability('administratie', '${owner.user_id}'::uuid) as owner_preset`))[0];
  assert('M7', 'has_capability faalt closed en de preset werkt',
    m7.onbekend === false && m7.zonder_uid === false && m7.hard_owner_only === false
      && m7.probe_is_vast === true
      && m7.member_preset === true && m7.owner_preset === true,
    `onbekend=${m7.onbekend} leeg=${m7.zonder_uid} vast=${m7.hard_owner_only}(probe=${m7.probe_is_vast}) member=${m7.member_preset} owner=${m7.owner_preset}`,
    'false false false(probe=true) true true');

  // ── M5/M6 · de positieve controles ────────────────────────────────────────
  if (SKIP_MFA) {
    overslaan('M5', 'member ziet zijn eigen rijen', '--skip-mfa');
    overslaan('M6', 'owner ziet ná de wijziging evenveel of meer', '--skip-mfa');
    return await klaar();
  }

  const oc = claims(o.jwt), mc = claims(m.jwt);
  const opruimen = () => sqlRw(`delete from public.user_session_mfa where user_agent = '${TESTMERK}';`);
  try {
    await sqlRw(`insert into public.user_session_mfa (session_id, user_id, expires_at, method, user_agent)
                 values ('${oc.session_id}'::uuid, '${o.userId}'::uuid, now() + interval '5 minutes', 'otp', '${TESTMERK}'),
                        ('${mc.session_id}'::uuid, '${m.userId}'::uuid, now() + interval '5 minutes', 'otp', '${TESTMERK}')
                 on conflict (session_id) do update set expires_at = excluded.expires_at, user_agent = excluded.user_agent;`);

    // M6 — de owner moet alles blijven zien. Dit is het regressie-vangnet.
    const OWNER_MOET = ['hubspot_deals', 'mail_messages', 'agent_runs_health_7d',
      'v_hubspot_future_index_acl', 'v_entity_edges_full', 'v_d1_deals'];
    const leeg = [];
    for (const v of OWNER_MOET) {
      const r = await count(o.jwt, anonKey, v);
      if (!(r.status === 200 && r.n > 0)) leeg.push(`${v}=${r.status === 200 ? r.n : 'HTTP ' + r.status}`);
    }
    assert('M6', 'owner mét tweede factor ziet nog steeds alles', leeg.length === 0,
      leeg.length ? leeg.join(' ').slice(0, 28) : `${OWNER_MOET.length} relaties gevuld`, 'alle > 0');

    // M5 — de member moet zijn eigen rijen zien, niet die van een ander.
    const eigen = await count(m.jwt, anonKey, 'v_user_model_usage_month');
    const catalogus = await count(m.jwt, anonKey, 'capabilities');
    const vreemd = await count(m.jwt, anonKey, 'hubspot_deals');
    assert('M5', 'member ziet zijn eigen rijen, niet die van een ander',
      catalogus.status === 200 && catalogus.n > 0 && vreemd.status === 200 && vreemd.n === 0,
      `catalogus=${catalogus.n} eigen_usage=${eigen.n} vreemd=${vreemd.n}`,
      'catalogus > 0, vreemd = 0');

    // ── M9 · het vinkje doet ook echt iets ──────────────────────────────────
    //
    // Dit is de persona die RESEARCH §6.2 "member-plus" noemt en die tot nu toe
    // niet bestond: een member met één override. M1-M8 bewijzen dat alles
    // dichtstaat; alleen deze assertie bewijst dat je het ook open KUNT zetten.
    //
    // Zonder hem zou een `has_capability()` die altijd false teruggeeft de hele
    // poort groen houden — precies het vals groen waar geheugen
    // `confluence-per-user-space-acl` voor waarschuwt: fail-closed is makkelijk,
    // de positieve controle is de enige die telt.
    //
    // De meting: `agent_runs` heeft sinds M2 een tweede SELECT-policy op
    // capability_gate('organisatie.health'). Zonder het recht hoort een member
    // daar 0 te zien, met het recht meer dan 0. De override wordt in dezelfde
    // transactie gezet en in de `finally` hieronder weer weggehaald.
    const zonder = await count(m.jwt, anonKey, 'agent_runs');
    await sqlRw(`insert into public.user_capabilities (user_id, capability, effect, note)
                 values ('${m.userId}'::uuid, 'organisatie.health', 'grant', '${TESTMERK}')
                 on conflict (user_id, capability) do update set effect = 'grant', note = '${TESTMERK}';`);
    const met = await count(m.jwt, anonKey, 'agent_runs');
    assert('M9', 'een override opent ook echt iets (member-plus)',
      zonder.status === 200 && zonder.n === 0 && met.status === 200 && met.n > 0,
      `zonder=${zonder.n} met=${met.n}`,
      'zonder = 0, met > 0');

    // ── M10 · de per-user-tak op de Postvak-RPC's ───────────────────────────
    //
    // P0 maakte de negen autodraft-RPC's owner-only; M2 gaf ze een tak "je eigen
    // mail, of owner". Die tak loopt NIET langs de RLS van `autodraft_mails` —
    // het zijn SECURITY DEFINER-functies, dus ze gaan om de policy heen. Een
    // poort die alleen die tabel leest meet hem dus niet (gemeten door spoor 10
    // op 2026-09-14: 9/9 groen zonder deze tak één keer te raken).
    //
    // `can_act_on_autodraft_mail()` IS die poort, is lezend en heeft geen
    // bijwerking — dus die vragen we rechtstreeks. Een echte `submit_` zou een
    // Outlook-concept plaatsen; dat hoort niet in een poort die vóór elke merge
    // draait.
    //
    // De test is scherp doordat de member alles ÁNDERS wél heeft: het recht
    // `postvak` zit in zijn preset en zijn MFA-rij staat hierboven geregistreerd.
    // Wat overblijft als enige reden voor `false` is de eigenaarscontrole. Haalt
    // iemand `m.user_id = auth.uid()` ooit weg, dan valt precies deze assertie om
    // en geen andere.
    const eenMail = await sql(`select mail_id from public.autodraft_mails order by received_at desc limit 1`);
    if (!eenMail.length) {
      overslaan('M10', "per-user-tak op de Postvak-RPC's", 'geen autodraft_mails-rij om tegen te meten');
    } else {
      const mailId = eenMail[0].mail_id;
      const alsMember = await callRpc(m.jwt, anonKey, 'can_act_on_autodraft_mail', { p_mail_id: mailId, p_key: 'postvak' });
      const alsOwner  = await callRpc(o.jwt, anonKey, 'can_act_on_autodraft_mail', { p_mail_id: mailId, p_key: 'postvak' });
      const onbekend  = await callRpc(m.jwt, anonKey, 'can_act_on_autodraft_mail', { p_mail_id: 'bestaat-niet-' + Date.now(), p_key: 'postvak' });
      assert('M10', 'Postvak-RPC: eigen mail wel, andermans mail niet',
        alsMember.data === false && alsOwner.data === true && onbekend.data === false,
        `member=${alsMember.data} owner=${alsOwner.data} onbekend=${onbekend.data}`,
        'false true false');
    }

    // ── M11 · de doorkijk gaat over de juiste persoon (SECURITY PR-A / S1) ──
    //
    // has_capability(p_key, p_user) negeert p_user op het browserpad (anti-
    // impersonatie). Dat is goed voor handhaving; fout voor de doorkijk.
    // user_capabilities_overview + invite_readiness moeten via has_capability_for
    // de *persoon* tellen, niet de aanroeper. Deze assertie kan alleen rood
    // worden door die bug: owner-JWT → overview(member) moet gelijk zijn aan
    // de interne meting voor die member, en kleiner dan die van de owner.
    const intern = (await sqlRw(`
      select
        (select count(*)::int from public.capabilities c
          where public.has_capability(c.key, '${member.user_id}'::uuid)) as member_intern,
        (select count(*)::int from public.capabilities c
          where public.has_capability(c.key, '${owner.user_id}'::uuid)) as owner_intern`))[0];
    const overview = await callRpc(o.jwt, anonKey, 'user_capabilities_overview', { p_user: member.user_id });
    const overviewActief = Array.isArray(overview.data)
      ? overview.data.filter((r) => r.actief === true).length
      : -1;
    const readiness = await callRpc(o.jwt, anonKey, 'invite_readiness', { p_user_id: member.user_id });
    const readinessActief = readiness.data?.persoon?.rechten_actief ?? -1;
    // Extra: has_capability via browser mag NIET de member tonen (anti-impersonatie blijft).
    const browserHc = await callRpc(o.jwt, anonKey, 'has_capability', {
      p_key: 'secrets.beheren', p_user: member.user_id,
    });
    const forHc = await callRpc(o.jwt, anonKey, 'has_capability_for', {
      p_key: 'secrets.beheren', p_user: member.user_id,
    });
    assert('M11', 'doorkijk gaat over de juiste persoon (niet de aanroeper)',
      overview.status === 200
        && readiness.status === 200
        && intern.member_intern > 0
        && intern.owner_intern > intern.member_intern
        && overviewActief === intern.member_intern
        && readinessActief === intern.member_intern
        && overviewActief !== intern.owner_intern
        && browserHc.data === true   // owner vraagt → owner-caps (anti-impersonatie)
        && forHc.data === false,     // doorkijk → member heeft secrets.beheren niet
      `overview=${overviewActief} invite=${readinessActief} intern_m=${intern.member_intern} intern_o=${intern.owner_intern} hc_browser=${browserHc.data} hc_for=${forHc.data}`,
      `overview=invite=intern_m (< intern_o) · hc_browser=true hc_for=false`);

    // ── M13 · member leest preset-catalogi; task_projects is persoonlijk ─────
    //
    // Drie opzoektabellen blijven kantoor-gedeeld (capability_gate). task_projects
    // is sinds Jelle 2026-09-15 persoonlijk per user: member mag NIET alle 9
    // owner-projecten zien. Positieve controle: we planten één eigen project,
    // meten dat de member precies dat ziet, en dat de owner méér ziet (alles).
    // kb_documents blijft bewust owner-only (niet in de gedeelde lijst).
    const SHARED_CATALOGS = [
      ['autodraft_actions', 'postvak'],
      ['kb_categories', 'kennisbank'],
      ['cities_lookup', 'agenda'],
    ];
    const m13leeg = [];
    const m13ok = [];
    for (const [rel, _cap] of SHARED_CATALOGS) {
      const r = await count(m.jwt, anonKey, rel);
      if (!(r.status === 200 && r.n > 0)) m13leeg.push(`${rel}=${r.status === 200 ? r.n : 'HTTP ' + r.status}`);
      else m13ok.push(`${rel}=${r.n}`);
    }

    const TEST_PROJ_NAME = 'acl-eval M13 persoonlijk';
    await sqlRw(`delete from public.task_projects where name = '${TEST_PROJ_NAME}'`);
    await sqlRw(`insert into public.task_projects (name, status, sort_order, user_id)
                 values ('${TEST_PROJ_NAME}', 'active', 9999, '${m.userId}'::uuid)`);
    const tpMember = await count(m.jwt, anonKey, 'task_projects');
    const tpOwner  = await count(o.jwt, anonKey, 'task_projects');
    // Member ziet alleen eigen (1 testproject); owner ziet backfill (9) + test (≥10).
    // Als de kantoor-gedeelde capability_gate ooit terugkomt, ziet de member 10
    // en valt precies deze assertie om.
    const tpOk = tpMember.status === 200 && tpMember.n === 1
      && tpOwner.status === 200 && tpOwner.n >= 10
      && tpMember.n < tpOwner.n;
    if (!tpOk) m13leeg.push(`task_projects member=${tpMember.status === 200 ? tpMember.n : 'HTTP ' + tpMember.status} owner=${tpOwner.status === 200 ? tpOwner.n : 'HTTP ' + tpOwner.status}`);
    else m13ok.push(`task_projects member=${tpMember.n} owner=${tpOwner.n}`);

    // Negatief: kb_documents en HubSpot blijven dicht (S3 out of scope).
    const kbDocs = await count(m.jwt, anonKey, 'kb_documents');
    const hs = await count(m.jwt, anonKey, 'hubspot_deals');
    const m13dicht = (kbDocs.status === 200 && kbDocs.n === 0) && (hs.status === 200 && hs.n === 0);
    assert('M13', 'shared catalogi open; task_projects persoonlijk; CRM/kb_docs dicht',
      m13leeg.length === 0 && m13dicht,
      m13leeg.length
        ? m13leeg.join(' ').slice(0, 60)
        : `${m13ok.join(' ')} · kb_docs=${kbDocs.n} hs=${hs.n}`,
      '3 shared > 0 · task_projects member=1 < owner · kb_docs=0 hs=0');

    // ── M14 · dezelfde rekenregel op drie plekken (SECURITY PR-C / S9) ──────
    //
    // "Wie heeft dit recht?" wordt in deze repo op DRIE plaatsen uitgerekend:
    //
    //   1. SQL      `public.has_capability(key, user)`  — de handhaver
    //   2. JS       `src/lib/capabilities.js` → isEffective()  — de matrix, die
    //               32 rechten × 8 personen tekent zonder 256 RPC-calls
    //   3. SQL      `invite_readiness().persoon.rechten_actief` — de teller die
    //               de Uitnodigen-knop tegenhoudt
    //
    // Het bestand zegt het zelf in zijn kop: "een SPIEGEL van has_capability()…
    // wijkt de SQL af, dan wijkt dit bestand af". Een spiegel die niemand
    // nameet gaat een keer scheef staan (geheugen
    // `doc12-definition-lives-in-three-places`: DOC-12 stond óók op drie
    // plekken en liep in PR #90 één commit lang uit de pas).
    //
    // M11 houdt (1) en (3) al tegen elkaar. Deze assertie hangt (2) ernaast,
    // door de ECHTE module te importeren — niet door de regel hier over te
    // schrijven, want dan waren het er vier.
    //
    // Twee persona's, niet één: met alleen de member zou de `grantable=false`-
    // tak ongemeten blijven (die zegt "alleen de owner"), en juist dáár wijkt
    // een spiegel het eerst af.
    const { isEffective } = await import(
      require('url').pathToFileURL(path.join(__dirname, '..', 'src', 'lib', 'capabilities.js')).href);
    const capsAll = await sql(`select key, grantable from public.capabilities order by key`);
    const presets = await sql(`select app_role, capability from public.role_capabilities`);
    const overrides = await sql(`select user_id::text as user_id, capability, effect from public.user_capabilities`);
    const m14regels = [];
    for (const [naam, persona] of [['member', member], ['owner', owner]]) {
      const presetKeys = new Set(presets.filter(p => p.app_role === persona.app_role).map(p => p.capability));
      const mijn = overrides.filter(o => o.user_id === persona.user_id);
      const js = capsAll.filter(c =>
        isEffective(c, persona.app_role, mijn.find(o => o.capability === c.key), presetKeys)).length;
      const sqlN = (await sqlRw(`select count(*)::int as n from public.capabilities c
                                  where public.has_capability(c.key, '${persona.user_id}'::uuid)`))[0].n;
      const inv = await callRpc(o.jwt, anonKey, 'invite_readiness', { p_user_id: persona.user_id });
      const invN = inv.data?.persoon?.rechten_actief ?? -1;
      m14regels.push({ naam, js, sqlN, invN, eens: js === sqlN && sqlN === invN });
    }
    assert('M14', 'SQL, JS-matrix en invite_readiness rekenen hetzelfde',
      m14regels.every(r => r.eens) && m14regels[0].js !== m14regels[1].js,
      m14regels.map(r => `${r.naam} sql=${r.sqlN} js=${r.js} invite=${r.invN}`).join(' · '),
      'per persona gelijk, en de twee persona\'s verschillen');

    // ── M15 · agent_config: allowlist, niet "alles behalve secrets" (S7) ─────
    //
    // De policy stond op `session_mfa_ok() and (not is_secret)`. Op dit project
    // is `is_secret` voor élke rij false, dus die tweede arm deed niets: een
    // member mét tweede factor las de hele tabel — Composio-identifiers van het
    // kantoorpostvak, Vercel- en GitHub-projectnamen, het spend-token van de
    // evalcron, en resten van een in v1.135 gestript product.
    //
    // Deze assertie stelt de vraag van twee kanten, want alleen "member ziet
    // weinig" is te halen door per ongeluk álles dicht te zetten:
    //
    //   POSITIEF  de schermen die een member wél heeft (Postvak, Agenda,
    //             Instellingen) krijgen hun sleutels — anders is de handtekening
    //             onder zijn mail weg en staat er een verzonnen chat-prompt.
    //   NEGATIEF  nul rijen op de deny-lijst hieronder, en niet méér rijen dan
    //             de allowlist toestaat.
    //   OWNER     ongewijzigd: alle non-secret rijen.
    //
    // De deny-lijst staat hier met opzet als literal en komt NIET uit de
    // allowlist-tabel: een negatieve controle die zijn verwachting uit dezelfde
    // bron haalt als de handhaving bewijst niets.
    const M15_DENY = [
      ['global', 'composio_user_id'],
      ['global', 'composio_connection_id_outlook'],
      ['global', 'composio_connection_id_hubspot'],
      ['mail-sync-etl-v2', 'composio_connection_id'],
      ['connectors', 'outlook_auth_config_id'],
      ['dashboard-refresh', 'vercel_project_id'],
      ['dashboard-refresh', 'vercel_team_id'],
      ['rag-eval-cron', 'spend_ok_token'],
      ['linkedin-connect', 'browser_session_live_url'],   // gestript product, v1.135
    ];

    const tabelBestaat = (await sql(
      `select to_regclass('public.agent_config_member_keys') is not null as er`))[0].er;

    if (!tabelBestaat) {
      // Migratie 20260915220000 nog niet toegepast. Niet stil overslaan: meet
      // read-only wat hij gáát doen, met de allowlist als VALUES-lijst, en zet
      // de uitkomst in de reden. Een overgeslagen assertie zonder getallen is
      // een assertie die je de volgende keer ook overslaat.
      const sim = (await sql(`
        with k(agent_name, config_key) as (values
          ('*','custom_instructions'), ('*','reminder_style'),
          ('auto-draft','postvak_signature'), ('auto-draft','spelcheck_default_instruction'),
          ('rag-chat','system_prompt'))
        select count(*) filter (where zichtbaar)                  as member_na,
               count(*)                                           as niet_secret,
               count(*) filter (where zichtbaar and op_denylijst)  as deny_na
          from (
            select a.agent_name, a.config_key,
                   exists (select 1 from k
                            where k.config_key = a.config_key
                              and (k.agent_name = '*' or k.agent_name = a.agent_name)) as zichtbaar,
                   (a.agent_name, a.config_key) in (
                     ${M15_DENY.map(([an, ck]) => `('${an}','${ck}')`).join(',')}) as op_denylijst
              from public.agent_config a where not a.is_secret) t`))[0];
      const nu = await count(m.jwt, anonKey, 'agent_config');
      overslaan('M15', 'agent_config: member ziet alleen de allowlist-sleutels',
        `migratie 20260915220000 nog niet toegepast · nu: member ziet ${nu.n}/${sim.niet_secret} · `
        + `ná migratie: ${sim.member_na}/${sim.niet_secret}, deny-lijst ${sim.deny_na}/${M15_DENY.length}`);
    } else {
      const toegestaan = await sql(
        `select agent_name, config_key from public.agent_config_member_keys`);
      const mag = (an, ck) => toegestaan.some(k =>
        k.config_key === ck && (k.agent_name === '*' || k.agent_name === an));

      const mRijen = await rowsAs(m.jwt, anonKey, 'agent_config', 'agent_name,config_key');
      const oRijen = await rowsAs(o.jwt, anonKey, 'agent_config', 'agent_name,config_key');
      const nietSecret = (await sql(
        `select count(*)::int as n from public.agent_config where not is_secret`))[0].n;
      const verwachtMember = (await sql(`
        select count(*)::int as n from public.agent_config a
         where not a.is_secret
           and exists (select 1 from public.agent_config_member_keys k
                        where k.config_key = a.config_key
                          and (k.agent_name = '*' or k.agent_name = a.agent_name))`))[0].n;

      const teveel = (mRijen.rijen ?? []).filter(r => !mag(r.agent_name, r.config_key));
      const denyGezien = (mRijen.rijen ?? []).filter(r =>
        M15_DENY.some(([an, ck]) => an === r.agent_name && ck === r.config_key));
      const memberN = mRijen.rijen?.length ?? -1;
      const ownerN  = oRijen.rijen?.length ?? -1;

      assert('M15', 'agent_config: member alleen allowlist, owner ongewijzigd',
        mRijen.status === 200 && oRijen.status === 200
          && teveel.length === 0 && denyGezien.length === 0
          && memberN === verwachtMember && memberN > 0   // > 0: dichttimmeren is geen slagen
          && ownerN === nietSecret,
        `member=${memberN}/${verwachtMember} deny=${denyGezien.length} buiten_lijst=${teveel.length} owner=${ownerN}/${nietSecret}`,
        `member=allowlist>0 · deny=0 · owner=alle non-secret`);
    }

  } finally {
    // Elke opruimstap apart, en de datum-reparatie eerst.
    //
    // Tot v1.219 stond dit als één keten van `await`s. Eén hik van de
    // Management-API (waargenomen 2026-09-15: HTTP 500 "Failed to retrieve the
    // requested resource", vlak na onderhoud) liet de rest van de keten dan
    // over: testrijen bleven staan én `last_sign_in_at` bleef op "nu". Een
    // opruiming die stopt bij de eerste fout is geen opruiming.
    const stappen = [
      ['last_sign_in_at terug', laatstTerug],
      ['testproject weg', () => sqlRw(`delete from public.task_projects where name = 'acl-eval M13 persoonlijk'`)],
      ['override weg', () => sqlRw(`delete from public.user_capabilities where note = '${TESTMERK}';`)],
      ['MFA-testrijen weg', opruimen],
    ];
    for (const [naam, fn] of stappen) {
      try { await fn(); } catch (e) { console.log(`\n⚠ opruimen "${naam}" mislukt: ${String(e.message).slice(0, 120)}`); }
    }
    const rest = await sql(`select count(*)::int as n from public.user_session_mfa where user_agent = '${TESTMERK}'`);
    if (rest[0].n !== 0) console.log(`\n⚠ ${rest[0].n} MFA-testrijen niet opgeruimd — verwijder ze handmatig.`);
    // Natellen in plaats van aannemen: een `update` die stil niets raakte ziet
    // er hetzelfde uit als een geslaagde.
    const terug = await sql(`select id::text as user_id, last_sign_in_at::text as nu from auth.users
                              where id in (${laatstVoor.map(r => `'${r.user_id}'::uuid`).join(',')})`);
    const scheef = terug.filter(t => {
      const wil = laatstVoor.find(r => r.user_id === t.user_id).waarde;
      return wil === 'null' ? t.nu !== null : wil !== `'${t.nu}'::timestamptz`;
    });
    if (scheef.length) console.log(`\n⚠ last_sign_in_at niet teruggezet voor ${scheef.length} persona('s).`);
  }
  await klaar();
})().catch(e => { console.error('\nFOUT:', e.message); process.exit(2); });

async function klaar() {
  // Eerst de geminte sessies terug, dán de uitslag. Een meting die sporen
  // achterlaat die op gebruik lijken heeft de Gebruikers-lijst één keer laten
  // liegen; dat hoeft geen tweede keer.
  const [terug, totaal] = await revokeMintedSessions();
  if (totaal) console.log(`\n${terug}/${totaal} geminte sessies ingetrokken`);

  const rood = uitslagen.filter(u => !u.ok);
  console.log(`\n${rood.length ? `ROOD: ${rood.map(r => r.id).join(', ')}` : 'alles groen'} — ${uitslagen.length} asserties\n`);
  process.exit(rood.length ? 1 : 0);
}
