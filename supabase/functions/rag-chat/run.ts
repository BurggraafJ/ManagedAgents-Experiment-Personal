// =============================================================================
// rag-chat/run.ts — de motor: een vraag is een run, een hop duwt hem vooruit (v6.0)
// =============================================================================
// Spoor 02 (2026-09-06). Een chatvraag is een rij in agent_chat_runs met een
// toestandsmachine (queued → planning → researching → composing → done, plus
// failed | cancelled | needs_input), een budget per effort ({tool_calls, wall_ms,
// usd, hops_max} uit agent_config rag-chat/run_budgets) en een stappenlog. Eén
// hop = één edge-invocatie die de run vooruitduwt en via het lease-token uit
// agent_chat_run_claim_hop als enige mag schrijven; na HOP_SOFT_MS begint hij geen
// nieuwe agent-beurt meer en kaatst hij de run door naar de volgende invocatie
// (spawnNext, het patroon van rag-eval-cron v3.0). De zware lus-toestand staat in
// agent_chat_run_state; de run-rij blijft klein en gaat door realtime.
//
// Gemeten aanleiding (RESEARCH 02 §1–§2): 25 % van de agentic runs eindigde op de
// tool-cap van 10, niet op de klok; de gateway kapt elke niet-streamende call op
// 150 s (504); een gesloten tab verloor vraag én antwoord omdat het antwoord
// nergens op de server stond. Nu schrijft de hop het antwoord altijd in de rij.
//
// Wat hier byte-gelijk uit index.ts v5.8 komt: de retrieval-helpers (entity,
// tijdlijn-RPC's, context-build met retry, rerank, web-research, identiteit). Wat
// nieuw is: createRun, runHop en de stages. De routes, tools, recepten, prompts,
// coverage.reason-set en de twee identiteitsassen (owner_id = RLS, caller_user_id
// = Confluence-ACL) veranderen niet.
//
// Compat (vork V7): stream:true/false maken óók een run-rij en draaien de hops
// inline in dezelfde invocatie (≤ COMPAT_WALL_MS, zoals vandaag), zodat vanaf v6.0
// 100 % van de vragen een run-rij heeft (poort T1). Ze verdwijnen zodra de
// browser-hook (I2) en de evalrunner v3.1 op run:true staan.
// =============================================================================
import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { routeGateHit, classifyRoute, runStructured, runSweep, analyticsContextBlob, SWEEP_MODEL } from "./analytics.ts";
import { runAgentic, TOOL_STEP_LABELS, evidenceRows, DOCS_QUESTION_RE, agenticModelFor, agenticPriceFor, type MirrorCtx, type AgenticLoopState } from "./agentic.ts";
import { loadOrgSkills, generalGuidanceBlock } from "./org-skills.ts";
import { GROK_MODEL, coverageBlob, estimateCostUsd, buildCombinedUserMessage, composeAnswer, finishCost, type Pricing } from "./compose.ts";

const OPENAI_CHAT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const OPENAI_SEARCH_MODEL = "gpt-4o-search-preview";
const COHERE_RERANK_ENDPOINT = "https://api.cohere.com/v2/rerank";
const COHERE_MODEL = "rerank-v3.5";
const MAX_RESEARCH_TOKENS = 1500;
const MAX_CTX_PER_CHUNK = 1000;
const CITATION_PREVIEW_CAP = 400;
const MAX_CONTEXT_CHUNKS = 40;
const MAX_PRE_RERANK_CHUNKS = 60;
// v5.6 — hoeveel fragmenten het antwoordmodel uiteindelijk ziet. Was gelijk aan
// MAX_CONTEXT_CHUNKS (40); nu 24, en dat is een gevolg van een meting.
//
// De vector-arm van match_chunks levert nooit meer rijen dan `hnsw.ef_search`,
// en die staat op de pgvector-default van 40 (EXPLAIN: "LIMIT 800 … rows=40").
// Zolang BM25 het gat vulde viel dat niet op; sinds WP1 staat BM25 uit op het
// chat-recept en levert context-build dus exact 40. En `rerankChunks()` slaat
// zichzelf over zodra `chunks.length <= topN` — met 40 in en 40 uit vuurde de
// Cohere-reranker niet meer. Snellere retrieval, slechtere volgorde.
//
// De knop rechtstreeks omhoog draaien kan niet: `ALTER FUNCTION … SET
// hnsw.ef_search`, `ALTER ROLE … SET` en `ALTER DATABASE … SET` geven op deze
// managed instance alle drie "permission denied to set parameter"; alleen een
// sessie-`SET LOCAL` mag. Gemeten zou 120 de gevraagde 60 wél opleveren voor
// +225 ms — zie de follow-up in AGENT-REBUILD.md (plpgsql-wrapper of Supabase).
//
// Dus de andere kant van dezelfde ruil: houd de pool op 40 en verklein wat we
// bewaren. 24 door Cohere gerangschikte fragmenten zijn een beter antwoord-
// context dan 40 op RRF+recency gesorteerde, en het scheelt ook nog invoer-
// tokens bij het antwoordmodel. Eén constante terugdraaien = oude gedrag.
const CHAT_CONTEXT_CHUNKS = 24;
const MAX_RPC_MAILS = 15;
const MAX_RPC_EVENTS = 8;
const MAX_RPC_NOTES = 8;
const MAX_RPC_FIREFLIES = 3;
// 6s (was 4s): onder parallelle load (eval-runs, agent-subcalls) time-outte
// context-build → "0 fragmenten" → onnodige agent-escalatie op semantic-vragen.
const CONTEXT_BUILD_TIMEOUT_MS = 6_000;
const SKIP_CONTEXT_BUILD_IF_RPC_CHUNKS = 8;

// ── v6.0: hop- en run-constanten (RESEARCH §3.4–§3.5) ────────────────────────
// Een hop start geen nieuwe agent-beurt meer na HOP_SOFT_MS en stopt hard op
// HOP_HARD_MS: slechtste beurt = 60 s OpenAI-call + 30 s semantic_search → een hop
// blijft onder 150 s en ver onder de 400 s van het Pro-plan. Het compat-pad kapt het
// run-budget op COMPAT_WALL_MS omdat de gateway een niet-streamende call na 150 s
// zonder byte met een 504 beantwoordt (gemeten M2b/M2c) — exact het oude gedrag.
export const HOP_SOFT_MS = 60_000;
export const HOP_HARD_MS = 170_000;
export const COMPAT_WALL_MS = 140_000;
export const RAG_CHAT_VERSION = "v6.0";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SELF_URL = `${SUPABASE_URL}/functions/v1/rag-chat`;
const UA = "legal-mind-rag-chat/6.0";
const TERMINAL = ["done", "failed", "cancelled"];

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
export type Budget = { tool_calls: number; wall_ms: number; usd: number; hops_max: number; source?: string };
// Startwaarden = RESEARCH §3.4 (AANNAME tot de bank ze vervangt); agent_config wint.
const DEFAULT_BUDGETS: Record<Effort, Budget> = {
  low:    { tool_calls: 2,  wall_ms: 30_000,  usd: 0.05, hops_max: 2 },
  medium: { tool_calls: 6,  wall_ms: 90_000,  usd: 0.15, hops_max: 3 },
  high:   { tool_calls: 12, wall_ms: 240_000, usd: 0.50, hops_max: 5 },
  xhigh:  { tool_calls: 20, wall_ms: 180_000, usd: 1.00, hops_max: 6 },
  max:    { tool_calls: 40, wall_ms: 600_000, usd: 2.00, hops_max: 10 },
};
// Intake-heuristiek voor xhigh op de agentic route ("grondige analyse / rapport /
// per klant" — RO37/RO38); een expliciet body.effort wint altijd. AANNAME.
const XHIGH_RE = /\b(grondig|grondige|uitgebreid|uitgebreide|diepgaand|diepgaande|rapport|volledige analyse|volledig overzicht|per klant|alle klanten)\b/i;

export async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  const { data: vaultValue } = await supabase.rpc("get_skill_secret_service", { p_skill_name: agentName, p_secret_name: key });
  if (typeof vaultValue === "string" && vaultValue.length > 0) return vaultValue;
  const { data } = await supabase.from("agent_config").select("config_value").eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === "string" ? data.config_value : String(data.config_value);
}

async function getPreferenceAdditions(supabase: SupabaseClient, prefs: { style?: string | null; tone?: string | null; focus?: string | null }): Promise<string> {
  const slugs = [prefs.style, prefs.tone, prefs.focus].filter((s): s is string => !!s);
  if (slugs.length === 0) return "";
  try {
    const { data } = await supabase.from("rag_chat_writing_styles").select("category, slug, prompt_addition").in("slug", slugs);
    if (!Array.isArray(data) || data.length === 0) return "";
    const byCategory = new Map<string, string>();
    for (const row of data) {
      const add = (row.prompt_addition || "").trim();
      if (add) byCategory.set(row.category, add);
    }
    const ordered = ["style", "tone", "focus"].map((c) => byCategory.get(c)).filter(Boolean);
    return ordered.join("\n\n");
  } catch { return ""; }
}

function deriveSubject(m: any): string | null {
  const content: string = m.preview || m.content || "";
  const ctx: string = m.content_with_context || "";
  const subjMatch = content.match(/^Subject:\s*(.+?)$/im);
  if (subjMatch && subjMatch[1].trim()) return subjMatch[1].trim().slice(0, 140);
  const quoteMatch = ctx.match(/["„]([^"„]{3,140})["„]/);
  if (quoteMatch) return quoteMatch[1].trim();
  const lines = content.split("\n").map((l: string) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (/^\[.+\]$/.test(line)) continue;
    if (/^From:|^To:|^Cc:|^Date:/i.test(line)) continue;
    return line.slice(0, 140);
  }
  return null;
}

// WP2 (v5.6) — alleen nog `rag_resolve_entity`. De ILIKE-substringfallback die
// hier stond is verwijderd, en dat is een gedragswijziging met een reden.
//
// Die fallback hield elk woord van ≥3 tekens dat niet in STOP_WORDS staat tegen
// bedrijfs- en dealnamen, en accepteerde een bedrijf zodra de gematchte term
// meer dan 20 % van de bedrijfsnaam besloeg. Gemeten gevolg (SKILLS-CHAT.md,
// bevinding 4): de vraag "…het **search**-recept…" resolveerde naar
// "Indicia Search & Advertising B.V." met confidence 0,72.
//
// Een verkeerd herkende entity is niet één verkeerd label. Hij zet drie dingen
// tegelijk in gang: vijf tijdlijn-RPC's op de verkeerde onderneming, het
// overslaan van context-build zodra die tijdlijn ≥ 8 chunks oplevert, en (tot
// v5.6) het uitschakelen van de zelfheling. De vraag werd dan nooit meer
// semantisch doorzocht, terwijl de interface "Entity herkend" meldde.
//
// `rag_resolve_entity` heeft een harde distinctive-token-gate in de RPC en
// weigert generieke woorden. Dat is precies de eigenschap die de ILIKE-variant
// miste. Verliezen we hiermee treffers? Ja — namen die alleen als substring in
// een langere HubSpot-naam voorkomen. Die komen nu via de gewone semantische
// route binnen, en dat is de goede plek: daar staat een drempel op.
async function tryResolveEntity(supabase: SupabaseClient, query: string): Promise<any | null> {
  try {
    const { data: rpcHit } = await supabase.rpc("rag_resolve_entity", { p_query: query });
    if (Array.isArray(rpcHit) && rpcHit.length > 0 && rpcHit[0]?.entity_id) {
      const h = rpcHit[0];
      return {
        entity_type: h.entity_type, entity_id: h.entity_id, name: h.name,
        via: h.via, matched_term: h.matched_term,
        confidence: Number(h.confidence) || 0.7,
        duplicate_count: h.duplicate_count > 1 ? h.duplicate_count : undefined,
      };
    }
  } catch (_e) { /* geen entity is een geldige uitkomst, geen fout */ }
  return null;
}

function inheritEntityFromHistory(history: any[]): any | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.role === "assistant" && h.entity_used) return { ...h.entity_used, via: "inherited_from_history" };
  }
  return null;
}

