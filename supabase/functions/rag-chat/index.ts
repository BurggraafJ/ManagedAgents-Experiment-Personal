// =============================================================================
// rag-chat v5.8 — S3b stap 1: Sol op de agent-lus, Luna op de hulpmodellen, echte tarieven
// =============================================================================
// v5.8 (2026-09-06, ANSWER-STACK S3b stap 1). Geen zichtbare wijziging: Grok
//   schrijft nog élk antwoord, ook de navertelling van de agent-conclusie.
//   - agent_config rag-chat/agentic_model → gpt-5.6-sol (migratie 20260906170000);
//     PRICE_PER_M in agentic.ts kent nu sol/terra/luna — zonder die rij viel de
//     lus stil terug op gpt-5.5. Sol krijgt reasoning_effort 'none' (het enige
//     dat /v1/chat/completions met function-tools accepteert; zie agentic.ts).
//   - sweep-verdicts → gpt-5.6-luna (analytics.ts); HyDE-rewrite +
//     LLM-rerank → luna (context-build v2.9); evaljudge → luna (rag-eval-cron v3.1).
//     De router ging óók naar luna maar staat sinds het merge-besluit weer op
//     gpt-5.4-mini (analytics.ts v2.6: luna 7/34 vs mini 4/34 route-verschillen).
//   - PRICE_USD grok 3/15 → 1,25/2,50 (officiële xAI-lijstprijs); gpt-5.5
//     1,25/10 → 5/30. De gelogde kosten waren voor Grok 2,4-6× te hoog en voor de
//     agent-lus ~3× te laag. G5 wordt in dezelfde PR opnieuw geijkt.
//   - cached_tokens uit OpenAI-antwoorden worden gelogd en tegen het
//     cache-tarief geprijsd (agent-lus; judge in rag-eval-cron).
// v5.7 (2026-09-06, spoor 01): body.eval_run_id → rag_chat_query_log.meta.eval_run_id.
// v5.6 (2026-09-05, AGENT-REBUILD WP1/WP2/WP4). Vier dingen, alle vier uit een
// meting en niet uit een vermoeden.
//
// WP1 — het retrieval-budget klopte niet. Gemeten op 20 echte vragen uit
//   rag_chat_query_log, met exact de parameters die deze functie stuurt:
//   intent=search deed p50 13.282 ms en p95 23.318 ms, terwijl hieronder een
//   grens van 6.000 ms staat. 18 van de 20 lagen daarboven: negen van de tien
//   semantische chatvragen kwam als "0 fragmenten" bij Jelle aan, zonder één
//   foutmelding. De oorzaak zat niet in HyDE of de dubbele reranker (samen ~3 s
//   van de ~13) maar in de BM25-arm van match_chunks — zie migratie
//   20260905180000. Nieuw recept `search_fast`: p50 2.370 ms, p95 3.071 ms,
//   0 van de 20 boven de grens, 0 lege bundels. Het zware `search` blijft
//   bestaan als agent-tool (semantic_search, eigen budget van 30 s).
//
// WP2 — een leeg antwoord noemt nu zijn oorzaak. `coverage.reason` uit een
//   gesloten verzameling (timeout | acl_filtered | below_threshold |
//   truly_empty | not_tracked) loopt van context-build via deze functie naar
//   het antwoord dat de gebruiker leest én naar rag_chat_query_log. Daarnaast:
//   één tweede poging met een lagere drempel als de eerste ronde te dun is, de
//   ILIKE-entityval is dicht, en de zelfheling kijkt naar bruikbare context in
//   plaats van naar "is er een naam gematcht".
//
// WP4 — het antwoord heeft een contract. `envelope` (claim, definition,
//   sources, rows/columns, coverage, artifacts, cost) staat naast de vrije
//   markdown, zodat de UI een tabel kan tonen, de gebruiker een Excel kan
//   downloaden en de evalharnas kan asserten zonder reguliere expressies over
//   proza te leggen.
//
// v5.5 (2026-07-17, review-ronde 6 Jelle): agentic-antwoord opent met de KERN
//   i.p.v. de machine-claim ("Agentic beantwoord met 8 tool-call(s)...") —
//   meta-taal is verboden in de lopende tekst; dekking = natuurlijke slotzin.
//   Harde leesbaarheidsregels (NN/g-onderzoek): alinea's van 2-4 zinnen met
//   lege regel, max 1-2 bold per alinea, ## kopjes bij >2 onderwerpen.
// v5.4 (2026-07-17, review-ronde 5 Jelle): de router (gpt-5.4-mini) draait op
//   ELKE vraag als eerste stap — de regex-gate is geen poort meer, alleen nog
//   telemetrie. Semantisch zoeken is een volwaardige door-de-router-gekozen
//   route met "why" in de trace én vondsten op tijdlijn/kennisindex/rerank-
//   stappen. Self-healing (weinig context → agent) werkt nu voor alle vragen.
//   Aanleiding: "turn in april en of dat nog leeft in juni" miste de gate en
//   viel zonder interpretatie het vector-pad in (2× in de query-log).
// v5.3 (2026-07-17, review-ronde 4 Jelle): elke tool-step draagt nu de top-5
//   vondsten (datum·naam·detail) + leesbare argumenten mee — de UI toont per
//   call wát er gevonden is. Tool-tuning uit helicopter-review: semantic_search
//   timeout 10→15s (19% time-outte), mail-voorfilter 30→20 kandidaten,
//   prompt-regel tegen bijna-identieke herhaalqueries.
// v5.2 (2026-07-16, review-ronde 2 Jelle — "ik wil hem zien redeneren"):
//   - ReAct: de agent schrijft vóór elke tool-beurt 1-2 zinnen gedachte
//     ("De april-churns zijn binnen: Beer (prijs)… nu check ik of prijsdruk
//     nog speelt") → live 💭-stap in de UI + in de trace/query-log.
//   - Nieuwe agent-tools: semantic_search (de kennisindex als tool — de agent
//     kan zelf thematisch doorzoeken) en customer_timeline (per klant de
//     diepte in: mails + notities + churn-status, fuzzy op naam).
//   - Router-definitie agentic verbreed: ook vergelijken/verklaren over tijd
//     ("waarom", "geldt dat nog", periodes naast elkaar) — niet alleen
//     activiteiten. Jelle's turnredenen-vraag (16/7 18:15) ging hierdoor mis.
//   - Self-healing: gate-hit + semantic vindt <3 fragmenten → de agent neemt
//     het alsnog over i.p.v. "geen context".
//   - Caps agent: 10 tool-calls / 150s / $0,50.
// v5.1 (2026-07-07, review-ronde Jelle):
//   - Reasoning-steps: de pipeline meldt elke ECHTE stap (route-besluit,
//     per-tool "X doorzocht: N resultaten (M gescand)", tijdlijn/vector/rerank)
//     als SSE {type:'status', step}. Stream-modus opent de verbinding EERST en
//     draait de pipeline daarbinnen — de UI wordt live meegenomen, óók bij een
//     agentic-run van 30-60s. meta.steps + query-log.meta.steps = de trace.
//   - History-aware: router én agentic-loop krijgen het gesprek mee, zodat
//     follow-ups ("en de maand ervoor?") correct geparametriseerd worden.
//   - Analytics-antwoord maakt GEEN markdown-tabel meer (de UI toont de exacte
//     tabel al via AnalyticsBlock; de chat-markdown rendert pipes bovendien
//     als platte tekst) — alleen korte duiding + verwijzing.
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
import { runAgentic, TOOL_STEP_LABELS, evidenceRows, DOCS_QUESTION_RE, type MirrorCtx } from "./agentic.ts";
import { loadOrgSkills, generalGuidanceBlock } from "./org-skills.ts";

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

