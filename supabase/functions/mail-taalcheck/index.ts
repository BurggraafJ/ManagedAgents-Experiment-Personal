// mail-taalcheck — PURE taalcheck, GEEN herschrijving.
//
// Vergeleken met `auto-draft-spelcheck`: dit endpoint heeft een veel strictere
// system-prompt EN een server-side validatie die de output afwijst als-ie
// te veel afwijkt van het origineel:
//
//   1. Lengte-ratio: |out| / |in| moet tussen 0.85 en 1.18 zijn.
//   2. Word-overlap: ≥88% van de unieke woorden uit input moet ook in output
//      voorkomen (case-insensitive, met diakriteken-stripping voor robuustheid).
//
// Faalt de check → retry 1x met een nog explicietere instructie. Faalt nog
// steeds → return error met diagnose zodat de user weet wat er gebeurde.

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

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function wordSet(s: string): Set<string> {
  return new Set(
    normalize(s)
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2)
  );
}
function lengthRatio(input: string, output: string): number {
  const a = input.length;
  const b = output.length;
  if (a === 0) return 1;
  return b / a;
}
function wordOverlap(input: string, output: string): number {
  const a = wordSet(input);
  const b = wordSet(output);
  if (a.size === 0) return 1;
  let hit = 0;
  for (const w of a) if (b.has(w)) hit++;
  return hit / a.size;
}

const SYSTEM_PROMPT_STRICT = [
  'Je bent een Nederlandse TAALCHECKER, geen herschrijver.',
  '',
  'STRIKTE REGELS — in deze volgorde af te dwingen:',
  '1. Verbeter UITSLUITEND: spelfouten, typefouten, dt-fouten, grammatica-fouten, hoofdlettergebruik, leestekens.',
  '2. Behoud LETTERLIJK: zinsbouw, woordkeuze, woordvolgorde, alinea-indeling, lengte, toon, register, leenwoorden.',
  '3. NIET DOEN: zinnen samenvoegen of splitsen, synoniemen kiezen, woorden toevoegen, woorden weglaten, formaliteit aanpassen.',
  '4. Bij twijfel: laat het origineel staan.',
  '5. Geen handtekening toevoegen of weghalen.',
  '',
  'OUTPUT-FORMAAT: alleen de gecorrigeerde tekst, exact één versie, zonder commentaar, zonder code-fences, zonder "Hier is de gecorrigeerde versie:".',
  '',
  'Als er geen taalfouten zijn: geef de input letterlijk terug.',
].join('\n');

const SYSTEM_PROMPT_RETRY = [
  SYSTEM_PROMPT_STRICT,
  '',
  'BELANGRIJK — vorige poging week TE VEEL af van het origineel.',
  'Wees nu ULTRA conservatief: verander letterlijk alleen woorden met een spelfout of dt-fout.',
  'Als je twijfelt of iets een fout is: laat het staan.',
  'De output moet bijna woord-voor-woord identiek zijn aan de input, op enkele spelcorrecties na.',
].join('\n');

async function callOpenAI(apiKey: string, system: string, user: string): Promise<string | null> {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.0,
      top_p: 1.0,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user   },
      ],
    }),
  });
  if (!r.ok) return null;
  const d = await r.json();
  return d?.choices?.[0]?.message?.content?.trim() || null;
}

interface ValidationResult {
  ok: boolean;
  ratio: number;
  overlap: number;
  reason?: string;
}
function validate(input: string, output: string): ValidationResult {
  const ratio = lengthRatio(input, output);
  const overlap = wordOverlap(input, output);
  if (ratio < 0.85 || ratio > 1.18) {
    return { ok: false, ratio, overlap, reason: `length_drift_${ratio.toFixed(2)}x` };
  }
  if (overlap < 0.88) {
    return { ok: false, ratio, overlap, reason: `low_word_overlap_${(overlap * 100).toFixed(0)}pct` };
  }
  return { ok: true, ratio, overlap };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405);

  let payload: { original_mail?: string };
  try { payload = await req.json(); }
  catch { return json({ ok: false, reason: 'invalid_json' }, 400); }
  const original = (payload.original_mail || '').trim();
  if (!original) return json({ ok: false, reason: 'empty_input' }, 400);
  if (original.length > 8000) return json({ ok: false, reason: 'input_too_long' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceKey) return json({ ok: false, reason: 'missing_env' }, 500);
  const apiKey = await readVaultSecret(supabaseUrl, serviceKey, 'openai', 'embedding_key');
  if (!apiKey) return json({ ok: false, reason: 'missing_openai_key' }, 500);

  // Eerste poging — strict prompt
  let result = await callOpenAI(apiKey, SYSTEM_PROMPT_STRICT, original);
  if (!result) return json({ ok: false, reason: 'openai_error' }, 502);

  let validation = validate(original, result);
  let attempts = 1;

  // Validatie faalt — retry met agressievere prompt
  if (!validation.ok) {
    const retry = await callOpenAI(apiKey, SYSTEM_PROMPT_RETRY, original);
    if (retry) {
      const v2 = validate(original, retry);
      attempts = 2;
      if (v2.ok) {
        result = retry;
        validation = v2;
      } else {
        // Retry ook fout — return de input zelf met een waarschuwing,
        // veiliger dan een te-ingrijpende rewrite teruggeven
        return json({
          ok: false,
          reason: 'validation_failed_after_retry',
          detail: `lengte ${(v2.ratio * 100).toFixed(0)}%, overlap ${(v2.overlap * 100).toFixed(0)}%`,
          attempts,
        }, 200);
      }
    }
  }

  const changed = result !== original;

  return json({
    ok: true,
    corrected_body: result,
    changed,
    attempts,
    validation: {
      length_ratio: Number(validation.ratio.toFixed(3)),
      word_overlap: Number(validation.overlap.toFixed(3)),
    },
    model: 'gpt-4o-mini',
  });
});
