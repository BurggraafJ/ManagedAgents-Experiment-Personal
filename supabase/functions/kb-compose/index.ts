// =============================================================================
// kb-compose v2 — handmatige kennisbank-aanmaak, Kennisbank 2.0 (klant-only).
//
//   USER-CALLABLE (verify_jwt: true). Dit is de ENIGE kb-* Edge Function die
//   door de browser wordt aangeroepen, NIET door pg_cron. De CLAUDE.md
//   hard-rule "kb-* cron = verify_jwt:false" geldt hier NIET — laat TRUE staan.
//
//   Acties (POST body.action):
//     'similar'  — titel+beschrijving → embed → vergelijkbare BESTAANDE
//                  artikelen (kb_match_articles). Voor de "lijkt dit op iets
//                  dat we al hebben?"-stap vóór het genereren.
//     'compose'  — (default) schrijft ÉÉN klant-artikel op basis van titel +
//                  beschrijving (+ optionele context uit RAG, + optionele
//                  bijstel-instructie op een eerder gegenereerd artikel).
//                  Levert ook de similar-lijst mee. Slaat NIETS op — de UI
//                  publiceert via RPC create_kb_article.
//
//   Model: cfg.compose_model || cfg.write_model || claude-sonnet-4-6 — claude*
//   loopt verplicht via de centrale callAnthropic-wrapper (claude_api_calls).
// =============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAnthropic } from "../_shared/anthropic-fetch.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DEFAULT_USER = '0934ffef-f600-4e1c-90c3-9d9bda2e0e42';
const SKILL_VERSION = 'kb-compose-v2';

const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-5.4': { input: 2.50, output: 15.00 }, 'gpt-5.4-mini': { input: 0.75, output: 4.50 }, 'gpt-5.4-nano': { input: 0.15, output: 0.60 },
  'gpt-5.2': { input: 1.75, output: 14.00 }, 'gpt-5': { input: 1.25, output: 10.00 }, 'gpt-5-nano': { input: 0.20, output: 1.25 }, 'gpt-5-mini': { input: 0.75, output: 4.50 }, 'gpt-4.1-mini': { input: 0.40, output: 1.60 },
};
const VALID_TYPES = new Set(['how_to', 'beleid', 'referentie', 'troubleshooting', 'faq', 'besluit_rationale']);

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

let CACHED_OPENAI: string | null = null;
let CACHED_ANTHROPIC: string | null = null;

async function getOpenAIKey(): Promise<string> {
  if (CACHED_OPENAI) return CACHED_OPENAI;
  const fromEnv = Deno.env.get('OPENAI_API_KEY');
  if (fromEnv) { CACHED_OPENAI = fromEnv; return fromEnv; }
  const { data, error } = await sb.rpc('get_openai_key_for_mail_enricher');
  if (error || !data) throw new Error('OpenAI key not available');
  CACHED_OPENAI = data as string; return CACHED_OPENAI;
}
async function getAnthropicKey(): Promise<string> {
  if (CACHED_ANTHROPIC) return CACHED_ANTHROPIC;
  const fromEnv = Deno.env.get('ANTHROPIC_API_KEY');
  if (fromEnv) { CACHED_ANTHROPIC = fromEnv; return fromEnv; }
  const { data, error } = await sb.rpc('get_skill_secret_service', { p_skill_name: 'anthropic', p_secret_name: 'api_key' });
  if (error || !data) throw new Error('Anthropic key not available (skill:anthropic:api_key)');
  CACHED_ANTHROPIC = data as string; return CACHED_ANTHROPIC;
}
async function getConfig(): Promise<Record<string, string>> {
  const { data } = await sb.from('kb_curator_config').select('key,value');
  const m: Record<string, string> = {};
  for (const r of (data || [])) m[r.key] = r.value;
  return m;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  const body: any = await req.json().catch(() => ({}));
  const action = body.action === 'similar' ? 'similar' : 'compose';
  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim();
  const brief = [title, description].filter(Boolean).join('\n');

  if (brief.length < 10) return json({ ok: false, error: 'description_required', detail: 'Geef een titel en/of beschrijving van minstens 10 tekens.' }, 400);

  const diag: any = { version: SKILL_VERSION, action, cost_usd: 0, started_at: new Date().toISOString() };
  try {
    // Similar-check — altijd uitgevoerd (ook bij compose, zelfde embedding)
    let similar: any[] = [];
    try {
      const vec = await embedText(brief);
      const { data: m } = await sb.rpc('kb_match_articles', { p_embedding: vec, p_top: 5 });
      similar = (m || []).filter((x: any) => x.sim >= 0.40).map((x: any) => ({
        id: x.article_id, title: x.title, summary: x.summary, kb_category: x.kb_category, sim: Math.round(x.sim * 100) / 100,
      }));
    } catch (e: any) { diag.similar_error = (e?.message || String(e)).slice(0, 120); }
    diag.similar_count = similar.length;

    if (action === 'similar') {
      diag.finished_at = new Date().toISOString();
      return json({ ok: true, similar, _diagnose: diag });
    }

    // Compose — één artikel
    const kbCategory = body.kb_category || null;
    const articleType = VALID_TYPES.has(body.article_type) ? body.article_type : null;
    const useContext = body.use_context !== false;
    const instruction = String(body.instruction || '').trim();       // bijstel-instructie
    const previousBody = String(body.previous_body || '').trim();    // eerder gegenereerd artikel

    const cfg = await getConfig();
    const model = cfg.compose_model || cfg.write_model || 'claude-sonnet-4-6';
    diag.model = model;

    let context: any = { used: false, count: 0, snippets: [], bundle_id: null };
    if (useContext) {
      try { context = await searchContext(brief); }
      catch (e: any) { context = { used: false, count: 0, snippets: [], bundle_id: null, error: (e?.message || String(e)).slice(0, 160) }; }
    }
    diag.context_count = context.count;

    const system = buildComposeSystem(cfg, articleType, !!previousBody);
    const user = buildComposeUser(title, description, kbCategory, articleType, context.snippets, instruction, previousBody);
    const r = await callModel(model, system, user, 4500, 'medium');
    diag.cost_usd += r.cost;
    const a = parseJsonLoose(r.content);
    if (a._parse_error) return json({ ok: false, error: 'parse_failed', detail: 'Het model gaf geen geldig artikel terug — probeer opnieuw.', _diagnose: diag }, 500);

    const article = {
      title: (a.title || title || '').slice(0, 200),
      summary: (a.summary || '').slice(0, 500),
      body: (a.body || '').slice(0, 9000),
      te_bevestigen: Array.isArray(a.te_bevestigen) ? a.te_bevestigen.slice(0, 12) : [],
    };
    diag.finished_at = new Date().toISOString();
    return json({ ok: true, article, similar, context, model, _diagnose: diag });
  } catch (e: any) {
    diag.error = (e?.message || String(e)).slice(0, 300);
    return json({ ok: false, error: 'unhandled', detail: diag.error, _diagnose: diag }, 500);
  }
});

