// =============================================================================
// rag-eval-cron v2 — RAG v3.2 eval-suite (lens B).
// =============================================================================
// v2 (2026-06-11, RAG v3.2):
//   - Gold-vragen uit tabel rag_eval_questions (was: hardcode 12) — kern-12 ongewijzigd.
//   - Deterministische asserts (variance-vrij, primaire trendlijn): regex-hit,
//     bron include/exclude, recency, strategy, reranked, meta-null, build-tijd.
//   - Judge gpt-5.5 secundair: previews 500 chars x top-10 (was 320 x 8) +
//     answer_correctness tegen ground-truth waar aanwezig + negative-detectie.
//   - Multi-intent (search / draft_reply / analyze_meeting / enrich_record / ...).
//   - body.audience override (default 'rag-eval-cron') voor bewaar-runs,
//     body.only_core=true voor alleen de 12-kern trendlijn.
//   - Wall-time guard 330s, partial save.
// Waarom asserts primair: gemeten judge-variance op n=12 is ±0.08-0.15 per run
// (4 runs 2026-06-08..11: R 0.61-0.77, P 0.39-0.53) — te ruizig voor kleine deltas.
// Auth: Bearer == skill:global:cron_secret OF service_role. verify_jwt:false (eigen auth).
// Deployed via MCP deploy_edge_function 2026-06-11 (version 2).
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CB_URL = `${SUPABASE_URL}/functions/v1/context-build`;
const OPENAI = "https://api.openai.com/v1/chat/completions";
const JUDGE_MODEL = "gpt-5.5";
const CONCURRENCY = 6;
const MAX_WALL_MS = 330_000;

// Fallback = exact de v1-hardcode (alleen gebruikt als de tabel leeg/onbereikbaar is).
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

// Deterministische asserts — geen LLM. Retourneert {hit, detail} of {hit:null} als er geen asserts zijn.
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

  // Vragen laden (tabel; fallback hardcode-12)
  let questions: Q[] = [];
  const { data: qRows, error: qErr } = await supabase.from("rag_eval_questions")
    .select("id, question, dimension, intent, qtype, expected_answer, asserts, options, is_core")
    .eq("is_active", true).order("id");
  if (!qErr && qRows && qRows.length > 0) {
    questions = (onlyCore ? qRows.filter((r: any) => r.is_core) : qRows) as Q[];
  } else {
    questions = GOLD_FALLBACK.map(([id, dim, q]) => ({ id, question: q, dimension: dim, intent: "search", qtype: "functional", expected_answer: null, asserts: {}, options: {} }));
  }

  const t0 = Date.now();
  const results: any[] = [];
  let skippedByTime = 0;
  for (let i = 0; i < questions.length; i += CONCURRENCY) {
    if (Date.now() - t0 > MAX_WALL_MS) { skippedByTime = questions.length - i; break; }
    const batch = questions.slice(i, i + CONCURRENCY);
    const done = await Promise.all(batch.map(async (q) => {
      try {
        const rt = await retrieve(q, audience);
        const asserted = runAsserts(q, rt);
        const matches: any[] = rt.ok ? (rt.body.matches || []) : [];
        let jd: any = { error: "skipped" };
        if (rt.ok) jd = await judge(openaiKey, q, matches);
        // negative: answer_correctness bepaalt ook signal_hit (expect_no_context)
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

  let sF = 0, sR = 0, sP = 0, nScored = 0, sAC = 0, nAC = 0, nHit = 0, nAsserted = 0;
  for (const r of results) {
    if (r.f != null && r.ar != null && r.cp != null) { sF += r.f; sR += r.ar; sP += r.cp; nScored++; }
    if (r.ac != null) { sAC += r.ac; nAC++; }
    if (r.hit !== null && r.hit !== undefined) { nAsserted++; if (r.hit) nHit++; }
  }
  const avg = (s: number, n: number) => (n ? Number((s / n).toFixed(3)) : null);
  const buildMs = Date.now() - t0;

  const { data: run, error: runErr } = await supabase.from("rag_eval_runs").insert({
    label, context_build_version: "live", judge_model: JUDGE_MODEL, answer_model: JUDGE_MODEL,
    n_questions: results.length, avg_faithfulness: avg(sF, nScored), avg_answer_relevance: avg(sR, nScored), avg_context_precision: avg(sP, nScored),
    signal_pass_rate: nAsserted ? Number((nHit / nAsserted).toFixed(3)) : null, n_asserted: nAsserted, avg_answer_correctness: avg(sAC, nAC),
    notes: `suite-v1, ${nScored}/${results.length} judged, ${nHit}/${nAsserted} asserts pass, ${skippedByTime} skipped(time), ${buildMs}ms`,
  }).select("id").single();
  if (runErr || !run) return new Response(JSON.stringify({ ok: false, error: `run_insert_failed: ${runErr?.message}` }), { status: 500, headers: baseHeaders });

  const rows = results.map((r) => ({
    run_id: run.id, question_id: r.q.id, question: String(r.q.question).slice(0, 2000), dimension: r.q.dimension, intent: r.q.intent,
    retrieval_strategy: r.strategy, bundle_id: r.bundle_id, n_chunks: r.n || 0, answer: String(r.answer).slice(0, 4000),
    faithfulness: r.f, answer_relevance: r.ar, context_precision: r.cp,
    signal_hit: r.hit, assert_detail: String(r.detail || "").slice(0, 1000), answer_correctness: r.ac,
    judge_notes: String(r.notes).slice(0, 2000),
  }));
  const { error: resErr } = await supabase.from("rag_eval_results").insert(rows);
  if (resErr) return new Response(JSON.stringify({ ok: false, run_id: run.id, error: `results_insert_failed: ${resErr.message}` }), { status: 500, headers: baseHeaders });

  return new Response(JSON.stringify({
    ok: true, run_id: run.id, label, n: results.length, n_scored: nScored,
    avg_faithfulness: avg(sF, nScored), avg_answer_relevance: avg(sR, nScored), avg_context_precision: avg(sP, nScored),
    signal_pass_rate: nAsserted ? Number((nHit / nAsserted).toFixed(3)) : null, asserts: `${nHit}/${nAsserted}`,
    avg_answer_correctness: avg(sAC, nAC), skipped_by_time: skippedByTime, build_ms: buildMs,
  }), { status: 200, headers: baseHeaders });
});
