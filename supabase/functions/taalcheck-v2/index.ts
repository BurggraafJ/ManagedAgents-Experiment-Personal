// taalcheck-v2 — taalcheck met instelbare intensiteit voor Postvak variant 2.
//
// First-principles herontwerp t.o.v. mail-taalcheck:
// - GEEN server-side afwijzing meer (length-ratio/word-overlap). Die validatie
//   bestond omdat de output blind de tekst verving; in variant 2 toont de UI
//   elke wijziging als track changes (rood doorgestreept / groen) en beslist
//   de gebruiker zelf per run met Overnemen/Verwerpen. De controle zit dus in
//   de UI, niet in een botte string-heuristiek die legitieme correcties blokkeert.
// - Intensiteit 1-4 stuurt hoe véél de checker mag aanpassen:
//     1 = alleen spel-/typefouten
//     2 = + grammatica, dt, interpunctie, hoofdletters (default)
//     3 = + stroeve zinnen gladtrekken (betekenis en toon identiek)
//     4 = vrij herschrijven voor helderheid (inhoud en toon behouden)
// - Altijd een resultaat teruggeven; 'changed' vertelt of er iets wijzigde.
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
  'Je bent een Nederlandse taalredacteur. Je krijgt een e-mailtekst en geeft een gecorrigeerde versie terug.',
  '',
  'ALTIJD, ongeacht intensiteit:',
  '- Behoud de inhoud, feiten, namen, bedragen en datums exact.',
  '- Behoud de aanhef en afsluiting/handtekening (corrigeer er hoogstens taalfouten in).',
  '- Behoud de alinea-indeling en witregels.',
  '- Voeg NIETS toe dat niet in de tekst staat en laat geen inhoud weg.',
  '- OUTPUT: alleen de gecorrigeerde tekst. Geen commentaar, geen code-fences, geen inleiding.',
  '- Geen taalfouten en niets te verbeteren op dit niveau? Geef de input dan letterlijk terug.',
].join('\n');

const LEVELS: Record<number, string> = {
  1: [
    'INTENSITEIT 1 — ALLEEN SPELLING.',
    'Corrigeer uitsluitend spelfouten en typefouten (verkeerd gespelde woorden, verwisselde letters).',
    'Raak grammatica, interpunctie, zinsbouw en woordkeuze NIET aan. Bij twijfel: laten staan.',
  ].join('\n'),
  2: [
    'INTENSITEIT 2 — SPELLING + GRAMMATICA.',
    'Corrigeer spelfouten, typefouten, dt-fouten, grammaticale fouten, interpunctie en hoofdlettergebruik.',
    'Behoud zinsbouw, woordkeuze en woordvolgorde. Geen synoniemen, geen herformuleringen.',
  ].join('\n'),
  3: [
    'INTENSITEIT 3 — VLOEIEND.',
    'Corrigeer alle taalfouten (spelling, grammatica, interpunctie) EN trek stroeve of omslachtige zinnen glad.',
    'Je mag zinnen herformuleren zolang de betekenis, toon en lengte per alinea vrijwel gelijk blijven.',
    'Geen nieuwe zinnen toevoegen, geen zinnen schrappen.',
  ].join('\n'),
  4: [
    'INTENSITEIT 4 — HERSCHRIJF VOOR HELDERHEID.',
    'Herschrijf de tekst vrij tot een heldere, natuurlijke, professionele Nederlandse e-mail.',
    'Je mag zinnen samenvoegen, splitsen, herordenen en beknopter maken.',
    'De boodschap, alle inhoudelijke punten en de toon (formeel/informeel) blijven exact behouden.',
  ].join('\n'),
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405);

  let payload: { text?: string; level?: number };
  try { payload = await req.json(); }
  catch { return json({ ok: false, reason: 'invalid_json' }, 400); }

  const text = (payload.text || '').trim();
  const level = Math.max(1, Math.min(4, Math.round(Number(payload.level) || 2)));
  if (!text) return json({ ok: false, reason: 'empty_input' }, 400);
  if (text.length > 12000) return json({ ok: false, reason: 'input_too_long' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceKey) return json({ ok: false, reason: 'missing_env' }, 500);
  const apiKey = await readVaultSecret(supabaseUrl, serviceKey, 'openai', 'embedding_key');
  if (!apiKey) return json({ ok: false, reason: 'missing_openai_key' }, 500);

  // gpt-5.4-mini contract: max_completion_tokens (geen max_tokens/temperature),
  // reasoning_effort 'none' (laagste; 'minimal' bestaat niet op dit model) —
  // ruim token-budget tegen de lege-output-val.
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