// ----------------------------------------------------------------------------
// Context-zoeker — server-to-server naar context-build (RAG-index).
// ----------------------------------------------------------------------------
async function searchContext(query: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/context-build`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_ROLE}`, 'apikey': SERVICE_ROLE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent: 'search', query_text: query, audience: 'klant', options: { top_k: 8 } }),
  });
  if (!r.ok) throw new Error(`context-build_${r.status}: ${(await r.text()).slice(0, 120)}`);
  const j = await r.json();
  const matches = Array.isArray(j.matches) ? j.matches : [];
  const snippets = matches
    .map((m: any) => ({ source: m.source, occurred_at: m.occurred_at || null, text: String(m.preview || '').slice(0, 600) }))
    .filter((s: any) => s.text)
    .slice(0, 8);
  return { used: true, count: snippets.length, snippets, bundle_id: j.bundle_id || null };
}

// ----------------------------------------------------------------------------
// Prompt-bouwers — Content Standard + klant-toon (kb_curator_config).
// ----------------------------------------------------------------------------
const DRAFT_SCHEMA = 'Output UITSLUITEND geldige JSON, geen markdown-fences:\n{"title":"","summary":"","body":"","te_bevestigen":["open Legal Mind-feit dat ontbreekt"]}\n- body = markdown (## koppen, genummerde stappen, korte lijsten). summary = 1 zin. Ontbrekende Legal Mind-specifieke feiten: neem ze in de body op als blok dat begint met "> TE BEVESTIGEN door Jelle/CS:" met bullets, en noem ze ook in te_bevestigen. Verzin niets.';

function buildComposeSystem(cfg: Record<string, string>, articleType: string | null, revise: boolean): string {
  const aug = (cfg.augmentation_level || 'geassisteerd').toLowerCase();
  const augLine = aug.startsWith('strikt')
    ? 'Aanvul-niveau STRIKT: voeg GEEN algemene kennis toe; blijf strikt bij de beschrijving + meegegeven context.'
    : 'Aanvul-niveau GEASSISTEERD: veilige, universeel-ware algemene uitleg mag, kort en generiek — nooit Legal Mind-specifieke feiten verzinnen.';
  return [
    cfg.generate_system || 'Je bent de kennisbank-curator van het klant-help-center van Legal Mind.',
    revise
      ? 'Je HERSCHRIJFT een eerder gegenereerd klant-artikel volgens de bijstel-instructie van de redacteur (Jelle). Behoud wat goed is; pas aan wat de instructie vraagt; leg Legal Mind nooit feiten in de mond.'
      : 'Je schrijft ÉÉN kennisbank-artikel voor de KLANT op basis van een titel + beschrijving van de redacteur (Jelle) en optionele context uit de kennisbank/mailhistorie. Je bent een ghostwriter: maak er een goed artikel van, maar leg Legal Mind nooit feiten in de mond.',
    'CONTENT STANDARD:\n' + (cfg.content_standard || ''),
    articleType ? `ARTIKELTYPE: ${articleType} — volg de gangbare opbouw voor dit type.` : '',
    'TITEL-STIJL: ' + (cfg.title_rules || ''),
    'GROUNDING:\n' + (cfg.grounding_rules || '') + '\n' + augLine,
    'TOON (klant): ' + (cfg.tone_klant || ''),
    DRAFT_SCHEMA,
  ].filter(Boolean).join('\n\n');
}

