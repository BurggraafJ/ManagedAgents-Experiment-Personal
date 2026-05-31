// =============================================================================
// kb-curator v5 — twee-staps schrijfkwaliteit voor Project Kennisbank.
//
//   GOEDKOPE PEN  (gpt-5-mini)  : clusteren + classificeren (welke vragen horen
//                                 samen, type/doelgroep) — hoog volume.
//   DURE PEN      (Claude, via _shared/anthropic-fetch.ts) : het ARTIKEL schrijven
//                                 met Content Standard + per-type sjabloon + toon
//                                 + grounding-beleid + klant-stem uit het
//                                 stijlprofiel — laag volume (~150 stuks).
//   QA            (Claude Haiku) : self-critique tegen de Content Standard;
//                                 onvoldoende -> needs_review-vlag op het voorstel.
//
// Modes:
//   generate    — cluster (mini) -> draft (premium) -> QA -> bulk-insert voorstellen
//   redraft     — herschrijf bestaande status='pending' voorstellen naar de
//                 Content Standard (resumable via restyled_at; raakt NOOIT
//                 approved/rejected/amended/superseded)
//   amend       — herschrijf één voorstel op instructie van de redacteur (premium)
//   consolidate — ontdubbel binnen één categorie (mini, alleen merge-groepen)
//
// Alle knoppen leven editbaar in kb_curator_config (/instellingen/kennisbank).
// Anthropic-calls verplicht via de centrale wrapper (logt in claude_api_calls).
// =============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callAnthropic } from "../_shared/anthropic-fetch.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CLUSTER_MODEL = Deno.env.get('KB_CLUSTER_MODEL') ?? 'gpt-5-mini';
const DEFAULT_USER = '0934ffef-f600-4e1c-90c3-9d9bda2e0e42';
const SKILL_VERSION = 'kb-curator-v5';

const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-5.4': { input: 2.50, output: 15.00 }, 'gpt-5.4-mini': { input: 0.75, output: 4.50 }, 'gpt-5.4-nano': { input: 0.15, output: 0.60 },
  'gpt-5.2': { input: 1.75, output: 14.00 }, 'gpt-5': { input: 1.25, output: 10.00 }, 'gpt-5-nano': { input: 0.20, output: 1.25 }, 'gpt-5-mini': { input: 0.75, output: 4.50 }, 'gpt-4.1-mini': { input: 0.40, output: 1.60 },
};
const VALID_TYPES = new Set(['how_to', 'beleid', 'referentie', 'troubleshooting', 'faq', 'besluit_rationale']);
const VALID_AUDIENCE = new Set(['intern', 'klant']);
const MAX_SIGNALS_PER_DRAFT = 12;

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

let CACHED_OPENAI: string | null = null;
let CACHED_ANTHROPIC: string | null = null;
let CACHED_STYLE: string | null | undefined = undefined;

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
// Compacte "stem van Legal Mind" uit het geleerde stijlprofiel (draft-style-laag),
// alleen voor klant-artikelen. Houdt het kort: identiteit + nooit-doen + extern-kenmerken.
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
  const body: any = await req.json().catch(() => ({}));
  const userId = body.user_id ?? DEFAULT_USER;
  const mode = body.mode ?? 'generate';
  try {
    if (mode === 'redraft') return await runRedraft(userId, Math.min(body.limit ?? 6, 12), body.category ?? null, !!body.redo, Array.isArray(body.proposal_ids) ? body.proposal_ids.slice(0, 12) : null);
    if (mode === 'amend') return await runAmend(userId, Math.min(body.limit ?? 8, 15));
    if (mode === 'score') return await runScore(userId, Math.min(body.limit ?? 10, 20), body.category ?? null, Array.isArray(body.proposal_ids) ? body.proposal_ids.slice(0, 20) : null);
    if (mode === 'triage') return await runTriage(userId, Math.min(body.limit ?? 12, 25), body.category ?? null, Array.isArray(body.proposal_ids) ? body.proposal_ids.slice(0, 25) : null);
    if (mode === 'topicize') return await runTopicize(userId, body.category ?? null, body.audience ?? null, Math.min(body.max_draft ?? 4, 8));
    if (mode === 'topics_sync') return await runTopicsSync(userId, Math.min(body.limit ?? 15, 30));
    if (mode === 'route') return await runRoute(userId, Math.min(body.limit ?? 20, 40));
    if (mode === 'consolidate') return await runConsolidate(userId, body.category ?? null);
    return await runGenerate(userId, Math.min(body.limit ?? 14, 30), body.category ?? null);
  } catch (e: any) {
    return json({ error: 'unhandled', detail: (e?.message || String(e)).slice(0, 300) }, 500);
  }
});

// ----------------------------------------------------------------------------
// MODE: redraft — herschrijf bestaande pending-voorstellen naar de Content Standard
// ----------------------------------------------------------------------------
async function runRedraft(userId: string, limit: number, categoryParam: string | null, redo: boolean, ids: string[] | null) {
  const diag: any = { mode: 'redraft', version: SKILL_VERSION, category: categoryParam, targeted: !!(ids && ids.length), processed: 0, needs_review: 0, cost_usd: 0, errors: [] as string[], samples: [] as any[], started_at: new Date().toISOString() };
  const cfg = await getConfig();
  const draftModel = cfg.draft_model || 'claude-sonnet-4-6';

  let q = sb.from('kb_article_proposals')
    .select('id,kb_category,title,proposed_body,proposed_summary,article_type,audience,source_signal_ids,confidence')
    .eq('user_id', userId).eq('status', 'pending');
  if (ids && ids.length) {
    q = q.in('id', ids).limit(ids.length);
  } else {
    if (!redo) q = q.is('restyled_at', null);
    if (categoryParam) q = q.eq('kb_category', categoryParam);
    q = q.order('created_at', { ascending: true }).limit(limit);
  }
  const { data: props, error } = await q;
  if (error) return json({ error: 'fetch_failed', detail: error.message, _diagnose: diag }, 500);
  if (!props || props.length === 0) { diag.done = true; diag.finished_at = new Date().toISOString(); return json({ ok: true, _diagnose: diag }); }

  for (const p of props) {
    try {
      const sigs = await fetchSignals(p.source_signal_ids);
      const draft = await draftArticle({ cfg, draftModel, category: p.kb_category, audience: p.audience, articleType: p.article_type, sigs, userId, currentBody: p.proposed_body });
      diag.cost_usd += draft.cost;
      const qa = await maybeQA(cfg, draft, sigs, p.audience, p.kb_category);
      diag.cost_usd += qa.cost;
      const upd: any = {
        title: (draft.title || p.title).slice(0, 200),
        proposed_body: (draft.body || p.proposed_body).slice(0, 8000),
        proposed_summary: (draft.summary || p.proposed_summary || '').slice(0, 500),
        drafted_model: draftModel, restyled_at: new Date().toISOString(),
        needs_review: qa.needs_review, qa_notes: qa.notes,
      };
      const { error: e2 } = await sb.from('kb_article_proposals').update(upd).eq('id', p.id).eq('status', 'pending');
      if (e2) { diag.errors.push(`${shortId(p.id)}: update ${e2.message.slice(0, 80)}`); continue; }
      diag.processed++; if (qa.needs_review) diag.needs_review++;
      if (diag.samples.length < 8) diag.samples.push({ id: p.id, audience: p.audience, type: p.article_type, title: upd.title, needs_review: qa.needs_review, qa: qa.notes });
    } catch (e: any) { diag.errors.push(`${shortId(p.id)}: ${(e?.message || '').slice(0, 100)}`); }
  }
  diag.done = (ids && ids.length) ? true : (props.length < limit);
  diag.finished_at = new Date().toISOString();
  return json({ ok: true, _diagnose: diag });
}

