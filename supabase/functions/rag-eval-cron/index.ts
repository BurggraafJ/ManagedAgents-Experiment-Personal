// =============================================================================
// rag-eval-cron v2.2 — RAG v3.2 eval-suite (lens B) + analytical-pad (Vragenbak).
// =============================================================================
// v2.2 (2026-06-11, Vragenbak in de breedte W0): qtype='analytical' items lopen
//   NIET door context-build maar door rag-chat (de vragenbak zelf, stream:false).
//   Nieuwe asserts: expect_route / required_entities / forbidden_entities /
//   answer_must_match_regex / expect_min_rows / expect_max_rows / expect_scan_claim.
//   Route komt uit response.analytics.route; ontbreekt die (pre-router rag-chat of
//   semantisch pad) dan geldt 'semantic'. answer_correctness via gpt-5.5 tegen
//   expected_answer (alleen analytical; RAGAS-judge blijft voor retrieval-items).
//   body.only_qtype='analytical' draait alleen die klasse (baseline/targeted runs).
//   NB: de repo liep op v2 achter de deployed v2.1; deze file = v2.1 + analytical.
// v2.1 (2026-06-11): batches van 16 vragen per invocation; bij meer vragen roept de
//   functie ZICHZELF aan met {_run_id,_offset} — elke invocation = eigen trace, dus
//   geen 'Rate limit exceeded for trace' meer (v2-run 1e09d8b5 verloor er 20/50 aan).
//   De diepste call finaliseert de run-aggregaten; de buitenste retourneert de summary.
// v2 (2026-06-11): vragen uit rag_eval_questions; deterministische asserts; judge
//   gpt-5.5 (500 chars x top-10) + answer_correctness/ground-truth + negatives.
// Auth: Bearer == skill:global:cron_secret OF service_role. verify_jwt:false (eigen auth).
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CB_URL = `${SUPABASE_URL}/functions/v1/context-build`;
const RAG_CHAT_URL = `${SUPABASE_URL}/functions/v1/rag-chat`;
const SELF_URL = `${SUPABASE_URL}/functions/v1/rag-eval-cron`;
const OPENAI = "https://api.openai.com/v1/chat/completions";
const JUDGE_MODEL = "gpt-5.5";
const CONCURRENCY = 6;
const BATCH_PER_INVOCATION = 16;
const MAX_CHAIN = 8;
const ANALYTICAL_TIMEOUT_MS = 150_000;

const GOLD_FALLBACK: Array<[string, string, string]> = [
  ["E04", "wat-zei-X-over-Y", "Wat is er besproken over het LegalMind prijsmodel en adoptie?"],
  ["E06", "wat-zei-X-over-Y", "Welke argumenten zijn genoemd waarom advocaten een eigen dossier of DMS-koppeling willen?"],
  ["E15", "vrije-semantiek", "Welke zorgen hebben advocatenkantoren over AI en betrouwbaarheid?"],
  ["E16", "vrije-semantiek", "Wat is onze positionering ten opzichte van concurrenten?"],
  ["E20", "feit-specifiek", "Wat is de besproken maandprijs per gebruiker?"],
  ["E21", "feit-specifiek", "Wat is de laatste stand rondom TTFA?"],
  ["E22", "feit-specifiek", "Welke kandidaat is voorgesteld voor de sales-rol?"],
  ["E36", "vrije-semantiek", "Wat is de visie op AI-versnippering binnen kantoren?"],
  ["R01", "named-entity", "Wat is de huidige status van onze samenwerking met Rutgers en Posch?"],
  ["RFO", "named-entity", "Geef me de laatste stand van zaken rond Forsyte Advocaten"],
  ["E14", "vrije-semantiek", "Wat zijn de belangrijkste bezwaren die klanten noemen over de prijs?"],
  ["E12", "lifecycle-sales", "Welke pilots of proefperiodes lopen er nu?"],
];

const clamp01 = (x: unknown) => (typeof x === "number" && isFinite(x) ? Math.max(0, Math.min(1, x)) : null);

