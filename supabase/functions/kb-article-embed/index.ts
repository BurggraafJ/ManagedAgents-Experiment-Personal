// =============================================================================
// kb-article-embed — embedt gevalideerde kennisbank-artikelen in de RAG-stack.
//
// Dedicated chunk-writer voor source='kb_article' (precedent: chunker-meeting-v2).
// Maakt per gevalideerd/gepubliceerd kb_article één chunk (chunk_type='document')
// met text-embedding-3-large (halfvec 3072) zodat match_chunks / context-build /
// auto-draft het artikel kunnen citeren. Vult ook kb_articles.embedding (voor de
// toekomstige dedup-gate van de curator).
//
// Dirty-detectie: status IN ('gevalideerd','gepubliceerd') AND (embedded_at IS NULL
// OR embedded_at < updated_at). Nieuw artikel -> embedded_at NULL -> meteen mee.
// Bewerkt artikel -> updated_at > embedded_at -> volgende run mee.
//
// Triggering (zie migration kb_article_embed_triggers):
//   - AFTER INSERT op kb_articles (status gevalideerd/gepubliceerd) -> meteen (net.http_post)
//   - cron elke 4u (gated op dirty) -> batcht bewerkingen
// Idempotent: verwerkt alleen dirty, dus beide paden zijn veilig.
// =============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const EMBED_MODEL = 'text-embedding-3-large';
const EMBED_DIM = 3072;
const BATCH = 10;
const MAX_INPUT_CHARS = 8000;

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
let CACHED_KEY: string | null = null;

async function getOpenAIKey(): Promise<string> {
  if (CACHED_KEY) return CACHED_KEY;
  const { data } = await sb.rpc('get_skill_secret_service', { p_skill_name: 'openai', p_secret_name: 'embedding_key' });
  if (typeof data === 'string' && data.length > 0) { CACHED_KEY = data; return data; }
  const fb = await sb.rpc('get_openai_key_for_mail_enricher');
  if (fb.data) { CACHED_KEY = fb.data as string; return CACHED_KEY; }
  throw new Error('openai_key_unavailable');
}

function stripMd(s: string): string {
  return String(s || '').replace(/[`*#>_]/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1').replace(/\s+\n/g, '\n').trim();
}

async function embed(key: string, input: string): Promise<number[]> {
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST', headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input, dimensions: EMBED_DIM }),
  });
  if (!r.ok) throw new Error(`openai_embed_${r.status}: ${(await r.text()).slice(0, 160)}`);
  const j = await r.json();
  const v = j.data?.[0]?.embedding;
  if (!Array.isArray(v) || v.length !== EMBED_DIM) throw new Error('embed_bad_shape');
  return v;
}

Deno.serve(async (req) => {
  // Auth: cron_secret of service_role (zelfde patroon als de chunkers)
  const presented = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  let cronSecret: string | null = null;
  try { const { data } = await sb.rpc('get_skill_secret_service', { p_skill_name: 'global', p_secret_name: 'cron_secret' }); cronSecret = data as string; } catch { /* */ }
  if (!presented || (presented !== cronSecret && presented !== SERVICE_ROLE)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const body: any = await req.json().catch(() => ({}));
  const limit = Math.min(body.limit ?? BATCH, 25);
  const diag: any = { fn: 'kb-article-embed', embedded: 0, skipped: 0, cost_usd: 0, errors: [] as string[], started_at: new Date().toISOString() };

  // Dirty: gevalideerd/gepubliceerd + nog niet (of verouderd) geëmbed (RPC: column-vs-column kan niet in PostgREST)
  const { data: rows, error } = await sb.rpc('kb_articles_fetch_dirty', { p_limit: limit });
  if (error) return json({ error: 'fetch_failed', detail: error.message, _diagnose: diag }, 500);
  if (!rows || rows.length === 0) { diag.done = true; diag.finished_at = new Date().toISOString(); return json({ ok: true, _diagnose: diag }); }

  let key: string;
  try { key = await getOpenAIKey(); } catch (e: any) { return json({ error: 'key', detail: e?.message, _diagnose: diag }, 500); }

  // categorie-labels voor de prefix
  const { data: cats } = await sb.from('kb_categories').select('id,label');
  const catLabel: Record<string, string> = {};
  for (const c of (cats || [])) catLabel[c.id] = c.label;

  for (const a of rows) {
    try {
      const content = `${a.title}\n\n${stripMd(a.body)}`.slice(0, MAX_INPUT_CHARS);
      const aud = a.audience === 'intern' ? 'intern (werkinstructie)' : 'klant (extern)';
      const prefix = `Kennisbank-artikel "${a.title}" — categorie ${catLabel[a.kb_category] || a.kb_category}, type ${a.article_type || 'algemeen'}, doelgroep ${aud}.` + (a.summary ? ` ${stripMd(a.summary)}` : '');
      const contentWithContext = `${prefix}\n\n${content}`;
      const vec = await embed(key, contentWithContext.slice(0, MAX_INPUT_CHARS + 400));
      diag.cost_usd += (contentWithContext.length / 4) * 0.13 / 1_000_000; // ~tokens*prijs, ruwe schatting
      const vecStr = `[${vec.join(',')}]`;
      const occurred = a.last_verified_at || a.updated_at || a.created_at || new Date().toISOString();

      // schoon herinsert (chunks is append-only; bewerking => oude chunk weg)
      await sb.from('chunks').delete().eq('source', 'kb_article').eq('source_id', a.id);
      const { error: ce } = await sb.from('chunks').insert({
        source: 'kb_article', source_id: a.id, chunk_type: 'document', sequence: 0,
        content, content_with_context: contentWithContext,
        embedding: vecStr, embedded_at: new Date().toISOString(), embedding_model: EMBED_MODEL,
        occurred_at: occurred, entity_ids: [],
        metadata: { kb_category: a.kb_category, article_type: a.article_type, audience: a.audience, version: a.version },
      });
      if (ce) { diag.errors.push(`${String(a.id).slice(0, 8)}: chunk ${ce.message.slice(0, 80)}`); continue; }

      await sb.from('kb_articles').update({ embedding: vecStr, embedded_at: new Date().toISOString(), embedding_model: EMBED_MODEL }).eq('id', a.id);
      diag.embedded++;
    } catch (e: any) { diag.errors.push(`${String(a.id).slice(0, 8)}: ${(e?.message || '').slice(0, 100)}`); }
  }
  diag.done = rows.length < limit;
  diag.finished_at = new Date().toISOString();
  return json({ ok: true, _diagnose: diag });
});

function json(b: any, s = 200) { return new Response(JSON.stringify(b, null, 2), { status: s, headers: { 'Content-Type': 'application/json' } }); }