// ----------------------------------------------------------------------------
// MODE: generate — cluster (mini) -> draft (premium) -> QA -> bulk-insert
// ----------------------------------------------------------------------------
async function runGenerate(userId: string, limit: number, categoryParam: string | null) {
  const diag: any = { mode: 'generate', version: SKILL_VERSION, cluster_model: CLUSTER_MODEL, category: null, signals: 0, articles: 0, needs_review: 0, dismissed: 0, cost_usd: 0, errors: [] as string[], started_at: new Date().toISOString() };
  const cfg = await getConfig();
  const draftModel = cfg.draft_model || 'claude-sonnet-4-6';
  const { data: rows, error } = await sb.rpc('kb_curator_fetch_batch', { p_user_id: userId, p_category: categoryParam, p_limit: limit });
  if (error) return json({ error: 'fetch_failed', detail: error.message }, 500);
  if (!rows || rows.length === 0) { diag.done = true; diag.finished_at = new Date().toISOString(); return json({ ok: true, _diagnose: diag }); }
  const category = rows[0].kb_category;
  diag.category = category; diag.signals = rows.length;

  // STAP 1 — goedkoop clusteren/classificeren (geen body)
  const cl = await callOpenAI(buildClusterMessages(category, rows, cfg), 4000);
  diag.cost_usd += cl.cost;
  if (cl.parsed._parse_error || !Array.isArray(cl.parsed.clusters)) return json({ error: 'cluster_parse_failed', raw: cl.raw_text, _diagnose: diag }, 500);

  // STAP 2 — premium draft + QA per cluster
  const usedIdx = new Set<number>();
  const proposalRows: any[] = [];
  for (const c of cl.parsed.clusters) {
    const members = (Array.isArray(c.member_ids) ? c.member_ids : []).filter((i: any) => Number.isInteger(i) && i >= 0 && i < rows.length && !usedIdx.has(i));
    if (members.length === 0) continue;
    members.forEach((i: number) => usedIdx.add(i));
    const audience = VALID_AUDIENCE.has(c.audience) ? c.audience : 'intern';
    const articleType = VALID_TYPES.has(c.article_type) ? c.article_type : null;
    const sigs = members.map((i: number) => ({
      canonical_question: rows[i].canonical_question, answer_text: rows[i].answer_text,
      answer_status: rows[i].answer_status, generalizable: rows[i].generalizable,
    }));
    try {
      const draft = await draftArticle({ cfg, draftModel, category, audience, articleType, sigs, userId });
      diag.cost_usd += draft.cost;
      const qa = await maybeQA(cfg, draft, sigs, audience, category);
      diag.cost_usd += qa.cost;
      if (qa.needs_review) diag.needs_review++;
      const recv = members.map((i: number) => rows[i].received_at).filter(Boolean).sort();
      proposalRows.push({
        user_id: userId, proposal_kind: 'create', kb_category: category,
        title: (draft.title || '(zonder titel)').slice(0, 200), proposed_body: (draft.body || '').slice(0, 8000), proposed_summary: (draft.summary || '').slice(0, 500),
        article_type: articleType, audience,
        rationale: (c.rationale || '').slice(0, 500),
        source_signal_ids: members.map((i: number) => rows[i].signal_id),
        source_mail_ids: members.map((i: number) => rows[i].mail_id).filter(Boolean),
        source_from: recv[0] ?? null, source_to: recv[recv.length - 1] ?? null,
        evidence: { vragen: members.length, answered: members.some((i: number) => rows[i].answer_status === 'answered') },
        confidence: typeof c.confidence === 'number' ? c.confidence : 0.7, status: 'pending',
        drafted_model: draftModel, restyled_at: new Date().toISOString(), needs_review: qa.needs_review, qa_notes: qa.notes,
      });
    } catch (e: any) { diag.errors.push(`cluster ${members.join(',')}: ${(e?.message || '').slice(0, 80)}`); }
  }
  diag.articles = proposalRows.length;
  if (proposalRows.length) {
    const { data: ins, error: e2 } = await sb.from('kb_article_proposals').insert(proposalRows).select('id,source_signal_ids');
    if (e2) return json({ error: 'insert_failed', detail: e2.message, _diagnose: diag }, 500);
    for (const p of (ins || [])) await sb.from('kb_question_signals').update({ status: 'clustered', cluster_id: p.id }).in('id', p.source_signal_ids);
    // instroom-poort (triage: park eenmalige casus) + impact-score voor de nieuwe voorstellen
    try {
      const newIds = (ins || []).map((p: any) => p.id);
      if (newIds.length && (cfg.triage_enabled || 'aan').toLowerCase() === 'aan') {
        const tdiag: any = { kept: 0, parked: 0, fallback: 0, cost_usd: 0, errors: [] as string[] };
        const { data: trows } = await sb.rpc('kb_proposals_to_triage', { p_user_id: userId, p_limit: newIds.length, p_category: null, p_ids: newIds });
        if (trows && trows.length) await triageRows(trows, cfg, tdiag);
        diag.parked = tdiag.parked; diag.cost_usd += tdiag.cost_usd;
      }
      if (newIds.length && (cfg.impact_enabled || 'aan').toLowerCase() === 'aan') {
        const sdiag: any = { scored: 0, by_impact: {}, fallback: 0, cost_usd: 0, errors: [] as string[] };
        const { data: srows } = await sb.rpc('kb_proposals_to_score', { p_user_id: userId, p_limit: newIds.length, p_category: null, p_ids: newIds });
        if (srows && srows.length) await scoreRows(srows, cfg, sdiag);
        diag.impact_scored = sdiag.scored; diag.cost_usd += sdiag.cost_usd;
      }
    } catch (e: any) { diag.errors.push(`postproc: ${(e?.message || '').slice(0, 60)}`); }
  }
  const unused = rows.filter((_: any, i: number) => !usedIdx.has(i)).map((r: any) => r.signal_id);
  if (unused.length) { await sb.from('kb_question_signals').update({ status: 'dismissed' }).in('id', unused).eq('status', 'new'); diag.dismissed = unused.length; }
  diag.finished_at = new Date().toISOString();
  return json({ ok: true, _diagnose: diag });
}

// ----------------------------------------------------------------------------
// MODE: amend — herschrijf één voorstel op instructie van de redacteur (premium)
// ----------------------------------------------------------------------------
async function runAmend(userId: string, limit: number) {
  const diag: any = { mode: 'amend', version: SKILL_VERSION, processed: 0, needs_review: 0, cost_usd: 0, errors: [] as string[], started_at: new Date().toISOString() };
  const cfg = await getConfig();
  const draftModel = cfg.draft_model || 'claude-sonnet-4-6';
  const { data: rows, error } = await sb.rpc('kb_curator_fetch_amends', { p_user_id: userId, p_limit: limit });
  if (error) return json({ error: 'fetch_failed', detail: error.message }, 500);
  if (!rows || rows.length === 0) { diag.done = true; diag.finished_at = new Date().toISOString(); return json({ ok: true, _diagnose: diag }); }
  for (const p of rows) {
    try {
      const r = await callModel(draftModel, buildAmendSystem(cfg, p.article_type, p.audience), buildAmendUser(p), 4000, 'medium');
      diag.cost_usd += r.cost;
      const a = parseJsonLoose(r.content);
      if (a._parse_error) { diag.errors.push(`${shortId(p.id)}: parse`); continue; }
      const draft = { title: a.title, summary: a.summary, body: a.body, te_bevestigen: a.te_bevestigen };
      const qa = await maybeQA(cfg, draft, [], p.audience, p.kb_category);
      diag.cost_usd += qa.cost; if (qa.needs_review) diag.needs_review++;
      await sb.from('kb_article_proposals').update({
        title: (a.title || p.title).slice(0, 200), proposed_body: (a.body || p.proposed_body).slice(0, 8000), proposed_summary: (a.summary || p.proposed_summary || '').slice(0, 500),
        status: 'pending', manual_run_requested_at: null, drafted_model: draftModel, restyled_at: new Date().toISOString(), needs_review: qa.needs_review, qa_notes: qa.notes,
      }).eq('id', p.id);
      diag.processed++;
    } catch (e: any) { diag.errors.push(`${shortId(p.id)}: ${(e?.message || '').slice(0, 80)}`); }
  }
  diag.finished_at = new Date().toISOString();
  return json({ ok: true, _diagnose: diag });
}

