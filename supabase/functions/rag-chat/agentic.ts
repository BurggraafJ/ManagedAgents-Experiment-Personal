// =============================================================================
// rag-chat/agentic.ts — Vragenbak v2: agentic tool-use-route (2026-07-07)
// =============================================================================
// Native OpenAI function-calling-loop, GEEN framework (datascience §14: alles
// in Supabase tot bewezen nodig). De router kiest 'agentic' voor multi-bron/
// meerstaps datavragen (bv. "welke trainingen zijn vorige maand gegeven bij
// welke klanten" = agenda + notities + mail). De loop:
//   vraag → model kiest tool(s) → resultaten terug → model beslist door of
//   klaar → eindconclusie. Guards: MAX_TOOL_CALLS, wall-clock-budget en
//   cost-cap; alles onder de PostgREST 8s-limiet per RPC-call.
// Toolbox = Motor A-catalogus + analytics_calendar_search +
// analytics_notes_search + mail-evidence (analytics_sweep_evidence-voorfilter,
// het model velt zelf het verdict over de snippets).
// Model: agent_config rag-chat/agentic_model (default gpt-5.5) — gekozen op
// live tool-use-probe 2026-07-07; grok-4.3 kan ook function-calling maar de
// OpenAI-key is het bestaande router/sweep-pad.
// Output-contract = zelfde analytics-blok als Motor A/B (route, rows, claim,
// scanned_n, cost) + agent_conclusion + tools_used (trace, ook voor de
// query-log). Grok formuleert het eindantwoord (consistent stream/stijl).
// =============================================================================

import { TOOL_CATALOG, sanitizeKeywordsToRegex, historyBlock } from "./analytics.ts";

const OPENAI_CHAT = "https://api.openai.com/v1/chat/completions";
const DEFAULT_AGENT_MODEL = "gpt-5.5";
const MAX_TOOL_CALLS = 6;
const LOOP_BUDGET_MS = 100_000;
const CALL_TIMEOUT_MS = 60_000;
const MAX_EVIDENCE_ROWS = 60;
const MAX_TOOL_RESULT_CHARS = 7_000;
const COST_CAP_USD = 0.30;
// Indicatieve prijzen per 1M tokens voor cost-meta (schatting).
const PRICE_PER_M: Record<string, { in: number; out: number }> = {
  "gpt-5.5": { in: 1.25, out: 10 },
  "gpt-5.4-mini": { in: 0.15, out: 0.60 },
};