// Vragenbak v2 (2026-07-07): churn-status hoort in de entity-context. Zonder
// dit zag een "hoe gaat het met X"-vraag alleen oude (positieve) mailcontext
// terwijl de klant al vertrokken was.
async function fetchChurnChunk(supabase: SupabaseClient, companyId: string, entity: any): Promise<any | null> {
  try {
    const { data } = await supabase.from("churn_customers")
      .select("company_name, churned_at, detected_at, new_provider, churn_summary, user_note")
      .eq("company_id", String(companyId)).eq("superseded", false)
      .order("detected_at", { ascending: false }).limit(1).maybeSingle();
    if (!data) return null;
    const when = data.churned_at ? new Date(data.churned_at).toLocaleDateString("nl-NL") : "datum onbekend";
    return {
      chunk_id: `rpc-churn-${companyId}`, source: "churn", id: companyId,
      occurred_at: data.churned_at || data.detected_at, similarity: null,
      subject: `KLANTSTATUS: ${data.company_name} is gechurnd (${when})`,
      preview: [
        `KLANTSTATUS — deze klant is GECHURND per ${when}${data.new_provider ? `, overgestapt naar ${data.new_provider}` : ""}.`,
        "",
        data.churn_summary ? `Reden (churn-administratie): ${data.churn_summary}` : null,
        data.user_note ? `Notitie Jelle: ${data.user_note}` : null,
      ].filter(Boolean).join("\n"),
      entity_path: `${entity.entity_type}:${entity.entity_id}`, via: "rpc_churn_status",
    };
  } catch { return null; }
}

async function fetchEntityTimelineChunks(supabase: SupabaseClient, entity: any): Promise<any[]> {
  const chunks: any[] = [];
  if (entity.entity_type === "company") {
    const [mails, events, notes, fireflies, churn] = await Promise.all([
      supabase.rpc("get_company_mails", { p_hubspot_company_id: entity.entity_id, p_exclude_conversation_id: null }),
      supabase.rpc("get_company_events", { p_hubspot_company_id: entity.entity_id, p_lookback_days: 730 }),
      supabase.rpc("get_company_notes", { p_hubspot_company_id: entity.entity_id, p_lookback_days: 730 }),
      supabase.rpc("get_company_fireflies", { p_hubspot_company_id: entity.entity_id, p_lookback_days: 730, p_limit: MAX_RPC_FIREFLIES }),
      fetchChurnChunk(supabase, entity.entity_id, entity),
    ]);
    pushMailChunks(chunks, mails.data || [], entity);
    pushEventChunks(chunks, events.data || [], entity);
    pushNoteChunks(chunks, notes.data || [], entity);
    pushFirefliesChunks(chunks, fireflies.data || [], entity);
    if (churn) chunks.push(churn);
  } else if (entity.entity_type === "contact") {
    const { data: contact } = await supabase.from("hubspot_contacts").select("contact_id, email, associated_company_id").eq("contact_id", entity.entity_id).maybeSingle();
    if (!contact?.email) return chunks;
    const [mails, events, notes, fireflies, churn] = await Promise.all([
      supabase.rpc("get_sender_history", { p_from_email: contact.email, p_exclude_conversation_id: null }),
      supabase.rpc("get_sender_events", { p_from_email: contact.email, p_lookback_days: 730 }),
      supabase.rpc("get_contact_notes_full", { p_hubspot_contact_id: contact.contact_id, p_lookback_days: 730 }),
      supabase.rpc("get_sender_fireflies", { p_from_email: contact.email, p_lookback_days: 730, p_limit: MAX_RPC_FIREFLIES }),
      contact.associated_company_id ? fetchChurnChunk(supabase, contact.associated_company_id, entity) : Promise.resolve(null),
    ]);
    pushMailChunks(chunks, mails.data || [], entity);
    pushEventChunks(chunks, events.data || [], entity);
    pushNoteChunks(chunks, notes.data || [], entity);
    pushFirefliesChunks(chunks, fireflies.data || [], entity);
    if (churn) chunks.push(churn);
  }
  chunks.sort((a, b) => new Date(b.occurred_at || 0).getTime() - new Date(a.occurred_at || 0).getTime());
  return chunks;
}

function pushMailChunks(out: any[], rows: any[], entity: any) {
  for (const r of rows.slice(0, MAX_RPC_MAILS)) {
    if (r.latest_is_calendar_invite) continue;
    out.push({ chunk_id: `rpc-mail-${r.conversation_id}`, source: "mail", id: r.latest_mail_id || r.conversation_id, occurred_at: r.thread_latest_at || r.latest_received_at, similarity: null, subject: r.latest_subject, from_name: r.latest_from_name,
      preview: [ `Subject: ${r.latest_subject || "(geen onderwerp)"}`, `From: ${r.latest_from_name || r.latest_from_email || "?"}`, `Thread: ${r.thread_count || 1} bericht${(r.thread_count || 1) === 1 ? "" : "en"} (${r.thread_first_at ? new Date(r.thread_first_at).toLocaleDateString("nl-NL") : "?"} → ${r.thread_latest_at ? new Date(r.thread_latest_at).toLocaleDateString("nl-NL") : "?"})`, "", r.latest_body_preview || "" ].join("\n"),
      entity_path: `${entity.entity_type}:${entity.entity_id}`, via: "rpc_timeline" });
  }
}
function pushEventChunks(out: any[], rows: any[], entity: any) {
  for (const r of rows.slice(0, MAX_RPC_EVENTS)) {
    out.push({ chunk_id: `rpc-event-${r.event_id}`, source: r.start_time && new Date(r.start_time) > new Date() ? "agenda" : "meeting", id: r.event_id, occurred_at: r.start_time, similarity: null, subject: r.subject || r.title,
      preview: [ `Subject: ${r.subject || r.title || "(meeting)"}`, r.location ? `Location: ${r.location}` : null, r.attendees?.length ? `Attendees: ${r.attendees.slice(0, 5).map((a: any) => a.name || a.email).filter(Boolean).join(", ")}` : null, "", r.body_preview || "" ].filter(Boolean).join("\n"),
      entity_path: `${entity.entity_type}:${entity.entity_id}`, via: "rpc_timeline" });
  }
}
function pushNoteChunks(out: any[], rows: any[], entity: any) {
  for (const r of rows.slice(0, MAX_RPC_NOTES)) {
    const rawBody = r.body_text || r.body_preview || "";
    const cleanBody = rawBody.replace(/<\/?(p|div|br|span|strong|em|b|i|u)[^>]*>/gi, " ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
    out.push({ chunk_id: `rpc-note-${r.engagement_id}`, source: "note", id: r.engagement_id, occurred_at: r.hs_timestamp, similarity: null, subject: r.title || "HubSpot-notitie",
      preview: [`HubSpot-notitie${r.owner_name ? ` door ${r.owner_name}` : ""}`, "", cleanBody].join("\n"),
      entity_path: `${entity.entity_type}:${entity.entity_id}`, via: "rpc_timeline" });
  }
}
function pushFirefliesChunks(out: any[], rows: any[], entity: any) {
  for (const r of rows.slice(0, MAX_RPC_FIREFLIES)) {
    const date = r.date_time ? new Date(r.date_time).toLocaleDateString("nl-NL") : "?";
    const dur = r.duration_min ? `${r.duration_min}min` : "";
    const attendeeNames = Array.isArray(r.attendees)
      ? r.attendees.slice(0, 8).map((a: any) => a?.name || a?.displayName || a?.email).filter(Boolean).join(", ")
      : "";
    out.push({
      chunk_id: `rpc-fireflies-meta-${r.meeting_id}`,
      source: "meeting",
      id: r.meeting_id,
      occurred_at: r.date_time,
      similarity: null,
      subject: r.title || "(Fireflies-meeting)",
      preview: [
        `Subject: ${r.title || "(geen titel)"}`,
        `Datum: ${date}${dur ? ` (${dur})` : ""}`,
        attendeeNames ? `Deelnemers: ${attendeeNames}` : null,
        "",
        r.summary_text ? `Samenvatting:\n${r.summary_text}` : null,
        r.action_items_text ? `\nActiepunten:\n${r.action_items_text}` : null,
      ].filter(Boolean).join("\n"),
      entity_path: `${entity.entity_type}:${entity.entity_id}`,
      via: "rpc_timeline_fireflies",
    });
    const segments: string[] = Array.isArray(r.transcript_segments) ? r.transcript_segments : [];
    const segLabels = ["start", "vroeg", "midden", "eind"];
    for (let i = 0; i < segments.length; i++) {
      const seg = (segments[i] || "").trim();
      if (!seg) continue;
      out.push({
        chunk_id: `rpc-fireflies-seg-${r.meeting_id}-${i}`,
        source: "meeting",
        id: r.meeting_id,
        occurred_at: r.date_time,
        similarity: null,
        subject: `${r.title || "Meeting"} — transcript-${segLabels[i] || i}`,
        preview: [
          `Subject: ${r.title || "(meeting)"} — transcript-${segLabels[i] || i}`,
          `Datum: ${date}`,
          "",
          seg,
        ].join("\n"),
        entity_path: `${entity.entity_type}:${entity.entity_id}`,
        via: "rpc_timeline_fireflies",
      });
    }
  }
}

async function rerankChunks(apiKey: string | null, query: string, chunks: any[], topN: number): Promise<{ chunks: any[]; used: boolean; ms?: number; error?: string }> {
  if (!apiKey || chunks.length <= topN) return { chunks: chunks.slice(0, topN), used: false };
  const t0 = Date.now();
  try {
    const documents = chunks.map((c) => (c.preview || c.content || "").slice(0, 1200));
    const res = await fetch(COHERE_RERANK_ENDPOINT, { method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: COHERE_MODEL, query, documents, top_n: topN }), signal: AbortSignal.timeout(8_000) });
    if (!res.ok) { const txt = await res.text().catch(() => ""); return { chunks: chunks.slice(0, topN), used: false, error: `cohere_${res.status}: ${txt.slice(0, 200)}`, ms: Date.now() - t0 }; }
    const json = await res.json();
    const results: Array<{ index: number; relevance_score: number }> = json.results || [];
    return { chunks: results.map((r) => ({ ...chunks[r.index], rerank_score: r.relevance_score })), used: true, ms: Date.now() - t0 };
  } catch (e) { return { chunks: chunks.slice(0, topN), used: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 }; }
}