// ----------------------------------------------------------------------------
// MODE: consolidate — ontdubbel binnen één categorie (mini, alleen merge-groepen)
// ----------------------------------------------------------------------------
async function runConsolidate(userId: string, category: string | null) {
  const diag: any = { mode: 'consolidate', version: SKILL_VERSION, cluster_model: CLUSTER_MODEL, category, proposals: 0, merges: 0, merged_away: 0, cost_usd: 0, errors: [] as string[], started_at: new Date().toISOString() };
  if (!category) return json({ error: 'category_required', _diagnose: diag }, 400);
  const { data: props, error } = await sb.from('kb_article_proposals').select('id,title,proposed_summary,confidence,source_signal_ids,source_mail_ids,source_from,source_to,evidence').eq('user_id', userId).eq('status', 'pending').eq('kb_category', category).order('confidence', { ascending: false });
  if (error) return json({ error: 'fetch_failed', detail: error.message }, 500);
  if (!props || props.length < 2) { diag.proposals = props?.length ?? 0; diag.done = true; diag.finished_at = new Date().toISOString(); return json({ ok: true, _diagnose: diag }); }
  diag.proposals = props.length;
  const llm = await callOpenAI(buildConsolidateMessages(category, props), 4000);
  diag.cost_usd = llm.cost;
  const parsed = llm.parsed;
  if (parsed._parse_error || !Array.isArray(parsed.merges)) return json({ error: 'parse_failed', raw: llm.raw_text, _diagnose: diag }, 500);
  const claimed = new Set<number>();
  for (const m of parsed.merges) {
    let idxs = (Array.isArray(m.members) ? m.members : []).filter((i: any) => Number.isInteger(i) && i >= 0 && i < props.length && !claimed.has(i));
    if (idxs.length < 2) continue;
    idxs = idxs.slice().sort((a: number, b: number) => a - b); idxs.forEach((i: number) => claimed.add(i));
    const primary = props[idxs[0]]; const others = idxs.slice(1).map((i: number) => props[i]);
    const sigUnion = Array.from(new Set(([] as any[]).concat(primary.source_signal_ids || [], ...others.map((o: any) => o.source_signal_ids || []))));
    const mailUnion = Array.from(new Set(([] as any[]).concat(primary.source_mail_ids || [], ...others.map((o: any) => o.source_mail_ids || []))));
    const froms = [primary, ...others].map((o: any) => o.source_from).filter(Boolean).sort();
    const tos = [primary, ...others].map((o: any) => o.source_to).filter(Boolean).sort();
    const anyAnswered = [primary, ...others].some((o: any) => o.evidence?.answered);
    await sb.from('kb_article_proposals').update({ title: (m.title || primary.title).slice(0, 200), source_signal_ids: sigUnion, source_mail_ids: mailUnion, source_from: froms[0] ?? primary.source_from, source_to: tos[tos.length - 1] ?? primary.source_to, evidence: { vragen: sigUnion.length, answered: !!anyAnswered, consolidated: idxs.length } }).eq('id', primary.id);
    const otherIds = others.map((o: any) => o.id);
    await sb.from('kb_article_proposals').update({ status: 'superseded', amendment: `auto-geconsolideerd in ${primary.id}` }).in('id', otherIds);
    await sb.from('kb_question_signals').update({ cluster_id: primary.id }).in('cluster_id', otherIds);
    diag.merges++; diag.merged_away += otherIds.length;
  }
  diag.finished_at = new Date().toISOString();
  return json({ ok: true, _diagnose: diag });
}

// ----------------------------------------------------------------------------
// Draft + QA core
// ----------------------------------------------------------------------------
async function fetchSignals(ids: string[] | null): Promise<any[]> {
  if (!ids || ids.length === 0) return [];
  const { data } = await sb.from('kb_question_signals').select('canonical_question,answer_text,answer_status,generalizable').in('id', ids.slice(0, MAX_SIGNALS_PER_DRAFT));
  return data || [];
}

async function draftArticle(opts: { cfg: Record<string, string>; draftModel: string; category: string; audience: string; articleType: string | null; sigs: any[]; userId: string; currentBody?: string; topicTitle?: string }) {
  const { cfg, draftModel, category, audience, articleType, sigs, userId, currentBody, topicTitle } = opts;
  const styleDigest = (audience === 'klant' && (cfg.style_voice_klant || 'aan').toLowerCase() === 'aan') ? await getStyleDigest(userId) : '';
  const system = await buildDraftSystem(cfg, articleType, audience, styleDigest, !!currentBody, topicTitle);
  const user = buildDraftUser(category, audience, sigs, currentBody, topicTitle);
  const r = await callModel(draftModel, system, user, topicTitle ? 8000 : 4000, topicTitle ? 'low' : 'medium');
  const a = parseJsonLoose(r.content);
  if (a._parse_error) throw new Error('draft_parse_failed');
  return { title: a.title || '', summary: a.summary || '', body: a.body || '', te_bevestigen: Array.isArray(a.te_bevestigen) ? a.te_bevestigen : [], cost: r.cost };
}

async function maybeQA(cfg: Record<string, string>, draft: any, sigs: any[], audience: string, category: string): Promise<{ needs_review: boolean; notes: string | null; cost: number }> {
  if ((cfg.qa_enabled || 'aan').toLowerCase() !== 'aan') return { needs_review: false, notes: null, cost: 0 };
  const qaModel = cfg.qa_model || 'gpt-5-mini';
  try {
    const r = await callModel(qaModel, buildQaSystem(cfg), buildQaUser(draft, sigs, audience, category), 1500, 'low');
    const v = parseJsonLoose(r.content);
    if (v._parse_error) return { needs_review: false, notes: null, cost: r.cost }; // QA mag de pipeline nooit blokkeren
    const issues = Array.isArray(v.issues) ? v.issues.filter(Boolean) : [];
    const needs = v.verdict === 'needs_review' || v.grounded === false || v.scannable === false || v.tone_ok === false || v.title_ok === false;
    return { needs_review: !!needs, notes: needs ? (issues.join(' · ').slice(0, 480) || 'QA: onvoldoende op de Content Standard') : null, cost: r.cost };
  } catch { return { needs_review: false, notes: null, cost: 0 }; }
}