async function getSecret(supabase: any, skill: string, name: string): Promise<string | null> {
  const { data } = await supabase.rpc("get_skill_secret_service", { p_skill_name: skill, p_secret_name: name });
  return typeof data === "string" && data.length > 0 ? data : null;
}

type Q = { id: string; question: string; dimension: string | null; intent: string; qtype: string;
  expected_answer: string | null; asserts: Record<string, unknown>; options: Record<string, unknown> };

async function retrieve(q: Q, audience: string): Promise<{ ok: boolean; status: number; body: any }> {
  try {
    const r = await fetch(CB_URL, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ intent: q.intent || "search", audience, trigger_type: "eval", query_text: q.question, options: q.options || {} }),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && j.ok !== false, status: r.status, body: j };
  } catch (e) {
    return { ok: false, status: 0, body: { error: e instanceof Error ? e.message : String(e) } };
  }
}

// Analytical-pad (Vragenbak): vraag gaat door rag-chat zelf, niet door context-build.
async function retrieveAnalytical(q: Q): Promise<{ ok: boolean; status: number; body: any }> {
  try {
    const r = await fetch(RAG_CHAT_URL, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: q.question, stream: false, ...(q.options || {}) }),
      signal: AbortSignal.timeout(ANALYTICAL_TIMEOUT_MS),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && j.ok !== false, status: r.status, body: j };
  } catch (e) {
    return { ok: false, status: 0, body: { error: e instanceof Error ? e.message : String(e) } };
  }
}

function runAsserts(q: Q, res: { ok: boolean; status: number; body: any }): { hit: boolean | null; detail: string } {
  const a = q.asserts || {};
  const keys = Object.keys(a).filter((k) => k !== "expect_no_context");
  const failures: string[] = [];
  const passes: string[] = [];
  if (!res.ok) {
    return { hit: false, detail: `context-build_failed status=${res.status} ${(JSON.stringify(res.body) || "").slice(0, 160)}` };
  }
  if (keys.length === 0) return { hit: null, detail: "" };
  const matches: any[] = res.body.matches || [];
  const meta = res.body.retrieval_meta || {};
  const allText = matches.map((m) => String(m.preview || "")).join("\n");
  const sources = new Set(matches.map((m) => String(m.source)));
  const check = (name: string, pass: boolean, info: string) => (pass ? passes.push(name) : failures.push(`${name}(${info})`));
  if (typeof a.must_match_regex === "string") {
    let pass = false; try { pass = new RegExp(a.must_match_regex as string, "i").test(allText); } catch { pass = false; }
    check("regex", pass, String(a.must_match_regex));
  }
  if (typeof a.must_include_source === "string") check("include_source", sources.has(a.must_include_source as string), String(a.must_include_source));
  if (typeof a.must_exclude_source === "string") check("exclude_source", !sources.has(a.must_exclude_source as string), String(a.must_exclude_source));
  if (typeof a.top1_max_age_days === "number" && matches.length > 0) {
    const occ = matches[0]?.occurred_at ? Date.parse(matches[0].occurred_at) : NaN;
    const ageDays = isFinite(occ) ? (Date.now() - occ) / 86400000 : Infinity;
    check("top1_age", ageDays <= (a.top1_max_age_days as number), `${Math.round(ageDays)}d>${a.top1_max_age_days}d`);
  }
  if (typeof a.expect_strategy_prefix === "string") check("strategy", String(res.body.retrieval_strategy || "").startsWith(a.expect_strategy_prefix as string), String(res.body.retrieval_strategy));
  if (a.expect_reranked === true) check("reranked", res.body.reranked === true, String(res.body.reranked));
  if (typeof a.expect_meta_null === "string") {
    const v = meta[a.expect_meta_null as string];
    check("meta_null:" + a.expect_meta_null, v === null || v === undefined, JSON.stringify(v)?.slice(0, 60) ?? "undef");
  }
  if (typeof a.max_build_ms === "number") {
    const total = meta?.timing_ms?.total ?? null;
    check("build_ms", typeof total === "number" && total <= (a.max_build_ms as number), `${total}ms`);
  }
  return { hit: failures.length === 0, detail: failures.length ? "FAIL " + failures.join("; ") : "pass: " + passes.join(",") };
}

