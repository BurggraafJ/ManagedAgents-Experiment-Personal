// =============================================================================
// autodraft-rag-prefill v4.0 — entity-aware hybrid retrieval (R.5 closing)
// =============================================================================
// Per autodraft_mails-rij zonder rag_context:
//   1. Sync-staleness pre-flight (mail-mirror max 30 min oud)
//   2. Embed query (subject + body) via text-embedding-3-large
//   3. Twee retrieval-passes:
//      a. SEMANTIC: match_chunks (vector + BM25 + RRF + recency) — algemeen recall
//      b. ENTITY (alleen als from_email of from_domain resolveert via
//         entity_resolution): match_chunks_for_entity — entity-gerichte recall
//   4. Merge top-N van beide passes, dedupe op chunk_id, sort op combined_score
//   5. Schrijf rag_context met retrieval_strategy + entity_used metadata
//
// History:
//   v1.0  2026-04-28 — match_all_sources over 6 truth-of-source tabellen
//   v2.0  2026-05-03 — text-embedding-3-large + halfvec query (B.2)
//   v3.0  2026-05-03 — match_chunks (R.4 hybrid retrieval over chunks-tabel)
//   v4.0  2026-05-04 — match_chunks_for_entity tweede pass (R.5 closing) +
//                       fix BM25 query (gebruikte voorheen draft-velden ipv mail-velden)
//
// Cron: */3 * * * * (Vault-bearer sinds 2026-05-04 ronde-2 fix). Idle als alles
// up-to-date.
// =============================================================================

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SKILL_VERSION = "autodraft-rag-prefill-v4.0";
const MODEL = "text-embedding-3-large";
const DIMENSIONS = 3072;
const BATCH_SIZE = 30;
const TOP_K_FINAL = 5;            // Aantal matches in rag_context.matches[]
const TOP_K_PER_PASS = 5;         // Per retrieval-pass (semantic + entity) → max 10 → dedupe → top-5
const MIN_SIMILARITY = 0.6;
const MAX_INPUT_CHARS = 6000;
const MAX_WALL_TIME_MS = 90_000;
const SAFETY_MARGIN_MS = 15_000;

