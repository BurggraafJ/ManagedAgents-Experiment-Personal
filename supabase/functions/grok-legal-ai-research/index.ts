// grok-legal-ai-research v2 (split-architectuur 2026-05-02)
//
// **Research-only.** Verrijkt de Legal AI-database met feitelijke findings.
// Schrijft GEEN artikel. Het schrijven gebeurt apart via grok-legal-ai-write.
//
// Architectuur:
//   - Claude (skill `legal-ai-research`) bepaalt focus + scope
//   - Deze Edge Function roept Grok aan met search-tools aan
//   - Grok verzamelt feitelijke findings (geen narratief, geen mening)
//   - Findings + citations worden teruggestuurd naar Claude
//   - Claude persisteert in legal_ai_findings (incl. embed-pass later)
//
// Secrets-storage:
//   - legal-ai-research.grok_api_key   xAI Grok API key (Vault)
//   - global.cron_secret               Auth voor inkomende calls
//
// Endpoint: POST /functions/v1/grok-legal-ai-research
// Body:
//   {
//     "track": "advocatuur" | "bedrijfsleven",
//     "focus_brief": "... Claude's dagelijkse onderzoeksvraag ...",
//     "topics_in_scope": ["Harvey-platform", "AI Act"],
//     "model": "grok-4",
//     "search_mode": "on" | "auto",
//     "max_search_results": 30,
//     "max_findings": 12
//   }
//
// Response:
//   {
//     ok: true,
//     findings: [
//       {
//         title: "...",
//         summary: "1-3 zinnen feitelijk",
//         source_url: "https://...",
//         source_title: "...",
//         published_at: "2026-04-28" | null,
//         key_quote: "..." | null,
//         tags: ["harvey", "big_law"]
//       }
//     ],
//     usage: { tokens_in, tokens_out, search_results_count, duration_ms, model }
//   }
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const FN_VERSION = "grok-legal-ai-research-v5-fast-reasoning";
// xAI deprecated chat/completions+search_parameters in mei 2026.
// We gebruiken nu de Responses API: /v1/responses met tools:[{type:"web_search"}].
const GROK_ENDPOINT = "https://api.x.ai/v1/responses";
// grok-4-0709 had structurele 503 capacity-issues mei 2026; fast-reasoning is sneller
// en stabieler met dezelfde tool-support (web_search). Beide zijn grok-4-familie.
const DEFAULT_MODEL = "grok-4-fast-reasoning";
const DEFAULT_TIMEOUT_MS = 240_000;
const RETRY_ON_503_DELAY_MS = 4_000;

async function getCfg(supabase: SupabaseClient, agentName: string, key: string): Promise<string | null> {
  const { data: vaultValue } = await supabase.rpc("get_skill_secret_service", {
    p_skill_name: agentName,
    p_secret_name: key,
  });
  if (typeof vaultValue === "string" && vaultValue.length > 0) return vaultValue;
  const { data } = await supabase.from("agent_config").select("config_value")
    .eq("agent_name", agentName).eq("config_key", key).maybeSingle();
  if (!data?.config_value) return null;
  return typeof data.config_value === "string" ? data.config_value : String(data.config_value);
}

interface RequestBody {
  track: "advocatuur" | "bedrijfsleven";
  focus_brief: string;
  topics_in_scope?: string[];
  model?: string;
  search_mode?: "on" | "auto";
  max_search_results?: number;
  max_findings?: number;
}

