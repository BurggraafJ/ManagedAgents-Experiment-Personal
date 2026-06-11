// =============================================================================
// kb-knowledge-extractor v4 — Kennisbank 2.0: KLANT-ONLY.
//
// Mineert kennisbank-materiaal uitsluitend uit KLANT-mailverkeer. De SQL-poort
// (kb_extraction_fetch_batch v2) filtert vóór elke LLM-call:
//   - alleen inbound mails van party_type customer/pilot/sales_lead/
//     sales_opvolging/onbekend
//   - eigen domeinen (legal-mind.nl + oude handelsnamen) hard eruit
//   - alle external_party_directory-domeinen/-mailadressen met skip_kb=true eruit
// De prompt draagt de klant-bril: interne proces-/beleidsvragen en
// partner-/leverancier-verkeer zijn NOOIT kb_worthy (vangnet bovenop SQL).
// Categorieën komen dynamisch uit kb_categories (active=true).
//
// Auth: verify_jwt=false (cron) → interne check: Bearer = cron_secret of
// service_role. Kosten: gpt-5-mini, reasoning low, bulk-insert, concurrency-cap.
// =============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const MODEL = Deno.env.get('KB_EXTRACTOR_MODEL') ?? 'gpt-5-mini';
const CONCURRENCY = Number(Deno.env.get('KB_EXTRACTOR_CONCURRENCY') ?? '6');
const DEFAULT_USER = '0934ffef-f600-4e1c-90c3-9d9bda2e0e42';
const SKILL_VERSION = 'kb-knowledge-extractor-v4';

const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-5-nano': { input: 0.20, output: 1.25 }, 'gpt-5-mini': { input: 0.75, output: 4.50 }, 'gpt-4.1-mini': { input: 0.40, output: 1.60 },
};
const VALID_ARTICLE_TYPES = new Set(['how_to', 'beleid', 'referentie', 'troubleshooting', 'faq', 'besluit_rationale']);
const VALID_ANSWER_STATUS = new Set(['answered', 'answer_needed', 'no_answer_expected']);

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
let CACHED_KEY: string | null = null;
let CACHED_CRON_SECRET: string | null = null;

async function getOpenAIKey(): Promise<string> {
  if (CACHED_KEY) return CACHED_KEY;
  const fromEnv = Deno.env.get('OPENAI_API_KEY');
  if (fromEnv) { CACHED_KEY = fromEnv; return fromEnv; }
  const { data, error } = await sb.rpc('get_openai_key_for_mail_enricher');
  if (error || !data) throw new Error('OpenAI key not available');
  CACHED_KEY = data as string; return CACHED_KEY;
}

// Interne auth: cron_secret (pg_cron) of service_role (server-to-server).
async function isAuthorized(req: Request): Promise<boolean> {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  if (token === SERVICE_ROLE) return true;
  if (!CACHED_CRON_SECRET) {
    const { data } = await sb.rpc('get_skill_secret_service', { p_skill_name: 'global', p_secret_name: 'cron_secret' });
    CACHED_CRON_SECRET = (data as string) || null;
  }
  return !!CACHED_CRON_SECRET && token === CACHED_CRON_SECRET;
}

