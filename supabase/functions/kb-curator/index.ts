// =============================================================================
// kb-curator v6 — Kennisbank 2.0: klant-only, lichte voorstellen, schrijf-op-akkoord.
//
//   generate  (goedkoop, gpt-5-mini + embeddings)
//             cluster klantvragen → per cluster een LICHT voorstel: titel +
//             beschrijving + categorie. GEEN artikel-body. Dedup vóór insert:
//             ≥0.80 vs bestaand artikel → signalen gekoppeld, geen voorstel;
//             ≥0.78 vs open pending-voorstel → samengevoegd;
//             0.60–0.78 → voorstel mét similar_info ("lijkt op …").
//             Daarna batch-triage (park casuïstiek) + batch-impact (sortering).
//   write     (premium, cfg.write_model → Claude via centrale wrapper)
//             schrijft het artikel ALLEEN voor status='accepted' voorstellen
//             (Jelle klikte "Maak dit artikel", evt. met generate_note).
//             → status 'written' (tab "Geschreven").
//   amend     herschrijft een 'amended' (finetune-instructie) → terug 'written'.
//   work      = write + amend in één call (voor de */15-cron).
//
// Audience bestaat niet meer: alles is 'klant'. De v5-modes redraft/score/
// triage/topicize/topics_sync/route/consolidate zijn vervallen — dedup gebeurt
// nu vóór het schrijven, niet erna.
//
// Auth: verify_jwt=false (cron) → interne check: Bearer = cron_secret of
// service_role. Anthropic-calls verplicht via _shared/anthropic-fetch.ts.
// Alle knoppen editbaar in kb_curator_config.
// =============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAnthropic } from "../_shared/anthropic-fetch.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CLUSTER_MODEL = Deno.env.get('KB_CLUSTER_MODEL') ?? 'gpt-5-mini';
const DEFAULT_USER = '0934ffef-f600-4e1c-90c3-9d9bda2e0e42';
const SKILL_VERSION = 'kb-curator-v6';

const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-5.4': { input: 2.50, output: 15.00 }, 'gpt-5.4-mini': { input: 0.75, output: 4.50 }, 'gpt-5.4-nano': { input: 0.15, output: 0.60 },
  'gpt-5.2': { input: 1.75, output: 14.00 }, 'gpt-5': { input: 1.25, output: 10.00 }, 'gpt-5-nano': { input: 0.20, output: 1.25 }, 'gpt-5-mini': { input: 0.75, output: 4.50 }, 'gpt-4.1-mini': { input: 0.40, output: 1.60 },
};
const VALID_TYPES = new Set(['how_to', 'beleid', 'referentie', 'troubleshooting', 'faq', 'besluit_rationale']);
const MAX_SIGNALS_PER_DRAFT = 14;

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

let CACHED_OPENAI: string | null = null;
let CACHED_ANTHROPIC: string | null = null;
let CACHED_STYLE: string | null | undefined = undefined;
let CACHED_CRON_SECRET: string | null = null;

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
async function getConfig(): Promise<Record<string, string>> {
  const { data } = await sb.from('kb_curator_config').select('key,value');
  const m: Record<string, string> = {};
  for (const r of (data || [])) m[r.key] = r.value;
  return m;
}
// Compacte "stem van Legal Mind" uit het geleerde stijlprofiel — alles is klant.
async function getStyleDigest(userId: string): Promise<string> {
  if (CACHED_STYLE !== undefined) return CACHED_STYLE ?? '';
  const { data } = await sb.from('style_profiles').select('core_identity,never_do,tone_per_context').eq('user_id', userId).maybeSingle();
  if (!data) { CACHED_STYLE = ''; return ''; }
  const never: string[] = Array.isArray(data.never_do) ? data.never_do : [];
  const ext: any = (data.tone_per_context || {})?.extern_formeel;
  const parts: string[] = [];
  if (data.core_identity) parts.push('Stem (uit ~5.000 verzonden mails): ' + String(data.core_identity).slice(0, 450));
  if (ext?.kenmerken && Array.isArray(ext.kenmerken)) parts.push('Externe kenmerken: ' + ext.kenmerken.join(', '));
  if (never.length) parts.push('Nooit: ' + never.slice(0, 6).join('; '));
  CACHED_STYLE = parts.join('\n');
  return CACHED_STYLE;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!(await isAuthorized(req))) return json({ error: 'unauthorized' }, 401);
  const body: any = await req.json().catch(() => ({}));
  const userId = body.user_id ?? DEFAULT_USER;
  const mode = body.mode ?? 'generate';
  try {
    if (mode === 'write') return await runWrite(userId, Math.min(body.limit ?? 4, 8));
    if (mode === 'amend') return await runAmend(userId, Math.min(body.limit ?? 6, 12));
    if (mode === 'work') {
      const w: any = await (await runWrite(userId, 3)).json();
      const a: any = await (await runAmend(userId, 5)).json();
      return json({ ok: true, _diagnose: { mode: 'work', version: SKILL_VERSION, write: w._diagnose, amend: a._diagnose } });
    }
    return await runGenerate(userId, Math.min(body.limit ?? 22, 40), body.category ?? null);
  } catch (e: any) {
    return json({ error: 'unhandled', detail: (e?.message || String(e)).slice(0, 300) }, 500);
  }
});