async function callOpenAIResearch(apiKey: string, question: string): Promise<{ webText: string; web_citations: any[]; ms: number }> {
  const t0 = Date.now();
  const messages = [
    { role: "system", content: "Je bent een onderzoeksassistent. Zoek het web voor de gevraagde info en lever feiten + bronnen op. Geen mening, geen samenvatting, alleen feiten met URL's." },
    { role: "user", content: `Onderzoek het web en lever feiten op over:\n${question}\n\nGeef een opsomming van relevante feiten (5-10 bullets). Elk feit MET de URL waar het vandaan komt aan het eind. Geen inleiding, geen vervolgvragen, alleen feiten + URL's.` },
  ];
  const body = { model: OPENAI_SEARCH_MODEL, messages, max_tokens: MAX_RESEARCH_TOKENS, web_search_options: { search_context_size: "medium" } };
  const res = await fetch(OPENAI_CHAT_ENDPOINT, { method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
  const text = await res.text();
  if (!res.ok) { console.error("[rag-chat] openai research error", res.status, text.slice(0, 500)); throw new Error(`openai_${res.status}: ${text.slice(0, 300)}`); }
  const json = JSON.parse(text);
  const msg = json.choices?.[0]?.message || {};
  const webText: string = msg.content || "";
  const annotations: any[] = Array.isArray(msg.annotations) ? msg.annotations : [];
  const web_citations = annotations.filter((a) => a?.type === "url_citation" && a?.url_citation?.url).map((a) => ({ url: a.url_citation.url, title: a.url_citation.title || null, snippet: a.url_citation.snippet || null, source: "web" }));
  return { webText, web_citations, ms: Date.now() - t0 };
}

// v1.141 — heeft de VRAGER een gespiegelde mailbox? Zo ja, dan krijgt de
// agentic-loop er één tool bij die in díe spiegel zoekt (`my_mail_search`).
// Zo nee (of gaat er iets mis), dan blijft alles exact zoals het was — geen
// tool, geen fout, geen zichtbaar verschil.
//
// De bron is `mail_accounts`, NIET `user_connectors`: de chat leest uit de
// spiegel, dus de vraag is "bestaat er een spiegel voor deze gebruiker", niet
// "heeft hij een OAuth-grant". Een gebruiker die loskoppelt houdt zijn al
// gespiegelde mail (rij wordt gepauzeerd, niet verwijderd) en kan die dus
// blijven bevragen — er komt alleen niets meer bij.
//
// De `sub` komt uit de Authorization-header; cron-calls hebben die niet en
// krijgen dus nooit iemands persoonlijke mailbox te zien.
export function callerSub(req: Request): string | null {
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role === "authenticated" && typeof payload.sub === "string" ? payload.sub : null;
  } catch { return null; }
}

// v6.0: op user-id in plaats van op de Request — een latere hop heeft geen
// gebruikersrequest meer, alleen de run-rij met caller_user_id.
export async function loadMirrorCtx(supabase: any, sub: string | null): Promise<MirrorCtx | null> {
  try {
    if (!sub) return null;
    const { data: acct } = await supabase.from("mail_accounts")
      .select("mailbox_email").eq("user_id", sub).limit(1).maybeSingle();
    if (!acct) return null;
    // Leeg gespiegeld = geen bruikbare tool. Beter niet aanbieden dan de agent
    // laten concluderen dat er "geen mail over X is" terwijl er nog niets staat.
    const { count } = await supabase.from("mail_messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", sub).eq("is_deleted", false);
    if (!count || count === 0) return null;
    return { userId: sub, mailbox: acct.mailbox_email ?? null, mailCount: count };
  } catch { return null; }
}



// =============================================================================
// v6.0 — de motor
// =============================================================================
export type RunMode = "run" | "compat_stream" | "compat_json";
export type RunRequest = {
  message: string; history: any[]; filter_sources: string[] | null; force_no_entity: boolean;
  web_search: boolean; writing_style: string | null; tone: string | null; focus: string | null;
  eval_run_id: string | null; effort_requested: Effort | null; mode: RunMode;
};
export type HopMode = { inline: boolean; emit?: (ev: any) => void; onDelta?: (text: string) => void; t0?: number };
export type HopResult = {
  done: boolean; paused?: boolean; skipped?: string; row: any | null;
  result?: CompatResult | null; error?: { code: string; message: string; http: number } | null;
};
export type CompatResult = {
  answer: string; metaPayload: any; envelope: any; web_citations: any[];
  timing_ms: { total: number; grok: number }; tokens: { retrieval: number; chat_in: number; chat_out: number };
  finish_reason: string | null; streamError: string | null;
};
type Spent = {
  usd: number; wall_ms: number; tool_calls: number; hops: number; cohere_calls: number;
  tokens: { openai_in: number; openai_cached: number; openai_out: number; router: number; grok_in: number; grok_out: number; embed: number };
};
type Research = {
  decision: any | null; gateHit: boolean; entityHint: any | null; rpcChunkCount: number; rpcFireflies: number;
  cb: any; vectorChunkCount: number; skipContextBuild: boolean; rerankUsed: boolean; coverageReason: string | null;
  selfHeal: boolean; matches: any[]; webResearch: any | null;
};
type Ctx = {
  supabase: any; runId: string; hop: number; lease: string; hopStart: number; runStartMs: number; t0: number;
  mode: HopMode; inline: boolean; row: any; state: any; req: RunRequest;
  keys: { grokKey: string | null; openaiKey: string | null; cohereKey: string | null; cronSecret: string | null };
  ownerId: string | null; callerUserId: string | null; mirrorCtx: MirrorCtx | null;
  budgets: Record<Effort, Budget>; pricing: Pricing; budget: Budget; effort: Effort;
  dbg: any; steps: any[]; spent: Spent; phaseLabel: string; currentStage: string;
  q: Promise<unknown>; leaseLost: boolean;
  analytics: any | null; research: Research | null; compose: any | null; webPromise: Promise<any> | null;
};

class LeaseLost extends Error { constructor() { super("lease_lost"); } }
export class ProviderError extends Error {
  provider: string; status: number | null;
  constructor(provider: string, status: number | null, message: string) { super(message); this.provider = provider; this.status = status; }
}
class ConfigError extends Error { code = "config"; }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export function waitUntil(p: Promise<unknown>) {
  try { (globalThis as any).EdgeRuntime?.waitUntil?.(p); } catch { /* lokaal/geen EdgeRuntime: de promise loopt gewoon door */ }
}
// Een 429 of 5xx van een leverancier (openai_429, grok_stream_503, context-build_500 …).
function providerErrorOf(e: unknown, fallbackProvider = "openai"): ProviderError | null {
  if (e instanceof ProviderError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/^(openai|grok(?:_stream)?|context-build|cohere)_(\d{3})/);
  if (!m) return null;
  const status = Number(m[2]);
  if (status !== 429 && status < 500) return null;
  const provider = m[1].startsWith("grok") ? "grok" : m[1] === "context-build" ? "context-build" : m[1];
  return new ProviderError(provider || fallbackProvider, status, msg.slice(0, 300));
}

// ── Config: budgetten en prijzen (agent_config, constanten als fallback) ──────
async function getCfgJson(supabase: SupabaseClient, key: string): Promise<any | null> {
  try {
    const { data } = await supabase.from("agent_config").select("config_value").eq("agent_name", "rag-chat").eq("config_key", key).maybeSingle();
    return data?.config_value ?? null;
  } catch { return null; }
}
async function loadBudgets(supabase: SupabaseClient): Promise<Record<Effort, Budget>> {
  const cfg = await getCfgJson(supabase, "run_budgets");
  const out = { ...DEFAULT_BUDGETS };
  if (cfg && typeof cfg === "object") {
    for (const e of EFFORTS) {
      const c = cfg[e];
      if (!c || typeof c !== "object") continue;
      out[e] = {
        tool_calls: Number(c.tool_calls) > 0 ? Number(c.tool_calls) : DEFAULT_BUDGETS[e].tool_calls,
        wall_ms: Number(c.wall_ms) > 0 ? Number(c.wall_ms) : DEFAULT_BUDGETS[e].wall_ms,
        usd: Number(c.usd) > 0 ? Number(c.usd) : DEFAULT_BUDGETS[e].usd,
        hops_max: Number(c.hops_max) > 0 ? Number(c.hops_max) : DEFAULT_BUDGETS[e].hops_max,
      };
    }
  }
  return out;
}
async function loadPricing(supabase: SupabaseClient): Promise<Pricing> {
  const cfg = await getCfgJson(supabase, "pricing");
  return cfg && typeof cfg === "object" ? cfg as Pricing : null;
}
export function parseEffort(v: unknown): Effort | null {
  return typeof v === "string" && (EFFORTS as string[]).includes(v) ? v as Effort : null;
}
function deriveEffort(route: string | null, question: string): { effort: Effort; source: string } {
  if (route === "structured" || route === "sweep") return { effort: "low", source: "route" };
  if (route === "semantic") return { effort: "medium", source: "route" };
  if (XHIGH_RE.test(question)) return { effort: "xhigh", source: "heuristic" };
  return { effort: "high", source: "route" };
}
const EFFORT_RANK: Record<Effort, number> = { low: 0, medium: 1, high: 2, xhigh: 3, max: 4 };
function openaiPrice(pricing: Pricing, model: string) {
  return pricing?.openai?.[model] ?? agenticPriceFor(model);
}
function loopUsd(st: AgenticLoopState, p: { in: number; cached: number; out: number }): number {
  const fresh = Math.max(0, st.tok_in - st.tok_cached);
  return (fresh * p.in + st.tok_cached * p.cached + st.tok_out * p.out) / 1_000_000;
}
const PHASE: Record<string, string> = {
  queued: "In de wachtrij", planning: "Vraag interpreteren…", researching: "Onderzoeken…",
  composing: "Antwoord schrijven…", done: "Klaar", failed: "Mislukt", cancelled: "Geannuleerd", needs_input: "Wacht op je antwoord",
};
const ROUTE_PHASE: Record<string, string> = {
  structured: "Exacte data ophalen…", sweep: "Mailarchief scannen…", agentic: "Agent-onderzoek…", semantic: "Zoeken in de kennisindex…",
};

// ── Schrijven: altijd met het lease-token (fencing) ──────────────────────────
async function writeRun(ctx: Ctx, patch: Record<string, unknown>): Promise<boolean> {
  if (ctx.leaseLost) return false;
  const { data, error } = await ctx.supabase.from("agent_chat_runs").update(patch).eq("id", ctx.runId).eq("hop_lease", ctx.lease).select("id");
  if (error) { console.error("[rag-chat] run update failed", error.message); return false; }
  if (!Array.isArray(data) || data.length === 0) { ctx.leaseLost = true; return false; }
  return true;
}
async function writeState(ctx: Ctx, patch: Record<string, unknown>): Promise<void> {
  const { error } = await ctx.supabase.from("agent_chat_run_state").update(patch).eq("run_id", ctx.runId);
  if (error) console.error("[rag-chat] state update failed", error.message);
}
// Eén schrijfrij per hop: stappen en tussenstanden komen in volgorde aan en een
// oudere snapshot kan een nieuwere nooit overschrijven.
function queue(ctx: Ctx, fn: () => Promise<unknown>): Promise<unknown> {
  ctx.q = ctx.q.then(fn).catch((e) => console.error("[rag-chat] queued write failed", e instanceof Error ? e.message : String(e)));
  return ctx.q;
}
function pushStep(ctx: Ctx, label: string, detail?: string | null, stage?: string, extra?: { args?: string; findings?: any[] }) {
  const step = {
    t: Date.now() - ctx.t0, stage: stage || null, label,
    ...(detail ? { detail } : {}),
    ...(extra?.args ? { args: extra.args } : {}),
    ...(extra?.findings?.length ? { findings: extra.findings.slice(0, 5) } : {}),
  };
  ctx.steps.push(step);
  try { ctx.mode.emit?.({ type: "status", step }); } catch { /* stream al dicht */ }
  queue(ctx, () => writeRun(ctx, { steps: ctx.steps.slice(0, 40), phase_label: ctx.phaseLabel }));
}
function setPhase(ctx: Ctx, stage: string, label?: string) {
  ctx.currentStage = stage;
  ctx.phaseLabel = label || PHASE[stage] || stage;
  queue(ctx, () => writeRun(ctx, { state: stage, phase_label: ctx.phaseLabel }));
}
function hopsEnded(ctx: Ctx, reason: string): any[] {
  const hops: any[] = Array.isArray(ctx.row.hops) ? [...ctx.row.hops] : [];
  const i = hops.findIndex((h) => h?.n === ctx.hop);
  const now = Date.now();
  const startedAt = i >= 0 && hops[i].started_at ? new Date(hops[i].started_at).getTime() : ctx.hopStart;
  const rec = { n: ctx.hop, started_at: new Date(startedAt).toISOString(), ended_at: new Date(now).toISOString(), ms: now - startedAt, end_reason: reason };
  if (i >= 0) hops[i] = rec; else hops.push(rec);
  ctx.row.hops = hops.slice(-40);
  return ctx.row.hops;
}
function spentPatch(ctx: Ctx): Spent {
  ctx.spent.wall_ms = Date.now() - ctx.runStartMs;
  ctx.spent.hops = ctx.hop;
  return ctx.spent;
}
function spawnNext(runId: string, hop: number) {
  const p = fetch(SELF_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY, "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ _run_id: runId, _hop: hop }),
  }).then((r) => r.text()).catch((e) => console.error("[rag-chat] chain spawn failed", e instanceof Error ? e.message : String(e)));
  waitUntil(p);
}
function stripAnalytics(a: any | null): any | null {
  if (!a) return null;
  const { rows, tools_used, ...rest } = a;
  return {
    ...rest,
    rows: Array.isArray(rows) ? rows.slice(0, 100) : [],
    ...(Array.isArray(tools_used) ? { tools_used: tools_used.slice(0, 40) } : {}),
  };
}

