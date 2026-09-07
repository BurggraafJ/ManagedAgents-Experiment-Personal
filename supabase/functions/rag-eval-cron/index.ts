// =============================================================================
// rag-eval-cron v3.3 — evalrunner voor de vragenbank (spoor 01, v1.147; S3b stap 1, v1.148; 06f-α; spoor 02 I2)
// =============================================================================
// v3.3 (2026-09-07, spoor 02 I2): de runner meet de RUN, niet de HTTP-call.
//   `callRagChat` post `{run:true, eval_run_id}`, krijgt binnen ~1–3 s een
//   `run_id`, en leest daarna `agent_chat_runs` tot de rij terminaal is. Drie
//   dingen worden daarmee pas meetbaar:
//     • RO37 (agentisch, ≤ 180 s) — de oude clamp op 170 s en de gateway-grens
//       van 150 s zaten allebei ónder het budget van 240 s dat zo'n vraag mag
//       gebruiken; elke meting daarboven werd een `runner_timeout` van de meter
//       zelf. De time-out is nu `budget.wall_ms + 30 s`, dus de klok van de
//       meter zit niet meer in het getal (poort T5).
//     • `cost_usd` is `spent.usd` van de rij: de som over álle leveranciers
//       (router, agent, antwoordmodel, embeddings, rerank), niet alleen het
//       envelop-bedrag (poort T4).
//     • `expect_effort_at_least` is geen `pending` meer — het effort staat op de
//       rij (poort T10). `envelope_compact` draagt nu `run_id`, `effort`, `hops`
//       en `spent`, zodat een meting achteraf naar de run te herleiden is.
//   `chatFacts` leest dezelfde velden als vóór deze versie: `callRagChat` levert
//   de rij af in de vorm van het oude compat-antwoord. Zie ook
//   `scripts/lib/chat-run.cjs` — dezelfde lus, voor de rookronde.
// v3.2 (2026-09-06, spoor 06f-α): drie retrieval-asserts (expect_min_chunks,
//   max_chunks_per_record, top1_not_future — asserts.ts) en expect_sources_live (hier,
//   want die heeft de DB nodig: geen chunk van een verwijderde mail in het resultaat).
//   options.filter_after_days wordt bij de aanroep omgezet in een absolute filter_after,
//   zodat een tijdvenster-item niet veroudert. Verder ongewijzigd.
// v3.1 (2026-09-06, ANSWER-STACK S3b stap 1): judge gpt-5.5 → gpt-5.6-luna (judge.ts);
//   judge-tokens incl. cached_tokens per rij in envelope_compact.judge_usage. Runs van
//   vóór en ná deze versie zijn op kosten (G5) niet vergelijkbaar: de chatketen logt
//   sindsdien echte tarieven (grok 1,25/2,50; gpt-5.5 5/30; sol 4/20).
// v3.0 (2026-09-06): DB-geclaimde batches (rag_eval_run_items + rag_eval_claim_batch)
//   in plaats van een fire-and-forget keten met MAX_CHAIN; een pomp-cron (_pump)
//   pakt gestrande runs op. Persona-JWT per hop (generate_link + token_hash), uitloggen
//   na de hop, nooit gelogd. Preconditie rag_eval_persona_check → invalid_persona.
//   Lane uit de tabel, history mee, eval_run_id in de rag-chat-body, alle assert-keys
//   van RESEARCH §3.4 (asserts.ts), latency/cost/route/tools/sources/coverage per rij,
//   pending_asserts, afronden via rag_eval_finish_if_done (gates = rag_eval_compare).
// v2.4 (2026-07-17): homogene mini-batches van 3 + waitUntil-chaining, MAX_CHAIN 16.
// v2.x (2026-06-11): tabel-gedreven suite, deterministische asserts, gpt-5.5-judge.
// Auth: Bearer == skill:global:cron_secret OF service_role. verify_jwt:false (eigen auth).
//
// Body:  { label, suite (legacy71|rook-p0|chat-lane|full|acl|custom), ids[], only_tag,
//          lane, category, persona, compare_to, build_artifacts, force }   → nieuwe run
//        { _run_id, _hop }                                                  → volgende hop
//        { _pump: true }                                                    → gestrande run oppakken
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { requireCronOrServiceRole } from "../_shared/edge-auth.ts";
import { identityFor, loadPersonas, type HopIdentity } from "./persona.ts";
import { judgeRetrieval, judgeChat, chatJudgeEligible, clamp01, JUDGE_MODEL, type Q } from "./judge.ts";
import { chatFacts, runChatAsserts, runRetrievalAsserts, type ChatCall, type ArtifactBuild } from "./asserts.ts";