// ----------------------------------------------------------------------------
// MODE: generate — cluster (mini) → LICHT voorstel + dedup + triage + impact
// ----------------------------------------------------------------------------
async function runGenerate(userId: string, limit: number, categoryParam: string | null) {
  const diag: any = { mode: 'generate', version: SKILL_VERSION, cluster_model: CLUSTER_MODEL, category: null, signals: 0, proposals: 0, covered: 0, merged: 0, parked: 0, dismissed: 0, cost_usd: 0, errors: [] as string[], samples: [] as any[], started_at: new Date().toISOString() };
  const cfg = await getConfig();
  const artThr = clamp01(parseFloat(cfg.dedup_article_threshold || '0.80'), 0.80);
  const propThr = clamp01(parseFloat(cfg.dedup_proposal_threshold || '0.78'), 0.78);
  const simFloor = clamp01(parseFloat(cfg.similar_floor || '0.60'), 0.60);

  const { data: rows, error } = await sb.rpc('kb_curator_fetch_batch', { p_user_id: userId, p_category: categoryParam, p_limit: limit });
  if (error) return json({ error: 'fetch_failed', detail: error.message }, 500);
  if (!rows || rows.length === 0) { diag.done = true; diag.finished_at = new Date().toISOString(); return json({ ok: true, _diagnose: diag }); }
  const category = rows[0].kb_category;
  diag.category = category; diag.signals = rows.length;

  // STAP 1 — goedkoop clusteren: titel + beschrijving per groep (geen body)
  const cl = await callOpenAI(buildClusterMessages(category, rows, cfg), 4500);
  diag.cost_usd += cl.cost;
  if (cl.parsed._parse_error || !Array.isArray(cl.parsed.clusters)) return json({ error: 'cluster_parse_failed', raw: cl.raw_text, _diagnose: diag }, 500);

  // STAP 2 — per cluster: embed → dedup → licht voorstel
  const usedIdx = new Set<number>();
  const newProposals: any[] = [];
  for (const c of cl.parsed.clusters) {
    const members = (Array.isArray(c.member_ids) ? c.member_ids : []).filter((i: any) => Number.isInteger(i) && i >= 0 && i < rows.length && !usedIdx.has(i));
    if (members.length === 0) continue;
    members.forEach((i: number) => usedIdx.add(i));
    const title = String(c.title || '(zonder titel)').slice(0, 200);
    const description = String(c.description || '').slice(0, 1200);
    const articleType = VALID_TYPES.has(c.article_type) ? c.article_type : null;
    const sigIds = members.map((i: number) => rows[i].signal_id);
    const mailIds = members.map((i: number) => rows[i].mail_id).filter(Boolean);
    try {
      const vec = await embedText(`${title}\n${description}`);
      // 2a — al gedekt door een bestaand artikel?
      const { data: am } = await sb.rpc('kb_match_articles', { p_embedding: vec, p_top: 3 });
      const bestArt = (am && am[0]) || null;
      if (bestArt && bestArt.sim >= artThr) {
        const sigRows = members.map((i: number) => ({
          user_id: userId, article_id: bestArt.article_id, mail_id: rows[i].mail_id || null,
          question_signal_id: rows[i].signal_id, signal_kind: 'covered',
          generalizable: rows[i].generalizable, similarity: bestArt.sim,
          note: `generate v6: vraag al gedekt door artikel "${String(bestArt.title).slice(0, 120)}"`,
        }));
        await sb.from('kb_article_signals').insert(sigRows);
        await sb.from('kb_question_signals').update({ status: 'article_proposed' }).in('id', sigIds);
        diag.covered++;
        continue;
      }
      // 2b — lijkt op een open pending-voorstel? → samenvoegen
      const { data: pm } = await sb.rpc('kb_match_proposals', { p_embedding: vec, p_top: 3, p_exclude: null });
      const bestProp = (pm || []).find((m: any) => m.status === 'pending');
      if (bestProp && bestProp.sim >= propThr) {
        const { data: target } = await sb.from('kb_article_proposals')
          .select('id,source_signal_ids,source_mail_ids,source_from,source_to,evidence')
          .eq('id', bestProp.proposal_id).eq('status', 'pending').maybeSingle();
        if (target) {
          const sigUnion = Array.from(new Set([...(target.source_signal_ids || []), ...sigIds]));
          const mailUnion = Array.from(new Set([...(target.source_mail_ids || []), ...mailIds]));
          const recv = members.map((i: number) => rows[i].received_at).filter(Boolean).sort();
          const nThreads = await countThreads(sigUnion);
          await sb.from('kb_article_proposals').update({
            source_signal_ids: sigUnion, source_mail_ids: mailUnion,
            source_from: minDate(target.source_from, recv[0]), source_to: maxDate(target.source_to, recv[recv.length - 1]),
            evidence: { vragen: sigUnion.length, answered: !!(target.evidence?.answered) || members.some((i: number) => rows[i].answer_status === 'answered'), merged_in: ((target.evidence?.merged_in || 0) + 1) },
            distinct_threads: nThreads, impact: null, impact_score: null, impact_at: null,
          }).eq('id', target.id).eq('status', 'pending');
          await sb.from('kb_question_signals').update({ status: 'clustered', cluster_id: target.id }).in('id', sigIds);
          diag.merged++;
          continue;
        }
      }
      // 2c — nieuw licht voorstel (mét "lijkt op"-informatie)
      const similar = {
        articles: (am || []).filter((m: any) => m.sim >= simFloor).map((m: any) => ({ id: m.article_id, title: m.title, sim: round2(m.sim) })),
        proposals: (pm || []).filter((m: any) => m.sim >= simFloor).map((m: any) => ({ id: m.proposal_id, title: m.title, sim: round2(m.sim) })),
      };
      const recv = members.map((i: number) => rows[i].received_at).filter(Boolean).sort();
      const nThreads = await countThreads(sigIds);
      const row = {
        user_id: userId, proposal_kind: 'create', kb_category: category,
        title, description, proposed_body: null, proposed_summary: null,
        article_type: articleType, audience: 'klant',
        rationale: String(c.rationale || '').slice(0, 500),
        source_signal_ids: sigIds, source_mail_ids: mailIds,
        source_from: recv[0] ?? null, source_to: recv[recv.length - 1] ?? null,
        evidence: { vragen: members.length, answered: members.some((i: number) => rows[i].answer_status === 'answered') },
        confidence: typeof c.confidence === 'number' ? c.confidence : 0.7,
        status: 'pending', distinct_threads: nThreads,
        similar_info: (similar.articles.length || similar.proposals.length) ? similar : null,
        embedding: vec, embedded_at: new Date().toISOString(),
      };
      const { data: ins, error: e2 } = await sb.from('kb_article_proposals').insert(row).select('id').single();
      if (e2) { diag.errors.push(`insert: ${e2.message.slice(0, 80)}`); continue; }
      await sb.from('kb_question_signals').update({ status: 'clustered', cluster_id: ins.id }).in('id', sigIds);
      newProposals.push({
        id: ins.id, title, description, kb_category: category, article_type: articleType,
        distinct_threads: nThreads, n_signals: members.length,
        n_generalizable: members.filter((i: number) => rows[i].generalizable !== false).length,
      });
      diag.proposals++;
      if (diag.samples.length < 10) diag.samples.push({ title, threads: nThreads, similar: (similar.articles.length + similar.proposals.length) });
    } catch (e: any) { diag.errors.push(`cluster: ${(e?.message || '').slice(0, 90)}`); }
  }

  // niet-geclusterde signalen → dismissed (triviale/losse vragen)
  const unused = rows.filter((_: any, i: number) => !usedIdx.has(i)).map((r: any) => r.signal_id);
  if (unused.length) { await sb.from('kb_question_signals').update({ status: 'dismissed' }).in('id', unused).eq('status', 'new'); diag.dismissed = unused.length; }

  // STAP 3 — batch-triage (park casuïstiek) + batch-impact, op de verse set
  if (newProposals.length) {
    if ((cfg.triage_enabled || 'aan').toLowerCase() === 'aan') {
      const t = await triageRows(newProposals, cfg);
      diag.parked = t.parked; diag.cost_usd += t.cost;
      if (t.errors.length) diag.errors.push(...t.errors.slice(0, 2));
    }
    const kept = newProposals.filter(p => !p._parked);
    if (kept.length && (cfg.impact_enabled || 'aan').toLowerCase() === 'aan') {
      const s = await scoreRows(kept, cfg);
      diag.impact_scored = s.scored; diag.cost_usd += s.cost;
      if (s.errors.length) diag.errors.push(...s.errors.slice(0, 2));
    }
  }
  diag.done = rows.length < limit;
  diag.finished_at = new Date().toISOString();
  return json({ ok: true, _diagnose: diag });
}

