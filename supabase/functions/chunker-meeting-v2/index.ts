// =============================================================================
// chunker-meeting-v2 v1.2 — F-3+F-4 drie-laags chunking via Grok
// =============================================================================
// v1.2 (2026-09-07, spoor 06c): twee dingen.
//   (a) De chunk-laag staat nu in ./chunking.ts en de her-embed-modus in
//       ./reembed.ts. index.ts stond op 413 regels en moest er code bij;
//       CLAUDE.md hanteert < 400 LOC per bestand en schrijft splitsen voor.
//   (b) De salient-prefix is ingekort: meetingtitel en topic-titel gaan uit de
//       regel die geëmbed wordt (chunking.ts/salientMeta). Gemeten: 74 % van een
//       salient-embedding was metadata en salient-buren lagen in 66,5 % in
//       dezelfde meeting (topic: 45,0 %, mail-controle: 0 %). `content` — de
//       letterlijke uitspraak — verandert NIET.
//       Bestaande rijen krijgen de korte prefix via
//       POST {"mode":"reembed_salients"} (zelf-drainend op metadata.prefix_version).
//   pg_cron post {} en houdt dus exact het gedrag van v1.1.
//
// v1.1: drop per-chunk prefix-LLM (meta_context wordt zelf de prefix), batch
// alle embeds per meeting in één OpenAI-call, batch alle inserts. Doel: één
// meeting binnen 90s wall-time, ook 110-min meetings met 12 topics × 10 salients.
// =============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { matchesAnySecret } from "../_shared/edge-auth.ts";
import {
  EMBED_BATCH_SIZE, EMBED_MODEL, MAX_SALIENTS_PER_TOPIC, MAX_TOPICS,
  SALIENT_PREFIX_VERSION, buildAllChunkInputs, embedBatch, findMacroChunkId,
  fmtDate, persistAllChunks, truncate, type TopicSegment,
} from "./chunking.ts";
import { runSalientReembed } from "./reembed.ts";

const SKILL_VERSION = "chunker-meeting-v2-v1.2";
const GROK_MODEL = "grok-4-fast-reasoning";
const BATCH_SIZE = 1;
const MAX_WALL_TIME_MS = 90000;
const SAFETY_MARGIN_MS = 10000;
const MAX_TRANSCRIPT_CHARS = 100000;

const VALID_FACT_TYPES = new Set(["commitment", "date", "price", "decision", "agreement", "objection", "risk", "name", "rejection", "question_followup"]);

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  const { data: vaultValue } = await supabase.rpc("get_skill_secret_service", { p_skill_name: agentName, p_secret_name: key });
  if (typeof vaultValue === "string" && vaultValue.length > 0) return vaultValue;
  const { data } = await supabase.from("agent_config").select("config_value").eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === "string" ? data.config_value : String(data.config_value);
}

function lineNumberedTranscript(transcript: string, maxChars: number): { numbered: string; lines: string[] } {
  const truncated = truncate(transcript, maxChars);
  const lines = truncated.split("\n").filter((l) => l.trim().length > 0);
  const numbered = lines.map((l, i) => (i + 1) + ": " + l).join("\n");
  return { numbered, lines };
}