function buildComposeUser(title: string, description: string, kbCategory: string | null, articleType: string | null, snippets: any[], instruction: string, previousBody: string): string {
  const ctxBlock = (snippets && snippets.length)
    ? '\n\nCONTEXT UIT DE KENNISBANK/MAILHISTORIE (feitenbasis — gebruik wat relevant is, verzin niets, negeer wat niet past):\n' +
      snippets.map((s: any, i: number) => `#${i + 1} [${s.source}${s.occurred_at ? ' · ' + String(s.occurred_at).slice(0, 10) : ''}] ${s.text}`).join('\n')
    : '\n\n(Geen context meegegeven — schrijf op basis van de beschrijving; markeer ontbrekende Legal Mind-specifieke feiten als "> TE BEVESTIGEN".)';
  const head = `${kbCategory ? `CATEGORIE: ${kbCategory}\n` : ''}TITEL (van de redacteur): ${title || '(geen — bedenk een goede titel)'}\n\nBESCHRIJVING (waar het artikel over moet gaan):\n${description || '(geen beschrijving — schrijf op basis van de titel)'}${ctxBlock}`;
  if (previousBody && instruction) {
    return `${head}\n\nEERDER GEGENEREERD ARTIKEL:\n${previousBody.slice(0, 7000)}\n\nBIJSTEL-INSTRUCTIE VAN DE REDACTEUR (verplicht volgen):\n${instruction}\n\nHerschrijf het artikel volgens de instructie.`;
  }
  return `${head}\n\nSchrijf één compleet, scanbaar klant-artikel dat dit dekt.`;
}

// ----------------------------------------------------------------------------
// Model-calls + embeddings
// ----------------------------------------------------------------------------
async function embedText(text: string): Promise<string> {
  const key = await getOpenAIKey();
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST', headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-large', input: (text || '').slice(0, 6000), dimensions: 3072 }),
  });
  if (!r.ok) throw new Error(`embed_${r.status}: ${(await r.text()).slice(0, 120)}`);
  const j = await r.json();
  const v = j.data?.[0]?.embedding;
  if (!Array.isArray(v) || v.length !== 3072) throw new Error('embed_bad_shape');
  return `[${v.join(',')}]`;
}
async function callModel(model: string, system: string, user: string, maxTokens: number, effort: string) {
  if (model.startsWith('claude')) return await callClaude(model, system, user, maxTokens);
  return await openaiChat(model, system, user, maxTokens, effort);
}
async function callClaude(model: string, system: string, user: string, maxTokens: number) {
  const apiKey = await getAnthropicKey();
  const r = await callAnthropic({
    supabase: sb, apiKey, model, max_tokens: maxTokens, system,
    messages: [{ role: 'user', content: user }],
    attribution: { edgeFunction: 'kb-compose', skillName: 'kb-compose' },
    timeout_ms: 90_000,
  });
  return { content: r.content || '', cost: r.cost_usd ?? 0 };
}
async function openaiChat(model: string, system: string, user: string, maxTokens: number, effort: string) {
  const key = await getOpenAIKey();
  const reqBody: any = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_object' }, max_completion_tokens: maxTokens };
  if (model.startsWith('gpt-5')) reqBody.reasoning_effort = effort || 'medium';
  const resp = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(reqBody) });
  if (!resp.ok) { const t = await resp.text(); throw new Error(`OpenAI ${model} ${resp.status}: ${t.slice(0, 200)}`); }
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  const pr = OPENAI_PRICING[model] ?? { input: 1.25, output: 10.0 };
  const cost = (usage.prompt_tokens * pr.input + usage.completion_tokens * pr.output) / 1_000_000;
  return { content: text || '', cost };
}

function parseJsonLoose(text: string): any {
  if (!text || !text.trim()) return { _parse_error: true };
  try { return JSON.parse(text); } catch { /* fall through */ }
  const t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch { /* */ } }
  const first = t.indexOf('{'); const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) { try { return JSON.parse(t.slice(first, last + 1)); } catch { /* */ } }
  return { _parse_error: true };
}
function json(b: any, s = 200) { return new Response(JSON.stringify(b, null, 2), { status: s, headers: CORS }); }
