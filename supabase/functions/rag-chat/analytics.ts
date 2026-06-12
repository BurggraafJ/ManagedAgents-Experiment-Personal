// =============================================================================
// rag-chat/analytics.ts — Vragenbak in de breedte: router + Motor A + Motor B
// =============================================================================
// 2026-06-11, project Confluence 471302146.
// - routeGateHit: goedkope regex-gate; alleen bij hit draait de LLM-router
//   (gpt-5.4-mini). Geen gate-hit = semantic = nul extra latency voor het
//   bestaande diepte-pad.
// - classifyRoute: structured / sweep / semantic + tool/params (JSON-only).
//   Elke fout of twijfel valt terug op semantic (huidig gedrag, veilig).
// - runStructured (Motor A): afgebakende read-only analytics-RPC's, géén
//   vrije text-to-SQL. Catalogus hieronder; 'no_data' is het eerlijke pad
//   voor velden die (nog) niet bestaan (amount; licentieprijs/startdatum
//   tot de W5-mirror live is).
// - runSweep (Motor B): enrichment-voorfilter (analytics_sweep_evidence) →
//   batched gpt-5.4-mini verdicts per kandidaat → geaggregeerde tabel met
//   bron per rij + exhaustiviteits-claim. Cost-cap via kandidaten/snippet-
//   limieten; tokens + kostenschatting in analytics.cost.
// gpt-5-contract: max_completion_tokens + reasoning_effort:'none', GEEN
// temperature (gpt-5.x weigert die param).
// =============================================================================

const OPENAI_CHAT = "https://api.openai.com/v1/chat/completions";
const ROUTER_MODEL = "gpt-5.4-mini";
const SWEEP_MODEL = "gpt-5.4-mini";
const ROUTER_TIMEOUT_MS = 8_000;
const SWEEP_BATCH_SIZE = 6;
const SWEEP_MAX_CANDIDATES = 60;
const SWEEP_SNIPPETS_PER = 5;
const SWEEP_CALL_TIMEOUT_MS = 45_000;
// Indicatieve gpt-5.4-mini prijzen per 1M tokens (schatting voor cost-meta).
const MINI_USD_IN = 0.15;
const MINI_USD_OUT = 0.60;

const GATE_RE = new RegExp(
  [
    "\\balle\\b", "iedereen", "\\belke\\b", "overzicht", "lijst", "tabel", "opsomming",
    "hoeveel", "aantal", "som van", "totale", "totaal",
    "gechurnd", "churn", "opgezegd",
    "niet gesproken", "geen contact", "niet gecontacteerd", "niet gemaild",
    "gestart", "begonnen",
    "pilots", "proefperiodes",
    "deals[^.]*(groter|boven|meer dan)",
    "licentieprijs", "maandprijs",
    "wie (heeft|hebben|deed|deden|waren|zijn|liet|lieten)",
    // recency-vragen met tussenwoorden: "niet per mail gesproken", "60 dagen geen contact"
    "(niet|geen)\\s+(\\S+\\s+){0,3}(gesproken|gemaild|gehoord|contact)",
    "\\d+\\s*dagen",
  ].join("|"),
  "i",
);

export function routeGateHit(message: string): boolean {
  return GATE_RE.test(message || "");
}

