// mail-enricher v11 — user_id verplicht (per-user mailbox, 2026-09-02)
//
// v11 (2026-09-02): `body.user_id` is niet langer optioneel. Tot v10 stond er
// `body.user_id ?? '0934ffef-…'` — een vergeten parameter landde daarmee STIL
// bij Jelle: verrijking, kosten en budget van mailbox #2 werden op mailbox #1
// geboekt. Nu: 400 zonder user_id. mail_enrichment_trigger_backfill_batch()
// stuurt hem sinds migratie D expliciet mee. Zie MAIL-PIPELINE.md §3.4.
//
// v10 (2026-09-02): cron_secret/service-role-gate toegevoegd. Deze functie
// stond op verify_jwt=false ZONDER enige auth-check, draaide met service-role
// en stookt per call betaalde OpenAI-calls (nano + mini) over mail-inhoud.
// Dat was het enige echte gat van de tien functies zonder git-source: de
// andere negen hadden hun gate al (of staan op verify_jwt=true).
// De source van v9 is via de eszip-sourcemap teruggehaald
// (scripts/r1-repo-hygiene/extract-eszip-sourcemap.cjs) — byte-exact, geen
// reconstructie, conform de hard-rule in CLAUDE.md.
// verify_jwt blijft false: server-to-server / cron.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireCronOrServiceRole } from "../_shared/edge-auth.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NANO_MODEL = Deno.env.get('MAIL_ENRICHER_NANO_MODEL') ?? 'gpt-5.4-nano';
const MINI_MODEL = Deno.env.get('MAIL_ENRICHER_MINI_MODEL') ?? 'gpt-5.4-mini';

const PRICING: Record<string, { input: number; output: number }> = {
  'gpt-5-nano': { input: 0.20, output: 1.25 },
  'gpt-5-mini': { input: 0.75, output: 4.50 },
  'gpt-5.4-nano': { input: 0.20, output: 1.25 },
  'gpt-5.4-mini': { input: 0.75, output: 4.50 },
  'gpt-5.4': { input: 2.50, output: 15.00 },
  'gpt-5.5': { input: 5.00, output: 30.00 },
};

const COMMERCIAL_TYPES = new Set(['customer','pilot','sales_lead','sales_opvolging','partner','aandeelhouder']);
const SKIP_LLM_TYPES = new Set(['spam','vendor','press']);

// Synoniemen-mapping voor LLM-output normalisatie
const SPEECH_ACT_VALID = new Set(['request','propose','commit','deliver','inform','amend','ack','decline','accept']);
const SPEECH_ACT_SYN: Record<string, string> = {
  'information':'inform','introduction':'inform','informing':'inform','notify':'inform','notification':'inform',
  'requesting':'request','ask':'request','question':'request','asking':'request',
  'proposing':'propose','suggestion':'propose','suggest':'propose',
  'committing':'commit','confirm':'commit','confirmation':'commit',
  'delivering':'deliver','send':'deliver','sending':'deliver','share':'deliver',
  'amending':'amend','update':'amend','correction':'amend',
  'acknowledge':'ack','thanks':'ack','thank_you':'ack',
  'declining':'decline','refuse':'decline','reject':'decline',
  'accepting':'accept','agree':'accept','agreement':'accept',
};
const URGENCY_VALID = new Set(['high','normal','low']);
const SENTIMENT_VALID = new Set(['positive','neutral','negative','escalated']);
const INTENT_VALID = new Set(['meeting','information','task','document','payment','feedback','introduction','renewal','pricing']);
const LIFECYCLE_VALID = new Set(['prospect','trial','active','renewing','expanding','churned','ex','n/a']);
const PARTY_VALID = new Set(['customer','pilot','sales_lead','sales_opvolging','partner','vendor','aandeelhouder','recruitment','intern','overheid','personal','community','press','spam','onbekend']);
const SPIN_VALID = new Set(['situation','problem','implication','need_payoff','n/a']);
const SIGNAL_VALID = new Set(['intent','usage','engagement','research','declared']);