// ── Run aanmaken ─────────────────────────────────────────────────────────────
export async function createRun(supabase: SupabaseClient, p: {
  req: RunRequest; ownerId: string | null; callerUserId: string | null; origin: string; sessionId: string | null;
}): Promise<{ id: string; row: any; budget: Budget; effort: Effort }> {
  const budgets = await loadBudgets(supabase);
  const effort: Effort = p.req.effort_requested ?? "high";
  const budget: Budget = { ...budgets[effort], source: p.req.effort_requested ? "body" : "default" };
  const wall = p.req.mode === "run" ? budget.wall_ms : Math.min(budget.wall_ms, COMPAT_WALL_MS);
  const id = crypto.randomUUID();
  const { data: row, error } = await supabase.from("agent_chat_runs").insert({
    id, session_id: p.sessionId, owner_id: p.ownerId, caller_user_id: p.callerUserId, origin: p.origin,
    eval_run_id: p.req.eval_run_id, question: p.req.message.slice(0, 2000), effort, budget,
    state: "queued", phase_label: PHASE.queued,
    deadline_at: new Date(Date.now() + wall + 60_000).toISOString(),
  }).select("*").single();
  if (error || !row) throw new Error(`run_insert_failed: ${error?.message ?? "no row"}`);
  const { history, ...request } = p.req;
  const { error: sErr } = await supabase.from("agent_chat_run_state").insert({ run_id: id, history, request, dbg: {} });
  if (sErr) throw new Error(`run_state_insert_failed: ${sErr.message}`);
  return { id, row, budget, effort };
}

// ── Hervatten (browser met eigen JWT, of service): failed / stil > 60 s ──────
export async function resumeRun(supabase: SupabaseClient, runId: string): Promise<{ ok: boolean; reason?: string; row?: any }> {
  const { data: row } = await supabase.from("agent_chat_runs").select("*").eq("id", runId).maybeSingle();
  if (!row) return { ok: false, reason: "not_found" };
  if (row.state === "done" || row.state === "cancelled") return { ok: false, reason: `state_${row.state}` };
  if (row.state === "needs_input") return { ok: false, reason: "needs_input_first_answer_via_rpc" };
  const { data: st } = await supabase.from("agent_chat_run_state").select("run_id").eq("run_id", runId).maybeSingle();
  if (!st) return { ok: false, reason: "state_expired" };
  const stale = Date.now() - new Date(row.updated_at).getTime() > 60_000;
  if (row.state !== "failed" && !stale && row.hop_lease) return { ok: false, reason: "still_running" };
  const failedStage: string | null = row.state === "failed" ? (row.error?.stage ?? null) : null;
  const nextState = row.state === "failed"
    ? (!failedStage || failedStage === "queued" || failedStage === "planning" ? "queued" : failedStage)
    : row.state;
  const wall = Number(row.budget?.wall_ms) > 0 ? Number(row.budget.wall_ms) : DEFAULT_BUDGETS.high.wall_ms;
  const { data: upd, error } = await supabase.from("agent_chat_runs").update({
    state: nextState, hop_lease: null, hop_claimed_at: null, finished_at: null, answer_partial: null,
    phase_label: "Hervat", deadline_at: new Date(Date.now() + wall + 60_000).toISOString(),
    error: row.state === "failed" ? { ...(row.error ?? {}), resumed_at: new Date().toISOString() } : row.error,
  }).eq("id", runId).select("*").single();
  if (error || !upd) return { ok: false, reason: `resume_update_failed: ${error?.message ?? ""}` };
  return { ok: true, row: upd };
}

// ── Eén hop ──────────────────────────────────────────────────────────────────
export async function runHop(supabase: SupabaseClient, runId: string, hopN: number, mode: HopMode): Promise<HopResult> {
  const { data: claimed, error: claimErr } = await supabase.rpc("agent_chat_run_claim_hop", { p_run_id: runId });
  if (claimErr) throw new Error(`claim_failed: ${claimErr.message}`);
  const row = Array.isArray(claimed) && claimed.length > 0 ? claimed[0] : null;
  if (!row) return { done: true, skipped: "not_claimable", row: null };
  const { data: state } = await supabase.from("agent_chat_run_state").select("*").eq("run_id", runId).maybeSingle();
  if (!state) {
    await supabase.from("agent_chat_runs").update({ state: "failed", finished_at: new Date().toISOString(), hop_lease: null, phase_label: "Mislukt: tussenstand verlopen", error: { code: "internal", message: "agent_chat_run_state ontbreekt (opgeruimd of nooit geschreven)", hop: row.hop, stage: row.state } }).eq("id", runId).eq("hop_lease", row.hop_lease);
    return { done: true, row, error: { code: "internal", message: "run_state_missing", http: 500 } };
  }
  const req: RunRequest = { ...(state.request ?? {}), history: Array.isArray(state.history) ? state.history : [] } as RunRequest;
  const hopStart = Date.now();
  const ctx: Ctx = {
    supabase, runId, hop: row.hop, lease: row.hop_lease, hopStart, runStartMs: new Date(row.created_at).getTime(),
    t0: mode.t0 ?? new Date(row.created_at).getTime(),
    mode, inline: mode.inline, row, state, req,
    keys: { grokKey: null, openaiKey: null, cohereKey: null, cronSecret: null },
    ownerId: row.owner_id ?? null, callerUserId: row.caller_user_id ?? null, mirrorCtx: null,
    budgets: DEFAULT_BUDGETS, pricing: null, budget: { ...DEFAULT_BUDGETS.high, ...(row.budget ?? {}) }, effort: (row.effort as Effort) || "high",
    dbg: state.dbg && typeof state.dbg === "object" ? state.dbg : {},
    steps: Array.isArray(row.steps) ? [...row.steps] : [],
    spent: {
      usd: 0, wall_ms: 0, tool_calls: 0, hops: row.hop, cohere_calls: 0,
      tokens: { openai_in: 0, openai_cached: 0, openai_out: 0, router: 0, grok_in: 0, grok_out: 0, embed: 0 },
      ...(row.spent && typeof row.spent === "object" ? row.spent : {}),
    },
    phaseLabel: row.phase_label || PHASE[row.state] || "", currentStage: row.state,
    q: Promise.resolve(), leaseLost: false,
    analytics: null, research: null, compose: null, webPromise: null,
  };
  if (ctx.inline) ctx.budget = { ...ctx.budget, wall_ms: Math.min(ctx.budget.wall_ms, COMPAT_WALL_MS), compat_cap_ms: COMPAT_WALL_MS } as Budget;
  // hops[]: deze hop is begonnen. beforeunload (runtime-shutdown, wall-clock, geheugen):
  // schrijf de reden en geef de lease vrij — best effort, niet afgewacht.
  {
    const hops: any[] = Array.isArray(row.hops) ? [...row.hops] : [];
    hops.push({ n: row.hop, started_at: new Date(hopStart).toISOString() });
    ctx.row.hops = hops.slice(-40);
    queue(ctx, () => writeRun(ctx, { hops: ctx.row.hops, phase_label: ctx.phaseLabel }));
  }
  const onUnload = (ev: any) => {
    const reason = ev?.detail?.reason ?? "unknown";
    try { supabase.from("agent_chat_runs").update({ hop_lease: null, hops: hopsEnded(ctx, `beforeunload:${reason}`) }).eq("id", runId).eq("hop_lease", ctx.lease).then(() => {}, () => {}); } catch { /* best effort */ }
  };
  try { (globalThis as any).addEventListener?.("beforeunload", onUnload); } catch { /* geen EdgeRuntime */ }

  try {
    // Sleutels en config per hop (Vault-eerst via get_skill_secret_service).
    const [grokKey, openaiKey, cohereKey, cronSecret, budgets, pricing] = await Promise.all([
      getCfg(supabase, "legal-ai-research", "grok_api_key"),
      getCfg(supabase, "openai", "embedding_key"),
      getCfg(supabase, "rag-chat", "cohere_api_key"),
      getCfg(supabase, "global", "cron_secret"),
      loadBudgets(supabase),
      loadPricing(supabase),
    ]);
    ctx.keys = { grokKey, openaiKey, cohereKey, cronSecret };
    ctx.budgets = budgets; ctx.pricing = pricing;
    if (!grokKey) throw new ConfigError("grok_api_key_missing");
    if (req.web_search && !openaiKey) throw new ConfigError("openai_api_key_missing");
    if (!cronSecret) throw new ConfigError("cron_secret_missing");
    ctx.mirrorCtx = await loadMirrorCtx(supabase, ctx.callerUserId);
    ctx.dbg.mirror_available = !!ctx.mirrorCtx;
    ctx.dbg.caller_identified = !!ctx.callerUserId;
    ctx.dbg.web_search = req.web_search;
    ctx.dbg.prefs = { style: req.writing_style, tone: req.tone, focus: req.focus };
    ctx.dbg.run_id = runId;

    let stage: string = row.state;
    while (true) {
      if (ctx.leaseLost) throw new LeaseLost();
      if (stage === "planning") {
        await stagePlanning(ctx);
        stage = "researching";
      } else if (stage === "researching") {
        const r = await stageResearching(ctx);
        if (r.paused) return await pauseHop(ctx, "researching", "soft_budget");
        stage = "composing";
        // Ná een agent-lus die de hop al lang vulde: het antwoord in een verse hop
        // schrijven (compose kan 30–60 s duren). Structured/semantic composeren altijd
        // direct — daar is de hop nog jong.
        const agentUsed = ctx.analytics?.route === "agentic";
        if (!ctx.inline && agentUsed && Date.now() - ctx.hopStart >= HOP_SOFT_MS && ctx.hop < ctx.budget.hops_max) {
          return await pauseHop(ctx, "composing", "soft_budget");
        }
      } else if (stage === "composing") {
        const res = await stageComposing(ctx);
        const compat = await finishRun(ctx, res);
        return { done: true, row: ctx.row, result: compat };
      } else if (stage === "queued") {
        stage = "planning"; // claim zet queued → planning; defensief
      } else {
        throw new Error(`unexpected_state_${stage}`);
      }
    }
  } catch (e) {
    if (e instanceof LeaseLost || ctx.leaseLost) {
      console.error("[rag-chat] hop lost its lease", runId, ctx.hop);
      return { done: true, skipped: "lease_lost", row: ctx.row };
    }
    const err = await failRun(ctx, e);
    return { done: true, row: ctx.row, error: err };
  } finally {
    try { (globalThis as any).removeEventListener?.("beforeunload", onUnload); } catch { /* geen EdgeRuntime */ }
  }
}

async function pauseHop(ctx: Ctx, nextState: string, reason: string): Promise<HopResult> {
  await ctx.q;
  const hops = hopsEnded(ctx, reason);
  // Lease vrijgeven en pas dán de volgende hop starten; verliest deze hop de race, dan geen spawn.
  const ok = await writeRun(ctx, { state: nextState, hops, spent: spentPatch(ctx), steps: ctx.steps.slice(0, 40), phase_label: ctx.phaseLabel, hop_lease: null });
  if (!ok) return { done: true, skipped: "lease_lost_at_pause", row: ctx.row };
  if (ctx.hop >= ctx.budget.hops_max) {
    // Kan alleen als de lus 'stop' negeerde; niet stil laten hangen — de watchdog vangt hem anders pas na 5 min.
    console.error("[rag-chat] hops_max reached at pause", ctx.runId, ctx.hop);
  }
  spawnNext(ctx.runId, ctx.hop + 1);
  return { done: false, paused: true, row: ctx.row };
}