// ----------------------------------------------------------------------------
// MODE: write — schrijf het artikel ná Jelle's akkoord (premium, via wrapper)
// ----------------------------------------------------------------------------
async function runWrite(userId: string, limit: number) {
  const diag: any = { mode: 'write', version: SKILL_VERSION, written: 0, needs_review: 0, cost_usd: 0, errors: [] as string[], samples: [] as any[], started_at: new Date().toISOString() };
  const cfg = await getConfig();
  const model = cfg.write_model || 'claude-sonnet-4-6';
  diag.model = model;
  const { data: rows, error } = await sb.rpc('kb_curator_fetch_writes', { p_user_id: userId, p_limit: limit });
  if (error) return json({ error: 'fetch_failed', detail: error.message, _diagnose: diag }, 500);
  if (!rows || rows.length === 0) { diag.done = true; diag.finished_at = new Date().toISOString(); return json({ ok: true, _diagnose: diag }); }

  const styleDigest = (cfg.style_voice_klant || 'aan').toLowerCase() === 'aan' ? await getStyleDigest(userId) : '';
  for (const p of rows) {
    try {
      const sigs = await fetchSignals(p.source_signal_ids);
      const system = buildWriteSystem(cfg, p.article_type, styleDigest);
      const user = buildWriteUser(p, sigs);
      const r = await callModel(model, system, user, 4500, 'medium');
      diag.cost_usd += r.cost;
      const a = parseJsonLoose(r.content);
      if (a._parse_error) { diag.errors.push(`${shortId(p.id)}: parse`); continue; }
      const draft = { title: a.title, summary: a.summary, body: a.body };
      const qa = await maybeQA(cfg, draft, sigs, p.kb_category);
      diag.cost_usd += qa.cost; if (qa.needs_review) diag.needs_review++;
      const { error: e2 } = await sb.from('kb_article_proposals').update({
        title: (a.title || p.title).slice(0, 200),
        proposed_body: (a.body || '').slice(0, 9000),
        proposed_summary: (a.summary || '').slice(0, 500),
        status: 'written', written_at: new Date().toISOString(), manual_run_requested_at: null,
        drafted_model: model, restyled_at: new Date().toISOString(),
        needs_review: qa.needs_review, qa_notes: qa.notes,
      }).eq('id', p.id).eq('status', 'accepted');
      if (e2) { diag.errors.push(`${shortId(p.id)}: ${e2.message.slice(0, 60)}`); continue; }
      diag.written++;
      if (diag.samples.length < 8) diag.samples.push({ id: p.id, title: (a.title || p.title).slice(0, 90), needs_review: qa.needs_review });
    } catch (e: any) { diag.errors.push(`${shortId(p.id)}: ${(e?.message || '').slice(0, 90)}`); }
  }
  diag.done = rows.length < limit;
  diag.finished_at = new Date().toISOString();
  return json({ ok: true, _diagnose: diag });
}