const SYSTEM_PROMPT = `Je bent de research-engine voor Legal Mind, het bedrijf van Jelle Burggraaf in Nederland.

JE TAAK
Doe gericht live web-onderzoek naar het opgegeven onderwerp/track. Verzamel FEITELIJKE FINDINGS — geen mening, geen verhaal, geen artikel. Per finding: één concrete observatie + bron.

WAT WIL IK ZIEN
Per finding lever je:
- title: korte koppakkende samenvatting (max 100 chars)
- summary: 1-3 zinnen feitelijk wat er gebeurd is / wat de bron zegt
- source_url: directe URL naar de primaire bron
- source_title: naam van de bron (publication, blog, persbericht)
- published_at: ISO-date (YYYY-MM-DD) als bekend, anders null
- key_quote: één pakkende quote uit de bron (optioneel, max 200 chars)
- tags: 1-3 trefwoorden voor categorisatie (lowercase, snake_case)

WAT WIL IK NIET ZIEN
- Geen narratief / artikel
- Geen mening van jou
- Geen synthese over meerdere bronnen
- Geen "in deze snelveranderende wereld"-clichés
- Geen samenvattingen die je niet expliciet gevraagd is
- Geen verzonnen URLs of bronnen — als je niet kunt verifiëren, neem het niet op

KWALITEIT
- Bronnen moeten primair of dichtbij-primair zijn (persberichten, officiële blogs, gevestigde publicaties — niet aggregator-sites die alleen herhalen)
- Voorkeur voor laatste 30 dagen, maar relevante oudere stukken (≤6 maanden) zijn OK als ze onderbouwen
- Engelse bronnen zijn OK; voor NL-context geef Nederlandstalige bronnen voorrang

TRACK
- "advocatuur" = focus op advocatenkantoren (Big Law t/m mid-market), spelers Harvey, Clio, Spellbook, Lexis+ AI, Robin AI, Legora, etc.
- "bedrijfsleven" = focus op MKB / in-house counsel / legal ops, spelers Ironclad, LinkSquares, Juro, ContractPodAi, etc.

OUTPUT FORMAT
Lever ÉÉN JSON-object terug, exact deze shape (geen extra velden, geen markdown-fences):
{
  "findings": [
    {
      "title": "...",
      "summary": "...",
      "source_url": "https://...",
      "source_title": "...",
      "published_at": "2026-04-28",
      "key_quote": "...",
      "tags": ["harvey", "am_law_100"]
    }
  ]
}

Aim voor 8-12 hoogwaardige findings. Liever 8 sterke dan 15 middelmatige.`;

function buildUserPrompt(body: RequestBody): string {
  const lines: string[] = [];
  lines.push(`Track: ${body.track}`);
  lines.push("");
  lines.push("Onderzoeksvraag voor vandaag (van Claude):");
  lines.push(body.focus_brief);
  if (body.topics_in_scope && body.topics_in_scope.length > 0) {
    lines.push("");
    lines.push(`Topics binnen scope: ${body.topics_in_scope.join(", ")}.`);
  }
  lines.push("");
  lines.push(`Lever max ${body.max_findings ?? 12} findings. Output ALLEEN het JSON-object (geen prefix, geen suffix, geen markdown-fences).`);
  return lines.join("\n");
}

interface GrokResponsesAPI {
  id: string;
  model: string;
  status?: string;
  output: Array<{
    type: string;             // "web_search_call" | "message"
    role?: string;            // "assistant" voor message-items
    content?: Array<{ type: string; text?: string }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    num_sources_used?: number;
    num_server_side_tools_used?: number;
  };
  error?: unknown;
}

async function callGrok(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  opts: { model: string; searchMode: string; maxSearchResults: number },
  timeoutMs: number,
): Promise<GrokResponsesAPI> {
  // searchMode 'on'/'auto' → tool actief; 'off' → tools array leeg.
  // Voor research-mode forceren we 'required' tool_choice — anders hallucineert Grok
  // findings uit zijn eigen knowledge ipv echt te searchen.
  const tools = opts.searchMode === "off" ? [] : [{ type: "web_search" }];
  const body: Record<string, unknown> = {
    model: opts.model,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    tools,
    text: { format: { type: "json_object" } },
  };
  if (opts.searchMode !== "off") {
    body.tool_choice = "required";
  }

  // Eén retry op 503 (model at capacity) — dat is een transient xAI-conditie,
  // niet een permanente fout. Tweede poging na korte delay redt veel runs.
  let res: Response;
  let text = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      res = await fetch(GROK_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof Error && e.name === "AbortError") throw new Error("grok_timeout");
      throw e;
    }
    clearTimeout(timer);
    text = await res.text();
    if (res.ok) break;
    if (res.status === 503 && attempt === 0) {
      await new Promise((r) => setTimeout(r, RETRY_ON_503_DELAY_MS));
      continue;
    }
    throw new Error(`grok_http_${res.status}: ${text.slice(0, 400)}`);
  }
  if (!res!.ok) throw new Error(`grok_http_${res!.status}: ${text.slice(0, 400)}`);
  try {
    return JSON.parse(text) as GrokResponsesAPI;
  } catch {
    throw new Error(`grok_non_json_response: ${text.slice(0, 200)}`);
  }
}