// ── Stage: planning (router) ─────────────────────────────────────────────────
async function stagePlanning(ctx: Ctx) {
  const { req } = ctx;
  setPhase(ctx, "planning");
  // ── Interpretatie-eerst (v5.4): de router draait op ELKE vraag ──────────
  // De regex-gate is geen poort meer (miste bv. "turn in april") — hij blijft
  // alleen als telemetrie in dbg/query-log. Elke fout of twijfel in de router
  // valt terug op het semantische pad.
  const gateText = req.message.length < 80
    ? [req.message, ...req.history.slice(-2).map((h: any) => (typeof h?.content === "string" ? h.content : ""))].join(" ")
    : req.message;
  const gateHit = routeGateHit(gateText);
  ctx.dbg.route_gate = gateHit;
  let decision: any = null;
  if (ctx.keys.openaiKey) {
    pushStep(ctx, "Vraag interpreteren", "welke aanpak past: exacte data, groeps-sweep, agent-onderzoek of semantisch zoeken?", "router");
    decision = await classifyRoute(ctx.keys.openaiKey, req.message, ctx.dbg, req.history);
    // v6.0 — een 429/5xx van OpenAI op de router is een storing, geen "semantic bij
    // twijfel": één nieuwe poging na 2 s, daarna failed{provider_error} (RESEARCH §3.5-5).
    const pe = ctx.dbg.router_error ? providerErrorOf(new Error(String(ctx.dbg.router_error))) : null;
    if (pe) {
      pushStep(ctx, "Leverancier gaf een fout bij het interpreteren — één nieuwe poging over 2 s", pe.message.slice(0, 80), "router");
      await sleep(2000);
      delete ctx.dbg.router_error;
      decision = await classifyRoute(ctx.keys.openaiKey, req.message, ctx.dbg, req.history);
      const pe2 = ctx.dbg.router_error ? providerErrorOf(new Error(String(ctx.dbg.router_error))) : null;
      if (pe2) throw pe2;
    }
    ctx.dbg.route = decision.route;
    ctx.spent.tokens.router = Number(ctx.dbg.router_tokens) || 0;
    const routeStep: Record<string, string> = {
      structured: `Route: exacte data (${decision.tool})`,
      sweep: "Route: groeps-sweep over het mailarchief",
      agentic: "Route: agent-onderzoek — combineert meerdere bronnen",
      semantic: "Route: semantisch zoeken in de kennisindex",
    };
    pushStep(ctx, routeStep[decision.route] || `Route: ${decision.route}`, decision.why || null, "route");
  }
  const route: string = decision?.route ?? "semantic";
  ctx.dbg.decision = decision ? { route: decision.route, why: decision.why ?? null, tool: decision.tool ?? null, params: decision.params ?? null, sweep: decision.sweep ?? null } : null;
  ctx.dbg.gate_hit = gateHit;
  // Effort: expliciet uit de body wint; anders bepaalt de route het (§3.4).
  if (!req.effort_requested) {
    const d = deriveEffort(route, req.message);
    ctx.effort = d.effort;
    ctx.budget = { ...ctx.budgets[d.effort], source: d.source };
    if (ctx.inline) ctx.budget = { ...ctx.budget, wall_ms: Math.min(ctx.budget.wall_ms, COMPAT_WALL_MS), compat_cap_ms: COMPAT_WALL_MS } as Budget;
  }
  const deadline = new Date(ctx.runStartMs + ctx.budget.wall_ms + 60_000).toISOString();
  ctx.phaseLabel = ROUTE_PHASE[route] || PHASE.researching;
  ctx.currentStage = "researching";
  queue(ctx, () => writeRun(ctx, { state: "researching", route, effort: ctx.effort, budget: ctx.budget, deadline_at: deadline, phase_label: ctx.phaseLabel, spent: spentPatch(ctx) }));
  queue(ctx, () => writeState(ctx, { dbg: ctx.dbg }));
}

// ── De agent-lus met hervat-punt ─────────────────────────────────────────────
async function runAgentLoop(ctx: Ctx, phase: "route" | "self_heal", resume: AgenticLoopState | null): Promise<{ paused: boolean; analytics: any | null }> {
  const cfgModel = await getCfg(ctx.supabase, "rag-chat", "agentic_model");
  const model = agenticModelFor(cfgModel);
  const price = openaiPrice(ctx.pricing, model);
  const key = ctx.keys.openaiKey!;
  const deadlineAt = ctx.runStartMs + ctx.budget.wall_ms;
  const hopDeadlineAt = ctx.inline ? null : ctx.hopStart + HOP_HARD_MS;
  let resumeState = resume;
  let attempt = 0;
  while (true) {
    try {
      const r = await runAgentic(ctx.supabase, key, ctx.req.message, ctx.dbg, cfgModel, ctx.req.history,
        (label, detail, stage, extra) => pushStep(ctx, label, detail, stage || "data", extra),
        ctx.keys.cronSecret, ctx.mirrorCtx, ctx.callerUserId, {
          budget: { tool_calls: ctx.budget.tool_calls, usd: ctx.budget.usd, deadline_at: deadlineAt },
          hopDeadlineAt, resume: resumeState, price, throwProviderErrors: true,
          onIteration: async (st) => {
            resumeState = st;
            ctx.spent.tokens.openai_in = st.tok_in; ctx.spent.tokens.openai_cached = st.tok_cached; ctx.spent.tokens.openai_out = st.tok_out;
            ctx.spent.tool_calls = st.tool_calls;
            ctx.spent.usd = estimateCostUsd({ embed_tokens: ctx.spent.tokens.embed, cohere_calls: ctx.spent.cohere_calls, grok_in: 0, grok_out: 0, analytics_usd: loopUsd(st, price) }, ctx.pricing);
            await queue(ctx, async () => {
              await writeState(ctx, {
                loop_messages: st.messages, evidence: st.evidence, trace: st.trace, dbg: ctx.dbg,
                loop_meta: { phase, iter: st.iter, tool_calls: st.tool_calls, tok_in: st.tok_in, tok_cached: st.tok_cached, tok_out: st.tok_out, scanned_total: st.scanned_total, model: st.model },
              });
              await writeRun(ctx, { spent: spentPatch(ctx), steps: ctx.steps.slice(0, 40), phase_label: ctx.phaseLabel });
            });
            if (ctx.leaseLost) throw new LeaseLost();
            if (ctx.inline) return "continue";
            if (Date.now() - ctx.hopStart >= HOP_SOFT_MS) return ctx.hop >= ctx.budget.hops_max ? "stop" : "pause";
            return "continue";
          },
        });
      if (r && r.paused) return { paused: true, analytics: null };
      if (r) {
        ctx.spent.tokens.openai_in = r.cost?.tokens_in ?? ctx.spent.tokens.openai_in;
        ctx.spent.tokens.openai_cached = r.cost?.tokens_cached ?? ctx.spent.tokens.openai_cached;
        ctx.spent.tokens.openai_out = r.cost?.tokens_out ?? ctx.spent.tokens.openai_out;
        ctx.spent.tool_calls = r.cost?.calls ?? ctx.spent.tool_calls;
      }
      queue(ctx, () => writeState(ctx, { loop_messages: null, loop_meta: null, dbg: ctx.dbg }));
      return { paused: false, analytics: r };
    } catch (e) {
      if (e instanceof LeaseLost) throw e;
      const pe = providerErrorOf(e, "openai");
      if (!pe) throw e;
      if (attempt === 0) {
        attempt++;
        pushStep(ctx, "Leverancier gaf een fout — één nieuwe poging over 2 s", pe.message.slice(0, 80), "route");
        delete ctx.dbg.agentic_error;
        await sleep(2000);
        continue;
      }
      throw pe;
    }
  }
}

function baseResearch(ctx: Ctx): Research {
  return {
    decision: ctx.dbg.decision ?? null, gateHit: !!ctx.dbg.gate_hit, entityHint: null, rpcChunkCount: 0, rpcFireflies: 0,
    cb: { matches: [], retrieval_strategy: null, bundle_id: null, coverage: null }, vectorChunkCount: 0, skipContextBuild: true,
    rerankUsed: false, coverageReason: null, selfHeal: false, matches: [], webResearch: null,
  };
}
function persistableResearch(r: Research) {
  const { matches: _m, webResearch: _w, ...rest } = r;
  const cb = r.cb ?? {};
  return { ...rest, cb: { bundle_id: cb.bundle_id ?? null, retrieval_strategy: cb.retrieval_strategy ?? null, coverage: cb.coverage ?? null, retrieval_meta: cb.retrieval_meta ? { tokens: cb.retrieval_meta.tokens ?? null } : null } };
}

// ── Stage: researching ───────────────────────────────────────────────────────
async function stageResearching(ctx: Ctx): Promise<{ paused: boolean }> {
  const st = ctx.state;
  const lm = st.loop_meta;
  let analytics: any = null;
  let research: Research;
  ctx.currentStage = "researching";
  if (lm && Array.isArray(st.loop_messages) && st.loop_messages.length > 0) {
    // Hervatten: de vorige hop pauzeerde midden in de agent-lus.
    const resume: AgenticLoopState = {
      messages: st.loop_messages, trace: Array.isArray(st.trace) ? st.trace : [], evidence: Array.isArray(st.evidence) ? st.evidence : [],
      tok_in: Number(lm.tok_in) || 0, tok_cached: Number(lm.tok_cached) || 0, tok_out: Number(lm.tok_out) || 0,
      tool_calls: Number(lm.tool_calls) || 0, scanned_total: Number(lm.scanned_total) || 0, iter: Number(lm.iter) || 0, model: String(lm.model || ""),
    };
    research = { ...baseResearch(ctx), ...(st.compose?.research ?? {}), matches: [], webResearch: null };
    ctx.phaseLabel = ROUTE_PHASE.agentic;
    pushStep(ctx, `Hop ${ctx.hop}: onderzoek hervat`, `${resume.tool_calls} tool-call(s) tot nu toe`, "route");
    const r = await runAgentLoop(ctx, lm.phase === "self_heal" ? "self_heal" : "route", resume);
    if (r.paused) return { paused: true };
    analytics = r.analytics;
    if (!analytics && lm.phase !== "self_heal") {
      ctx.dbg.route_fallback = "motor_null_to_semantic";
      pushStep(ctx, "Route gaf niets bruikbaars — terug naar semantisch zoeken", null, "route");
      const sem = await semanticResearch(ctx, research);
      if (sem.paused) return { paused: true };
      analytics = sem.analytics; research = sem.research;
    } else if (analytics && lm.phase === "self_heal") {
      ctx.dbg.route_fallback = "semantic_low_context_to_agentic";
    }
  } else {
    research = baseResearch(ctx);
    const m = await motorStep(ctx, research);
    if (m.paused) return { paused: true };
    analytics = m.analytics;
    ctx.dbg.analytics_used = !!analytics;
    if (!analytics) {
      const sem = await semanticResearch(ctx, research);
      if (sem.paused) return { paused: true };
      analytics = sem.analytics; research = sem.research;
    }
  }
  ctx.dbg.analytics_used = !!analytics;
  ctx.analytics = analytics;
  ctx.research = research;
  await prepareCompose(ctx);
  return { paused: false };
}

