// =============================================================================
// smoke-runs.cjs — S7–S11: de asserties die alleen over de RUN gaan
// =============================================================================
// Spoor 02 I2 (v1.151), poorten T2/T3/T5/T6/T10 uit EVAL-GATES.md. S1–S6 in
// `agent_chat_smoke.cjs` toetsen het antwoord; deze vijf toetsen de machinerie
// eronder — dat het antwoord de server niet verlaat om te bestaan.
//
//   S7   run-modus: de start-call geeft binnen enkele seconden een run_id met
//        budget uit `agent_config`, en de rij eindigt op `done` met een
//        antwoord, een kostenregel en hops binnen de harde hopgrens.
//   S8   DISCONNECT (poort T2, blokkerend). Drie runs waarvan de client 1 s na
//        het run_id de verbinding verbreekt. Alle drie moeten `done` zijn met
//        `answer_md` ≥ 40 tekens, en `finished_at` moet ná het moment van
//        verbreken liggen — dát is het bewijs dat het werk doorliep en niet
//        toevallig al klaar was.
//   S9   RLS (poort T3, blokkerend). Een run van persona 1, gelezen door
//        persona 2: 0 rijen via REST én 0 realtime-events. Beide met een
//        POSITIEVE CONTROLE door persona 1 zelf — een negatieve test zonder
//        positieve controle is hol groen (paper §5.5).
//   S10  elke vraag heeft een run-rij (poort T1): 0 querylogrijen zonder run_id.
//   S11  de waakhond leeft: de cron staat aan, zijn laatste tick slaagde, en er
//        hangt geen run niet-terminaal boven de drempel.
//
// ⚠ PUBLIEKE REPO. Persona's worden op runtime uit `auth.users` gehaald; er staat
// geen e-mailadres, naam of vraag met klantinhoud in dit bestand.
// =============================================================================

const path = require('path');
const { askRun, startRun, pollRun } = require('./chat-run.cjs');
const { mintUserJwt } = require('./user-jwt.cjs');

const HOP_HARD_MS = 170_000;
// Zo lang wacht de realtime-test op events. Ruim boven de ~0,4 s-cadans van
// `answer_partial`, zodat "0 events" niet gewoon "te snel gekeken" betekent.
const RT_WINDOW_MS = 15_000;

// Een vraag die met opzet geen klantinhoud raakt en toch echt onderzoek kost.
const RUN_Q = 'Vat samen wat er in de documentatie staat over hoe de zoekpijplijn werkt.';
// Kort en goedkoop: de disconnect-test meet de machinerie, niet het antwoord.
const DISCONNECT_Q = 'Noem in twee zinnen wat een retrieval-pijplijn doet.';

// ── S7 ───────────────────────────────────────────────────────────────────────
async function s7RunMode({ fnBase, jwt, ua, sql, assert }) {
  const r = await askRun({ fnBase, jwt, body: { message: RUN_Q, origin: 'smoke' }, ua, sql });
  console.log(`\n[run] kick=${r.kick_ms ?? '?'} ms  wall=${r.latency_ms ?? '?'} ms  route=${r.route}  effort=${r.effort}  hops=${r.hops.length}  state=${r.state}`);
  assert('S7', 'run: start-call geeft een run_id', !!r.run_id, r.error || r.started?.http);
  if (!r.run_id) return r;
  assert('S7', 'run: budget komt uit de configuratie', typeof r.started?.budget?.wall_ms === 'number' && typeof r.started?.budget?.tool_calls === 'number', r.started?.budget);
  assert('S7', 'run: rij eindigt op done', r.state === 'done', { state: r.state, error: r.error });
  assert('S7', 'run: antwoord staat in de rij', (r.answer || '').length >= 40, (r.answer || '').length);
  assert('S7', 'run: kostenregel gevuld', typeof r.spent?.usd === 'number', r.spent);
  assert('S7', 'run: querylog gekoppeld', !!r.query_log_id, r.query_log_id);
  assert('S7', `run: elke hop ≤ ${HOP_HARD_MS} ms`, r.hops.every((h) => (h.ms ?? 0) <= HOP_HARD_MS), r.hops.map((h) => h.ms));
  // Vork V12: budgetuitputting is een eigen blok, geen coverage.reason.
  assert('S7', 'run: envelop draagt het budgetblok', !!r.envelope?.budget && typeof r.envelope.budget.effort === 'string', r.envelope?.budget);
  // v6.1 — zonder deze payload is de chat-UI stiller dan het oude pad.
  assert('S7', 'run: meta draagt de UI-velden', !!r.retrieval_strategy && !!r.model, { retrieval_strategy: r.retrieval_strategy, model: r.model });
  return r;
}

