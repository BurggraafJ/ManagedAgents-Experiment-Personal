// =============================================================================
// chunker-meeting-v2/chunking.ts — de chunk-laag: prefixen, embedden, wegschrijven
// =============================================================================
// Uit index.ts gelicht bij 06c (2026-09-07). Reden: index.ts stond op 413 regels en
// moest er code bij (de her-embed-modus); CLAUDE.md hanteert een harde cap van
// < 400 LOC per bestand en schrijft splitsen voor. Puur verplaatst, één gedrags-
// wijziging: de salient-prefix (zie SALIENT_PREFIX_VERSION hieronder).
// =============================================================================

import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const EMBED_MODEL = "text-embedding-3-large";
export const EMBED_DIM = 3072;
export const EMBED_BATCH_SIZE = 80;
export const MAX_TOPICS = 12;
export const MAX_SALIENTS_PER_TOPIC = 10;
export const MAX_EMBED_INPUT_CHARS = 25000; // text-embedding-3-large: 8192 tokens (~32k chars); 25k is veilig

// ─── De salient-prefix ───────────────────────────────────────────────────────
// 06c (2026-09-07, vorken C4/C5). Wat er gemeten is:
//   • 902 salient-chunks, p50 58 tekens inhoud, prefix gemiddeld 165 tekens ⇒
//     **74 % van de embedding is metadata**.
//   • Nearest-neighbour-proef op de opgeslagen embeddings (20 probes × top-10):
//     buren van een salient liggen in **66,5 %** in DEZELFDE meeting, tegen
//     45,0 % voor topic-chunks (prefix-aandeel 3,5 %) en 0,0 % voor de
//     mail-controle. Salients halen elkaar mee: de bron matcht op zijn eigen
//     metadata-regel.
//   • Gevolg in productie: `meeting` neemt 20,3 % van de chat-slots op 3,8 % van
//     de index = 5,3× zijn aandeel, terwijl `event` op 0,35× staat.
// De ingreep is daarom het INKORTEN van de prefix, niet het weglaten van
// salients: 42 % van de salients staat in géén enkele topic-chunk (de topic-tekst
// wordt op 25.000 tekens afgekapt en de LLM normaliseert de quote), dus salients
// wissen kost echte tekst. Meetingtitel en topic-titel gaan eruit — dat zijn de
// twee velden die 902 vectoren op elkaar laten lijken. Datum, spreker en
// fact_type blijven: die onderscheiden juist.
// `content` (de letterlijke uitspraak) verandert NIET; alleen
// `content_with_context`, en dat is wat geëmbed wordt.
export const SALIENT_PREFIX_VERSION = "06c-2026-09-07";

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "onbekende-datum";
  const dt = new Date(d);
  const months = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  return dt.getDate() + "-" + months[dt.getMonth()] + "-" + dt.getFullYear();
}

/** De prefix-regel van een salient-chunk. Eén plek, zodat de her-embed-job en de
 *  chunker van een nieuwe meeting nooit uiteen kunnen lopen. */
export function salientMeta(dateTime: string | null | undefined, speaker: string, factType: string): string {
  return "Saillante uitspraak op " + fmtDate(dateTime) + ", door " + speaker + ", type " + factType + ".";
}

export function topicMeta(meeting: any, t: TopicSegment): string {
  return "Topic-segment in meeting \"" + (meeting.title ?? "?") + "\" op " + fmtDate(meeting.date_time)
    + ", category " + meeting.category + ", lines " + t.start_line + "-" + t.end_line
    + ", sprekers " + (t.speakers.join(", ") || "?") + ", topic: " + t.topic_title + ".";
}

export function toVectorLiteral(arr: number[]): string { return "[" + arr.join(",") + "]"; }
export function truncate(s: string, max: number): string { return s.length <= max ? s : s.slice(0, max); }

export interface SalientItem { speaker: string; sentence: string; fact_type: string; }
export interface TopicSegment { topic_title: string; start_line: number; end_line: number; speakers: string[]; salients: SalientItem[]; }

export interface PreparedChunk {
  topicIdx: number;          // 0..N-1
  salientIdx: number | null; // null voor topic-chunk; 0..M-1 voor salient
  embedInput: string;
  topic: TopicSegment;
  topicContent: string;
  salient?: SalientItem;
}

export async function embedBatch(openaiKey: string, inputs: string[]): Promise<{ embeddings: number[][]; tokens: number }> {
  if (inputs.length === 0) return { embeddings: [], tokens: 0 };
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: "Bearer " + openaiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: inputs, dimensions: EMBED_DIM }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error("embed_" + res.status + ": " + text.slice(0, 200));
  const json = JSON.parse(text);
  const sorted = [...json.data].sort((a: any, b: any) => a.index - b.index);
  return { embeddings: sorted.map((d: any) => d.embedding), tokens: json.usage.total_tokens };
}

export async function findMacroChunkId(supabase: SupabaseClient, meetingId: string): Promise<string | null> {
  const { data } = await supabase.from("chunks").select("chunk_id").eq("source", "meeting").eq("source_id", meetingId).eq("chunk_type", "macro").maybeSingle();
  return data?.chunk_id ?? null;
}

function extractTopicContent(lines: string[], startLine: number, endLine: number): string {
  const safeStart = Math.max(0, Math.min(startLine - 1, lines.length - 1));
  const safeEnd = Math.max(safeStart, Math.min(endLine - 1, lines.length - 1));
  return lines.slice(safeStart, safeEnd + 1).join("\n");
}