// Motor A/B/agent volgens de routerbeslissing (F1 uit v5.8, ongewijzigd gedrag).
async function motorStep(ctx: Ctx, research: Research): Promise<{ paused: boolean; analytics: any | null }> {
  const decision = research.decision;
  const key = ctx.keys.openaiKey;
  if (!decision || !key) return { paused: false, analytics: null };
  let analytics: any = null;
  if (decision.route === "structured") {
    ctx.phaseLabel = ROUTE_PHASE.structured;
    analytics = await runStructured(ctx.supabase, decision, ctx.dbg);
    if (analytics) pushStep(ctx,
      TOOL_STEP_LABELS[analytics.tool] || `${analytics.tool} uitgevoerd`,
      `${(analytics.rows || []).length} records${analytics.scanned_n ? ` (${analytics.scanned_n} gescand)` : ""}`,
      "data",
      { findings: evidenceRows(analytics.tool, analytics.rows || []).slice(0, 5).map((f: any) => ({ datum: f.datum || null, naam: String(f.naam || "").slice(0, 80), detail: String(f.detail || "").slice(0, 120) })) },
    );
    if (analytics) ctx.spent.tool_calls = 1;
  } else if (decision.route === "sweep") {
    ctx.phaseLabel = ROUTE_PHASE.sweep;
    const sweepPrice = ctx.pricing?.openai?.[SWEEP_MODEL] ? { in: ctx.pricing.openai[SWEEP_MODEL].in, out: ctx.pricing.openai[SWEEP_MODEL].out } : null;
    analytics = await runSweep(ctx.supabase, key, decision, ctx.dbg, (label, detail) => pushStep(ctx, label, detail, "data"), sweepPrice);
    if (analytics) pushStep(ctx,
      `${(analytics.rows || []).length} matches bevestigd`, null, "data",
      { findings: (analytics.rows || []).slice(0, 5).map((r: any) => ({ datum: r.datum || null, naam: String(r.naam || "").slice(0, 80), detail: String(r.citaat || r.bewijs || "").slice(0, 120) })) },
    );
    if (analytics?.cost) { ctx.spent.tokens.openai_in += analytics.cost.tokens_in ?? 0; ctx.spent.tokens.openai_out += analytics.cost.tokens_out ?? 0; ctx.spent.tool_calls = analytics.cost.calls ?? 1; }
  } else if (decision.route === "agentic") {
    ctx.phaseLabel = ROUTE_PHASE.agentic;
    const r = await runAgentLoop(ctx, "route", null);
    if (r.paused) return { paused: true, analytics: null };
    analytics = r.analytics;
  }
  if ((decision.route === "structured" || decision.route === "sweep" || decision.route === "agentic") && !analytics) {
    ctx.dbg.route_fallback = "motor_null_to_semantic";
    pushStep(ctx, "Route gaf niets bruikbaars — terug naar semantisch zoeken", null, "route");
  }
  if (analytics?.cost?.est_usd != null) {
    ctx.spent.usd = estimateCostUsd({ embed_tokens: ctx.spent.tokens.embed, cohere_calls: ctx.spent.cohere_calls, grok_in: 0, grok_out: 0, analytics_usd: analytics.cost.est_usd }, ctx.pricing);
  }
  return { paused: false, analytics };
}

// Het semantische pad (F2 uit v5.8): entity → tijdlijn → context-build (+ retry)
// → rerank → zelfheling. Alleen de zelfheling kan pauzeren (agent-lus).
async function semanticResearch(ctx: Ctx, research: Research): Promise<{ paused: boolean; analytics: any | null; research: Research }> {
  const { supabase, req, dbg } = ctx;
  const message = req.message;
  const history = req.history;
  ctx.phaseLabel = ROUTE_PHASE.semantic;
  const t1 = Date.now();
  let entityHint: any | null = null;
  if (!req.force_no_entity) {
    entityHint = await tryResolveEntity(supabase, message);
    if (!entityHint) { entityHint = inheritEntityFromHistory(history); if (entityHint) dbg.entity_inherited = true; }
  }
  dbg.entity_resolve_ms = Date.now() - t1;
  dbg.entity_found = !!entityHint;
  if (entityHint) pushStep(ctx, `Entity herkend: ${entityHint.name}`, entityHint.via === "inherited_from_history" ? "uit het gesprek" : `match op "${entityHint.matched_term}"`, "entity");

  let rpcChunks: any[] = [];
  if (entityHint && (entityHint.entity_type === "company" || entityHint.entity_type === "contact")) {
    const t2 = Date.now();
    try { rpcChunks = await fetchEntityTimelineChunks(supabase, entityHint); } catch (e) { dbg.rpc_error = e instanceof Error ? e.message : String(e); }
    dbg.rpc_fetch_ms = Date.now() - t2;
    dbg.rpc_chunks = rpcChunks.length;
    dbg.rpc_fireflies = rpcChunks.filter((c) => c.via === "rpc_timeline_fireflies").length;
    if (rpcChunks.length > 0) {
      const nMail = rpcChunks.filter((c) => c.source === "mail").length;
      const nNote = rpcChunks.filter((c) => c.source === "note").length;
      const nMeet = rpcChunks.filter((c) => c.source === "meeting" || c.source === "agenda").length;
      const parts = [nMail ? `${nMail} mailthreads` : null, nNote ? `${nNote} notities` : null, nMeet ? `${nMeet} meetings/agenda` : null].filter(Boolean).join(", ");
      pushStep(ctx, "Tijdlijn van deze relatie opgehaald", parts || `${rpcChunks.length} items`, "data", {
        findings: rpcChunks.slice(0, 5).map((c: any) => ({
          datum: c.occurred_at ? String(c.occurred_at).slice(0, 10) : null,
          naam: String(c.subject || c.source || "?").slice(0, 80),
          detail: `${c.source}${c.from_name ? ` · ${c.from_name}` : ""}`.slice(0, 120),
        })),
      });
      if (rpcChunks.some((c) => c.via === "rpc_churn_status")) pushStep(ctx, "Klantstatus meegenomen: deze klant is gechurnd", null, "data");
    }
  }

  ctx.webPromise = req.web_search && ctx.keys.openaiKey
    ? callOpenAIResearch(ctx.keys.openaiKey, message).catch((e) => { dbg.web_research_error = e instanceof Error ? e.message : String(e); return null; })
    : Promise.resolve(null);

  const skipContextBuild = rpcChunks.length >= SKIP_CONTEXT_BUILD_IF_RPC_CHUNKS;
  if (skipContextBuild) dbg.context_build_skipped = `rpc_already_has_${rpcChunks.length}_chunks`;

  let cb: any = { matches: [], retrieval_strategy: null, bundle_id: null, coverage: null };
  // WP2 — waarom leverde de retrieval niets op? Eén woord uit een gesloten
  // verzameling, dat helemaal doorloopt tot in het antwoord.
  let coverageReason: string | null = null;
  if (!skipContextBuild) {
    // Een documentatievraag gaat over het lichte recept, óók als er een entity
    // is herkend (v1.145); de niet-documentatievraag naar `search_fast` (WP1, v5.6).
    const cbIntent = DOCS_QUESTION_RE.test(message) ? "search_docs" : "search_fast";
    dbg.context_build_intent = cbIntent;
    const baseOptions: any = {
      top_k: MAX_CONTEXT_CHUNKS, filter_sources: req.filter_sources, min_similarity: 0.30,
      enable_rerank: false, async_bundle: true,
    };
    if (entityHint) { baseOptions.entity_type = entityHint.entity_type; baseOptions.entity_id = entityHint.entity_id; }

    const callContextBuild = async (opts: any, budgetMs: number) => {
      const t3 = Date.now();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/context-build`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${ctx.keys.cronSecret}` },
        body: JSON.stringify({ intent: cbIntent, audience: "rag-chat", trigger_type: "chat", trigger_id: null, query_text: message, caller_user_id: ctx.callerUserId, options: opts }),
        signal: AbortSignal.timeout(budgetMs),
      });
      const ms = Date.now() - t3;
      if (!res.ok) return { ok: false as const, status: res.status, ms };
      const json = JSON.parse(await res.text());
      return { ok: json.ok === true, json, ms, status: res.status } as any;
    };

    try {
      let r = await callContextBuild(baseOptions, CONTEXT_BUILD_TIMEOUT_MS);
      // v6.0 — een 429/5xx van context-build is een storing (OpenAI-credits op 2026-09-06
      // kwam zo binnen als een stille not_tracked): één nieuwe poging na 2 s, daarna
      // failed{provider_error} mét de kosten tot dan.
      if (!r.ok && (r.status === 429 || r.status >= 500)) {
        pushStep(ctx, "Kennisindex gaf een fout — één nieuwe poging over 2 s", `context-build_${r.status}`, "data");
        await sleep(2000);
        r = await callContextBuild(baseOptions, CONTEXT_BUILD_TIMEOUT_MS);
        if (!r.ok && (r.status === 429 || r.status >= 500)) throw new ProviderError("context-build", r.status, `context-build_${r.status}`);
      }
      dbg.vector_fetch_ms = r.ms;
      if (r.ok) cb = r.json;
      else dbg.vector_http_status = r.status;
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      dbg.vector_error = e instanceof Error ? e.message : String(e);
      // Onderscheid time-out van een echte fout (v1.145).
      dbg.vector_timed_out = e instanceof Error && (e.name === "TimeoutError" || /timed? ?out/i.test(e.message));
      if (dbg.vector_timed_out) coverageReason = "timeout";
    }

    // WP2 — één tweede poging, niet meer (lagere drempel, geen bronfilter).
    const firstCount = (cb.matches ?? []).length;
    if (firstCount < 3 && !dbg.vector_timed_out && dbg.vector_error == null) {
      dbg.retrieval_retry = true;
      try {
        const retryOpts = { ...baseOptions, min_similarity: 0.15, filter_sources: null };
        const r2 = await callContextBuild(retryOpts, CONTEXT_BUILD_TIMEOUT_MS);
        dbg.retry_fetch_ms = r2.ms;
        if (r2.ok && (r2.json.matches ?? []).length > firstCount) {
          cb = r2.json;
          dbg.retry_gained = (cb.matches ?? []).length - firstCount;
          coverageReason = null;
        } else {
          dbg.retry_gained = 0;
          coverageReason = coverageReason ?? (r2.ok ? (r2.json.coverage?.reason ?? "truly_empty") : "not_tracked");
        }
      } catch (e) {
        dbg.retry_error = e instanceof Error ? e.message : String(e);
        coverageReason = coverageReason ?? "timeout";
      }
    }
    if (!coverageReason && cb.coverage?.reason) coverageReason = cb.coverage.reason;
  }
  const vectorChunks: any[] = (cb.matches ?? []);
  dbg.vector_chunks = vectorChunks.length;
  dbg.coverage_reason = coverageReason;
  ctx.spent.tokens.embed = cb.retrieval_meta?.tokens?.embed ?? 0;
  if (!skipContextBuild) pushStep(ctx, "Kennisindex doorzocht", `${vectorChunks.length} relevante fragmenten (vector + keywords)`, "data", {
    findings: vectorChunks.slice(0, 5).map((m: any) => ({
      datum: m.occurred_at ? String(m.occurred_at).slice(0, 10) : null,
      naam: String(m.subject || deriveSubject(m) || "?").slice(0, 80),
      detail: String(m.preview || m.content || "").replace(/\s+/g, " ").slice(0, 120),
    })),
  });

  const seen = new Set(rpcChunks.map((c) => c.chunk_id));
  const merged: any[] = [...rpcChunks];
  for (const v of vectorChunks) { if (!seen.has(v.chunk_id)) { merged.push(v); seen.add(v.chunk_id); } }
  // Churn-status is een hard feit en mag nooit door de reranker wegvallen.
  const churnChunks = merged.filter((c) => c.via === "rpc_churn_status");
  const preRerank = merged.filter((c) => c.via !== "rpc_churn_status").slice(0, MAX_PRE_RERANK_CHUNKS);
  dbg.pre_rerank_chunks = preRerank.length;
  if (churnChunks.length > 0) dbg.churn_status_chunk = true;

  const { chunks: rerankedMatches, used: rerankUsed, ms: rerankMs, error: rerankError } = await rerankChunks(ctx.keys.cohereKey, message, preRerank, Math.max(1, CHAT_CONTEXT_CHUNKS - churnChunks.length));
  let matches = [...churnChunks, ...rerankedMatches];
  dbg.rerank_used = rerankUsed;
  if (rerankMs != null) dbg.rerank_ms = rerankMs;
  if (rerankError) dbg.rerank_error = rerankError;
  dbg.merged_chunks = matches.length;
  ctx.spent.cohere_calls = rerankUsed ? 1 : 0;
  if (rerankUsed) pushStep(ctx, "Gerangschikt op relevantie", `top ${matches.length} fragmenten geselecteerd`, "data", {
    findings: matches.slice(0, 5).map((m: any) => ({
      datum: m.occurred_at ? String(m.occurred_at).slice(0, 10) : null,
      naam: String(m.subject || deriveSubject(m) || "?").slice(0, 80),
      detail: String(m.preview || m.content || "").replace(/\s+/g, " ").slice(0, 120),
    })),
  });

  const out: Research = {
    ...research, entityHint, rpcChunkCount: rpcChunks.length, rpcFireflies: dbg.rpc_fireflies ?? 0, cb, vectorChunkCount: vectorChunks.length,
    skipContextBuild, rerankUsed, coverageReason, matches, selfHeal: false, webResearch: null,
  };

  // v5.2/v5.4/v5.6 zelfheling: weinig bruikbare context → de onderzoeks-agent
  // neemt het over (guard op matches.length < 3, niet op een gematchte naam).
  const usableContext = matches.length;
  dbg.self_heal_usable_context = usableContext;
  let analytics: any = null;
  if (usableContext < 3 && message.length >= 12 && ctx.keys.openaiKey) {
    pushStep(ctx, "Weinig context via zoeken — de onderzoeks-agent neemt het over", null, "route");
    // Het effort volgde de route (medium/low); de agent verdient het agentic-budget.
    if (ctx.budget.source !== "body" && EFFORT_RANK[ctx.effort] < EFFORT_RANK.high) {
      ctx.effort = "high";
      ctx.budget = { ...ctx.budgets.high, source: "self_heal" };
      if (ctx.inline) ctx.budget = { ...ctx.budget, wall_ms: Math.min(ctx.budget.wall_ms, COMPAT_WALL_MS), compat_cap_ms: COMPAT_WALL_MS } as Budget;
      queue(ctx, () => writeRun(ctx, { effort: ctx.effort, budget: ctx.budget, deadline_at: new Date(ctx.runStartMs + ctx.budget.wall_ms + 60_000).toISOString() }));
    }
    out.selfHeal = true;
    ctx.phaseLabel = ROUTE_PHASE.agentic;
    // De research-snapshot vóór de lus: een volgende hop maakt er de compose mee af.
    queue(ctx, () => writeState(ctx, { compose: { research: persistableResearch(out) }, dbg }));
    const r = await runAgentLoop(ctx, "self_heal", null);
    if (r.paused) return { paused: true, analytics: null, research: out };
    analytics = r.analytics;
    if (analytics) { dbg.route_fallback = "semantic_low_context_to_agentic"; dbg.analytics_used = true; out.matches = []; }
  }
  return { paused: false, analytics, research: out };
}

