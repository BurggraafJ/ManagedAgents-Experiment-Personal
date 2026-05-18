// =============================================================================
// _shared/anthropic-fetch.ts — centrale wrapper voor Anthropic API-calls
// vanuit Supabase Edge Functions.
// =============================================================================
// Eén plek waar alle Edge Functions Claude aanroepen. Doet:
//   1. fetch() naar https://api.anthropic.com/v1/messages
//   2. Schrijft een rij in claude_api_calls (telemetrie, cost-attributie,
//      loop-detectie, replay) — fire-and-forget, faalt niet als logging faalt.
//
// Cost wordt berekend door BEFORE-INSERT trigger in de DB (claude_api_pricing
// lookup) — wrapper hoeft alleen tokens + model door te geven.
//
// Zie Confluence: Project — Token Cost Counter & Helicone-traces (450101261) v3.
//
// Gebruik:
//   import { callAnthropic } from "../_shared/anthropic-fetch.ts";
//   const r = await callAnthropic({
//     supabase,                                  // SupabaseClient (service-role)
//     apiKey,                                    // Vault skill:anthropic:api_key
//     model: "claude-haiku-4-5",
//     max_tokens: 64,
//     messages: [{ role: "user", content: prompt }],
//     attribution: {
//       runId,                                   // agent_runs.id (optional)
//       edgeFunction: "context-build",
//       skillName: "context-build",
//     },
//   });
//   console.log(r.content, r.input_tokens, r.output_tokens, r.cost_usd);
// =============================================================================

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type AnthropicMessage = { role: "user" | "assistant"; content: string };

export type CallAttribution = {
  runId?: string | null;       // agent_runs.id — kan null zijn voor ad-hoc calls
  edgeFunction?: string;       // bv. "context-build"
  skillName?: string;          // bv. "context-build"
  agentName?: string;
};

export type AnthropicCallOptions = {
  supabase: SupabaseClient;    // service-role client voor claude_api_calls-write
  apiKey: string;              // uit Vault skill:anthropic:api_key
  model: string;               // bv. "claude-haiku-4-5"
  messages: AnthropicMessage[];
  max_tokens: number;
  system?: string;
  attribution?: CallAttribution;
  timeout_ms?: number;         // default 60_000
  enable_logging?: boolean;    // default true — zet op false voor dev/test
};

export type AnthropicCallResult = {
  raw: unknown;
  content: string;
  input_tokens: number;
  cached_input_tokens: number;
  cache_creation_input_tokens: number;
  output_tokens: number;
  model: string;
  message_uuid?: string;
  latency_ms: number;
  cost_usd?: number;           // gevuld door DB-trigger; teruggehaald uit insert-return
  call_log_id?: string;        // claude_api_calls.id
};

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