// Recency-bias zwaarder voor autodraft dan voor algemene rag-search:
// recente mails wegen meer omdat klantgesprek-context belangrijker is dan oude historie.
const RECENCY_WEIGHT = 0.20;
const RECENCY_DECAY_DAYS = 90.0;
const RAG_RECENT_MONTHS = 12;

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  const { data: vaultValue } = await supabase.rpc("get_skill_secret_service", {
    p_skill_name: agentName, p_secret_name: key
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

async function embed(apiKey: string, input: string, retry = 0): Promise<{ embedding: number[]; tokens: number }> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, input, dimensions: DIMENSIONS }),
  });
  if ((res.status === 429 || res.status >= 500) && retry < 3) {
    const delays = [3000, 10000, 30000];
    await new Promise((r) => setTimeout(r, delays[retry]));
    return embed(apiKey, input, retry + 1);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`openai_${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  return { embedding: json.data[0].embedding, tokens: json.usage.total_tokens };
}

interface MailRow {
  id: string;
  subject: string | null;
  body_preview: string | null;
  body_text: string | null;
  body_html: string | null;
  from_email: string | null;
  from_domain: string | null;
}

function buildQueryInput(mail: MailRow): string {
  const body = mail.body_text || stripHtml(mail.body_html);
  const from = mail.from_email ? `From: ${mail.from_email}` : "";
  const composed = [from, `Subject: ${mail.subject ?? ""}`, mail.body_preview ?? "", body]
    .filter(Boolean).join("\n");
  return truncate(composed, MAX_INPUT_CHARS);
}

function buildBm25Query(mail: MailRow): string {
  // BM25 werkt het beste met dichtgepakte content-keywords. Body-preview heeft
  // de eerste 200 chars van de body, samen met subject zijn dat de meest
  // signaal-rijke woorden.
  return ((mail.subject ?? "") + " " + (mail.body_preview ?? "").slice(0, 200)).trim();
}

interface ResolvedEntity {
  entity_type: 'contact' | 'company';
  entity_id: string;
  via: 'email_exact' | 'email_domain';
  confidence: number;
}

async function resolveEntity(
  supabase: SupabaseClient,
  fromEmail: string | null,
  fromDomain: string | null
): Promise<ResolvedEntity | null> {
  // Voorkeur: exact email-match → contact (specifieker, hogere confidence)
  if (fromEmail) {
    const { data } = await supabase
      .from("entity_resolution")
      .select("entity_id, confidence")
      .eq("alias_type", "email")
      .eq("alias_value", fromEmail.toLowerCase())
      .eq("entity_type", "contact")
      .order("confidence", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.entity_id) {
      return { entity_type: "contact", entity_id: data.entity_id, via: "email_exact", confidence: data.confidence };
    }
  }
  // Fallback: domain-match → company
  if (fromDomain) {
    const { data } = await supabase
      .from("entity_resolution")
      .select("entity_id, confidence")
      .eq("alias_type", "email_domain")
      .eq("alias_value", fromDomain.toLowerCase())
      .eq("entity_type", "company")
      .order("confidence", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.entity_id) {
      return { entity_type: "company", entity_id: data.entity_id, via: "email_domain", confidence: data.confidence };
    }
  }
  return null;
}

interface MatchRow {
  chunk_id: string;
  source: string;
  id: string;
  chunk_type: string;
  content: string;
  occurred_at: string;
  metadata: any;
  similarity: number;
  vector_score: number;
  bm25_score: number;
  recency_score: number;
  entity_path?: any;
  source_strategy: 'semantic' | 'entity';
}

function normalizeMatchRows(rows: any[], strategy: 'semantic' | 'entity'): MatchRow[] {
  return (rows ?? []).map((m: any) => ({
    chunk_id: m.out_chunk_id,
    source: m.out_source,
    id: m.out_source_id,
    chunk_type: m.out_chunk_type,
    content: m.out_content,
    occurred_at: m.out_occurred_at,
    metadata: m.out_metadata,
    similarity: m.out_combined_score,    // legacy field name — combined_score is wat consumers willen
    vector_score: m.out_vector_score,
    bm25_score: m.out_bm25_score,
    recency_score: m.out_recency_score,
    entity_path: m.out_entity_path,
    source_strategy: strategy,
  }));
}

function mergeAndDedupeMatches(semantic: MatchRow[], entity: MatchRow[], topK: number): MatchRow[] {
  const byChunkId = new Map<string, MatchRow>();
  // Eerst entity-matches (markeer met source_strategy='entity'), dan semantic.
  // Als chunk in beide voorkomt: behoud entity-strategy maar beste combined_score.
  for (const m of entity) {
    byChunkId.set(m.chunk_id, m);
  }
  for (const m of semantic) {
    const existing = byChunkId.get(m.chunk_id);
    if (!existing) {
      byChunkId.set(m.chunk_id, m);
    } else {
      // Behoud hoogste combined_score, markeer als 'both' wanneer beide bronnen hem zagen
      const merged: MatchRow = { ...existing };
      if (m.similarity > existing.similarity) {
        merged.similarity = m.similarity;
        merged.vector_score = m.vector_score;
        merged.bm25_score = m.bm25_score;
        merged.recency_score = m.recency_score;
      }
      merged.source_strategy = 'entity';   // Bias toward entity wanneer beide passes hetzelfde vinden
      byChunkId.set(m.chunk_id, merged);
    }
  }
  return Array.from(byChunkId.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

Deno.serve(async (req) => {
  const startTime = Date.now();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const presentedToken = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const cronSecret = (await getCfg(supabase, "global", "cron_secret")) || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!presentedToken || (presentedToken !== cronSecret && presentedToken !== serviceKey)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const triggeredBy = req.headers.get("x-trigger-source") || "edge_cron";
  const startedAt = new Date().toISOString();
  const stats = {
    skill_version: SKILL_VERSION,
    triggered_by: triggeredBy, triggered_at: startedAt,
    processed: 0, skipped_empty: 0, skipped_no_mail: 0,
    entity_resolved: 0, entity_via_email: 0, entity_via_domain: 0,
    total_tokens: 0, avg_top_similarity: null as number | null,
    sync_check: null as object | null,
    warnings: [] as string[],
  };

  const { data: runIns, error: runErr } = await supabase.from("agent_runs").insert({
    agent_name: "autodraft-rag-prefill", run_type: "edge_function", status: "running",
    started_at: startedAt, stats, errors: []
  }).select("id").single();
  if (runErr || !runIns) return new Response(`run_record_create_failed: ${runErr?.message}`, { status: 500 });
  const runId = runIns.id as string;

  try {
    // ===== Pre-flight: sync-staleness check =====
    const { data: syncCheck } = await supabase.rpc('sync_health', { source_name: 'mail', max_age_minutes: 30 });
    stats.sync_check = syncCheck ?? { warning: 'sync_health rpc unavailable' };
    if (syncCheck && syncCheck.is_fresh === false) {
      throw new Error(`mail_sync_stale: last sync ${syncCheck.age_minutes} min ago (threshold ${syncCheck.max_age_minutes})`);
    }

    const apiKey = await getCfg(supabase, "openai", "embedding_key");
    if (!apiKey || apiKey.length < 20) throw new Error("openai_embedding_key_missing");

    const filterAfter = new Date();
    filterAfter.setMonth(filterAfter.getMonth() - RAG_RECENT_MONTHS);
    const filterAfterIso = filterAfter.toISOString();

    const topSimilarities: number[] = [];

    while ((Date.now() - startTime) < MAX_WALL_TIME_MS - SAFETY_MARGIN_MS) {
      const { data: pending, error: pendErr } = await supabase
        .from("autodraft_mails")
        .select("id, mail_id")
        .is("rag_context", null)
        .not("status", "in", "(archived,sent)")
        .order("scanned_at", { ascending: false })
        .limit(BATCH_SIZE);
      if (pendErr) throw new Error(`autodraft_select_failed: ${pendErr.message}`);
      if (!pending || pending.length === 0) break;

      const mailIds = pending.map((p) => p.mail_id).filter(Boolean);
      const { data: mails, error: mailErr } = await supabase
        .from("mail_messages")
        .select("id, subject, body_preview, body_text, body_html, from_email, from_domain")
        .in("id", mailIds);
      if (mailErr) throw new Error(`mail_lookup_failed: ${mailErr.message}`);
      const mailMap = new Map<string, MailRow>((mails ?? []).map((m: any) => [m.id as string, m as MailRow]));

      for (const draft of pending) {
        if ((Date.now() - startTime) >= MAX_WALL_TIME_MS - SAFETY_MARGIN_MS) break;
        const mail = mailMap.get(draft.mail_id);
        if (!mail) {
          stats.skipped_no_mail++;
          await supabase.from("autodraft_mails").update({
            rag_context: { matches: [], reason: "mail_not_found_in_mirror" },
            rag_computed_at: new Date().toISOString(),
          }).eq("id", draft.id);
          continue;
        }
        const queryText = buildQueryInput(mail);
        if (!queryText.trim() || queryText.length < 20) {
          stats.skipped_empty++;
          await supabase.from("autodraft_mails").update({
            rag_context: { matches: [], reason: "empty_query_text" },
            rag_computed_at: new Date().toISOString(),
          }).eq("id", draft.id);
          continue;
        }
        const queryHash = await sha256(queryText);
        const bm25Query = buildBm25Query(mail);

        try {
          // ===== Pass 1: SEMANTIC retrieval =====
          const { embedding, tokens } = await embed(apiKey, queryText);
          stats.total_tokens += tokens;
          const embeddingLit = "[" + embedding.join(",") + "]";

          const { data: semanticRows, error: semErr } = await supabase.rpc("match_chunks", {
            query_embedding: embeddingLit,
            query_text: bm25Query || null,
            top_k: TOP_K_PER_PASS,
            filter_sources: null,
            filter_after: filterAfterIso,
            filter_entity_id: null,
            min_similarity: MIN_SIMILARITY,
            recency_weight: RECENCY_WEIGHT,
            recency_decay_days: RECENCY_DECAY_DAYS,
          });
          if (semErr) throw new Error(`match_chunks_failed: ${semErr.message}`);
          let semanticMatches = normalizeMatchRows(semanticRows ?? [], 'semantic');

          // ===== Pass 2: ENTITY-AWARE retrieval (alleen als entity gevonden) =====
          const entity = await resolveEntity(supabase, mail.from_email, mail.from_domain);
          let entityMatches: MatchRow[] = [];
          if (entity) {
            stats.entity_resolved++;
            if (entity.via === 'email_exact') stats.entity_via_email++;
            else stats.entity_via_domain++;

            const { data: entityRows, error: entErr } = await supabase.rpc("match_chunks_for_entity", {
              p_entity_type: entity.entity_type,
              p_entity_id: entity.entity_id,
              p_query_embedding: embeddingLit,
              p_query_text: bm25Query || null,
              p_top_k: TOP_K_PER_PASS,
              p_hop_depth: 1,
              p_filter_sources: null,
              p_filter_after: filterAfterIso,
              p_min_similarity: MIN_SIMILARITY,
              p_recency_weight: RECENCY_WEIGHT,
              p_recency_decay_days: RECENCY_DECAY_DAYS,
            });
            if (entErr) {
              // Niet fataal — log warning, ga door met alleen semantic
              stats.warnings.push(`entity_match_failed_${draft.id}: ${entErr.message.slice(0, 150)}`);
            } else {
              entityMatches = normalizeMatchRows(entityRows ?? [], 'entity');
            }
          }

          // ===== Filter zelf-match + merge =====
          semanticMatches = semanticMatches.filter((m) => !(m.source === "mail" && m.id === draft.mail_id));
          entityMatches = entityMatches.filter((m) => !(m.source === "mail" && m.id === draft.mail_id));
          const merged = mergeAndDedupeMatches(semanticMatches, entityMatches, TOP_K_FINAL);

          if (merged.length > 0) topSimilarities.push(merged[0].similarity);

          // ===== Schrijf rag_context =====
          await supabase.from("autodraft_mails").update({
            rag_context: {
              matches: merged,
              query_text_preview: queryText.slice(0, 200),
              filter_after: filterAfterIso,
              top_k: TOP_K_FINAL,
              min_similarity: MIN_SIMILARITY,
              model: MODEL,
              retrieval_strategy: entity ? 'match_chunks+match_chunks_for_entity' : 'match_chunks',
              retrieval_params: {
                recency_weight: RECENCY_WEIGHT,
                recency_decay_days: RECENCY_DECAY_DAYS,
                top_k_per_pass: TOP_K_PER_PASS,
              },
              entity_used: entity ? {
                type: entity.entity_type,
                id: entity.entity_id,
                via: entity.via,
                confidence: entity.confidence,
              } : null,
              passes: {
                semantic_n: semanticMatches.length,
                entity_n: entityMatches.length,
              },
              computed_at: new Date().toISOString(),
            },
            rag_computed_at: new Date().toISOString(),
            rag_query_hash: queryHash,
          }).eq("id", draft.id);
          stats.processed++;
        } catch (rowErr) {
          stats.warnings.push(`draft_${draft.id}: ${(rowErr instanceof Error ? rowErr.message : String(rowErr)).slice(0, 200)}`);
        }
      }
    }

    if (topSimilarities.length > 0) {
      stats.avg_top_similarity = topSimilarities.reduce((s, v) => s + v, 0) / topSimilarities.length;
    }
    const summary = stats.processed === 0
      ? "no pending drafts"
      : `${stats.processed} drafts pre-filled (${stats.entity_resolved} entity-aware, avg top-sim ${stats.avg_top_similarity?.toFixed(3) ?? 'n/a'}, ${stats.total_tokens} tokens)`;
    const finalStatus = stats.warnings.length > 0 ? "warning" : "success";

    await supabase.from("agent_runs").update({
      status: finalStatus, completed_at: new Date().toISOString(), summary, stats
    }).eq("id", runId);
    return new Response(JSON.stringify({ ok: true, runId, summary, stats }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await supabase.from("agent_runs").update({
      status: "error", completed_at: new Date().toISOString(),
      summary: errMsg.slice(0, 500), stats,
      errors: [{ message: errMsg, at: new Date().toISOString() }]
    }).eq("id", runId);
    return new Response(JSON.stringify({ ok: false, error: errMsg }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