// v1.145 — documentatievragen krijgen een eigen, licht recept (`search_docs`:
// geen HyDE, geen entity-anchor, geen rerank, recency 0,05/365). Dezelfde
// woordenlijst als de bron-hint in context-build, zodat "wat staat er in de
// documentatie over X" niet in twee functies uiteenloopt.
//
// Waarom dit een aparte intent is en niet een hogere time-out: de grens
// ophogen maakt élke chatvraag trager en laat de oorzaak staan. Een wiki-vraag
// is een platte semantische zoekactie over ~1000 chunks; die hoort binnen de
// 6 s te passen, en met dit recept doet hij dat ook.
//
// DOCS_QUESTION_RE staat in agentic.ts (de leaf-module) en wordt hier
// geïmporteerd: de agentic tool moet dezelfde vraag hetzelfde routeren, en
// twee kopieën van deze regex lopen gegarandeerd uiteen.

// v5.6 — STOP_WORDS hoorde bij de verwijderde ILIKE-entityresolutie en heeft
// geen andere gebruiker meer. Weg ermee: een ongebruikte woordenlijst gaat
// afdrijven van de lijsten die wél meedoen (parseQueryIntent in
// context-build, v_stop in rag_resolve_entity) en dan lijkt hij nog te gelden.

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

// ── WP2: een leeg antwoord noemt zijn oorzaak ────────────────────────────────
// Vijf redenen, vijf zinnen. Dit is geen logregel maar de tekst die in de
// context-plaats van de prompt komt te staan, zodat het antwoord dat Jelle
// leest de reden noemt in plaats van er beleefd omheen te schrijven.
//
// De formuleringen zijn met opzet feitelijk en zonder excuus. En bij
// `acl_filtered` staat er nadrukkelijk NIET wat er is afgeschermd: het bestaan
// van een pagina in een afgeschermde space is zelf informatie (§5.9).
const COVERAGE_SENTENCE: Record<string, string> = {
  timeout:
    "(GEEN INTERNE CONTEXT — REDEN: de zoekactie in de kennisindex liep in een time-out. Er is dus niets doorzocht; dit zegt NIETS over of de informatie bestaat.)",
  acl_filtered:
    "(GEEN INTERNE CONTEXT — REDEN: de wiki is voor deze gebruiker maar gedeeltelijk leesbaar en binnen het leesbare deel staat niets over deze vraag. Noem dat de dekking beperkt is; noem NOOIT welke spaces of pagina's zijn afgeschermd.)",
  below_threshold:
    "(GEEN INTERNE CONTEXT — REDEN: er zijn wel fragmenten gevonden, maar geen enkele haalde de gelijkenisdrempel, ook niet na een tweede poging met een lagere drempel. Er is dus iets dat er in de verte op lijkt, maar niets dat de vraag beantwoordt.)",
  truly_empty:
    "(GEEN INTERNE CONTEXT — REDEN: de kennisindex bevat hier niets over. Doorzocht is wel degelijk; er staat niets.)",
  not_tracked:
    "(GEEN INTERNE CONTEXT — REDEN: onbekend; de reden kon niet worden vastgesteld.)",
};
function coverageBlob(reason: string | null): string {
  return COVERAGE_SENTENCE[reason ?? ""] ?? "(geen interne context-stukken gevonden)";
}

// ── WP3: wat kost één vraag, over álle leveranciers heen ─────────────────────
// `est_cost_usd` werd tot v5.6 alleen gevuld vanuit `analytics.cost`, en dat
// bestaat alleen op de structured/sweep/agentic-routes. Het semantische pad —
// embedding, Cohere, Grok — kostte geld dat nergens landde. Van de 68 runs in
// de laatste 30 dagen had 62 % dus geen kostenregel.
//
// Tarieven zijn beleid, tokens zijn feiten. Daarom landen de ruwe tokens per
// leverancier ALTIJD in `meta.usage`, en is de prijs hieronder een aparte,
// herrekenbare laag. Verandert een tarief, dan is de historie opnieuw te
// berekenen zonder dat er data verloren is.
//
// Alle vier zijn publieke lijstprijzen. Grok-4.3 (xAI models-pagina, 2026-09-06):
// $1,25 in / $2,50 uit per 1M in het basistarief; het lange-contexttarief (2×)
// geldt pas als de prompt de drempel haalt, en onze prompts zijn ~5k tokens.
// Tot v5.8 stond hier de schatting 3,00/15,00 — 2,4× tot 6× te hoog — en
// daarmee was elke gelogde semantische kostprijs (en de G5-drempel) fout.
// Embedding en Cohere: text-embedding-3-large $0,13/1M tokens, rerank-v3.5
// $2,00 per 1000 zoekacties. Wijzigt een tarief, dan hoort de datum erbij.
const PRICE_USD = {
  embed_per_1m: 0.13,
  cohere_per_search: 0.002,
  grok_in_per_1m: 1.25,   // xAI lijstprijs grok-4.3, 2026-09-06
  grok_out_per_1m: 2.50,  // idem
};
function estimateCostUsd(u: { embed_tokens?: number; cohere_calls?: number; grok_in?: number; grok_out?: number; analytics_usd?: number | null }): number {
  const c =
    ((u.embed_tokens ?? 0) / 1_000_000) * PRICE_USD.embed_per_1m +
    (u.cohere_calls ?? 0) * PRICE_USD.cohere_per_search +
    ((u.grok_in ?? 0) / 1_000_000) * PRICE_USD.grok_in_per_1m +
    ((u.grok_out ?? 0) / 1_000_000) * PRICE_USD.grok_out_per_1m +
    (u.analytics_usd ?? 0);
  return Math.round(c * 1e6) / 1e6;
}