// Deterministische asserts voor analytical-items (Vragenbak W0).
function runAnalyticalAsserts(q: Q, res: { ok: boolean; status: number; body: any }): { hit: boolean | null; detail: string } {
  const a = q.asserts || {};
  const failures: string[] = [];
  const passes: string[] = [];
  if (!res.ok) {
    return { hit: false, detail: `rag-chat_failed status=${res.status} ${(JSON.stringify(res.body) || "").slice(0, 160)}` };
  }
  const analytics = res.body.analytics || null;
  const route = String(analytics?.route || "semantic");
  const rows: any[] = Array.isArray(analytics?.rows) ? analytics.rows : [];
  const answer = String(res.body.answer || "");
  const rowsText = JSON.stringify(rows).toLowerCase();
  const combined = rowsText + " " + answer.toLowerCase();
  const check = (name: string, pass: boolean, info: string) => (pass ? passes.push(name) : failures.push(`${name}(${info})`));
  if (typeof a.expect_route === "string") check("route", route === a.expect_route, `${route}!=${a.expect_route}`);
  if (Array.isArray(a.required_entities)) {
    const missing = (a.required_entities as string[]).filter((e) => !combined.includes(String(e).toLowerCase()));
    check("required", missing.length === 0, `missing=${missing.join("|")}`);
  }
  if (Array.isArray(a.forbidden_entities)) {
    const scope = rows.length > 0 ? rowsText : answer.toLowerCase();
    const found = (a.forbidden_entities as string[]).filter((e) => scope.includes(String(e).toLowerCase()));
    check("forbidden", found.length === 0, `found=${found.join("|")}`);
  }
  if (typeof a.answer_must_match_regex === "string") {
    let pass = false; try { pass = new RegExp(a.answer_must_match_regex as string, "i").test(answer); } catch { pass = false; }
    check("answer_regex", pass, String(a.answer_must_match_regex));
  }
  if (typeof a.expect_min_rows === "number") check("min_rows", rows.length >= (a.expect_min_rows as number), `${rows.length}<${a.expect_min_rows}`);
  if (typeof a.expect_max_rows === "number") check("max_rows", rows.length <= (a.expect_max_rows as number), `${rows.length}>${a.expect_max_rows}`);
  if (a.expect_scan_claim === true) check("scan_claim", analytics?.scanned_n != null, "scanned_n=null");
  if (failures.length === 0 && passes.length === 0) return { hit: null, detail: "" };
  return { hit: failures.length === 0, detail: failures.length ? "FAIL " + failures.join("; ") : "pass: " + passes.join(",") };
}