const RUNNER_VERSION = "v3.3";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CB_URL = `${SUPABASE_URL}/functions/v1/context-build`;
const RAG_CHAT_URL = `${SUPABASE_URL}/functions/v1/rag-chat`;
const ARTIFACT_URL = `${SUPABASE_URL}/functions/v1/agent-artifact-build`;
const SELF_URL = `${SUPABASE_URL}/functions/v1/rag-eval-cron`;
const UA = "legal-mind-rag-eval-cron/3.3";
// Hop-budget (D01-8): 3 chat-items per hop (één wave), retrieval 16 met 6 parallel.
// v3.3: de per-item time-out is niet meer een vaste klok maar het budget van de
// run zelf plus marge. De oude clamp(max_latency_ms × 1,2, 140 s, 170 s) mat de
// meter in plaats van de keten: een agentische vraag mág 240 s duren.
const BATCH_CHAT = 3;
const RETRIEVAL_CONCURRENCY = 6;
const RUN_TIMEOUT_MARGIN_MS = 30_000;
// Alleen voor de start-call (die geeft binnen enkele seconden een run_id terug).
const RUN_KICK_TIMEOUT_MS = 30_000;
const RUN_POLL_MS = 2000;
// Vangnet als de rij geen budget draagt (zou niet kunnen: createRun schrijft het).
const RUN_BUDGET_FALLBACK_MS = 240_000;
const RETRIEVAL_TIMEOUT_MS = 90_000;
const PUMP_STALE_MIN = 3;

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

async function getSecret(supabase: any, skill: string, name: string): Promise<string | null> {
  const { data } = await supabase.rpc("get_skill_secret_service", { p_skill_name: skill, p_secret_name: name });
  return typeof data === "string" && data.length > 0 ? data : null;
}

// ── Calls naar de keten ──────────────────────────────────────────────────────
// De kolommen die een meter nodig heeft. `answer_partial` bewust niet: een
// tussenstand is geen meetwaarde.
const RUN_COLS = "state, route, effort, budget, spent, hop, hops, steps, answer_md, envelope, citations, analytics, meta, error, query_log_id, created_at, finished_at";