function buildCombinedUserMessage(opts: { question: string; entityHint: any | null; ctxBlob: string; validNs: string; webText: string | null; prefAdditions: string; analytics?: any | null; coverageReason?: string | null }): string {
  const { question, entityHint, ctxBlob, validNs, webText, prefAdditions, analytics, coverageReason } = opts;
  const entityLine = entityHint ? `Gedetecteerde entity: ${entityHint.entity_type} "${entityHint.name}"${entityHint.via === "inherited_from_history" ? " (overgeërfd)" : ""}.\n` : "";
  const hasWeb = !!webText;
  if (analytics) {
    const sweepCiteLine = analytics.route === "sweep" && (analytics.rows || []).length > 0
      ? "5. Noem bij elke partij die je in de tekst bespreekt de bron als [bron #N] — N is het rijnummer in de DATA (zelfde volgorde).\n"
      : "";
    // v5.5: de agentic-claim ("Agentic beantwoord met 8 tool-call(s)...") is
    // machine-jargon — die hoort in de UI-banner, niet in de lopende tekst.
    // Bij agentic opent het antwoord dus met de KERN; bij structured/sweep
    // blijft de (leesbare) dekking-claim de opening.
    const openingLine = analytics.route === "agentic"
      ? `2. Open direct met de kern van het antwoord in gewone taal — GEEN meta-taal: woorden als "tool-call", "evidence", "route", "agentic" of "records gescand" zijn VERBODEN in je tekst. Sluit het antwoord af met één natuurlijke dekkingszin: welke bronnen en periodes zijn doorzocht (bv. "Gebaseerd op de churn-administratie, agenda en het mailarchief over april–juni 2026.").`
      : `2. Begin je antwoord met de dekking-claim: "${String(analytics.claim || "").replace(/"/g, "'")}"`;
    // v5.1: GEEN markdown-tabel meer in het antwoord — de UI rendert de exacte
    // resultaattabel al (AnalyticsBlock). Dubbel was lelijk én de chat-markdown
    // rendert pipes als platte tekst.
    return [
      `JE TAAK (analytische vraag — exact berekende data):
1. De DATA hieronder is deterministisch uit de database berekend en is COMPLEET voor de gegeven definitie. Gebruik uitsluitend deze data; verzin of verwijder niets.
${openingLine}
3. BELANGRIJK: onder je antwoord toont de interface al de exacte resultaattabel met alle rijen. Maak dus GEEN markdown-tabel en som NIET alle rijen op. Noem de 2-6 belangrijkste namen/aantallen/datums (datums als dd-mm-jjjj) en eventuele opvallendheden; verwijs met één zin naar de tabel hieronder voor het volledige overzicht.
4. LEESBAARHEID (hard): korte alinea's van 2-4 zinnen met een LEGE REGEL ertussen — nooit één lap tekst. Maximaal 1-2 **vetgedrukte** sleutelwoorden per alinea. Gebruik ## kopjes zodra je meer dan twee onderwerpen behandelt (bv. per periode of per thema). Bullets alleen voor echte opsommingen van 3+ items.
${sweepCiteLine}6. Staat er 0 rijen of een LET OP-regel: zeg dan eerlijk dat dit niet (volledig) uit de data te beantwoorden is en waarom — geen alternatieve lijst fantaseren. Een LET OP-regel (zoals churns zonder datum) hoort kort benoemd in je antwoord.`,
      "",
      `=== DATA (deterministisch) ===\n${ctxBlob}\n=== EINDE DATA ===`,
      prefAdditions ? `\nVOORKEUREN (overschrijven default-format waar conflict):\n${prefAdditions}\n` : "",
      `\nEindig met:\n## Vervolgvragen\n- vraag 1\n- vraag 2`,
      `\n=== VRAAG VAN JELLE ===\n${question}`,
    ].join("\n");
  }
  // WP2 — is er geen interne context, dan is de reden onderdeel van het antwoord
  // en geen voetnoot. Zonder deze regel schrijft het model een beleefde alinea
  // om de leegte heen ("ik kon hier niets over vinden") en is een time-out van
  // buiten niet te onderscheiden van een index die het echt niet weet.
  const coverageBlok = coverageReason
    ? `
DEKKING (verplicht in je antwoord):
- Er is GEEN interne context. De reden staat hierboven tussen haakjes in het CONTEXT-blok.
- Zeg in één zin, in gewone taal, WAAROM je niets kunt onderbouwen — gebruik de reden hierboven, verzin er geen andere bij.
- Onderscheid daarbij hard: "de zoekactie liep vast" is iets anders dan "er staat niets". Draai die twee nooit door elkaar.
- Geen [bron #N] verzinnen, geen antwoord uit algemene kennis presenteren alsof het uit Legal Mind-data komt.
- Sluit af met wat er wél zou helpen (een andere formulering, een periode, een naam) — maximaal één zin.
`
    : "";
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
- Korte inleiding (1-2 zinnen), daarna de inhoud.
- Korte alinea's van 2-4 zinnen met een LEGE REGEL ertussen — nooit één lap tekst.
- Maximaal 1-2 **vetgedrukte** sleutelwoorden per alinea; ## kopjes zodra je meer dan twee onderwerpen behandelt.
- Bullets alleen voor echte opsommingen van 3+ items.
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
    coverageBlok,
    entityLine,
    `=== INTERNE CONTEXT ===\n${ctxBlob}\n=== EINDE CONTEXT ===\n\nBeschikbare interne bron-nummers: ${validNs || "(geen)"}.`,
    webBlock,
    formatBlok,
    prefBlok,
    `\n=== VRAAG VAN JELLE ===\n${question}`,
  ].join("\n");
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
function callerSub(req: Request): string | null {
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.role === "authenticated" && typeof payload.sub === "string" ? payload.sub : null;
  } catch { return null; }
}