async function sha256Hex16(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const arr = Array.from(new Uint8Array(buf));
  return arr.map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

function flattenMessages(messages: AnthropicMessage[]): string {
  return messages.map(m => `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`).join("\n");
}

export async function callAnthropic(opts: AnthropicCallOptions): Promise<AnthropicCallResult> {
  if (!opts.apiKey)             throw new Error("callAnthropic: apiKey is required");
  if (!opts.model)              throw new Error("callAnthropic: model is required");
  if (!opts.messages?.length)   throw new Error("callAnthropic: messages cannot be empty");

  const t0 = Date.now();

  const headers: Record<string, string> = {
    "x-api-key": opts.apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "Content-Type": "application/json",
  };
  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.max_tokens,
    messages: opts.messages,
  };
  if (opts.system) body.system = opts.system;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeout_ms ?? 60_000);

  let res: Response | null = null;
  let errorText: string | null = null;
  let status: "ok" | "error" | "timeout" = "ok";

  try {
    res = await fetch(ANTHROPIC_URL, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
  } catch (e) {
    errorText = (e instanceof Error) ? e.message : String(e);
    status = errorText.includes("abort") || errorText.includes("timeout") ? "timeout" : "error";
  } finally {
    clearTimeout(timeout);
  }

  const latency_ms = Date.now() - t0;

  // -- Hard fail path: no response at all -----------------------------------
  if (!res) {
    await logCall(opts, {
      status, error_text: errorText,
      input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0,
      latency_ms, message_uuid: null,
      prompt_hash: await sha256Hex16(flattenMessages(opts.messages)),
      prompt_preview: flattenMessages(opts.messages).slice(0, 500),
      response_preview: null,
    });
    throw new Error(`anthropic_call_failed: ${errorText ?? "unknown"}`);
  }

  const text = await res.text();
  if (!res.ok) {
    const promptFlat = flattenMessages(opts.messages);
    await logCall(opts, {
      status: "error",
      error_text: `anthropic_${res.status}: ${text.slice(0, 300)}`,
      input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0,
      latency_ms, message_uuid: null,
      prompt_hash: await sha256Hex16(promptFlat),
      prompt_preview: promptFlat.slice(0, 500),
      response_preview: text.slice(0, 500),
    });
    throw new Error(`anthropic_${res.status}: ${text.slice(0, 300)}`);
  }

  const json = JSON.parse(text);
  const content: string = json.content?.[0]?.text ?? "";
  const usage = json.usage ?? {};
  const promptFlat = flattenMessages(opts.messages);

  const logged = await logCall(opts, {
    status: "ok",
    error_text: null,
    input_tokens:                 usage.input_tokens                 ?? 0,
    cache_read_input_tokens:      usage.cache_read_input_tokens      ?? 0,
    cache_creation_input_tokens:  usage.cache_creation_input_tokens  ?? 0,
    output_tokens:                usage.output_tokens                ?? 0,
    latency_ms,
    message_uuid:                 json.id ?? null,
    prompt_hash:                  await sha256Hex16(promptFlat),
    prompt_preview:               promptFlat.slice(0, 500),
    response_preview:             content.slice(0, 500),
  });

  return {
    raw: json,
    content,
    input_tokens:                 usage.input_tokens                 ?? 0,
    cached_input_tokens:          usage.cache_read_input_tokens      ?? 0,
    cache_creation_input_tokens:  usage.cache_creation_input_tokens  ?? 0,
    output_tokens:                usage.output_tokens                ?? 0,
    model:                        json.model ?? opts.model,
    message_uuid:                 json.id ?? undefined,
    latency_ms,
    cost_usd:                     logged?.cost_usd ?? undefined,
    call_log_id:                  logged?.id ?? undefined,
  };
}

// -----------------------------------------------------------------------------
// Fire-and-forget logger — fouten in logging mogen nooit de call mislukken laten.
// -----------------------------------------------------------------------------

type LogRow = {
  status: "ok" | "error" | "timeout";
  error_text: string | null;
  input_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  output_tokens: number;
  latency_ms: number;
  message_uuid: string | null;
  prompt_hash: string;
  prompt_preview: string;
  response_preview: string | null;
};

async function logCall(opts: AnthropicCallOptions, row: LogRow): Promise<{ id: string; cost_usd: number | null } | null> {
  if (opts.enable_logging === false) return null;

  const insert = {
    run_id:                        opts.attribution?.runId ?? null,
    source:                        "edge_function" as const,
    source_edge_function:          opts.attribution?.edgeFunction ?? null,
    skill_name:                    opts.attribution?.skillName ?? null,
    agent_name:                    opts.attribution?.agentName ?? null,
    model:                         opts.model,
    input_tokens:                  row.input_tokens,
    cache_read_input_tokens:       row.cache_read_input_tokens,
    cache_creation_input_tokens:   row.cache_creation_input_tokens,
    output_tokens:                 row.output_tokens,
    latency_ms:                    row.latency_ms,
    status:                        row.status,
    error_text:                    row.error_text,
    message_uuid:                  row.message_uuid,
    prompt_hash:                   row.prompt_hash,
    prompt_preview:                row.prompt_preview,
    response_preview:              row.response_preview,
  };

  try {
    const { data, error } = await opts.supabase
      .from("claude_api_calls")
      .insert(insert)
      .select("id, cost_usd")
      .single();
    if (error) {
      console.warn(`[anthropic-fetch] logCall failed: ${error.message}`);
      return null;
    }
    return data;
  } catch (e) {
    console.warn(`[anthropic-fetch] logCall exception: ${(e as Error).message}`);
    return null;
  }
}
