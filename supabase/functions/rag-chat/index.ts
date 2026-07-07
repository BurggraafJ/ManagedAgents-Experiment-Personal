// =============================================================================
// rag-chat v5.0 — Vragenbak v2: agentic route + churn-context + query-log
// =============================================================================
// v5.0 (2026-07-07, Vragenbak v2 agentic):
//   - 4e route "agentic" (agentic.ts): native OpenAI function-calling-loop
//     voor multi-bron/meerstaps datavragen (agenda + notities + mail +
//     Motor A-RPC's). Router krijgt nu de huidige datum (relatieve vensters).
//   - Entity-timeline (company + contact) haalt óók churn_customers op: een
//     "hoe gaat het met X"-vraag ziet nu het churn-feit + reden prominent
//     (chunk wordt buiten de rerank gehouden zodat hij nooit wegvalt).
//   - Query-log: ELKE vraag (ook semantic) → rag_chat_query_log (route, tool,
//     rijen, kosten, latency) voor router/tool-review in echt gebruik.
//     meta.query_log_id koppelt UI/feedback aan de log-rij.
//   - GROK_MODEL gepind op grok-4.3: xAI resolvet de oude alias 'grok-4-fast'
//     inmiddels server-side naar grok-4.3 (live geverifieerd 2026-07-07) —
//     de pin maakt expliciet wat er feitelijk draait.
// v4.0 (2026-06-11, project 471302146): regex-gate + gpt-5.4-mini-router
//   classificeert structured / sweep / semantic. structured → read-only
//   analytics-RPC's (Motor A); sweep → enrichment-voorfilter + batched
//   verdicts (Motor B); semantic → ongewijzigd bestaand pad (default bij
//   twijfel/fout). Bij analytics-route: entity-resolutie, RPC-timeline,
//   context-build, rerank en web-research worden overgeslagen; response
//   krijgt een machine-leesbaar `analytics`-blok (route, rows, scanned_n,
//   claim, cost) voor de UI-tabel + eval-asserts. Zie rag-chat/analytics.ts.
// v3.24 (2026-06-03, RAG v2 F.1b): tryResolveEntity probeert eerst de DB-RPC
//   rag_resolve_entity (pg_trgm word_similarity + entity_resolution: exacte e-mail,
//   company/deal/contact-naam fuzzy). Robuuster dan de ILIKE-substring+lengte-ratio,
//   die als fallback blijft staan. duplicate_count → disambiguatie-UI.
// v3.23 (2026-05-22):
//   - Rassers-vraag hing aan einde: meta-event met 40 chunks × 800 chars preview =
//     ~32k chars JSON → grote auto-save naar Supabase JSONB. Fix:
//   - citation.preview cap 800 → 400 (uit metaPayload).
//   - MAX_CTX_PER_CHUNK 1500 → 1000 (compromis: nog genoeg voor transcript-segmenten).
//   - Frontend in useRagChat stript preview tot 280 chars bij persist.
// v3.22: Fireflies-koppeling + transcript-segmenten
// =============================================================================
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { routeGateHit, classifyRoute, runStructured, runSweep, analyticsContextBlob } from "./analytics.ts";
import { runAgentic } from "./agentic.ts";

const GROK_MODEL = "grok-4.3";
const GROK_CHAT_ENDPOINT = "https://api.x.ai/v1/chat/completions";
const OPENAI_CHAT_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const OPENAI_SEARCH_MODEL = "gpt-4o-search-preview";
const COHERE_RERANK_ENDPOINT = "https://api.cohere.com/v2/rerank";
const COHERE_MODEL = "rerank-v3.5";
const MAX_TOKENS = 3000;
const MAX_RESEARCH_TOKENS = 1500;
const MAX_CTX_PER_CHUNK = 1000;
const CITATION_PREVIEW_CAP = 400;
const MAX_CONTEXT_CHUNKS = 40;
const MAX_PRE_RERANK_CHUNKS = 60;
const MAX_RPC_MAILS = 15;
const MAX_RPC_EVENTS = 8;
const MAX_RPC_NOTES = 8;
const MAX_RPC_FIREFLIES = 3;
const CONTEXT_BUILD_TIMEOUT_MS = 4_000;
const SKIP_CONTEXT_BUILD_IF_RPC_CHUNKS = 8;

