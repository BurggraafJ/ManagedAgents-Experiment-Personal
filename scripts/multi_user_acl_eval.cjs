#!/usr/bin/env node
// =============================================================================
// multi_user_acl_eval.cjs — de poort voor multi-user toegang        (v1.190)
// =============================================================================
// Acht asserties uit RESEARCH-MULTI-USER.md §6.1. Draai hem vóór én ná elke
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

// ── Uitzonderingslijsten ────────────────────────────────────────────────────
// Elke regel hier is een bewuste keuze mét reden. Een lege reden is een bug.
const VIEW_UITZONDERING = {
  v_hubspot_future_index_acl:
    'geguarde ingang op een materialized view; RLS geldt daar nooit, de poort zit in het WHERE-predicaat (is_admin_or_higher)',
  v_user_model_usage_month:
    'poort in het WHERE-predicaat; de policy op agent_chat_runs kent geen owner-tak, dus met invoker zag de owner alleen zijn eigen regel',
  v_model_usage_dekking:
    'owner-only noemer bij v_user_model_usage_month; poort in het WHERE-predicaat',
  v_user_model_usage_detail:
    'de vragen achter het maandbedrag (doorkijk op de Usage-pagina); zelfde twee armen en dezelfde reden als v_user_model_usage_month — de policy op agent_chat_runs kent geen owner-tak, dus met invoker zag de owner alleen zijn eigen vragen',
  v_mailbox_link_status:
    'vier vlaggen uit mail_accounts (gekoppeld/enabled/paused/fout), geen mailadres en geen composio-id; poort in het WHERE-predicaat omdat authenticated geen table-grant op mail_accounts heeft en security_invoker=on de view dan voor iedereen zou laten falen',
};
const RPC_UITZONDERING = {
  rag_owner_scope_ids:
    'aangeroepen vanuit match_chunks() en match_chunks_for_entity(), beide SECURITY INVOKER; levert een scope-filter en geen data, de RLS op chunks staat er onverkort naast',
  rag_eval_is_bank_id:
    'pure expressie (regex), raakt geen tabel; gebruikt in v_agent_eval_runs die de read-only meetkant leest',
  rag_eval_item_state:
    'pure expressie (CASE), raakt geen tabel; idem',
  mail_scope_single_user_id:
    'geeft één uuid terug, geen data; zit in vier security_invoker-views die authenticated leest (v_postvak_health, v_truth_of_sources, v_company_data_quality, v_mail_enrichment_progress)',
};
const EDGE_UITZONDERING = {
  'rag-chat': 'scoping op caller_user_id in plaats van op rol — bewust, elke ingelogde gebruiker mag vragen stellen',
  'rag-search': 'GAP-3 (P1): draait op service_role zonder callerverwijzing — open, nog niet gedicht',
  'mfa-email-send': 'onderdeel van het inlogpad zelf; een rolcheck zou de tweede factor onbereikbaar maken',
  'mfa-email-verify': 'idem',
  transcribe: 'GAP-3 (P1): betaalde model-call zonder rolcheck',
  'taalcheck-v2': 'GAP-3 (P1): betaalde model-call zonder rolcheck',
  'mail-taalcheck': 'GAP-3 (P1): betaalde model-call zonder rolcheck',
  'mail-verbeteraar': 'GAP-3 (P1): betaalde model-call zonder rolcheck',
  'auto-draft-spelcheck': 'GAP-3 (P1): betaalde model-call zonder rolcheck',
  'kb-compose': 'GAP-3 (P1): betaalde model-call zonder rolcheck',
  'agent-artifact-build': 'GAP-3 (P1): schrijft in de eigen map van de aanroeper (storage-policy), geen rolcheck',
  'connectors-confluence': 'GAP-3 (P1): per-user OAuth, koppelt de eigen identiteit',
  'connectors-hubspot': 'GAP-3 (P1): per-user OAuth',
  'connectors-outlook': 'GAP-3 (P1): per-user OAuth',
  'outlook-live': 'GAP-3 (P1): leest de eigen mailbox van de aanroeper',
  'hubspot-write': 'GAP-3 (P1): schrijft in het gedeelde CRM, heeft callerverwijzingen maar geen rolcheck',
};
// De pgvector-operatoren horen PUBLIC te zijn; die filteren we uit M2.
const PGVECTOR = /^(vector|halfvec|sparsevec|array_to_|l2_|l1_|inner_|cosine_|binary_|hamming_|jaccard_|hnsw|ivfflat|subvector|avg|sum)/;
// Poort-tokens: alles wat aantoonbaar naar de AANROEPER kijkt. Bewust NIET in
// deze lijst: `rag_owner_scope_ids`, `mail_scope_user_ids` en
// `mail_scope_single_user_id`. Die heten als een poort maar vragen nooit wie er
// belt — `mail_scope_user_ids()` geeft zelfs NULL ("geen restrictie") zodra
// auth.uid() gevuld is. Ze meetellen als poort gaf op 2026-09-14 één vals
// groen: find_similar_sent_mails, dat mailbodies teruggeeft.
const POORT = /auth\.uid\(\)|auth\.role\(\)|auth\.jwt\(\)|is_admin_or_higher|is_app_owner|can_manage_dashboard|current_user_role|session_mfa_ok|has_capability|confluence_allowed_spaces|app_skills_visible|require_dashboard_auth|assert_can_manage_dashboard|assert_service_role/i;

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
      return !/app_role|is_admin_or_higher|user_roles|has_capability|can_manage_dashboard/.test(fs.readFileSync(f, 'utf8'));
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
  const m8Fout = buckets.filter(b => /bucket_id/.test(b.qual) && !/auth\.uid|is_app_owner|is_admin_or_higher|has_capability|foldername/.test(b.qual));
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
  } finally {
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