function normalize(value: any, valid: Set<string>, syn?: Record<string,string>, fallback?: string): string | null {
  if (!value) return fallback ?? null;
  const v = String(value).toLowerCase().trim();
  if (valid.has(v)) return v;
  if (syn && syn[v]) return syn[v];
  return fallback ?? null;
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
let CACHED_KEY: string | null = null;

async function getOpenAIKey(): Promise<string> {
  if (CACHED_KEY) return CACHED_KEY;
  const fromEnv = Deno.env.get('OPENAI_API_KEY');
  if (fromEnv) { CACHED_KEY = fromEnv; return fromEnv; }
  const { data, error } = await sb.rpc('get_openai_key_for_mail_enricher');
  if (error || !data) throw new Error('OpenAI key not available');
  CACHED_KEY = data as string;
  return CACHED_KEY;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'POST only' }, 405);

  const gateClient = createClient(SUPABASE_URL, SERVICE_ROLE);
  const gate = await requireCronOrServiceRole(req, gateClient);
  if (!gate.ok) return gate.response;

  const body: any = await req.json().catch(() => ({}));
  const mode = body.mode ?? 'backfill';
  // v11: geen default-uuid meer. Luid falen i.p.v. stil bij de org-mailbox.
  const userId = typeof body.user_id === 'string' ? body.user_id.trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return jsonResponse({
      error: 'user_id_required',
      detail: 'Geef body.user_id (uuid van de mailbox-eigenaar) mee. ' +
              'Sinds v11 is er geen hardcoded default meer.',
    }, 400);
  }
  const limit = Math.min(body.limit ?? 10, 75);
  const dryRun = body.dry_run ?? false;
  const skipMini = body.skip_mini ?? false;

  const diagnose: any = {
    mode, user_id: userId, requested_limit: limit, dry_run: dryRun, skip_mini: skipMini,
    nano_model: NANO_MODEL, mini_model: MINI_MODEL, version: 'v11_user_id_required',
    candidates: 0, pre_filtered: 0, pre_filter_breakdown: {},
    enriched_nano_only: 0, enriched_with_mini: 0, failed: 0, total_cost_usd: 0,
    errors: [] as string[], started_at: new Date().toISOString(),
  };

  const { data: budget } = await sb.rpc('check_enrichment_budget', { p_user_id: userId });
  diagnose.budget_at_start = budget;
  if (['hard_block','paused'].includes(budget?.status)) return jsonResponse({ skipped: true, reason: budget.status, _diagnose: diagnose });
  if (budget?.status === 'daily_block' && mode === 'backfill' && !dryRun) return jsonResponse({ skipped: true, reason: 'daily_cap_reached', _diagnose: diagnose });

  let llmMailIds: string[] = [];
  if (body.mail_ids?.length) {
    llmMailIds = body.mail_ids;
    diagnose.candidates = llmMailIds.length;
  } else {
    const { data: claim, error: claimErr } = await sb.rpc('mail_enrichment_claim_batch', { p_user_id: userId, p_limit: limit });
    if (claimErr) return jsonResponse({ error: 'claim_failed', detail: claimErr.message }, 500);
    diagnose.pre_filtered = claim.skipped;
    diagnose.pre_filter_breakdown = claim.skip_breakdown ?? {};
    llmMailIds = Array.isArray(claim.mail_ids_for_llm) ? claim.mail_ids_for_llm : [];
    diagnose.candidates = (claim.llm_count ?? 0) + claim.skipped;
    diagnose.llm_ids_received = llmMailIds.length;
  }

  if (llmMailIds.length === 0) {
    const { data: budgetEnd } = await sb.rpc('check_enrichment_budget', { p_user_id: userId });
    diagnose.budget_at_end = budgetEnd;
    diagnose.finished_at = new Date().toISOString();
    return jsonResponse({ ok: true, _diagnose: diagnose });
  }

  const { data: mails, error: mailsErr } = await sb.from('mail_messages')
    .select('id,from_email,from_domain,subject,body_text,body_preview,received_at,is_from_me,is_calendar_invite,user_id,attachment_names')
    .in('id', llmMailIds);
  if (mailsErr) return jsonResponse({ error: 'mails_fetch_failed', detail: mailsErr.message }, 500);
  diagnose.mails_fetched = mails?.length ?? 0;

  const results = await Promise.allSettled((mails ?? []).map((mail) => processSingleMail(mail, userId, dryRun, skipMini, diagnose)));
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      diagnose.failed++;
      diagnose.errors.push(`${(mails?.[i]?.id ?? '?').slice(0,30)}: ${r.reason?.message ?? r.reason}`.slice(0, 300));
    }
  });

  const { data: budgetAfter } = await sb.rpc('check_enrichment_budget', { p_user_id: userId });
  diagnose.budget_at_end = budgetAfter;
  diagnose.finished_at = new Date().toISOString();
  return jsonResponse({ ok: true, _diagnose: diagnose });
});