// ----------------------------------------------------------------------------
// MODE: amend — finetune-instructie op een geschreven artikel → terug 'written'
// ----------------------------------------------------------------------------
async function runAmend(userId: string, limit: number) {
  const diag: any = { mode: 'amend', version: SKILL_VERSION, processed: 0, needs_review: 0, cost_usd: 0, errors: [] as string[], started_at: new Date().toISOString() };
  const cfg = await getConfig();
  const model = cfg.write_model || 'claude-sonnet-4-6';
  const { data: rows, error } = await sb.rpc('kb_curator_fetch_amends', { p_user_id: userId, p_limit: limit });
  if (error) return json({ error: 'fetch_failed', detail: error.message }, 500);
  if (!rows || rows.length === 0) { diag.done = true; diag.finished_at = new Date().toISOString(); return json({ ok: true, _diagnose: diag }); }
  for (const p of rows) {
    try {
      const r = await callModel(model, buildAmendSystem(cfg, p.article_type), buildAmendUser(p), 4500, 'medium');
      diag.cost_usd += r.cost;
      const a = parseJsonLoose(r.content);
      if (a._parse_error) { diag.errors.push(`${shortId(p.id)}: parse`); continue; }
      const qa = await maybeQA(cfg, { title: a.title, summary: a.summary, body: a.body }, [], p.kb_category);
      diag.cost_usd += qa.cost; if (qa.needs_review) diag.needs_review++;
      await sb.from('kb_article_proposals').update({
        title: (a.title || p.title).slice(0, 200), proposed_body: (a.body || p.proposed_body).slice(0, 9000), proposed_summary: (a.summary || p.proposed_summary || '').slice(0, 500),
        status: 'written', written_at: new Date().toISOString(), manual_run_requested_at: null,
        drafted_model: model, restyled_at: new Date().toISOString(), needs_review: qa.needs_review, qa_notes: qa.notes,
      }).eq('id', p.id);
      diag.processed++;
    } catch (e: any) { diag.errors.push(`${shortId(p.id)}: ${(e?.message || '').slice(0, 80)}`); }
  }
  diag.finished_at = new Date().toISOString();
  return json({ ok: true, _diagnose: diag });
}