const STOP_WORDS = new Set(["hoe","wat","wanneer","waar","wie","waarom","welke","de","het","een","ik","jij","hij","zij","we","wij","jullie","ze","van","voor","naar","bij","in","op","aan","met","over","door","als","of","en","maar","dan","dus","dat","die","deze","besprak","bespreken","besproken","recent","laatst","recente","vraag","vragen","antwoord","helpen","weet","kun","kan","klant","klanten","customer","deal","deals","bedrijf","bedrijven","contact","contacten","kantoor","kantoren","advocaten","advocatenkantoor","advocatenkantoren","law","firm","company","openstaande","open","gesloten","alle","alles","nog","al","dit","hier","daar","mail","mails","mailen","mailtje","emails","email","bericht","berichten","afspraak","afspraken","meeting","meetings","agenda","jira","proefperiode","trial","offerte","offertes","licentie","licenties","vertel","vertellen","info","informatie","laat","toon","geef","lead","leads","success","proces","processen","team","teams","manager","persoon","personen","medewerker","medewerkers","collega","collegas"]);

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
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

async function tryResolveEntity(supabase: SupabaseClient, query: string): Promise<any | null> {
  // F.1b (RAG v2): eerst de pg_trgm-RPC (entity_resolution + word_similarity). ILIKE blijft fallback.
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
  } catch (_e) { /* val terug op ILIKE-resolutie hieronder */ }

  const lower = query.toLowerCase();
  const words = lower.replace(/[^\p{L}\p{N}\s\-]/gu, " ").split(/\s+/).map((w) => w.trim()).filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  if (words.length === 0) return null;
  const candidates: string[] = [];
  for (let i = 0; i < words.length - 1; i++) candidates.push(`${words[i]} ${words[i + 1]}`);
  for (const w of words) candidates.push(w);
  const seen = new Set<string>();
  for (const cand of candidates) {
    if (seen.has(cand)) continue;
    seen.add(cand);
    const { data: comps } = await supabase.from("hubspot_companies").select("company_id, name, domain").ilike("name", `%${cand}%`).eq("is_archived", false).order("hs_lastmodifieddate", { ascending: false, nullsFirst: false }).limit(5);
    if (comps && comps.length >= 1 && comps.length <= 3 && comps[0].name) {
      const ratio = cand.length / Math.max(comps[0].name.length, 1);
      if (ratio > 0.20) return { entity_type: "company", entity_id: comps[0].company_id, name: comps[0].name, via: "company_name_match", matched_term: cand, confidence: Math.min(0.5 + ratio * 0.5, 0.95) * (comps.length === 1 ? 1.0 : 0.85), duplicate_count: comps.length > 1 ? comps.length : undefined };
    }
    const { data: deals } = await supabase.from("hubspot_deals").select("deal_id, dealname, dealstage").ilike("dealname", `%${cand}%`).eq("is_archived", false).order("hs_lastmodifieddate", { ascending: false, nullsFirst: false }).limit(5);
    if (deals && deals.length >= 1 && deals.length <= 3 && deals[0].dealname) {
      const ratio = cand.length / Math.max(deals[0].dealname.length, 1);
      if (ratio > 0.30) return { entity_type: "deal", entity_id: deals[0].deal_id, name: deals[0].dealname, via: "deal_name_match", matched_term: cand, confidence: Math.min(0.5 + ratio * 0.5, 0.95) * (deals.length === 1 ? 1.0 : 0.85) };
    }
    if (cand.includes(" ")) {
      const [first, last] = cand.split(" ");
      const { data: contacts } = await supabase.from("hubspot_contacts").select("contact_id, firstname, lastname, email, associated_company_id").ilike("firstname", `${first}%`).ilike("lastname", `${last}%`).eq("is_archived", false).limit(5);
      if (contacts && contacts.length >= 1 && contacts.length <= 3) {
        return { entity_type: "contact", entity_id: contacts[0].contact_id, name: `${contacts[0].firstname} ${contacts[0].lastname}`.trim(), via: "contact_name_match", matched_term: cand, confidence: 0.85 * (contacts.length === 1 ? 1.0 : 0.85) };
      }
    }
  }
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