async function judge(openaiKey: string, q: Q, matches: any[]): Promise<any> {
  const ctx = matches.slice(0, 10).map((m, i) => `[${i + 1}] (${m.source}) ${String(m.preview || "").replace(/\s+/g, " ").slice(0, 500)}`).join("\n");
  const gt = q.expected_answer && q.qtype !== "negative"
    ? `\nREFERENTIE-ANTWOORD (ground-truth): ${q.expected_answer}\nScoor ook answer_correctness 0.0-1.0: komt jouw antwoord inhoudelijk overeen met de referentie (1.0=zelfde feiten, 0=ander/fout antwoord).`
    : q.qtype === "negative"
    ? `\nLET OP: dit is een NEGATIVE-test — er hoort GEEN relevante context te bestaan. Correct gedrag = answer '(geen relevante context)'. Scoor answer_correctness 1.0 als je terecht concludeert dat de context niets relevants bevat, 0.0 als je toch een inhoudelijk antwoord fabriceert.`
    : "";
  const prompt = `Je bent een strenge RAG-evaluator. Beoordeel of de OPGEHAALDE CONTEXT de vraag goed kan beantwoorden.\n\nVRAAG: ${q.question.slice(0, 600)}\n\nOPGEHAALDE CONTEXT (genummerde fragmenten):\n${ctx || "(geen)"}${gt}\n\nTAAK: (1) Beantwoord de vraag UITSLUITEND op basis van de context (max 3 zinnen). (2) Scoor elk 0.0-1.0:\n- faithfulness: is elk feit in je antwoord terug te vinden in de context (1.0=volledig gegrond, 0=verzonnen)\n- answer_relevance: beantwoordt het antwoord daadwerkelijk de vraag\n- context_precision: welke fractie van de fragmenten is relevant voor de vraag\nAls de context niets relevants bevat: answer='(geen relevante context)', faithfulness=1.0, answer_relevance=0.0, context_precision=0.0.\nAntwoord ALLEEN met JSON: {"answer":"...","faithfulness":0.0,"answer_relevance":0.0,"context_precision":0.0,"answer_correctness":null,"notes":"korte motivatie"}`;
  const r = await fetch(OPENAI, {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: JUDGE_MODEL, messages: [{ role: "user", content: prompt }], max_completion_tokens: 800, reasoning_effort: "none" }),
  });
  const t = await r.text();
  if (!r.ok) return { error: `openai_${r.status}: ${t.slice(0, 120)}` };
  try {
    const j = JSON.parse(t);
    const content = j.choices?.[0]?.message?.content ?? "";
    const mm = content.match(/\{[\s\S]*\}/);
    if (!mm) return { error: "no_json" };
    return JSON.parse(mm[0]);
  } catch { return { error: "parse" }; }
}

// Lichte judge voor analytical: alleen answer_correctness tegen ground-truth.
async function judgeAnalytical(openaiKey: string, q: Q, answer: string): Promise<any> {
  if (!q.expected_answer) return { answer_correctness: null, notes: "geen ground-truth" };
  const prompt = `Je vergelijkt een gegeven ANTWOORD met een REFERENTIE (ground-truth) voor een analytische lijst/telling-vraag.\n\nVRAAG: ${q.question.slice(0, 400)}\n\nANTWOORD:\n${answer.slice(0, 3000)}\n\nREFERENTIE: ${q.expected_answer.slice(0, 1500)}\n\nScoor answer_correctness 0.0-1.0 (1.0 = zelfde entiteiten/feiten/strekking, 0.0 = fout of gefantaseerd; 'acceptabel extra' genoemde entiteiten tellen niet als fout). Antwoord ALLEEN met JSON: {"answer_correctness":0.0,"notes":"korte motivatie"}`;
  const r = await fetch(OPENAI, {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: JUDGE_MODEL, messages: [{ role: "user", content: prompt }], max_completion_tokens: 400, reasoning_effort: "none" }),
  });
  const t = await r.text();
  if (!r.ok) return { error: `openai_${r.status}: ${t.slice(0, 120)}` };
  try {
    const j = JSON.parse(t);
    const content = j.choices?.[0]?.message?.content ?? "";
    const mm = content.match(/\{[\s\S]*\}/);
    if (!mm) return { error: "no_json" };
    return JSON.parse(mm[0]);
  } catch { return { error: "parse" }; }
}

async function loadQuestions(supabase: any, onlyCore: boolean, onlyQtype: string | null): Promise<Q[]> {
  const { data: qRows, error: qErr } = await supabase.from("rag_eval_questions")
    .select("id, question, dimension, intent, qtype, expected_answer, asserts, options, is_core")
    .eq("is_active", true).order("id");
  if (!qErr && qRows && qRows.length > 0) {
    let rows = qRows as any[];
    if (onlyQtype) rows = rows.filter((r) => r.qtype === onlyQtype);
    if (onlyCore) rows = rows.filter((r) => r.is_core);
    return rows as Q[];
  }
  return GOLD_FALLBACK.map(([id, dim, q]) => ({ id, question: q, dimension: dim, intent: "search", qtype: "functional", expected_answer: null, asserts: {}, options: {} }));
}

