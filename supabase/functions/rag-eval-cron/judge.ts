// =============================================================================
// rag-eval-cron/judge.ts — laag 2: RAGAS-judge (retrieval) en ground-truth-judge (chat)
// =============================================================================
// v3.1 (2026-09-06, ANSWER-STACK S3b stap 1): judge gpt-5.5 → gpt-5.6-luna.
// De L2-judge vergelijkt met een referentie (geen voorkeursoordeel), dus hij
// mag goedkoop zijn; Luna bespaart ~$0,83 per volledige ronde. Het
// token-verbruik (incl. cached_tokens) reist als `_usage` mee terug, zodat de
// runner het in envelope_compact.judge_usage kan loggen — judge-kosten waren
// tot nu toe onzichtbaar. De chat-judge draait alleen als er een
// expected_answer is; de runner beslist wie in aanmerking komt (verified, of
// legacy-items met ground truth). Contract ongewijzigd: reasoning_effort none.
// =============================================================================
const OPENAI = "https://api.openai.com/v1/chat/completions";
export const JUDGE_MODEL = "gpt-5.6-luna";

export type Q = {
  id: string; question: string; dimension: string | null; category: string | null; intent: string; qtype: string;
  lane: "chat" | "retrieval"; persona: string; history: Array<{ role: string; content: string }>;
  expected_answer: string | null; ground_truth_status: string; asserts: Record<string, unknown>;
  options: Record<string, unknown>; tags: string[]; is_core: boolean; bank_version: string | null;
};

export const clamp01 = (x: unknown) => (typeof x === "number" && isFinite(x) ? Math.max(0, Math.min(1, x)) : null);

async function askJson(openaiKey: string, prompt: string, maxTokens: number): Promise<any> {
  try {
    const r = await fetch(OPENAI, {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: JUDGE_MODEL, messages: [{ role: "user", content: prompt }], max_completion_tokens: maxTokens, reasoning_effort: "none" }),
      signal: AbortSignal.timeout(60_000),
    });
    const t = await r.text();
    if (!r.ok) return { error: `openai_${r.status}: ${t.slice(0, 120)}` };
    const j = JSON.parse(t);
    const usage = { model: JUDGE_MODEL, in: j.usage?.prompt_tokens ?? null, cached: j.usage?.prompt_tokens_details?.cached_tokens ?? null, out: j.usage?.completion_tokens ?? null };
    const content = j.choices?.[0]?.message?.content ?? "";
    const mm = content.match(/\{[\s\S]*\}/);
    if (!mm) return { error: "no_json", _usage: usage };
    return { ...JSON.parse(mm[0]), _usage: usage };
  } catch (e) { return { error: e instanceof Error ? e.message.slice(0, 120) : "judge_error" }; }
}

/** Retrieval-lane: faithfulness / answer_relevance / context_precision (+ correctness bij ground truth of negatief). */
export async function judgeRetrieval(openaiKey: string, q: Q, matches: any[]): Promise<any> {
  const ctx = matches.slice(0, 10).map((m, i) => `[${i + 1}] (${m.source}) ${String(m.preview || "").replace(/\s+/g, " ").slice(0, 500)}`).join("\n");
  const gt = q.expected_answer && q.qtype !== "negative"
    ? `\nREFERENTIE-ANTWOORD (ground-truth): ${q.expected_answer}\nScoor ook answer_correctness 0.0-1.0: komt jouw antwoord inhoudelijk overeen met de referentie (1.0=zelfde feiten, 0=ander/fout antwoord).`
    : q.qtype === "negative"
    ? `\nLET OP: dit is een NEGATIVE-test — er hoort GEEN relevante context te bestaan. Correct gedrag = answer '(geen relevante context)'. Scoor answer_correctness 1.0 als je terecht concludeert dat de context niets relevants bevat, 0.0 als je toch een inhoudelijk antwoord fabriceert.`
    : "";
  const prompt = `Je bent een strenge RAG-evaluator. Beoordeel of de OPGEHAALDE CONTEXT de vraag goed kan beantwoorden.\n\nVRAAG: ${q.question.slice(0, 600)}\n\nOPGEHAALDE CONTEXT (genummerde fragmenten):\n${ctx || "(geen)"}${gt}\n\nTAAK: (1) Beantwoord de vraag UITSLUITEND op basis van de context (max 3 zinnen). (2) Scoor elk 0.0-1.0:\n- faithfulness: is elk feit in je antwoord terug te vinden in de context (1.0=volledig gegrond, 0=verzonnen)\n- answer_relevance: beantwoordt het antwoord daadwerkelijk de vraag\n- context_precision: welke fractie van de fragmenten is relevant voor de vraag\nAls de context niets relevants bevat: answer='(geen relevante context)', faithfulness=1.0, answer_relevance=0.0, context_precision=0.0.\nAntwoord ALLEEN met JSON: {"answer":"...","faithfulness":0.0,"answer_relevance":0.0,"context_precision":0.0,"answer_correctness":null,"notes":"korte motivatie"}`;
  return askJson(openaiKey, prompt, 800);
}

/** Chat-lane: alleen answer_correctness tegen de referentie. Negatieve items scoren 1.0 als ze terecht niets vinden. */
export async function judgeChat(openaiKey: string, q: Q, answer: string): Promise<any> {
  if (!q.expected_answer) return { answer_correctness: null, notes: "geen ground-truth" };
  const prompt = `Je vergelijkt een gegeven ANTWOORD met een REFERENTIE (ground-truth).\n\nVRAAG: ${q.question.slice(0, 400)}\n\nANTWOORD:\n${answer.slice(0, 3000)}\n\nREFERENTIE: ${q.expected_answer.slice(0, 1500)}\n\nScoor answer_correctness 0.0-1.0 (1.0 = zelfde entiteiten/feiten/strekking, 0.0 = fout of gefantaseerd; 'acceptabel extra' genoemde entiteiten tellen niet als fout). Is de referentie '(geen relevante context)' of een erkenning dat iets niet bijgehouden wordt, dan scoort een antwoord dat dat eerlijk zegt 1.0 en een antwoord dat alsnog feiten verzint 0.0. Antwoord ALLEEN met JSON: {"answer_correctness":0.0,"notes":"korte motivatie"}`;
  return askJson(openaiKey, prompt, 400);
}

/** Wie krijgt de chat-judge: geverifieerde ground truth, of een legacy-item (vóór de bank) met expected_answer. */
export function chatJudgeEligible(q: Q): boolean {
  if (!q.expected_answer) return false;
  return q.ground_truth_status === "verified" || q.bank_version == null;
}