async function loadMirrorCtx(supabase: any, req: Request): Promise<MirrorCtx | null> {
  try {
    const sub = callerSub(req);
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
  // Spoor 01 — evalverkeer is herkenbaar. rag-eval-cron stuurt het run-id mee;
  // het landt in rag_chat_query_log.meta.eval_run_id en de gezondheidsviews
  // (v_agent_chat_health e.a.) sluiten die rijen uit. Alleen een uuid telt.
  const evalRunId: string | null = typeof body.eval_run_id === "string" && /^[0-9a-f-]{36}$/i.test(body.eval_run_id) ? body.eval_run_id : null;
  if (!message || message.length < 2) return new Response(JSON.stringify({ ok: false, error: "message_required", min_chars: 2 }), { status: 400, headers: baseHeaders });

  const t0 = Date.now();
  const dbg: any = { web_search: webSearch, prefs: { style: writingStyle, tone, focus } };

  // v5.1 reasoning-steps: elke pipeline-stap wordt in stream-modus live als
  // SSE {type:'status', step} gestreamd én verzameld voor meta.steps + query-log.
  const steps: Array<{ t: number; stage: string | null; label: string; detail?: string; args?: string; findings?: any[] }> = [];
  let emitEv: (ev: any) => void = () => {};
  // v5.3: extra.args (leesbare argumenten) + extra.findings (top-5 vondsten
  // per tool-call) gaan mee in de step — de reasoning-trace in de UI toont
  // per call wát er gevonden is, niet alleen dát er gezocht is.
  const pushStep = (label: string, detail?: string | null, stage?: string, extra?: { args?: string; findings?: any[] }) => {
    const step = {
      t: Date.now() - t0, stage: stage || null, label,
      ...(detail ? { detail } : {}),
      ...(extra?.args ? { args: extra.args } : {}),
      ...(extra?.findings?.length ? { findings: extra.findings.slice(0, 5) } : {}),
    };
    steps.push(step);
    try { emitEv({ type: "status", step }); } catch { /* stream al dicht */ }
  };

  try {
    const grokKey = await getCfg(supabase, "legal-ai-research", "grok_api_key");
    const openaiKey = webSearch ? await getCfg(supabase, "openai", "embedding_key") : null;
    if (!grokKey) return new Response(JSON.stringify({ ok: false, error: "grok_api_key_missing" }), { status: 400, headers: baseHeaders });
    if (webSearch && !openaiKey) return new Response(JSON.stringify({ ok: false, error: "openai_api_key_missing" }), { status: 400, headers: baseHeaders });
    const cohereKey = await getCfg(supabase, "rag-chat", "cohere_api_key");
    const cronSecret = await getCfg(supabase, "global", "cron_secret");
    if (!cronSecret) throw new Error("cron_secret_missing");
    const mirrorCtx = await loadMirrorCtx(supabase, req);
    dbg.mirror_available = !!mirrorCtx;

    // v1.145 — WIE stelt deze vraag? Nodig voor de Confluence-space-ACL: de
    // chat praat met context-build via het cron_secret, dus de service-role,
    // en dáár geldt geen RLS. Zonder deze regel valt elke aanroeper terug op
    // de org-baseline en ziet niemand een restricted space — ook niet wie er
    // wél bij mag.
    //
    // Los van mirrorCtx: die bestaat alleen als er een gespiegelde mailbox is.
    // Identiteit en mailbezit zijn twee dingen, net als p_caller_user_id en
    // p_owner_user_id in match_chunks.
    //
    // Cron-aanroepen hebben geen user-JWT en houden dus null = org-baseline.
    const callerUserId = callerSub(req);
    dbg.caller_identified = !!callerUserId;

    const prefAdditionsPromise = getPreferenceAdditions(supabase, { style: writingStyle, tone, focus });

    const { data: promptCfg } = await supabase.from("agent_config").select("config_value").eq("agent_name", "rag-chat").eq("config_key", "system_prompt").maybeSingle();
    const basePrompt: string = (typeof promptCfg?.config_value === "string") ? promptCfg.config_value : (promptCfg?.config_value ? String(promptCfg.config_value) : "Je bent een behulpzame Nederlandse RAG-assistent. Combineer altijd interne CONTEXT (met [bron #N]) en, als beschikbaar, web-research (met URL's) in één samenhangend antwoord.");
    // v1.134: in-app Skills (org_skills) — de door Jelle beheerde pijplijn-/
    // lead-kennis uit Organisatie › Skills gaat achter de system-prompt. Regels
    // mét tool_binding slaan we hier over; die hangt agentic.ts onder de tool
    // zelf. Faalt de tabel, dan blijft de prompt exact zoals hij was.
    const orgSkills = await loadOrgSkills(supabase);
    const systemPrompt: string = basePrompt + generalGuidanceBlock(orgSkills);
    dbg.org_skills_count = orgSkills.length;

    // ── Pipeline (v5.1): als closure zodat het stream-pad de SSE-verbinding
    // EERST kan openen en live status-events kan sturen terwijl dit draait.
    const runPipeline = async () => {

    // ── Interpretatie-eerst (v5.4): de router draait op ELKE vraag ──────────
    // De regex-gate is geen poort meer (miste bv. "turn in april") — hij blijft
    // alleen als telemetrie in dbg/query-log. Elke fout of twijfel in de router
    // valt terug op het semantische pad.
    let analytics: any = null;
    // v5.1: korte follow-ups ("En de maand daarvoor?") — gate-telemetrie kijkt
    // mee naar de laatste beurten; de router krijgt de history sowieso.
    const gateText = message.length < 80
      ? [message, ...history.slice(-2).map((h: any) => (typeof h?.content === "string" ? h.content : ""))].join(" ")
      : message;
    const gateHit = routeGateHit(gateText);
    dbg.route_gate = gateHit;
    const routerKey = openaiKey || await getCfg(supabase, "openai", "embedding_key");
    if (routerKey) {
      pushStep("Vraag interpreteren", "welke aanpak past: exacte data, groeps-sweep, agent-onderzoek of semantisch zoeken?", "router");
      const decision = await classifyRoute(routerKey, message, dbg, history);
      dbg.route = decision.route;
      if (decision.route === "structured") {
        pushStep(`Route: exacte data (${decision.tool})`, decision.why || null, "route");
        analytics = await runStructured(supabase, decision, dbg);
        if (analytics) pushStep(
          TOOL_STEP_LABELS[analytics.tool] || `${analytics.tool} uitgevoerd`,
          `${(analytics.rows || []).length} records${analytics.scanned_n ? ` (${analytics.scanned_n} gescand)` : ""}`,
          "data",
          { findings: evidenceRows(analytics.tool, analytics.rows || []).slice(0, 5).map((f: any) => ({ datum: f.datum || null, naam: String(f.naam || "").slice(0, 80), detail: String(f.detail || "").slice(0, 120) })) },
        );
      } else if (decision.route === "sweep") {
        pushStep("Route: groeps-sweep over het mailarchief", decision.why || null, "route");
        analytics = await runSweep(supabase, routerKey, decision, dbg, (label, detail) => pushStep(label, detail, "data"));
        if (analytics) pushStep(
          `${(analytics.rows || []).length} matches bevestigd`, null, "data",
          { findings: (analytics.rows || []).slice(0, 5).map((r: any) => ({ datum: r.datum || null, naam: String(r.naam || "").slice(0, 80), detail: String(r.citaat || r.bewijs || "").slice(0, 120) })) },
        );
      } else if (decision.route === "agentic") {
        pushStep("Route: agent-onderzoek — combineert meerdere bronnen", decision.why || null, "route");
        const agenticModel = await getCfg(supabase, "rag-chat", "agentic_model");
        analytics = await runAgentic(supabase, routerKey, message, dbg, agenticModel, history, (label, detail, stage, extra) => pushStep(label, detail, stage || "data", extra), cronSecret, mirrorCtx, callerUserId);
      } else {
        pushStep("Route: semantisch zoeken in de kennisindex", decision.why || null, "route");
      }
      if ((decision.route === "structured" || decision.route === "sweep" || decision.route === "agentic") && !analytics) {
        dbg.route_fallback = "motor_null_to_semantic";
        pushStep("Route gaf niets bruikbaars — terug naar semantisch zoeken", null, "route");
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
    if (entityHint) pushStep(`Entity herkend: ${entityHint.name}`, entityHint.via === "inherited_from_history" ? "uit het gesprek" : `match op "${entityHint.matched_term}"`, "entity");

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
        pushStep("Tijdlijn van deze relatie opgehaald", parts || `${rpcChunks.length} items`, "data", {
          findings: rpcChunks.slice(0, 5).map((c: any) => ({
            datum: c.occurred_at ? String(c.occurred_at).slice(0, 10) : null,
            naam: String(c.subject || c.source || "?").slice(0, 80),
            detail: `${c.source}${c.from_name ? ` · ${c.from_name}` : ""}`.slice(0, 120),
          })),
        });
        if (rpcChunks.some((c) => c.via === "rpc_churn_status")) pushStep("Klantstatus meegenomen: deze klant is gechurnd", null, "data");
      }
    }

    const webResearchPromise: Promise<{ webText: string; web_citations: any[]; ms: number } | null> =
      webSearch && openaiKey && !analytics ? callOpenAIResearch(openaiKey, message).catch((e) => { dbg.web_research_error = e instanceof Error ? e.message : String(e); return null; }) : Promise.resolve(null);

    const skipContextBuild = !!analytics || rpcChunks.length >= SKIP_CONTEXT_BUILD_IF_RPC_CHUNKS;
    if (skipContextBuild) dbg.context_build_skipped = analytics ? "analytics_route" : `rpc_already_has_${rpcChunks.length}_chunks`;

    let cb: any = { matches: [], retrieval_strategy: null, bundle_id: null, coverage: null };
    // WP2 — waarom leverde de retrieval niets op? Eén woord uit een gesloten
    // verzameling, dat helemaal doorloopt tot in het antwoord.
    let coverageReason: string | null = null;
    if (!skipContextBuild) {
      // Een documentatievraag gaat over het lichte recept, óók als er een entity
      // is herkend. De eerste versie hiervan had een `!entityHint`-guard, met het
      // idee dat graph-expansie dan de winst is. Op prod gemeten pakt dat
      // averechts uit: de titel van een wiki-pagina matcht vaak toevallig een
      // bedrijfsnaam, waarna de vraag alsnog op het zware `search`-recept
      // belandt. Zes chat-turns met exact dezelfde vraag gaven 5096/5271/5609 ms
      // (net binnen) tegen drie time-outs (net erbuiten) — dezelfde vraag gaf dus
      // afwisselend 40 fragmenten en nul. Met `search_docs` is de mediaan 2542 ms.
      //
      // WP1 (v5.6): de niet-documentatievraag gaat naar `search_fast` in plaats
      // van `search`. Gemeten over 20 echte vragen, zelfde parameters:
      //   search       p50 13.282 ms  p95 23.318 ms  18/20 boven de 6 s-grens
      //   search_fast  p50  2.370 ms  p95  3.071 ms   0/20 boven de grens
      // `search` verdwijnt niet: de agent-tool semantic_search gebruikt hem nog
      // steeds, met een eigen budget van 30 s. Zwaar zoeken mag — het mag alleen
      // niet de standaardroute van een interactieve vraag zijn.
      const cbIntent = DOCS_QUESTION_RE.test(message) ? "search_docs" : "search_fast";
      dbg.context_build_intent = cbIntent;

      // `top_k` is MAX_CONTEXT_CHUNKS (40), niet MAX_PRE_RERANK_CHUNKS (60).
      // Gemeten met EXPLAIN levert de vector-arm nooit meer dan hnsw.ef_search
      // rijen (default 40, niet te verhogen op deze instance — zie
      // CHAT_CONTEXT_CHUNKS), dus 60 vragen levert géén extra vector-kandidaten.
      // Het kost wel: op het entity-pad (match_chunks_for_entity + de semantische
      // aanvulling = twee zware queries) ging dezelfde vraag bij 60 twee keer
      // over de 6 s-grens, terwijl hij bij 40 in 3.398 ms klaar was. Direct
      // gemeten op context-build schelen ze weinig (p95 3.322 vs 3.071 ms); via
      // rag-chat, mét entity-hint en ná de router, is het verschil beslissend.
      // 40 in, 24 eruit — de reranker houdt zo alsnog een pool om uit te kiezen.
      // `enable_rerank: false` haalt de eerste van de twee Cohere-rondes weg:
      // die stuurde de eerste 60 kandidaten naar Cohere en vroeg er 60 terug
      // (pure herordening), waarna de rerank hieronder dezelfde 60 nóg eens
      // herordende naar 40. Eén reranker per vraag.
      const baseOptions: any = {
        top_k: MAX_CONTEXT_CHUNKS, filter_sources, min_similarity: 0.30,
        enable_rerank: false, async_bundle: true,
      };
      if (entityHint) { baseOptions.entity_type = entityHint.entity_type; baseOptions.entity_id = entityHint.entity_id; }

      const callContextBuild = async (opts: any, budgetMs: number) => {
        const t3 = Date.now();
        const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/context-build`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${cronSecret}` },
          body: JSON.stringify({ intent: cbIntent, audience: "rag-chat", trigger_type: "chat", trigger_id: null, query_text: message, caller_user_id: callerUserId, options: opts }),
          signal: AbortSignal.timeout(budgetMs),
        });
        const ms = Date.now() - t3;
        if (!res.ok) return { ok: false as const, status: res.status, ms };
        const json = JSON.parse(await res.text());
        return { ok: json.ok === true, json, ms, status: res.status } as any;
      };

      try {
        const r = await callContextBuild(baseOptions, CONTEXT_BUILD_TIMEOUT_MS);
        dbg.vector_fetch_ms = r.ms;
        if (r.ok) cb = r.json;
        else dbg.vector_http_status = r.status;
      } catch (e) {
        dbg.vector_error = e instanceof Error ? e.message : String(e);
        // Onderscheid time-out van een echte fout. Zonder dit is "0 fragmenten"
        // in het log niet te scheiden van "te traag", en dat was 15 van de 29
        // semantische runs — je debugt dan de retrieval terwijl de klok het doet.
        dbg.vector_timed_out = e instanceof Error && (e.name === "TimeoutError" || /timed? ?out/i.test(e.message));
        if (dbg.vector_timed_out) coverageReason = "timeout";
      }

      // WP2 — één tweede poging, niet meer. Levert de eerste ronde minder dan
      // drie fragmenten op, dan is de vraag: lag de lat te hoog, of stond het
      // bronfilter in de weg? Beide tegelijk loslaten (min_similarity 0,15 en
      // geen bronfilter) beantwoordt dat in één call. Blijft het daarna leeg,
      // dan is dat een uitspraak in plaats van een stilte.
      //
      // Eén keer, en alleen als de eerste ronde niet in een time-out liep — een
      // tweede zoekactie achter een verstreken klok maakt de latency dubbel en
      // het antwoord niet beter.
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
      // De reden uit context-build wint zolang wij er zelf geen hebben (een
      // time-out aan onze kant kent hij niet — hij is dan nog aan het werk).
      if (!coverageReason && cb.coverage?.reason) coverageReason = cb.coverage.reason;
    }
    const vectorChunks: any[] = (cb.matches ?? []);
    dbg.vector_chunks = vectorChunks.length;
    dbg.coverage_reason = coverageReason;
    if (!skipContextBuild) pushStep("Kennisindex doorzocht", `${vectorChunks.length} relevante fragmenten (vector + keywords)`, "data", {
      findings: vectorChunks.slice(0, 5).map((m: any) => ({
        datum: m.occurred_at ? String(m.occurred_at).slice(0, 10) : null,
        naam: String(m.subject || deriveSubject(m) || "?").slice(0, 80),
        detail: String(m.preview || m.content || "").replace(/\s+/g, " ").slice(0, 120),
      })),
    });

    const seen = new Set(rpcChunks.map((c) => c.chunk_id));
    const merged: any[] = [...rpcChunks];
    for (const v of vectorChunks) { if (!seen.has(v.chunk_id)) { merged.push(v); seen.add(v.chunk_id); } }
    // Churn-status is een hard feit en mag nooit door de reranker wegvallen:
    // buiten de rerank houden en vooraan terugzetten.
    const churnChunks = merged.filter((c) => c.via === "rpc_churn_status");
    const preRerank = merged.filter((c) => c.via !== "rpc_churn_status").slice(0, MAX_PRE_RERANK_CHUNKS);
    dbg.pre_rerank_chunks = preRerank.length;
    if (churnChunks.length > 0) dbg.churn_status_chunk = true;

    const { chunks: rerankedMatches, used: rerankUsed, ms: rerankMs, error: rerankError } = await rerankChunks(cohereKey, message, preRerank, Math.max(1, CHAT_CONTEXT_CHUNKS - churnChunks.length));
    let matches = [...churnChunks, ...rerankedMatches];
    dbg.rerank_used = rerankUsed;
    if (rerankMs != null) dbg.rerank_ms = rerankMs;
    if (rerankError) dbg.rerank_error = rerankError;
    dbg.merged_chunks = matches.length;
    if (rerankUsed) pushStep("Gerangschikt op relevantie", `top ${matches.length} fragmenten geselecteerd`, "data", {
      findings: matches.slice(0, 5).map((m: any) => ({
        datum: m.occurred_at ? String(m.occurred_at).slice(0, 10) : null,
        naam: String(m.subject || deriveSubject(m) || "?").slice(0, 80),
        detail: String(m.preview || m.content || "").replace(/\s+/g, " ").slice(0, 120),
      })),
    });

    // v5.2/v5.4 self-healing: het semantische pad vond vrijwel niets — dan
    // neemt de onderzoeks-agent het alsnog over i.p.v. "geen context" terug
    // te geven. Sinds v5.4 zonder gate-eis (de router draait op elke vraag).
    //
    // WP2 (v5.6) — de conditie was `!entityHint`: is er een naam gematcht, dan
    // geen agent. Dat is de verkeerde vraag. De A17-guard wilde voorkomen dat
    // een tienstaps-onderzoek draait terwijl er al een bruikbare tijdlijn ligt,
    // en dát is meetbaar: `matches.length`. Met de oude conditie gaf een
    // verkeerd herkende entity (zie tryResolveEntity) gegarandeerd een leeg
    // antwoord zónder redding, want de agent mocht niet meer starten.
    //
    // De guard blijft dus bestaan, maar hangt nu aan bruikbare context in
    // plaats van aan een gematchte naam: ligt er een tijdlijn met ≥ 3
    // fragmenten, dan blijft de agent uit — precies wat 17/7 gemeten is.
    const usableContext = matches.length;
    dbg.self_heal_usable_context = usableContext;
    if (!analytics && usableContext < 3 && message.length >= 12) {
      const healKey = openaiKey || routerKey;
      if (healKey) {
        pushStep("Weinig context via zoeken — de onderzoeks-agent neemt het over", null, "route");
        const agenticModel = await getCfg(supabase, "rag-chat", "agentic_model");
        analytics = await runAgentic(supabase, healKey, message, dbg, agenticModel, history, (label, detail, stage, extra) => pushStep(label, detail, stage || "data", extra), cronSecret, mirrorCtx, callerUserId);
        if (analytics) { dbg.route_fallback = "semantic_low_context_to_agentic"; dbg.analytics_used = true; matches = []; }
      }
    }

    const [webResearch, prefAdditions] = await Promise.all([webResearchPromise, prefAdditionsPromise]);
    if (webResearch) dbg.web_research_ms = webResearch.ms;
    if (prefAdditions) dbg.prefs_applied = true;
    if (webResearch) pushStep("Web doorzocht (Live Search)", `${(webResearch.web_citations || []).length} externe bronnen`, "data");

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
    // WP2 — hier stond `"(geen interne context-stukken gevonden)"`. Eén zin voor
    // vijf verschillende situaties, waar het antwoordmodel vervolgens een
    // vriendelijke alinea omheen schreef. Nu draagt de lege plek zijn reden.
    const ctxBlob = analytics
      ? analyticsContextBlob(analytics)
      : (ctxLines.length > 0 ? ctxLines.join("\n\n---\n\n") : coverageBlob(coverageReason));
    const validNs = matches.map((_, i) => i + 1).join(", ");
    const userMsg = buildCombinedUserMessage({ question: message, entityHint, ctxBlob, validNs, webText: webResearch?.webText || null, prefAdditions, analytics, coverageReason: (!analytics && matches.length === 0) ? (coverageReason ?? "not_tracked") : null });
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

    // ── WP4: het antwoordcontract ────────────────────────────────────────────
    // Naast het proza staat nu een envelop met de vorm van het antwoord. Drie
    // dingen worden daar tegelijk mee mogelijk: de UI kan een tabel en een
    // downloadknop tonen, de evalharnas kan asserten zonder reguliere
    // expressies over lopende tekst te leggen, en het antwoord draagt zichtbaar
    // zijn eigen dekking.
    //
    // `answer_md` en `cost` worden pas ná het antwoordmodel ingevuld (zie
    // finishEnvelope) — de rest is hier al bekend.
    const envelopeRows: any[] = analytics ? (analytics.rows || []) : [];
    const envelopeColumns: string[] = envelopeRows.length > 0 ? Object.keys(envelopeRows[0] ?? {}) : [];
    // Waar is wél gezocht, en waar niet. `not_searched` is geen slag om de arm
    // maar een feit: deze bronnen zijn deze beurt niet aangeraakt.
    const searchedAll = ["mail", "meeting", "event", "deal", "engagement", "company", "contact", "jira", "confluence", "kb_article"];
    const searchedNow: string[] = analytics
      ? (analytics.tools_used || [analytics.tool]).filter(Boolean).map(String)
      : (cb.coverage?.searched ?? (skipContextBuild ? [] : searchedAll));
    if (rpcChunks.length > 0) searchedNow.push("relatie-tijdlijn");
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
      // Er wordt hier geen bestand gebouwd. Een xlsx die niemand opent kost geld
      // en opslag; de knop bouwt hem on-demand via `agent-artifact-build`.
      // Zie WP4 in AGENT-REBUILD.md.
      artifacts: [],
      artifacts_available: envelopeRows.length > 0 ? ["xlsx", "csv"] : [],
      coverage: {
        searched: Array.from(new Set(searchedNow)),
        not_searched: analytics ? [] : searchedAll.filter((s) => !searchedNow.includes(s)),
        reason: (!analytics && matches.length === 0) ? (coverageReason ?? "not_tracked") : null,
        chunk_count: matches.length,
        rows_returned: analytics ? (analytics.rows || []).length : null,
      },
      cost: null,
    };

    // WP3 — hét getal dat ontbrak: had dit antwoord überhaupt een bron?
    // Geen fragmenten én geen analytics-rijen = een antwoord dat nergens op
    // staat. Dat is precies wat maandenlang niet te tellen was.
    const answerEmpty = matches.length === 0 && !(analytics && (analytics.rows || []).length > 0);

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
      // v1.145 — retrieval-eerlijkheid. `chunk_count: 0` betekende tot nu toe
      // óf "niets gevonden" óf "context-build haalde de 6 s niet", en dat was in
      // het log niet te onderscheiden. Nu wel: vector_error zegt WAT er misging,
      // vector_timed_out of het de klok was, vector_fetch_ms hoe lang het duurde
      // en context_build_intent welk recept eraan te pas kwam.
      meta: {
        retrieval_strategy: retrievalStrategy, chunk_count: matches.length, web_search: webSearch,
        agentic_model: dbg.agentic_model ?? null, steps: steps.slice(0, 24),
        context_build_intent: dbg.context_build_intent ?? null,
        vector_chunks: dbg.vector_chunks ?? null,
        vector_fetch_ms: dbg.vector_fetch_ms ?? null,
        vector_error: dbg.vector_error ?? null,
        vector_timed_out: dbg.vector_timed_out ?? null,
        vector_http_status: dbg.vector_http_status ?? null,
        context_build_skipped: dbg.context_build_skipped ?? null,
        caller_identified: dbg.caller_identified ?? null,
        // WP2 — de reden reist mee naar het log, niet alleen naar het antwoord.
        // Hierop draait de G1-poort (expect_no_empty): elk leeg antwoord móét
        // een reden hebben.
        coverage_reason: dbg.coverage_reason ?? null,
        retrieval_retry: dbg.retrieval_retry ?? false,
        retry_gained: dbg.retry_gained ?? null,
        // WP3 — het getal dat er niet was.
        answer_empty: answerEmpty,
        // Spoor 01 — alleen aanwezig bij evalverkeer; de views filteren op `meta ? 'eval_run_id'`.
        ...(evalRunId ? { eval_run_id: evalRunId } : {}),
      },
    };
    // WP3 — kosten en tokens over álle leveranciers. `usage` wordt na het
    // antwoordmodel aangevuld (logQuery krijgt hem mee als `extra`).
    const baseUsage = {
      embed_tokens: cb.retrieval_meta?.tokens?.embed ?? 0,
      // Eén Cohere-ronde per vraag sinds v5.6 (de tweede stond in context-build
      // en is uitgezet met enable_rerank:false).
      cohere_calls: rerankUsed ? 1 : 0,
      analytics_usd: analytics?.cost?.est_usd ?? null,
    };
    const logQuery = async (extra: Record<string, unknown>) => {
      try {
        const { error } = await supabase.from("rag_chat_query_log").insert({ ...baseLog, ...extra });
        if (error) console.error("[rag-chat] query_log insert failed", error.message);
      } catch (e) { console.error("[rag-chat] query_log insert threw", e instanceof Error ? e.message : String(e)); }
    };

    // Vult de envelop af met wat pas ná het antwoordmodel bekend is, en levert
    // meteen de log-velden op die daarbij horen. Eén plek, zodat het
    // stream-pad en het niet-stream-pad niet uit elkaar kunnen lopen.
    const finishEnvelope = (answerMd: string, usage: any) => {
      const grokIn = usage?.prompt_tokens ?? 0;
      const grokOut = usage?.completion_tokens ?? 0;
      const cost = {
        usd: estimateCostUsd({ ...baseUsage, grok_in: grokIn, grok_out: grokOut }),
        tokens_in: grokIn, tokens_out: grokOut,
        tools: (analytics?.tools_used || []).length || (analytics?.tool ? 1 : 0),
        by_vendor: {
          openai_embed_tokens: baseUsage.embed_tokens,
          cohere_searches: baseUsage.cohere_calls,
          grok_in: grokIn, grok_out: grokOut,
          analytics_usd: baseUsage.analytics_usd,
          // v5.8 — de tokens van de agent-lus / sweep-verdicts zelf (incl. wat
          // OpenAI uit de cache haalde). Tot nu toe reisde alleen het bedrag
          // mee, en een bedrag is niet te herrekenen als de tabel verandert —
          // wat deze versie precies doet. Zonder deze regels blijft G5 voor de
          // agentic route een schatting.
          ...(analytics?.cost ? {
            analytics_model: analytics.cost.model ?? null,
            analytics_tokens_in: analytics.cost.tokens_in ?? null,
            analytics_tokens_cached: analytics.cost.tokens_cached ?? null,
            analytics_tokens_out: analytics.cost.tokens_out ?? null,
          } : {}),
        },
      };
      envelope.answer_md = answerMd;
      envelope.cost = cost;
      return {
        est_cost_usd: cost.usd,
        meta: { ...(baseLog.meta as Record<string, unknown>), usage: cost.by_vendor, envelope_version: 1 },
      };
    };

    const metaPayload: any = { type: "meta", citations, bundle_id: cb.bundle_id, retrieval_strategy: retrievalStrategy, entity_used: entityHint, chunk_count: matches.length, analytics: analytics || null, debug_pipeline: dbg, model: GROK_MODEL, web_search_enabled: webSearch, web_search_used: !!webResearch && web_citations.length > 0, web_search_calls: webResearch ? 1 : 0, prefs: { style: writingStyle, tone, focus }, query_log_id: queryLogId, steps, envelope, coverage: envelope.coverage, answer_empty: answerEmpty };

    return { metaPayload, userMsg, sanitizedHistory, logQuery, cb, web_citations, envelope, finishEnvelope };
    }; // einde runPipeline

    if (!wantsStream) {
      const p = await runPipeline();
      const tGrok0 = Date.now();
      const { answer, usage } = await callGrokChat(grokKey!, systemPrompt, p.sanitizedHistory, p.userMsg);
      const tGrok = Date.now() - tGrok0;
      const fin = p.finishEnvelope(answer, usage);
      await p.logQuery({ latency_ms: Date.now() - t0, answer_chars: answer.length, ...fin });
      return new Response(JSON.stringify({ ok: true, answer, ...p.metaPayload, envelope: p.envelope, web_citations: p.web_citations, timing_ms: { total: Date.now() - t0, grok: tGrok }, tokens: { retrieval: p.cb.retrieval_meta?.tokens?.total ?? 0, chat_in: usage?.prompt_tokens ?? 0, chat_out: usage?.completion_tokens ?? 0 } }), { status: 200, headers: baseHeaders });
    }

    // Stream-modus (v5.1): verbinding gaat DIRECT open; de pipeline draait
    // daarna binnen de stream zodat status-events live bij de UI aankomen —
    // óók tijdens een agentic-run van 30-60s.
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const safeEnqueue = (chunk: Uint8Array) => { if (closed) return; try { controller.enqueue(chunk); } catch { closed = true; } };
        emitEv = (ev) => safeEnqueue(sseChunk(ev));
        let p: any = null;
        let streamError: string | null = null;
        let answerChars = 0;
        // WP4 — de envelop moet ook op het stream-pad kloppen, dus verzamelen we
        // de tekst terwijl hij langskomt. Cap op 200k tekens: dat is ruim boven
        // MAX_TOKENS (3000) en beschermt tegen een stream die niet stopt.
        let answerText = "";
        const tGrok0Holder = { t: 0 };
        let finLog: Record<string, unknown> | null = null;
        try {
          p = await runPipeline();
          pushStep("Antwoord schrijven…", null, "write");
          safeEnqueue(sseChunk(p.metaPayload));
          const grokRes = await callGrokChatStream(grokKey!, systemPrompt, p.sanitizedHistory, p.userMsg);
          if (!grokRes.ok || !grokRes.body) { const errTxt = await grokRes.text().catch(() => ""); throw new Error(`grok_stream_${grokRes.status}: ${errTxt.slice(0, 300)}`); }
          tGrok0Holder.t = Date.now();
          const reader = grokRes.body!.getReader();
          const decoder = new TextDecoder();
          let buf = ""; let usage: any = null; let finishReason: string | null = null;
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
                    if (delta) { answerChars += delta.length; if (answerText.length < 200_000) answerText += delta; safeEnqueue(sseChunk({ type: "delta", text: delta })); }
                    if (json.choices?.[0]?.finish_reason) finishReason = json.choices[0].finish_reason;
                    if (json.usage) usage = json.usage;
                  } catch { /* ignore */ }
                }
              }
            }
          } catch (e) { streamError = e instanceof Error ? e.message : String(e); safeEnqueue(sseChunk({ type: "error", error: streamError })); }
          // WP4 — de afgemaakte envelop gaat mee in het slot-event: pas hier is
          // het antwoord compleet en zijn de tokens bekend. De UI leest hem voor
          // de tabel + downloadknop, de evalharnas voor de asserts.
          finLog = p.finishEnvelope(answerText, usage);
          safeEnqueue(sseChunk({ type: "done", envelope: p.envelope, timing_ms: { total: Date.now() - t0, grok: Date.now() - tGrok0Holder.t }, tokens: { retrieval: p.cb.retrieval_meta?.tokens?.total ?? 0, chat_in: usage?.prompt_tokens ?? 0, chat_out: usage?.completion_tokens ?? 0 }, finish_reason: finishReason, web_citations: p.web_citations, web_search_used: p.metaPayload.web_search_used, web_search_calls: p.metaPayload.web_search_calls }));
        } catch (e) {
          streamError = e instanceof Error ? e.message : String(e);
          console.error("[rag-chat] stream pipeline error", streamError);
          safeEnqueue(sseChunk({ type: "error", error: streamError }));
        }
        // Ging de stream stuk vóór het slot-event, dan is de envelop nooit
        // afgemaakt. Alsnog doen — een afgebroken run hoort in het log te staan
        // mét zijn kosten, juist omdat hij mislukt is.
        if (p?.finishEnvelope && !finLog) { try { finLog = p.finishEnvelope(answerText, null); } catch { /* log liever half dan niet */ } }
        if (p?.logQuery) await p.logQuery({ latency_ms: Date.now() - t0, answer_chars: answerChars, error: streamError, ...(finLog ?? {}) });
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
