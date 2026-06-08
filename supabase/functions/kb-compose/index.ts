// =============================================================================
// kb-compose — handmatige kennisbank-aanmaak met 2 varianten + context-zoeker.
//
//   USER-CALLABLE (verify_jwt: true). Dit is de ENIGE kb-* Edge Function die
//   door de browser wordt aangeroepen (Jelle klikt "Genereer 2 versies"), NIET
//   door pg_cron/server-to-server. De CLAUDE.md hard-rule "alle kb-* =
//   verify_jwt:false" geldt vanwege cron-bearers; die geldt hier NIET. Laat
//   verify_jwt op TRUE — de gateway-JWT-check beschermt deze (kostende) functie.
//
//   Flow:
//     1. (optioneel) context-zoeker → roept context-build aan (intent='search')
//        over de RAG-index als feitenbasis/grounding.
//     2. genereert TWEE varianten (beknopt vs. uitgebreid) volgens dezelfde
//        Content Standard + toon als de curator (kb_curator_config).
//   Slaat NIETS op — de UI publiceert de gekozen variant via RPC
//   create_kb_article. Provider-aware: claude* via centrale callAnthropic-
//   wrapper (logt in claude_api_calls), al het andere via OpenAI chat.
// =============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAnthropic } from "../_shared/anthropic-fetch.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const DEFAULT_USER = '0934ffef-f600-4e1c-90c3-9d9bda2e0e42';
const SKILL_VERSION = 'kb-compose-v1';

const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-5.4': { input: 2.50, output: 15.00 }, 'gpt-5.4-mini': { input: 0.75, output: 4.50 }, 'gpt-5.4-nano': { input: 0.15, output: 0.60 },
  'gpt-5.2': { input: 1.75, output: 14.00 }, 'gpt-5': { input: 1.25, output: 10.00 }, 'gpt-5-nano': { input: 0.20, output: 1.25 }, 'gpt-5-mini': { input: 0.75, output: 4.50 }, 'gpt-4.1-mini': { input: 0.40, output: 1.60 },
};
const VALID_TYPES = new Set(['how_to', 'beleid', 'referentie', 'troubleshooting', 'faq', 'besluit_rationale']);
const VALID_AUDIENCE = new Set(['intern', 'klant']);

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// De twee onderscheidende varianten waaruit Jelle kiest.
const VARIANTS = [
  { key: 'beknopt', label: 'Beknopt & direct', instr: 'VARIANT BEKNOPT: schrijf maximaal scanbaar — antwoord-eerst, kort, alleen de essentie. Korte zinnen en lijsten; geen uitweidingen.' },
  { key: 'uitgebreid', label: 'Uitgebreid & toelichtend', instr: 'VARIANT UITGEBREID: dek hetzelfde, maar met meer toelichting — voeg een concreet voorbeeld of stap-voor-stap toe waar dat helpt. Blijf scanbaar met koppen; geen wollig proza.' },
];

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
  const description = String(body.description || '').trim();
  const audience = VALID_AUDIENCE.has(body.audience) ? body.audience : 'intern';
  const kbCategory = body.kb_category || null;
  const articleType = VALID_TYPES.has(body.article_type) ? body.article_type : null;
  const useContext = body.use_context !== false;
  const userId = body.user_id || DEFAULT_USER;

  if (description.length < 10) return json({ ok: false, error: 'description_required', detail: 'Geef een beschrijving van minstens 10 tekens.' }, 400);

  const diag: any = { version: SKILL_VERSION, audience, use_context: useContext, cost_usd: 0, started_at: new Date().toISOString() };
  try {
    const cfg = await getConfig();
    const model = cfg.compose_model || cfg.draft_model || 'gpt-5.4-mini';
    diag.model = model;

    // STAP 1 — context-zoeker (optioneel) -----------------------------------
    let context: any = { used: false, count: 0, snippets: [], bundle_id: null };
    if (useContext) {
      try { context = await searchContext(description, audience); }
      catch (e: any) { context = { used: false, count: 0, snippets: [], bundle_id: null, error: (e?.message || String(e)).slice(0, 160) }; }
    }
    diag.context_count = context.count;

    // STAP 2 — twee varianten parallel --------------------------------------
    const system = buildComposeSystem(cfg, audience, articleType);
    const user = buildComposeUser(description, audience, kbCategory, articleType, context.snippets);
    const results = await Promise.all(VARIANTS.map(v => generateVariant(model, system, user, v)));
    const variants = results.map((r, i) => ({ key: VARIANTS[i].key, label: VARIANTS[i].label, ...r.draft, model }));
    diag.cost_usd = results.reduce((s, r) => s + (r.cost || 0), 0);
    diag.finished_at = new Date().toISOString();

    return json({ ok: true, variants, context, model, _diagnose: diag });
  } catch (e: any) {
    diag.error = (e?.message || String(e)).slice(0, 300);
    return json({ ok: false, error: 'unhandled', detail: diag.error, _diagnose: diag }, 500);
  }
});

