// grok-legal-ai-write v1 (split-architectuur 2026-05-02)
//
// **Writing-only.** Schrijft een Legal AI thought-leadership artikel op basis
// van findings die al in de DB staan + Jelle's brief/visie/leeskeuzes.
//
// Wordt typisch wekelijks (zaterdagochtend) of on-demand getriggerd —
// niet dagelijks. Skill `legal-ai-write` orchestreert.
//
// Architectuur:
//   - Skill verzamelt context: relevante findings, actieve theses, custom instructions
//   - Skill ontvangt Jelle's brief (focus, sentiment, anchor-bronnen die hij wil aanhalen)
//   - Edge Function roept Grok aan met die context als input
//   - Grok schrijft artikel (geen of minimal extra search)
//   - Output: artikel + suggested_thesis_updates
//
// Secrets-storage:
//   - legal-ai-research.grok_api_key   xAI Grok API key (Vault, gedeeld)
//   - global.cron_secret               Auth voor inkomende calls
//
// Endpoint: POST /functions/v1/grok-legal-ai-write
// Body:
//   {
//     "track": "advocatuur" | "bedrijfsleven" | "combined",
//     "claude_brief": "... Jelle wil deze week schrijven over X met sentiment Y ...",
//     "context_findings": [
//       { "title": "...", "summary": "...", "source_url": "...", "published_at": "..." }
//     ],
//     "context_theses": [
//       { "thesis_id": 1, "statement": "...", "confidence": 0.7,
//         "evidence_count": 3, "counter_evidence_count": 1 }
//     ],
//     "anchor_urls": ["https://..."], // bronnen die Jelle expliciet behandeld wil zien
//     "jelles_notes": "... wat Jelle deze week heeft gedacht/gelezen ...",
//     "custom_instructions": "...",
//     "min_words": 500,
//     "max_words": 900,
//     "model": "grok-4",
//     "search_mode": "auto" | "off" | "on", // default 'auto' — Grok mag verifyen
//     "tone": "analytisch" | "provocerend" | "uitnodigend"
//   }
//
// Response:
//   {
//     ok: true,
//     article: { title, tldr[], body_md, reading_time_min, sections },
//     suggested_thesis_updates: [...],
//     usage: { tokens_in, tokens_out, search_results_count, duration_ms, model }
//   }
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { matchesAnySecret } from "../_shared/edge-auth.ts";

const FN_VERSION = "grok-legal-ai-write-v3-linkedin-mode";
// xAI deprecated chat/completions+search_parameters in mei 2026.
// We gebruiken nu de Responses API: /v1/responses met tools:[{type:"web_search"}].
const GROK_ENDPOINT = "https://api.x.ai/v1/responses";
const DEFAULT_MODEL = "grok-4-0709";
const DEFAULT_TIMEOUT_MS = 180_000;

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

interface ContextFinding {
  title: string;
  summary: string;
  source_url: string;
  source_title?: string;
  published_at?: string | null;
  key_quote?: string | null;
}

interface ContextThesis {
  thesis_id: number;
  statement: string;
  confidence: number;
  evidence_count: number;
  counter_evidence_count: number;
}

interface RequestBody {
  track: "advocatuur" | "bedrijfsleven" | "combined";
  claude_brief: string;
  context_findings?: ContextFinding[];
  context_theses?: ContextThesis[];
  anchor_urls?: string[];
  jelles_notes?: string;
  custom_instructions?: string;
  min_words?: number;
  max_words?: number;
  model?: string;
  search_mode?: "auto" | "off" | "on";
  tone?: "analytisch" | "provocerend" | "uitnodigend";
  mode?: "article" | "linkedin"; // v3: signaleert LinkedIn-shape ipv lang artikel
}

const LINKEDIN_PROMPT = `Je schrijft een LinkedIn-post voor Jelle Burggraaf, oprichter van Legal Mind.

JE TAAK
- Kort, scherp, in Jelle's analyst-stem.
- ${"${MIN_WORDS}"}–${"${MAX_WORDS}"} woorden.
- Toon: ${"${TONE}"}.
- Eerste regel = haak (vraag, contraire claim, of cijfer met verrassende implicatie).
- Geen hashtags toevoegen (Jelle plakt zijn eigen set).
- Geen emoji-spam (max 1 emoji als die echt iets toevoegt).
- Slot: open vraag of concrete take-away — niet "wat denk jij?" als generieke filler.
- Verwerk de meegegeven artikel-context als ruggengraat. Geen verzonnen feiten.

OUTPUT FORMAT
Lever ÉÉN JSON-object terug, exact deze shape (geen markdown-fences):
{
  "title": "<intern label, max 80 chars — niet zichtbaar in post>",
  "tldr": ["<de haak (eerste regel van de post)>"],
  "body_md": "<de complete LinkedIn-post body, regelafbrekingen behouden>",
  "reading_time_min": 1,
  "sections": {},
  "suggested_thesis_updates": []
}`;

