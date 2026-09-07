// =============================================================================
// chat-run.cjs — rag-chat aanroepen in RUN-modus en de rij uitlezen
// =============================================================================
// Spoor 02 I2 (v1.151). Tot v6.0 was een vraag één HTTP-call die het antwoord
// in zijn body teruggaf; sinds v6.0 is een vraag een rij in `agent_chat_runs` en
// geeft de call binnen ~0,3–3 s alleen een `run_id`. Elk script dat rag-chat
// meet moet dus twee dingen doen: starten, en de rij volgen tot hij terminaal is.
//
// Dat "volgen" hoort op één plek te staan. Deze module is die plek: de smoke
// (`agent_chat_smoke.cjs`) en de evalrunner (`rag-eval-cron`, TypeScript, eigen
// kopie van dezelfde lus) doen het identiek, en `askRun()` levert een object in
// de vorm die het oude compat-antwoord had — zodat de bestaande asserties S1–S5
// letterlijk hetzelfde kunnen blijven vragen.
//
// Waarom niet op de HTTP-response wachten: de gateway kapt élke niet-streamende
// call na 150 s af met een 504 (gemeten M2b/M2c), terwijl een agentische run tot
// 240 s budget heeft. De rij kent die grens niet — daar staat het antwoord ook
// als de starter allang is weggelopen. Dat is precies wat poort T2 meet.
//
// De timeout is dus NIET een vaste klok maar `budget.wall_ms + marge`: de run
// mag zo lang duren als zijn effort toestaat (poort T5).
// =============================================================================

const POLL_MS = 2000;
const TERMINAL = ['done', 'failed', 'cancelled'];
const TIMEOUT_MARGIN_MS = 30_000;

// Kolommen die een meter nodig heeft. Bewust géén `answer_partial` (tussenstand)
// en géén `envelope->rows` beperking: de asserties over de tabel lezen de envelop.
const SELECT = `state, phase_label, route, effort, budget, spent, hop, hops, steps,
  answer_md, envelope, citations, analytics, meta, input_request, error, query_log_id,
  created_at, finished_at,
  extract(epoch from (coalesce(finished_at, now()) - created_at)) * 1000 as wall_ms`;

// Eén POST. `origin` maakt de rij herkenbaar in de gezondheidsview, zodat
// smoke-verkeer niet meetelt in de cijfers over echte vragen.
async function startRun({ fnBase, jwt, body, ua, timeoutMs = 30_000 }) {
  const t0 = Date.now();
  const r = await fetch(`${fnBase}/rag-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}`, apikey: jwt, ...ua },
    body: JSON.stringify({ ...body, run: true }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const txt = await r.text();
  let j = {};
  try { j = JSON.parse(txt); } catch { j = { raw: txt.slice(0, 200) }; }
  return { http: r.status, kick_ms: Date.now() - t0, ...j };
}

// Volgen tot terminaal. `sql` is een functie die één read-only query uitvoert en
// een rijen-array teruggeeft (de smoke gebruikt de Management API, de evalrunner
// zijn service-role client).
async function pollRun({ sql, runId, budgetWallMs = 240_000, marginMs = TIMEOUT_MARGIN_MS, pollMs = POLL_MS, onTick = null }) {
  const deadline = Date.now() + budgetWallMs + marginMs;
  let last = null;
  while (Date.now() < deadline) {
    const rows = await sql(`select ${SELECT} from public.agent_chat_runs where id = '${runId}'`);
    const row = rows[0] || null;
    if (!row) return { row: null, timedOut: false, missing: true };
    last = row;
    if (onTick) { try { onTick(row); } catch { /* alleen weergave */ } }
    // `needs_input` is terminaal voor een meter: er komt niets meer tenzij
    // iemand antwoordt, en dat doet een smoke niet.
    if (TERMINAL.includes(row.state) || row.state === 'needs_input') return { row, timedOut: false, missing: false };
    await new Promise((res) => setTimeout(res, pollMs));
  }
  return { row: last, timedOut: true, missing: false };
}

// De rij in de vorm van het oude compat-antwoord. Alles wat de UI en de
// asserties uit het `meta`-frame haalden staat sinds v6.1 in `agent_chat_runs.meta`.
function rowToAnswer(row, started) {
  const meta = row?.meta || {};
  const env = row?.envelope || null;
  return {
    ok: row?.state === 'done',
    run_id: started?.run_id ?? null,
    state: row?.state ?? null,
    answer: row?.answer_md ?? null,
    envelope: env,
    coverage: env?.coverage ?? null,
    analytics: row?.analytics ?? null,
    chunk_count: env?.coverage?.chunk_count ?? null,
    debug_pipeline: meta.debug_pipeline ?? {},
    retrieval_strategy: meta.retrieval_strategy ?? null,
    entity_used: meta.entity_used ?? null,
    bundle_id: meta.bundle_id ?? null,
    model: meta.model ?? null,
    web_citations: meta.web_citations ?? [],
    citations: row?.citations ?? [],
    query_log_id: row?.query_log_id ?? null,
    route: row?.route ?? null,
    effort: row?.effort ?? null,
    budget: row?.budget ?? null,
    spent: row?.spent ?? null,
    hops: Array.isArray(row?.hops) ? row.hops : [],
    steps: Array.isArray(row?.steps) ? row.steps : [],
    error: row?.error ?? null,
    latency_ms: row?.wall_ms != null ? Math.round(Number(row.wall_ms)) : null,
    kick_ms: started?.kick_ms ?? null,
  };
}

// Starten + volgen + omvormen, in één call.
async function askRun({ fnBase, jwt, body, ua, sql, marginMs, pollMs, onTick }) {
  const started = await startRun({ fnBase, jwt, body, ua });
  if (started.http !== 200 || !started.run_id) {
    return { ok: false, state: null, error: { code: `http_${started.http}`, message: String(started.error || started.hint || started.raw || '').slice(0, 300) }, kick_ms: started.kick_ms, run_id: started.run_id ?? null, started };
  }
  const budgetWallMs = Number(started.budget?.wall_ms) || 240_000;
  const { row, timedOut, missing } = await pollRun({ sql, runId: started.run_id, budgetWallMs, marginMs, pollMs, onTick });
  if (missing) return { ok: false, run_id: started.run_id, state: null, error: { code: 'row_missing', message: 'de run-rij is niet leesbaar' }, started };
  const out = rowToAnswer(row, started);
  if (timedOut) out.error = out.error || { code: 'runner_timeout', message: `niet terminaal binnen budget.wall_ms + ${Math.round((marginMs ?? TIMEOUT_MARGIN_MS) / 1000)} s` };
  out.timed_out = timedOut;
  out.started = started;
  return out;
}

module.exports = { startRun, pollRun, rowToAnswer, askRun, SELECT, TERMINAL, TIMEOUT_MARGIN_MS };
