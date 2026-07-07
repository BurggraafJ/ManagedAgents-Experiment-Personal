// taalcheck-v2 — taalcheck met instelbare intensiteit voor Postvak variant 2.
//
// First-principles ontwerp:
// - GEEN server-side afwijzing (de track-changes-UI is de controle: de
//   gebruiker ziet elke wijziging en beslist met Overnemen/Verwerpen).
// - Drie niveaus (review-ronde 2, Jelle's definitie):
//     1 = FOUTLOOS — álle taalfouten eruit (spelling, dt, grammatica,
//         interpunctie) maar zo min mogelijk herschrijven
//     2 = VLOEIEND — idem + zinnen die niet lopen/kloppen beter vormgeven
//     3 = BETER VERWOORD — boodschap en stijl behouden, maar de sterkst
//         mogelijke verwoording (default blijft 1: fouten zijn de basis)
// - Altijd een resultaat; 'changed' vertelt of er iets wijzigde.
//
// verify_jwt: TRUE — browser-callable (zelfde uitzonderingsklasse als kb-compose).

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

async function readVaultSecret(supabaseUrl: string, serviceKey: string, skill: string, secret: string): Promise<string | null> {
  const r = await fetch(`${supabaseUrl}/rest/v1/rpc/get_skill_secret_service`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_skill_name: skill, p_secret_name: secret }),
  });
  if (!r.ok) return null;
  const d = await r.json();
  return typeof d === 'string' ? d : null;
}

const BASE = [
  'Je bent een Nederlandse taalredacteur. Je krijgt een e-mailtekst en geeft een verbeterde versie terug.',
  '',
  'ALTIJD, op elk niveau:',
  '- Corrigeer ÁLLE taalfouten: spelfouten, typefouten, dt-fouten, grammatica, interpunctie, hoofdlettergebruik. Een fout laten staan mag nooit.',
  '- Behoud de inhoud, feiten, namen, bedragen en datums exact.',
  '- Behoud de aanhef en afsluiting/handtekening (corrigeer er hoogstens taalfouten in).',
  '- Behoud de alinea-indeling en witregels.',
  '- Voeg GEEN nieuwe inhoud toe en laat geen inhoudelijke punten weg.',
  '- OUTPUT: alleen de verbeterde tekst. Geen commentaar, geen code-fences, geen inleiding.',
  '- Is er op dit niveau niets te verbeteren? Geef de input dan letterlijk terug.',
].join('\n');

const LEVELS: Record<number, string> = {
  1: [
    'NIVEAU 1 — FOUTLOOS.',
    'Corrigeer alle taalfouten (zie ALTIJD), maar herschrijf zo min mogelijk:',
    'behoud zinsbouw, woordkeuze en woordvolgorde. Geen synoniemen, geen herformuleringen —',
    'alleen wat taalkundig fóút is wordt aangepast.',
  ].join('\n'),
  2: [
    'NIVEAU 2 — VLOEIEND.',
    'Corrigeer alle taalfouten ÉN geef zinnen die niet lopen, krom zijn of onduidelijk zijn een betere vorm.',
    'Goed lopende zinnen laat je staan zoals ze zijn. Betekenis, lengte en toon blijven gelijk.',
    'Geen zinnen toevoegen of schrappen.',
  ].join('\n'),
  3: [
    'NIVEAU 3 — BETER VERWOORD.',
    'Corrigeer alle taalfouten en herschrijf de tekst naar de sterkst mogelijke verwoording:',
    'helder, natuurlijk en overtuigend Nederlands. Je mag zinnen samenvoegen, splitsen, herordenen en beknopter maken.',
    'MAAR: wat de schrijver wil zeggen en zijn persoonlijke stijl en toon (formeel/informeel, warm/zakelijk)',
    'blijven exact behouden — het moet klinken als dezelfde persoon op zijn best.',
  ].join('\n'),
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405);

  let payload: { text?: string; level?: number };
  try { payload = await req.json(); }
  catch { return json({ ok: false, reason: 'invalid_json' }, 400); }

  const text = (payload.text || '').trim();
  const level = Math.max(1, Math.min(3, Math.round(Number(payload.level) || 1)));
  if (!text) return json({ ok: false, reason: 'empty_input' }, 400);
  if (text.length > 12000) return json({ ok: false, reason: 'input_too_long' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceKey) return json({ ok: false, reason: 'missing_env' }, 500);
  const apiKey = await readVaultSecret(supabaseUrl, serviceKey, 'openai', 'embedding_key');
  if (!apiKey) return json({ ok: false, reason: 'missing_openai_key' }, 500);

  // gpt-5.4-mini contract: max_completion_tokens (geen max_tokens/temperature),
  // reasoning_effort 'none' (laagste op dit model) — ruim budget tegen lege output.
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-5.4-mini',
      reasoning_effort: 'none',
      max_completion_tokens: 8000,
      messages: [
        { role: 'system', content: `${BASE}\n\n${LEVELS[level]}` },
        { role: 'user', content: text },
      ],
    }),
  });
  if (!r.ok) {
    const errTxt = await r.text().catch(() => '');
    return json({ ok: false, reason: 'openai_error', detail: errTxt.slice(0, 300) }, 502);
  }
  const d = await r.json();
  const corrected = (d?.choices?.[0]?.message?.content ?? '').trim();
  if (!corrected) return json({ ok: false, reason: 'empty_output' }, 502);

  return json({
    ok: true,
    corrected,
    changed: corrected !== text,
    level,
    model: 'gpt-5.4-mini',
  });
});
