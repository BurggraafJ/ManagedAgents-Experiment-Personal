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
const MAX_TOOL_CALLS = 10;
const LOOP_BUDGET_MS = 150_000;
const CALL_TIMEOUT_MS = 60_000;
const MAX_EVIDENCE_ROWS = 60;
const MAX_TOOL_RESULT_CHARS = 7_000;
const COST_CAP_USD = 0.50;
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
        name: "semantic_search",
        description: "Semantisch zoeken in de volledige kennisindex (mail, meetings, notities, Jira — vector + keywords). Gebruik voor open/thematische deelvragen tijdens je onderzoek: 'speelt prijsdruk nu bij actieve klanten?', 'wat is er recent gezegd over X'. Geeft de meest relevante fragmenten met bron en datum.",
        parameters: { type: "object", properties: { query: { type: "string", description: "declaratieve NL-zoekzin (geen vraagteken nodig)" } }, required: ["query"] },
      },
    },
    {
      type: "function",
      function: {
        name: "customer_timeline",
        description: "Volledige recente tijdlijn van één klant/bedrijf op naam (fuzzy): laatste mailthreads, HubSpot-notities en churn-status. Gebruik om per klant de diepte in te gaan ('wat speelde er bij Beer Advocaten', 'is dit bezwaar daar nog actueel').",
        parameters: { type: "object", properties: { name: { type: "string", description: "bedrijfsnaam (informeel mag)" } }, required: ["name"] },
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
async function execTool(supabase: any, name: string, args: any, ctx?: { cronSecret?: string | null }): Promise<{ rows: any[]; scanned: number | null; error?: string }> {
  const d = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
  try {
    // v3: semantische zoektool — de agent kan zelf de kennisindex bevragen
    // (zelfde context-build als het semantic-pad, compacte fragmenten terug).
    if (name === "semantic_search") {
      const q = String(args.query || "").trim().slice(0, 300);
      if (!q) return { rows: [], scanned: null, error: "query verplicht" };
      if (!ctx?.cronSecret) return { rows: [], scanned: null, error: "semantic_search niet beschikbaar (geen cron_secret)" };
      const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/context-build`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${ctx.cronSecret}` },
        body: JSON.stringify({ intent: "search", audience: "rag-agent", trigger_type: "chat", trigger_id: null, query_text: q, options: { top_k: 8, min_similarity: 0.30 } }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return { rows: [], scanned: null, error: `context-build_${res.status}` };
      const j = await res.json().catch(() => ({}));
      const matches: any[] = Array.isArray(j.matches) ? j.matches : [];
      return {
        rows: matches.slice(0, 8).map((m: any) => ({
          source: m.source, occurred_at: m.occurred_at ? String(m.occurred_at).slice(0, 10) : null,
          subject: m.subject || null, snippet: String(m.preview || m.content || "").replace(/\s+/g, " ").slice(0, 300),
        })),
        scanned: null,
      };
    }
    // v3: klant-tijdlijn — fuzzy resolve + laatste mails/notities + churn-status.
    if (name === "customer_timeline") {
      const nm = String(args.name || "").trim().slice(0, 120);
      if (!nm) return { rows: [], scanned: null, error: "name verplicht" };
      const { data: hit } = await supabase.rpc("rag_resolve_entity", { p_query: nm });
      const ent = Array.isArray(hit) && hit.length > 0 ? hit[0] : null;
      if (!ent?.entity_id || ent.entity_type !== "company") return { rows: [], scanned: null, error: `geen bedrijf gevonden voor "${nm}"` };
      const [mails, notes, churn] = await Promise.all([
        supabase.rpc("get_company_mails", { p_hubspot_company_id: ent.entity_id, p_exclude_conversation_id: null }),
        supabase.rpc("get_company_notes", { p_hubspot_company_id: ent.entity_id, p_lookback_days: 365 }),
        supabase.from("churn_customers").select("company_name, churned_at, new_provider, churn_summary").eq("company_id", String(ent.entity_id)).eq("superseded", false).limit(1).maybeSingle(),
      ]);
      const rows: any[] = [];
      if (churn.data) rows.push({ type: "churn_status", company: ent.name, churned_at: churn.data.churned_at ? String(churn.data.churned_at).slice(0, 10) : "onbekend", new_provider: churn.data.new_provider, reden: String(churn.data.churn_summary || "").slice(0, 300) });
      for (const r of (mails.data || []).slice(0, 8)) rows.push({ type: "mail", company: ent.name, date: r.thread_latest_at ? String(r.thread_latest_at).slice(0, 10) : null, subject: r.latest_subject, snippet: String(r.latest_body_preview || "").replace(/\s+/g, " ").slice(0, 220) });
      for (const r of (notes.data || []).slice(0, 5)) rows.push({ type: "note", company: ent.name, date: r.hs_timestamp ? String(r.hs_timestamp).slice(0, 10) : null, snippet: String(r.body_text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 220) });
      return { rows, scanned: null };
    }
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
  semantic_search: "Kennisindex semantisch doorzocht",
  customer_timeline: "Klant-tijdlijn opgehaald",
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
    else if (name === "semantic_search") out.push({ bron: r.source || "index", datum: r.occurred_at, naam: r.subject || "?", detail: String(r.snippet || "").slice(0, 160) });
    else if (name === "customer_timeline") out.push({ bron: `tijdlijn-${r.type || "?"}`, datum: r.date || r.churned_at || null, naam: r.company || "?", detail: String(r.reden || r.snippet || r.subject || "").slice(0, 160) });
    else out.push({ bron: "hubspot", datum: r.churned_at || r.startdatum || r.last_mail_at || null, naam: r.company_name || r.dealname || r.stage_label || "?", detail: JSON.stringify(r).slice(0, 160) });
  }
  return out;
}

// ─── De loop ─────────────────────────────────────────────────────────────────
export async function runAgentic(supabase: any, openaiKey: string, message: string, dbg: any, model?: string | null, history: any[] = [], onStep?: (label: string, detail?: string, stage?: string) => void, cronSecret?: string | null): Promise<any | null> {
  const t0 = Date.now();
  const agentModel = model && PRICE_PER_M[model] ? model : DEFAULT_AGENT_MODEL;
  const price = PRICE_PER_M[agentModel] || PRICE_PER_M[DEFAULT_AGENT_MODEL];
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const weekday = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"][now.getUTCDay()];
  // v3 (ReAct): de agent denkt HARDOP — elke tool-beurt begint met 1-2 zinnen
  // gewone taal in message.content ("Gevonden: X. Nu check ik Y omdat…").
  // Die gedachten worden live als 💭-stap aan Jelle getoond.
  const system = `Je bent de onderzoeks-agent van Legal Mind's interne vragenbak. VANDAAG is ${today} (${weekday}).
Legal Mind verkoopt een AI-platform aan advocatenkantoren. Je hebt read-only tools op de interne data: HubSpot-mirror (deals/klanten/fases/licenties), churn-administratie, mailarchief-signalen, semantische kennisindex (mail/meetings/notities), klant-tijdlijnen, Outlook-agenda (afspraken + externe deelnemers) en HubSpot-notities/meetings.

WERKWIJZE — denk HARDOP (dit ziet Jelle live):
1. Schrijf bij ELKE beurt waarin je tools aanroept éérst 1-2 korte zinnen gewone taal in je bericht-content: wat je tot nu toe hebt geleerd en wat je NU gaat doen en waarom. Voorbeeld: "De april-churns zijn binnen: Beer (prijs) en Habraken (pilot niet gebruikt). Nu doorzoek ik het recente mailarchief om te zien of prijsdruk nog speelt." Kort, concreet, geen opsomming van tool-namen.
2. Werk in stappen: eerst het feitelijke skelet (exacte tools), dan de diepte (semantic_search voor thema's, customer_timeline om per klant door te vragen). Vergelijk, zoek tegenbewijs, en kom terug op eerdere bevindingen als nieuwe data ze nuanceert.
3. Relatieve tijd: "afgelopen/vorige maand" = de vorige kalendermaand; "deze maand" = huidige kalendermaand t/m vandaag; "afgelopen week" = laatste 7 dagen. Reken zelf from/to uit vanaf VANDAAG.
4. Brede regexen met synoniemen (bv. 'training|prompttraining|workshop|opleiding'). Maximaal ${MAX_TOOL_CALLS} tool-calls — besteed ze slim: liever 2 gerichte vervolgstappen dan 5 brede herhalingen.
5. Eerlijkheid boven volledigheid: rapporteer alleen wat de tools teruggeven, met bron + datum. Geen resultaten = zeg dat expliciet. Onderscheid gepland/besproken versus daadwerkelijk gebeurd; interne events zonder externe deelnemers zijn meestal geen klant-activiteit.

EINDANTWOORD (gewone tekst, geen tool-call): beknopte NL-conclusie met per bevinding de bron (agenda/notitie/mail/hubspot/index) en datum, plus één dekkingszin: welke bronnen en datumvensters je hebt doorzocht en wat je NIET hebt kunnen checken.`;

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
      // ReAct: hardop-denken vóór de tool-calls → live 💭-stap voor Jelle.
      const thought = String(msg.content || "").replace(/\s+/g, " ").trim();
      if (thought) { onStep?.(thought.slice(0, 220), undefined, "think"); trace.push({ thought: thought.slice(0, 400) }); }
      messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: calls });
      const capped = calls.slice(0, Math.max(1, MAX_TOOL_CALLS - toolCalls));
      const results = await Promise.all(capped.map(async (c) => {
        let args: any = {};
        try { args = JSON.parse(c.function?.arguments || "{}"); } catch { /* leeg */ }
        const tExec = Date.now();
        const res = await execTool(supabase, c.function?.name || "", args, { cronSecret });
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
  const usedTools = [...new Set(trace.map((s) => s.tool).filter(Boolean))].join(", ");
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
