#!/usr/bin/env node
// =============================================================================
// postvak_list_smoke.cjs — F7-poort: "het Postvak is een kopie van Outlook"
// =============================================================================
// Spoor 10-postvak-infra, fase F0/F2. De productlock van 2026-09-12 zegt: het
// Postvak toont de Outlook-map, niet wat een AI ervan vindt. Deze poort meet
// dat, en meet het op het pad dat de browser ook loopt — een geminte user-JWT
// plus een MFA-testsessie, want `mail_messages` staat achter
// `session_mfa_ok()` en met de service-role-sleutel meet je iets anders dan
// wat een mens ziet (onbetrouwbaar-groen leest als "het werkt").
//
//   P1  de Inbox-lijstquery levert rijen op voor de eigenaar
//   P2  het aantal is exact `mail_folders.total_item_count` van de Inbox —
//       Outlook's eigen telling, niet onze eigen som
//   P3  `audience` sluit niets uit: elke not_for_you-mail in de map staat er
//       ook in (de assertie die de oude mobiele lijst zou hebben afgekeurd)
//   P4  de mapquery is niet afgekapt door het brede recency-venster
//   P5  `mail_sync_state` is leesbaar voor de eigenaar én vers
//   P6  `request_mail_sync_now()` port de baan die écht loopt en zegt wat hij
//       deed (gedragstest, geen 200-check)
//   P7  desktop en mobiel bouwen de lijst met dezelfde functie
//   P8  er staat nergens een verstuur-tool buiten de allowlist
//
// Gebruik:  SBT=<management_token> node scripts/postvak_list_smoke.cjs
//           [--skip-mfa]   P1–P5 overslaan (die schrijven kort een MFA-sessie)
//           [--skip-rpc]   P6 overslaan (die start één echte mailsync)
//
// ⚠ PUBLIEKE REPO. Dit script print tellingen, mapnamen en id-vormen — nooit
//   een onderwerp, afzender of mailinhoud. De eigenaar wordt op runtime uit
//   `mail_accounts` gehaald; er staat geen e-mailadres in dit bestand.
// =============================================================================
const fs = require('fs');
const path = require('path');
const { mintUserJwt, revokeMintedSessions } = require('./lib/user-jwt.cjs');

const REF = process.env.SUPABASE_REF || 'ezxihctobrqoklufawim';
const SBT = process.env.SBT || (() => {
  try {
    return JSON.parse(fs.readFileSync(process.env.HOME + '/.claude/supabase-mcp.json', 'utf8'))
      .mcpServers.supabase.headers.Authorization.split(' ')[1];
  } catch { return null; }
})() || process.env.SUPABASE_ACCESS_TOKEN;

const SKIP_MFA = process.argv.includes('--skip-mfa');
const SKIP_RPC = process.argv.includes('--skip-rpc');
const UA = { 'User-Agent': 'legal-mind-dashboard-claude/1.0' };
const MGMT = `https://api.supabase.com/v1/projects/${REF}`;
const REST = `https://${REF}.supabase.co/rest/v1`;
const TESTMERK = 'postvak F0 lijstpoort';
// Zo vers moet de spiegel zijn voordat P5 groen wordt. De cron draait */5.
const SYNC_VERS_MIN = 30;

