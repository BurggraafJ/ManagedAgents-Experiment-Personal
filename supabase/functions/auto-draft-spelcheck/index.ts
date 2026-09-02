// auto-draft-spelcheck — AI-Native spelcheck voor draft-bodies vanuit het Postvak.
// Default-instructie houdt toon en stijl intact; extra-instructie geeft Jelle een
// per-call override (niet opgeslagen). Gebruikt OpenAI gpt-4o-mini voor lage kosten
// en lage latency. Bestaande Vault-key (skill:openai:embedding_key) is een geldige
// OpenAI key — geen aparte rotatie nodig.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

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

async function readVaultSecret(supabaseUrl: string, serviceKey: string, skillName: string, secretName: string): Promise<string | null> {
  const r = await fetch(`${supabaseUrl}/rest/v1/rpc/get_skill_secret_service`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_skill_name: skillName, p_secret_name: secretName }),
  });
  if (!r.ok) return null;
  const data = await r.json();
  if (typeof data === 'string') return data;
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405);

  let payload: { draft_body?: string; default_instruction?: string; extra_instruction?: string | null };
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, reason: 'invalid_json' }, 400);
  }

  const draftBody = (payload.draft_body || '').trim();
  if (!draftBody) return json({ ok: false, reason: 'empty_draft' }, 400);

  const defaultInstruction = (payload.default_instruction || '').trim() ||
    'Corrigeer alleen harde spel- en typefouten in de Nederlandse tekst. Behoud toon, structuur, opmaak en woordkeuze. Verander geen werkwoordstijden, alinea-indeling of stijl. Geef enkel de gecorrigeerde tekst terug, zonder commentaar.';
  const extraInstruction = (payload.extra_instruction || '').trim();

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceKey) return json({ ok: false, reason: 'missing_env' }, 500);

  const apiKey = await readVaultSecret(supabaseUrl, serviceKey, 'openai', 'embedding_key');
  if (!apiKey) return json({ ok: false, reason: 'missing_openai_key' }, 500);

  const systemMsg = extraInstruction
    ? `${defaultInstruction}\n\nExtra voorkeur voor deze run:\n${extraInstruction}`
    : defaultInstruction;

  const ai = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      max_tokens: 1500,
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: draftBody },
      ],
    }),
  });

  if (!ai.ok) {
    const errText = await ai.text().catch(() => '');
    return json({ ok: false, reason: 'openai_error', detail: errText.slice(0, 400) }, 502);
  }

  const aiData = await ai.json();
  const corrected = aiData?.choices?.[0]?.message?.content?.trim() || '';
  if (!corrected) return json({ ok: false, reason: 'empty_response' }, 502);

  return json({
    ok: true,
    corrected_body: corrected,
    used_extra: !!extraInstruction,
    model: 'gpt-4o-mini',
  });
});
