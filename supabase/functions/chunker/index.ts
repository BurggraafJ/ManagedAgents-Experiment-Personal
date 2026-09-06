// =============================================================================
// chunker v1.2 — adaptive chunking + contextual augmentation (R.3)
// v1.6 (2026-09-06, spoor 06a WP2/WP3): drie dingen op de mail-tak.
//   (a) fetchUnchunked staat nu BINNEN de per-bron try. Stond hij erbuiten, dan
//       maakte één mail-timeout de hele run `error` en sloeg álle andere bronnen
//       die cyclus over — precies wat 2026-09-06 07:15 UTC gebeurde
//       (`fetch_unchunked_mail_failed: canceling statement due to statement
//       timeout`, de enige fout in 30 dagen). Nu: warning, rest draait door.
//   (b) Een 23505 op de nieuwe partiële unieke index chunks_mail_one_per_message
//       is een waarschuwing, geen run-fout: dan heeft een gelijktijdige run die
//       mail al geschreven. De rest van de batch landt gewoon.
//   (c) chunkMail zet entity_ids/primary_entity_id uit v_mail_chunk_source
//       (externe deelnemers, zie migratie 20260906222000). Buiten de embed-tekst,
//       dus geen re-embed en geen ander HNSW-gedrag.
// v1.5 (2026-09-04): source='confluence' toegevoegd — de eerste bron die kan
//   VERANDEREN. Zie chunkConfluence + `replace: true` op de SOURCES-rij: de
//   her-chunk-sleutel is `metadata.version`, waar fetch_unchunked_source_ids op
//   vergelijkt. Chat vindt Confluence hierdoor via de bestaande semantic_search;
//   er is bewust GEEN live Confluence-zoektool in rag-chat.
// v1.2 (2026-05-20): source='action' toegevoegd voor AutoDraft v2 Fase 6.
//   Leest uit view v_autodraft_action_chunk_source (decision × catalog × mail).
// v1.1 (2026-05-03): fetchUnchunked gebruikt nu RPC fetch_unchunked_source_ids
//   (server-side NOT EXISTS) ipv top-N + client-filter — backfill werkt door.
// =============================================================================
// Eén centrale chunker-router die alle 9 truth-of-source tabellen verwerkt:
//   mail (thread + message), engagement, jira, deal, company, contact,
//   meeting (macro-only voor nu, topic+salient komt later), event, lesson.
//
// Per record:
//   1. Source data ophalen
//   2. Chunks bouwen volgens source-type strategie
//   3. Per chunk: contextual prefix genereren via GPT-5-nano (+~80 tokens)
//   4. Embedden via text-embedding-3-large (3072d halfvec)
//   5. Schrijven naar chunks tabel met FTS-vector trigger
//
// Cron: */5 * * * * (lichter dan mail-embed v3 want extra LLM-call per chunk).
// MAX_WALL_TIME 90s. BATCH_SIZE 10 records per cycle (chunks ≈ 25-50 per batch).
//
// Cost-modeling:
//   Per chunk: ~600 tokens input × $0.05/1M (3-large embed) +
//             ~600 tokens × $0.10/1M (gpt-5-nano context-prefix input) +
//             ~80 tokens × $0.40/1M output ≈ $0.00009/chunk.
//   Bij 35.000 chunks: ~$3 eenmalig. Lopend ~$0.30/maand.
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { matchesAnySecret } from "../_shared/edge-auth.ts";

const SKILL_VERSION = "chunker-v1.6-06a-mail-hardening";
// v1.3 (2026-06-11, RAG v3.2 V4): contextual prefix REPAREERT + verrijkt.
//   - F.3-diagnose: temperature:0.3 → gpt-5.x weigert (HTTP 400) → prefix draaide op
//     0/29.495 chunks (altijd deterministische meta_context). Fix: gpt-5-contract
//     (max_completion_tokens + reasoning_effort:'none', GEEN temperature).
//   - Model gpt-5-nano → gpt-5.4-mini (situering-kwaliteit drijft de gemeten winst:
//     +0.03..0.14 target-similarity, ranking-flip op anafoor-zware chunks; F.3-experiment 2026-06-11).
//   - Prompt herschreven naar situering-stijl: partijen MET NAAM, zakelijke context,
//     anaforen oplossen. Chunk-venster 500 → 1500 chars (anaforen staan verderop).
//   - Embed-tekst = LLM-prefix + meta_context + content (meta blijft behouden).
//   - Rauwe `Conversation <base64>`-id uit meta_context (gemeten effect ≈0, cosmetisch;
//     conversation_id blijft in metadata).
const EMBED_MODEL = "text-embedding-3-large";
const EMBED_DIM = 3072;
const PREFIX_MODEL = "gpt-5.4-mini";            // situering-prefix (RAG v3.2 V4)
const PREFIX_FALLBACK_MODEL = "gpt-5.4-nano";   // als gpt-5.4-mini 404 geeft
const BATCH_SIZE = 10;
const MAX_INPUT_CHARS = 8000;
const MAX_WALL_TIME_MS = 90_000;
const SAFETY_MARGIN_MS = 15_000;