// ----------------------------------------------------------------------------
// MODE: score — belang/impact per voorstel (hoog/midden/laag + 0-1 score).
// Combineert deterministische recurrence (distinct threads, via RPC) met een
// LLM-oordeel over reikwijdte (raakt het product/elke klant?). Batch per call.
// ----------------------------------------------------------------------------
function normalizeImpact(s: any): string {
  const v = String(s || '').toLowerCase();
  if (v.startsWith('hoog') || v.startsWith('high')) return 'hoog';
  if (v.startsWith('laag') || v.startsWith('low')) return 'laag';
  return 'midden';
}
function fallbackImpact(r: any): { impact: string; score: number; reason: string } {
  const t = r.distinct_threads || 0;
  if (t >= 4) return { impact: 'hoog', score: 0.78, reason: `Terugkerend over ${t} threads (deterministisch vangnet).` };
  if (t >= 2) return { impact: 'midden', score: 0.55, reason: `Over ${t} threads (deterministisch vangnet).` };
  return { impact: 'laag', score: 0.30, reason: 'Eén thread, dun signaal (deterministisch vangnet).' };
}
function buildImpactMessages(cfg: Record<string, string>, rows: any[]) {
  const system = [
    'Je beoordeelt het BELANG/de IMPACT van kennisbank-artikel-voorstellen van Legal Mind (juridische SaaS), zodat de reviewer op belang kan sorteren.',
    cfg.impact_rubric || 'Hoog = product/elke klant of terugkerend; midden = nuttig maar smal; laag = eenmalig/triviaal/één thread.',
    'Output UITSLUITEND JSON: {"scores":[{"idx":0,"impact":"hoog|midden|laag","score":0.0,"reason":"kort"}]} — exact één entry per #idx, score tussen 0 en 1.',
  ].join('\n\n');
  const lines = rows.map((r: any, i: number) =>
    `#${i} [doelgroep ${r.audience} · ${r.kb_category} · ${r.article_type || '?'}] threads=${r.distinct_threads} signalen=${r.n_signals} generaliseerbaar=${r.n_generalizable}/${r.n_signals}\n   TITEL: ${r.title}\n   SAMENVATTING: ${(r.proposed_summary || r.body_head || '').slice(0, 200)}`);
  return { system, user: `Beoordeel deze ${rows.length} voorstellen:\n${lines.join('\n')}` };
}

// Scoort een set RPC-rows (kb_proposals_to_score) — gedeeld door mode=score en generate.
async function scoreRows(rows: any[], cfg: Record<string, string>, diag: any) {
  const model = cfg.impact_model || 'gpt-5.4-mini';
  const scoreMap: Record<number, any> = {};
  try {
    const m = buildImpactMessages(cfg, rows);
    const r = await callModel(model, m.system, m.user, 2200, 'low');
    diag.cost_usd += r.cost;
    const parsed = parseJsonLoose(r.content);
    if (Array.isArray(parsed.scores)) for (const sc of parsed.scores) if (Number.isInteger(sc.idx)) scoreMap[sc.idx] = sc;
  } catch (e: any) { diag.errors.push(`llm: ${(e?.message || '').slice(0, 80)}`); }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]; const sc = scoreMap[i];
    let impact: string, score: number, reason: string;
    if (sc) {
      impact = normalizeImpact(sc.impact);
      score = typeof sc.score === 'number' ? Math.max(0, Math.min(1, sc.score)) : (impact === 'hoog' ? 0.8 : impact === 'laag' ? 0.3 : 0.55);
      reason = String(sc.reason || '').slice(0, 300);
    } else { const f = fallbackImpact(r); impact = f.impact; score = f.score; reason = f.reason; diag.fallback = (diag.fallback || 0) + 1; }
    const { error: ue } = await sb.from('kb_article_proposals')
      .update({ impact, impact_score: score, impact_reason: reason, distinct_threads: r.distinct_threads, impact_at: new Date().toISOString() })
      .eq('id', r.id).eq('status', 'pending');
    if (ue) { diag.errors.push(`${shortId(r.id)}: ${ue.message.slice(0, 60)}`); continue; }
    diag.scored++; diag.by_impact[impact] = (diag.by_impact[impact] || 0) + 1;
  }
}

async function runScore(userId: string, limit: number, categoryParam: string | null, ids: string[] | null) {
  const diag: any = { mode: 'score', version: SKILL_VERSION, scored: 0, by_impact: { hoog: 0, midden: 0, laag: 0 }, fallback: 0, cost_usd: 0, errors: [] as string[], started_at: new Date().toISOString() };
  const cfg = await getConfig();
  if ((cfg.impact_enabled || 'aan').toLowerCase() !== 'aan') { diag.skipped = 'impact_disabled'; diag.done = true; return json({ ok: true, _diagnose: diag }); }
  const { data: rows, error } = await sb.rpc('kb_proposals_to_score', { p_user_id: userId, p_limit: limit, p_category: categoryParam, p_ids: ids });
  if (error) return json({ error: 'fetch_failed', detail: error.message, _diagnose: diag }, 500);
  if (!rows || rows.length === 0) { diag.done = true; diag.finished_at = new Date().toISOString(); return json({ ok: true, _diagnose: diag }); }
  await scoreRows(rows, cfg, diag);
  diag.done = ids ? true : rows.length < limit;
  diag.finished_at = new Date().toISOString();
  return json({ ok: true, _diagnose: diag });
}

// ----------------------------------------------------------------------------
// MODE: triage — instroom-/schaal-poort. keep = herbruikbare KB-kennis blijft pending;
// park = eenmalige casus/buiten-scope -> status='parked' (uit de queue, omkeerbaar).
// ----------------------------------------------------------------------------
function buildTriageMessages(cfg: Record<string, string>, rows: any[]) {
  const system = [
    'Je bent de poortwachter van de Legal Mind kennisbank (klein team). Bepaal per voorstel of het HERBRUIKBARE KB-kennis is (keep) of een eenmalige casus/buiten-scope (park).',
    cfg.triage_rubric || 'keep = herbruikbaar product/sales/CS/SOP; park = eenmalige casus, deal-/aandelen-/financiële casuïstiek, te triviaal.',
    'Output UITSLUITEND JSON: {"verdicts":[{"idx":0,"verdict":"keep|park","reason":"kort"}]} — exact één entry per #idx.',
  ].join('\n\n');
  const lines = rows.map((r: any, i: number) =>
    `#${i} [doelgroep ${r.audience} · ${r.kb_category} · impact ${r.impact || '?'} · threads ${r.distinct_threads}]\n   TITEL: ${r.title}\n   SAMENVATTING: ${(r.proposed_summary || r.body_head || '').slice(0, 200)}`);
  return { system, user: `Trieer deze ${rows.length} voorstellen:\n${lines.join('\n')}` };
}

async function triageRows(rows: any[], cfg: Record<string, string>, diag: any) {
  const model = cfg.triage_model || 'gpt-5.4-mini';
  const map: Record<number, any> = {};
  try {
    const m = buildTriageMessages(cfg, rows);
    const r = await callModel(model, m.system, m.user, 2200, 'low');
    diag.cost_usd += r.cost;
    const parsed = parseJsonLoose(r.content);
    if (Array.isArray(parsed.verdicts)) for (const v of parsed.verdicts) if (Number.isInteger(v.idx)) map[v.idx] = v;
  } catch (e: any) { diag.errors.push(`llm: ${(e?.message || '').slice(0, 80)}`); }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]; const v = map[i];
    // Vangnet: bij ontbrekend/onduidelijk oordeel NIET parkeren (conservatief — blijft in de queue).
    const park = v && String(v.verdict || '').toLowerCase().startsWith('park');
    const reason = String((v && v.reason) || (park ? 'eenmalige casus/buiten-scope' : 'herbruikbaar')).slice(0, 300);
    if (!v) diag.fallback = (diag.fallback || 0) + 1;
    const upd: any = { scope_verdict: park ? 'park' : 'keep', scope_reason: reason, triaged_at: new Date().toISOString() };
    if (park) upd.status = 'parked';
    const { error: ue } = await sb.from('kb_article_proposals').update(upd).eq('id', r.id).eq('status', 'pending');
    if (ue) { diag.errors.push(`${shortId(r.id)}: ${ue.message.slice(0, 60)}`); continue; }
    if (park) diag.parked++; else diag.kept++;
  }
}

