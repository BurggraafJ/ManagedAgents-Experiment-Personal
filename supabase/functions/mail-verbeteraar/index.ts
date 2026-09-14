// mail-verbeteraar — RAG-based mail-rewriter voor Jelle.
//
// Flow:
//   1. Lees originele mail-tekst + optionele extra prompt uit body.
//   2. Embed de input via OpenAI text-embedding-3-large (matcht chunks-store).
//   3. SQL: find top-N chunks met source='mail' EN waar mail_messages.is_from_me = true.
//      Dat zijn Jelle's eigen verzonden mails — gebruikt als schrijfstijl-anker.
//   4. LLM (gpt-4o-mini): herschrijf de input-mail in Jelle's stijl met de
//      voorbeelden als context + optionele extra prompt.
//
// Geen skill nodig — dashboard roept deze direct aan, blocking, met JWT-auth.
//
// v2 (2026-09-14 / multi-user M2, GAP-3 + beslissing 5). Drie dingen:
//   • `modellen.gebruiken` + maandbudget vóór de eerste (betaalde) call;
//   • elke OpenAI-call — óók de embedding — krijgt een regel in
//     `model_usage_log`;
//   • de stijlvoorbeelden komen uit de EIGEN verzonden mail van de aanroeper.
//     `find_similar_sent_mails` viel zonder `p_user_id` terug op de org-mailbox
//     (Jelle); P0 vond precies dát als gat en trok de grant in. Nu gaat de sub
//     uit de JWT mee, dus een member die nog niets gespiegeld heeft krijgt géén
//     voorbeelden in plaats van die van een ander — en de prompt zegt dat ook.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { logModelUsage, openaiUsage, requirePaidUse } from '../_shared/user-gate.ts';

const MODEL = 'gpt-4o-mini';
const EMBED_MODEL = 'text-embedding-3-large';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Connection': 'keep-alive', ...CORS },
  });
}

async function readVaultSecret(supabaseUrl: string, serviceKey: string, skill: string, secret: string): Promise<string | null> {
  const r = await fetch(`${supabaseUrl}/rest/v1/rpc/get_skill_secret_service`, {
    method: 'POST',
    headers: {
      apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_skill_name: skill, p_secret_name: secret }),
  });
  if (!r.ok) return null;
  const data = await r.json();
  return typeof data === 'string' ? data : null;
}

async function embedText(apiKey: string, text: string): Promise<number[] | null> {
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'text-embedding-3-large',
      input: text.slice(0, 6000),
    }),
  });
  if (!r.ok) return null;
  const d = await r.json();
  return d?.data?.[0]?.embedding || null;
}