async function processSingleMail(mail: any, userId: string, dryRun: boolean, skipMini: boolean, diagnose: any) {
  const { data: party, error: partyErr } = await sb.rpc('resolve_party_at_moment', { p_mail_id: mail.id });
  if (partyErr) throw new Error(`resolve_party: ${partyErr.message}`);

  const partyType = normalize(party.party_type, PARTY_VALID, undefined, 'onbekend')!;

  if (SKIP_LLM_TYPES.has(partyType)) {
    if (!dryRun) {
      const { error } = await sb.from('mail_enrichment').insert({
        mail_id: mail.id, user_id: userId, enricher_version: 'v1.0',
        party_type: partyType, party_lifecycle_at_moment: normalize(party.party_lifecycle_at_moment, LIFECYCLE_VALID),
        related_company_id: party.related_company_id, related_deal_id: party.related_deal_id,
        speech_act: 'inform', intent_object: 'information', sentiment: 'neutral', urgency: 'normal',
        summary_one_line: `${partyType === 'vendor' ? 'Vendor' : partyType === 'press' ? 'Pers' : 'Spam'} mail, niet voor jou interessant`,
        enrichment_model: `pre_filter:party_skip_${partyType}`, enrichment_cost_usd: 0, enrichment_confidence: 0.9,
      });
      if (error && !error.message.includes('duplicate')) throw new Error(`insert_skip: ${error.message}`);
    }
    diagnose.pre_filtered++;
    const key = `party_skip_${partyType}`;
    diagnose.pre_filter_breakdown[key] = (diagnose.pre_filter_breakdown[key] ?? 0) + 1;
    return;
  }

  const bodyText = (mail.body_text ?? mail.body_preview ?? '').toString().slice(0, 4000);
  const nanoResult = await callOpenAI(NANO_MODEL, buildNanoMessages(mail, bodyText, party), 2000, 'none');
  const nanoParsed = nanoResult.parsed;
  if (nanoParsed._parse_error) throw new Error(`nano_parse: ${nanoResult.raw_text?.slice(0,100) ?? 'empty'}`);

  const isCommercial = COMMERCIAL_TYPES.has(partyType);
  let miniResult: any = null;
  let miniParsed: any = {};
  if (!skipMini && isCommercial) {
    miniResult = await callOpenAI(MINI_MODEL, buildMiniMessages(mail, bodyText, party, nanoParsed), 3000, 'low');
    miniParsed = miniResult.parsed;
    if (miniParsed._parse_error) { miniResult = null; miniParsed = {}; }
  }

  const totalCost = nanoResult.cost + (miniResult?.cost ?? 0);
  const confidence = Math.min(nanoParsed.confidence ?? 0.7, miniParsed.confidence ?? 1.0);
  const finalTopics = (miniParsed.topics_refined?.length ? miniParsed.topics_refined : nanoParsed.topics ?? []).slice(0, 3);

  if (!dryRun) {
    const { error } = await sb.from('mail_enrichment').insert({
      mail_id: mail.id, user_id: userId, enricher_version: 'v1.0',
      party_type: partyType,
      party_lifecycle_at_moment: normalize(party.party_lifecycle_at_moment, LIFECYCLE_VALID),
      party_lifecycle_now: normalize(party.party_lifecycle_now, LIFECYCLE_VALID),
      related_company_id: party.related_company_id, related_deal_id: party.related_deal_id,
      related_contact_id: party.related_contact_id,
      relationship_age_days: party.relationship_age_days,
      historical_inference: party.historical_inference,
      speech_act: normalize(nanoParsed.speech_act, SPEECH_ACT_VALID, SPEECH_ACT_SYN, 'inform'),
      intent_object: normalize(nanoParsed.intent_object, INTENT_VALID, undefined, 'information'),
      asks_response: !!nanoParsed.asks_response, has_question: !!nanoParsed.has_question,
      urgency: normalize(nanoParsed.urgency, URGENCY_VALID, undefined, 'normal'),
      topics: finalTopics,
      attachment_types: Array.isArray(nanoParsed.attachment_types) ? nanoParsed.attachment_types : [],
      summary_one_line: (nanoParsed.summary_one_line ?? '').slice(0, 120),
      summary_paragraph: miniParsed.summary_paragraph ?? null,
      key_points: nanoParsed.key_points ?? null,
      entities_mentioned: miniParsed.entities_mentioned ?? null,
      sentiment: normalize(nanoParsed.sentiment, SENTIMENT_VALID, undefined, 'neutral'),
      language: nanoParsed.language ?? 'nl',
      cycle_stage_signal: miniParsed.cycle_stage_signal ?? null,
      spin_type: normalize(miniParsed.spin_type, SPIN_VALID),
      signal_type: normalize(miniParsed.signal_type, SIGNAL_VALID),
      enrichment_model: miniResult ? `${NANO_MODEL}+${MINI_MODEL}` : NANO_MODEL,
      enrichment_cost_usd: totalCost,
      enrichment_confidence: confidence,
      needs_review: confidence < 0.6,
    });
    if (error) {
      if (error.message.includes('duplicate')) return;
      throw new Error(`insert_enrichment: ${error.message}`);
    }
  }
  if (miniResult) diagnose.enriched_with_mini++; else diagnose.enriched_nano_only++;
  diagnose.total_cost_usd += totalCost;
}