async function runTriage(userId: string, limit: number, categoryParam: string | null, ids: string[] | null) {
  const diag: any = { mode: 'triage', version: SKILL_VERSION, kept: 0, parked: 0, fallback: 0, cost_usd: 0, errors: [] as string[], started_at: new Date().toISOString() };
  const cfg = await getConfig();
  if ((cfg.triage_enabled || 'aan').toLowerCase() !== 'aan') { diag.skipped = 'triage_disabled'; diag.done = true; return json({ ok: true, _diagnose: diag }); }
  const { data: rows, error } = await sb.rpc('kb_proposals_to_triage', { p_user_id: userId, p_limit: limit, p_category: categoryParam, p_ids: ids });
  if (error) return json({ error: 'fetch_failed', detail: error.message, _diagnose: diag }, 500);
  if (!rows || rows.length === 0) { diag.done = true; diag.finished_at = new Date().toISOString(); return json({ ok: true, _diagnose: diag }); }
  await triageRows(rows, cfg, diag);
  diag.done = ids ? true : rows.length < limit;
  diag.finished_at = new Date().toISOString();
  return json({ ok: true, _diagnose: diag });
}

// ----------------------------------------------------------------------------
// MODE: topicize (Fase 2) — onderwerp-laag. Per categorie+doelgroep: (1) groepeer
// keeper-voorstellen tot onderwerpen (1 goedkope LLM-call), (2) draft per onderwerp
// ÉÉN comprehensive artikel met subvraag-secties (premium) + supersede de losse leden.
// Gebonden (maxDraft per call) + resumable via topic_group + topicized_at.
// ----------------------------------------------------------------------------
function slug(s: string): string {
  return String(s || 'onderwerp').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'onderwerp';
}
function buildTopicGroupMessages(cfg: Record<string, string>, rows: any[]) {
  const system = [
    'Je groepeert kennisbank-voorstellen tot ONDERWERPEN binnen één categorie + doelgroep.',
    cfg.topicize_rubric || 'Groepeer alles over hetzelfde onderwerp samen; wees ruim. Output {"topics":[{"members":[0,3],"topic_title":""}]}.',
  ].join('\n\n');
  const lines = rows.map((r: any, i: number) => `#${i} ${r.title}` + (r.proposed_summary ? ` — ${String(r.proposed_summary).slice(0, 110)}` : ''));
  return { system, user: `VOORSTELLEN (${rows.length}):\n${lines.join('\n')}` };
}

async function runTopicize(userId: string, category: string | null, audience: string | null, maxDraft: number) {
  const diag: any = { mode: 'topicize', version: SKILL_VERSION, category, audience, grouped: 0, topics_drafted: 0, superseded: 0, needs_review: 0, cost_usd: 0, errors: [] as string[], samples: [] as any[], started_at: new Date().toISOString() };
  const cfg = await getConfig();
  if ((cfg.topicize_enabled || 'aan').toLowerCase() !== 'aan') { diag.skipped = 'topicize_disabled'; diag.done = true; return json({ ok: true, _diagnose: diag }); }
  if (!category || !audience) return json({ error: 'category_and_audience_required', _diagnose: diag }, 400);
  const draftModel = cfg.draft_model || 'gpt-5.4-mini';
  const groupModel = cfg.impact_model || 'gpt-5.4-mini';

  const { data: rows, error } = await sb.from('kb_article_proposals')
    .select('id,title,proposed_summary,article_type,source_signal_ids,source_mail_ids,source_from,source_to,topic_group,topic_title')
    .eq('user_id', userId).eq('status', 'pending').eq('kb_category', category).eq('audience', audience).is('topicized_at', null)
    .limit(80);
  if (error) return json({ error: 'fetch_failed', detail: error.message, _diagnose: diag }, 500);
  if (!rows || rows.length === 0) { diag.done = true; diag.finished_at = new Date().toISOString(); return json({ ok: true, _diagnose: diag }); }

  // 1) groepeer ongegroepeerde keepers (1 call)
  const ungrouped = rows.filter((r: any) => !r.topic_group);
  if (ungrouped.length) {
    try {
      const m = buildTopicGroupMessages(cfg, ungrouped);
      const resp = await callModel(groupModel, m.system, m.user, 3000, 'low');
      diag.cost_usd += resp.cost;
      const parsed = parseJsonLoose(resp.content);
      const claimed = new Set<number>();
      const titleCount: Record<string, number> = {};
      for (const t of (Array.isArray(parsed.topics) ? parsed.topics : [])) {
        const idxs = (Array.isArray(t.members) ? t.members : []).filter((i: any) => Number.isInteger(i) && i >= 0 && i < ungrouped.length && !claimed.has(i));
        if (!idxs.length) continue;
        const title = String(t.topic_title || ungrouped[idxs[0]].title || 'Onderwerp').slice(0, 160);
        let gkey = `${category}:${audience}:${slug(title)}`;
        if (titleCount[gkey]) gkey = `${gkey}-${titleCount[gkey] + 1}`;
        titleCount[gkey] = (titleCount[gkey] || 0) + 1;
        for (const i of idxs) {
          claimed.add(i);
          ungrouped[i].topic_group = gkey; ungrouped[i].topic_title = title;
          await sb.from('kb_article_proposals').update({ topic_group: gkey, topic_title: title }).eq('id', ungrouped[i].id).eq('status', 'pending');
          diag.grouped++;
        }
      }
      // ongegroepeerde resten (LLM vergat) → eigen onderwerp van 1
      for (let i = 0; i < ungrouped.length; i++) {
        if (ungrouped[i].topic_group) continue;
        const title = String(ungrouped[i].title || 'Onderwerp').slice(0, 160);
        const gkey = `${category}:${audience}:${slug(title)}-solo${i}`;
        ungrouped[i].topic_group = gkey; ungrouped[i].topic_title = title;
        await sb.from('kb_article_proposals').update({ topic_group: gkey, topic_title: title }).eq('id', ungrouped[i].id).eq('status', 'pending');
        diag.grouped++;
      }
    } catch (e: any) { diag.errors.push(`group: ${(e?.message || '').slice(0, 90)}`); }
  }

  // 2) draft per onderwerp (gebonden tot maxDraft groepen)
  const byGroup: Record<string, any[]> = {};
  for (const r of rows) { if (r.topic_group) (byGroup[r.topic_group] = byGroup[r.topic_group] || []).push(r); }
  const groupKeys = Object.keys(byGroup).slice(0, maxDraft);
  for (const gkey of groupKeys) {
    try {
      const members = byGroup[gkey];
      const title = members[0].topic_title || members[0].title;
      const primary = members[0];
      const sigUnion = Array.from(new Set(([] as any[]).concat(...members.map((m: any) => m.source_signal_ids || []))));
      const mailUnion = Array.from(new Set(([] as any[]).concat(...members.map((m: any) => m.source_mail_ids || []))));
      const froms = members.map((m: any) => m.source_from).filter(Boolean).sort();
      const tos = members.map((m: any) => m.source_to).filter(Boolean).sort();
      // distinct threads van de unie
      let nThreads = members.length;
      const { data: sigRows } = await sb.from('kb_question_signals').select('canonical_question,answer_text,answer_status,generalizable,conversation_id').in('id', sigUnion.slice(0, 200));
      const sigs = (sigRows || []).slice(0, 16);
      nThreads = new Set((sigRows || []).map((s: any) => s.conversation_id).filter(Boolean)).size || members.length;

      const draft = await draftArticle({ cfg, draftModel, category, audience, articleType: primary.article_type, sigs, userId, topicTitle: title });
      diag.cost_usd += draft.cost;
      const qa = await maybeQA(cfg, draft, sigs, audience, category);
      diag.cost_usd += qa.cost; if (qa.needs_review) diag.needs_review++;

      const others = members.slice(1);
      await sb.from('kb_article_proposals').update({
        title: (draft.title || title).slice(0, 200), proposed_body: (draft.body || primary.proposed_body || '').slice(0, 9000), proposed_summary: (draft.summary || primary.proposed_summary || '').slice(0, 500),
        source_signal_ids: sigUnion, source_mail_ids: mailUnion, source_from: froms[0] ?? primary.source_from, source_to: tos[tos.length - 1] ?? primary.source_to,
        evidence: { vragen: sigUnion.length, topic: true, merged: members.length }, distinct_threads: nThreads,
        drafted_model: draftModel, restyled_at: new Date().toISOString(), topicized_at: new Date().toISOString(),
        needs_review: qa.needs_review, qa_notes: qa.notes, impact: null, impact_score: null, impact_at: null,
      }).eq('id', primary.id).eq('status', 'pending');

      if (others.length) {
        const otherIds = others.map((o: any) => o.id);
        await sb.from('kb_article_proposals').update({ status: 'superseded', topicized_at: new Date().toISOString(), amendment: `opgenomen in onderwerp ${primary.id}` }).in('id', otherIds);
        await sb.from('kb_question_signals').update({ cluster_id: primary.id }).in('cluster_id', otherIds);
        diag.superseded += otherIds.length;
      }
      diag.topics_drafted++;
      if (diag.samples.length < 10) diag.samples.push({ topic: title, merged: members.length, threads: nThreads, needs_review: qa.needs_review });
    } catch (e: any) { diag.errors.push(`draft ${gkey.slice(0, 30)}: ${(e?.message || '').slice(0, 80)}`); }
  }
  diag.done = Object.keys(byGroup).length <= maxDraft;
  diag.finished_at = new Date().toISOString();
  return json({ ok: true, _diagnose: diag });
}