const SYSTEM_PROMPT_BASE = `Je bent de thought-leadership-engine voor Legal Mind, het bedrijf van Jelle Burggraaf in Nederland. Legal Mind bouwt een AI-control-laag voor de juridische markt en positioneert zich tussen pure praktijk-management-software (Clio, Tikit) en pure AI-tools (Harvey, Spellbook).

JE TAAK
Schrijf één leesbaar Nederlandstalig thought-leadership-artikel op basis van:
- de meegegeven findings (jouw primaire bron — de research-fase is al gedaan),
- Jelle's brief (zijn focus voor deze week + sentiment/visie),
- zijn actieve stellingen (visie nu, met evidence/counter-evidence-counters),
- eventuele anchor-URLs die hij expliciet behandeld wil zien,
- zijn losse notities van deze week.

JE MAG search-tools gebruiken om feiten te verifiëren of context aan te vullen — maar de meegegeven findings zijn de ruggengraat. Verzin geen bronnen.

STIJL
- Nederlands, helder, niet-generiek. Geen "in deze snelveranderende wereld"-clichés.
- Tussen ${"${MIN_WORDS}"} en ${"${MAX_WORDS}"} woorden body (zonder TLDR).
- Toon: ${"${TONE}"}.
- Vier secties verplicht in body_md (markdown):
  1. **Wat er gebeurde** (2-3 paragraphs) — wat is er deze week relevant veranderd?
  2. **Waarom het ertoe doet** (1-2 paragraphs) — implicaties, uitvergroting van één punt.
  3. **Tegengeluid** — vereist als context_theses aanwezig is. Quote findings die de stellingen ondermijnen of nuanceren. Bij geen tegengeluid in context: schrijf letterlijk "Geen tegengeluid deze week — verdacht? Alle findings bevestigen huidige stellingen. Mogelijk een blind spot."
  4. **Wat Jelle hieruit haalt** — concrete implicaties voor Legal Mind's positie + persoonlijke leiderschap (change management).

BIAS-GUARDS
- Schrijf NIET vanuit Jelle's mond. Schrijf als analist die hem informeert.
- Bij tegenstrijdige findings: noem beide kanten; oordeel pas nadat beide gewogen zijn.
- Suggested_thesis_updates moeten KORT en SPECIFIEK zijn — niet "denk eens over X" maar "Stelling 'X' confidence aanpassen van 0.7 naar 0.5 — reden: Y".

OUTPUT FORMAT
Lever ÉÉN JSON-object terug, exact deze shape (geen extra velden, geen markdown-fences):
{
  "title": "<korte koppakkende titel, max 80 chars>",
  "tldr": ["<bullet 1>", "<bullet 2>", "<bullet 3>"],
  "body_md": "<markdown body met de 4 secties>",
  "reading_time_min": <int>,
  "sections": {
    "wat_er_gebeurde": [<finding-indices uit context_findings die je gebruikte>],
    "waarom_het_ertoe_doet": [<indices>],
    "tegengeluid": [<indices>],
    "voor_jelle": [<indices>]
  },
  "suggested_thesis_updates": [
    { "thesis_id": <int>, "proposed_confidence": <0..1>, "reason": "<1 zin>" }
  ]
}`;

function buildUserPrompt(body: RequestBody): string {
  const lines: string[] = [];
  lines.push(`Track: ${body.track}`);
  lines.push("");
  lines.push("BRIEF VAN CLAUDE / JELLE (de richting deze week):");
  lines.push(body.claude_brief);

  if (body.jelles_notes) {
    lines.push("");
    lines.push("Jelle's notities deze week (wat hij gelezen/gedacht heeft):");
    lines.push(body.jelles_notes);
  }

  if (body.context_findings && body.context_findings.length > 0) {
    lines.push("");
    lines.push("CONTEXT FINDINGS (jouw primaire bron — gebruik deze):");
    body.context_findings.forEach((f, i) => {
      lines.push(`[${i}] ${f.title}`);
      lines.push(`    ${f.summary}`);
      lines.push(`    Bron: ${f.source_url} (${f.source_title || "—"}${f.published_at ? `, ${f.published_at}` : ""})`);
      if (f.key_quote) lines.push(`    Quote: "${f.key_quote}"`);
    });
  } else {
    lines.push("");
    lines.push("CONTEXT FINDINGS: geen meegegeven — doe zelf web-search via tools om bronnen te vinden.");
  }

  if (body.anchor_urls && body.anchor_urls.length > 0) {
    lines.push("");
    lines.push("ANCHOR URLS (Jelle wil deze expliciet behandeld zien):");
    body.anchor_urls.forEach(u => lines.push(`- ${u}`));
  }

  if (body.context_theses && body.context_theses.length > 0) {
    lines.push("");
    lines.push("JELLE'S ACTIEVE STELLINGEN (visie nu):");
    for (const t of body.context_theses) {
      lines.push(`- [#${t.thesis_id} | conf ${t.confidence} | +${t.evidence_count}/-${t.counter_evidence_count}] ${t.statement}`);
    }
  } else {
    lines.push("");
    lines.push("JELLE'S STELLINGEN: nog geen actieve. suggested_thesis_updates blijft [].");
  }

  if (body.custom_instructions) {
    lines.push("");
    lines.push("Custom instructions van Jelle:");
    lines.push(body.custom_instructions);
  }

  lines.push("");
  lines.push("Schrijf nu het artikel. Output ALLEEN het JSON-object (geen prefix, geen suffix, geen markdown-fences).");
  return lines.join("\n");
}

