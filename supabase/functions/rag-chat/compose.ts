// =============================================================================
// rag-chat/compose.ts — de antwoordkant van een run                    (v6.0)
// =============================================================================
// Spoor 02 (2026-09-06, "een vraag is nu een run"). Wat hier staat kwam
// byte-gelijk uit index.ts v5.8: de prompt-opbouw (buildCombinedUserMessage), de
// dekkingszinnen (COVERAGE_SENTENCE), de prijstabel (PRICE_USD/estimateCostUsd)
// en de twee Grok-aanroepen. Nieuw zijn twee functies:
//   composeAnswer() — streamt het Grok-antwoord en meldt elke ~400 ms de volledige
//                     tussenstand (→ agent_chat_runs.answer_partial, realtime) en
//                     elke delta (→ SSE op het compat-pad stream:true);
//   finishCost()    — de kosten van één vraag over alle leveranciers, precies zoals
//                     finishEnvelope dat deed, nu met agent_config(rag-chat, pricing)
//                     als tabel en de constanten als fallback (poort T4).
// Dit bestand kent geen toestandsmachine en geen database: run.ts roept het aan.
// Het antwoordcontract (envelope v1) verandert niet; het krijgt alleen een additief
// `budget`-blok, en dat zet run.ts erin.
// =============================================================================

export const GROK_MODEL = "grok-4.3";
const GROK_CHAT_ENDPOINT = "https://api.x.ai/v1/chat/completions";
const MAX_TOKENS = 3000;
// Hoe vaak de tussenstand van het antwoord naar de run-rij gaat. ~0,4 s is grof
// genoeg om realtime niet te overstemmen en fijn genoeg om als "typen" te lezen
// (RESEARCH §3.5, AANNAME tot I2 de latentie meet).
export const PARTIAL_THROTTLE_MS = 400;

/** agent_config(rag-chat, pricing) — elk veld optioneel; ontbreekt het, dan geldt de constante. */
export type Pricing = {
  grok_in_per_1m?: number; grok_out_per_1m?: number;
  embed_per_1m?: number; cohere_per_search?: number;
  openai?: Record<string, { in: number; cached: number; out: number }>;
} | null;

// v6.0 — `stream_options.include_usage`: zonder die vlag stuurt xAI in een stream géén
// usage-chunk (gemeten 2026-09-06: 13 chunks, usage NONE; mét vlag 14 chunks, usage
// aanwezig). Het oude stream-pad logde daardoor nooit Grok-tokens voor browservragen;
// sinds v6.0 streamt élk antwoord, dus zonder deze vlag was spent.usd voor iedereen te laag.
function grokChatBody(messages: any[], stream: boolean) { return { model: GROK_MODEL, messages, max_tokens: MAX_TOKENS, temperature: 0.3, ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}) }; }

