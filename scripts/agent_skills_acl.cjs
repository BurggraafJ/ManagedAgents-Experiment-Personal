#!/usr/bin/env node
// =============================================================================
// agent_skills_acl.cjs — de lek-assertie op app_skills          (v1.156, 04 PR-B)
// =============================================================================
// De NAAM van een werkwijze is informatie. "QBR-checklist voor de MT-review"
// verraadt dat er een MT-review is, ook als de body nooit meekomt. Deze set
// bewijst dat de titel, de beschrijving en de body van een `app_skill` alleen
// bij de aanroeper komen die hem mag zien — op de datalaag, waar de chat leest.
//
//   SBT=<management_token> node scripts/agent_skills_acl.cjs
//   (zonder SBT wordt ~/.claude/supabase-mcp.json gelezen)
//
// Exit 0 = alles groen. Exit 1 = minstens één assertie rood.
//
// ⚠ Bewust NIET in confluence_acl_eval.cjs. Die bewaakt een andere
// identiteits-as (spaces, confluence_allowed_spaces) en staat op 17/17; twee
// onderwerpen in één script maakt een rode uitslag dubbelzinnig.
//
// ⚠ De belangrijkste asserties zijn A1 en A2, de POSITIEVE controles: elke
// persona MOET zijn eigen skill terugkrijgen. Een test die alleen bewijst dat
// een verboden skill nooit opduikt, slaagt óók als de identiteit nooit wordt
// geraadpleegd — precies zo is het Confluence-gat maanden onzichtbaar gebleven.
//
// ⚠ PUBLIEKE REPO. Geen e-mailadressen, geen klantnamen, geen skill-inhoud uit
// productie. De persona's worden op ROL opgezocht (user_roles.app_role), niet op
// mailadres. De fixtures maakt dit script zelf aan en ruimt het weer op (A10);
// hun titels en bodies zijn onschuldige testtekst.
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
const UA = { 'User-Agent': 'legal-mind-dashboard-claude/1.0' };
// Een uuid die geen gebruiker is. Fail-closed betekent: deze ziet alleen scope=org.
const STRANGER = '00000000-0000-0000-0000-0000000000ff';
const PREFIX = 'zz-acl-';

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
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const results = [];
function assert(id, wat, ok, gemeten, verwacht) {
  results.push({ id, wat, ok, gemeten: String(gemeten), verwacht });
  console.log(`${ok ? ' OK ' : 'ROOD'}  ${id.padEnd(4)} ${wat.padEnd(56)} ${String(gemeten).padEnd(30)} ${verwacht}`);
}

// Alles wat dit script over een persona wil weten in één rondgang: welke slugs
// hij ziet, welke etag daarbij hoort, en wat `app_skill_open` per fixture geeft.
async function viewOf(uid) {
  const arg = uid ? `${q(uid)}::uuid` : 'null';
  const rows = await sql(`
    select coalesce(string_agg(v.slug, ',' order by v.slug), '') as slugs,
           count(*) filter (where v.scope <> 'org')              as niet_org,
           count(*)                                              as totaal,
           (select public.app_skills_etag(${arg}))                as etag
      from public.app_skills_visible(${arg}) v`);
  const r = rows[0];
  return {
    slugs: String(r.slugs || '').split(',').filter(Boolean),
    nietOrg: Number(r.niet_org), totaal: Number(r.totaal), etag: r.etag,
  };
}
// Wat `app_skill_open` teruggeeft, gereduceerd tot iets dat je kunt vergelijken:
// aantal rijen + of er een body bij zat. Nooit de body zelf printen.
async function openOf(slug, uid) {
  const arg = uid ? `${q(uid)}::uuid` : 'null';
  const rows = await sql(`
    select count(*) as n,
           coalesce(sum(length(o.body)), 0) as body_chars,
           coalesce(string_agg(o.slug, ','), '') as slugs
      from public.app_skill_open(${q(slug)}, ${arg}) o`);
  return { n: Number(rows[0].n), bodyChars: Number(rows[0].body_chars), slugs: rows[0].slugs };
}

