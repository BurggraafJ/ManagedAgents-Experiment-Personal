#!/usr/bin/env node
// RAG v3 F.0 — baseline eval (reference-free). Voor elke gold-vraag: retrieval via context-build,
// daarna een gpt-5.5 judge die antwoordt op basis van de context + faithfulness/answer-relevance/
// context-precision scoort. Output = SQL (INSERT rag_eval_runs + rag_eval_results) op stdout.
// Run: OPENAI_KEY=... ANON=... node scripts/rag_eval_baseline.cjs  > /tmp/eval.sql
const crypto = require("crypto");
const URL = "https://ezxihctobrqoklufawim.supabase.co/functions/v1/context-build";
const OPENAI = "https://api.openai.com/v1/chat/completions";
const ANON = process.env.ANON;
const KEY = process.env.OPENAI_KEY;
const JUDGE_MODEL = "gpt-5.5";
const CB_VERSION = process.env.CBV || "context-build-v2.3";
const LABEL = process.env.LABEL || "baseline";

const QUESTIONS = [
  ["E04","wat-zei-X-over-Y","Wat is er besproken over het LegalMind prijsmodel en adoptie?"],
  ["E06","wat-zei-X-over-Y","Welke argumenten zijn genoemd waarom advocaten een eigen dossier of DMS-koppeling willen?"],
  ["E15","vrije-semantiek","Welke zorgen hebben advocatenkantoren over AI en betrouwbaarheid?"],
  ["E16","vrije-semantiek","Wat is onze positionering ten opzichte van concurrenten?"],
  ["E20","feit-specifiek","Wat is de besproken maandprijs per gebruiker?"],
  ["E21","feit-specifiek","Wat is de laatste stand rondom TTFA?"],
  ["E22","feit-specifiek","Welke kandidaat is voorgesteld voor de sales-rol?"],
  ["E36","vrije-semantiek","Wat is de visie op AI-versnippering binnen kantoren?"],
  ["R01","named-entity","Wat is de huidige status van onze samenwerking met Rutgers en Posch?"],
  ["RFO","named-entity","Geef me de laatste stand van zaken rond Forsyte Advocaten"],
  ["E14","vrije-semantiek","Wat zijn de belangrijkste bezwaren die klanten noemen over de prijs?"],
  ["E12","lifecycle-sales","Welke pilots of proefperiodes lopen er nu?"],
];

const sq = (s) => (s == null ? "" : String(s)).replace(/'/g, "''").slice(0, 4000);
const num = (x) => (typeof x === "number" && isFinite(x) ? Math.max(0, Math.min(1, x)) : null);

async function retrieve(q) {
  const r = await fetch(URL, { method: "POST", headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify({ intent: "search", audience: "rag-v3-eval", trigger_type: "eval", query_text: q, options: {} }) });
  const j = await r.json();
  return { matches: j.matches || [], strategy: j.retrieval_strategy || null, bundle_id: j.bundle_id || null, n: j.match_count || 0 };
}

async function judge(q, matches) {
  const ctx = matches.slice(0, 8).map((m, i) => `[${i + 1}] (${m.source}) ${String(m.preview || "").replace(/\s+/g, " ").slice(0, 320)}`).join("\n");
  const prompt = `Je bent een strenge RAG-evaluator. Beoordeel of de OPGEHAALDE CONTEXT de vraag goed kan beantwoorden.\n\nVRAAG: ${q}\n\nOPGEHAALDE CONTEXT (genummerde fragmenten):\n${ctx || "(geen)"}\n\nTAAK: (1) Beantwoord de vraag UITSLUITEND op basis van de context (max 3 zinnen). (2) Scoor elk 0.0-1.0:\n- faithfulness: is elk feit in je antwoord terug te vinden in de context (1.0=volledig gegrond, 0=verzonnen)\n- answer_relevance: beantwoordt het antwoord daadwerkelijk de vraag\n- context_precision: welke fractie van de fragmenten is relevant voor de vraag\nAls de context niets relevants bevat: answer='(geen relevante context)', faithfulness=1.0, answer_relevance=0.0, context_precision=0.0.\nAntwoord ALLEEN met JSON: {"answer":"...","faithfulness":0.0,"answer_relevance":0.0,"context_precision":0.0,"notes":"korte motivatie"}`;
  const r = await fetch(OPENAI, { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: JUDGE_MODEL, messages: [{ role: "user", content: prompt }], max_completion_tokens: 700, reasoning_effort: "none" }) });
  const t = await r.text();
  if (!r.ok) return { error: `openai_${r.status}: ${t.slice(0, 120)}` };
  const j = JSON.parse(t);
  const content = j.choices?.[0]?.message?.content ?? "";
  const mm = content.match(/\{[\s\S]*\}/);
  if (!mm) return { error: "no_json", raw: content.slice(0, 120) };
  try { return JSON.parse(mm[0]); } catch (e) { return { error: "parse", raw: content.slice(0, 120) }; }
}

(async () => {
  const runId = crypto.randomUUID();
  const rows = [];
  let sF = 0, sR = 0, sP = 0, nScored = 0;
  for (const [id, dim, q] of QUESTIONS) {
    try {
      const rt = await retrieve(q);
      const jd = await judge(q, rt.matches);
      const f = num(jd.faithfulness), ar = num(jd.answer_relevance), cp = num(jd.context_precision);
      if (f != null && ar != null && cp != null) { sF += f; sR += ar; sP += cp; nScored++; }
      rows.push({ id, dim, q, strategy: rt.strategy, bundle_id: rt.bundle_id, n: rt.n, answer: jd.answer || jd.error || "", f, ar, cp, notes: jd.notes || jd.error || "" });
      process.stderr.write(`${id}: strat=${rt.strategy} n=${rt.n} F=${f} R=${ar} P=${cp}\n`);
    } catch (e) { rows.push({ id, dim, q, strategy: null, bundle_id: null, n: 0, answer: "", f: null, ar: null, cp: null, notes: "ERR " + e.message }); process.stderr.write(`${id}: ERROR ${e.message}\n`); }
  }
  const avg = (s) => (nScored ? (s / nScored).toFixed(3) : "NULL");
  let sql = `INSERT INTO rag_eval_runs (id,label,context_build_version,judge_model,answer_model,n_questions,avg_faithfulness,avg_answer_relevance,avg_context_precision,notes) VALUES ('${runId}','${LABEL}','${CB_VERSION}','${JUDGE_MODEL}','${JUDGE_MODEL}',${rows.length},${avg(sF)},${avg(sR)},${avg(sP)},'reference-free, session-orchestrated, ${nScored}/${rows.length} scored');\n`;
  sql += `INSERT INTO rag_eval_results (run_id,question_id,question,dimension,intent,retrieval_strategy,bundle_id,n_chunks,answer,faithfulness,answer_relevance,context_precision,judge_notes) VALUES\n`;
  sql += rows.map((r) => `('${runId}','${r.id}','${sq(r.q)}','${r.dim}','search',${r.strategy ? `'${sq(r.strategy)}'` : "NULL"},${r.bundle_id ? `'${r.bundle_id}'` : "NULL"},${r.n || 0},'${sq(r.answer)}',${r.f ?? "NULL"},${r.ar ?? "NULL"},${r.cp ?? "NULL"},'${sq(r.notes)}')`).join(",\n") + ";\n";
  process.stdout.write(sql);
  process.stderr.write(`\nBASELINE avg: faithfulness=${avg(sF)} answer_relevance=${avg(sR)} context_precision=${avg(sP)} (n=${nScored})\n`);
})();