async function getActiveCategories(): Promise<{ id: string; label: string; description: string | null }[]> {
  const { data } = await sb.from('kb_categories').select('id,label,description').eq('active', true).order('sort_order');
  return data || [];
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const ret: R[] = new Array(items.length); let i = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: n }, async () => {
    while (true) { const idx = i++; if (idx >= items.length) break;
      try { ret[idx] = await fn(items[idx], idx); } catch (e: any) { ret[idx] = ({ __error: (e?.message ?? String(e)).slice(0, 200) } as unknown as R); } }
  });
  await Promise.all(workers); return ret;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!(await isAuthorized(req))) return json({ error: 'unauthorized' }, 401);
  const body: any = await req.json().catch(() => ({}));
  const userId = body.user_id ?? DEFAULT_USER;
  const limit = Math.min(body.limit ?? 12, 40);
  const dryRun = body.dry_run ?? false;
  const version = body.extractor_version ?? 'v2';
  const diag: any = { version: SKILL_VERSION, model: MODEL, concurrency: CONCURRENCY, limit, extractor_version: version, candidates: 0, inserted: 0, kb_worthy: 0, answered: 0, dismissed: 0, failed: 0, total_cost_usd: 0, errors: [] as string[], started_at: new Date().toISOString() };

  const { data: cands, error: fErr } = await sb.rpc('kb_extraction_fetch_batch', { p_user_id: userId, p_limit: limit, p_extractor_version: version });
  if (fErr) return json({ error: 'fetch_failed', detail: fErr.message }, 500);
  diag.candidates = cands?.length ?? 0;
  if (!cands || cands.length === 0) { diag.done = true; diag.finished_at = new Date().toISOString(); return json({ ok: true, _diagnose: diag }); }

  const cats = await getActiveCategories();
  const catIds = new Set(cats.map(c => c.id));
  const built = await mapLimit(cands, CONCURRENCY, (c: any) => buildRow(c, userId, version, cats, catIds, diag));
  const rows = built.filter((r: any) => r && r.__row).map((r: any) => r.__row);
  built.filter((r: any) => r && r.__error).forEach((r: any) => { diag.failed++; if (diag.errors.length < 5) diag.errors.push(r.__error); });
  if (!dryRun && rows.length) {
    const { error } = await sb.from('kb_question_signals').upsert(rows, { onConflict: 'mail_id,extractor_version', ignoreDuplicates: true });
    if (error) return json({ error: 'bulk_insert_failed', detail: error.message, _diagnose: diag }, 500);
    diag.inserted = rows.length;
  }
  diag.done = (cands.length < limit);
  diag.finished_at = new Date().toISOString();
  return json({ ok: true, _diagnose: diag });
});

async function buildRow(c: any, userId: string, version: string, cats: any[], catIds: Set<string>, diag: any) {
  const llm = await callOpenAI(buildMessages(c, cats));
  const p = llm.parsed;
  if (p._parse_error) throw new Error(`parse: ${llm.raw_text?.slice(0, 80) ?? 'empty'}`);
  diag.total_cost_usd += llm.cost;
  const kbWorthy = !!p.kb_worthy;
  const cat = catIds.has(p.kb_category) ? p.kb_category : null;
  const atype = VALID_ARTICLE_TYPES.has(p.article_type) ? p.article_type : null;
  const astatus = VALID_ANSWER_STATUS.has(p.answer_status) ? p.answer_status : 'answer_needed';
  const conf = typeof p.confidence === 'number' ? p.confidence : 0.7;
  if (kbWorthy) diag.kb_worthy++; else diag.dismissed++;
  if (astatus === 'answered') diag.answered++;
  return { __row: {
    user_id: userId, mail_id: c.mail_id, conversation_id: c.conversation_id, received_at: c.received_at,
    canonical_question: (p.canonical_question ?? c.summary_one_line ?? '(geen)').slice(0, 1000),
    secondary_questions: Array.isArray(p.secondary_questions) ? p.secondary_questions.slice(0, 5) : [],
    question_lang: p.question_lang ?? null,
    answer_text: astatus === 'answered' ? (p.answer_text ?? null) : null,
    answer_mail_id: astatus === 'answered' ? (c.answer_mail_id ?? null) : null,
    answer_status: astatus,
    kb_category: kbWorthy ? cat : null, article_type: kbWorthy ? atype : null,
    generalizable: kbWorthy ? !!p.generalizable : false,
    party_type: c.party_type, topics: c.topics ?? [],
    confidence: conf, needs_review: conf < 0.6, extractor_version: version,
    status: (kbWorthy && cat) ? 'new' : 'dismissed',
  } };
}