async function finalizeRun(supabase: any, runId: string): Promise<any> {
  const { data: rows } = await supabase.from("rag_eval_results")
    .select("faithfulness, answer_relevance, context_precision, answer_correctness, signal_hit")
    .eq("run_id", runId);
  let sF = 0, sR = 0, sP = 0, nScored = 0, sAC = 0, nAC = 0, nHit = 0, nAsserted = 0;
  for (const r of rows || []) {
    if (r.faithfulness != null && r.answer_relevance != null && r.context_precision != null) { sF += Number(r.faithfulness); sR += Number(r.answer_relevance); sP += Number(r.context_precision); nScored++; }
    if (r.answer_correctness != null) { sAC += Number(r.answer_correctness); nAC++; }
    if (r.signal_hit !== null && r.signal_hit !== undefined) { nAsserted++; if (r.signal_hit) nHit++; }
  }
  const avg = (s: number, n: number) => (n ? Number((s / n).toFixed(3)) : null);
  const upd = {
    n_questions: (rows || []).length,
    avg_faithfulness: avg(sF, nScored), avg_answer_relevance: avg(sR, nScored), avg_context_precision: avg(sP, nScored),
    signal_pass_rate: nAsserted ? Number((nHit / nAsserted).toFixed(3)) : null, n_asserted: nAsserted, avg_answer_correctness: avg(sAC, nAC),
    notes: `suite-v1 chained, ${nScored}/${(rows || []).length} judged, ${nHit}/${nAsserted} asserts pass`,
  };
  await supabase.from("rag_eval_runs").update(upd).eq("id", runId);
  return { run_id: runId, n: upd.n_questions, n_scored: nScored, avg_faithfulness: upd.avg_faithfulness, avg_answer_relevance: upd.avg_answer_relevance, avg_context_precision: upd.avg_context_precision, signal_pass_rate: upd.signal_pass_rate, asserts: `${nHit}/${nAsserted}`, avg_answer_correctness: upd.avg_answer_correctness };
}