// Één vraag = één run. Starten, dan de rij volgen tot hij terminaal is. Wat deze
// functie teruggeeft heeft de vorm van het oude compat-antwoord, zodat
// `chatFacts` en alle asserts eronder woordelijk hetzelfde konden blijven.
async function callRagChat(supabase: any, q: Q, id: HopIdentity, runId: string): Promise<ChatCall> {
  const { intent: _drop, ...opts } = (q.options || {}) as Record<string, unknown>;
  const t0 = Date.now();
  let started: any = {};
  try {
    const r = await fetch(RAG_CHAT_URL, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${id.bearer}`, "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({ message: q.question, history: Array.isArray(q.history) && q.history.length ? q.history : undefined, run: true, origin: "eval", eval_run_id: runId, ...opts }),
      signal: AbortSignal.timeout(RUN_KICK_TIMEOUT_MS),
    });
    started = await r.json().catch(() => ({}));
    if (!r.ok || !started?.run_id) {
      return { ok: false, status: r.status, body: { error: String(started?.error || started?.hint || `http_${r.status}`).slice(0, 300) }, latencyMs: Date.now() - t0 };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, body: { error: /timed? ?out|abort/i.test(msg) ? `run_kick_timeout_${RUN_KICK_TIMEOUT_MS}ms` : msg }, latencyMs: Date.now() - t0 };
  }

  const chatRunId: string = started.run_id;
  const budgetMs = Number(started.budget?.wall_ms) || RUN_BUDGET_FALLBACK_MS;
  const deadline = Date.now() + budgetMs + RUN_TIMEOUT_MARGIN_MS;
  let row: any = null;
  while (Date.now() < deadline) {
    const { data } = await supabase.from("agent_chat_runs").select(RUN_COLS).eq("id", chatRunId).maybeSingle();
    if (data) {
      row = data;
      // `needs_input` is voor een meter terminaal: er komt niets meer tenzij
      // iemand antwoordt, en dat doet een evalronde niet.
      if (["done", "failed", "cancelled", "needs_input"].includes(String(data.state))) break;
    }
    await new Promise((res) => setTimeout(res, RUN_POLL_MS));
  }
  const wall = Date.now() - t0;
  if (!row) {
    return { ok: false, status: 0, body: { error: "run_row_unreadable", run_id: chatRunId }, latencyMs: wall };
  }
  const terminal = ["done", "failed", "cancelled", "needs_input"].includes(String(row.state));
  if (!terminal) {
    // Dit is nu écht een time-out van de meter, en hij zegt waar hij bleef.
    return { ok: false, status: 0, body: { error: `runner_timeout_${budgetMs + RUN_TIMEOUT_MARGIN_MS}ms state=${row.state} hop=${row.hop}`, run_id: chatRunId, ...runBody(row, chatRunId) }, latencyMs: wall };
  }
  return {
    ok: row.state === "done",
    // De rij bereikte een eindtoestand, dus de HTTP-laag deed zijn werk; 200
    // hier betekent "de run is afgerond", niet "het antwoord is goed".
    status: 200,
    body: { ok: row.state === "done", ...(row.state === "done" ? {} : { error: `${row.error?.code ?? row.state}: ${String(row.error?.message ?? "").slice(0, 200)}` }), ...runBody(row, chatRunId) },
    latencyMs: wall,
  };
}

// Rij → de velden die `chatFacts` en de asserts lezen. Alles wat vóór v6.1 in
// het SSE-`meta`-frame zat staat nu in `agent_chat_runs.meta`.
function runBody(row: any, chatRunId: string): Record<string, unknown> {
  const meta = row?.meta || {};
  const env = row?.envelope || null;
  const spentUsd = typeof row?.spent?.usd === "number" ? row.spent.usd : null;
  return {
    answer: row?.answer_md ?? "",
    envelope: env,
    analytics: row?.analytics ?? null,
    debug_pipeline: meta.debug_pipeline ?? {},
    retrieval_strategy: meta.retrieval_strategy ?? null,
    bundle_id: meta.bundle_id ?? null,
    chunk_count: env?.coverage?.chunk_count ?? 0,
    citations: row?.citations ?? [],
    query_log_id: row?.query_log_id ?? null,
    timing_ms: row?.finished_at && row?.created_at
      ? { total: Date.parse(row.finished_at) - Date.parse(row.created_at) }
      : null,
    // Run-specifiek: dit is wat v3.3 toevoegt aan wat een item over zichzelf weet.
    run_id: chatRunId,
    run_state: row?.state ?? null,
    effort: row?.effort ?? null,
    budget: row?.budget ?? null,
    spent: row?.spent ?? null,
    spent_usd: spentUsd,
    hops: Array.isArray(row?.hops) ? row.hops : [],
    n_hops: Number(row?.hop ?? 0),
    run_error: row?.error ?? null,
  };
}

async function callContextBuild(q: Q, callerUserId: string | null): Promise<{ ok: boolean; status: number; body: any; latencyMs: number }> {
  const t0 = Date.now();
  // v3.2 — een relatief tijdvenster in het item (filter_after_days) wordt hier een
  // absolute filter_after, anders veroudert het item na een maand stil.
  const opts: Record<string, unknown> = { ...((q.options || {}) as Record<string, unknown>) };
  if (typeof opts.filter_after_days === "number" && Number.isFinite(opts.filter_after_days)) {
    opts.filter_after = new Date(Date.now() - Number(opts.filter_after_days) * 86400000).toISOString();
    delete opts.filter_after_days;
  }
  try {
    const r = await fetch(CB_URL, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({ intent: q.intent || "search_fast", audience: "rag-eval-cron", trigger_type: "eval", query_text: q.question, caller_user_id: callerUserId, options: opts }),
      signal: AbortSignal.timeout(RETRIEVAL_TIMEOUT_MS),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && j.ok !== false, status: r.status, body: j, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, body: { error: e instanceof Error ? e.message : String(e) }, latencyMs: Date.now() - t0 };
  }
}

// expect_artifact_type xlsx/csv/pdf mét build_artifacts: één echte build met de persona-JWT + HEAD op de signed URL.
async function buildArtifact(q: Q, id: HopIdentity, res: ChatCall, runId: string): Promise<ArtifactBuild> {
  const type = String((q.asserts as any)?.expect_artifact_type || "");
  const env = res.body?.envelope || {};
  const rows: any[] = Array.isArray(env.rows) ? env.rows : [];
  // Vork F5: pdf mag mee. En pdf is het enige formaat dat zónder tabel kan —
  // AR08 vraagt om een rapport, en dat is tekst. `agent-artifact-build` eist
  // dan `body_markdown`; een lege tabel én geen antwoord blijft `no_rows`.
  const answerMd: string | null = typeof env.answer_md === "string" && env.answer_md.trim() ? env.answer_md : null;
  if (!["xlsx", "csv", "pdf"].includes(type) || !res.ok) return { attempted: false, ok: false, url_status: null, error: null, type };
  if (!id.isUser) return { attempted: true, ok: false, url_status: null, error: "no_persona_jwt", type };
  if (rows.length === 0 && !(type === "pdf" && answerMd)) return { attempted: true, ok: false, url_status: null, error: "no_rows", type };
  try {
    const r = await fetch(ARTIFACT_URL, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${id.bearer}`, "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({ type, title: `eval ${runId}`, question: q.question, rows, columns: env.columns || [], query_log_id: res.body?.query_log_id ?? null,
        ...(type === "pdf" && answerMd ? { body_markdown: answerMd } : {}),
        params: { definition: env.definition, claim: env.claim, route: env.route, searched: env.coverage?.searched, not_searched: env.coverage?.not_searched } }),
      signal: AbortSignal.timeout(30_000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok || !j.url) return { attempted: true, ok: false, url_status: null, error: `build_${r.status}:${String(j.error || "").slice(0, 80)}`, type };
    const head = await fetch(j.url, { method: "HEAD", signal: AbortSignal.timeout(15_000) }).catch(() => null);
    return { attempted: true, ok: true, url_status: head?.status ?? null, error: null, type };
  } catch (e) { return { attempted: true, ok: false, url_status: null, error: (e instanceof Error ? e.message : String(e)).slice(0, 80), type }; }
}