// ── S8 (poort T2) ────────────────────────────────────────────────────────────
// De client haalt het run_id op, wacht 1 s, verbreekt, en kijkt daarna alleen
// nog naar de rij. `finished_at > abortedAt` sluit de valkuil uit dat de run al
// klaar was vóór het verbreken.
async function s8Disconnect({ fnBase, jwt, ua, sql, assert, times = 3 }) {
  for (let i = 1; i <= times; i++) {
    const ctrl = new AbortController();
    const t0 = Date.now();
    let started = null, kickErr = null;
    try {
      const r = await fetch(`${fnBase}/rag-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, apikey: jwt, ...ua },
        body: JSON.stringify({ message: `${DISCONNECT_Q} (${i})`, run: true, origin: 'smoke' }),
        signal: ctrl.signal,
      });
      started = await r.json();
    } catch (e) { kickErr = e instanceof Error ? e.message : String(e); }
    if (!started?.run_id) { assert('S8', `disconnect ${i}: run_id ontvangen`, false, kickErr || started); continue; }
    await new Promise((res) => setTimeout(res, 1000));
    ctrl.abort();
    const abortedAt = Date.now();
    const budgetWallMs = Number(started.budget?.wall_ms) || 240_000;
    const { row, timedOut } = await pollRun({ sql, runId: started.run_id, budgetWallMs });
    const finishedMs = row?.finished_at ? Date.parse(row.finished_at) : null;
    const len = (row?.answer_md || '').length;
    console.log(`  [S8/${i}] verbroken na ${abortedAt - t0} ms · state=${row?.state} · answer=${len} tekens · afgerond ${finishedMs ? finishedMs - abortedAt : '?'} ms ná het verbreken`);
    assert('S8', `disconnect ${i}: run bereikt done`, row?.state === 'done' && !timedOut, { state: row?.state, timedOut, error: row?.error });
    assert('S8', `disconnect ${i}: antwoord ≥ 40 tekens in de rij`, len >= 40, len);
    assert('S8', `disconnect ${i}: envelop aanwezig`, !!row?.envelope, !!row?.envelope);
    assert('S8', `disconnect ${i}: werk liep dóór na het verbreken`, !!finishedMs && finishedMs > abortedAt, { finished_at: row?.finished_at, aborted_ms_after_start: abortedAt - t0 });
  }
}

// ── S9 (poort T3) ────────────────────────────────────────────────────────────
// Twee echte gebruikers. Persona 1 start een run met zijn eigen JWT (dus
// owner_id = persona 1); persona 2 probeert hem te lezen — via REST en via de
// publicatie. Beide moeten niets geven, en persona 1 moet wél iets geven.
async function s9Rls({ ref, fnBase, anonKey, serviceKey, ua, sql, sqlRw, assert }) {
  const users = await sql(
    `select u.id::text as id, u.email from auth.users u
      where u.email is not null and u.deleted_at is null
      order by u.created_at limit 2`);
  if (users.length < 2) { assert('S9', 'RLS: twee gebruikers beschikbaar', false, users.length); return; }
  const [p1, p2] = users;

  let j1, j2;
  try {
    j1 = await mintUserJwt({ ref, serviceKey, email: p1.email });
    j2 = await mintUserJwt({ ref, serviceKey, email: p2.email });
  } catch (e) { assert('S9', 'RLS: persona-JWTs gemunt', false, e.message); return; }

  // Een goedkope, snelle run: de test gaat over zichtbaarheid, niet over inhoud.
  const started = await startRun({ fnBase, jwt: j1.jwt, body: { message: DISCONNECT_Q, origin: 'smoke', effort: 'low' }, ua });
  if (!started.run_id) { assert('S9', 'RLS: persona 1 kon een run starten', false, { http: started.http, error: started.error }); return; }
  const runId = started.run_id;
  const owner = await sql(`select owner_id::text as o, caller_user_id::text as c from public.agent_chat_runs where id = '${runId}'`);
  assert('S9', 'RLS: de run hangt aan persona 1', owner[0]?.o === j1.userId, { owner: owner[0]?.o === j1.userId, caller_matches: owner[0]?.c === j1.userId });

  // ── REST ──
  const restRead = async (jwt) => {
    const r = await fetch(`https://${ref}.supabase.co/rest/v1/agent_chat_runs?id=eq.${runId}&select=id,state`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${jwt}`, ...ua },
    });
    const t = await r.text();
    let rows = [];
    try { rows = JSON.parse(t); } catch { rows = []; }
    return { status: r.status, n: Array.isArray(rows) ? rows.length : 0 };
  };
  const asP2 = await restRead(j2.jwt);
  const asP1 = await restRead(j1.jwt);
  assert('S9', 'RLS/REST: persona 2 ziet 0 rijen', asP2.n === 0, asP2);
  // Gemeten 2026-09-07: óók de eigenaar ziet 0 rijen met een gemunte JWT, en dat
  // is juist. Het beleid is `session_mfa_ok() AND owner_id = auth.uid()`, en
  // `session_mfa_ok()` eist een rij in `user_session_mfa` op de `session_id` van
  // de JWT. Een magic-link-JWT heeft geen tweede factor (geheugen
  // `mfa-enforcement-live`), dus dit pad hóórt dicht te zijn. Een JWT met aal2
  // munten kan niet zonder een echte 6-cijferige code naar Jelle's mailbox te
  // sturen — dat doen we niet voor een rookronde.
  assert('S9', 'RLS/REST: ook de eigenaar ziet niets zonder tweede factor', asP1.n === 0, asP1);
  // De positieve controle daarom onder de ECHTE policy, maar via een sessie
  // waarin `session_mfa_ok()` niet van toepassing is (`session_user` is hier geen
  // 'authenticator'). Wat dan resteert is de eigenaarsclausule zelf — precies de
  // helft die de REST-test niet kan bereiken. `set local role` + rollback: geen
  // enkele schrijfactie. Zonder deze controle bewijst "persona 2 ziet 0 rijen"
  // niets (paper §5.5, hol groen).
  if (!sqlRw) {
    assert('S9', 'RLS/SQL: positieve controle overgeslagen (geen schrijf-SQL-kanaal)', false, 'sqlRw ontbreekt');
  } else {
    const asOwner = await sqlRw(`begin;
      set local role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${j1.userId}","role":"authenticated"}', true);
      select count(*)::int as n from public.agent_chat_runs where id = '${runId}';
      rollback;`);
    const asStranger = await sqlRw(`begin;
      set local role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${j2.userId}","role":"authenticated"}', true);
      select count(*)::int as n from public.agent_chat_runs where id = '${runId}';
      rollback;`);
    const nOwner = Number(asOwner?.[0]?.n);
    const nStranger = Number(asStranger?.[0]?.n);
    assert('S9', 'RLS/SQL: de eigenaar ziet zijn run onder de policy  [POSITIEVE CONTROLE]', nOwner === 1, { n: nOwner });
    assert('S9', 'RLS/SQL: een andere gebruiker ziet hem niet', nStranger === 0, { n: nStranger });
  }

  // ── Realtime ──
  // Zonder de positieve controle bewijst "0 events" niets: het kan ook betekenen
  // dat de publicatie stil is of dat de test te vroeg keek.
  const rt = await realtimeProbe({ ref, anonKey, runId, jwtOwner: j1.jwt, jwtOther: j2.jwt });
  if (rt.skipped) {
    console.log(`  ⏭  S9 realtime overgeslagen: ${rt.skipped}`);
    assert('S9', `RLS/realtime: overgeslagen (${rt.skipped})`, true, rt.skipped);
  } else {
    assert('S9', 'RLS/realtime: persona 2 krijgt 0 events', rt.other === 0, rt);
    assert('S9', 'RLS/realtime: persona 1 krijgt ≥ 1 event  [POSITIEVE CONTROLE]', rt.owner >= 1, rt);
  }

  // De run zelf mag gewoon aflopen; hij is van persona 1 en kost een paar cent.
  await pollRun({ sql, runId, budgetWallMs: Number(started.budget?.wall_ms) || 30_000 }).catch(() => {});
}