async function callOpenAI(messages: any[]) {
  const key = await getOpenAIKey();
  const reqBody: any = { model: MODEL, messages, response_format: { type: 'json_object' }, max_completion_tokens: 2500 };
  if (MODEL.startsWith('gpt-5')) reqBody.reasoning_effort = 'low';
  const resp = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(reqBody) });
  if (!resp.ok) { const t = await resp.text(); throw new Error(`OpenAI ${MODEL} ${resp.status}: ${t.slice(0, 200)}`); }
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  const pr = PRICING[MODEL] ?? { input: 1.0, output: 5.0 };
  const cost = (usage.prompt_tokens * pr.input + usage.completion_tokens * pr.output) / 1_000_000;
  let parsed: any = {};
  if (!text || !text.trim()) parsed = { _parse_error: true };
  else { try { parsed = JSON.parse(text); } catch { parsed = { _parse_error: true }; } }
  return { parsed, cost, raw_text: text.slice(0, 300) };
}

function buildMessages(c: any, cats: any[]) {
  const catLines = cats.map(cat => `  - ${cat.id}: ${cat.label}${cat.description ? ` — ${cat.description}` : ''}`).join('\n');
  const system = `Je mineert materiaal voor de KLANT-kennisbank van Legal Mind (juridische SaaS). De kennisbank is een help-center vóór klanten: artikelen die een klant of toekomstige klant zelf zou opzoeken. Je krijgt een binnenkomende mail en mogelijk het ANTWOORD dat wij later in dezelfde thread gaven.

Output ALLEEN JSON:
{"kb_worthy":bool,"canonical_question":"","secondary_questions":[],"question_lang":"nl|en|de|fr|other","answer_status":"answered|answer_needed|no_answer_expected","answer_text":null,"kb_category":null,"article_type":"how_to|beleid|referentie|troubleshooting|faq|besluit_rationale|null","generalizable":bool,"confidence":0.0}

kb_worthy = true ALLEEN als aan ALLE drie voorwaarden is voldaan:
1. De afzender is een klant, pilot-gebruiker of (potentiële) klant — GEEN collega, partner, leverancier, recruiter of pers.
2. De mail bevat een echte vraag, hulpverzoek of storingsmelding over ons product, het gebruik ervan, facturatie, licenties, onboarding, privacy/beveiliging of een koppeling.
3. Het antwoord erop is herbruikbaar voor ANDERE klanten (een help-center-artikel waard).

kb_worthy = false bij: interne proces- of beleidsvragen; vragen van/over partners of leveranciers; sales-koetjes-en-kalfjes of puur commerciële onderhandeling zonder productvraag; puur sociaal/bedankje; eenmalige planning of logistiek; persoonlijke/administratieve mails; alles wat een klant nooit in een help-center zou zoeken. BIJ TWIJFEL of de afzender wel een klant is: kb_worthy=false.

- canonical_question: de KERNVRAAG of het kern-probleem, algemeen geformuleerd, ZONDER namen/bedrijven/PII, in het Nederlands. Een storing herformuleer je als vraag ("Wat te doen als inloggen niet lukt?").
- answer_status='answered' ALLEEN als het meegegeven ANTWOORD de vraag echt beantwoordt; anders answer_needed + answer_text=null.
- answer_text: het herbruikbare antwoord, opgeschoond (geen handtekening/PII), of null.
- kb_category: precies één van onderstaande categorie-ids, of null als niets past:
${catLines}
- generalizable: true = algemeen geldende kennis; false = klant-specifieke uitzondering.`;
  const user = `PARTY_TYPE: ${c.party_type}\nTOPICS: ${(c.topics ?? []).join(', ')}\nSUBJECT: ${c.subject ?? '(geen)'}\nSAMENVATTING: ${c.summary_one_line ?? ''}\n\n--- BINNENKOMENDE MAIL ---\n${c.question_text ?? ''}\n\n--- ANTWOORD-KANDIDAAT (onze latere reply in thread, kan irrelevant zijn) ---\n${c.answer_text ?? '(geen reply gevonden)'}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

function json(b: any, s = 200) { return new Response(JSON.stringify(b, null, 2), { status: s, headers: { 'Content-Type': 'application/json' } }); }