Deno.serve(async (req) => {
  const baseHeaders = { "Content-Type": "application/json" };
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: baseHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const cronSecret = await getSecret(supabase, "global", "cron_secret");
  if (auth !== SERVICE_KEY && (!cronSecret || auth !== cronSecret)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: baseHeaders });
  }
  const openaiKey = await getSecret(supabase, "openai", "embedding_key");
  if (!openaiKey) return new Response(JSON.stringify({ error: "openai_key_missing" }), { status: 500, headers: baseHeaders });

  let body: any = {};
  try { body = await req.json(); } catch { /* geen body = ok */ }
  const label = body.label || "cron-weekly";
  const audience = body.audience || "rag-eval-cron";
  const onlyCore = body.only_core === true;
  const onlyQtype: string | null = typeof body.only_qtype === "string" ? body.only_qtype : null;
  const offset: number = Number(body._offset || 0);
  let runId: string | null = body._run_id || null;
  const chainDepth: number = Number(body._chain || 0);

  const questions = await loadQuestions(supabase, onlyCore, onlyQtype);

  if (!runId) {
    const { data: run, error: runErr } = await supabase.from("rag_eval_runs").insert({
      label, context_build_version: "live", judge_model: JUDGE_MODEL, answer_model: JUDGE_MODEL,
      n_questions: questions.length, notes: "suite-v1 chained, running...",
    }).select("id").single();
    if (runErr || !run) return new Response(JSON.stringify({ ok: false, error: `run_insert_failed: ${runErr?.message}` }), { status: 500, headers: baseHeaders });
    runId = run.id as string;
  }

  const batch = questions.slice(offset, offset + BATCH_PER_INVOCATION);
  const results: any[] = [];
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const wave = batch.slice(i, i + CONCURRENCY);
    const done = await Promise.all(wave.map(async (q) => {
      try {
        if (q.qtype === "analytical") {
          const rt = await retrieveAnalytical(q);
          const asserted = runAnalyticalAsserts(q, rt);
          const answer = rt.ok ? String(rt.body.answer || "") : "";
          const analytics = rt.ok ? (rt.body.analytics || null) : null;
          const route = String(analytics?.route || "semantic");
          const rows: any[] = Array.isArray(analytics?.rows) ? analytics.rows : [];
          let jd: any = { error: "skipped" };
          if (rt.ok) jd = await judgeAnalytical(openaiKey, q, answer);
          return {
            q, strategy: `analytics:${route}`, bundle_id: rt.ok ? (rt.body.bundle_id || null) : null,
            n: rows.length, answer: answer || (rt.body?.error ?? ""),
            f: null, ar: null, cp: null,
            ac: clamp01(jd.answer_correctness), hit: asserted.hit, detail: asserted.detail, notes: jd.notes || jd.error || "",
          };
        }
        const rt = await retrieve(q, audience);
        const asserted = runAsserts(q, rt);
        const matches: any[] = rt.ok ? (rt.body.matches || []) : [];
        let jd: any = { error: "skipped" };
        if (rt.ok) jd = await judge(openaiKey, q, matches);
        let hit = asserted.hit;
        let detail = asserted.detail;
        if (q.asserts && (q.asserts as any).expect_no_context === true) {
          const ac = clamp01(jd.answer_correctness);
          const negOk = ac !== null ? ac >= 0.5 : null;
          if (negOk !== null) { hit = (hit === null ? negOk : hit && negOk); detail = (detail ? detail + "; " : "") + `no_context=${negOk}`; }
        }
        return {
          q, strategy: rt.ok ? rt.body.retrieval_strategy : null, bundle_id: rt.ok ? rt.body.bundle_id : null,
          n: matches.length, answer: jd.answer || jd.error || "",
          f: clamp01(jd.faithfulness), ar: clamp01(jd.answer_relevance), cp: clamp01(jd.context_precision),
          ac: clamp01(jd.answer_correctness), hit, detail, notes: jd.notes || jd.error || "",
        };
      } catch (e) {
        return { q, strategy: null, bundle_id: null, n: 0, answer: "", f: null, ar: null, cp: null, ac: null, hit: false, detail: "ERR " + (e instanceof Error ? e.message : String(e)), notes: "" };
      }
    }));
    results.push(...done);
  }

  const rows = results.map((r) => ({
    run_id: runId, question_id: r.q.id, question: String(r.q.question).slice(0, 2000), dimension: r.q.dimension, intent: r.q.intent,
    retrieval_strategy: r.strategy, bundle_id: r.bundle_id, n_chunks: r.n || 0, answer: String(r.answer).slice(0, 4000),
    faithfulness: r.f, answer_relevance: r.ar, context_precision: r.cp,
    signal_hit: r.hit, assert_detail: String(r.detail || "").slice(0, 1000), answer_correctness: r.ac,
    judge_notes: String(r.notes).slice(0, 2000),
  }));
  if (rows.length > 0) {
    const { error: resErr } = await supabase.from("rag_eval_results").insert(rows);
    if (resErr) return new Response(JSON.stringify({ ok: false, run_id: runId, error: `results_insert_failed: ${resErr.message}` }), { status: 500, headers: baseHeaders });
  }

  const nextOffset = offset + batch.length;
  if (nextOffset < questions.length && chainDepth < MAX_CHAIN) {
    // Self-chain: nieuwe invocation = nieuwe trace = verse rate-limit budget.
    try {
      const chainRes = await fetch(SELF_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ label, audience, only_core: onlyCore, only_qtype: onlyQtype, _run_id: runId, _offset: nextOffset, _chain: chainDepth + 1 }),
      });
      const chainJson = await chainRes.json().catch(() => ({}));
      return new Response(JSON.stringify(chainJson), { status: chainRes.ok ? 200 : 500, headers: baseHeaders });
    } catch (e) {
      const partial = await finalizeRun(supabase, runId!);
      return new Response(JSON.stringify({ ok: false, error: "chain_failed: " + (e instanceof Error ? e.message : String(e)), partial }), { status: 500, headers: baseHeaders });
    }
  }

  const summary = await finalizeRun(supabase, runId!);
  return new Response(JSON.stringify({ ok: true, label, chained: chainDepth, ...summary }), { status: 200, headers: baseHeaders });
});