(async () => {
  console.log('app_skills ACL — ' + new Date().toISOString() + '\n');
  console.log('      id   assertie                                                 gemeten                        verwacht');
  console.log('      ' + '-'.repeat(122));

  // ── K1/K2: de statische helft, vóór er één fixture bestaat ────────────────
  // Commentaar eruit: een gate die op een `--`-regel afgaat meet de tekst en
  // niet de code. (Gemeten: de eerste versie van deze gate stond rood op mijn
  // eigen comment "hier staat bewust geen `where scope`".)
  const defs = (await sql(`
    select regexp_replace(pg_get_functiondef('public.app_skill_open(text,uuid)'::regprocedure), '--[^\n]*', '', 'g') as open_def,
           regexp_replace(pg_get_functiondef('public.app_skills_visible(uuid)'::regprocedure),  '--[^\n]*', '', 'g') as vis_def,
           regexp_replace(pg_get_functiondef('public.app_skills_etag(uuid)'::regprocedure),     '--[^\n]*', '', 'g') as etag_def`))[0];
  const hits = (s, re) => (String(s).match(re) || []).length;

  assert('K1', 'app_skill_open selecteert UIT app_skills_visible',
    hits(defs.open_def, /app_skills_visible\(/g) === 1,
    `${hits(defs.open_def, /app_skills_visible\(/g)} verwijzing(en)`, 'exact 1');
  assert('K1b', 'app_skill_open heeft geen eigen scope-predicaat',
    hits(defs.open_def, /scope/gi) === 0,
    `${hits(defs.open_def, /scope/gi)} keer "scope" in de code`, '0');
  assert('K1c', 'app_skills_etag selecteert UIT hetzelfde predicaat',
    hits(defs.etag_def, /app_skills_visible\(/g) === 1 && hits(defs.etag_def, /scope/gi) === 0,
    `${hits(defs.etag_def, /app_skills_visible\(/g)} verwijzing(en), ${hits(defs.etag_def, /scope/gi)}x scope`, '1 en 0');
  assert('K2c', 'geen current_user_role() in het predicaat (die faalt open)',
    hits(defs.vis_def, /current_user_role\(/g) === 0 && hits(defs.open_def, /current_user_role\(/g) === 0,
    `visible ${hits(defs.vis_def, /current_user_role\(/g)}x, open ${hits(defs.open_def, /current_user_role\(/g)}x`, '0 en 0');

  // Een kale CREATE FUNCTION geeft PUBLIC execute — en juist voor `anon` neemt
  // het caller-patroon p_caller_user_id wél over. Gemeten op dit project:
  // confluence_allowed_spaces draagt vandaag `=X/postgres`.
  const acl = await sql(`
    select p.proname as naam, coalesce(p.proacl::text, 'PUBLIC-default') as acl
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('app_skills_visible', 'app_skill_open', 'app_skills_etag')`);
  const publiek = acl.filter((r) => r.acl === 'PUBLIC-default' || /(^|,)=X/.test(r.acl)).map((r) => r.naam);
  assert('K2d', 'geen PUBLIC/anon execute op de drie RPC\'s', publiek.length === 0,
    publiek.length ? publiek.join(',') : `${acl.length} functies, alleen authenticated+service_role`, 'geen');

  const pol = await sql(`select count(*)::int as n from pg_policies where schemaname='public' and tablename='app_skills'`);
  const rls = await sql(`select relrowsecurity as aan from pg_class where oid='public.app_skills'::regclass`);
  assert('K2e', 'RLS staat aan met drie policies (editor-laag)',
    rls[0].aan === true && Number(pol[0].n) === 3, `rls=${rls[0].aan}, policies=${pol[0].n}`, 'true en 3');

  // ── Persona's op ROL, niet op mailadres (publieke repo) ───────────────────
  const owner = (await sql(`select user_id::text as id from public.user_roles where app_role='owner' order by created_at limit 1`))[0];
  const member = (await sql(`select user_id::text as id from public.user_roles where app_role='member' order by created_at limit 1`))[0];
  if (!owner || !member) throw new Error('geen owner- én member-persona in user_roles — de rol-as is niet te testen');

  // ── Fixtures: aanmaken, en aan het eind weer weg (A10) ────────────────────
  // Eerst opruimen: een vorige ronde die halverwege stukliep mag deze niet
  // laten slagen op oude rijen.
  await sql(`delete from public.app_skills where slug like ${q(PREFIX + '%')}`);
  await sql(`
    insert into public.app_skills (slug, title, description, body, scope, scope_user_id, scope_role, sort_order)
    values
      (${q(PREFIX + 'jelle')}, 'ACL-test A (eigenaar)',  'Testbeschrijving A.', 'Testbody A, alleen voor persona A.', 'user', ${q(owner.id)}::uuid,  null,      900),
      (${q(PREFIX + 'jay')},   'ACL-test B (collega)',   'Testbeschrijving B.', 'Testbody B, alleen voor persona B.', 'user', ${q(member.id)}::uuid, null,      901),
      (${q(PREFIX + 'role')},  'ACL-test rol owner',     'Testbeschrijving R.', 'Testbody R, alleen voor rol owner.', 'role', null,                  'owner',   902),
      (${q(PREFIX + 'org')},   'ACL-test org',           'Testbeschrijving O.', 'Testbody O, voor iedereen.',         'org',  null,                  null,      903)`);

  try {
    const asA = await viewOf(owner.id);
    const asB = await viewOf(member.id);
    const asStranger = await viewOf(STRANGER);
    const asCron = await viewOf(null);

    // ── A1-A4: de vier metingen, niet twee ──────────────────────────────────
    assert('A1', 'persona A ziet zijn eigen skill', asA.slugs.includes(PREFIX + 'jelle'),
      `${asA.totaal} zichtbaar, eigen erbij=${asA.slugs.includes(PREFIX + 'jelle')}`, 'ja  [POSITIEVE CONTROLE]');
    assert('A2', 'persona B ziet zijn eigen skill', asB.slugs.includes(PREFIX + 'jay'),
      `${asB.totaal} zichtbaar, eigen erbij=${asB.slugs.includes(PREFIX + 'jay')}`, 'ja  [POSITIEVE CONTROLE]');
    assert('A3', 'persona A ziet die van B niet', !asA.slugs.includes(PREFIX + 'jay'),
      asA.slugs.filter((s) => s.startsWith(PREFIX)).join(',') || 'geen fixture', `zonder ${PREFIX}jay`);
    assert('A4', 'persona B ziet die van A niet', !asB.slugs.includes(PREFIX + 'jelle'),
      asB.slugs.filter((s) => s.startsWith(PREFIX)).join(',') || 'geen fixture', `zonder ${PREFIX}jelle`);

    // ── A5/A6: fail-closed (poort K2) ───────────────────────────────────────
    assert('A5', 'onbekende uuid ziet alleen scope=org', asStranger.nietOrg === 0,
      `${asStranger.nietOrg} niet-org van ${asStranger.totaal}`, '0 niet-org');
    assert('A6', 'service-aanroeper zonder uid ziet alleen scope=org', asCron.nietOrg === 0,
      `${asCron.nietOrg} niet-org van ${asCron.totaal}`, '0 niet-org');
    assert('A6b', 'en die ziet de org-skill wél (geen blinde fail-closed)',
      asCron.slugs.includes(PREFIX + 'org'), `${asCron.totaal} zichtbaar`, `met ${PREFIX}org`);

    // ── A7: "bestaat niet" ≡ "niet van jou" ─────────────────────────────────
    const geheim = await openOf(PREFIX + 'jay', owner.id);
    const bestaatNiet = await openOf('bestaat-niet-xyz', owner.id);
    assert('A7', 'open op onzichtbaar ≡ open op onbestaand',
      geheim.n === 0 && bestaatNiet.n === 0 && geheim.slugs === bestaatNiet.slugs,
      `onzichtbaar n=${geheim.n}/"${geheim.slugs}", onbestaand n=${bestaatNiet.n}/"${bestaatNiet.slugs}"`,
      'identiek, 0 rijen');

    // ── A8: open respecteert de scope in beide richtingen ───────────────────
    const aOwn = await openOf(PREFIX + 'jelle', owner.id);
    const bOwn = await openOf(PREFIX + 'jay', member.id);
    const bOther = await openOf(PREFIX + 'jelle', member.id);
    assert('A8', 'open: eigen skill geeft een body, die van de ander niets',
      aOwn.n === 1 && aOwn.bodyChars > 0 && bOwn.n === 1 && bOwn.bodyChars > 0 && bOther.n === 0 && bOther.bodyChars === 0,
      `A eigen=${aOwn.n}/${aOwn.bodyChars}ch, B eigen=${bOwn.n}/${bOwn.bodyChars}ch, B andermans=${bOther.n}/${bOther.bodyChars}ch`,
      '1+body, 1+body, 0+0');

    // ── A9: de rol-as ───────────────────────────────────────────────────────
    assert('A9', 'rol-skill voor owner is onzichtbaar voor de member',
      asA.slugs.includes(PREFIX + 'role') && !asB.slugs.includes(PREFIX + 'role'),
      `owner=${asA.slugs.includes(PREFIX + 'role')}, member=${asB.slugs.includes(PREFIX + 'role')}`, 'true en false');
    const roleOpen = await openOf(PREFIX + 'role', member.id);
    assert('A9b', 'en de member kan hem ook niet openen', roleOpen.n === 0,
      `n=${roleOpen.n}`, '0');

    // ── E1: de etag — caller-gescopeerd, en hij beweegt alleen bij inhoud ───
    assert('E1', 'etag verschilt per persona (hij is caller-gescopeerd)',
      asA.etag !== asB.etag && asA.etag !== 'empty',
      `A=${String(asA.etag).slice(0, 8)}… B=${String(asB.etag).slice(0, 8)}…`, 'verschillend');
    const etagVoor = (await viewOf(owner.id)).etag;
    await sql(`update public.app_skills set active = active, sort_order = sort_order where slug = ${q(PREFIX + 'jelle')}`);
    const etagNaNoop = (await viewOf(owner.id)).etag;
    await sql(`update public.app_skills set description = 'Testbeschrijving A, gewijzigd.' where slug = ${q(PREFIX + 'jelle')}`);
    const etagNaEdit = (await viewOf(owner.id)).etag;
    assert('E1b', 'etag blijft gelijk zonder tekstwijziging', etagVoor === etagNaNoop,
      `${String(etagVoor).slice(0, 8)}… → ${String(etagNaNoop).slice(0, 8)}…`, 'gelijk');
    assert('E1c', 'etag verandert na één description-bewerking', etagNaEdit !== etagVoor,
      `${String(etagVoor).slice(0, 8)}… → ${String(etagNaEdit).slice(0, 8)}…`, 'verschillend');

    // ── E2: version is afgeleid, niet gegeven ───────────────────────────────
    const v = (await sql(`
      select version from public.app_skills where slug = ${q(PREFIX + 'jelle')}`))[0];
    await sql(`update public.app_skills set version = 999, sort_order = 905 where slug = ${q(PREFIX + 'jelle')}`);
    const v2 = (await sql(`select version from public.app_skills where slug = ${q(PREFIX + 'jelle')}`))[0];
    assert('E2', 'version +1 bij tekstwijziging, en niet door de client te zetten',
      Number(v.version) === 2 && Number(v2.version) === 2,
      `na 1 edit=${v.version}, na "set version=999"=${v2.version}`, '2 en 2');

    // ── E3: de scope-CHECK is een positieve controle op zichzelf ────────────
    // Een halfgevulde rij is de stille lek-kandidaat: scope='org' MÉT een
    // scope_user_id is bedoeld als persoonlijk en komt org-breed uit.
    let checkHeld = false;
    try {
      await sql(`insert into public.app_skills (slug, title, scope, scope_user_id)
                 values (${q(PREFIX + 'bad')}, 'ACL-test halfgevuld', 'org', ${q(owner.id)}::uuid)`);
    } catch (e) { checkHeld = /app_skills_scope_shape_chk/.test(e.message); }
    assert('E3', 'CHECK weigert scope=org mét een scope_user_id', checkHeld,
      checkHeld ? 'app_skills_scope_shape_chk hield' : 'rij werd geaccepteerd', 'geweigerd');

    // ── E4: caps ────────────────────────────────────────────────────────────
    let capHeld = false;
    try {
      await sql(`insert into public.app_skills (slug, title, description, scope)
                 values (${q(PREFIX + 'cap')}, 'ACL-test cap', repeat('x', 501), 'org')`);
    } catch (e) { capHeld = /app_skills_description_chk/.test(e.message); }
    assert('E4', 'CHECK weigert een description boven 500 tekens', capHeld,
      capHeld ? 'app_skills_description_chk hield' : 'rij werd geaccepteerd', 'geweigerd');
  } finally {
    // ── A10: opruimen, altijd ─────────────────────────────────────────────
    await sql(`delete from public.app_skills where slug like ${q(PREFIX + '%')}`);
  }
  const rest = (await sql(`select count(*)::int as n from public.app_skills where slug like ${q(PREFIX + '%')}`))[0];
  assert('A10', 'fixtures opgeruimd', Number(rest.n) === 0, `${rest.n} rijen over`, '0');

  // ── uitslag ───────────────────────────────────────────────────────────────
  const rood = results.filter((r) => !r.ok);
  console.log('\n' + '='.repeat(130));
  console.log(`${results.length - rood.length}/${results.length} groen`);

  // Vastleggen in rag_eval_runs/rag_eval_results, label `app-skills-acl` —
  // dezelfde tabellen die de Confluence-golden-set gebruikt, met een eigen label
  // zodat een rode uitslag ondubbelzinnig aan één as hangt.
  const runId = (await sql(`
    insert into public.rag_eval_runs (label, suite, status, started_at, finished_at, context_build_version, n_questions, n_asserted, signal_pass_rate, notes)
    values ('app-skills-acl', 'acl', 'done', now(), now(), 'app-skills-v1-rpc-acl', ${results.length}, ${results.length},
            ${((results.length - rood.length) / results.length).toFixed(4)},
            ${q(`04 PR-B app_skills ACL. ${results.length - rood.length}/${results.length} groen. A1/A2 = de positieve controles (elke persona ziet zijn eigen skill); alleen de negatieve helft slaagt ook als de identiteit nooit wordt geraadpleegd.`)})
    returning id`))[0].id;
  const waarden = results.map((r) => `(${q(runId)}::uuid, ${q(r.id)}, ${q(r.wat)}, 'app-skills-acl', ${r.ok}, ${q(`gemeten: ${r.gemeten} | verwacht: ${r.verwacht}`)})`).join(',\n');
  await sql(`insert into public.rag_eval_results (run_id, question_id, question, dimension, signal_hit, assert_detail)
             values ${waarden}`);
  console.log(`vastgelegd in rag_eval_runs ${runId}`);

  if (rood.length) {
    console.log('ROOD: ' + rood.map((r) => r.id).join(', '));
    process.exit(1);
  }
  console.log('app_skills-ACL groen');
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