async function getCfg(supabase: any, agentName: string, key: string): Promise<string | null> {
  const { data: vaultValue } = await supabase.rpc("get_skill_secret_service", {
    p_skill_name: agentName, p_secret_name: key,
  });
  if (typeof vaultValue === "string" && vaultValue.length > 0) return vaultValue;
  const { data } = await supabase.from("agent_config").select("config_value")
    .eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === "string" ? data.config_value : String(data.config_value);
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}

function truncate(s: string, max: number): string { return s.length <= max ? s : s.slice(0, max); }
function toVectorLiteral(arr: number[]): string { return "[" + arr.join(",") + "]"; }

function fmtDate(d: string | null | undefined): string {
  if (!d) return "onbekende-datum";
  const dt = new Date(d);
  const months = ["jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"];
  return `${dt.getDate()}-${months[dt.getMonth()]}-${dt.getFullYear()}`;
}

// -----------------------------------------------------------------------------
// LLM-calls
// -----------------------------------------------------------------------------

async function embedBatch(apiKey: string, inputs: string[]): Promise<{ embeddings: number[][]; tokens: number }> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: inputs, dimensions: EMBED_DIM }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`embed_${res.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  const sorted = [...json.data].sort((a: any, b: any) => a.index - b.index);
  return { embeddings: sorted.map((d: any) => d.embedding), tokens: json.usage.total_tokens };
}

async function generatePrefix(apiKey: string, content: string, metaContext: string, model = PREFIX_MODEL): Promise<{ prefix: string; tokens: number }> {
  // v1.3: situering-stijl (gemeten F.3-experiment): partijen mét naam, zakelijk verband,
  // anaforen opgelost. De prefix komt VÓÓR meta+content in de embed-tekst.
  const systemPrompt = `Je schrijft een Nederlandse context-prefix van 1-2 zinnen (max 80 tokens) die deze chunk situeert voor semantisch zoeken in een zakelijke kennisbank (mail, meetings, deals van Legal Mind).