// Extract de assistant-text uit de Responses API output[] array.
function extractAssistantText(resp: GrokResponsesAPI): string {
  const parts: string[] = [];
  for (const item of resp.output || []) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const c of item.content) {
        if (c.type === "output_text" && typeof c.text === "string") {
          parts.push(c.text);
        }
      }
    }
  }
  return parts.join("\n").trim();
}

function countToolCalls(resp: GrokResponsesAPI): number {
  return (resp.output || []).filter((o) => o.type === "web_search_call").length;
}

interface Finding {
  title: string;
  summary: string;
  source_url: string;
  source_title?: string;
  published_at?: string | null;
  key_quote?: string | null;
  tags?: string[];
}

function parseFindings(content: string): Finding[] {
  let cleaned = content.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  const parsed = JSON.parse(cleaned) as { findings?: Finding[] };
  if (!Array.isArray(parsed.findings)) {
    throw new Error("grok_parse_error: findings array missing");
  }
  return parsed.findings
    .filter(f => f && typeof f.title === "string" && typeof f.summary === "string" && typeof f.source_url === "string")
    .map(f => ({
      title: String(f.title).slice(0, 240),
      summary: String(f.summary).slice(0, 1200),
      source_url: String(f.source_url),
      source_title: f.source_title ? String(f.source_title).slice(0, 240) : undefined,
      published_at: f.published_at ? String(f.published_at).slice(0, 10) : null,
      key_quote: f.key_quote ? String(f.key_quote).slice(0, 400) : null,
      tags: Array.isArray(f.tags) ? f.tags.map(String).slice(0, 5) : [],
    }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type, x-trigger-source",
      },
    });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const presentedToken = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const cronSecret = (await getCfg(supabase, "global", "cron_secret")) || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!presentedToken || (presentedToken !== cronSecret && presentedToken !== serviceKey)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const startedAt = Date.now();
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json_body" }), { status: 400 });
  }
  if (!body.track || !["advocatuur", "bedrijfsleven"].includes(body.track)) {
    return new Response(JSON.stringify({ error: "invalid_track" }), { status: 400 });
  }
  if (!body.focus_brief || body.focus_brief.length < 10) {
    return new Response(JSON.stringify({ error: "focus_brief_too_short" }), { status: 400 });
  }

  const apiKey = await getCfg(supabase, "legal-ai-research", "grok_api_key");
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: "grok_api_key_missing",
        hint: "Run migrations/_grok_secret_seed_2026_05_02.sql om de key in Vault te zetten.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  const userPrompt = buildUserPrompt(body);
  const model = body.model || DEFAULT_MODEL;
  const searchMode = body.search_mode || "on";
  const maxSearchResults = Math.max(5, Math.min(50, body.max_search_results ?? 30));

  let grokResp: GrokResponsesAPI;
  try {
    grokResp = await callGrok(apiKey, SYSTEM_PROMPT, userPrompt, { model, searchMode, maxSearchResults }, DEFAULT_TIMEOUT_MS);
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)) || "grok_unknown_error";
    const status = msg === "grok_timeout" ? 504 : msg.startsWith("grok_http_") ? 502 : 500;
    return new Response(
      JSON.stringify({ ok: false, error: msg, fn_version: FN_VERSION }),
      { status, headers: { "Content-Type": "application/json" } },
    );
  }

  const text = extractAssistantText(grokResp);
  if (!text) {
    return new Response(
      JSON.stringify({ ok: false, error: "grok_empty_output", fn_version: FN_VERSION }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  let findings: Finding[];
  try {
    findings = parseFindings(text);
  } catch (e) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: e instanceof Error ? e.message : "parse_error",
        raw_content: text.slice(0, 800),
        fn_version: FN_VERSION,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const durationMs = Date.now() - startedAt;
  return new Response(
    JSON.stringify({
      ok: true,
      fn_version: FN_VERSION,
      findings,
      usage: {
        tokens_in: grokResp.usage?.input_tokens ?? null,
        tokens_out: grokResp.usage?.output_tokens ?? null,
        search_results_count: grokResp.usage?.num_sources_used ?? null,
        tool_calls: countToolCalls(grokResp),
        duration_ms: durationMs,
        model: grokResp.model || model,
        status: grokResp.status,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