// ----------------------------------------------------------------------------
// Triage + impact (batch, mini) — op titel + beschrijving, vóór het schrijven
// ----------------------------------------------------------------------------
async function triageRows(rows: any[], cfg: Record<string, string>): Promise<{ parked: number; cost: number; errors: string[] }> {
  const out = { parked: 0, cost: 0, errors: [] as string[] };
  const model = cfg.triage_model || 'gpt-5.4-mini';
  const map: Record<number, any> = {};
  try {
    const system = [
      'Je bent de poortwachter van het KLANT-help-center van Legal Mind. Bepaal per voorstel of dit een artikel is dat een professioneel help-center zou hebben (keep) of eenmalige casuïstiek / te smal / te triviaal (park).',
      cfg.triage_rubric || 'keep = herbruikbare klant-kennis met blijvende waarde; park = eenmalige casus, klant-specifieke uitzondering, te triviaal, of niets wat een klant ooit zou opzoeken.',
      'Output UITSLUITEND JSON: {"verdicts":[{"idx":0,"verdict":"keep|park","reason":"kort"}]} — exact één entry per #idx.',
    ].join('\n\n');
    const lines = rows.map((r: any, i: number) => `#${i} [${r.kb_category} · threads ${r.distinct_threads}]\n   TITEL: ${r.title}\n   BESCHRIJVING: ${(r.description || '').slice(0, 220)}`);
    const r = await callModel(model, system, `Trieer deze ${rows.length} voorstellen:\n${lines.join('\n')}`, 2200, 'low');
    out.cost += r.cost;
    const parsed = parseJsonLoose(r.content);
    if (Array.isArray(parsed.verdicts)) for (const v of parsed.verdicts) if (Number.isInteger(v.idx)) map[v.idx] = v;
  } catch (e: any) { out.errors.push(`triage-llm: ${(e?.message || '').slice(0, 80)}`); }
  for (let i = 0; i < rows.length; i++) {
    const v = map[i];
    const park = v && String(v.verdict || '').toLowerCase().startsWith('park');
    const reason = String((v && v.reason) || (park ? 'casuïstiek/te smal' : 'herbruikbaar')).slice(0, 300);
    const upd: any = { scope_verdict: park ? 'park' : 'keep', scope_reason: reason, triaged_at: new Date().toISOString() };
    if (park) upd.status = 'parked';
    const { error } = await sb.from('kb_article_proposals').update(upd).eq('id', rows[i].id).eq('status', 'pending');
    if (error) { out.errors.push(`${shortId(rows[i].id)}: ${error.message.slice(0, 50)}`); continue; }
    if (park) { rows[i]._parked = true; out.parked++; }
  }
  return out;
}

async function scoreRows(rows: any[], cfg: Record<string, string>): Promise<{ scored: number; cost: number; errors: string[] }> {
  const out = { scored: 0, cost: 0, errors: [] as string[] };
  const model = cfg.impact_model || 'gpt-5.4-mini';
  const map: Record<number, any> = {};
  try {
    const system = [
      'Je beoordeelt het BELANG/de IMPACT van kennisbank-artikel-voorstellen voor het KLANT-help-center van Legal Mind, zodat de reviewer op belang kan sorteren.',
      cfg.impact_rubric || 'Hoog = raakt het product/elke klant of komt terug; midden = nuttig maar smal; laag = randgeval.',
      'Output UITSLUITEND JSON: {"scores":[{"idx":0,"impact":"hoog|midden|laag","score":0.0,"reason":"kort"}]} — exact één entry per #idx, score tussen 0 en 1.',
    ].join('\n\n');
    const lines = rows.map((r: any, i: number) => `#${i} [${r.kb_category} · ${r.article_type || '?'}] threads=${r.distinct_threads} signalen=${r.n_signals} generaliseerbaar=${r.n_generalizable}/${r.n_signals}\n   TITEL: ${r.title}\n   BESCHRIJVING: ${(r.description || '').slice(0, 200)}`);
    const r = await callModel(model, system, `Beoordeel deze ${rows.length} voorstellen:\n${lines.join('\n')}`, 2200, 'low');
    out.cost += r.cost;
    const parsed = parseJsonLoose(r.content);
    if (Array.isArray(parsed.scores)) for (const sc of parsed.scores) if (Number.isInteger(sc.idx)) map[sc.idx] = sc;
  } catch (e: any) { out.errors.push(`impact-llm: ${(e?.message || '').slice(0, 80)}`); }
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]; const sc = map[i];
    let impact: string, score: number, reason: string;
    if (sc) {
      impact = normalizeImpact(sc.impact);
      score = typeof sc.score === 'number' ? Math.max(0, Math.min(1, sc.score)) : (impact === 'hoog' ? 0.8 : impact === 'laag' ? 0.3 : 0.55);
      reason = String(sc.reason || '').slice(0, 300);
    } else {
      const t = r.distinct_threads || 0;
      impact = t >= 4 ? 'hoog' : t >= 2 ? 'midden' : 'laag';
      score = t >= 4 ? 0.78 : t >= 2 ? 0.55 : 0.30;
      reason = `Deterministisch vangnet: ${t} thread(s).`;
    }
    const { error } = await sb.from('kb_article_proposals')
      .update({ impact, impact_score: score, impact_reason: reason, impact_at: new Date().toISOString() })
      .eq('id', r.id).eq('status', 'pending');
    if (error) { out.errors.push(`${shortId(r.id)}: ${error.message.slice(0, 50)}`); continue; }
    out.scored++;
  }
  return out;
}

