#!/usr/bin/env node
// =============================================================================
// multi_user_acl_eval.cjs — de poort voor multi-user toegang        (v1.190)
// =============================================================================
// Tien asserties uit RESEARCH-MULTI-USER.md §6.1 (M9 is er in M2 bijgekomen:
// de positieve controle op een override — het bewijs dat een vinkje werkt). Draai hem vóór én ná elke
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

async function mgmt(p, init = {}) {
  const r = await fetch(`${MGMT}${p}`, {
    ...init, headers: { Authorization: `Bearer ${SBT}`, 'Content-Type': 'application/json', ...UA, ...(init.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`mgmt ${p} ${r.status}: ${t.slice(0, 300)}`);
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
  let m3Fout = [];
  try {
    const efs = await mgmt('/functions');
    const jwtOn = efs.filter(f => f.verify_jwt).map(f => f.slug);
    const repoDir = path.join(__dirname, '..', 'supabase', 'functions');
    m3Fout = jwtOn.filter((slug) => {
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

  // ── M8 · storage ──────────────────────────────────────────────────────────
  const buckets = await sql(`
    select p.policyname as naam, coalesce(p.qual,'') as qual
      from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects' and p.cmd in ('SELECT','ALL')`);
  const m8Fout = buckets.filter(b => /bucket_id/.test(b.qual) && !STORAGE_POORT.test(b.qual));
  assert('M8', 'geen storage-policy die alleen op bucket_id test', m8Fout.length === 0,
    m8Fout.length ? m8Fout.map(b => b.naam).join(', ').slice(0, 28) : `0 van ${buckets.length} policies`, '0');

  // ── Personas ──────────────────────────────────────────────────────────────
  const keys = await mgmt('/api-keys?reveal=true');
  const serviceKey = keys.find(k => k.name === 'service_role')?.api_key;
  const anonKey = keys.find(k => k.name === 'anon')?.api_key;
  if (!serviceKey || !anonKey) { assert('M4', 'sleutels opvraagbaar', false, 'geen', 'service_role + anon'); return await klaar(); }

  const users = await sql(`select r.app_role, u.email, r.user_id
                             from public.user_roles r join auth.users u on u.id = r.user_id
                            order by r.app_role, u.last_sign_in_at desc nulls last`);
  const owner = users.find(u => u.app_role === 'owner');
  const member = users.find(u => u.app_role === 'member');
  if (!owner || !member) { assert('M4', 'owner- en member-persona aanwezig', false, users.length + ' users', 'minstens 1 van elk'); return await klaar(); }

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
  } finally {
    await sqlRw(`delete from public.user_capabilities where note = '${TESTMERK}';`);
    await opruimen();
    const rest = await sql(`select count(*)::int as n from public.user_session_mfa where user_agent = '${TESTMERK}'`);
    if (rest[0].n !== 0) console.log(`\n⚠ ${rest[0].n} MFA-testrijen niet opgeruimd — verwijder ze handmatig.`);
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