// ----------------------------------------------------------------------------
// Fase 2b — onderwerp-identiteit + evolve-by-growth.
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

// Backfill: maak een kb_topics-identiteit (met embedding) voor elk onderwerp-artikel.
async function runTopicsSync(userId: string, limit: number) {
  const diag: any = { mode: 'topics_sync', version: SKILL_VERSION, created: 0, cost_usd: 0, errors: [] as string[], started_at: new Date().toISOString() };
  const { data: props, error } = await sb.from('kb_article_proposals')
    .select('id,kb_category,audience,title,proposed_summary,source_signal_ids')
    .eq('user_id', userId).eq('status', 'pending').not('topicized_at', 'is', null).is('topic_id', null).limit(limit);
  if (error) return json({ error: 'fetch_failed', detail: error.message, _diagnose: diag }, 500);
  if (!props || props.length === 0) { diag.done = true; diag.finished_at = new Date().toISOString(); return json({ ok: true, _diagnose: diag }); }
  for (const p of props) {
    try {
      const vec = await embedText(`${p.title}\n${p.proposed_summary || ''}`);
      const { data: ins, error: e2 } = await sb.from('kb_topics').insert({
        user_id: userId, kb_category: p.kb_category, audience: p.audience, title: p.title, summary: p.proposed_summary,
        embedding: vec, embedded_at: new Date().toISOString(), proposal_id: p.id, signal_count: (p.source_signal_ids || []).length, status: 'active',
      }).select('id').single();
      if (e2) { diag.errors.push(`${shortId(p.id)}: ${e2.message.slice(0, 70)}`); continue; }
      await sb.from('kb_article_proposals').update({ topic_id: ins.id }).eq('id', p.id);
      diag.created++;
    } catch (e: any) { diag.errors.push(`${shortId(p.id)}: ${(e?.message || '').slice(0, 70)}`); }
  }
  diag.done = props.length < limit;
  diag.finished_at = new Date().toISOString();
  return json({ ok: true, _diagnose: diag });
}

// Router: nieuwe signalen aanhaken bij het dichtstbijzijnde bestaande onderwerp (zelfde categorie),
// het artikel laten groeien; geen match → blijft 'new' (een generate-run maakt er t.z.t. nieuwe onderwerpen van).
async function runRoute(userId: string, limit: number) {
  const diag: any = { mode: 'route', version: SKILL_VERSION, matched: 0, unmatched: 0, redrafted: 0, cost_usd: 0, errors: [] as string[], started_at: new Date().toISOString() };
  const cfg = await getConfig();
  if ((cfg.route_enabled || 'aan').toLowerCase() !== 'aan') { diag.skipped = 'route_disabled'; diag.done = true; return json({ ok: true, _diagnose: diag }); }
  const minSim = parseFloat(cfg.route_min_similarity || '0.55') || 0.55;
  const draftModel = cfg.draft_model || 'gpt-5.4-mini';
  const { data: sigs, error } = await sb.from('kb_question_signals')
    .select('id,canonical_question,mail_id,kb_category')
    .eq('user_id', userId).eq('status', 'new').not('kb_category', 'is', null).limit(limit);
  if (error) return json({ error: 'fetch_failed', detail: error.message, _diagnose: diag }, 500);
  if (!sigs || sigs.length === 0) { diag.done = true; diag.finished_at = new Date().toISOString(); return json({ ok: true, _diagnose: diag }); }

  const affected: Record<string, { topicId: string; sigIds: string[]; mailIds: string[] }> = {};
  for (const s of sigs) {
    try {
      const vec = await embedText(s.canonical_question || '');
      const { data: m } = await sb.rpc('kb_match_topic', { p_user_id: userId, p_embedding: vec, p_category: s.kb_category, p_top: 1 });
      const best = m && m[0];
      if (best && best.sim >= minSim && best.proposal_id) {
        const a = affected[best.proposal_id] || (affected[best.proposal_id] = { topicId: best.topic_id, sigIds: [], mailIds: [] });
        a.sigIds.push(s.id); if (s.mail_id) a.mailIds.push(s.mail_id);
        await sb.from('kb_question_signals').update({ status: 'clustered', cluster_id: best.proposal_id }).eq('id', s.id);
        diag.matched++;
      } else { diag.unmatched++; }
    } catch (e: any) { diag.errors.push(`${shortId(s.id)}: ${(e?.message || '').slice(0, 70)}`); }
  }

  // groei de geraakte onderwerp-artikelen: union signalen → her-draft → her-embed het onderwerp
  for (const proposalId of Object.keys(affected)) {
    try {
      const { topicId, sigIds, mailIds } = affected[proposalId];
      const { data: prop } = await sb.from('kb_article_proposals')
        .select('id,kb_category,audience,article_type,title,source_signal_ids,source_mail_ids')
        .eq('id', proposalId).eq('status', 'pending').maybeSingle();
      if (!prop) continue; // onderwerp niet meer in de queue → sla over (signalen blijven gekoppeld)
      const sigUnion = Array.from(new Set(([] as any[]).concat(prop.source_signal_ids || [], sigIds)));
      const mailUnion = Array.from(new Set(([] as any[]).concat(prop.source_mail_ids || [], mailIds)));
      const { data: sigRows } = await sb.from('kb_question_signals').select('canonical_question,answer_text,answer_status,generalizable').in('id', sigUnion.slice(0, 200));
      const draft = await draftArticle({ cfg, draftModel, category: prop.kb_category, audience: prop.audience, articleType: prop.article_type, sigs: (sigRows || []).slice(0, 16), userId, topicTitle: prop.title });
      diag.cost_usd += draft.cost;
      const qa = await maybeQA(cfg, draft, (sigRows || []).slice(0, 16), prop.audience, prop.kb_category); diag.cost_usd += qa.cost;
      await sb.from('kb_article_proposals').update({
        title: (draft.title || prop.title).slice(0, 200), proposed_body: (draft.body || '').slice(0, 9000), proposed_summary: (draft.summary || '').slice(0, 500),
        source_signal_ids: sigUnion, source_mail_ids: mailUnion, evidence: { vragen: sigUnion.length, topic: true, grew: true },
        drafted_model: draftModel, restyled_at: new Date().toISOString(), needs_review: qa.needs_review, qa_notes: qa.notes, impact: null, impact_score: null, impact_at: null,
      }).eq('id', proposalId).eq('status', 'pending');
      try { const tvec = await embedText(`${draft.title || prop.title}\n${draft.summary || ''}`); await sb.from('kb_topics').update({ title: (draft.title || prop.title).slice(0, 200), summary: (draft.summary || '').slice(0, 500), embedding: tvec, embedded_at: new Date().toISOString(), signal_count: sigUnion.length }).eq('id', topicId); } catch { /* re-embed soft-fail */ }
      diag.redrafted++;
    } catch (e: any) { diag.errors.push(`grow ${shortId(proposalId)}: ${(e?.message || '').slice(0, 70)}`); }
  }
  diag.done = sigs.length < limit;
  diag.finished_at = new Date().toISOString();
  return json({ ok: true, _diagnose: diag });
}