// ─── Tool-catalogus (Motor A) ────────────────────────────────────────────────
// Beschrijvingen zijn de routing-instructie voor de LLM-router.
const TOOL_CATALOG = [
  {
    name: "churned_in_window",
    rpc: "analytics_churned_in_window",
    desc: "Gechurnde/opgezegde klanten in een datumvenster. Params: from (YYYY-MM-DD, verplicht), to (YYYY-MM-DD exclusief, optioneel; default vandaag), include_undated (bool; alleen true als de vraag ook klanten zonder bekende churndatum wil).",
    definition: "Churn-administratie (churn_customers, zonder superseded records); venster op churned_at.",
  },
  {
    name: "uncontacted_since",
    rpc: "analytics_uncontacted_since",
    desc: "Actieve klanten zonder mailcontact in N dagen. Params: days (int, default 60). Gebruik voor 'X dagen niet gesproken/gemaild/contact gehad'.",
    definition: "Actieve Customer Base-deals (Proeftijd/Actieve deals/Eenpitters/Self-service) met company-domein; laatste contact = nieuwste in- of uitgaande mail op domein-match.",
  },
  {
    name: "active_pilots",
    rpc: "analytics_active_pilots",
    desc: "Lopende pilots/proefperiodes (telling + lijst). Geen params.",
    definition: "Customer Base stage 'Proeftijd' plus Sales Pipeline '1-pitters in proefperiode (zonder ovk)'.",
  },
  {
    name: "count_by_stage",
    rpc: "analytics_count_by_stage",
    desc: "Telling van deals per pipeline/fase. Params: pipeline (string, optioneel substring-filter op pipeline-naam zoals 'Sales' of 'Customer Base').",
    definition: "Niet-gearchiveerde HubSpot-deals, gegroepeerd op pipeline en fase-label.",
  },
  {
    name: "deals_over_amount",
    rpc: "analytics_deals_over_amount",
    desc: "Deals met amount boven een drempel. Params: min (numeriek, default 10000). LET OP: het amount-veld wordt in HubSpot vrijwel niet bijgehouden — bij (bijna) lege uitkomst hoort het antwoord eerlijk te zeggen dat dealwaarde niet in de data wordt bijgehouden.",
    definition: "HubSpot-deals met gevuld amount-veld (veld is in de praktijk vrijwel leeg — beperkte dekking).",
  },
  {
    name: "customers_by_price",
    rpc: "analytics_customers_by_price",
    desc: "Klanten met een specifieke licentieprijs. Params: price (numeriek, bv. 175). Matcht op prijs-per-gebruiker of vaste maandprijs van lopende Customer Base-klanten.",
    definition: "Lopende Customer Base-deals (Proeftijd/Actieve deals/Eenpitters/Self-service) met licentieprijs-per-gebruiker of vaste maandprijs gelijk aan het gevraagde bedrag (HubSpot licentie-properties, W5-mirror).",
  },
  {
    name: "started_in_window",
    rpc: "analytics_started_in_window",
    desc: "Klanten gestart in een datumvenster (op contract-startdatum). Params: from (YYYY-MM-DD, verplicht), to (YYYY-MM-DD exclusief, optioneel). Telt ook klanten die later zijn gestopt (gestart blijft gestart).",
    definition: "Customer Base-deals op HubSpot-property startdatum (contractstart), ongeacht huidige fase.",
  },
  {
    name: "license_value",
    rpc: "analytics_license_value",
    desc: "Totale/maandelijkse licentiewaarde van actieve klanten (aggregatie). Geen params. Geeft per klant de maandwaarde + berekening; het antwoord telt op en noemt klanten zonder prijsdata expliciet.",
    definition: "Per lopende Customer Base-klant: vaste maandprijs, anders prijs-per-gebruiker × minimale licenties, met korting verrekend (HubSpot licentie-properties).",
  },
  {
    name: "no_data",
    rpc: null,
    desc: "Kies dit ALLEEN als de vraag exacte velden vereist die in geen enkele tool hierboven zitten (bv. dealwaarde/amount per deal — dat veld wordt niet bijgehouden). Params: reason (korte NL-uitleg welk veld ontbreekt).",
    definition: "Geen databron beschikbaar voor dit veld.",
  },
];

export type RouteDecision = {
  route: "structured" | "sweep" | "semantic";
  tool?: string;
  params?: Record<string, unknown>;
  sweep?: { scope: string; topics: string[]; keywords: string[]; criteria: string };
};

async function miniCall(openaiKey: string, prompt: string, maxTokens: number, timeoutMs: number): Promise<{ text: string; usage: any }> {
  const r = await fetch(OPENAI_CHAT, {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: ROUTER_MODEL, messages: [{ role: "user", content: prompt }], max_completion_tokens: maxTokens, reasoning_effort: "none" }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`openai_${r.status}: ${t.slice(0, 160)}`);
  const j = JSON.parse(t);
  return { text: j.choices?.[0]?.message?.content ?? "", usage: j.usage || {} };
}