// ─── Toolbox-schema's (OpenAI function-calling) ──────────────────────────────
function toolSchemas(): any[] {
  const dateProps = {
    from: { type: "string", description: "YYYY-MM-DD (begin venster, inclusief)" },
    to: { type: "string", description: "YYYY-MM-DD (einde venster, exclusief); weglaten = t/m vandaag" },
  };
  const motorA = TOOL_CATALOG.filter((t) => t.rpc).map((t) => {
    let properties: Record<string, unknown> = {};
    let required: string[] = [];
    if (t.name === "churned_in_window") { properties = { ...dateProps, include_undated: { type: "boolean" } }; required = ["from"]; }
    else if (t.name === "started_in_window") { properties = { ...dateProps }; required = ["from"]; }
    else if (t.name === "uncontacted_since") properties = { days: { type: "integer" } };
    else if (t.name === "count_by_stage") properties = { pipeline: { type: "string" } };
    else if (t.name === "deals_over_amount") properties = { min: { type: "number" } };
    else if (t.name === "customers_by_price") { properties = { price: { type: "number" } }; required = ["price"]; }
    return { type: "function", function: { name: t.name, description: t.desc, parameters: { type: "object", properties, required } } };
  });
  return [
    ...motorA,
    {
      type: "function",
      function: {
        name: "calendar_search",
        description: "Doorzoek de Outlook-agenda op keyword-regex (case-insensitive, over onderwerp + omschrijving). Geeft per event de datum, locatie en EXTERNE deelnemers. external_only=true (default) filtert op events met externe deelnemers — gebruik dat voor klant-activiteiten; interne events (demovideo's, strategie) tellen niet als klant-activiteit.",
        parameters: { type: "object", properties: { keywords_regex: { type: "string", description: "bv. 'training|prompttraining|workshop|opleiding'" }, ...dateProps, external_only: { type: "boolean" } }, required: ["keywords_regex"] },
      },
    },
    {
      type: "function",
      function: {
        name: "notes_search",
        description: "Doorzoek HubSpot-notities/meetings/calls op keyword-regex, met gekoppelde bedrijven. Let op: een notitie die een onderwerp NOEMT is nog geen gebeurtenis ('geen behoefte aan training' ≠ training gegeven).",
        parameters: { type: "object", properties: { keywords_regex: { type: "string" }, ...dateProps }, required: ["keywords_regex"] },
      },
    },
    {
      type: "function",
      function: {
        name: "mail_evidence_search",
        description: "Signaal-voorfilter over het mailarchief: kandidaten + snippets die de keywords/topics raken. Jij beoordeelt zelf of de snippets echt bewijs zijn (planning/toekomst ≠ gebeurd; vendor ≠ klant). scope: sales (default) | customers | external.",
        parameters: {
          type: "object",
          properties: {
            keywords: { type: "array", items: { type: "string" }, description: "6-12 NL woorden/zinsdelen die letterlijk in mails staan" },
            topics: { type: "array", items: { type: "string" }, description: "subset uit [pricing, contract_negotiation, proposal_sent, license_agreement, renewal, onboarding, demo, feedback, support, legal_question, nda]" },
            scope: { type: "string", enum: ["sales", "customers", "external"] },
          },
          required: ["keywords"],
        },
      },
    },
  ];
}

// ─── Tool-executie (read-only RPC's, zelfde clamps als Motor A) ──────────────
async function execTool(supabase: any, name: string, args: any): Promise<{ rows: any[]; scanned: number | null; error?: string }> {
  const d = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
  try {
    let rpc = ""; let rpcArgs: Record<string, unknown> = {};
    if (name === "churned_in_window") { rpc = "analytics_churned_in_window"; rpcArgs = { p_from: d(args.from), p_to: d(args.to), p_include_undated: args.include_undated === true }; if (!rpcArgs.p_from) return { rows: [], scanned: null, error: "from (YYYY-MM-DD) verplicht" }; }
    else if (name === "started_in_window") { rpc = "analytics_started_in_window"; rpcArgs = { p_from: d(args.from), p_to: d(args.to) }; if (!rpcArgs.p_from) return { rows: [], scanned: null, error: "from (YYYY-MM-DD) verplicht" }; }
    else if (name === "uncontacted_since") { rpc = "analytics_uncontacted_since"; rpcArgs = { p_days: Math.max(1, Math.min(3650, Number(args.days) || 60)) }; }
    else if (name === "active_pilots") { rpc = "analytics_active_pilots"; }
    else if (name === "count_by_stage") { rpc = "analytics_count_by_stage"; rpcArgs = { p_pipeline_label: typeof args.pipeline === "string" && args.pipeline.trim() ? args.pipeline.trim().slice(0, 60) : null }; }
    else if (name === "deals_over_amount") { rpc = "analytics_deals_over_amount"; rpcArgs = { p_min: Math.max(0, Number(args.min) || 10000) }; }
    else if (name === "customers_by_price") { rpc = "analytics_customers_by_price"; rpcArgs = { p_price: Number(args.price) }; if (!isFinite(rpcArgs.p_price as number) || (rpcArgs.p_price as number) <= 0) return { rows: [], scanned: null, error: "price ontbreekt/ongeldig" }; }
    else if (name === "license_value") { rpc = "analytics_license_value"; }
    else if (name === "calendar_search") {
      rpc = "analytics_calendar_search";
      const re = String(args.keywords_regex || "").slice(0, 300);
      if (!re) return { rows: [], scanned: null, error: "keywords_regex verplicht" };
      rpcArgs = { p_keywords_regex: re, p_from: d(args.from), p_to: d(args.to), p_external_only: args.external_only !== false, p_limit: 40 };
    } else if (name === "notes_search") {
      rpc = "analytics_notes_search";
      const re = String(args.keywords_regex || "").slice(0, 300);
      if (!re) return { rows: [], scanned: null, error: "keywords_regex verplicht" };
      rpcArgs = { p_keywords_regex: re, p_from: d(args.from), p_to: d(args.to), p_limit: 40 };
    } else if (name === "mail_evidence_search") {
      rpc = "analytics_sweep_evidence";
      const regex = sanitizeKeywordsToRegex(Array.isArray(args.keywords) ? args.keywords : []);
      const topics = Array.isArray(args.topics) ? args.topics.filter((x: unknown) => typeof x === "string").slice(0, 6) : [];
      if (!regex && topics.length === 0) return { rows: [], scanned: null, error: "keywords of topics verplicht" };
      rpcArgs = { p_topics: topics.length > 0 ? topics : null, p_keywords_regex: regex || null, p_scope: ["sales", "customers", "external"].includes(args.scope) ? args.scope : "sales", p_max_candidates: 30, p_snippets_per: 3 };
    } else {
      return { rows: [], scanned: null, error: `onbekende tool: ${name}` };
    }
    const { data, error } = await supabase.rpc(rpc, rpcArgs);
    if (error) return { rows: [], scanned: null, error: error.message };
    const rows: any[] = Array.isArray(data) ? data : [];
    const scanned = rows.length > 0 && rows[0].scanned_total != null ? Number(rows[0].scanned_total)
      : rows.length > 0 && rows[0].population != null ? Number(rows[0].population) : null;
    return { rows: rows.map((r) => { const { scanned_total: _a, population: _b, ...rest } = r; return rest; }), scanned };
  } catch (e) {
    return { rows: [], scanned: null, error: e instanceof Error ? e.message : String(e) };
  }
}