interface GrokResponsesAPI {
  id: string;
  model: string;
  status?: string;
  output: Array<{
    type: string;
    role?: string;
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
  const tools = opts.searchMode === "off" ? [] : [{ type: "web_search" }];
  const body = {
    model: opts.model,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    tools,
    text: { format: { type: "json_object" } },
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
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
  const text = await res.text();
  if (!res.ok) throw new Error(`grok_http_${res.status}: ${text.slice(0, 400)}`);
  try {
    return JSON.parse(text) as GrokResponsesAPI;
  } catch {
    throw new Error(`grok_non_json_response: ${text.slice(0, 200)}`);
  }
}

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

interface ParsedArticle {
  title: string;
  tldr: string[];
  body_md: string;
  reading_time_min: number;
  sections: Record<string, number[]>;
  suggested_thesis_updates: { thesis_id: number; proposed_confidence: number; reason: string }[];
}

function parseArticle(content: string): ParsedArticle {
  let cleaned = content.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }
  const parsed = JSON.parse(cleaned) as Partial<ParsedArticle>;
  if (!parsed.title || !parsed.body_md) {
    throw new Error("grok_parse_error: missing title or body_md");
  }
  return {
    title: String(parsed.title).slice(0, 160),
    tldr: Array.isArray(parsed.tldr) ? parsed.tldr.slice(0, 5).map(String) : [],
    body_md: String(parsed.body_md),
    reading_time_min: Number.isFinite(parsed.reading_time_min) ? Number(parsed.reading_time_min) : 4,
    sections: parsed.sections && typeof parsed.sections === "object" ? parsed.sections : {},
    suggested_thesis_updates: Array.isArray(parsed.suggested_thesis_updates) ? parsed.suggested_thesis_updates : [],
  };
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
  if (!presentedToken || !matchesAnySecret(presentedToken, [cronSecret, serviceKey])) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  const startedAt = Date.now();
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json_body" }), { status: 400 });
  }
  if (!body.track || !["advocatuur", "bedrijfsleven", "combined"].includes(body.track)) {
    return new Response(JSON.stringify({ error: "invalid_track" }), { status: 400 });
  }
  if (!body.claude_brief || body.claude_brief.length < 10) {
    return new Response(JSON.stringify({ error: "claude_brief_too_short" }), { status: 400 });
  }

  const apiKey = await getCfg(supabase, "legal-ai-research", "grok_api_key");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "grok_api_key_missing" }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  const mode = body.mode || "article";
  const isLinkedIn = mode === "linkedin";
  const minWords = isLinkedIn
    ? Math.max(60, Math.min(400, body.min_words ?? 100))
    : Math.max(200, Math.min(2500, body.min_words ?? 500));
  const maxWords = isLinkedIn
    ? Math.max(minWords + 50, Math.min(500, body.max_words ?? 250))
    : Math.max(minWords + 100, Math.min(3000, body.max_words ?? 900));
  const tone = body.tone || "analytisch";
  const promptTemplate = isLinkedIn ? LINKEDIN_PROMPT : SYSTEM_PROMPT_BASE;
  const systemPrompt = promptTemplate
    .replace("${MIN_WORDS}", String(minWords))
    .replace("${MAX_WORDS}", String(maxWords))
    .replace("${TONE}", tone);
  const userPrompt = buildUserPrompt(body);
  const model = body.model || DEFAULT_MODEL;
  const searchMode = body.search_mode || "auto";

  let grokResp: GrokResponsesAPI;
  try {
    grokResp = await callGrok(apiKey, systemPrompt, userPrompt, { model, searchMode, maxSearchResults: 15 }, DEFAULT_TIMEOUT_MS);
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

  let article: ParsedArticle;
  try {
    article = parseArticle(text);
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
      article: {
        title: article.title,
        tldr: article.tldr,
        body_md: article.body_md,
        reading_time_min: article.reading_time_min,
        sections: article.sections,
      },
      suggested_thesis_updates: article.suggested_thesis_updates,
      usage: {
        tokens_in: grokResp.usage?.input_tokens ?? null,
        tokens_out: grokResp.usage?.output_tokens ?? null,
        search_results_count: grokResp.usage?.num_sources_used ?? 0,
        tool_calls: countToolCalls(grokResp),
        duration_ms: durationMs,
        model: grokResp.model || model,
        status: grokResp.status,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