function extractJson(text: string): any | null {
  const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export async function classifyRoute(openaiKey: string, message: string, dbg: any): Promise<RouteDecision> {
  const toolLines = TOOL_CATALOG.map((t) => `- ${t.name}: ${t.desc}`).join("\n");
  const prompt = `Je bent de router van Legal Mind's interne vragenbak (Legal Mind verkoopt een AI-platform aan advocatenkantoren; de data: HubSpot-deals/klanten, churn-administratie, mailarchief met metadata).

Classificeer de VRAAG in precies één route:
1. "structured" — exacte filters/tellingen/datums over gestructureerde velden. Kies ook de tool + params uit de catalogus:
${toolLines}
2. "sweep" — een VOLLEDIGE lijst van personen/bedrijven die op basis van mail-INHOUD aan een gedragscriterium voldoen (bv. "iedereen die moeilijk deed over de prijs", "wie twijfelde"). Lever dan ook:
   - scope: "sales" (klanten+prospects, default) | "customers" (alleen klanten/pilots) | "external" (alles behalve intern)
   - topics: subset uit [pricing, contract_negotiation, proposal_sent, license_agreement, renewal, onboarding, demo, feedback, support, legal_question, nda] die het criterium signaleert (mag leeg)
   - keywords: 6-12 Nederlandse woorden/zinsdelen die LETTERLIJK in zulke mails kunnen staan — denk breed: synoniemen, formele varianten en omschrijvingen. Voorbeeld bij twijfel: ["twijfel","overweging","in overweging","alternatieven","alternatieve oplossingen","vergelijken","nog geen besluit","terughoudend","meerdere partijen"]. Voorbeeld bij prijsbezwaar: ["te duur","korting","tarief","prijs","kosten","budget","stevige uitgave","duurder","goedkoper"]
   - criteria: één precieze NL-zin: wat telt als match én wat expliciet niet. Voorbeelden: bij twijfel "zelf twijfel/aarzeling uiten over de keuze of aanschaf van Legal Mind (alternatieven overwegen, nog geen besluit) — niet algemene ontevredenheid, service-feedback of verzoeken aan Legal Mind"; bij prijsbezwaar "uit zichzelf bezwaar maken tegen prijs/kosten of actief korting/lagere prijs bedingen — niet een neutrale prijsvraag en niet andermans tarieven"
3. "semantic" — al het andere: open vragen, één specifieke klant/persoon, thematische vragen ("wat zijn de zorgen over X"), samenvattingen. BIJ TWIJFEL ALTIJD "semantic".

Antwoord ALLEEN met JSON:
{"route":"structured|sweep|semantic","tool":"...","params":{...},"sweep":{"scope":"...","topics":[...],"keywords":[...],"criteria":"..."}}
(laat tool/params weg bij sweep/semantic; laat sweep weg bij structured/semantic)

VRAAG: ${message.slice(0, 500)}`;
  try {
    const t0 = Date.now();
    const { text, usage } = await miniCall(openaiKey, prompt, 500, ROUTER_TIMEOUT_MS);
    dbg.router_ms = Date.now() - t0;
    dbg.router_tokens = (usage.prompt_tokens || 0) + (usage.completion_tokens || 0);
    const j = extractJson(text);
    if (!j || typeof j.route !== "string") return { route: "semantic" };
    if (j.route === "structured" && typeof j.tool === "string" && TOOL_CATALOG.some((t) => t.name === j.tool)) {
      return { route: "structured", tool: j.tool, params: j.params || {} };
    }
    if (j.route === "sweep" && j.sweep && typeof j.sweep.criteria === "string") {
      return {
        route: "sweep",
        sweep: {
          scope: ["sales", "customers", "external"].includes(j.sweep.scope) ? j.sweep.scope : "sales",
          topics: Array.isArray(j.sweep.topics) ? j.sweep.topics.filter((x: unknown) => typeof x === "string").slice(0, 6) : [],
          keywords: Array.isArray(j.sweep.keywords) ? j.sweep.keywords.filter((x: unknown) => typeof x === "string").slice(0, 12) : [],
          criteria: String(j.sweep.criteria).slice(0, 400),
        },
      };
    }
    return { route: "semantic" };
  } catch (e) {
    dbg.router_error = e instanceof Error ? e.message : String(e);
    return { route: "semantic" };
  }
}

// ─── Motor A: structured ─────────────────────────────────────────────────────
export async function runStructured(supabase: any, decision: RouteDecision, dbg: any): Promise<any | null> {
  const tool = TOOL_CATALOG.find((t) => t.name === decision.tool);
  if (!tool) return null;
  const p = decision.params || {};
  const t0 = Date.now();
  try {
    if (tool.name === "no_data") {
      return {
        route: "structured", tool: tool.name, rows: [], columns: [],
        scanned_n: 0, scanned_desc: "geen databron",
        claim: `Niet uit de data te beantwoorden: ${String(p.reason || "het gevraagde veld wordt niet bijgehouden in de database")}.`,
        definition: tool.definition, caveat: String(p.reason || "veld ontbreekt in de database"),
      };
    }
    let args: Record<string, unknown> = {};
    if (tool.name === "churned_in_window") {
      args = { p_from: String(p.from || "").slice(0, 10) || null, p_to: p.to ? String(p.to).slice(0, 10) : null, p_include_undated: p.include_undated === true };
      if (!args.p_from) return null;
    } else if (tool.name === "uncontacted_since") {
      args = { p_days: Math.max(1, Math.min(3650, Number(p.days) || 60)) };
    } else if (tool.name === "count_by_stage") {
      args = { p_pipeline_label: typeof p.pipeline === "string" && p.pipeline.trim() ? p.pipeline.trim().slice(0, 60) : null };
    } else if (tool.name === "deals_over_amount") {
      args = { p_min: Math.max(0, Number(p.min) || 10000) };
    } else if (tool.name === "customers_by_price") {
      args = { p_price: Number(p.price) };
      if (!isFinite(args.p_price as number) || (args.p_price as number) <= 0) return null;
    } else if (tool.name === "started_in_window") {
      args = { p_from: String(p.from || "").slice(0, 10) || null, p_to: p.to ? String(p.to).slice(0, 10) : null };
      if (!args.p_from) return null;
    } else if (tool.name === "license_value") {
      args = {};
    }
    const { data, error } = await supabase.rpc(tool.rpc!, args);
    if (error) { dbg.structured_error = error.message; return null; }
    const rows: any[] = Array.isArray(data) ? data : [];
    let scanned = rows.length;
    let scannedDesc = tool.definition;
    if (rows.length > 0 && rows[0].scanned_total != null) {
      scanned = Number(rows[0].scanned_total);
      scannedDesc = `${scanned} deals/klanten in scope gescand`;
    }
    if (tool.name === "uncontacted_since" && rows.length > 0 && rows[0].scanned_total != null) {
      scannedDesc = `${scanned} actieve Customer Base-klanten gescand`;
    }
    const cleanRows = rows.slice(0, 200).map((r) => { const { scanned_total: _drop, ...rest } = r; return rest; });
    const columns = cleanRows.length > 0 ? Object.keys(cleanRows[0]) : [];
    const caveat = tool.name === "deals_over_amount" && cleanRows.length === 0
      ? "Het amount-veld wordt in HubSpot vrijwel niet bijgehouden; dealwaarde is niet uit de data af te leiden."
      : null;
    let claim = `${cleanRows.length} resultaten uit ${scannedDesc}.`;
    if (tool.name === "uncontacted_since") {
      claim = `${scanned} actieve klanten gescand; ${cleanRows.length} voldoen aan het criterium.`;
    } else if (tool.name === "license_value") {
      const total = cleanRows.reduce((s: number, r: any) => s + (typeof r.maand_waarde === "number" ? r.maand_waarde : Number(r.maand_waarde) || 0), 0);
      const missing = cleanRows.filter((r: any) => r.maand_waarde == null).length;
      claim = `Totale maandelijkse licentiewaarde ≈ €${Math.round(total)} over ${cleanRows.length} lopende klanten (${missing} zonder bruikbare prijsdata).`;
    }
    return {
      route: "structured", tool: tool.name, rows: cleanRows, columns,
      scanned_n: scanned, scanned_desc: scannedDesc,
      claim,
      definition: tool.definition, caveat,
      timing_ms: Date.now() - t0,
    };
  } catch (e) {
    dbg.structured_error = e instanceof Error ? e.message : String(e);
    return null;
  }
}

// ─── Motor B: sweep (map-reduce) ─────────────────────────────────────────────
function sanitizeKeywordsToRegex(keywords: string[]): string {
  const words = (keywords || [])
    .map((w) => String(w).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim())
    .filter((w) => w.length >= 3 && w.length <= 40)
    .slice(0, 12);
  if (words.length === 0) return "";
  return "(" + words.map((w) => w.replace(/\s+/g, "\\s+")).join("|") + ")";
}

export async function runSweep(supabase: any, openaiKey: string, decision: RouteDecision, dbg: any): Promise<any | null> {
  const sw = decision.sweep!;
  const t0 = Date.now();
  const regex = sanitizeKeywordsToRegex(sw.keywords);
  if ((sw.topics || []).length === 0 && !regex) return null;
  const { data, error } = await supabase.rpc("analytics_sweep_evidence", {
    p_topics: sw.topics && sw.topics.length > 0 ? sw.topics : null,
    p_keywords_regex: regex || null,
    p_scope: sw.scope || "sales",
    p_max_candidates: SWEEP_MAX_CANDIDATES,
    p_snippets_per: SWEEP_SNIPPETS_PER,
  });
  if (error) { dbg.sweep_error = error.message; return null; }
  const evid: any[] = Array.isArray(data) ? data : [];
  if (evid.length === 0) {
    return {
      route: "sweep", rows: [], columns: [], scanned_n: 0,
      scanned_desc: "0 kandidaten met signalen in het mailarchief",
      claim: "Geen kandidaten met signalen gevonden in het mailarchief voor dit criterium.",
      definition: `Voorfilter: topics=${JSON.stringify(sw.topics)} / keywords in mailtekst; scope=${sw.scope}.`,
      population: null, cost: null, timing_ms: Date.now() - t0,
    };
  }
  const population = evid[0].population ?? null;
  // Groepeer evidence per kandidaat.
  const byKey = new Map<string, { key: string; name: string | null; n: number; snippets: Array<{ date: string; mail_id: string; text: string }> }>();
  for (const r of evid) {
    const k = String(r.sender_key);
    if (!byKey.has(k)) byKey.set(k, { key: k, name: r.company_name || null, n: Number(r.n_signals) || 0, snippets: [] });
    const g = byKey.get(k)!;
    if (g.snippets.length < SWEEP_SNIPPETS_PER) {
      g.snippets.push({ date: r.occurred_at ? String(r.occurred_at).slice(0, 10) : "?", mail_id: r.mail_id, text: String(r.snippet || "").slice(0, 600) });
    }
  }
  const candidates = [...byKey.values()];
  dbg.sweep_candidates = candidates.length;
  dbg.sweep_population = population;
  dbg.sweep_params = { scope: sw.scope, topics: sw.topics, keywords: sw.keywords };

  // Batched verdicts (parallel).
  const batches: Array<typeof candidates> = [];
  for (let i = 0; i < candidates.length; i += SWEEP_BATCH_SIZE) batches.push(candidates.slice(i, i + SWEEP_BATCH_SIZE));
  let tokIn = 0, tokOut = 0;
  const verdictErrors: string[] = [];
  const verdictArrays = await Promise.all(batches.map(async (batch) => {
    const blocks = batch.map((c) => {
      const sn = c.snippets.map((s, i) => `  (${i + 1}, ${s.date}) ${s.text}`).join("\n");
      return `KANDIDAAT key="${c.key}"${c.name ? ` bedrijf="${c.name}"` : ""} (${c.n} signaal-mails):\n${sn}`;
    }).join("\n\n");
    const prompt = `Context: Legal Mind verkoopt een AI-platform aan advocatenkantoren. Je beoordeelt per kandidaat-partij of hun MAILS voldoen aan dit criterium:
CRITERIUM: ${sw.criteria}

Belangrijk:
- Alleen "match": true bij EXPLICIET bewijs in de snippets hieronder (citaat verplicht) dat PRECIES het criterium raakt — niet iets dat er op lijkt (frustratie ≠ twijfel; een neutrale prijsvraag ≠ prijsbezwaar). Actief de prijs/fee omlaag onderhandelen of korting bedingen telt WEL als prijsbezwaar.
- Het bewijs moet het criterium van de AFZENDER ZELF uitdrukken: een verzoek aan Legal Mind om gedrag aan te passen, trainings- of service-feedback, of een beleefdheidszin is GEEN match.
- Het gaat om de wederpartij in Legal Mind's eigen sales/klantrelatie. GEEN match voor: leveranciers/vendors die zelf iets aan Legal Mind verkopen of offreren (hun eigen tarieven tellen NIET), adviseurs/partners die Legal Mind helpen, verhuurders, nieuwsbrieven, of andermans prijzen/voorwaarden.
- naam: bedrijfsnaam zoals die uit de snippets blijkt (ondertekening/domein); gebruik anders de aangeleverde bedrijfsnaam of het e-mailadres.

${blocks}

Antwoord ALLEEN met een JSON-array, één object per kandidaat:
[{"key":"...","match":true,"confidence":0.0,"naam":"...","bewijs":"één NL-zin","citaat":"letterlijk fragment max 140 tekens","datum":"YYYY-MM-DD","snippet_nr":1}]`;
    try {
      const { text, usage } = await miniCall(openaiKey, prompt, 1400, SWEEP_CALL_TIMEOUT_MS);
      tokIn += usage.prompt_tokens || 0; tokOut += usage.completion_tokens || 0;
      const arr = extractJson(text);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      verdictErrors.push(e instanceof Error ? e.message : String(e));
      return [];
    }
  }));
  const verdicts = verdictArrays.flat();
  if (verdictErrors.length > 0) dbg.sweep_verdict_errors = verdictErrors.slice(0, 3);

  const rows: any[] = [];
  for (const v of verdicts) {
    if (!v || v.match !== true) continue;
    const cand = byKey.get(String(v.key));
    if (!cand) continue;
    const snipIdx = Math.max(1, Math.min(cand.snippets.length, Number(v.snippet_nr) || 1)) - 1;
    rows.push({
      naam: String(v.naam || cand.name || cand.key).slice(0, 120),
      bewijs: String(v.bewijs || "").slice(0, 240),
      citaat: String(v.citaat || "").slice(0, 160),
      datum: String(v.datum || cand.snippets[snipIdx]?.date || "").slice(0, 10),
      confidence: typeof v.confidence === "number" ? Math.max(0, Math.min(1, v.confidence)) : null,
      sender: cand.key,
      mail_id: cand.snippets[snipIdx]?.mail_id || cand.snippets[0]?.mail_id || null,
    });
  }
  rows.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  const costUsd = (tokIn * MINI_USD_IN + tokOut * MINI_USD_OUT) / 1_000_000;
  return {
    route: "sweep",
    rows, columns: ["naam", "bewijs", "citaat", "datum", "confidence"],
    scanned_n: candidates.length,
    scanned_desc: `${candidates.length} kandidaat-partijen met signalen LLM-gescand (signaal-voorfilter over ${population ?? "?"} externe partijen in scope '${sw.scope}')`,
    claim: `${candidates.length} kandidaten gescand (van ${population ?? "?"} partijen in scope), ${rows.length} matches.`,
    definition: `Criterium: ${sw.criteria} — voorfilter topics=${JSON.stringify(sw.topics)} + keywords, scope=${sw.scope}; verdict per kandidaat door ${SWEEP_MODEL}.`,
    population,
    cost: { model: SWEEP_MODEL, calls: batches.length, tokens_in: tokIn, tokens_out: tokOut, est_usd: Number(costUsd.toFixed(4)) },
    timing_ms: Date.now() - t0,
  };
}

// ─── Context-tekst voor het antwoord-LLM ─────────────────────────────────────
export function analyticsContextBlob(analytics: any): string {
  const lines: string[] = [];
  lines.push(`ROUTE: ${analytics.route} ${analytics.tool ? `(tool: ${analytics.tool})` : ""}`);
  lines.push(`DEFINITIE: ${analytics.definition}`);
  lines.push(`DEKKING: ${analytics.claim}`);
  if (analytics.caveat) lines.push(`LET OP: ${analytics.caveat}`);
  const rows: any[] = analytics.rows || [];
  if (rows.length === 0) {
    lines.push("RESULTAAT: 0 rijen.");
  } else {
    lines.push(`RESULTAAT (${rows.length} rijen, exact — verzin niets bij):`);
    for (let i = 0; i < Math.min(rows.length, 120); i++) {
      lines.push(`${i + 1}. ${JSON.stringify(rows[i])}`);
    }
  }
  return lines.join("\n");
}