REGELS:
- Benoem de betrokken partijen/bedrijven/personen MET NAAM (los "zij"/"het"/"deze" op naar de concrete naam).
- Zeg waar het zakelijk over gaat (bv. pilot richting akkoord, churn-risico, recruitment-traject, interne productdiscussie).
- Geen markdown, geen opsomming, geen letterlijke herhaling van zinnen uit de chunk.
- Gewone Nederlandse zinnen; namen vóór id's; datums als dd-mmm-jjjj.`;

  const userPrompt = `Metadata: ${metaContext}\n\nChunk (eerste 1500 chars):\n${content.slice(0, 1500)}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_completion_tokens: 150,
      reasoning_effort: "none",
      // GEEN temperature: gpt-5.x weigert die param (was de F.3-bug: HTTP 400 → 0 LLM-prefixen).
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 404 && model !== PREFIX_FALLBACK_MODEL) {
      // Fallback naar gpt-4.1-nano als gpt-5-nano niet beschikbaar
      return generatePrefix(apiKey, content, metaContext, PREFIX_FALLBACK_MODEL);
    }
    throw new Error(`prefix_${res.status}: ${text.slice(0, 200)}`);
  }
  const json = JSON.parse(text);
  const prefix = json.choices?.[0]?.message?.content?.trim() ?? "";
  return { prefix, tokens: json.usage?.total_tokens ?? 0 };
}

// -----------------------------------------------------------------------------
// Source-specifieke chunkers — bouw chunks-arrays per record
// -----------------------------------------------------------------------------

interface Chunk {
  source: string;
  source_id: string;
  /**
   * Eigenaar van de chunk. NULL = org/gedeeld corpus (hubspot, jira, deals,
   * meetings, events, lessons, actions). Gevuld voor source='mail': dan is de
   * inhoud privé voor die app-user en filtert match_chunks / RLS erop.
   * Zie migratie mail_accounts_b_chunks_owner_2026_09_02.sql.
   */
  owner_user_id?: string | null;
  /**
   * `entity:<type>:<id>` per entiteit die in deze chunk voorkomt. match_chunks
   * filtert erop (`filter_entity_id = ANY(entity_ids) OR primary_entity_id = …`).
   * Voor mail: alléén EXTERNE deelnemers — zie migratie 20260906222000.
   */
  entity_ids?: string[] | null;
  primary_entity_id?: string | null;
  source_subtype?: string;
  chunk_type: string;
  parent_chunk_id?: string;
  sequence: number;
  content: string;
  meta_context: string;       // Voor prefix-generatie
  occurred_at: string;
  metadata: Record<string, any>;
}

function chunkMail(m: any): Chunk[] {
  const folder = m.folder_path ? `[${m.folder_path}]` : "";
  const from = m.from_email ? `From: ${m.from_email}` : "";
  const body = m.body_text || stripHtml(m.body_html) || m.body_preview || "";
  const subject = m.subject ?? "(geen onderwerp)";

  // F.5 MetaRAG prefix-fusion: gestructureerde leader uit mail_enrichment (via v_mail_chunk_source).
  // Belandt vooraan in content -> meegeembed -> retrieval wordt enrichment-bewust (arXiv:2512.05411).
  const topicsArr: string[] = Array.isArray(m.topics) ? m.topics : [];
  const topicsStr = topicsArr.slice(0, 4).join(",");
  const leaderParts = [
    m.party_type ? `party=${m.party_type}` : null,
    m.party_lifecycle ? `lifecycle=${m.party_lifecycle}` : null,
    topicsStr ? `topic=${topicsStr}` : null,
    m.speech_act ? `act=${m.speech_act}` : null,
    m.sentiment ? `sentiment=${m.sentiment}` : null,
    `date=${fmtDate(m.received_at)}`,
  ].filter(Boolean);
  const leader = `[${leaderParts.join("|")}]`;

  // v1.3: rauwe Conversation-id uit de embed-tekst (gemeten effect ≈0 maar pure ruis;
  // conversation_id blijft beschikbaar in metadata voor joins).
  const meta = `Mail-bericht "${subject}" op ${fmtDate(m.received_at)}, van ${m.from_name ?? m.from_email ?? "onbekend"}${m.folder_path ? `, folder ${m.folder_path}` : ""}.${m.party_type ? ` Relatie ${m.party_type}${m.party_lifecycle ? `/${m.party_lifecycle}` : ""}.` : ""}${topicsStr ? ` Onderwerpen: ${topicsStr}.` : ""}`;

  return [{
    source: "mail",
    source_id: m.id,
    // Mail is privé per mailbox — zonder eigenaar kan de inhoud van mailbox #2
    // in het rag-chat-antwoord van mailbox #1 opduiken.
    owner_user_id: m.user_id ?? null,
    // 06a WP3: de view levert alleen EXTERNE deelnemers (from/to/cc, eigen
    // domein eruit). Intern zou entity:contact:<collega> aan duizenden mails
    // hangen en het filter tot ruis maken.
    entity_ids: Array.isArray(m.entity_ids) ? m.entity_ids : [],
    primary_entity_id: m.primary_entity_id ?? null,
    source_subtype: "message",
    chunk_type: "message",
    sequence: 0,
    content: truncate([leader, folder, from, `Subject: ${subject}`, m.body_preview ?? "", body].filter(Boolean).join("\n"), MAX_INPUT_CHARS),
    meta_context: meta,
    occurred_at: m.received_at,
    metadata: {
      from_email: m.from_email, conversation_id: m.conversation_id, folder_path: m.folder_path,
      // F.8 denormalisatie: enrichment-assen op de chunk -> metadata-filters in match_chunks
      party_type: m.party_type ?? null, party_lifecycle: m.party_lifecycle ?? null,
      topics: topicsArr.length ? topicsArr : null, speech_act: m.speech_act ?? null,
      sentiment: m.sentiment ?? null, asks_response: m.asks_response ?? null,
      urgency: m.urgency ?? null, cycle_stage_signal: m.cycle_stage_signal ?? null,
    },
  }];
}

function chunkEngagement(e: any): Chunk[] {
  const body = stripHtml(e.body_text);
  const meta = `HubSpot-engagement van type ${e.engagement_type} op ${fmtDate(e.hs_timestamp ?? e.hs_created_at)}${e.subject ? `, onderwerp ${e.subject}` : ""}.`;
  return [{
    source: "engagement",
    source_id: e.id,
    chunk_type: "engagement",
    sequence: 0,
    content: truncate([`[${e.engagement_type}]`, e.subject && `Subject: ${e.subject}`, body].filter(Boolean).join("\n"), MAX_INPUT_CHARS),
    meta_context: meta,
    occurred_at: e.hs_timestamp ?? e.hs_created_at,
    metadata: { engagement_type: e.engagement_type, subject: e.subject },
  }];
}

function chunkJira(j: any): Chunk[] {
  const desc = stripHtml(j.description);
  const meta = `Jira-issue ${j.project_key}-${j.issue_key} "${j.summary ?? ""}", type ${j.issue_type ?? "?"}, status ${j.status ?? "?"}, prioriteit ${j.priority ?? "?"}, toegewezen aan ${j.assignee_name ?? "—"} op ${fmtDate(j.jira_updated_at)}.`;
  return [{
    source: "jira",
    source_id: j.issue_key,
    chunk_type: "document",
    sequence: 0,
    content: truncate([`[${j.project_key}/${j.issue_key}]`, [j.issue_type, j.priority, j.status].filter(Boolean).join(" · "), `Summary: ${j.summary ?? ""}`, desc].filter(Boolean).join("\n"), MAX_INPUT_CHARS),
    meta_context: meta,
    occurred_at: j.jira_updated_at,
    metadata: { project_key: j.project_key, status: j.status, issue_type: j.issue_type, labels: j.labels },
  }];
}

function chunkDeal(d: any): Chunk[] {
  const props = d.properties || {};
  const desc = stripHtml(String(props.description ?? ""));
  const meta = `HubSpot-deal "${d.dealname ?? ""}", stage ${d.dealstage ?? "?"}, type ${d.dealtype ?? "?"}, bedrag €${d.amount ?? "?"}, eigenaar ${d.hubspot_owner_id ?? "—"}, laatst gewijzigd ${fmtDate(d.hs_lastmodifieddate)}.`;
  return [{
    source: "deal",
    source_id: d.deal_id,
    chunk_type: "master",
    sequence: 0,
    content: truncate([`[Deal]`, `Name: ${d.dealname ?? ""}`, `Stage: ${d.dealstage ?? ""}`, d.dealtype && `Type: ${d.dealtype}`, d.amount && `Amount: €${d.amount}`, desc].filter(Boolean).join("\n"), MAX_INPUT_CHARS),
    meta_context: meta,
    occurred_at: d.hs_lastmodifieddate,
    metadata: { stage: d.dealstage, amount: d.amount, dealtype: d.dealtype },
  }];
}

function chunkCompany(c: any): Chunk[] {
  const props = c.properties || {};
  const desc = stripHtml(String(props.description ?? ""));
  const meta = `Bedrijf "${c.name ?? ""}", industrie ${c.industry ?? "?"}, domein ${props.domain ?? "—"}, laatst gewijzigd ${fmtDate(c.hs_lastmodifieddate)}.`;
  return [{
    source: "company",
    source_id: c.company_id,
    chunk_type: "master",
    sequence: 0,
    content: truncate([`[Company]`, `Name: ${c.name ?? ""}`, c.industry && `Industry: ${c.industry}`, props.domain && `Domain: ${props.domain}`, desc].filter(Boolean).join("\n"), MAX_INPUT_CHARS),
    meta_context: meta,
    occurred_at: c.hs_lastmodifieddate,
    metadata: { industry: c.industry, domain: props.domain },
  }];
}

function chunkContact(c: any): Chunk[] {
  const props = c.properties || {};
  const fullname = [c.firstname, c.lastname].filter(Boolean).join(" ") || c.email;
  const meta = `Contact ${fullname}, functie ${c.jobtitle ?? "?"}${props.company ? `, bedrijf ${props.company}` : ""}, email ${c.email ?? "—"}.`;
  return [{
    source: "contact",
    source_id: c.contact_id,
    chunk_type: "master",
    sequence: 0,
    content: truncate([`[Contact]`, `Name: ${fullname}`, c.email && `Email: ${c.email}`, c.jobtitle && `Title: ${c.jobtitle}`, props.company && `Company: ${props.company}`].filter(Boolean).join("\n"), MAX_INPUT_CHARS),
    meta_context: meta,
    occurred_at: c.hs_lastmodifieddate ?? new Date().toISOString(),
    metadata: { email: c.email, jobtitle: c.jobtitle, company: props.company },
  }];
}

function chunkMeeting(m: any): Chunk[] {
  // F-5/F-6: skip personal meetings (privacy) en uncategorized meetings (te onveilig).
  // chunks tabel heeft een CHECK constraint die personal-meeting-chunks blokkeert.
  if (m.audience === "personal" || m.audience === null || m.audience === undefined) {
    return [];
  }
  const att = Array.isArray(m.attendees) ? m.attendees.map((a: any) => a.name || a.email).filter(Boolean).slice(0, 10).join(", ") : "";
  const body = m.summary_text || m.transcript_text || "";
  const meta = `Meeting "${m.title ?? ""}" op ${fmtDate(m.date_time)}, organisator ${m.organizer_email ?? "—"}, deelnemers ${att || "—"}.`;
  return [{
    source: "meeting",
    source_id: m.id,
    chunk_type: "macro",
    sequence: 0,
    content: truncate([`[Meeting]`, `Title: ${m.title ?? ""}`, m.organizer_email && `Organizer: ${m.organizer_email}`, att && `Attendees: ${att}`, body].filter(Boolean).join("\n"), MAX_INPUT_CHARS),
    meta_context: meta,
    occurred_at: m.date_time,
    metadata: {
      fireflies_id: m.fireflies_id,
      organizer: m.organizer_email,
      // F-5: audience + meeting_category gepropageerd voor retrieval-filtering
      audience: m.audience,
      meeting_category: m.category,
      category_confidence: m.category_confidence,
    },
  }];
}

function chunkEvent(e: any): Chunk[] {
  const body = stripHtml(e.body_text) || e.body_preview || "";
  const meta = `Agenda-afspraak "${e.subject ?? ""}" op ${fmtDate(e.start_time)}, organisator ${e.organizer_email ?? "—"}, locatie ${e.location_text ?? "—"}.`;
  return [{
    source: "event",
    source_id: e.id,
    chunk_type: "document",
    sequence: 0,
    content: truncate([`[Event]`, `Subject: ${e.subject ?? ""}`, e.organizer_email && `Organizer: ${e.organizer_email}`, e.location_text && `Location: ${e.location_text}`, body].filter(Boolean).join("\n"), MAX_INPUT_CHARS),
    meta_context: meta,
    occurred_at: e.start_time,
    metadata: { graph_id: e.graph_id, location: e.location_text },
  }];
}

function chunkLesson(l: any): Chunk[] {
  const meta = `JelleMind-lesson, scope ${l.mind_scope ?? "?"}, applies_to ${(l.applies_to ?? []).join(", ") || "—"}, geaccepteerd ${fmtDate(l.created_at)}.`;
  return [{
    source: "lesson",
    source_id: l.id,
    chunk_type: "document",
    sequence: 0,
    content: truncate([l.lesson_text, l.evidence_summary && `Evidence: ${l.evidence_summary}`].filter(Boolean).join("\n"), MAX_INPUT_CHARS),
    meta_context: meta,
    occurred_at: l.created_at,
    metadata: { mind_scope: l.mind_scope, applies_to: l.applies_to },
  }];
}

// AutoDraft v2 Fase 6 — chunk actie-beslissingen zodat de classifier per
// inkomende mail vergelijkbare historische beslissingen via RAG kan vinden.
// Bron: autodraft_action_decisions × mail_messages × autodraft_actions.
function chunkAction(a: any): Chunk[] {
  const slug          = a.action_slug || '';
  const category      = a.category || slug.split('.')[0] || 'action';
  const displayName   = a.display_name || slug;
  const targetValue   = a.target_value || null;
  const subject       = a.subject || '(geen onderwerp)';
  const fromEmail     = a.from_email || '?';
  const fromDomain    = a.from_domain || (fromEmail.includes('@') ? fromEmail.split('@')[1] : '');
  const folder        = a.folder_path || null;
  const outcome       = a.outcome;
  const isManual      = !a.was_suggested && outcome === 'manual';
  const isBackfill    = a.payload?.backfill_version != null;
  const inferredFrom  = a.payload?.inferred_from || null;
  const decidedAt     = a.decided_at || a.executed_at || a.created_at;

  // Compacte natural-language samenvatting voor de classifier
  const lines: string[] = [];
  lines.push(`[AutoDraft-actie] ${displayName} (slug: ${slug}, categorie: ${category}).`);
  lines.push(`Toegepast op mail "${subject}" van ${fromEmail}${fromDomain ? ` (${fromDomain})` : ''}.`);
  if (folder) lines.push(`Mail-folder: ${folder}.`);
  if (targetValue) lines.push(`Target: ${targetValue}.`);
  if (isManual) {
    lines.push(`Beslissing: handmatig${isBackfill ? ' (Fase 0 backfill)' : ''}.`);
  } else {
    lines.push(`Voorstel-rank: ${a.suggested_rank ?? '?'} van 3. Outcome: ${outcome}.`);
  }
  if (inferredFrom) lines.push(`Inferentie: ${inferredFrom}.`);

  const meta = `AutoDraft-actie ${slug} op ${fromDomain || fromEmail}, ${outcome === 'manual' ? 'handmatig' : `voorstel #${a.suggested_rank ?? '?'} ${outcome}`}, ${fmtDate(decidedAt)}.`;

  return [{
    source: "action",
    source_id: a.decision_id,
    chunk_type: "document",
    sequence: 0,
    content: truncate(lines.join("\n"), MAX_INPUT_CHARS),
    meta_context: meta,
    occurred_at: decidedAt,
    metadata: {
      action_slug:     slug,
      category,
      outcome,
      was_suggested:   a.was_suggested,
      from_email:      fromEmail,
      from_domain:     fromDomain,
      folder_path:     folder,
      mail_id:         a.mail_id,
      backfill:        isBackfill,
    },
  }];
}

// Confluence-pagina's zijn het eerste brontype dat VERANDERT. Alle andere
// bronnen zijn "chunk één keer": een mail of een engagement wordt niet
// herschreven. Een wiki-pagina wel — daarom `replace: true` op de SOURCES-rij
// en `version` in de metadata, waar `fetch_unchunked_source_ids` op vergelijkt.
//
// Eén pagina is meestal meer dan één chunk (mediaan 8,4 kB storage-XHTML op de
// site, gemeten 2026-09-04). We splitsen op alinea-grenzen en niet op een vast
// aantal tekens midden in een zin, en elk deel draagt de titel + het
// deelnummer, zodat een fragment ook los vindbaar en citeerbaar is.
const CONFLUENCE_CHUNK_CHARS = 3500;

function chunkConfluence(p: any): Chunk[] {
  const title = p.title ?? "(zonder titel)";
  const space = p.space_key ?? "?";
  const version = Number(p.version ?? 1) || 1;
  const text = String(p.body_text ?? "").trim();
  if (!text) return [];

  const parts: string[] = [];
  let buf = "";
  for (const block of text.split(/\n{2,}/).map((b: string) => b.trim()).filter(Boolean)) {
    if (buf && buf.length + block.length + 2 > CONFLUENCE_CHUNK_CHARS) { parts.push(buf); buf = block; }
    else buf = buf ? `${buf}\n\n${block}` : block;
    // Eén alinea die zelf al te lang is (een tabel-dump) alsnog knippen.
    while (buf.length > CONFLUENCE_CHUNK_CHARS) {
      parts.push(buf.slice(0, CONFLUENCE_CHUNK_CHARS));
      buf = buf.slice(CONFLUENCE_CHUNK_CHARS);
    }
  }
  if (buf) parts.push(buf);

  const n = parts.length;
  // v1.5.1 — MetaRAG prefix-fusion, zelfde vorm als de mail-leader sinds F.5
  // (arXiv:2512.05411). Het pad is hier het waardevolste veld: wiki-titels zijn
  // vaak generiek ("Overzicht", "Proces", "Werkwijze") en de ouderketen is wat
  // ze onderscheidt. Gemeten mediane diepte 3, max 7.
  //
  // Geen `labels=` in de leader: site-breed 0 labels gemeten (0/366 pagina's).
  // Een altijd-lege sleutel is ruis in élke embedding.
  const ancestors: string[] = Array.isArray(p.ancestor_titles) ? p.ancestor_titles.filter(Boolean) : [];
  const path = ancestors.length > 0 ? ancestors.join(" › ") : space;
  const leader = `[space=${space}|type=doc|path=${path}|updated=${fmtDate(p.confluence_updated_at)}]`;
  return parts.map((body, i) => ({
    source: "confluence",
    source_id: String(p.page_id),
    // Org-brede wiki: geen eigenaar. NULL = zichtbaar voor iedereen die de
    // index mag lezen. De toegangscontrole zit op SPACE, niet op eigenaar —
    // zie cf_visible in match_chunks en de RLS op chunks/confluence_pages.
    owner_user_id: null,
    source_subtype: space,
    chunk_type: "document",
    sequence: i,
    content: truncate(
      [leader, `${title}${n > 1 ? ` (deel ${i + 1}/${n})` : ""}`, "", body].join("\n"),
      MAX_INPUT_CHARS,
    ),
    meta_context: `Confluence-pagina "${title}" in space ${space}${ancestors.length > 0 ? `, pad ${path}` : ""}, versie ${version}, laatst gewijzigd ${fmtDate(p.confluence_updated_at)}${n > 1 ? `, deel ${i + 1} van ${n}` : ""}.`,
    occurred_at: p.confluence_updated_at,
    metadata: {
      space_key: space, title, url: p.url ?? null,
      path, ancestor_titles: ancestors,
      // `version` is de her-chunk-sleutel: fetch_unchunked_source_ids vergelijkt
      // hierop. Als integer schrijven, niet als string.
      version, part: i + 1, parts: n,
    },
  }));
}

const SOURCES = [
  { name: "mail",       table: "v_mail_chunk_source", pkCol: "id",       select: "id, subject, body_preview, body_text, body_html, from_email, from_name, folder_path, conversation_id, received_at, party_type, party_lifecycle, topics, speech_act, sentiment, asks_response, urgency, cycle_stage_signal, user_id, entity_ids, primary_entity_id", filter: (q: any) => q, order: "received_at",            chunker: chunkMail },
  { name: "engagement", table: "hubspot_engagements", pkCol: "id",        select: "id, engagement_type, subject, body_text, hs_timestamp, hs_created_at",                                                  filter: (q: any) => q.eq("is_archived", false), order: "hs_lastmodified_at",    chunker: chunkEngagement },
  { name: "jira",       table: "jira_issues",        pkCol: "issue_key", select: "issue_key, project_key, summary, description, status, priority, issue_type, assignee_name, labels, jira_updated_at",   filter: (q: any) => q,                          order: "jira_updated_at",       chunker: chunkJira },
  { name: "deal",       table: "hubspot_deals",      pkCol: "deal_id",   select: "deal_id, dealname, dealstage, dealtype, amount, hubspot_owner_id, properties, hs_lastmodifieddate",                     filter: (q: any) => q.eq("is_archived", false), order: "hs_lastmodifieddate",   chunker: chunkDeal },
  { name: "company",    table: "hubspot_companies",  pkCol: "company_id", select: "company_id, name, industry, properties, hs_lastmodifieddate",                                                            filter: (q: any) => q,                          order: "hs_lastmodifieddate",   chunker: chunkCompany },
  { name: "contact",    table: "hubspot_contacts",   pkCol: "contact_id", select: "contact_id, firstname, lastname, email, jobtitle, properties, hs_lastmodifieddate",                                       filter: (q: any) => q,                          order: "hs_lastmodifieddate",   chunker: chunkContact },
  { name: "meeting",    table: "fireflies_meetings", pkCol: "id",        select: "id, fireflies_id, title, date_time, organizer_email, attendees, summary_text, transcript_text, audience, category, category_confidence",                            filter: (q: any) => q,                          order: "date_time",             chunker: chunkMeeting },
  { name: "event",      table: "calendar_events",    pkCol: "id",        select: "id, graph_id, subject, body_preview, body_text, start_time, organizer_email, location_text, categories",                  filter: (q: any) => q.eq("is_cancelled", false), order: "start_time",           chunker: chunkEvent },
  { name: "lesson",     table: "jellemind_lessons",  pkCol: "id",        select: "id, lesson_text, evidence_summary, mind_scope, applies_to, created_at",                                                    filter: (q: any) => q.eq("active", true),       order: "created_at",            chunker: chunkLesson },
  // AutoDraft v2 Fase 6: actie-beslissingen voor classifier RAG-input.
  // Bron is een view (v_autodraft_action_chunk_source) die de join doet met
  // mail_messages + autodraft_actions zodat één SELECT alle context heeft.
  { name: "action",     table: "v_autodraft_action_chunk_source", pkCol: "decision_id", select: "*",                                                                                                              filter: (q: any) => q,                          order: "decided_at",            chunker: chunkAction },
  // v1.5: Confluence-spiegel. `replace: true` = her-chunkbaar (zie chunkConfluence).
  { name: "confluence", table: "confluence_pages",  pkCol: "page_id",   select: "page_id, space_key, title, body_text, version, confluence_updated_at, url, ancestor_titles",                                                     filter: (q: any) => q.eq("is_archived", false), order: "confluence_updated_at", chunker: chunkConfluence, replace: true },
];

// -----------------------------------------------------------------------------
// Main loop
// -----------------------------------------------------------------------------

async function fetchUnchunked(supabase: any, src: any, limit: number): Promise<any[]> {
  // Server-side NOT EXISTS via RPC (zie migration fetch_unchunked_source_ids_2026_05_03).
  // Pre-v1.1 implementatie pakte top-N op order-kolom en filterde client-side: na de eerste run
  // bleven oudere records onbereikbaar omdat de top-N altijd al gechunkt was.
  const { data: idRows, error: rpcErr } = await supabase.rpc("fetch_unchunked_source_ids", {
    p_source: src.name,
    p_limit: limit,
  });
  if (rpcErr) throw new Error(`fetch_unchunked_${src.name}_failed: ${rpcErr.message}`);
  const ids = (idRows ?? []).map((r: any) => r.source_id);
  if (ids.length === 0) return [];

  let q = supabase.from(src.table).select(src.select).in(src.pkCol, ids);
  const { data, error } = await q;
  if (error) throw new Error(`${src.table}_select_failed: ${error.message}`);
  return data ?? [];
}

async function processChunks(supabase: any, openaiKey: string, chunks: Chunk[]): Promise<{ inserted: number; tokens: number; warnings: string[] }> {
  if (chunks.length === 0) return { inserted: 0, tokens: 0, warnings: [] };

  // 1. Genereer contextual prefixes (parallel maar gerate-limit op 5 tegelijk)
  let prefixTokens = 0;
  const prefixPromises: Promise<{ prefix: string; tokens: number }>[] = [];
  for (let i = 0; i < chunks.length; i += 5) {
    const batch = chunks.slice(i, i + 5);
    const results = await Promise.all(
      batch.map((c) => generatePrefix(openaiKey, c.content, c.meta_context).catch((e) => ({ prefix: c.meta_context, tokens: 0, error: e.message })))
    );
    results.forEach((r: any, j: number) => {
      chunks[i + j].metadata.prefix_tokens = r.tokens;
      prefixTokens += r.tokens;
      // v1.3: LLM-prefix VERVANGT de meta niet meer — beide in de embed-tekst
      // (prefix situeert, meta houdt datum/afzender/folder hard doorzoekbaar).
      (chunks[i + j] as any)._prefix = r.prefix && r.prefix.length > 10
        ? `${r.prefix}\n${batch[j].meta_context}`
        : batch[j].meta_context;
    });
  }

  // 2. Embed met text-embedding-3-large
  const embedInputs = chunks.map((c) => `${(c as any)._prefix}\n\n${c.content}`);
  const { embeddings, tokens: embedTokens } = await embedBatch(openaiKey, embedInputs);

  // 3. Insert in chunks tabel
  const now = new Date().toISOString();
  const rows = chunks.map((c, i) => ({
    source: c.source,
    source_id: c.source_id,
    owner_user_id: c.owner_user_id ?? null,
    entity_ids: c.entity_ids ?? [],
    primary_entity_id: c.primary_entity_id ?? null,
    source_subtype: c.source_subtype ?? null,
    chunk_type: c.chunk_type,
    sequence: c.sequence,
    content: c.content,
    content_with_context: embedInputs[i],
    embedding: toVectorLiteral(embeddings[i]),
    embedded_at: now,
    embedding_model: EMBED_MODEL,
    embedding_input_hash: null,    // Hash optional voor nu — gewoon insert
    occurred_at: c.occurred_at,
    metadata: c.metadata,
  }));

  // Insert in batches van 5
  let inserted = 0;
  let duplicates = 0;
  const warnings: string[] = [];
  for (let i = 0; i < rows.length; i += 5) {
    const slice = rows.slice(i, i + 5);
    const { error } = await supabase.from("chunks").insert(slice);
    if (!error) { inserted += slice.length; continue; }
    // v1.6 (06a WP2): 23505 = de partiële unieke index chunks_mail_one_per_message.
    // Dan heeft een gelijktijdige run deze mail al geschreven — dat is precies
    // wat de index moet voorkomen, geen reden om de run te laten vallen. De
    // batch rij voor rij opnieuw zodat de niet-dubbele chunks wél landen.
    if (error.code !== "23505") throw new Error(`chunks_insert_failed: ${error.message}`);
    for (const row of slice) {
      const { error: rowErr } = await supabase.from("chunks").insert(row);
      if (!rowErr) { inserted += 1; continue; }
      if (rowErr.code !== "23505") throw new Error(`chunks_insert_failed: ${rowErr.message}`);
      duplicates += 1;
    }
  }
  if (duplicates > 0) warnings.push(`duplicate_chunk_skipped: ${duplicates}`);

  return { inserted, tokens: embedTokens + prefixTokens, warnings };
}

Deno.serve(async (req) => {
  const startTime = Date.now();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const presentedToken = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const cronSecret = (await getCfg(supabase, "global", "cron_secret")) || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!presentedToken || !matchesAnySecret(presentedToken, [cronSecret, serviceKey])) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const triggeredBy = req.headers.get("x-trigger-source") || "edge_cron";
  const startedAt = new Date().toISOString();
  const stats: any = {
    schema_version: "1",
    skill_version: SKILL_VERSION,
    embed_model: EMBED_MODEL,
    prefix_model: PREFIX_MODEL,
    triggered_by: triggeredBy,
    triggered_at: startedAt,
    cycles: 0,
    total_chunks: 0,
    total_tokens: 0,
    by_source: {} as any,
    warnings: [] as string[],
  };
  for (const s of SOURCES) stats.by_source[s.name] = { chunks: 0 };

  const { data: runIns } = await supabase.from("agent_runs").insert({
    agent_name: "chunker", run_type: "edge_function", status: "running",
    started_at: startedAt, stats, errors: [],
  }).select("id").single();
  const runId = runIns?.id;

  try {
    const openaiKey = await getCfg(supabase, "openai", "embedding_key");
    if (!openaiKey) throw new Error("openai_embedding_key_missing");

    while (Date.now() - startTime < MAX_WALL_TIME_MS - SAFETY_MARGIN_MS) {
      let cycleTotal = 0;
      for (const src of SOURCES) {
        if (Date.now() - startTime >= MAX_WALL_TIME_MS - SAFETY_MARGIN_MS) break;
        // v1.6 (06a WP2): ALLES van deze bron binnen de try — ook het ophalen.
        // Eén bron die struikelt is een waarschuwing; de andere bronnen draaien
        // door en de run blijft `warning` in plaats van `error`.
        let replaceIds: string[] = [];
        try {
          const records = await fetchUnchunked(supabase, src, BATCH_SIZE);
          if (records.length === 0) continue;
          const allChunks: Chunk[] = [];
          for (const rec of records) allChunks.push(...src.chunker(rec));
          if (allChunks.length === 0) continue;
          // Her-chunkbare bron (Confluence): de oude chunks van deze records moeten
          // weg, anders staat versie 4 náást versie 5 in de index.
          replaceIds = (src as any).replace
            ? records.map((r: any) => String(r[src.pkCol])).filter(Boolean)
            : [];
          if (replaceIds.length > 0) {
            const { error: delErr } = await supabase.from("chunks")
              .delete().eq("source", src.name).in("source_id", replaceIds);
            if (delErr) throw new Error(`chunks_replace_delete_failed: ${delErr.message}`);
          }
          const { inserted, tokens, warnings } = await processChunks(supabase, openaiKey, allChunks);
          stats.by_source[src.name].chunks += inserted;
          stats.total_chunks += inserted;
          stats.total_tokens += tokens;
          cycleTotal += inserted;
          for (const w of warnings) stats.warnings.push(`${src.name}_cycle_${stats.cycles}: ${w}`);
        } catch (cycleErr) {
          // Bij een replace-bron mag een HALVE insert niet blijven staan: de
          // versie-marker zou dan "klaar" zeggen terwijl er maar een deel van de
          // pagina in de index zit, en fetch_unchunked_source_ids biedt hem nooit
          // meer aan. Alles van deze records weg → volgende ronde opnieuw.
          if (replaceIds.length > 0) {
            await supabase.from("chunks").delete()
              .eq("source", src.name).in("source_id", replaceIds)
              .then(() => {}, () => {});
          }
          stats.warnings.push(`${src.name}_cycle_${stats.cycles}: ${(cycleErr instanceof Error ? cycleErr.message : String(cycleErr)).slice(0, 200)}`);
        }
      }
      if (cycleTotal === 0) break;
      stats.cycles++;
    }

    const breakdown = Object.entries(stats.by_source).filter(([, v]: any) => v.chunks > 0).map(([k, v]: any) => `${v.chunks} ${k}`).join(" + ");
    const summary = stats.total_chunks === 0 ? "no records to chunk" : `${stats.total_chunks} chunked (${breakdown}), ${stats.total_tokens} tokens, ${stats.cycles} cycles`;
    const finalStatus = stats.warnings.length > 0 ? "warning" : "success";

    if (runId) {
      await supabase.from("agent_runs").update({ status: finalStatus, completed_at: new Date().toISOString(), summary, stats }).eq("id", runId);
    }
    return new Response(JSON.stringify({ ok: true, runId, stats, summary }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (runId) {
      await supabase.from("agent_runs").update({ status: "error", completed_at: new Date().toISOString(), summary: errMsg.slice(0, 500), stats, errors: [{ message: errMsg, at: new Date().toISOString() }] }).eq("id", runId);
    }
    return new Response(JSON.stringify({ ok: false, error: errMsg }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