// ----------------------------------------------------------------------------
// Prompt-bouwers
// ----------------------------------------------------------------------------
const DRAFT_SCHEMA = 'Output UITSLUITEND geldige JSON, geen markdown-fences:\n{"title":"","summary":"","body":"","te_bevestigen":["open Legal Mind-feit dat ontbreekt"]}\n- body = markdown volgens het skelet (## koppen, genummerde stappen, korte lijsten). summary = 1 zin. Ontbrekende Legal Mind-feiten: neem ze in de body op als blok dat begint met "> TE BEVESTIGEN door Jelle/CS:" met bullets, en noem ze ook in te_bevestigen. Verzin niets.';

async function buildDraftSystem(cfg: Record<string, string>, articleType: string | null, audience: string, styleDigest: string, revise: boolean, topicTitle?: string): Promise<string> {
  const tmplKey = articleType ? `template_${articleType}` : '';
  const tmpl = topicTitle
    ? (cfg.template_topic || 'Eén onderwerp-artikel: korte intro + "## "-sectie per subvraag.')
    : ((tmplKey && cfg[tmplKey]) ? cfg[tmplKey] : 'Skelet: antwoord-eerst, daarna detail met koppen en korte lijsten.');
  const aug = (cfg.augmentation_level || 'geassisteerd').toLowerCase();
  const augLine = aug.startsWith('strikt')
    ? 'Aanvul-niveau STRIKT: voeg GEEN algemene kennis toe; blijf strikt bij de meegegeven bron.'
    : 'Aanvul-niveau GEASSISTEERD: veilige, universeel-ware algemene uitleg mag, kort en generiek — nooit Legal Mind-specifieke feiten verzinnen.';
  const tone = audience === 'klant'
    ? ('TOON (klant): ' + (cfg.tone_klant || '') + (styleDigest ? '\n\nSCHRIJF IN DEZE STEM:\n' + styleDigest : ''))
    : ('TOON (intern): ' + (cfg.tone_intern || ''));
  const golden = (cfg.golden_examples || '').trim();
  const reviseLine = topicTitle
    ? `ONDERWERP-ARTIKEL: schrijf ÉÉN samenhangend artikel over het onderwerp "${topicTitle}" dat ALLE meegegeven subvragen bundelt in "## "-secties. Herhaal niets; bundel verwante subvragen; antwoord-eerst. Je bent een ghostwriter: poets de vorm, maar verzin geen Legal Mind-feiten (ontbrekend → "> TE BEVESTIGEN").`
    : revise
    ? 'REVISIE: je herschrijft een BESTAAND artikel-voorstel naar de Content Standard. Behoud de bruikbare, algemeen-geldige inhoud en werkwijze; verbeter structuur (antwoord-eerst, skelet), titel en toon. Verwijder of verplaats naar "> TE BEVESTIGEN" alleen die beweringen die SPECIFIEK Legal Mind betreffen (concrete bedragen, termijnen, namen, e-mailadressen, interne procedures/instellingen) én die niet in de bronvragen/antwoorden staan en niet algemeen-bekend zijn. Gooi correcte, generieke uitleg NIET weg en verzin geen nieuwe specifieke feiten.'
    : 'Je schrijft nu ÉÉN kennisbank-artikel. Je bent een ghostwriter: poets de vorm, maar leg Legal Mind nooit feiten in de mond.';
  return [
    cfg.generate_system || 'Je bent de kennisbank-curator van Legal Mind.',
    reviseLine,
    'CONTENT STANDARD:\n' + (cfg.content_standard || ''),
    (topicTitle ? 'SJABLOON (onderwerp-artikel):\n' : `SJABLOON (artikeltype ${articleType || 'algemeen'}):\n`) + tmpl,
    'TITEL-STIJL: ' + (cfg.title_rules || ''),
    'GROUNDING:\n' + (cfg.grounding_rules || '') + '\n' + augLine,
    tone,
    golden ? ('VOORBEELD-ARTIKEL(EN) ALS IJKPUNT (spiegel vorm + toon, niet de inhoud):\n' + golden) : '',
    DRAFT_SCHEMA,
  ].filter(Boolean).join('\n\n');
}

function buildDraftUser(category: string, audience: string, sigs: any[], currentBody?: string, topicTitle?: string): string {
  const lines = sigs.map((s, i) => {
    let t = `#${i + 1} [${s.answer_status || '?'}${s.generalizable === false ? ', UITZONDERING' : ''}] VRAAG: ${s.canonical_question || ''}`;
    if (s.answer_text) t += `\n   ANTWOORD (bron, ons gegeven antwoord): ${String(s.answer_text).slice(0, 500)}`;
    return t;
  });
  const head = `CATEGORIE: ${category}\nDOELGROEP: ${audience}\n\nBRON-VRAGEN (${sigs.length}) — dit is wat we ECHT uit de mailhistorie weten (feitenbasis):\n${lines.join('\n')}`;
  if (topicTitle) {
    return `${head}\n\nBundel ALLE bovenstaande subvragen in ÉÉN onderwerp-artikel "${topicTitle}" met "## "-secties per subvraag (verwante subvragen samen). Gebruik de bron als feitenbasis; algemeen-geldige uitleg mag, maar ontbrekende Legal Mind-specifieke feiten → "> TE BEVESTIGEN".`;
  }
  if (currentBody && currentBody.trim()) {
    return `${head}\n\nHUIDIG VOORSTEL (herschrijf en verbeter dit naar de Content Standard; behoud bruikbare algemeen-geldige inhoud, verbeter structuur/titel/toon, en pas grounding toe op Legal Mind-specifieke beweringen):\n${currentBody.slice(0, 6000)}`;
  }
  return `${head}\n\nSchrijf één artikel dat deze terugkerende vraag/vragen beantwoordt. Gebruik onderstaande bron als feitenbasis; algemeen-geldige uitleg mag (aanvul-niveau), maar Legal Mind-specifieke feiten die niet in de bron staan horen onder "> TE BEVESTIGEN".`;
}

