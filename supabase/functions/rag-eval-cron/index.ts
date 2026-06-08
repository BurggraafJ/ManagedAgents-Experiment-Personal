// =============================================================================
// rag-eval-cron — RAG v3 F.0 continue meetbaarheid (shadow-eval).
// =============================================================================
// Draait de vaste gold-set door de LIVE context-build pipeline (intent=search) +
// een gpt-5.5 reference-free judge (faithfulness / answer_relevance / context_precision)
// en schrijft één rij in rag_eval_runs + rag_eval_results. Zo zie je regressie in
// retrievalkwaliteit over tijd zonder handmatig scripts/rag_eval_baseline.cjs te draaien.
//
// Reference-free (RAGAS-stijl): geen ground-truth nodig. De judge antwoordt UITSLUITEND
// op de opgehaalde context en scoort die. Identieke prompt als de .cjs-baseline, zodat
// cron-runs vergelijkbaar zijn met e00ca4a2 (baseline) en d237d81f (F.4/F.5).
//
// Auth: Bearer == skill:global:cron_secret OF service_role (server-to-server / pg_cron).
// RAG-cron → verify_jwt:false (eigen auth). Schedule: wekelijks (pg_cron rag-eval-weekly).
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CB_URL = `${SUPABASE_URL}/functions/v1/context-build`;
const OPENAI = "https://api.openai.com/v1/chat/completions";
const JUDGE_MODEL = "gpt-5.5";
const CONCURRENCY = 4;

// Vaste gold-set (12) — gelijk aan scripts/rag_eval_baseline.cjs voor trend-vergelijkbaarheid.
const GOLD: Array<[string, string, string]> = [
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

async function retrieve(q: string): Promise<{ matches: any[]; strategy: string | null; bundle_id: string | null; n: number }> {
  const r = await fetch(CB_URL, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ intent: "search", audience: "rag-eval-cron", trigger_type: "eval", query_text: q, options: {} }),
  });
  const j = await r.json().catch(() => ({}));
  return { matches: j.matches || [], strategy: j.retrieval_strategy || null, bundle_id: j.bundle_id || null, n: j.match_count || 0 };
}

async function judge(openaiKey: string, q: string, matches: any[]): Promise<any> {
  const ctx = matches.slice(0, 8).map((m, i) => `[${i + 1}] (${m.source}) ${String(m.preview || "").replace(/\s+/g, " ").slice(0, 320)}`).join("\n");
  const prompt = `Je bent een strenge RAG-evaluator. Beoordeel of de OPGEHAALDE CONTEXT de vraag goed kan beantwoorden.\n\nVRAAG: ${q}\n\nOPGEHAALDE CONTEXT (genummerde fragmenten):\n${ctx || "(geen)"}\n\nTAAK: (1) Beantwoord de vraag UITSLUITEND op basis van de context (max 3 zinnen). (2) Scoor elk 0.0-1.0:\n- faithfulness: is elk feit in je antwoord terug te vinden in de context (1.0=volledig gegrond, 0=verzonnen)\n- answer_relevance: beantwoordt het antwoord daadwerkelijk de vraag\n- context_precision: welke fractie van de fragmenten is relevant voor de vraag\nAls de context niets relevants bevat: answer='(geen relevante context)', faithfulness=1.0, answer_relevance=0.0, context_precision=0.0.\nAntwoord ALLEEN met JSON: {"answer":"...","faithfulness":0.0,"answer_relevance":0.0,"context_precision":0.0,"notes":"korte motivatie"}`;
  const r = await fetch(OPENAI, {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: JUDGE_MODEL, messages: [{ role: "user", content: prompt }], max_completion_tokens: 700, reasoning_effort: "none" }),
  });
  const t = await r.text();
  if (!r.ok) return { error: `openai_${r.status}: ${t.slice(0, 120)}` };
  const j = JSON.parse(t);
  const content = j.choices?.[0]?.message?.content ?? "";
  const mm = content.match(/\{[\s\S]*\}/);
  if (!mm) return { error: "no_json" };
  try { return JSON.parse(mm[0]); } catch { return { error: "parse" }; }
}

Deno.serve(async (req) => {
  const baseHeaders = { "Content-Type": "application/json" };
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: baseHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Auth: cron_secret OF service_role.
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

  const t0 = Date.now();
  const results: any[] = [];
  // Beperkte concurrency zodat de edge-wall-time laag blijft.
  for (let i = 0; i < GOLD.length; i += CONCURRENCY) {
    const batch = GOLD.slice(i, i + CONCURRENCY);
    const done = await Promise.all(batch.map(async ([id, dim, q]) => {
      try {
        const rt = await retrieve(q);
        const jd = await judge(openaiKey, q, rt.matches);
        return { id, dim, q, strategy: rt.strategy, bundle_id: rt.bundle_id, n: rt.n,
          answer: jd.answer || jd.error || "", f: clamp01(jd.faithfulness), ar: clamp01(jd.answer_relevance), cp: clamp01(jd.context_precision), notes: jd.notes || jd.error || "" };
      } catch (e) {
        return { id, dim, q, strategy: null, bundle_id: null, n: 0, answer: "", f: null, ar: null, cp: null, notes: "ERR " + (e instanceof Error ? e.message : String(e)) };
      }
    }));
    results.push(...done);
  }

  let sF = 0, sR = 0, sP = 0, nScored = 0;
  for (const r of results) if (r.f != null && r.ar != null && r.cp != null) { sF += r.f; sR += r.ar; sP += r.cp; nScored++; }
  const avg = (s: number) => (nScored ? Number((s / nScored).toFixed(3)) : null);
  const buildMs = Date.now() - t0;

  const { data: run, error: runErr } = await supabase.from("rag_eval_runs").insert({
    label, context_build_version: "context-build-v2.4", judge_model: JUDGE_MODEL, answer_model: JUDGE_MODEL,
    n_questions: results.length, avg_faithfulness: avg(sF), avg_answer_relevance: avg(sR), avg_context_precision: avg(sP),
    notes: `reference-free, rag-eval-cron, ${nScored}/${results.length} scored, ${buildMs}ms`,
  }).select("id").single();
  if (runErr || !run) return new Response(JSON.stringify({ ok: false, error: `run_insert_failed: ${runErr?.message}` }), { status: 500, headers: baseHeaders });

  const rows = results.map((r) => ({ run_id: run.id, question_id: r.id, question: r.q, dimension: r.dim, intent: "search",
    retrieval_strategy: r.strategy, bundle_id: r.bundle_id, n_chunks: r.n || 0, answer: String(r.answer).slice(0, 4000),
    faithfulness: r.f, answer_relevance: r.ar, context_precision: r.cp, judge_notes: String(r.notes).slice(0, 2000) }));
  const { error: resErr } = await supabase.from("rag_eval_results").insert(rows);
  if (resErr) return new Response(JSON.stringify({ ok: false, run_id: run.id, error: `results_insert_failed: ${resErr.message}` }), { status: 500, headers: baseHeaders });

  return new Response(JSON.stringify({ ok: true, run_id: run.id, label, n: results.length, n_scored: nScored,
    avg_faithfulness: avg(sF), avg_answer_relevance: avg(sR), avg_context_precision: avg(sP), build_ms: buildMs }), { status: 200, headers: baseHeaders });
});