async function spaceMapFor(supabase: any, calls: ChatCall[]): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const c of calls) for (const s of (c.body?.envelope?.sources || [])) if ((s.type ?? s.source) === "confluence" && s.id) ids.add(String(s.id));
  const m = new Map<string, string>();
  if (ids.size === 0) return m;
  const { data } = await supabase.from("confluence_pages").select("page_id, space_key").in("page_id", [...ids]);
  for (const r of data || []) m.set(String(r.page_id), String(r.space_key));
  return m;
}

async function stageOrderMap(supabase: any): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  const { data } = await supabase.from("hubspot_pipelines").select("stages");
  for (const p of data || []) for (const s of (p.stages || [])) if (s?.label) m.set(String(s.label).trim().toLowerCase(), Number(s.displayOrder ?? 0));
  return m;
}

// ── Eén hop ──────────────────────────────────────────────────────────────────
async function runHop(supabase: any, openaiKey: string, runId: string, hop: number): Promise<{ done: boolean; n: number; lane: string | null; persona: string | null; note?: string }> {
  const { data: run } = await supabase.from("rag_eval_runs").select("id, status, params, suite").eq("id", runId).maybeSingle();
  if (!run || run.status !== "running") return { done: true, n: 0, lane: null, persona: null, note: `run status ${run?.status ?? "missing"}` };
  const buildArtifacts: boolean = typeof run.params?.build_artifacts === "boolean" ? run.params.build_artifacts : ["rook-p0", "full"].includes(run.suite);

  const { data: batch, error: claimErr } = await supabase.rpc("rag_eval_claim_batch", { p_run_id: runId, p_max_items: BATCH_CHAT, p_solo: false, p_hop: hop });
  if (claimErr) throw new Error(`claim_failed: ${claimErr.message}`);
  const items: Q[] = (batch || []) as Q[];
  if (items.length === 0) {
    const { data: fin } = await supabase.rpc("rag_eval_finish_if_done", { p_run_id: runId });
    return { done: fin === true, n: 0, lane: null, persona: null, note: fin === true ? "finished" : "nothing claimable, items still open" };
  }
  const lane = items[0].lane; const personaName = items[0].persona || "jelle";
  const { data: attemptRows } = await supabase.from("rag_eval_run_items").select("question_id, attempt").eq("run_id", runId).in("question_id", items.map((q) => q.id));
  const attemptOf = new Map<string, number>((attemptRows || []).map((r: any) => [r.question_id, r.attempt]));

  // Identiteit voor deze hop. Mislukt het minten, dan is elk item rood met reden —
  // nooit stil als cron doorgaan.
  const personas = await loadPersonas(supabase);
  let ident: HopIdentity | null = null; let identErr: string | null = null;
  try { ident = await identityFor(SUPABASE_URL, SERVICE_KEY, personas.get(personaName) ?? null, personaName); }
  catch (e) { identErr = e instanceof Error ? e.message : String(e); }

  const rows: any[] = [];
  const base = (q: Q) => ({
    run_id: runId, question_id: q.id, question: String(q.question).slice(0, 2000), dimension: q.dimension, intent: q.intent,
    lane: q.lane, category: q.category, persona: personaName, hop, attempt: attemptOf.get(q.id) ?? 1,
  });

  if (identErr || !ident) {
    for (const q of items) rows.push({ ...base(q), signal_hit: false, assert_detail: `FAIL jwt_mint_failed(${String(identErr).slice(0, 120)})`, answer: "", pending_asserts: [] });
  } else if (lane === "chat") {
    const calls = await Promise.all(items.map((q) => callRagChat(supabase, q, ident!, runId)));
    const [spaceMap, stageOrder] = await Promise.all([spaceMapFor(supabase, calls), stageOrderMap(supabase)]);
    for (let i = 0; i < items.length; i++) {
      const q = items[i]; const res = calls[i];
      const art = buildArtifacts ? await buildArtifact(q, ident, res, runId) : { attempted: false, ok: false, url_status: null, error: null, type: null };
      const f = chatFacts(res, spaceMap);
      const asserted = runChatAsserts(q, res, f, art, stageOrder);
      const jd = res.ok && chatJudgeEligible(q) ? await judgeChat(openaiKey, q, f.answer) : { answer_correctness: null, notes: res.ok ? "geen judge (geen verified ground truth)" : "skipped" };
      const analytics = res.body?.analytics || null;
      const env = res.body?.envelope || {};
      rows.push({
        ...base(q),
        retrieval_strategy: res.ok ? (res.body.retrieval_strategy || `analytics:${f.route}`) : null, bundle_id: res.ok ? (res.body.bundle_id || null) : null,
        n_chunks: res.ok ? (res.body.chunk_count ?? 0) : 0, answer: (f.answer || res.body?.error || "").slice(0, 4000),
        signal_hit: asserted.hit, assert_detail: asserted.detail.slice(0, 1000), pending_asserts: asserted.pending,
        answer_correctness: clamp01(jd.answer_correctness), judge_notes: String(jd.notes || jd.error || "").slice(0, 2000),
        latency_ms: res.latencyMs, cost_usd: f.costUsd, coverage_reason: f.coverageReason, route: f.route, caller_identified: f.callerIdentified,
        tools_used: analytics?.tools_used ? analytics.tools_used.slice(0, 20).map((t: any) => ({ tool: t?.tool ?? null, rows: t?.rows ?? null, ms: t?.ms ?? null, error: t?.error ?? null })) : (analytics?.tool ? [{ tool: analytics.tool }] : null),
        sources: f.sources, artifact_type: art.type || null,
        envelope_compact: {
          claim: env.claim ?? null, definition: env.definition ? String(env.definition).slice(0, 300) : null, columns: env.columns ?? [], n_rows: f.rows.length,
          artifacts_available: f.artifactsAvailable, answer_empty: f.answerEmpty, timing_ms: res.body?.timing_ms ?? null, http_status: res.status,
          artifact_build: art.attempted ? { ok: art.ok, head: art.url_status, error: art.error } : null,
          judge_usage: (jd as any)._usage ?? null,
          // v3.3 (poort T10): elk chat-item wijst terug naar zijn run, met het
          // effort dat de keten koos, het budget dat daarbij hoorde en wat er
          // per hop van opging. Zonder deze vier is een meting niet te herleiden.
          run_id: res.body?.run_id ?? null, run_state: res.body?.run_state ?? null,
          effort: res.body?.effort ?? null, budget: res.body?.budget ?? null,
          spent: res.body?.spent ?? null, n_hops: res.body?.n_hops ?? null,
          hops: Array.isArray(res.body?.hops) ? res.body.hops.map((h: any) => ({ n: h?.n ?? null, ms: h?.ms ?? null, end: h?.end_reason ?? null })) : null,
          run_error: res.body?.run_error ?? null,
        },
      });
    }
  } else {
    for (let i = 0; i < items.length; i += RETRIEVAL_CONCURRENCY) {
      const wave = items.slice(i, i + RETRIEVAL_CONCURRENCY);
      const done = await Promise.all(wave.map(async (q) => {
        const rt = await callContextBuild(q, ident!.userId);
        const asserted = runRetrievalAsserts(q, rt);
        const matches: any[] = rt.ok ? (rt.body.matches || []) : [];
        const jd = rt.ok ? await judgeRetrieval(openaiKey, q, matches) : { error: "skipped" };
        let hit = asserted.hit; let detail = asserted.detail;
        if ((q.asserts as any)?.expect_no_context === true) {
          const ac = clamp01(jd.answer_correctness);
          const negOk = ac !== null ? ac >= 0.5 : null;
          if (negOk !== null) { hit = hit === null ? negOk : hit && negOk; detail = (detail ? detail + "; " : "") + `no_context=${negOk}`; }
        }
        // v3.2 (06f-α) — wezen: een mailchunk waarvan de mail verwijderd is hoort niet in het
        // resultaat (gemeten 1.480 zulke chunks vóór rag_chunks_reconcile). DB-check, dus hier.
        if ((q.asserts as any)?.expect_sources_live === true && rt.ok) {
          const mailIds = [...new Set(matches.filter((m: any) => String(m.source) === "mail" && m.id).map((m: any) => String(m.id)))];
          let dead = 0;
          if (mailIds.length) {
            const { data: live } = await supabase.from("mail_messages").select("id").in("id", mailIds).eq("is_deleted", false);
            const liveSet = new Set((live ?? []).map((r: any) => String(r.id)));
            dead = mailIds.filter((id) => !liveSet.has(id)).length;
          }
          const liveOk = dead === 0;
          hit = hit === null ? liveOk : hit && liveOk;
          detail = (detail ? detail + "; " : "") + `sources_live=${liveOk}(${dead} dead of ${mailIds.length})`;
        }
        const total = rt.body?.retrieval_meta?.timing_ms?.total;
        return {
          ...base(q), retrieval_strategy: rt.ok ? rt.body.retrieval_strategy : null, bundle_id: rt.ok ? rt.body.bundle_id : null,
          n_chunks: matches.length, answer: String(jd.answer || jd.error || "").slice(0, 4000),
          faithfulness: clamp01(jd.faithfulness), answer_relevance: clamp01(jd.answer_relevance), context_precision: clamp01(jd.context_precision),
          answer_correctness: clamp01(jd.answer_correctness), signal_hit: hit, assert_detail: detail.slice(0, 1000), pending_asserts: asserted.pending,
          judge_notes: String(jd.notes || jd.error || "").slice(0, 2000),
          latency_ms: typeof total === "number" ? Math.round(total) : rt.latencyMs, coverage_reason: rt.body?.coverage?.reason ?? null,
          caller_identified: ident!.isUser ? true : null, route: "retrieval",
          sources: matches.slice(0, 40).map((m: any) => ({ type: String(m.source), id: String(m.id ?? ""), space_key: m.metadata?.space_key ?? null })),
          envelope_compact: { n_matches: matches.length, strategy: rt.body?.retrieval_strategy ?? null, coverage_acl: rt.body?.coverage?.acl ?? null, http_status: rt.status, judge_usage: (jd as any)._usage ?? null },
        };
      }));
      rows.push(...done);
    }
  }
  if (ident) await ident.logout();

  const { error: insErr } = await supabase.from("rag_eval_results").insert(rows);
  if (insErr) throw new Error(`results_insert_failed: ${insErr.message}`);
  const { data: fin } = await supabase.rpc("rag_eval_finish_if_done", { p_run_id: runId });
  return { done: fin === true, n: rows.length, lane, persona: personaName };
}