// ── Compose voorbereiden (F3 + F4 uit v5.8): prompt, envelop, logrij ─────────
async function prepareCompose(ctx: Ctx) {
  const { req, dbg } = ctx;
  const research = ctx.research!;
  const analytics = ctx.analytics;
  const message = req.message;
  const matches: any[] = analytics ? [] : (research.matches ?? []);
  const entityHint = research.entityHint;
  const cb = research.cb ?? {};
  const webResearch = ctx.webPromise ? await ctx.webPromise : null;
  const prefAdditions = await getPreferenceAdditions(ctx.supabase, { style: req.writing_style, tone: req.tone, focus: req.focus });
  if (webResearch) dbg.web_research_ms = webResearch.ms;
  if (prefAdditions) dbg.prefs_applied = true;
  if (webResearch) pushStep(ctx, "Web doorzocht (Live Search)", `${(webResearch.web_citations || []).length} externe bronnen`, "data");
  const coverageReason = research.coverageReason;
  // v6.0 — ook een analytics-antwoord met 0 rijen draagt zijn reden. Tot v5.8 zette de
  // envelop `coverage.reason` op null zodra er analytics was, óók bij 0 rijen: de
  // NE34/A04/WI19/AR01-klasse uit de bank (structured, tool gaf 0 rijen, geen reden =
  // stille leegte, G1 rood; spoor 01 DECISIONS 2026-09-06: "voor de volgende PR's op de
  // chatketen moet NE34 eerst groen"). De RPC heeft wél gedraaid en niets gevonden: dat
  // is `truly_empty`; de structured no_data-tool ("dit veld wordt niet bijgehouden") is
  // `not_tracked` — dezelfde afleiding die de evalrunner al deed. Gesloten set ongewijzigd.
  const analyticsEmpty = !!analytics && (analytics.rows || []).length === 0;
  const reasonOut: string | null = analytics
    ? (analyticsEmpty ? (analytics.tool === "no_data" ? "not_tracked" : "truly_empty") : null)
    : (matches.length === 0 ? (coverageReason ?? "not_tracked") : null);
  dbg.coverage_reason = reasonOut ?? dbg.coverage_reason ?? null;

  const ctxLines: string[] = matches.map((m, i) => {
    const n = i + 1;
    const subj = m.subject || deriveSubject(m) || "(geen onderwerp)";
    const date = m.occurred_at ? new Date(m.occurred_at).toLocaleDateString("nl-NL") : "?";
    const bodyText = (m.preview || m.content || "").slice(0, MAX_CTX_PER_CHUNK);
    const prefix = m.content_with_context && m.content_with_context !== bodyText ? (m.content_with_context.split("\n\n")[0] || "").slice(0, 200) : null;
    const scoreLabel = m.rerank_score != null ? ` r=${m.rerank_score.toFixed(2)}` : (m.similarity != null ? ` sim=${m.similarity.toFixed(2)}` : "");
    const viaLabel = m.via === "rpc_timeline_fireflies" ? " via=Fireflies" : (m.via === "rpc_timeline" ? " via=RPC" : "");
    const head = `[${m.source} #${n}${viaLabel}${scoreLabel}] ${subj} — ${date}`;
    return prefix ? `${head}\n(context: ${prefix})\n${bodyText}` : `${head}\n${bodyText}`;
  });
  const ctxBlob = analytics
    ? analyticsContextBlob(analytics)
    : (ctxLines.length > 0 ? ctxLines.join("\n\n---\n\n") : coverageBlob(coverageReason));
  const validNs = matches.map((_, i) => i + 1).join(", ");
  const userMsg = buildCombinedUserMessage({ question: message, entityHint, ctxBlob, validNs, webText: webResearch?.webText || null, prefAdditions, analytics, coverageReason: (!analytics && matches.length === 0) ? (coverageReason ?? "not_tracked") : null });
  const sanitizedHistory = req.history.filter((h) => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string").map((h) => ({ role: h.role, content: h.content.slice(0, 4000) }));

  const citations = analytics
    ? (analytics.route === "sweep"
        ? (analytics.rows || []).slice(0, 40).map((r: any, i: number) => ({ n: i + 1, chunk_id: null, source: "mail", id: r.mail_id, subject: r.naam, from_name: r.sender, occurred_at: r.datum || null, similarity: null, rerank_score: r.confidence ?? null, preview: (r.citaat || r.bewijs || "").slice(0, CITATION_PREVIEW_CAP), entity_path: null, via: "sweep_evidence" }))
        : [])
    : matches.map((m, i) => ({ n: i + 1, chunk_id: m.chunk_id, source: m.source, id: m.id, subject: m.subject || deriveSubject(m), from_name: m.from_name, occurred_at: m.occurred_at, similarity: m.similarity, rerank_score: m.rerank_score, preview: (m.preview || m.content || "").slice(0, CITATION_PREVIEW_CAP), entity_path: m.entity_path, via: m.via || (m.similarity != null ? "vector" : "unknown") }));
  const web_citations = webResearch?.web_citations || [];

  const strategyParts: string[] = [];
  if (analytics) strategyParts.push(`analytics:${analytics.route}${analytics.tool ? ":" + analytics.tool : ""}`);
  else if (entityHint) strategyParts.push(`hybrid_rpc${research.vectorChunkCount > 0 ? "+vector" : (research.skipContextBuild ? "+skip-cb" : "")}${entityHint.via === "inherited_from_history" ? "+inherited" : ""}${(dbg.rpc_fireflies ?? 0) > 0 ? "+fireflies" : ""}`);
  else strategyParts.push(cb.retrieval_strategy || "vector");
  if (research.rerankUsed) strategyParts.push("+rerank");
  if (webResearch) strategyParts.push("+web-research");
  const prefsActive = [req.writing_style, req.tone, req.focus].filter((x) => x && x !== "standaard" && x !== "neutraal" && x !== "analyse");
  if (prefsActive.length > 0) strategyParts.push(`+prefs:${prefsActive.join(",")}`);
  const retrievalStrategy = strategyParts.join("");

  // ── WP4: het antwoordcontract (envelope v1, velden ongewijzigd) ──────────
  const envelopeRows: any[] = analytics ? (analytics.rows || []) : [];
  const envelopeColumns: string[] = envelopeRows.length > 0 ? Object.keys(envelopeRows[0] ?? {}) : [];
  const searchedAll = ["mail", "meeting", "event", "deal", "engagement", "company", "contact", "jira", "confluence", "kb_article"];
  const searchedNow: string[] = analytics
    ? (analytics.tools_used || [analytics.tool]).filter(Boolean).map(String)
    : (cb.coverage?.searched ?? (research.skipContextBuild ? [] : searchedAll));
  if (research.rpcChunkCount > 0) searchedNow.push("relatie-tijdlijn");
  if (webResearch) searchedNow.push("web");
  const envelope: Record<string, unknown> = {
    version: 1,
    answer_md: null,
    claim: analytics?.claim ?? null,
    definition: analytics?.definition ?? null,
    route: analytics?.route || "semantic",
    sources: citations.slice(0, 40).map((c: any) => ({
      n: c.n, type: c.source, id: c.id,
      date: c.occurred_at ? String(c.occurred_at).slice(0, 10) : null,
      title: c.subject || null,
    })),
    rows: envelopeRows.slice(0, 500),
    columns: envelopeColumns,
    artifacts: [],
    artifacts_available: envelopeRows.length > 0 ? ["xlsx", "csv"] : [],
    coverage: {
      searched: Array.from(new Set(searchedNow)),
      not_searched: analytics ? [] : searchedAll.filter((s) => !searchedNow.includes(s)),
      reason: reasonOut,
      chunk_count: matches.length,
      rows_returned: analytics ? (analytics.rows || []).length : null,
    },
    cost: null,
  };
  const answerEmpty = matches.length === 0 && !(analytics && (analytics.rows || []).length > 0);

  // Query-log (Vragenbak v2 W3): elke vraag — óók semantic — naar rag_chat_query_log.
  const queryLogId = crypto.randomUUID();
  const baseLog: Record<string, unknown> = {
    id: queryLogId,
    question: message.slice(0, 2000),
    gate_hit: research.gateHit,
    route: analytics?.route || "semantic",
    tool: analytics?.tool || null,
    tools_used: analytics?.tools_used || null,
    rows_returned: analytics ? (analytics.rows || []).length : null,
    scanned_n: analytics?.scanned_n ?? null,
    entity: entityHint ? { type: entityHint.entity_type, name: entityHint.name, via: entityHint.via } : null,
    answer_model: GROK_MODEL,
    est_cost_usd: analytics?.cost?.est_usd ?? null,
    router_ms: dbg.router_ms ?? null,
    stream: req.mode === "compat_stream",
    route_fallback: dbg.route_fallback ?? null,
    run_id: ctx.runId,
    meta: {
      retrieval_strategy: retrievalStrategy, chunk_count: matches.length, web_search: req.web_search,
      agentic_model: dbg.agentic_model ?? null, steps: ctx.steps.slice(0, 24),
      context_build_intent: dbg.context_build_intent ?? null,
      vector_chunks: dbg.vector_chunks ?? null,
      vector_fetch_ms: dbg.vector_fetch_ms ?? null,
      vector_error: dbg.vector_error ?? null,
      vector_timed_out: dbg.vector_timed_out ?? null,
      vector_http_status: dbg.vector_http_status ?? null,
      context_build_skipped: dbg.context_build_skipped ?? null,
      caller_identified: dbg.caller_identified ?? null,
      coverage_reason: dbg.coverage_reason ?? null,
      retrieval_retry: dbg.retrieval_retry ?? false,
      retry_gained: dbg.retry_gained ?? null,
      answer_empty: answerEmpty,
      // v6.0 — de run achter deze logrij, het effort en (na afloop) het aantal hops.
      run_id: ctx.runId, effort: ctx.effort, run_mode: req.mode,
      ...(req.eval_run_id ? { eval_run_id: req.eval_run_id } : {}),
    },
  };
  const baseUsage = {
    embed_tokens: cb.retrieval_meta?.tokens?.embed ?? 0,
    cohere_calls: research.rerankUsed ? 1 : 0,
    analytics_usd: analytics?.cost?.est_usd ?? null,
  };
  const metaPayload: any = {
    type: "meta", citations, bundle_id: cb.bundle_id ?? null, retrieval_strategy: retrievalStrategy, entity_used: entityHint, chunk_count: matches.length,
    analytics: analytics || null, debug_pipeline: dbg, model: GROK_MODEL, web_search_enabled: req.web_search,
    web_search_used: !!webResearch && web_citations.length > 0, web_search_calls: webResearch ? 1 : 0,
    prefs: { style: req.writing_style, tone: req.tone, focus: req.focus }, query_log_id: queryLogId, steps: ctx.steps, envelope, coverage: envelope.coverage, answer_empty: answerEmpty,
    run_id: ctx.runId, effort: ctx.effort,
  };
  ctx.compose = { userMsg, sanitizedHistory, citations, web_citations, envelope, answerEmpty, queryLogId, baseLog, baseUsage, metaPayload, retrievalTokens: cb.retrieval_meta?.tokens?.total ?? 0 };
  ctx.spent.tokens.embed = baseUsage.embed_tokens;
  ctx.spent.cohere_calls = baseUsage.cohere_calls;
  ctx.spent.usd = estimateCostUsd({ embed_tokens: baseUsage.embed_tokens, cohere_calls: baseUsage.cohere_calls, grok_in: 0, grok_out: 0, analytics_usd: baseUsage.analytics_usd }, ctx.pricing);
  ctx.phaseLabel = PHASE.composing;
  ctx.currentStage = "composing";
  // Bewaren voor een compose-hop: alles behalve het volledige analytics-object (rows ≤ 100).
  const persisted = {
    ...ctx.compose,
    metaPayload: { ...metaPayload, analytics: stripAnalytics(analytics), steps: undefined },
    analytics: stripAnalytics(analytics), research: persistableResearch(research),
  };
  queue(ctx, () => writeState(ctx, { compose: persisted, dbg, matches: null, loop_messages: null, loop_meta: null }));
  queue(ctx, () => writeRun(ctx, { state: "composing", route: envelope.route as string, phase_label: ctx.phaseLabel, spent: spentPatch(ctx), steps: ctx.steps.slice(0, 40) }));
}

// ── Stage: composing (Grok → answer_partial → answer_md) ─────────────────────
async function stageComposing(ctx: Ctx) {
  ctx.currentStage = "composing";
  if (!ctx.compose) {
    // Verse hop: de research-hop zette alles klaar in agent_chat_run_state.compose.
    const c = ctx.state.compose;
    if (!c || !c.userMsg) throw new Error("compose_state_missing");
    ctx.compose = c;
    ctx.analytics = c.analytics ?? null;
    ctx.compose.metaPayload = { ...(c.metaPayload ?? {}), steps: ctx.steps, debug_pipeline: ctx.dbg };
  }
  const c = ctx.compose;
  const { data: promptCfg } = await ctx.supabase.from("agent_config").select("config_value").eq("agent_name", "rag-chat").eq("config_key", "system_prompt").maybeSingle();
  const basePrompt: string = (typeof promptCfg?.config_value === "string") ? promptCfg.config_value : (promptCfg?.config_value ? String(promptCfg.config_value) : "Je bent een behulpzame Nederlandse RAG-assistent. Combineer altijd interne CONTEXT (met [bron #N]) en, als beschikbaar, web-research (met URL's) in één samenhangend antwoord.");
  // v1.134: in-app Skills (org_skills) achter de system-prompt; faalt de tabel, dan blijft de prompt exact zoals hij was.
  const orgSkills = await loadOrgSkills(ctx.supabase);
  const systemPrompt: string = basePrompt + generalGuidanceBlock(orgSkills);
  ctx.dbg.org_skills_count = orgSkills.length;

  ctx.phaseLabel = PHASE.composing;
  setPhase(ctx, "composing");
  pushStep(ctx, "Antwoord schrijven…", null, "write");
  try { ctx.mode.emit?.({ ...c.metaPayload, steps: ctx.steps, debug_pipeline: ctx.dbg }); } catch { /* stream al dicht */ }

  const deadlineAt = ctx.inline ? null : ctx.hopStart + HOP_HARD_MS;
  let attempt = 0;
  while (true) {
    try {
      return await composeAnswer({
        grokKey: ctx.keys.grokKey!, systemPrompt, sanitizedHistory: c.sanitizedHistory, userMsg: c.userMsg, deadlineAt,
        onDelta: (text) => { try { ctx.mode.onDelta?.(text); } catch { /* stream al dicht */ } },
        onPartial: (text) => { queue(ctx, () => writeRun(ctx, { answer_partial: text.slice(0, 200_000) })); },
      });
    } catch (e) {
      const pe = providerErrorOf(e, "grok");
      if (pe && attempt === 0) {
        attempt++;
        pushStep(ctx, "Antwoordmodel gaf een fout — één nieuwe poging over 2 s", pe.message.slice(0, 80), "write");
        await sleep(2000);
        continue;
      }
      throw pe ?? e;
    }
  }
}

// ── Afronden: kosten, envelop, querylog, rij ─────────────────────────────────
async function finishRun(ctx: Ctx, res: Awaited<ReturnType<typeof composeAnswer>>): Promise<CompatResult> {
  const c = ctx.compose;
  const analytics = ctx.analytics;
  const { cost, grokIn, grokOut } = finishCost(c.baseUsage, analytics, res.usage, ctx.pricing);
  ctx.spent.tokens.grok_in = grokIn; ctx.spent.tokens.grok_out = grokOut;
  ctx.spent.usd = cost.usd;
  if (analytics?.route === "agentic" && analytics.cost) {
    ctx.spent.tokens.openai_in = analytics.cost.tokens_in ?? ctx.spent.tokens.openai_in;
    ctx.spent.tokens.openai_cached = analytics.cost.tokens_cached ?? ctx.spent.tokens.openai_cached;
    ctx.spent.tokens.openai_out = analytics.cost.tokens_out ?? ctx.spent.tokens.openai_out;
    ctx.spent.tool_calls = analytics.cost.calls ?? ctx.spent.tool_calls;
  }
  const spent = spentPatch(ctx);
  const envelope = c.envelope;
  envelope.answer_md = res.answerMd;
  envelope.cost = cost;
  // Vork V12: budgetuitputting is geen coverage.reason maar een eigen, additief blok.
  const { source: _s, ...limits } = ctx.budget as any;
  envelope.budget = { effort: ctx.effort, limits, spent, exhausted_by: ctx.dbg.agentic_budget_exhausted_by ?? null, hops: ctx.hop };
  const latency = Date.now() - ctx.t0;
  const hops = hopsEnded(ctx, res.streamError ? "stream_error" : "done");
  const logMeta = { ...(c.baseLog.meta as Record<string, unknown>), usage: cost.by_vendor, envelope_version: 1, hops: ctx.hop, agentic_model: ctx.dbg.agentic_model ?? null, budget_exhausted_by: ctx.dbg.agentic_budget_exhausted_by ?? null };
  try {
    const { error } = await ctx.supabase.from("rag_chat_query_log").insert({ ...c.baseLog, latency_ms: latency, answer_chars: res.answerChars, error: res.streamError, est_cost_usd: cost.usd, meta: logMeta });
    if (error) console.error("[rag-chat] query_log insert failed", error.message);
  } catch (e) { console.error("[rag-chat] query_log insert threw", e instanceof Error ? e.message : String(e)); }
  await ctx.q;
  ctx.phaseLabel = PHASE.done;
  await writeRun(ctx, {
    state: "done", phase_label: PHASE.done, finished_at: new Date().toISOString(),
    answer_md: res.answerMd, answer_partial: null, envelope, citations: c.citations.slice(0, 40), analytics: stripAnalytics(analytics),
    spent, hops, steps: ctx.steps.slice(0, 40), query_log_id: c.queryLogId, hop_lease: null,
    ...(res.streamError ? { error: { code: "stream_error", message: String(res.streamError).slice(0, 300), hop: ctx.hop, stage: "composing" } } : {}),
  });
  queue(ctx, () => writeState(ctx, { dbg: ctx.dbg }));
  await ctx.q;
  return {
    answer: res.answerMd, metaPayload: { ...c.metaPayload, steps: ctx.steps, debug_pipeline: ctx.dbg, envelope }, envelope, web_citations: c.web_citations,
    timing_ms: { total: latency, grok: res.grokMs }, tokens: { retrieval: c.retrievalTokens ?? 0, chat_in: grokIn, chat_out: grokOut },
    finish_reason: res.finishReason, streamError: res.streamError,
  };
}

async function failRun(ctx: Ctx, e: unknown): Promise<{ code: string; message: string; http: number }> {
  const msg = e instanceof Error ? e.message : String(e);
  const pe = providerErrorOf(e);
  const isConfig = e instanceof ConfigError;
  const code = pe ? "provider_error" : "internal";
  console.error("[rag-chat] run failed", ctx.runId, ctx.hop, ctx.currentStage, msg);
  const error = { code, message: msg.slice(0, 500), provider: pe?.provider ?? null, http_status: pe?.status ?? null, hop: ctx.hop, stage: ctx.currentStage, at: new Date().toISOString() };
  const spent = spentPatch(ctx);
  const latency = Date.now() - ctx.t0;
  // Querylog: ook een mislukte run hoort in het log te staan, mét zijn kosten.
  const base: Record<string, unknown> = ctx.compose?.baseLog ?? {
    id: crypto.randomUUID(), question: ctx.req.message.slice(0, 2000), gate_hit: !!ctx.dbg.gate_hit,
    route: ctx.dbg.route ?? "semantic", answer_model: GROK_MODEL, router_ms: ctx.dbg.router_ms ?? null,
    stream: ctx.req.mode === "compat_stream", route_fallback: ctx.dbg.route_fallback ?? null, run_id: ctx.runId,
    meta: {
      steps: ctx.steps.slice(0, 24), caller_identified: ctx.dbg.caller_identified ?? null, coverage_reason: ctx.dbg.coverage_reason ?? null,
      vector_http_status: ctx.dbg.vector_http_status ?? null, vector_error: ctx.dbg.vector_error ?? null, agentic_model: ctx.dbg.agentic_model ?? null,
      run_id: ctx.runId, effort: ctx.effort, run_mode: ctx.req.mode, ...(ctx.req.eval_run_id ? { eval_run_id: ctx.req.eval_run_id } : {}),
    },
  };
  try {
    const { error: lErr } = await ctx.supabase.from("rag_chat_query_log").insert({ ...base, latency_ms: latency, answer_chars: 0, error: `${code}: ${msg.slice(0, 400)}`, est_cost_usd: spent.usd, meta: { ...(base.meta as Record<string, unknown>), run_failed: code, hops: ctx.hop } });
    if (lErr) console.error("[rag-chat] query_log insert failed", lErr.message);
  } catch (e2) { console.error("[rag-chat] query_log insert threw", e2 instanceof Error ? e2.message : String(e2)); }
  try { await ctx.q; } catch { /* al gelogd */ }
  const label = pe ? `Mislukt: ${pe.provider} gaf ${pe.status ?? "een fout"}` : isConfig ? `Mislukt: configuratie (${msg})` : "Mislukt: interne fout";
  await writeRun(ctx, {
    state: "failed", phase_label: label, finished_at: new Date().toISOString(), error, spent, answer_partial: null,
    hops: hopsEnded(ctx, "failed"), steps: ctx.steps.slice(0, 40), query_log_id: base.id, hop_lease: null,
  });
  queue(ctx, () => writeState(ctx, { dbg: ctx.dbg }));
  try { await ctx.q; } catch { /* al gelogd */ }
  return { code: isConfig ? "config" : code, message: msg, http: isConfig ? 400 : pe ? 502 : 500 };
}