// ----------------------------------------------------------------------------
// Prompt-bouwers
// ----------------------------------------------------------------------------
function buildClusterMessages(category: string, rows: any[], cfg: Record<string, string>) {
  const system = [
    cfg.generate_system || 'Je bent de kennisbank-curator van het klant-help-center van Legal Mind.',
    'Dit is de SORTEER-stap: je schrijft GEEN artikel. Je groepeert klantvragen die in de kern hetzelfde onderwerp dekken en je pitcht per groep het artikel dat dit zou beantwoorden. De doelgroep is ALTIJD de klant — een groep met alleen interne of partner-ruis laat je weg.',
    'Kwaliteit boven kwantiteit: laat losse, triviale of eenmalig-logistieke vragen WEG (niet noemen). Een vraag hoort in MAX één groep. Een groep van één vraag mag alleen als die overduidelijk help-center-waardig is.',
    'Per groep lever je een titel (zoals een klant zou zoeken, max ~70 tekens) en een BESCHRIJVING: 2-4 zinnen die concreet zeggen wat het artikel gaat behandelen en welke vragen het beantwoordt. De redacteur beslist op basis van die beschrijving of het artikel geschreven wordt — wees dus specifiek, niet wervend.',
    'Output UITSLUITEND JSON: {"clusters":[{"member_ids":[0,3],"title":"","description":"","article_type":"how_to|beleid|referentie|troubleshooting|faq|besluit_rationale","confidence":0.8,"rationale":"waarom deze groep, kort"}]}',
  ].join('\n\n');
  const lines = rows.map((r: any, i: number) => `#${i} [${r.answer_status}] ${r.canonical_question}` + (r.answer_text ? ' (antwoord aanwezig)' : ''));
  return [{ role: 'system', content: system }, { role: 'user', content: `CATEGORIE: ${category}\n\nKLANTVRAGEN (${rows.length}):\n${lines.join('\n')}` }];
}

const WRITE_SCHEMA = 'Output UITSLUITEND geldige JSON, geen markdown-fences:\n{"title":"","summary":"","body":""}\n- body = markdown volgens het skelet (## koppen, genummerde stappen, korte lijsten). summary = 1 zin. Ontbrekende Legal Mind-specifieke feiten: neem ze in de body op als blok dat begint met "> TE BEVESTIGEN door Jelle/CS:" met bullets. Verzin niets.';

function buildWriteSystem(cfg: Record<string, string>, articleType: string | null, styleDigest: string): string {
  const tmplKey = articleType ? `template_${articleType}` : '';
  const tmpl = (tmplKey && cfg[tmplKey]) ? cfg[tmplKey] : 'Skelet: antwoord-eerst, daarna detail met koppen en korte lijsten.';
  const aug = (cfg.augmentation_level || 'geassisteerd').toLowerCase();
  const augLine = aug.startsWith('strikt')
    ? 'Aanvul-niveau STRIKT: voeg GEEN algemene kennis toe; blijf strikt bij de meegegeven bron.'
    : 'Aanvul-niveau GEASSISTEERD: veilige, universeel-ware algemene uitleg mag, kort en generiek — nooit Legal Mind-specifieke feiten verzinnen.';
  return [
    cfg.generate_system || 'Je bent de kennisbank-curator van het klant-help-center van Legal Mind.',
    'Je schrijft nu ÉÉN kennisbank-artikel voor de KLANT. De redacteur heeft het voorstel (titel + beschrijving) al goedgekeurd — schrijf precies dát artikel. Je bent een ghostwriter: poets de vorm, maar leg Legal Mind nooit feiten in de mond.',
    'CONTENT STANDARD:\n' + (cfg.content_standard || ''),
    `SJABLOON (artikeltype ${articleType || 'algemeen'}):\n` + tmpl,
    'TITEL-STIJL: ' + (cfg.title_rules || ''),
    'GROUNDING:\n' + (cfg.grounding_rules || '') + '\n' + augLine,
    'TOON (klant): ' + (cfg.tone_klant || '') + (styleDigest ? '\n\nSCHRIJF IN DEZE STEM:\n' + styleDigest : ''),
    (cfg.golden_examples || '').trim() ? ('VOORBEELD-ARTIKEL(EN) ALS IJKPUNT (spiegel vorm + toon, niet de inhoud):\n' + cfg.golden_examples.trim()) : '',
    WRITE_SCHEMA,
  ].filter(Boolean).join('\n\n');
}