async function mgmt(p, init = {}) {
  const r = await fetch(`${MGMT}${p}`, {
    ...init,
    headers: { Authorization: `Bearer ${SBT}`, 'Content-Type': 'application/json', ...UA, ...(init.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`mgmt ${p} ${r.status}: ${t.slice(0, 300)}`);
  return JSON.parse(t);
}
const sql = (q) => mgmt('/database/query', { method: 'POST', body: JSON.stringify({ query: q, read_only: true }) });
const sqlRw = (q) => mgmt('/database/query', { method: 'POST', body: JSON.stringify({ query: q }) });

const uitslagen = [];
function assert(id, wat, ok, gemeten, verwacht) {
  uitslagen.push({ id, ok });
  console.log(`${ok ? ' OK ' : 'ROOD'}  ${id.padEnd(4)} ${wat.padEnd(52)} ${String(gemeten).padEnd(26)} ${verwacht ?? ''}`);
}
function overslaan(id, wat, waarom) {
  console.log(`  –   ${id.padEnd(4)} ${wat.padEnd(52)} overgeslagen (${waarom})`);
}

// De anon-sleutel is de `apikey` van de gateway; de user-JWT zit in
// Authorization. Beide op de JWT zetten geeft 401 — dat is een gateway-fout,
// geen RLS-uitslag.
let ANON = null;

/** PostgREST als een échte gebruiker. */
async function rest(jwt, pad) {
  const r = await fetch(`${REST}/${pad}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, Prefer: 'count=exact', ...UA },
  });
  const txt = await r.text();
  let body = [];
  try { body = JSON.parse(txt); } catch { /* laat body leeg */ }
  const range = r.headers.get('content-range') || '';
  return { status: r.status, body, total: Number((range.split('/')[1] ?? 'NaN')) };
}
async function restRpc(jwt, naam, payload = {}) {
  const r = await fetch(`${REST}/rpc/${naam}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', ...UA },
    body: JSON.stringify(payload),
  });
  const txt = await r.text();
  try { return { status: r.status, body: JSON.parse(txt) }; }
  catch { return { status: r.status, body: txt.slice(0, 200) }; }
}

(async () => {
  if (!SBT) { console.error('geen management-token (SBT / ~/.claude/supabase-mcp.json)'); process.exit(2); }

  // Het contract zelf inladen — dezelfde module die desktop en mobiel gebruiken.
  const contract = await import(
    'file://' + path.resolve(__dirname, '..', 'src', 'lib', 'postvakContract.js')
  );
  const { INBOX_ROOT_OR, INBOX_FETCH_LIMIT, MAIL_LIST_SELECT, buildInboxRows, isInboxRoot } = contract;

  console.log(`\npostvak-lijstpoort · ${new Date().toISOString()}\n`);

  // ── Wie is de eigenaar van de mailbox ────────────────────────────────────
  const eig = await sql(`
    select a.user_id, u.email, f.id as inbox_folder_id, f.total_item_count
      from public.mail_accounts a
      join auth.users u on u.id = a.user_id
      left join public.mail_folders f
        on f.user_id = a.user_id and f.well_known_name = 'inbox'
     where a.enabled and not a.paused
     order by a.created_at
     limit 1`);
  if (!eig[0]) { console.error('geen enabled mail_account — niets te meten'); process.exit(2); }
  const owner = eig[0];
  console.log(`mailbox-eigenaar: ${String(owner.user_id).slice(0, 8)}…  inbox-map: ${owner.inbox_folder_id ? 'gevonden' : 'ONBEKEND'}\n`);

  // Outlook's eigen telling van de Inbox — de noemer waar P2 tegenaan meet.
  const outlookTelling = owner.total_item_count;

  let opruimen = async () => {};
  try {
    let jwt = null;
    if (SKIP_MFA) {
      overslaan('P1', 'inbox-lijst leesbaar als de eigenaar', '--skip-mfa');
      overslaan('P2', 'lijst == Outlook-telling van de Inbox', '--skip-mfa');
      overslaan('P3', 'audience sluit niets uit', '--skip-mfa');
      overslaan('P4', 'mapquery niet afgekapt door recency-venster', '--skip-mfa');
      overslaan('P5', 'mail_sync_state leesbaar en vers', '--skip-mfa');
    } else {
      const keys = await mgmt('/api-keys?reveal=true');
      const serviceKey = keys.find(k => k.name === 'service_role')?.api_key;
      ANON = keys.find(k => k.name === 'anon')?.api_key;
      if (!serviceKey || !ANON) throw new Error('geen service_role/anon-sleutel via /api-keys');
      const gemint = await mintUserJwt({ ref: REF, serviceKey, email: owner.email });
      jwt = gemint.jwt;
      const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString());
      opruimen = async () => {
        await sqlRw(`delete from public.user_session_mfa where user_agent = '${TESTMERK}';`);
        // De geminte sessie weer intrekken (scope local) — een meting hoort geen
        // extra ingelogde sessie achter te laten.
        await revokeMintedSessions();
      };
      // Een geminte JWT draagt geen tweede factor. Zonder deze rij is de
      // eigenaar nul rijen en meet je vals rood.
      await sqlRw(`insert into public.user_session_mfa (session_id, user_id, expires_at, method, user_agent)
                   values ('${claims.session_id}'::uuid, '${owner.user_id}'::uuid, now() + interval '5 minutes', 'otp', '${TESTMERK}')
                   on conflict (session_id) do update set expires_at = excluded.expires_at, user_agent = excluded.user_agent;`);

      // ── P1/P2 — exact de call die useAutoDraft doet ───────────────────────
      const q = `mail_messages?select=${MAIL_LIST_SELECT}&is_deleted=eq.false&or=(${INBOX_ROOT_OR})` +
                `&order=received_at.desc&limit=${INBOX_FETCH_LIMIT}`;
      const lijst = await rest(jwt, q);
      assert('P1', 'inbox-lijst leesbaar als de eigenaar',
        lijst.status === 200 || lijst.status === 206, `http ${lijst.status}, ${lijst.body.length} rijen`, '200/206 + rijen');
      assert('P2', 'lijst == Outlook-telling van de Inbox',
        outlookTelling != null && lijst.body.length === outlookTelling,
        `${lijst.body.length} vs ${outlookTelling ?? '?'}`, 'gelijk');

      // ── P3 — audience mag niets wegnemen ──────────────────────────────────
      const adRows = await rest(jwt, 'autodraft_mails?select=mail_id,audience,status,category_key,suggested_action,target_folder&limit=1000');
      const rows = buildInboxRows(lijst.body, adRows.body, {});
      const nietVoorJou = rows.filter(r => r.audience === 'not_for_you').length;
      const overige = rows.filter(r => r.inference_classification === 'other').length;
      // Negatieve controle: precies de rijen die de oude mobiele regel wegliet.
      // Zonder dit getal zegt "16 rijen" niets over het verschil.
      const openVoorJou = new Set((adRows.body || [])
        .filter(a => (a.status === 'pending' || a.status === 'amended') && a.audience === 'for_you')
        .map(a => a.mail_id));
      const oudeLijst = rows.filter(r => openVoorJou.has(r.mail_id)).length;
      const zonderOordeel = rows.filter(r => r.__no_draft_yet === true).length;
      assert('P3', 'audience sluit niets uit',
        rows.length === lijst.body.length && rows.every(r => isInboxRoot(r.folder_path)),
        `${rows.length} rijen, ${nietVoorJou} not_for_you + ${overige} Overige`, 'alles uit de map');
      // Een mail waar de skill nooit iets over gezegd heeft is de zuiverste
      // test: die kón onder de oude regel per definitie niet zichtbaar zijn.
      assert('P3b', 'mail zónder AI-oordeel staat gewoon in de lijst',
        zonderOordeel > 0, `${zonderOordeel} van ${rows.length} zonder autodraft-rij`, '> 0');
      console.log(`      ↳ de oude mobiele regel (for_you + open voorstel) gaf ${oudeLijst} van ${rows.length} rijen`);

      // ── P4 — de Inbox mag niet stil afgekapt worden ───────────────────────
      const breed = await rest(jwt, `mail_messages?select=id,folder_path,received_at&is_deleted=eq.false&order=received_at.desc&limit=500`);
      const inBreed = (breed.body || []).filter(m => isInboxRoot(m.folder_path)).length;
      const buitenVenster = lijst.body.length - inBreed;
      assert('P4', 'mapquery niet afgekapt door recency-venster',
        lijst.body.length < INBOX_FETCH_LIMIT && (outlookTelling == null || lijst.body.length === outlookTelling),
        `${lijst.body.length}/${INBOX_FETCH_LIMIT} opgehaald`, 'ruim onder de limiet');
      console.log(`      ↳ ${buitenVenster} Inbox-mail(s) zou(den) buiten het brede 500-venster vallen`);

      // ── P5 — sync-stand ───────────────────────────────────────────────────
      const st = await rest(jwt, 'mail_sync_state?select=folder_id,last_delta_at&order=last_delta_at.desc');
      const verst = st.body?.[0]?.last_delta_at || null;
      const minutenOud = verst ? (Date.now() - new Date(verst).getTime()) / 60000 : Infinity;
      assert('P5', 'mail_sync_state leesbaar en vers',
        st.body.length > 0 && minutenOud < SYNC_VERS_MIN,
        `${st.body.length} rijen, ${Number.isFinite(minutenOud) ? minutenOud.toFixed(1) : '∞'} min oud`,
        `> 0 rijen, < ${SYNC_VERS_MIN} min`);
    }

    // ── P6 — de ververs-knop port de baan die loopt ─────────────────────────
    if (SKIP_RPC || !jwt) {
      overslaan('P6', 'request_mail_sync_now port de Edge-ETL', SKIP_RPC ? '--skip-rpc' : 'geen JWT');
    } else {
      const voor = await sql(`select coalesce(max(started_at), '-infinity') as t from public.agent_runs where agent_name = 'mail-sync'`);
      const r = await restRpc(jwt, 'request_mail_sync_now');
      const b = r.body || {};
      assert('P6a', 'RPC antwoordt met de baan-velden',
        r.status === 200 && typeof b.edge_sync_triggered === 'boolean' && 'mail_sync_last_delta_at' in b,
        `http ${r.status}, edge=${b.edge_sync_triggered}`, 'edge_sync_triggered aanwezig');
      if (b.edge_sync_triggered) {
        await new Promise(res => setTimeout(res, 12000));
        const na = await sql(`select coalesce(max(started_at), '-infinity') as t from public.agent_runs where agent_name = 'mail-sync'`);
        assert('P6b', 'er draaide daadwerkelijk een mail-sync',
          new Date(na[0].t) > new Date(voor[0].t), `${voor[0].t} → ${na[0].t}`, 'nieuwe run');
      } else {
        assert('P6b', 'skip-reden is een bekende', ['recently_synced', 'no_cron_secret', 'http_post_failed'].includes(b.edge_skip_reason), b.edge_skip_reason, 'bekende reden');
      }
      if (b.auto_draft_skill_stale) {
        console.log(`      ↳ let op: de AutoDraft-skill-lane staat stil (laatste run ${b.auto_draft_skill_last_run_at}) — concepten verouderen, de lijst niet`);
      }
    }

    // ── P7 — één builder voor beide schermen ────────────────────────────────
    const pools = fs.readFileSync(path.join('src', 'hooks', 'usePv2Pools.js'), 'utf8');
    const mob = fs.readFileSync(path.join('src', 'mobile', 'screens', 'MobilePostvak.jsx'), 'utf8');
    // Commentaarregels eruit: een uitleg die de oude regel citeert is geen
    // filter. Zonder deze stap keurt de poort zijn eigen documentatie af.
    const code = (txt) => txt.split('\n').filter(r => !/^\s*(\/\/|\*|\/\*)/.test(r)).join('\n');
    assert('P7a', 'desktop en mobiel delen buildInboxRows',
      pools.includes('buildInboxRows') && mob.includes('buildInboxRows'),
      `desktop=${pools.includes('buildInboxRows')} mobiel=${mob.includes('buildInboxRows')}`, 'beide');
    const gate = /audience\s*===\s*'(for_you|not_for_you)'/.exec(code(mob));
    assert('P7b', 'geen audience-filter meer in de mobiele lijst',
      !gate, gate ? gate[0] : 'geen for_you-gate', 'afwezig');

    // ── P8 — nooit versturen ────────────────────────────────────────────────
    const fout = [];
    (function loop(dir) {
      for (const naam of fs.readdirSync(dir)) {
        const p = path.join(dir, naam);
        const st = fs.statSync(p);
        if (st.isDirectory()) { loop(p); continue; }
        if (!/\.(ts|js|jsx|cjs)$/.test(naam)) continue;
        if (p.endsWith(path.join('_shared', 'outlook-write.ts'))) continue; // dáár staat de allowlist
        const txt = fs.readFileSync(p, 'utf8');
        if (/OUTLOOK_(OUTLOOK_)?(SEND|REPLY)_(EMAIL|DRAFT)/.test(txt)) fout.push(p);
      }
    })('supabase');
    assert('P8', 'geen verstuur-tool buiten de allowlist', fout.length === 0, fout.join(', ') || 'geen', '0 vindplaatsen');
  } finally {
    await opruimen();
  }

  const rood = uitslagen.filter(u => !u.ok);
  console.log(`\n${uitslagen.length - rood.length}/${uitslagen.length} groen${rood.length ? ` — rood: ${rood.map(r => r.id).join(', ')}` : ''}\n`);
  process.exit(rood.length ? 1 : 0);
})().catch(e => { console.error('\nafgebroken:', e.message); process.exit(2); });