// ----------------------------------------------------------------------------
// Context-zoeker — server-to-server naar context-build (RAG-index).
// ----------------------------------------------------------------------------
async function searchContext(query: string, audience: string) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/context-build`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_ROLE}`, 'apikey': SERVICE_ROLE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent: 'search', query_text: query, audience, options: { top_k: 8 } }),
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
// Prompt-bouwers — spiegelen de curator's Content Standard + toon + grounding.
// ----------------------------------------------------------------------------
const DRAFT_SCHEMA = 'Output UITSLUITEND geldige JSON, geen markdown-fences:\n{"title":"","summary":"","body":"","te_bevestigen":["open Legal Mind-feit dat ontbreekt"]}\n- body = markdown (## koppen, genummerde stappen, korte lijsten). summary = 1 zin. Ontbrekende Legal Mind-specifieke feiten: neem ze in de body op als blok dat begint met "> TE BEVESTIGEN door Jelle/CS:" met bullets, en noem ze ook in te_bevestigen. Verzin niets.';

function buildComposeSystem(cfg: Record<string, string>, audience: string, articleType: string | null): string {
  const aug = (cfg.augmentation_level || 'geassisteerd').toLowerCase();
  const augLine = aug.startsWith('strikt')
    ? 'Aanvul-niveau STRIKT: voeg GEEN algemene kennis toe; blijf strikt bij de beschrijving + meegegeven context.'
    : 'Aanvul-niveau GEASSISTEERD: veilige, universeel-ware algemene uitleg mag, kort en generiek — nooit Legal Mind-specifieke feiten verzinnen.';
  const tone = audience === 'klant' ? ('TOON (klant): ' + (cfg.tone_klant || '')) : ('TOON (intern): ' + (cfg.tone_intern || ''));
  return [
    cfg.generate_system || 'Je bent de kennisbank-curator van Legal Mind.',
    'Je schrijft ÉÉN kennisbank-artikel op basis van een BESCHRIJVING van de redacteur (Jelle) en optionele context uit de kennisbank/mailhistorie. Je bent een ghostwriter: maak er een goed artikel van, maar leg Legal Mind nooit feiten in de mond.',
    'CONTENT STANDARD:\n' + (cfg.content_standard || ''),
    articleType ? `ARTIKELTYPE: ${articleType} — volg de gangbare opbouw voor dit type.` : '',
    'TITEL-STIJL: ' + (cfg.title_rules || ''),
    'GROUNDING:\n' + (cfg.grounding_rules || '') + '\n' + augLine,
    tone,
    DRAFT_SCHEMA,
  ].filter(Boolean).join('\n\n');
}

function buildComposeUser(description: string, audience: string, kbCategory: string | null, articleType: string | null, snippets: any[]): string {
  const ctxBlock = (snippets && snippets.length)
    ? '\n\nCONTEXT UIT DE KENNISBANK/MAILHISTORIE (feitenbasis — gebruik wat relevant is, verzin niets, negeer wat niet past):\n' +
      snippets.map((s: any, i: number) => `#${i + 1} [${s.source}${s.occurred_at ? ' · ' + String(s.occurred_at).slice(0, 10) : ''}] ${s.text}`).join('\n')
    : '\n\n(Geen context meegegeven — schrijf op basis van de beschrijving; markeer ontbrekende Legal Mind-specifieke feiten als "> TE BEVESTIGEN".)';
  return `DOELGROEP: ${audience}${kbCategory ? `\nCATEGORIE: ${kbCategory}` : ''}\n\nBESCHRIJVING VAN DE REDACTEUR (waar het artikel over moet gaan):\n${description}${ctxBlock}\n\nSchrijf één compleet, scanbaar kennisbank-artikel dat dit dekt.`;
}

async function generateVariant(model: string, system: string, user: string, variant: { key: string; instr: string }) {
  try {
    const r = await callModel(model, system + '\n\n' + variant.instr, user, 4000, 'medium');
    const a = parseJsonLoose(r.content);
    if (a._parse_error) return { draft: { title: '', summary: '', body: '(Genereren van deze variant mislukte — probeer opnieuw.)', te_bevestigen: [] }, cost: r.cost };
    return {
      draft: {
        title: (a.title || '').slice(0, 200),
        summary: (a.summary || '').slice(0, 500),
        body: (a.body || '').slice(0, 9000),
        te_bevestigen: Array.isArray(a.te_bevestigen) ? a.te_bevestigen.slice(0, 12) : [],
      }, cost: r.cost,
    };
  } catch (e: any) {
    return { draft: { title: '', summary: '', body: `(Fout: ${(e?.message || String(e)).slice(0, 120)})`, te_bevestigen: [] }, cost: 0 };
  }
}

// ----------------------------------------------------------------------------
// Model-calls — provider-aware (claude* via wrapper, anders OpenAI chat).
// ----------------------------------------------------------------------------
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
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) { try { return JSON.parse(fence[1].trim()); } catch { /* */ } }
  const first = t.indexOf('{'); const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) { try { return JSON.parse(t.slice(first, last + 1)); } catch { /* */ } }
  return { _parse_error: true };
}
function json(b: any, s = 200) { return new Response(JSON.stringify(b, null, 2), { status: s, headers: CORS }); }