function buildClusterMessages(category: string, rows: any[], cfg: Record<string, string>) {
  const system = [
    cfg.generate_system || 'Je bent de kennisbank-curator van Legal Mind.',
    'Dit is de GOEDKOPE sorteer-stap: je schrijft GEEN artikel. Je groepeert alleen vragen die in de kern hetzelfde onderwerp dekken, en classificeert per groep. Kwaliteit boven kwantiteit: laat losse/triviale/niet-clusterbare vragen weg (niet noemen). Een vraag in MAX één groep.',
    'DOELGROEP-REGELS: ' + (cfg.audience_rules || ''),
    'Output UITSLUITEND JSON: {"clusters":[{"member_ids":[0,3],"article_type":"how_to|beleid|referentie|troubleshooting|faq|besluit_rationale","audience":"intern|klant","generalizable":true,"confidence":0.8,"title_hint":"","rationale":"waarom deze groep + waarom deze categorie"}]}',
  ].join('\n\n');
  const lines = rows.map((r: any, i: number) => `#${i} [${r.answer_status}] ${r.canonical_question}` + (r.answer_text ? ` (antwoord aanwezig)` : ''));
  return [{ role: 'system', content: system }, { role: 'user', content: `CATEGORIE: ${category}\n\nVRAGEN (${rows.length}):\n${lines.join('\n')}` }];
}

function buildConsolidateMessages(category: string, props: any[]) {
  const system = `Je bent kennisbank-redacteur bij Legal Mind. Hieronder staan artikel-VOORSTELLEN in EEN categorie. Vind groepen die in de kern HETZELFDE onderwerp/vraag dekken en samengevoegd moeten worden tot een artikel. Wees STRENG: voeg alleen echte bijna-duplicaten samen; laat onderscheidende voorstellen met rust.\n\nOutput ALLEEN JSON: {"merges":[{"members":[0,4,7],"title":"beste samenvattende titel"}]}\n- Noem ALLEEN groepen van 2 of meer #-nummers die echt dubbelen. Een voorstel in MAX een groep. Unieke voorstellen: NIET noemen.`;
  const lines = props.map((p: any, i: number) => `#${i} ${p.title}` + (p.proposed_summary ? ` — ${String(p.proposed_summary).slice(0, 160)}` : ''));
  return [{ role: 'system', content: system }, { role: 'user', content: `CATEGORIE: ${category}\n\nVOORSTELLEN (${props.length}):\n${lines.join('\n')}` }];
}

function buildAmendSystem(cfg: Record<string, string>, articleType: string | null, audience: string) {
  const tmplKey = articleType ? `template_${articleType}` : '';
  const tmpl = (tmplKey && cfg[tmplKey]) ? cfg[tmplKey] : '';
  const tone = audience === 'klant' ? (cfg.tone_klant || '') : (cfg.tone_intern || '');
  return [
    'Je herschrijft een kennisbank-artikel-voorstel op basis van een instructie van de redacteur. Behoud bestaande feiten; pas alleen aan wat gevraagd wordt. Verzin geen nieuwe bedragen/procedures/feiten — ontbrekend feit -> "> TE BEVESTIGEN door Jelle/CS:".',
    'CONTENT STANDARD:\n' + (cfg.content_standard || ''),
    tmpl ? ('SJABLOON:\n' + tmpl) : '',
    'TITEL-STIJL: ' + (cfg.title_rules || ''),
    'TOON: ' + tone,
    DRAFT_SCHEMA,
  ].filter(Boolean).join('\n\n');
}
function buildAmendUser(p: any) {
  return `INSTRUCTIE VAN REDACTEUR: ${p.amendment || ''}\n\nHUIDIGE TITEL: ${p.title || ''}\nHUIDIGE SAMENVATTING: ${p.proposed_summary || ''}\n\nHUIDIG ARTIKEL:\n${p.proposed_body || ''}`;
}

function buildQaSystem(cfg: Record<string, string>) {
  const aug = (cfg.augmentation_level || 'geassisteerd').toLowerCase();
  const augNote = aug.startsWith('strikt')
    ? 'Aanvul-niveau STRIKT: alleen bronmateriaal; generieke toevoegingen zijn hier WEL een tekortkoming.'
    : 'Aanvul-niveau GEASSISTEERD: algemeen-geldige, veilige werkwijze/uitleg is TOEGESTAAN en is GEEN reden voor needs_review.';
  return `Je bent kwaliteitslezer van de Legal Mind kennisbank. Beoordeel tegen de Content Standard.\n\nCONTENT STANDARD:\n${cfg.content_standard || ''}\n\n${augNote}\n\nZet verdict op "needs_review" ALLEEN bij een ECHT probleem:\n(a) een VERZONNEN Legal Mind-SPECIFIEK feit (concreet bedrag, termijn, naam, e-mailadres, tool/leverancier of interne procedure) dat NIET in de bron staat én NIET onder "> TE BEVESTIGEN" is gezet;\n(b) duidelijke structuurfout (niet antwoord-eerst of geen logisch skelet), verkeerde toon voor de doelgroep, of een vage/ambtelijke titel.\nAlgemeen-geldige, generieke werkwijze is OK (zie aanvul-niveau) en is GEEN reden voor needs_review. Wees niet overdreven streng: een gegrond, scanbaar artikel met nette "> TE BEVESTIGEN"-gaten is "ok".\n\nOutput UITSLUITEND JSON: {"verdict":"ok|needs_review","grounded":true,"scannable":true,"tone_ok":true,"title_ok":true,"issues":["alleen echte problemen, kort"]}`;
}
function buildQaUser(draft: any, sigs: any[], audience: string, category: string) {
  const src = sigs.length
    ? sigs.map((s, i) => `#${i + 1} ${s.canonical_question || ''}${s.answer_text ? ` => ${String(s.answer_text).slice(0, 300)}` : ''}`).join('\n')
    : '(geen bron-signalen meegegeven; beoordeel vooral op interne consistentie + geen verzonnen specifieke feiten)';
  return `DOELGROEP: ${audience} · CATEGORIE: ${category}\n\nBRON (feitenbasis):\n${src}\n\nARTIKEL:\nTITEL: ${draft.title || ''}\nSAMENVATTING: ${draft.summary || ''}\nBODY:\n${String(draft.body || '').slice(0, 4000)}`;
}

// ----------------------------------------------------------------------------
// Model-calls — provider-aware: claude-* via de centrale callAnthropic-wrapper
// (logt in claude_api_calls; vereist Vault skill:anthropic:api_key), al het
// andere via OpenAI chat. Default draft=gpt-5 (premium, werkt vandaag); zet
// draft_model op claude-sonnet-4-6 zodra de Anthropic-key in de Vault staat.
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
// Helpers
// ----------------------------------------------------------------------------
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
function shortId(id: string) { return String(id).slice(0, 8); }
function json(b: any, s = 200) { return new Response(JSON.stringify(b, null, 2), { status: s, headers: { 'Content-Type': 'application/json' } }); }