async function callOpenAI(model: string, messages: any[], maxTokens: number, reasoningEffort: string) {
  const key = await getOpenAIKey();
  const t0 = Date.now();
  const reqBody: any = { model, messages, response_format: { type: 'json_object' }, max_completion_tokens: maxTokens };
  if (model.startsWith('gpt-5')) reqBody.reasoning_effort = reasoningEffort;
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(reqBody),
  });
  const latency = Date.now() - t0;
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`OpenAI ${model} ${resp.status}: ${txt.slice(0, 300)}`);
  }
  const data = await resp.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  const usage = data.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
  const p = PRICING[model] ?? { input: 1.0, output: 5.0 };
  const cost = (usage.prompt_tokens * p.input + usage.completion_tokens * p.output) / 1_000_000;
  let parsed: any = {};
  if (!text || text.trim().length === 0) parsed = { _parse_error: true, raw: '' };
  else { try { parsed = JSON.parse(text); } catch { parsed = { _parse_error: true, raw: text.slice(0, 500) }; } }
  return { parsed, usage, cost, latency_ms: latency, raw_text: text.slice(0, 500) };
}

function buildNanoMessages(mail: any, bodyText: string, party: any) {
  const system = `Je classificeert email-metadata voor Legal Mind. Output ALLEEN JSON:
{"speech_act":"","intent_object":"","asks_response":bool,"has_question":bool,"urgency":"high|normal|low","topics":[],"summary_one_line":"","sentiment":"positive|neutral|negative|escalated","language":"nl|en|de|fr|other","key_points":[],"attachment_types":[],"confidence":0.85}

speech_act EXACT (kies precies één): request, propose, commit, deliver, inform, amend, ack, decline, accept.
intent_object EXACT (kies precies één): meeting, information, task, document, payment, feedback, introduction, renewal, pricing.

TOPICS — kies er MAX 3, en ALLEEN als ze ECHT centraal staan in deze mail. Bij twijfel liever 1 raak topic dan 3 vage. Gebruik ECHTE keys uit deze lijst (geen placeholders):
license_agreement, contract_negotiation, contract_signed, nda, sla_amendment, terms_change, lead_outreach, intro_referral, demo, proposal_sent, proposal_negotiation, pricing, onboarding, support, bug_report, feature_request, feedback, renewal, expansion, churn, finance_invoice, finance_payment, finance_subscription, finance_expense, partner_intro, partner_collaboration, integration, co_marketing, candidate_application, interview, employee_contract, recruiter_outreach, release_announcement, technical_question, roadmap, legal_question, compliance, office_logistics, software_admin, travel, event_invitation, press_inquiry, thought_leadership, personal.

TOPIC-DISCIPLINE (belangrijk — voorkomt ruis):
- lead_outreach = UITSLUITEND koude acquisitie / outbound lead-generatie: een ONBEKENDE/prospect die ons koud iets probeert te verkopen of aan te bieden (of wij die koud een prospect benaderen). NOOIT gebruiken bij interne mail, bestaande klanten/partners/pilots, contracten, facturen, of juridische/operationele mail — kies dan het inhoudelijke topic (contract_negotiation, legal_question, finance_invoice, onboarding, office_logistics, ...).
- Een introductie/doorverwijzing is intro_referral of partner_intro, GEEN lead_outreach.
- Bij party_type=intern is lead_outreach vrijwel nooit juist; kies een inhoudelijk/operationeel topic.
summary_one_line: max 120 chars Nederlands.`;
  const attaches = (mail.attachment_names?.length) ? `\nATTACHMENTS: ${mail.attachment_names.slice(0,5).join(', ')}` : '';
  const user = `FROM: ${mail.from_email ?? '(onbekend)'}\nSUBJECT: ${mail.subject ?? '(geen)'}\nPARTY_TYPE: ${party.party_type}${party.party_lifecycle_at_moment ? `\nLIFECYCLE: ${party.party_lifecycle_at_moment}` : ''}${attaches}\n\nBODY:\n${bodyText}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

function buildMiniMessages(mail: any, bodyText: string, party: any, nanoParsed: any) {
  const system = `Je bent sales-cycle classifier voor commerciële mail (party_type=${party.party_type}). Output ALLEEN deze JSON:
{"summary_paragraph":"3-5 zinnen NL","entities_mentioned":[{"type":"company|person|deal|date|amount|product","name":"x"}],"cycle_stage_signal":"first_contact|qualification|demo_scheduled|demo_done|proposal_sent|proposal_negotiation|contract_sent|contract_signed|onboarded|usage_low|usage_high|renewal_window|expansion_signal|churn_signal|churned_actual|n/a","spin_type":"situation|problem|implication|need_payoff|n/a","signal_type":"intent|usage|engagement|research|declared","topics_refined":["echte_topic_key"],"confidence":0.85}

topics_refined: GEBRUIK ECHTE topic_keys (license_agreement etc), GEEN placeholders. Dit is een BESTAANDE commerciële relatie (klant/partner/pilot/aandeelhouder) — lead_outreach is hier vrijwel NOOIT juist; kies het inhoudelijke topic (contract_negotiation, renewal, pricing, onboarding, support, finance_invoice, ...).`;
  const user = `FROM: ${mail.from_email}\nSUBJECT: ${mail.subject}\nPARTY: ${party.party_type} / ${party.party_lifecycle_at_moment ?? 'n/a'}\nNANO_TOPICS: ${(nanoParsed.topics ?? []).join(', ')}\nNANO_SPEECH_ACT: ${nanoParsed.speech_act}\nNANO_SUMMARY: ${nanoParsed.summary_one_line ?? ''}\n\nBODY:\n${bodyText}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json' } });
}