async function grokTopicAndSalient(grokKey: string, meeting: any, numbered: string): Promise<{ topics: TopicSegment[]; tokens: number }> {
  const system = `Je analyseert Fireflies-meeting-transcripten voor een Nederlandse RAG-zoekindex. Output STRIKT JSON.

TAAK 1 - Topic-segmentatie: Splits het transcript in 5-${MAX_TOPICS} topic-segmenten op basis van onderwerpswisselingen. Aaneensluitend (geen overlap), topic_title 4-10 woorden Nederlands.

TAAK 2 - Saillante zinnen per topic: Extract per topic 0-${MAX_SALIENTS_PER_TOPIC} FEITELIJKE uitspraken (geen smalltalk). Quote LETTERLIJK 5-30 woorden. fact_type EXACT uit: commitment, date, price, decision, agreement, objection, risk, name, rejection, question_followup. Geen duplicaten.

OUTPUT JSON: {"topics":[{"topic_title":"...","start_line":1,"end_line":25,"speakers":["..."],"salients":[{"speaker":"...","sentence":"...","fact_type":"..."}]}]}`;

  const att = Array.isArray(meeting.attendees) ? meeting.attendees.map((a: any) => a.name || a.email).filter(Boolean).join(", ") : "";
  const userParts = [
    "TITEL: " + (meeting.title ?? "?"),
    "DATUM: " + fmtDate(meeting.date_time),
    "DUUR: " + (meeting.duration_min ?? "?") + " min",
    "AUDIENCE: " + meeting.audience,
    "CATEGORY: " + meeting.category,
    "DEELNEMERS: " + (att || "(geen)"),
    "",
    "TRANSCRIPT (lijn-genummerd):",
    numbered,
  ].join("\n");

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + grokKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GROK_MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: userParts }],
      response_format: { type: "json_object" },
      max_tokens: 16000,
      temperature: 0.2,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error("grok_" + res.status + ": " + text.slice(0, 300));

  const json = JSON.parse(text);
  const raw = json.choices?.[0]?.message?.content?.trim() ?? "{}";
  let parsed: any;
  try { parsed = JSON.parse(raw); } catch (_e) { throw new Error("grok_invalid_json: " + raw.slice(0, 300)); }

  const rawTopics: any[] = Array.isArray(parsed.topics) ? parsed.topics : [];
  const topics: TopicSegment[] = rawTopics.slice(0, MAX_TOPICS).map((t: any) => ({
    topic_title: String(t.topic_title ?? "Untitled topic").slice(0, 200),
    start_line: Math.max(1, Number(t.start_line) || 1),
    end_line: Math.max(1, Number(t.end_line) || 1),
    speakers: Array.isArray(t.speakers) ? t.speakers.filter((s: any) => typeof s === "string").slice(0, 10) : [],
    salients: (Array.isArray(t.salients) ? t.salients : [])
      .slice(0, MAX_SALIENTS_PER_TOPIC)
      .filter((s: any) => s && typeof s.sentence === "string" && s.sentence.trim().length > 4)
      .map((s: any) => ({
        speaker: String(s.speaker ?? "Speaker").slice(0, 100),
        sentence: String(s.sentence).slice(0, 600).trim(),
        fact_type: VALID_FACT_TYPES.has(s.fact_type) ? s.fact_type : "name",
      })),
  }));

  const tokens = (json.usage?.prompt_tokens ?? 0) + (json.usage?.completion_tokens ?? 0);
  return { topics, tokens };
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

  // pg_cron post {} (en soms niets); een lege of onleesbare body = het oude gedrag.
  let body: any = {};
  try { body = await req.json(); } catch { body = {}; }
  if (!body || typeof body !== "object") body = {};

  const triggeredBy = req.headers.get("x-trigger-source") || "edge_cron";
  const startedAt = new Date().toISOString();

  // ── Modus: her-embed van bestaande salient-chunks (06c, geen Grok, geen chunking)
  if (body.mode === "reembed_salients") {
    const { data: runIns } = await supabase.from("agent_runs").insert({
      agent_name: "chunker-meeting-v2", run_type: "edge_function", status: "running",
      started_at: startedAt, stats: { schema_version: "1", skill_version: SKILL_VERSION, mode: "reembed_salients", triggered_by: triggeredBy }, errors: [],
    }).select("id").single();
    const runId = runIns?.id;
    try {
      const openaiKey = await getCfg(supabase, "openai", "embedding_key");
      if (!openaiKey) throw new Error("openai_embedding_key_missing");
      const st = await runSalientReembed(supabase, openaiKey, { limit: body.limit, batch: body.batch, maxWallMs: MAX_WALL_TIME_MS - SAFETY_MARGIN_MS });
      const summary = `reembed ${st.updated}/${st.seen} salients, ${st.remaining} te gaan, ${st.embed_tokens} embed-tok, ~$${st.est_cost_usd}`;
      if (runId) await supabase.from("agent_runs").update({
        status: st.warnings.length > 0 ? "warning" : "success", completed_at: new Date().toISOString(), summary,
        stats: { schema_version: "1", skill_version: SKILL_VERSION, triggered_by: triggeredBy, triggered_at: startedAt, ...st },
      }).eq("id", runId);
      return new Response(JSON.stringify({ ok: true, runId, stats: st, summary }), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (runId) await supabase.from("agent_runs").update({
        status: "error", completed_at: new Date().toISOString(), summary: msg.slice(0, 500),
        errors: [{ message: msg, at: new Date().toISOString() }],
      }).eq("id", runId);
      return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }

  const stats: any = {
    schema_version: "1",
    skill_version: SKILL_VERSION,
    grok_model: GROK_MODEL,
    embed_model: EMBED_MODEL,
    salient_prefix_version: SALIENT_PREFIX_VERSION,
    triggered_by: triggeredBy,
    triggered_at: startedAt,
    meetings_seen: 0,
    meetings_chunked: 0,
    topic_chunks: 0,
    salient_chunks: 0,
    grok_tokens: 0,
    embed_tokens: 0,
    skipped_no_macro: 0,
    timings: {} as Record<string, number>,
    warnings: [] as string[],
  };

  const { data: runIns } = await supabase.from("agent_runs").insert({
    agent_name: "chunker-meeting-v2",
    run_type: "edge_function",
    status: "running",
    started_at: startedAt,
    stats,
    errors: [],
  }).select("id").single();
  const runId = runIns?.id;

  try {
    const grokKey = await getCfg(supabase, "legal-ai-research", "grok_api_key");
    if (!grokKey) throw new Error("grok_api_key_missing");
    const openaiKey = await getCfg(supabase, "openai", "embedding_key");
    if (!openaiKey) throw new Error("openai_embedding_key_missing");

    const { data: meetings, error: fe } = await supabase.rpc("fetch_meetings_for_v2_chunking", { p_limit: BATCH_SIZE });
    if (fe) throw new Error("fetch_failed: " + fe.message);
    stats.meetings_seen = (meetings ?? []).length;

    for (const m of meetings ?? []) {
      if (Date.now() - startTime >= MAX_WALL_TIME_MS - SAFETY_MARGIN_MS) {
        stats.warnings.push("wall_time_break_at_" + stats.meetings_chunked);
        break;
      }
      const tStart = Date.now();
      try {
        const macroId = await findMacroChunkId(supabase, m.id);
        if (!macroId) {
          stats.skipped_no_macro++;
          stats.warnings.push("no_macro_chunk_" + m.id.slice(0, 8));
          continue;
        }

        const { numbered, lines } = lineNumberedTranscript(m.transcript_text || "", MAX_TRANSCRIPT_CHARS);
        if (lines.length < 3) {
          stats.warnings.push("empty_transcript_" + m.id.slice(0, 8));
          continue;
        }

        const tGrok0 = Date.now();
        const { topics, tokens: grokTok } = await grokTopicAndSalient(grokKey, m, numbered);
        stats.timings.grok_ms = Date.now() - tGrok0;
        stats.grok_tokens += grokTok;

        if (topics.length === 0) {
          stats.warnings.push("no_topics_" + m.id.slice(0, 8));
          continue;
        }

        const prepared = buildAllChunkInputs(m, topics, lines);
        if (prepared.length === 0) {
          stats.warnings.push("empty_prepared_" + m.id.slice(0, 8));
          continue;
        }

        // Embed in slices van EMBED_BATCH_SIZE
        const tEmbed0 = Date.now();
        const allEmbeds: number[][] = new Array(prepared.length);
        for (let i = 0; i < prepared.length; i += EMBED_BATCH_SIZE) {
          const slice = prepared.slice(i, i + EMBED_BATCH_SIZE);
          const inputs = slice.map((p) => p.embedInput);
          const { embeddings, tokens } = await embedBatch(openaiKey, inputs);
          stats.embed_tokens += tokens;
          for (let j = 0; j < embeddings.length; j++) allEmbeds[i + j] = embeddings[j];
        }
        stats.timings.embed_ms = Date.now() - tEmbed0;

        const tInsert0 = Date.now();
        const { topic_chunks, salient_chunks } = await persistAllChunks(supabase, m, macroId, prepared, allEmbeds);
        stats.timings.insert_ms = Date.now() - tInsert0;
        stats.topic_chunks += topic_chunks;
        stats.salient_chunks += salient_chunks;
        stats.meetings_chunked++;
        stats.timings.total_ms = Date.now() - tStart;
      } catch (e) {
        stats.warnings.push("meeting_" + m.id.slice(0, 8) + ": " + (e instanceof Error ? e.message : String(e)).slice(0, 200));
      }
    }

    const finalStatus = stats.warnings.length > 0 ? "warning" : "success";
    const summary = stats.meetings_chunked === 0
      ? "no meetings chunked (saw " + stats.meetings_seen + ")"
      : stats.meetings_chunked + " meetings, " + stats.topic_chunks + " topics, " + stats.salient_chunks + " salients, " + stats.grok_tokens + " grok-tok, " + stats.embed_tokens + " embed-tok";

    if (runId) await supabase.from("agent_runs").update({
      status: finalStatus, completed_at: new Date().toISOString(), summary, stats,
    }).eq("id", runId);

    return new Response(JSON.stringify({ ok: true, runId, stats, summary }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (runId) await supabase.from("agent_runs").update({
      status: "error", completed_at: new Date().toISOString(), summary: msg.slice(0, 500), stats,
      errors: [{ message: msg, at: new Date().toISOString() }],
    }).eq("id", runId);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
