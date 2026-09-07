// =============================================================================
// chunker-meeting-v2/reembed.ts — her-embed de bestaande salient-chunks
// =============================================================================
// 06c (2026-09-07, vorken C4/C5). De prefix-inkorting van chunking.ts geldt alleen
// voor NIEUWE meetings. De 902 salient-chunks die er al staan houden hun lange
// `content_with_context` — en dus hun oude vector — tot ze opnieuw geëmbed zijn.
//
// Dit is embedding-ONLY: geen Grok-call, geen her-chunking, `content` blijft
// letterlijk staan. Daarmee valt deze job buiten het $0,40-per-1.000-chunks-model
// van memory `rechunk-cost-is-the-prefix-model` (dáár was de gpt-5.4-mini-prefix
// 20× de embedding); hier is er geen prefix-LLM. Begroot: 902 chunks × ~40 tokens
// ≈ 36 k tokens ≈ $0,005 op text-embedding-3-large ($0,13/1M).
//
// Zelf-drainend via `metadata.prefix_version` (06b-patroon): elke aanroep pakt de
// eerstvolgende N rijen zonder de huidige versie en meldt hoeveel er nog liggen.
// Harde stop op een tokenbudget, zodat een lus nooit ongemerkt kan doorlopen.
// =============================================================================

import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { EMBED_BATCH_SIZE, EMBED_MODEL, SALIENT_PREFIX_VERSION, embedBatch, salientMeta, toVectorLiteral } from "./chunking.ts";

// $0,13 per 1M tokens; 1,2M tokens ≈ $0,15 = de poort c7. Ruim boven de begroting
// van 36 k, dus een normale ronde raakt hem nooit — hij bestaat om een lus te stoppen.
const MAX_TOKENS_PER_CALL = 400_000;

export interface ReembedStats {
  mode: string;
  version: string;
  candidates_before: number;
  seen: number;
  updated: number;
  skipped_no_content: number;
  embed_tokens: number;
  est_cost_usd: number;
  remaining: number;
  cycles: number;
  wall_ms: number;
  budget_stop: boolean;
  warnings: string[];
}

export async function runSalientReembed(
  supabase: SupabaseClient,
  openaiKey: string,
  opts: { limit?: number; batch?: number; maxWallMs?: number },
): Promise<ReembedStats> {
  const t0 = Date.now();
  const limit = Math.max(1, Math.min(Number(opts.limit ?? 200), 1000));
  const batch = Math.max(1, Math.min(Number(opts.batch ?? EMBED_BATCH_SIZE), EMBED_BATCH_SIZE));
  const maxWallMs = Math.max(5_000, Math.min(Number(opts.maxWallMs ?? 70_000), 110_000));
  const st: ReembedStats = {
    mode: "reembed_salients", version: SALIENT_PREFIX_VERSION, candidates_before: 0, seen: 0, updated: 0,
    skipped_no_content: 0, embed_tokens: 0, est_cost_usd: 0, remaining: 0, cycles: 0, wall_ms: 0,
    budget_stop: false, warnings: [],
  };

  // Kandidaten en teller via de RPC's uit migratie 20260907064000 — het predicaat
  // moet ook rijen ZONDER prefix_version meenemen, en dat is als jsonb-`or` in
  // PostgREST niet te verifiëren vanuit de implement-omgeving.
  const countLeft = async (): Promise<number> => {
    const { data, error } = await supabase.rpc("meeting_salient_reembed_remaining", { p_version: SALIENT_PREFIX_VERSION });
    if (error) throw new Error("reembed_remaining_failed: " + error.message);
    return Number(data ?? 0);
  };
  st.candidates_before = await countLeft();

  while (st.seen < limit) {
    if (Date.now() - t0 > maxWallMs) { st.warnings.push("wall_time_stop"); break; }
    if (st.embed_tokens > MAX_TOKENS_PER_CALL) { st.budget_stop = true; st.warnings.push("token_budget_stop"); break; }

    const take = Math.min(batch, limit - st.seen);
    const { data: rows, error } = await supabase.rpc("meeting_salient_reembed_candidates", {
      p_version: SALIENT_PREFIX_VERSION, p_limit: take,
    });
    if (error) throw new Error("reembed_fetch_failed: " + error.message);
    if (!rows || rows.length === 0) break;
    st.cycles++;

    const usable = rows.filter((r: any) => typeof r.content === "string" && r.content.trim().length > 0);
    st.skipped_no_content += rows.length - usable.length;
    st.seen += rows.length;
    if (usable.length === 0) {
      st.warnings.push("batch_without_content");
      break; // anders biedt de volgende ronde dezelfde rijen weer aan
    }

    const inputs = usable.map((r: any) => salientMeta(r.occurred_at, r.speaker ?? "Speaker", r.fact_type ?? "name") + "\n\n" + r.content);
    const { embeddings, tokens } = await embedBatch(openaiKey, inputs);
    st.embed_tokens += tokens;
    if (embeddings.length !== usable.length) throw new Error(`reembed_embed_mismatch: ${embeddings.length} vs ${usable.length}`);

    for (let i = 0; i < usable.length; i++) {
      const r: any = usable[i];
      const meta = (r.metadata && typeof r.metadata === "object") ? { ...r.metadata } : {};
      meta.prefix_version = SALIENT_PREFIX_VERSION;
      const { error: upErr } = await supabase.from("chunks").update({
        content_with_context: inputs[i],
        embedding: toVectorLiteral(embeddings[i]),
        embedded_at: new Date().toISOString(),
        embedding_model: EMBED_MODEL,
        metadata: meta,
      }).eq("chunk_id", r.chunk_id);
      if (upErr) { st.warnings.push(`update_failed_${String(r.chunk_id).slice(0, 8)}: ${upErr.message.slice(0, 90)}`); continue; }
      st.updated++;
    }
  }

  st.remaining = await countLeft();
  st.est_cost_usd = +((st.embed_tokens / 1_000_000) * 0.13).toFixed(5);
  st.wall_ms = Date.now() - t0;
  return st;
}