async function findSimilarSentMails(
  supabaseUrl: string, serviceKey: string,
  embedding: number[], topK: number, userId: string | null,
): Promise<Array<{ subject: string; body_text: string; received_at: string; similarity: number }>> {
  // Direct SQL via PostgREST RPC of via een ad-hoc query. Eenvoudigst: een
  // tijdelijke SQL-call via de execute_sql endpoint bestaat niet — we gebruiken
  // een specifieke RPC die we hier ter plekke aanroepen.
  const r = await fetch(`${supabaseUrl}/rest/v1/rpc/find_similar_sent_mails`, {
    method: 'POST',
    headers: {
      apikey: serviceKey, Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_query_embedding: embedding,
      p_top_k: topK,
      // WIENS verzonden mail. Zonder dit veld valt de RPC terug op de
      // org-mailbox en krijgt iedereen Jelle's stijl — en zijn tekst.
      p_user_id: userId,
    }),
  });
  if (!r.ok) return [];
  const data = await r.json();
  return Array.isArray(data) ? data : [];
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405);

  const gate = await requirePaidUse(req);
  if (!gate.ok) return gate.response!;

  let payload: { original_mail?: string; extra_prompt?: string | null };
  try { payload = await req.json(); }
  catch { return json({ ok: false, reason: 'invalid_json' }, 400); }

  const original = (payload.original_mail || '').trim();
  if (!original) return json({ ok: false, reason: 'empty_input' }, 400);
  if (original.length > 8000) return json({ ok: false, reason: 'input_too_long' }, 400);

  const extra = (payload.extra_prompt || '').trim();

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceKey) return json({ ok: false, reason: 'missing_env' }, 500);

  const apiKey = await readVaultSecret(supabaseUrl, serviceKey, 'openai', 'embedding_key');
  if (!apiKey) return json({ ok: false, reason: 'missing_openai_key' }, 500);

  // Stap 1 — embed input
  const embedding = await embedText(apiKey, original);
  await logModelUsage({
    userId: gate.sub, edgeFunction: 'mail-verbeteraar', provider: 'openai',
    model: EMBED_MODEL, inputTokens: Math.ceil(original.length / 4), ok: !!embedding,
  });
  if (!embedding) return json({ ok: false, reason: 'embedding_failed' }, 502);

  // Stap 2 — RAG: vind 5 vergelijkbare zelf-verzonden mails
  const examples = await findSimilarSentMails(supabaseUrl, serviceKey, embedding, 5, gate.sub);

  // Stap 3 — LLM rewrite met examples als style-anker
  const examplesBlock = examples.length === 0
    ? '(Geen vergelijkbare verzonden mails gevonden — schrijf in een professionele, beknopte Nederlandse zakelijke stijl.)'
    : examples
        .map((ex, i) => `### Voorbeeld ${i + 1} (verzonden ${ex.received_at?.slice(0, 10)})\nOnderwerp: ${ex.subject || '(geen)'}\n\n${(ex.body_text || '').slice(0, 800)}`)
        .join('\n\n---\n\n');

  // Multi-user M2: de prompt noemde Jelle bij naam, ook als een member hem
  // aanriep. De voorbeelden zijn nu van de aanroeper zelf, dus de prompt zegt
  // "de schrijver" — en zegt het eerlijk als er geen voorbeelden zijn.
  const systemMsg = [
    'Je bent een mail-herschrijver.',
    examples.length > 0
      ? 'Hieronder staan eerder verzonden mails van de schrijver — dat is zijn of haar schrijfstijl.'
      : 'Er zijn geen eerder verzonden mails van deze schrijver beschikbaar; verzin geen stijl en blijf dicht bij de input.',
    'Behoud de inhoud, intentie en alle feiten van de input-mail.',
    'Verbeter: helderheid, opbouw en beknoptheid'
      + (examples.length > 0 ? ', en volg de toon van de voorbeelden.' : '.'),
    'Geen handtekening toevoegen (Outlook doet dat).',
    'Output: alleen de verbeterde mail-tekst, zonder commentaar of meta-uitleg.',
    extra ? `\nEXTRA VOORKEUR VOOR DEZE RUN:\n${extra}` : '',
  ].filter(Boolean).join('\n');

  const userMsg = [
    `# Schrijfstijl-voorbeelden van de schrijver\n\n${examplesBlock}`,
    `\n\n# Originele mail — te verbeteren\n\n${original}`,
  ].join('\n');

  const ai = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.4,
      max_tokens: 1500,
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: userMsg },
      ],
    }),
  });

  if (!ai.ok) {
    const t = await ai.text().catch(() => '');
    await logModelUsage({ userId: gate.sub, edgeFunction: 'mail-verbeteraar', provider: 'openai', model: MODEL, ok: false });
    return json({ ok: false, reason: 'openai_error', detail: t.slice(0, 400) }, 502);
  }
  const aiData = await ai.json();
  const u = openaiUsage(aiData);
  await logModelUsage({
    userId: gate.sub, edgeFunction: 'mail-verbeteraar', provider: 'openai',
    model: MODEL, inputTokens: u.input, outputTokens: u.output,
  });
  const improved = aiData?.choices?.[0]?.message?.content?.trim() || '';
  if (!improved) return json({ ok: false, reason: 'empty_response' }, 502);

  return json({
    ok: true,
    improved_mail: improved,
    examples_used: examples.length,
    example_subjects: examples.map(e => e.subject).filter(Boolean),
    model: MODEL,
  });
});