function buildWriteUser(p: any, sigs: any[]): string {
  const lines = sigs.map((s, i) => {
    let t = `#${i + 1} [${s.answer_status || '?'}${s.generalizable === false ? ', UITZONDERING' : ''}] VRAAG: ${s.canonical_question || ''}`;
    if (s.answer_text) t += `\n   ANTWOORD (bron, ons gegeven antwoord): ${String(s.answer_text).slice(0, 500)}`;
    return t;
  });
  const note = p.generate_note ? `\n\nAANWIJZING VAN DE REDACTEUR (verplicht volgen): ${p.generate_note}` : '';
  return `GOEDGEKEURD VOORSTEL\nTITEL: ${p.title}\nBESCHRIJVING (wat het artikel moet dekken):\n${p.description || '(geen beschrijving — schrijf op basis van titel en bronvragen)'}${note}\n\nBRON-VRAGEN (${sigs.length}) — dit is wat we ECHT uit de mailhistorie weten (feitenbasis):\n${lines.join('\n')}\n\nSchrijf het artikel dat dit voorstel belooft. Gebruik de bron als feitenbasis; algemeen-geldige uitleg mag (aanvul-niveau), maar Legal Mind-specifieke feiten die niet in de bron staan horen onder "> TE BEVESTIGEN".`;
}

function buildAmendSystem(cfg: Record<string, string>, articleType: string | null) {
  const tmplKey = articleType ? `template_${articleType}` : '';
  const tmpl = (tmplKey && cfg[tmplKey]) ? cfg[tmplKey] : '';
  return [
    'Je herschrijft een kennisbank-artikel voor de KLANT op basis van een instructie van de redacteur. Behoud bestaande feiten; pas alleen aan wat gevraagd wordt. Verzin geen nieuwe bedragen/procedures/feiten — ontbrekend feit -> "> TE BEVESTIGEN door Jelle/CS:".',
    'CONTENT STANDARD:\n' + (cfg.content_standard || ''),
    tmpl ? ('SJABLOON:\n' + tmpl) : '',
    'TITEL-STIJL: ' + (cfg.title_rules || ''),
    'TOON (klant): ' + (cfg.tone_klant || ''),
    WRITE_SCHEMA,
  ].filter(Boolean).join('\n\n');
}
function buildAmendUser(p: any) {
  return `INSTRUCTIE VAN REDACTEUR: ${p.amendment || ''}\n\nHUIDIGE TITEL: ${p.title || ''}\nHUIDIGE SAMENVATTING: ${p.proposed_summary || ''}\n\nHUIDIG ARTIKEL:\n${p.proposed_body || ''}`;
}