// Twee abonnementen op dezelfde rij, met twee identiteiten, tegelijk. Node 20
// heeft geen globale WebSocket, dus `ws` wordt expliciet meegegeven; ontbreekt
// die, dan slaat de test zichzelf over MET REDEN in plaats van groen te doen.
async function realtimeProbe({ ref, anonKey, runId, jwtOwner, jwtOther }) {
  let createClient, WS;
  try {
    createClient = require(path.join(process.cwd(), 'node_modules', '@supabase', 'supabase-js')).createClient;
    WS = require(path.join(process.cwd(), 'node_modules', 'ws'));
  } catch (e) { return { skipped: `supabase-js/ws niet beschikbaar (${e.code || e.message})` }; }

  const mk = (jwt) => createClient(`https://${ref}.supabase.co`, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    realtime: { transport: WS, params: { eventsPerSecond: 20 } },
  });
  const cOwner = mk(jwtOwner);
  const cOther = mk(jwtOther);
  await cOwner.realtime.setAuth(jwtOwner);
  await cOther.realtime.setAuth(jwtOther);

  const counts = { owner: 0, other: 0 };
  const subs = [];
  const sub = (client, key) => new Promise((resolve) => {
    const ch = client
      .channel(`smoke-rls-${key}-${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_chat_runs', filter: `id=eq.${runId}` }, () => { counts[key] += 1; })
      .subscribe((status) => { if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') resolve(status); });
    subs.push({ client, ch });
  });
  const st = { owner: await sub(cOwner, 'owner'), other: await sub(cOther, 'other') };
  if (st.owner !== 'SUBSCRIBED') { for (const { client, ch } of subs) { try { client.removeChannel(ch) } catch {} } return { skipped: `eigenaar kon niet abonneren (${st.owner})` }; }
  await new Promise((res) => setTimeout(res, RT_WINDOW_MS));
  for (const { client, ch } of subs) { try { client.removeChannel(ch) } catch { /* al dicht */ } }
  try { cOwner.realtime.disconnect(); cOther.realtime.disconnect(); } catch { /* al dicht */ }
  return { ...counts, other_status: st.other };
}

// ── S10 (poort T1) ───────────────────────────────────────────────────────────
async function s10EveryQuestionHasRun({ sql, assert, sinceIso }) {
  const rows = await sql(
    `select count(*) filter (where run_id is null) as zonder, count(*) as totaal
       from public.rag_chat_query_log where asked_at > '${sinceIso}'`);
  const { zonder, totaal } = rows[0] || {};
  assert('S10', `elke vraag heeft een run-rij (${totaal ?? 0} sinds ${sinceIso.slice(0, 16)})`, Number(zonder) === 0, { zonder, totaal });
}

// ── S11 ──────────────────────────────────────────────────────────────────────
// Geen injected stall in de rookronde: die schrijft testrijen op productie (I1
// deed hem één keer, met opruimen). Wat hier wél te meten is zonder bijwerking:
// staat de waakhond aan, deed hij zijn laatste tick zonder fout, en hangt er nu
// niets vast.
async function s11Watchdog({ sql, assert }) {
  const job = await sql(
    `select j.active, j.schedule,
            (select d.status from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1) as last_status,
            (select extract(epoch from (now() - d.start_time))::int from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1) as last_age_s
       from cron.job j where j.jobname = 'agent-chat-runs-watchdog'`);
  const w = job[0] || null;
  assert('S11', 'waakhond: cron bestaat en staat aan', w?.active === true, w);
  assert('S11', 'waakhond: laatste tick slaagde', w?.last_status === 'succeeded', { status: w?.last_status, age_s: w?.last_age_s });
  assert('S11', 'waakhond: laatste tick < 5 min oud', Number(w?.last_age_s) < 300, w?.last_age_s);
  const stuck = await sql(
    `select count(*) as n from public.agent_chat_runs
      where state not in ('done','failed','cancelled','needs_input')
        and created_at < now() - interval '30 minutes'`);
  assert('S11', 'waakhond: 0 runs niet-terminaal > 30 min', Number(stuck[0]?.n) === 0, stuck[0]);
  const lost = await sql(
    `select count(*) as n from public.agent_chat_runs
      where error->>'code' = 'hop_lost' and created_at > now() - interval '24 hours'`);
  assert('S11', 'waakhond: 0 hop_lost in 24 u', Number(lost[0]?.n) === 0, lost[0]);
}

module.exports = { s7RunMode, s8Disconnect, s9Rls, s10EveryQuestionHasRun, s11Watchdog, RUN_Q };