function grokChatBody(messages: any[], stream: boolean) { return { model: GROK_MODEL, messages, max_tokens: MAX_TOKENS, temperature: 0.3, ...(stream ? { stream: true } : {}) }; }

async function callGrokChat(apiKey: string, systemPrompt: string, history: any[], userContent: string) {
  const messages = [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: userContent }];
  const res = await fetch(GROK_CHAT_ENDPOINT, { method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(grokChatBody(messages, false)), signal: AbortSignal.timeout(120_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`grok_${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  return { answer: json.choices?.[0]?.message?.content || "", usage: json.usage };
}
async function callGrokChatStream(apiKey: string, systemPrompt: string, history: any[], userContent: string): Promise<Response> {
  const messages = [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: userContent }];
  return await fetch(GROK_CHAT_ENDPOINT, { method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(grokChatBody(messages, true)) });
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

function sseChunk(obj: any): Uint8Array { return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`); }

function buildCombinedUserMessage(opts: { question: string; entityHint: any | null; ctxBlob: string; validNs: string; webText: string | null; prefAdditions: string; analytics?: any | null }): string {
  const { question, entityHint, ctxBlob, validNs, webText, prefAdditions, analytics } = opts;
  const entityLine = entityHint ? `Gedetecteerde entity: ${entityHint.entity_type} "${entityHint.name}"${entityHint.via === "inherited_from_history" ? " (overgeërfd)" : ""}.\n` : "";
  const hasWeb = !!webText;
  if (analytics) {
    const sweepCiteLine = analytics.route === "sweep" && (analytics.rows || []).length > 0
      ? "4. Citeer per rij de bron als [bron #N] — N is het rijnummer in de DATA (zelfde volgorde).\n"
      : "";
    return [
      `JE TAAK (analytische vraag — exact berekende data):
1. De DATA hieronder is deterministisch uit de database berekend en is COMPLEET voor de gegeven definitie. Gebruik uitsluitend deze data; verzin of verwijder niets.
2. Begin je antwoord met de dekking-claim: "${String(analytics.claim || "").replace(/"/g, "'")}"
3. Presenteer de resultaten als compacte markdown-tabel (alle rijen bij ≤ 30 rijen; anders de eerste 30 plus één slotzin "… en N meer — zie de tabel hieronder voor alles"). Kies de meest informatieve kolommen, met datums als dd-mm-jjjj.
${sweepCiteLine}5. Staat er 0 rijen of een LET OP-regel: zeg dan eerlijk dat dit niet (volledig) uit de data te beantwoorden is en waarom — geen alternatieve lijst fantaseren.
6. Sluit af met één korte zin over de gebruikte definitie/bron.`,
      "",
      `=== DATA (deterministisch) ===\n${ctxBlob}\n=== EINDE DATA ===`,
      prefAdditions ? `\nVOORKEUREN (overschrijven default-format waar conflict):\n${prefAdditions}\n` : "",
      `\nEindig met:\n## Vervolgvragen\n- vraag 1\n- vraag 2`,
      `\n=== VRAAG VAN JELLE ===\n${question}`,
    ].join("\n");
  }
  const taakBlok = hasWeb
    ? `JE TAAK:
1. Lees de INTERNE CONTEXT en de WEB-RESEARCH hieronder.
2. Schrijf één samenhangend antwoord dat BEIDE bronnen gebruikt:
   - Interne feiten (uit CONTEXT-blok) → citeer met [bron #N].
   - Externe feiten (uit WEB-RESEARCH) → noem de URL plain.
3. Begin met interne info, vul aan met web. Niet de twee scheiden.
4. ALS de interne context relevante info heeft, MOET het antwoord ten minste één [bron #N] bevatten.
`
    : `JE TAAK:
1. Beantwoord op basis van de INTERNE CONTEXT hieronder.
2. Citeer elk feit met [bron #N].
3. Verzin geen feiten, geen externe bronnen.
`;
  const formatBlok = `
FORMAT (default):
- Korte inleiding (1-2 zinnen).
- Lopende paragrafen waar mogelijk. Bullets alleen voor echte opsommingen.
- **bold** voor sleutelfeiten. ## kopjes alleen bij meerdere onderwerpen.
- VERBODEN: markdown-link-citaten [[1]](https://...). URLs gewoon plain.

Eindig met:
## Vervolgvragen
- vraag 1
- vraag 2
`;
  const prefBlok = prefAdditions ? `\nVOORKEUREN (overschrijven default-format waar conflict):\n${prefAdditions}\n` : "";
  const webBlock = hasWeb ? `=== WEB-RESEARCH (externe info via gpt-4o-search-preview) ===\n${webText}\n=== EINDE WEB-RESEARCH ===\n\n` : "";
  return [
    taakBlok,
    entityLine,
    `=== INTERNE CONTEXT ===\n${ctxBlob}\n=== EINDE CONTEXT ===\n\nBeschikbare interne bron-nummers: ${validNs || "(geen)"}.`,
    webBlock,
    formatBlok,
    prefBlok,
    `\n=== VRAAG VAN JELLE ===\n${question}`,
  ].join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept" }});
  const baseHeaders = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: baseHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: any;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers: baseHeaders }); }

  const message: string = (body.message ?? "").trim();
  const history: any[] = Array.isArray(body.history) ? body.history.slice(-10) : [];
  const top_k: number = Math.max(3, Math.min(60, body.top_k ?? MAX_CONTEXT_CHUNKS));
  const filter_sources: string[] | null = Array.isArray(body.filter_sources) ? body.filter_sources : null;
  const force_no_entity: boolean = body.force_no_entity === true;
  const wantsStream: boolean = body.stream === true;
  const webSearch: boolean = body.web_search === true;
  const writingStyle: string | null = typeof body.writing_style === "string" ? body.writing_style : null;
  const tone: string | null = typeof body.tone === "string" ? body.tone : null;
  const focus: string | null = typeof body.focus === "string" ? body.focus : null;
  if (!message || message.length < 2) return new Response(JSON.stringify({ ok: false, error: "message_required", min_chars: 2 }), { status: 400, headers: baseHeaders });

  const t0 = Date.now();
  const dbg: any = { web_search: webSearch, prefs: { style: writingStyle, tone, focus } };

  try {
    const grokKey = await getCfg(supabase, "legal-ai-research", "grok_api_key");
    const openaiKey = webSearch ? await getCfg(supabase, "openai", "embedding_key") : null;
    if (!grokKey) return new Response(JSON.stringify({ ok: false, error: "grok_api_key_missing" }), { status: 400, headers: baseHeaders });
    if (webSearch && !openaiKey) return new Response(JSON.stringify({ ok: false, error: "openai_api_key_missing" }), { status: 400, headers: baseHeaders });
    const cohereKey = await getCfg(supabase, "rag-chat", "cohere_api_key");
    const cronSecret = await getCfg(supabase, "global", "cron_secret");
    if (!cronSecret) throw new Error("cron_secret_missing");

    const prefAdditionsPromise = getPreferenceAdditions(supabase, { style: writingStyle, tone, focus });

    const { data: promptCfg } = await supabase.from("agent_config").select("config_value").eq("agent_name", "rag-chat").eq("config_key", "system_prompt").maybeSingle();
    const systemPrompt: string = (typeof promptCfg?.config_value === "string") ? promptCfg.config_value : (promptCfg?.config_value ? String(promptCfg.config_value) : "Je bent een behulpzame Nederlandse RAG-assistent. Combineer altijd interne CONTEXT (met [bron #N]) en, als beschikbaar, web-research (met URL's) in één samenhangend antwoord.");

    // ── Vragenbak-router (v5.0): structured / sweep / agentic / semantic ────
    // Goedkope regex-gate eerst; alleen bij hit draait de mini-router. Elke
    // fout of twijfel valt terug op het bestaande semantische pad.
    let analytics: any = null;
    const gateHit = routeGateHit(message);
    if (gateHit) {
      dbg.route_gate = true;
      const routerKey = openaiKey || await getCfg(supabase, "openai", "embedding_key");
      if (routerKey) {
        const decision = await classifyRoute(routerKey, message, dbg);
        dbg.route = decision.route;
        if (decision.route === "structured") analytics = await runStructured(supabase, decision, dbg);
        else if (decision.route === "sweep") analytics = await runSweep(supabase, routerKey, decision, dbg);
        else if (decision.route === "agentic") {
          const agenticModel = await getCfg(supabase, "rag-chat", "agentic_model");
          analytics = await runAgentic(supabase, routerKey, message, dbg, agenticModel);
        }
        if ((decision.route === "structured" || decision.route === "sweep" || decision.route === "agentic") && !analytics) dbg.route_fallback = "motor_null_to_semantic";
      }
    }
    dbg.analytics_used = !!analytics;

    const t1 = Date.now();
    let entityHint: any | null = null;
    if (!force_no_entity && !analytics) {
      entityHint = await tryResolveEntity(supabase, message);
      if (!entityHint) { entityHint = inheritEntityFromHistory(history); if (entityHint) dbg.entity_inherited = true; }
    }
    dbg.entity_resolve_ms = Date.now() - t1;
    dbg.entity_found = !!entityHint;

    let rpcChunks: any[] = [];
    if (entityHint && (entityHint.entity_type === "company" || entityHint.entity_type === "contact")) {
      const t2 = Date.now();
      try { rpcChunks = await fetchEntityTimelineChunks(supabase, entityHint); } catch (e) { dbg.rpc_error = e instanceof Error ? e.message : String(e); }
      dbg.rpc_fetch_ms = Date.now() - t2;
      dbg.rpc_chunks = rpcChunks.length;
      dbg.rpc_fireflies = rpcChunks.filter((c) => c.via === "rpc_timeline_fireflies").length;
    }

    const webResearchPromise: Promise<{ webText: string; web_citations: any[]; ms: number } | null> =
      webSearch && openaiKey && !analytics ? callOpenAIResearch(openaiKey, message).catch((e) => { dbg.web_research_error = e instanceof Error ? e.message : String(e); return null; }) : Promise.resolve(null);

    const skipContextBuild = !!analytics || rpcChunks.length >= SKIP_CONTEXT_BUILD_IF_RPC_CHUNKS;
    if (skipContextBuild) dbg.context_build_skipped = analytics ? "analytics_route" : `rpc_already_has_${rpcChunks.length}_chunks`;

    let cb: any = { matches: [], retrieval_strategy: null, bundle_id: null };
    if (!skipContextBuild) {
      const cbOptions: any = { top_k: MAX_PRE_RERANK_CHUNKS, filter_sources, min_similarity: 0.30 };
      if (entityHint) { cbOptions.entity_type = entityHint.entity_type; cbOptions.entity_id = entityHint.entity_id; }
      try {
        const t3 = Date.now();
        const cbRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/context-build`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${cronSecret}` },
          body: JSON.stringify({ intent: "search", audience: "rag-chat", trigger_type: "chat", trigger_id: null, query_text: message, options: cbOptions }),
          signal: AbortSignal.timeout(CONTEXT_BUILD_TIMEOUT_MS),
        });
        dbg.vector_fetch_ms = Date.now() - t3;
        if (cbRes.ok) { const cbText = await cbRes.text(); cb = JSON.parse(cbText); if (!cb.ok) cb = { matches: [], retrieval_strategy: null, bundle_id: null }; }
        else dbg.vector_http_status = cbRes.status;
      } catch (e) { dbg.vector_error = e instanceof Error ? e.message : String(e); }
    }
    const vectorChunks: any[] = (cb.matches ?? []);
    dbg.vector_chunks = vectorChunks.length;

    const seen = new Set(rpcChunks.map((c) => c.chunk_id));
    const merged: any[] = [...rpcChunks];
    for (const v of vectorChunks) { if (!seen.has(v.chunk_id)) { merged.push(v); seen.add(v.chunk_id); } }
    // Churn-status is een hard feit en mag nooit door de reranker wegvallen:
    // buiten de rerank houden en vooraan terugzetten.
    const churnChunks = merged.filter((c) => c.via === "rpc_churn_status");
    const preRerank = merged.filter((c) => c.via !== "rpc_churn_status").slice(0, MAX_PRE_RERANK_CHUNKS);
    dbg.pre_rerank_chunks = preRerank.length;
    if (churnChunks.length > 0) dbg.churn_status_chunk = true;

    const { chunks: rerankedMatches, used: rerankUsed, ms: rerankMs, error: rerankError } = await rerankChunks(cohereKey, message, preRerank, Math.max(1, MAX_CONTEXT_CHUNKS - churnChunks.length));
    const matches = [...churnChunks, ...rerankedMatches];
    dbg.rerank_used = rerankUsed;
    if (rerankMs != null) dbg.rerank_ms = rerankMs;
    if (rerankError) dbg.rerank_error = rerankError;
    dbg.merged_chunks = matches.length;

    const [webResearch, prefAdditions] = await Promise.all([webResearchPromise, prefAdditionsPromise]);
    if (webResearch) dbg.web_research_ms = webResearch.ms;
    if (prefAdditions) dbg.prefs_applied = true;

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
    const ctxBlob = analytics ? analyticsContextBlob(analytics) : (ctxLines.length > 0 ? ctxLines.join("\n\n---\n\n") : "(geen interne context-stukken gevonden)");
    const validNs = matches.map((_, i) => i + 1).join(", ");
    const userMsg = buildCombinedUserMessage({ question: message, entityHint, ctxBlob, validNs, webText: webResearch?.webText || null, prefAdditions, analytics });
    const sanitizedHistory = history.filter((h) => h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string").map((h) => ({ role: h.role, content: h.content.slice(0, 4000) }));

    const citations = analytics
      ? (analytics.route === "sweep"
          ? (analytics.rows || []).slice(0, 40).map((r: any, i: number) => ({ n: i + 1, chunk_id: null, source: "mail", id: r.mail_id, subject: r.naam, from_name: r.sender, occurred_at: r.datum || null, similarity: null, rerank_score: r.confidence ?? null, preview: (r.citaat || r.bewijs || "").slice(0, CITATION_PREVIEW_CAP), entity_path: null, via: "sweep_evidence" }))
          : [])
      : matches.map((m, i) => ({ n: i + 1, chunk_id: m.chunk_id, source: m.source, id: m.id, subject: m.subject || deriveSubject(m), from_name: m.from_name, occurred_at: m.occurred_at, similarity: m.similarity, rerank_score: m.rerank_score, preview: (m.preview || m.content || "").slice(0, CITATION_PREVIEW_CAP), entity_path: m.entity_path, via: m.via || (m.similarity != null ? "vector" : "unknown") }));
    const web_citations = webResearch?.web_citations || [];

    const strategyParts = [];
    if (analytics) strategyParts.push(`analytics:${analytics.route}${analytics.tool ? ":" + analytics.tool : ""}`);
    else if (entityHint) strategyParts.push(`hybrid_rpc${vectorChunks.length > 0 ? "+vector" : (skipContextBuild ? "+skip-cb" : "")}${entityHint.via === "inherited_from_history" ? "+inherited" : ""}${(dbg.rpc_fireflies ?? 0) > 0 ? "+fireflies" : ""}`);
    else strategyParts.push(cb.retrieval_strategy || "vector");
    if (rerankUsed) strategyParts.push("+rerank");
    if (webResearch) strategyParts.push("+web-research");
    const prefsActive = [writingStyle, tone, focus].filter((x) => x && x !== "standaard" && x !== "neutraal" && x !== "analyse");
    if (prefsActive.length > 0) strategyParts.push(`+prefs:${prefsActive.join(",")}`);
    const retrievalStrategy = strategyParts.join("");

    // Query-log (Vragenbak v2 W3): elke vraag — óók semantic — naar
    // rag_chat_query_log; basis voor router/tool-review in echt gebruik.
    const queryLogId = crypto.randomUUID();
    const baseLog: Record<string, unknown> = {
      id: queryLogId,
      question: message.slice(0, 2000),
      gate_hit: gateHit,
      route: analytics?.route || "semantic",
      tool: analytics?.tool || null,
      tools_used: analytics?.tools_used || null,
      rows_returned: analytics ? (analytics.rows || []).length : null,
      scanned_n: analytics?.scanned_n ?? null,
      entity: entityHint ? { type: entityHint.entity_type, name: entityHint.name, via: entityHint.via } : null,
      answer_model: GROK_MODEL,
      est_cost_usd: analytics?.cost?.est_usd ?? null,
      router_ms: dbg.router_ms ?? null,
      stream: wantsStream,
      route_fallback: dbg.route_fallback ?? null,
      meta: { retrieval_strategy: retrievalStrategy, chunk_count: matches.length, web_search: webSearch, agentic_model: dbg.agentic_model ?? null },
    };
    const logQuery = async (extra: Record<string, unknown>) => {
      try {
        const { error } = await supabase.from("rag_chat_query_log").insert({ ...baseLog, ...extra });
        if (error) console.error("[rag-chat] query_log insert failed", error.message);
      } catch (e) { console.error("[rag-chat] query_log insert threw", e instanceof Error ? e.message : String(e)); }
    };

    const metaPayload: any = { type: "meta", citations, bundle_id: cb.bundle_id, retrieval_strategy: retrievalStrategy, entity_used: entityHint, chunk_count: matches.length, analytics: analytics || null, debug_pipeline: dbg, model: GROK_MODEL, web_search_enabled: webSearch, web_search_used: !!webResearch && web_citations.length > 0, web_search_calls: webResearch ? 1 : 0, prefs: { style: writingStyle, tone, focus }, query_log_id: queryLogId };

    if (!wantsStream) {
      const tGrok0 = Date.now();
      const { answer, usage } = await callGrokChat(grokKey!, systemPrompt, sanitizedHistory, userMsg);
      const tGrok = Date.now() - tGrok0;
      await logQuery({ latency_ms: Date.now() - t0, answer_chars: answer.length });
      return new Response(JSON.stringify({ ok: true, answer, ...metaPayload, web_citations, timing_ms: { total: Date.now() - t0, grok: tGrok }, tokens: { retrieval: cb.retrieval_meta?.tokens?.total ?? 0, chat_in: usage?.prompt_tokens ?? 0, chat_out: usage?.completion_tokens ?? 0 } }), { status: 200, headers: baseHeaders });
    }

    const grokRes = await callGrokChatStream(grokKey!, systemPrompt, sanitizedHistory, userMsg);
    if (!grokRes.ok || !grokRes.body) { const errTxt = await grokRes.text().catch(() => ""); throw new Error(`grok_stream_${grokRes.status}: ${errTxt.slice(0, 300)}`); }
    const stream = new ReadableStream({
      async start(controller) {
        const tGrok0 = Date.now();
        let closed = false;
        const safeEnqueue = (chunk: Uint8Array) => { if (closed) return; try { controller.enqueue(chunk); } catch { closed = true; } };
        safeEnqueue(sseChunk(metaPayload));
        const reader = grokRes.body!.getReader();
        const decoder = new TextDecoder();
        let buf = ""; let usage: any = null; let finishReason: string | null = null; let answerChars = 0; let streamError: string | null = null;
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let idx = buf.indexOf("\n\n");
            while (idx >= 0) {
              const eventBlock = buf.slice(0, idx); buf = buf.slice(idx + 2); idx = buf.indexOf("\n\n");
              for (const line of eventBlock.split("\n")) {
                if (!line.startsWith("data:")) continue;
                const payload = line.slice(5).trim();
                if (payload === "[DONE]") continue;
                try {
                  const json = JSON.parse(payload);
                  const delta = json.choices?.[0]?.delta?.content;
                  if (delta) { answerChars += delta.length; safeEnqueue(sseChunk({ type: "delta", text: delta })); }
                  if (json.choices?.[0]?.finish_reason) finishReason = json.choices[0].finish_reason;
                  if (json.usage) usage = json.usage;
                } catch { /* ignore */ }
              }
            }
          }
        } catch (e) { streamError = e instanceof Error ? e.message : String(e); safeEnqueue(sseChunk({ type: "error", error: streamError })); }
        safeEnqueue(sseChunk({ type: "done", timing_ms: { total: Date.now() - t0, grok: Date.now() - tGrok0 }, tokens: { retrieval: cb.retrieval_meta?.tokens?.total ?? 0, chat_in: usage?.prompt_tokens ?? 0, chat_out: usage?.completion_tokens ?? 0 }, finish_reason: finishReason, web_citations, web_search_used: metaPayload.web_search_used, web_search_calls: metaPayload.web_search_calls }));
        await logQuery({ latency_ms: Date.now() - t0, answer_chars: answerChars, error: streamError });
        try { controller.close(); } catch { /* already closed */ }
        closed = true;
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "Access-Control-Allow-Origin": "*", "X-Accel-Buffering": "no" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[rag-chat] top-level error", msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: baseHeaders });
  }
});
