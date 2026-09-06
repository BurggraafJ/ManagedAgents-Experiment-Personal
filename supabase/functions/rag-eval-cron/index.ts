// =============================================================================
// rag-eval-cron v3.0 — evalrunner voor de vragenbank (spoor 01, v1.147)
// =============================================================================
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

const RUNNER_VERSION = "v3.0";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CB_URL = `${SUPABASE_URL}/functions/v1/context-build`;
const RAG_CHAT_URL = `${SUPABASE_URL}/functions/v1/rag-chat`;
const ARTIFACT_URL = `${SUPABASE_URL}/functions/v1/agent-artifact-build`;
const SELF_URL = `${SUPABASE_URL}/functions/v1/rag-eval-cron`;
const UA = "legal-mind-rag-eval-cron/3.0";
// Hop-budget (D01-8): 3 chat-items per hop (één wave), retrieval 16 met 6 parallel.
// Per-item time-out clamp(max_latency_ms × 1,2, 140 s, 170 s); 170 s is AANNAME
// tot RO37 solo hem bevestigt (WP3).
const BATCH_CHAT = 3;
const RETRIEVAL_CONCURRENCY = 6;
const CHAT_TIMEOUT_MIN_MS = 140_000;
const CHAT_TIMEOUT_MAX_MS = 170_000;
const RETRIEVAL_TIMEOUT_MS = 90_000;
const PUMP_STALE_MIN = 3;

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

async function getSecret(supabase: any, skill: string, name: string): Promise<string | null> {
  const { data } = await supabase.rpc("get_skill_secret_service", { p_skill_name: skill, p_secret_name: name });
  return typeof data === "string" && data.length > 0 ? data : null;
}

// ── Calls naar de keten ──────────────────────────────────────────────────────
async function callRagChat(q: Q, id: HopIdentity, runId: string): Promise<ChatCall> {
  const timeout = Math.max(CHAT_TIMEOUT_MIN_MS, Math.min(CHAT_TIMEOUT_MAX_MS, Math.round(Number((q.asserts as any)?.max_latency_ms || 0) * 1.2) || 0));
  const { intent: _drop, ...opts } = (q.options || {}) as Record<string, unknown>;
  const t0 = Date.now();
  try {
    const r = await fetch(RAG_CHAT_URL, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${id.bearer}`, "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({ message: q.question, history: Array.isArray(q.history) && q.history.length ? q.history : undefined, stream: false, eval_run_id: runId, ...opts }),
      signal: AbortSignal.timeout(timeout),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && j.ok !== false, status: r.status, body: j, latencyMs: Date.now() - t0 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: 0, body: { error: /timed? ?out|abort/i.test(msg) ? `runner_timeout_${timeout}ms` : msg }, latencyMs: Date.now() - t0 };
  }
}

async function callContextBuild(q: Q, callerUserId: string | null): Promise<{ ok: boolean; status: number; body: any; latencyMs: number }> {
  const t0 = Date.now();
  try {
    const r = await fetch(CB_URL, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({ intent: q.intent || "search_fast", audience: "rag-eval-cron", trigger_type: "eval", query_text: q.question, caller_user_id: callerUserId, options: q.options || {} }),
      signal: AbortSignal.timeout(RETRIEVAL_TIMEOUT_MS),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && j.ok !== false, status: r.status, body: j, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, status: 0, body: { error: e instanceof Error ? e.message : String(e) }, latencyMs: Date.now() - t0 };
  }
}

// expect_artifact_type xlsx/csv mét build_artifacts: één echte build met de persona-JWT + HEAD op de signed URL.
async function buildArtifact(q: Q, id: HopIdentity, res: ChatCall, runId: string): Promise<ArtifactBuild> {
  const type = String((q.asserts as any)?.expect_artifact_type || "");
  const env = res.body?.envelope || {};
  const rows: any[] = Array.isArray(env.rows) ? env.rows : [];
  if (!["xlsx", "csv"].includes(type) || !res.ok) return { attempted: false, ok: false, url_status: null, error: null, type };
  if (!id.isUser) return { attempted: true, ok: false, url_status: null, error: "no_persona_jwt", type };
  if (rows.length === 0) return { attempted: true, ok: false, url_status: null, error: "no_rows", type };
  try {
    const r = await fetch(ARTIFACT_URL, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${id.bearer}`, "Content-Type": "application/json", "User-Agent": UA },
      body: JSON.stringify({ type, title: `eval ${runId}`, question: q.question, rows, columns: env.columns || [], query_log_id: res.body?.query_log_id ?? null,
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
    const calls = await Promise.all(items.map((q) => callRagChat(q, ident!, runId)));
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
          envelope_compact: { n_matches: matches.length, strategy: rt.body?.retrieval_strategy ?? null, coverage_acl: rt.body?.coverage?.acl ?? null, http_status: rt.status },
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