// NL-labels voor de reasoning-steps in de UI (v2.1): per tool één leesbare
// regel — "wat heeft de agent zojuist gedaan", niet de RPC-naam.
export const TOOL_STEP_LABELS: Record<string, string> = {
  churned_in_window: "Churn-administratie geraadpleegd",
  started_in_window: "Contractstarts opgehaald uit HubSpot",
  uncontacted_since: "Stiltes in mailcontact berekend",
  active_pilots: "Lopende pilots opgehaald uit HubSpot",
  count_by_stage: "Deal-tellingen per fase opgehaald uit HubSpot",
  deals_over_amount: "Deals op bedrag gefilterd in HubSpot",
  customers_by_price: "Klanten op licentieprijs opgehaald uit HubSpot",
  license_value: "Licentiewaarde berekend uit HubSpot",
  calendar_search: "Agenda doorzocht",
  notes_search: "HubSpot-notities doorzocht",
  mail_evidence_search: "Mailarchief gescand op signalen",
};

function stepLabelFor(name: string, res: { rows: any[]; scanned: number | null; error?: string }): { label: string; detail: string } {
  const label = TOOL_STEP_LABELS[name] || `Tool ${name} uitgevoerd`;
  if (res.error) return { label, detail: `mislukt: ${res.error.slice(0, 80)}` };
  const scanned = res.scanned != null ? ` (${res.scanned} gescand)` : "";
  return { label, detail: `${res.rows.length} resultaten${scanned}` };
}