export async function callGrokChat(apiKey: string, systemPrompt: string, history: any[], userContent: string) {
  const messages = [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: userContent }];
  const res = await fetch(GROK_CHAT_ENDPOINT, { method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(grokChatBody(messages, false)), signal: AbortSignal.timeout(120_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`grok_${res.status}: ${text.slice(0, 300)}`);
  const json = JSON.parse(text);
  return { answer: json.choices?.[0]?.message?.content || "", usage: json.usage };
}
export async function callGrokChatStream(apiKey: string, systemPrompt: string, history: any[], userContent: string): Promise<Response> {
  const messages = [{ role: "system", content: systemPrompt }, ...history, { role: "user", content: userContent }];
  return await fetch(GROK_CHAT_ENDPOINT, { method: "POST", headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(grokChatBody(messages, true)) });
}

// ── WP2: een leeg antwoord noemt zijn oorzaak ────────────────────────────────
// Vijf redenen, vijf zinnen. Dit is geen logregel maar de tekst die in de
// context-plaats van de prompt komt te staan, zodat het antwoord dat Jelle
// leest de reden noemt in plaats van er beleefd omheen te schrijven.
//
// De formuleringen zijn met opzet feitelijk en zonder excuus. En bij
// `acl_filtered` staat er nadrukkelijk NIET wat er is afgeschermd: het bestaan
// van een pagina in een afgeschermde space is zelf informatie (§5.9).
export const COVERAGE_SENTENCE: Record<string, string> = {
  timeout:
    "(GEEN INTERNE CONTEXT — REDEN: de zoekactie in de kennisindex liep in een time-out. Er is dus niets doorzocht; dit zegt NIETS over of de informatie bestaat.)",
  acl_filtered:
    "(GEEN INTERNE CONTEXT — REDEN: de wiki is voor deze gebruiker maar gedeeltelijk leesbaar en binnen het leesbare deel staat niets over deze vraag. Noem dat de dekking beperkt is; noem NOOIT welke spaces of pagina's zijn afgeschermd.)",
  below_threshold:
    "(GEEN INTERNE CONTEXT — REDEN: er zijn wel fragmenten gevonden, maar geen enkele haalde de gelijkenisdrempel, ook niet na een tweede poging met een lagere drempel. Er is dus iets dat er in de verte op lijkt, maar niets dat de vraag beantwoordt.)",
  truly_empty:
    "(GEEN INTERNE CONTEXT — REDEN: de kennisindex bevat hier niets over. Doorzocht is wel degelijk; er staat niets.)",
  not_tracked:
    "(GEEN INTERNE CONTEXT — REDEN: onbekend; de reden kon niet worden vastgesteld.)",
};
export function coverageBlob(reason: string | null): string {
  return COVERAGE_SENTENCE[reason ?? ""] ?? "(geen interne context-stukken gevonden)";
}

// ── WP3: wat kost één vraag, over álle leveranciers heen ─────────────────────
// `est_cost_usd` werd tot v5.6 alleen gevuld vanuit `analytics.cost`, en dat
// bestaat alleen op de structured/sweep/agentic-routes. Het semantische pad —
// embedding, Cohere, Grok — kostte geld dat nergens landde. Van de 68 runs in
// de laatste 30 dagen had 62 % dus geen kostenregel.
//
// Tarieven zijn beleid, tokens zijn feiten. Daarom landen de ruwe tokens per
// leverancier ALTIJD in `meta.usage`, en is de prijs hieronder een aparte,
// herrekenbare laag. Verandert een tarief, dan is de historie opnieuw te
// berekenen zonder dat er data verloren is.
//
// Alle vier zijn publieke lijstprijzen. Grok-4.3 (xAI models-pagina, 2026-09-06):
// $1,25 in / $2,50 uit per 1M in het basistarief; het lange-contexttarief (2×)
// geldt pas als de prompt de drempel haalt, en onze prompts zijn ~5k tokens.
// Tot v5.8 stond hier de schatting 3,00/15,00 — 2,4× tot 6× te hoog — en
// daarmee was elke gelogde semantische kostprijs (en de G5-drempel) fout.
// Embedding en Cohere: text-embedding-3-large $0,13/1M tokens, rerank-v3.5
// $2,00 per 1000 zoekacties. Wijzigt een tarief, dan hoort de datum erbij.
export const PRICE_USD = {
  embed_per_1m: 0.13,
  cohere_per_search: 0.002,
  grok_in_per_1m: 1.25,   // xAI lijstprijs grok-4.3, 2026-09-06
  grok_out_per_1m: 2.50,  // idem
};
// v6.0 — `pricing` (agent_config rag-chat/pricing) overschrijft de constanten; ontbreekt
// een veld, dan geldt de constante. Zo blijft één tabel de waarheid voor spent.usd.
export function estimateCostUsd(u: { embed_tokens?: number; cohere_calls?: number; grok_in?: number; grok_out?: number; analytics_usd?: number | null }, pricing?: Pricing | null): number {
  const p = { ...PRICE_USD, ...(pricing ? {
    embed_per_1m: pricing.embed_per_1m ?? PRICE_USD.embed_per_1m,
    cohere_per_search: pricing.cohere_per_search ?? PRICE_USD.cohere_per_search,
    grok_in_per_1m: pricing.grok_in_per_1m ?? PRICE_USD.grok_in_per_1m,
    grok_out_per_1m: pricing.grok_out_per_1m ?? PRICE_USD.grok_out_per_1m,
  } : {}) };
  const c =
    ((u.embed_tokens ?? 0) / 1_000_000) * p.embed_per_1m +
    (u.cohere_calls ?? 0) * p.cohere_per_search +
    ((u.grok_in ?? 0) / 1_000_000) * p.grok_in_per_1m +
    ((u.grok_out ?? 0) / 1_000_000) * p.grok_out_per_1m +
    (u.analytics_usd ?? 0);
  return Math.round(c * 1e6) / 1e6;
}

export function buildCombinedUserMessage(opts: { question: string; entityHint: any | null; ctxBlob: string; validNs: string; webText: string | null; prefAdditions: string; analytics?: any | null; coverageReason?: string | null }): string {
  const { question, entityHint, ctxBlob, validNs, webText, prefAdditions, analytics, coverageReason } = opts;
  const entityLine = entityHint ? `Gedetecteerde entity: ${entityHint.entity_type} "${entityHint.name}"${entityHint.via === "inherited_from_history" ? " (overgeërfd)" : ""}.\n` : "";
  const hasWeb = !!webText;
  if (analytics) {
    const sweepCiteLine = analytics.route === "sweep" && (analytics.rows || []).length > 0
      ? "5. Noem bij elke partij die je in de tekst bespreekt de bron als [bron #N] — N is het rijnummer in de DATA (zelfde volgorde).\n"
      : "";
    // v5.5: de agentic-claim ("Agentic beantwoord met 8 tool-call(s)...") is
    // machine-jargon — die hoort in de UI-banner, niet in de lopende tekst.
    // Bij agentic opent het antwoord dus met de KERN; bij structured/sweep
    // blijft de (leesbare) dekking-claim de opening.
    const openingLine = analytics.route === "agentic"
      ? `2. Open direct met de kern van het antwoord in gewone taal — GEEN meta-taal: woorden als "tool-call", "evidence", "route", "agentic" of "records gescand" zijn VERBODEN in je tekst. Sluit het antwoord af met één natuurlijke dekkingszin: welke bronnen en periodes zijn doorzocht (bv. "Gebaseerd op de churn-administratie, agenda en het mailarchief over april–juni 2026.").`
      : `2. Begin je antwoord met de dekking-claim: "${String(analytics.claim || "").replace(/"/g, "'")}"`;
    // v5.1: GEEN markdown-tabel meer in het antwoord — de UI rendert de exacte
    // resultaattabel al (AnalyticsBlock). Dubbel was lelijk én de chat-markdown
    // rendert pipes als platte tekst.
    return [
      `JE TAAK (analytische vraag — exact berekende data):
1. De DATA hieronder is deterministisch uit de database berekend en is COMPLEET voor de gegeven definitie. Gebruik uitsluitend deze data; verzin of verwijder niets.
${openingLine}
3. BELANGRIJK: onder je antwoord toont de interface al de exacte resultaattabel met alle rijen. Maak dus GEEN markdown-tabel en som NIET alle rijen op. Noem de 2-6 belangrijkste namen/aantallen/datums (datums als dd-mm-jjjj) en eventuele opvallendheden; verwijs met één zin naar de tabel hieronder voor het volledige overzicht.
4. LEESBAARHEID (hard): korte alinea's van 2-4 zinnen met een LEGE REGEL ertussen — nooit één lap tekst. Maximaal 1-2 **vetgedrukte** sleutelwoorden per alinea. Gebruik ## kopjes zodra je meer dan twee onderwerpen behandelt (bv. per periode of per thema). Bullets alleen voor echte opsommingen van 3+ items.
${sweepCiteLine}6. Staat er 0 rijen of een LET OP-regel: zeg dan eerlijk dat dit niet (volledig) uit de data te beantwoorden is en waarom — geen alternatieve lijst fantaseren. Een LET OP-regel (zoals churns zonder datum) hoort kort benoemd in je antwoord.`,
      "",
      `=== DATA (deterministisch) ===\n${ctxBlob}\n=== EINDE DATA ===`,
      prefAdditions ? `\nVOORKEUREN (overschrijven default-format waar conflict):\n${prefAdditions}\n` : "",
      `\nEindig met:\n## Vervolgvragen\n- vraag 1\n- vraag 2`,
      `\n=== VRAAG VAN JELLE ===\n${question}`,
    ].join("\n");
  }
  // WP2 — is er geen interne context, dan is de reden onderdeel van het antwoord
  // en geen voetnoot. Zonder deze regel schrijft het model een beleefde alinea
  // om de leegte heen ("ik kon hier niets over vinden") en is een time-out van
  // buiten niet te onderscheiden van een index die het echt niet weet.
  const coverageBlok = coverageReason
    ? `
DEKKING (verplicht in je antwoord):
- Er is GEEN interne context. De reden staat hierboven tussen haakjes in het CONTEXT-blok.
- Zeg in één zin, in gewone taal, WAAROM je niets kunt onderbouwen — gebruik de reden hierboven, verzin er geen andere bij.
- Onderscheid daarbij hard: "de zoekactie liep vast" is iets anders dan "er staat niets". Draai die twee nooit door elkaar.
- Geen [bron #N] verzinnen, geen antwoord uit algemene kennis presenteren alsof het uit Legal Mind-data komt.
- Sluit af met wat er wél zou helpen (een andere formulering, een periode, een naam) — maximaal één zin.
`
    : "";
  const taakBlok = hasWeb
    ? `JE TAAK:
1. Lees de INTERNE CONTEXT en de WEB-RESEARCH hieronder.
2. Schrijf één samenhangend antwoord dat BEIDE bronnen gebruikt:
   - Interne feiten (uit CONTEXT-blok) → citeer met [bron #N].
   - Externe feiten (uit WEB-RESEARCH) → noem de URL plain.
3. Begin met interne info, vul aan met web. Niet de twee scheiden.
4. ALS de interne context relevante info heeft, MOET het antwoord ten minste één [bron #N] bevatten.
`
    : `JE TAAK:
1. Beantwoord op basis van de INTERNE CONTEXT hieronder.
2. Citeer elk feit met [bron #N].
3. Verzin geen feiten, geen externe bronnen.
`;
  const formatBlok = `
FORMAT (default):
- Korte inleiding (1-2 zinnen), daarna de inhoud.
- Korte alinea's van 2-4 zinnen met een LEGE REGEL ertussen — nooit één lap tekst.
- Maximaal 1-2 **vetgedrukte** sleutelwoorden per alinea; ## kopjes zodra je meer dan twee onderwerpen behandelt.
- Bullets alleen voor echte opsommingen van 3+ items.
- VERBODEN: markdown-link-citaten [[1]](https://...). URLs gewoon plain.

Eindig met:
## Vervolgvragen
- vraag 1
- vraag 2
`;
  const prefBlok = prefAdditions ? `\nVOORKEUREN (overschrijven default-format waar conflict):\n${prefAdditions}\n` : "";
  const webBlock = hasWeb ? `=== WEB-RESEARCH (externe info via gpt-4o-search-preview) ===\n${webText}\n=== EINDE WEB-RESEARCH ===\n\n` : "";
  return [
    taakBlok,
    coverageBlok,
    entityLine,
    `=== INTERNE CONTEXT ===\n${ctxBlob}\n=== EINDE CONTEXT ===\n\nBeschikbare interne bron-nummers: ${validNs || "(geen)"}.`,
    webBlock,
    formatBlok,
    prefBlok,
    `\n=== VRAAG VAN JELLE ===\n${question}`,
  ].join("\n");
}



// ── v6.0: het antwoord streamt naar de rij ───────────────────────────────────
export type ComposeResult = {
  answerMd: string; answerChars: number; usage: any;
  finishReason: string | null; streamError: string | null; grokMs: number;
};

// Eén Grok-stream, twee afnemers: `onDelta` krijgt elk stukje (het compat-pad
// zet het als SSE-delta door), `onPartial` krijgt hoogstens elke
// PARTIAL_THROTTLE_MS de volledige tussenstand (run.ts schrijft hem in
// answer_partial). Een fout vóór de eerste byte gooit `grok_stream_<status>`,
// zodat run.ts één keer kan retryen en anders failed{provider_error} zet; een fout
// mídden in de stream levert de tekst tot dan plus streamError — zoals het oude
// stream-pad. `deadlineAt` is de harde grens van de hop (HOP_HARD_MS): een
// antwoord dat de hop zou overleven is een verloren hop.
export async function composeAnswer(p: {
  grokKey: string; systemPrompt: string; sanitizedHistory: any[]; userMsg: string;
  onDelta?: (text: string) => void; onPartial?: (text: string) => void; deadlineAt?: number | null;
}): Promise<ComposeResult> {
  const t0 = Date.now();
  const messages = [{ role: "system", content: p.systemPrompt }, ...p.sanitizedHistory, { role: "user", content: p.userMsg }];
  const left = (p.deadlineAt ?? Number.POSITIVE_INFINITY) - Date.now();
  const timeoutMs = Math.max(15_000, Math.min(120_000, left));
  const grokRes = await fetch(GROK_CHAT_ENDPOINT, {
    method: "POST",
    headers: { "Authorization": `Bearer ${p.grokKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(grokChatBody(messages, true)),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!grokRes.ok || !grokRes.body) {
    const errTxt = await grokRes.text().catch(() => "");
    throw new Error(`grok_stream_${grokRes.status}: ${errTxt.slice(0, 300)}`);
  }
  const reader = grokRes.body.getReader();
  const decoder = new TextDecoder();
  let buf = ""; let usage: any = null; let finishReason: string | null = null;
  let answerText = ""; let answerChars = 0; let streamError: string | null = null;
  let lastPartial = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx = buf.indexOf("\n\n");
      while (idx >= 0) {
        const eventBlock = buf.slice(0, idx); buf = buf.slice(idx + 2); idx = buf.indexOf("\n\n");
        for (const line of eventBlock.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const json = JSON.parse(payload);
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) {
              answerChars += delta.length;
              // Cap op 200k tekens: ruim boven MAX_TOKENS, tegen een stream die niet stopt.
              if (answerText.length < 200_000) answerText += delta;
              try { p.onDelta?.(delta); } catch { /* afnemer weg */ }
              const now = Date.now();
              if (p.onPartial && now - lastPartial >= PARTIAL_THROTTLE_MS) { lastPartial = now; try { p.onPartial(answerText); } catch { /* best effort */ } }
            }
            if (json.choices?.[0]?.finish_reason) finishReason = json.choices[0].finish_reason;
            if (json.usage) usage = json.usage;
          } catch { /* ignore */ }
        }
      }
    }
  } catch (e) {
    streamError = e instanceof Error ? e.message : String(e);
  }
  return { answerMd: answerText, answerChars, usage, finishReason, streamError, grokMs: Date.now() - t0 };
}

// De kosten van één vraag over álle leveranciers — byte-gelijk aan wat
// finishEnvelope (v5.6–v5.8) berekende, nu met de tabel uit agent_config.
export type BaseUsage = { embed_tokens: number; cohere_calls: number; analytics_usd: number | null };
export function finishCost(baseUsage: BaseUsage, analytics: any | null, usage: any, pricing: Pricing) {
  const grokIn = usage?.prompt_tokens ?? 0;
  const grokOut = usage?.completion_tokens ?? 0;
  const cost = {
    usd: estimateCostUsd({ ...baseUsage, grok_in: grokIn, grok_out: grokOut }, pricing),
    tokens_in: grokIn, tokens_out: grokOut,
    tools: (analytics?.tools_used || []).length || (analytics?.tool ? 1 : 0),
    by_vendor: {
      openai_embed_tokens: baseUsage.embed_tokens,
      cohere_searches: baseUsage.cohere_calls,
      grok_in: grokIn, grok_out: grokOut,
      analytics_usd: baseUsage.analytics_usd,
      // v5.8 — de tokens van de agent-lus / sweep-verdicts zelf (incl. wat
      // OpenAI uit de cache haalde), zodat de lus-kosten herrekenbaar zijn.
      ...(analytics?.cost ? {
        analytics_model: analytics.cost.model ?? null,
        analytics_tokens_in: analytics.cost.tokens_in ?? null,
        analytics_tokens_cached: analytics.cost.tokens_cached ?? null,
        analytics_tokens_out: analytics.cost.tokens_out ?? null,
      } : {}),
    },
  };
  return { cost, grokIn, grokOut };
}