export function buildAllChunkInputs(meeting: any, topics: TopicSegment[], lines: string[]): PreparedChunk[] {
  const out: PreparedChunk[] = [];
  for (let ti = 0; ti < topics.length; ti++) {
    const t = topics[ti];
    const topicContentRaw = extractTopicContent(lines, t.start_line, t.end_line);
    if (!topicContentRaw || topicContentRaw.length < 30) continue;
    const topicContent = truncate(topicContentRaw, MAX_EMBED_INPUT_CHARS);

    out.push({
      topicIdx: ti,
      salientIdx: null,
      embedInput: topicMeta(meeting, t) + "\n\n" + topicContent,
      topic: t,
      topicContent,
    });

    for (let si = 0; si < t.salients.length; si++) {
      const s = t.salients[si];
      if (!s.sentence || s.sentence.length < 5) continue;
      out.push({
        topicIdx: ti,
        salientIdx: si,
        embedInput: salientMeta(meeting.date_time, s.speaker, s.fact_type) + "\n\n" + s.sentence,
        topic: t,
        topicContent,
        salient: s,
      });
    }
  }
  return out;
}

export async function persistAllChunks(
  supabase: SupabaseClient,
  meeting: any,
  macroChunkId: string,
  prepared: PreparedChunk[],
  embeddings: number[][],
): Promise<{ topic_chunks: number; salient_chunks: number }> {
  // Eerst topics inserten (krijg chunk_ids), dan salients met parent_chunk_id = topic_chunk_id
  const topicRows: any[] = [];

  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i];
    if (p.salientIdx !== null) continue;
    topicRows.push({
      source: "meeting",
      source_id: meeting.id,
      chunk_type: "topic",
      parent_chunk_id: macroChunkId,
      sequence: p.topicIdx,
      content: p.topicContent,
      content_with_context: p.embedInput,
      embedding: toVectorLiteral(embeddings[i]),
      embedded_at: new Date().toISOString(),
      embedding_model: EMBED_MODEL,
      occurred_at: meeting.date_time,
      // 06c: BLIJFT de gewikkelde vorm `entity:<type>:<id>`. Gemeten (2026-09-07):
      // een raw-id-filter op match_chunks.filter_entity_id geeft 0 rijen, de
      // gewikkelde waarde 20 — en mail draagt dezelfde wikkel (8.895 waarden,
      // 3.268 primary_entity_id's, allemaal 27 tekens). Uitwikkelen zou de enige
      // vorm die vandaag werkt kapotmaken, en alleen voor meeting. De unwrap
      // hoort in meeting_entity_link, waar tegen de RUWE mirror-ids vergeleken wordt.
      entity_ids: meeting.linked_entity_ids ?? [],
      topic_title: p.topic.topic_title,
      topic_speakers: p.topic.speakers,
      metadata: {
        fireflies_id: meeting.fireflies_id,
        audience: meeting.audience,
        meeting_category: meeting.category,
        category_confidence: meeting.category_confidence,
        start_line: p.topic.start_line,
        end_line: p.topic.end_line,
      },
    });
  }

  const { data: topicInserted, error: topicErr } = await supabase.from("chunks").insert(topicRows).select("chunk_id, sequence");
  if (topicErr) throw new Error("topic_batch_insert_failed: " + topicErr.message);

  // Map sequence (= topicIdx) → chunk_id
  const topicChunkIdByTopicIdx: Record<number, string> = {};
  for (const r of topicInserted ?? []) topicChunkIdByTopicIdx[r.sequence] = r.chunk_id;

  // Nu salients
  const salientRows: any[] = [];
  for (let i = 0; i < prepared.length; i++) {
    const p = prepared[i];
    if (p.salientIdx === null || !p.salient) continue;
    const parentId = topicChunkIdByTopicIdx[p.topicIdx];
    if (!parentId) continue;
    salientRows.push({
      source: "meeting",
      source_id: meeting.id,
      chunk_type: "salient",
      parent_chunk_id: parentId,
      sequence: p.salientIdx,
      content: p.salient.sentence,
      content_with_context: p.embedInput,
      embedding: toVectorLiteral(embeddings[i]),
      embedded_at: new Date().toISOString(),
      embedding_model: EMBED_MODEL,
      occurred_at: meeting.date_time,
      entity_ids: meeting.linked_entity_ids ?? [],
      speaker: p.salient.speaker,
      fact_type: p.salient.fact_type,
      topic_title: p.topic.topic_title,
      metadata: {
        fireflies_id: meeting.fireflies_id,
        audience: meeting.audience,
        meeting_category: meeting.category,
        category_confidence: meeting.category_confidence,
        parent_topic: p.topic.topic_title,
        // Zodat de her-embed-job (reembed.ts) weet dat deze rij al de korte
        // prefix draagt en hem niet nog een keer aanbiedt.
        prefix_version: SALIENT_PREFIX_VERSION,
      },
    });
  }

  if (salientRows.length > 0) {
    // Insert in slices van 25 ivm halfvec(3072) payload-grootte
    for (let i = 0; i < salientRows.length; i += 25) {
      const slice = salientRows.slice(i, i + 25);
      const { error: salErr } = await supabase.from("chunks").insert(slice);
      if (salErr) throw new Error("salient_batch_insert_failed: " + salErr.message);
    }
  }

  return { topic_chunks: topicRows.length, salient_chunks: salientRows.length };
}