// Evidence-rijen voor het analytics-blok (uniforme kolommen voor de UI-tabel).
function evidenceRows(name: string, rows: any[]): any[] {
  const out: any[] = [];
  for (const r of rows.slice(0, 40)) {
    if (name === "calendar_search") out.push({ bron: "agenda", datum: r.event_date, naam: r.external_attendees || r.organizer || "?", detail: r.subject });
    else if (name === "notes_search") out.push({ bron: `hubspot-${r.engagement_type || "notitie"}`, datum: r.note_date, naam: r.companies || "?", detail: [r.subject, r.body_snippet].filter(Boolean).join(" — ").slice(0, 160) });
    else if (name === "mail_evidence_search") out.push({ bron: "mail", datum: r.occurred_at ? String(r.occurred_at).slice(0, 10) : null, naam: r.company_name || r.sender_key || "?", detail: String(r.snippet || "").slice(0, 160) });
    else if (name === "churned_in_window") out.push({ bron: "churn-administratie", datum: r.churned_at, naam: r.company_name, detail: `${r.new_provider ? "naar " + r.new_provider + " — " : ""}${String(r.churn_summary || "").slice(0, 140)}` });
    else if (name === "started_in_window") out.push({ bron: "hubspot", datum: r.startdatum, naam: r.company_name, detail: `gestart (${r.stage_label ?? "?"}${r.prijs_per_gebruiker ? ", €" + r.prijs_per_gebruiker + " p/gebruiker" : ""})` });
    else out.push({ bron: "hubspot", datum: r.churned_at || r.startdatum || r.last_mail_at || null, naam: r.company_name || r.dealname || r.stage_label || "?", detail: JSON.stringify(r).slice(0, 160) });
  }
  return out;
}