function spawnNext(runId: string, hop: number) {
  const p = fetch(SELF_URL, {
    method: "POST", headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ _run_id: runId, _hop: hop }),
  }).catch((e) => console.error("[rag-eval-cron] chain spawn failed", e instanceof Error ? e.message : String(e)));
  // @ts-ignore — EdgeRuntime is Supabase-specifiek
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(p);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const gate = await requireCronOrServiceRole(req, supabase);
  if (!gate.ok) return gate.response;
  const openaiKey = await getSecret(supabase, "openai", "embedding_key");
  if (!openaiKey) return json({ error: "openai_key_missing" }, 500);

  let body: any = {};
  try { body = await req.json(); } catch { /* geen body = ok */ }

  try {
    // ── Pomp: gestrande run oppakken ─────────────────────────────────────────
    if (body._pump === true) {
      const { data: stale } = await supabase.from("rag_eval_runs").select("id, label")
        .eq("status", "running").lt("last_activity_at", new Date(Date.now() - PUMP_STALE_MIN * 60_000).toISOString())
        .order("created_at", { ascending: true }).limit(1);
      if (!stale || stale.length === 0) return json({ ok: true, pumped: 0 });
      const { data: hops } = await supabase.from("rag_eval_results").select("hop").eq("run_id", stale[0].id).order("hop", { ascending: false }).limit(1);
      const hop = ((hops?.[0]?.hop as number) ?? 0) + 1;
      const r = await runHop(supabase, openaiKey, stale[0].id, hop);
      if (!r.done) spawnNext(stale[0].id, hop + 1);
      return json({ ok: true, pumped: 1, run_id: stale[0].id, label: stale[0].label, hop, ...r });
    }

    // ── Volgende hop van een lopende run ─────────────────────────────────────
    if (typeof body._run_id === "string") {
      const hop = Number(body._hop || 1);
      const r = await runHop(supabase, openaiKey, body._run_id, hop);
      if (!r.done) spawnNext(body._run_id, hop + 1);
      return json({ ok: true, run_id: body._run_id, hop, ...r });
    }

    // ── Nieuwe run ───────────────────────────────────────────────────────────
    const label: string = body.label || "cron-weekly";
    const suite: string = body.suite || "legacy71";
    const params: Record<string, unknown> = { runner_version: RUNNER_VERSION, judge_model: JUDGE_MODEL };
    for (const k of ["ids", "only_tag", "lane", "category", "persona", "compare_to", "build_artifacts", "force"]) if (body[k] !== undefined) params[k] = body[k];
    const { data: runId, error: startErr } = await supabase.rpc("rag_eval_start_run", { p_label: label, p_suite: suite, p_params: params });
    if (startErr) {
      const busy = /already_running/.test(startErr.message);
      return json({ ok: false, error: busy ? "run_already_running" : `start_failed: ${startErr.message}` }, busy ? 409 : 500);
    }
    const { data: pc } = await supabase.rpc("rag_eval_persona_check", { p_run_id: runId });
    if (!pc || pc.ok !== true) return json({ ok: false, run_id: runId, status: "invalid_persona", persona_check: pc }, 200);

    const r = await runHop(supabase, openaiKey, runId, 1);
    if (!r.done) spawnNext(runId, 2);
    return json({ ok: true, run_id: runId, label, suite, hop: 1, persona_check_ok: true, ...r, note: r.done ? "run klaar" : "hop 1 klaar; volgende hop gestart — poll rag_eval_runs.status" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[rag-eval-cron] error", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