async function maybeQA(cfg: Record<string, string>, draft: any, sigs: any[], category: string): Promise<{ needs_review: boolean; notes: string | null; cost: number }> {
  if ((cfg.qa_enabled || 'aan').toLowerCase() !== 'aan') return { needs_review: false, notes: null, cost: 0 };
  const qaModel = cfg.qa_model || 'gpt-5-mini';
  try {
    const aug = (cfg.augmentation_level || 'geassisteerd').toLowerCase();
    const augNote = aug.startsWith('strikt')
      ? 'Aanvul-niveau STRIKT: alleen bronmateriaal; generieke toevoegingen zijn hier WEL een tekortkoming.'
      : 'Aanvul-niveau GEASSISTEERD: algemeen-geldige, veilige werkwijze/uitleg is TOEGESTAAN en is GEEN reden voor needs_review.';
    const system = `Je bent kwaliteitslezer van het klant-help-center van Legal Mind. Beoordeel tegen de Content Standard.\n\nCONTENT STANDARD:\n${cfg.content_standard || ''}\n\n${augNote}\n\nZet verdict op "needs_review" ALLEEN bij een ECHT probleem:\n(a) een VERZONNEN Legal Mind-SPECIFIEK feit (concreet bedrag, termijn, naam, e-mailadres, tool/leverancier of interne procedure) dat NIET in de bron staat én NIET onder "> TE BEVESTIGEN" is gezet;\n(b) duidelijke structuurfout (niet antwoord-eerst of geen logisch skelet), interne jargon/namen richting de klant, of een vage/ambtelijke titel.\nOutput UITSLUITEND JSON: {"verdict":"ok|needs_review","grounded":true,"scannable":true,"tone_ok":true,"title_ok":true,"issues":["alleen echte problemen, kort"]}`;
    const src = sigs.length
      ? sigs.map((s, i) => `#${i + 1} ${s.canonical_question || ''}${s.answer_text ? ` => ${String(s.answer_text).slice(0, 300)}` : ''}`).join('\n')
      : '(geen bron-signalen meegegeven; beoordeel vooral op interne consistentie + geen verzonnen specifieke feiten)';
    const user = `CATEGORIE: ${category}\n\nBRON (feitenbasis):\n${src}\n\nARTIKEL:\nTITEL: ${draft.title || ''}\nSAMENVATTING: ${draft.summary || ''}\nBODY:\n${String(draft.body || '').slice(0, 4000)}`;
    const r = await callModel(qaModel, system, user, 1500, 'low');
    const v = parseJsonLoose(r.content);
    if (v._parse_error) return { needs_review: false, notes: null, cost: r.cost };
    const issues = Array.isArray(v.issues) ? v.issues.filter(Boolean) : [];
    const needs = v.verdict === 'needs_review' || v.grounded === false || v.scannable === false || v.tone_ok === false || v.title_ok === false;
    return { needs_review: !!needs, notes: needs ? (issues.join(' · ').slice(0, 480) || 'QA: onvoldoende op de Content Standard') : null, cost: r.cost };
  } catch { return { needs_review: false, notes: null, cost: 0 }; }
}

// ----------------------------------------------------------------------------
// Data-helpers
// ----------------------------------------------------------------------------
async function fetchSignals(ids: string[] | null): Promise<any[]> {
  if (!ids || ids.length === 0) return [];
  const { data } = await sb.from('kb_question_signals').select('canonical_question,answer_text,answer_status,generalizable').in('id', ids.slice(0, MAX_SIGNALS_PER_DRAFT));
  return data || [];
}
async function countThreads(sigIds: string[]): Promise<number> {
  if (!sigIds.length) return 0;
  const { data } = await sb.from('kb_question_signals').select('conversation_id').in('id', sigIds.slice(0, 300));
  const set = new Set((data || []).map((s: any) => s.conversation_id).filter(Boolean));
  return set.size || 1;
}
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

// ----------------------------------------------------------------------------
// Model-calls — claude-* via de centrale callAnthropic-wrapper, rest via OpenAI
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
    attribution: { edgeFunction: 'kb-curator', skillName: 'kb-curator' },
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
async function callOpenAI(messages: any[], maxTokens: number) {
  const key = await getOpenAIKey();
  const reqBody: any = { model: CLUSTER_MODEL, messages, response_format: { type: 'json_object' }, max_completion_tokens: maxTokens };
  if (CLUSTER_MODEL.startsWith('gpt-5')) reqBody.reasoning_effort = 'minimal';
  const resp = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(reqBody) });
  if (!resp.ok) { const t = await resp.text(); throw new Error(`OpenAI ${CLUSTER_MODEL} ${resp.status}: ${t.slice(0, 200)}`); }
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  const pr = OPENAI_PRICING[CLUSTER_MODEL] ?? { input: 1.0, output: 5.0 };
  const cost = (usage.prompt_tokens * pr.input + usage.completion_tokens * pr.output) / 1_000_000;
  return { parsed: parseJsonLoose(text), cost, raw_text: text.slice(0, 400) };
}

// ----------------------------------------------------------------------------
// Kleine helpers
// ----------------------------------------------------------------------------
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
function normalizeImpact(s: any): string {
  const v = String(s || '').toLowerCase();
  if (v.startsWith('hoog') || v.startsWith('high')) return 'hoog';
  if (v.startsWith('laag') || v.startsWith('low')) return 'laag';
  return 'midden';
}
function clamp01(n: number, fallback: number) { return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback; }
function round2(n: number) { return Math.round(n * 100) / 100; }
function minDate(a: string | null, b: string | null) { if (!a) return b; if (!b) return a; return a < b ? a : b; }
function maxDate(a: string | null, b: string | null) { if (!a) return b; if (!b) return a; return a > b ? a : b; }
function shortId(id: string) { return String(id).slice(0, 8); }
function json(b: any, s = 200) { return new Response(JSON.stringify(b, null, 2), { status: s, headers: { 'Content-Type': 'application/json' } }); }