// ─── De loop ─────────────────────────────────────────────────────────────────
export async function runAgentic(supabase: any, openaiKey: string, message: string, dbg: any, model?: string | null, history: any[] = [], onStep?: (label: string, detail?: string) => void): Promise<any | null> {
  const t0 = Date.now();
  const agentModel = model && PRICE_PER_M[model] ? model : DEFAULT_AGENT_MODEL;
  const price = PRICE_PER_M[agentModel] || PRICE_PER_M[DEFAULT_AGENT_MODEL];
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekday = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"][now.getUTCDay()];
  const system = `Je bent de data-agent van Legal Mind's interne vragenbak. VANDAAG is ${today} (${weekday}).
Legal Mind verkoopt een AI-platform aan advocatenkantoren. Je hebt read-only tools op de interne data: HubSpot-mirror (deals/klanten/fases/licenties), churn-administratie, mailarchief-signalen, Outlook-agenda (afspraken + externe deelnemers) en HubSpot-notities/meetings.
WERKWIJZE:
1. Denk in bronnen: welke tool(s) dekken de vraag? Combineer meerdere bronnen waar dat de vraag vollediger beantwoordt (bv. trainingen = agenda + notities + mail).
2. Relatieve tijd: "afgelopen/vorige maand" = de vorige kalendermaand; "deze maand" = huidige kalendermaand t/m vandaag; "afgelopen week" = laatste 7 dagen. Reken zelf de juiste from/to uit vanaf VANDAAG.
3. Gebruik brede regexen met synoniemen (bv. 'training|prompttraining|trainingstraject|workshop|opleiding'). Maximaal ${MAX_TOOL_CALLS} tool-calls — plan zuinig.
4. Eerlijkheid boven volledigheid: rapporteer alleen wat de tools teruggeven, met bron + datum. Geen resultaten = zeg dat expliciet. Onderscheid gepland/besproken versus daadwerkelijk gebeurd/gegeven; interne events zonder externe deelnemers zijn meestal geen klant-activiteit.
EINDANTWOORD (gewone tekst, geen tool-call): beknopte NL-conclusie met per bevinding de bron (agenda/notitie/mail/hubspot) en datum, plus één dekkingszin: welke bronnen en datumvensters je hebt doorzocht en wat je NIET hebt kunnen checken.`;

  const hist = historyBlock(history);
  const messages: any[] = [
    { role: "system", content: system },
    { role: "user", content: `${hist}VRAAG: ${message.slice(0, 1000)}` },
  ];
  const tools = toolSchemas();
  const trace: any[] = [];
  const evidence: any[] = [];
  let tokIn = 0, tokOut = 0, toolCalls = 0, scannedTotal = 0;
  let conclusion = "";
  const deadline = t0 + LOOP_BUDGET_MS;

  try {
    for (let iter = 0; iter < MAX_TOOL_CALLS + 2; iter++) {
      const costSoFar = (tokIn * price.in + tokOut * price.out) / 1_000_000;
      const budgetLeft = deadline - Date.now();
      if (budgetLeft < 5_000 || costSoFar > COST_CAP_USD || toolCalls >= MAX_TOOL_CALLS) {
        messages.push({ role: "user", content: "STOP: budget bereikt. Geef nu je eindconclusie op basis van wat je hebt (met de dekkingszin en wat je niet meer kon checken)." });
      }
      const r = await fetch(OPENAI_CHAT, {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: agentModel, messages, tools, max_completion_tokens: 2000 }),
        signal: AbortSignal.timeout(Math.min(CALL_TIMEOUT_MS, Math.max(10_000, budgetLeft))),
      });
      const t = await r.text();
      if (!r.ok) throw new Error(`openai_${r.status}: ${t.slice(0, 200)}`);
      const j = JSON.parse(t);
      tokIn += j.usage?.prompt_tokens || 0;
      tokOut += j.usage?.completion_tokens || 0;
      const msg = j.choices?.[0]?.message || {};
      const calls: any[] = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];
      if (calls.length === 0) {
        conclusion = String(msg.content || "").trim();
        break;
      }
      messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: calls });
      const capped = calls.slice(0, Math.max(1, MAX_TOOL_CALLS - toolCalls));
      const results = await Promise.all(capped.map(async (c) => {
        let args: any = {};
        try { args = JSON.parse(c.function?.arguments || "{}"); } catch { /* leeg */ }
        const tExec = Date.now();
        const res = await execTool(supabase, c.function?.name || "", args);
        trace.push({ tool: c.function?.name, args, rows: res.rows.length, scanned: res.scanned, ms: Date.now() - tExec, ...(res.error ? { error: res.error } : {}) });
        const st = stepLabelFor(c.function?.name || "", res);
        onStep?.(st.label, st.detail);
        if (!res.error) {
          evidence.push(...evidenceRows(c.function?.name || "", res.rows));
          if (res.scanned != null) scannedTotal += res.scanned;
        }
        return { call: c, res };
      }));
      toolCalls += capped.length;
      for (const { call, res } of results) {
        const payload = res.error ? { error: res.error } : { rows: res.rows, scanned: res.scanned };
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(payload).slice(0, MAX_TOOL_RESULT_CHARS) });
      }
      // Tool-calls die boven de cap uitkwamen netjes afmelden (API-contract).
      for (const c of calls.slice(capped.length)) {
        messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify({ error: "tool-budget bereikt" }) });
      }
    }
  } catch (e) {
    dbg.agentic_error = e instanceof Error ? e.message : String(e);
    if (trace.length === 0) return null; // niets bruikbaars → semantic-fallback
  }

  if (!conclusion && trace.length === 0) return null;
  onStep?.("Conclusie trekken uit het verzamelde bewijs", `${evidence.length} evidence-rij(en) uit ${toolCalls} tool-call(s)`);
  const estUsd = Number(((tokIn * price.in + tokOut * price.out) / 1_000_000).toFixed(4));
  dbg.agentic_tool_calls = toolCalls;
  dbg.agentic_model = agentModel;
  const usedTools = [...new Set(trace.map((s) => s.tool))].join(", ");
  const rows = evidence.slice(0, MAX_EVIDENCE_ROWS);
  return {
    route: "agentic",
    rows,
    columns: ["bron", "datum", "naam", "detail"],
    scanned_n: scannedTotal || rows.length,
    scanned_desc: `${toolCalls} tool-call(s) over ${usedTools || "geen tools"}; ${scannedTotal || "?"} records in scope gescand`,
    claim: `Agentic beantwoord met ${toolCalls} tool-call(s) (${usedTools}); ${rows.length} evidence-rij(en).`,
    definition: `Agentic tool-loop (${agentModel}): het model kiest zelf read-only tools (HubSpot/churn/agenda/notities/mail-signalen) en trekt de conclusie; de evidence-tabel toont de ruwe tool-resultaten.`,
    agent_conclusion: conclusion || "(geen eindconclusie — zie evidence-rijen)",
    tools_used: trace,
    cost: { model: agentModel, calls: toolCalls, tokens_in: tokIn, tokens_out: tokOut, est_usd: estUsd },
    timing_ms: Date.now() - t0,
  };
}
