// =============================================================================
// rag-chat v6.0 — een vraag is nu een run (spoor 02, Langlopende runs · I1)
// =============================================================================
// v6.0 (2026-09-06, spoor 02 I1). Elke vraag wordt een rij in agent_chat_runs met
//   een toestandsmachine, een budget per effort en een stappenlog; de motor staat
//   in run.ts (hops, lease, budget, spent, stages) en compose.ts (Grok → rij). Dit
//   bestand is nog alleen de deur: body-modes, auth, en de twee compat-antwoorden.
//
//   Body-modes:
//     {message, history, run:true, effort?, session_id?, …filters}
//         → run-rij + state-rij, hop 1 in EdgeRuntime.waitUntil, direct 200 {ok, run_id}
//           (user-JWT = eigenaar en ACL-identiteit; service-key = eval/smoke: owner null)
//     {_run_id, _hop}            → alleen service-key: volgende hop (zelf-fetch vanuit de vorige)
//     {_run_id, resume:true}     → eigenaar (JWT-sub = owner_id) of service-key: hervat na
//                                  failed / needs_input (na agent_chat_run_answer_input) / stil > 60 s
//     {message, stream:true|false} → COMPAT (vork V7): maakt óók een run-rij en draait de
//                                  hops inline in dezelfde invocatie (≤ 140 s, zoals vandaag);
//                                  antwoordcontract byte-gelijk aan v5.8. Verdwijnt zodra de
//                                  browser-hook (I2) en de evalrunner v3.1 op run:true staan.
//
//   Waarom (RESEARCH 02 §1–§2, gemeten): 25 % van de agentic runs eindigde op de
//   tool-cap van 10, niet op de klok; 0 van 797 calls haalde ooit 150 s maar de
//   gateway kapt élke niet-streamende call na 150 s af (504); een gesloten tab
//   verloor vraag én antwoord omdat het antwoord nergens op de server stond. Nu
//   schrijft de hop answer_partial/answer_md altijd in de rij; de browser volgt de
//   rij via realtime (I2). verify_jwt blijft TRUE: callerSub() leest de `sub`.
//
//   Ongewijzigd: routes, tools, recepten, prompts, coverage.reason (gesloten set),
//   envelope v1 (alleen een additief `budget`-blok), context-build, match_chunks,
//   de twee identiteitsassen (owner_id = RLS, caller_user_id = Confluence-ACL).
// =============================================================================
// Historie van vóór de split (index.ts v5.8 en eerder):
//
// v5.8 (2026-09-06, ANSWER-STACK S3b stap 1). Geen zichtbare wijziging: Grok
//   schrijft nog élk antwoord, ook de navertelling van de agent-conclusie.
//   - agent_config rag-chat/agentic_model → gpt-5.6-sol (migratie 20260906170000);
//     PRICE_PER_M in agentic.ts kent nu sol/terra/luna — zonder die rij viel de
//     lus stil terug op gpt-5.5. Sol krijgt reasoning_effort 'none' (het enige
//     dat /v1/chat/completions met function-tools accepteert; zie agentic.ts).
//   - sweep-verdicts → gpt-5.6-luna (analytics.ts); HyDE-rewrite +
//     LLM-rerank → luna (context-build v2.9); evaljudge → luna (rag-eval-cron v3.1).
//     De router ging óók naar luna maar staat sinds het merge-besluit weer op
//     gpt-5.4-mini (analytics.ts v2.6: luna 7/34 vs mini 4/34 route-verschillen).
//   - PRICE_USD grok 3/15 → 1,25/2,50 (officiële xAI-lijstprijs); gpt-5.5
//     1,25/10 → 5/30. De gelogde kosten waren voor Grok 2,4-6× te hoog en voor de
//     agent-lus ~3× te laag. G5 wordt in dezelfde PR opnieuw geijkt.
//   - cached_tokens uit OpenAI-antwoorden worden gelogd en tegen het
//     cache-tarief geprijsd (agent-lus; judge in rag-eval-cron).
// v5.7 (2026-09-06, spoor 01): body.eval_run_id → rag_chat_query_log.meta.eval_run_id.
// v5.6 (2026-09-05, AGENT-REBUILD WP1/WP2/WP4). Vier dingen, alle vier uit een
// meting en niet uit een vermoeden.
//
// WP1 — het retrieval-budget klopte niet. Gemeten op 20 echte vragen uit
//   rag_chat_query_log, met exact de parameters die deze functie stuurt:
//   intent=search deed p50 13.282 ms en p95 23.318 ms, terwijl hieronder een
//   grens van 6.000 ms staat. 18 van de 20 lagen daarboven: negen van de tien
//   semantische chatvragen kwam als "0 fragmenten" bij Jelle aan, zonder één
//   foutmelding. De oorzaak zat niet in HyDE of de dubbele reranker (samen ~3 s
//   van de ~13) maar in de BM25-arm van match_chunks — zie migratie
//   20260905180000. Nieuw recept `search_fast`: p50 2.370 ms, p95 3.071 ms,
//   0 van de 20 boven de grens, 0 lege bundels. Het zware `search` blijft
//   bestaan als agent-tool (semantic_search, eigen budget van 30 s).
//
// WP2 — een leeg antwoord noemt nu zijn oorzaak. `coverage.reason` uit een
//   gesloten verzameling (timeout | acl_filtered | below_threshold |
//   truly_empty | not_tracked) loopt van context-build via deze functie naar
//   het antwoord dat de gebruiker leest én naar rag_chat_query_log. Daarnaast:
//   één tweede poging met een lagere drempel als de eerste ronde te dun is, de
//   ILIKE-entityval is dicht, en de zelfheling kijkt naar bruikbare context in
//   plaats van naar "is er een naam gematcht".
//
// WP4 — het antwoord heeft een contract. `envelope` (claim, definition,
//   sources, rows/columns, coverage, artifacts, cost) staat naast de vrije
//   markdown, zodat de UI een tabel kan tonen, de gebruiker een Excel kan
//   downloaden en de evalharnas kan asserten zonder reguliere expressies over
//   proza te leggen.
//
// v5.5 (2026-07-17, review-ronde 6 Jelle): agentic-antwoord opent met de KERN
//   i.p.v. de machine-claim ("Agentic beantwoord met 8 tool-call(s)...") —
//   meta-taal is verboden in de lopende tekst; dekking = natuurlijke slotzin.
//   Harde leesbaarheidsregels (NN/g-onderzoek): alinea's van 2-4 zinnen met
//   lege regel, max 1-2 bold per alinea, ## kopjes bij >2 onderwerpen.
// v5.4 (2026-07-17, review-ronde 5 Jelle): de router (gpt-5.4-mini) draait op
//   ELKE vraag als eerste stap — de regex-gate is geen poort meer, alleen nog
//   telemetrie. Semantisch zoeken is een volwaardige door-de-router-gekozen
//   route met "why" in de trace én vondsten op tijdlijn/kennisindex/rerank-
//   stappen. Self-healing (weinig context → agent) werkt nu voor alle vragen.
//   Aanleiding: "turn in april en of dat nog leeft in juni" miste de gate en
//   viel zonder interpretatie het vector-pad in (2× in de query-log).
// v5.3 (2026-07-17, review-ronde 4 Jelle): elke tool-step draagt nu de top-5
//   vondsten (datum·naam·detail) + leesbare argumenten mee — de UI toont per
//   call wát er gevonden is. Tool-tuning uit helicopter-review: semantic_search
//   timeout 10→15s (19% time-outte), mail-voorfilter 30→20 kandidaten,
//   prompt-regel tegen bijna-identieke herhaalqueries.
// v5.2 (2026-07-16, review-ronde 2 Jelle — "ik wil hem zien redeneren"):
//   - ReAct: de agent schrijft vóór elke tool-beurt 1-2 zinnen gedachte
//     ("De april-churns zijn binnen: Beer (prijs)… nu check ik of prijsdruk
//     nog speelt") → live 💭-stap in de UI + in de trace/query-log.
//   - Nieuwe agent-tools: semantic_search (de kennisindex als tool — de agent
//     kan zelf thematisch doorzoeken) en customer_timeline (per klant de
//     diepte in: mails + notities + churn-status, fuzzy op naam).
//   - Router-definitie agentic verbreed: ook vergelijken/verklaren over tijd
//     ("waarom", "geldt dat nog", periodes naast elkaar) — niet alleen
//     activiteiten. Jelle's turnredenen-vraag (16/7 18:15) ging hierdoor mis.
//   - Self-healing: gate-hit + semantic vindt <3 fragmenten → de agent neemt
//     het alsnog over i.p.v. "geen context".
//   - Caps agent: 10 tool-calls / 150s / $0,50.
// v5.1 (2026-07-07, review-ronde Jelle):
//   - Reasoning-steps: de pipeline meldt elke ECHTE stap (route-besluit,
//     per-tool "X doorzocht: N resultaten (M gescand)", tijdlijn/vector/rerank)
//     als SSE {type:'status', step}. Stream-modus opent de verbinding EERST en
//     draait de pipeline daarbinnen — de UI wordt live meegenomen, óók bij een
//     agentic-run van 30-60s. meta.steps + query-log.meta.steps = de trace.
//   - History-aware: router én agentic-loop krijgen het gesprek mee, zodat
//     follow-ups ("en de maand ervoor?") correct geparametriseerd worden.
//   - Analytics-antwoord maakt GEEN markdown-tabel meer (de UI toont de exacte
//     tabel al via AnalyticsBlock; de chat-markdown rendert pipes bovendien
//     als platte tekst) — alleen korte duiding + verwijzing.
// v5.0 (2026-07-07, Vragenbak v2 agentic):
//   - 4e route "agentic" (agentic.ts): native OpenAI function-calling-loop
//     voor multi-bron/meerstaps datavragen (agenda + notities + mail +
//     Motor A-RPC's). Router krijgt nu de huidige datum (relatieve vensters).
//   - Entity-timeline (company + contact) haalt óók churn_customers op: een
//     "hoe gaat het met X"-vraag ziet nu het churn-feit + reden prominent
//     (chunk wordt buiten de rerank gehouden zodat hij nooit wegvalt).
//   - Query-log: ELKE vraag (ook semantic) → rag_chat_query_log (route, tool,
//     rijen, kosten, latency) voor router/tool-review in echt gebruik.
//     meta.query_log_id koppelt UI/feedback aan de log-rij.
//   - GROK_MODEL gepind op grok-4.3: xAI resolvet de oude alias 'grok-4-fast'
//     inmiddels server-side naar grok-4.3 (live geverifieerd 2026-07-07) —
//     de pin maakt expliciet wat er feitelijk draait.
// v4.0 (2026-06-11, project 471302146): regex-gate + gpt-5.4-mini-router
//   classificeert structured / sweep / semantic. structured → read-only
//   analytics-RPC's (Motor A); sweep → enrichment-voorfilter + batched
//   verdicts (Motor B); semantic → ongewijzigd bestaand pad (default bij
//   twijfel/fout). Bij analytics-route: entity-resolutie, RPC-timeline,
//   context-build, rerank en web-research worden overgeslagen; response
//   krijgt een machine-leesbaar `analytics`-blok (route, rows, scanned_n,
//   claim, cost) voor de UI-tabel + eval-asserts. Zie rag-chat/analytics.ts.
// v3.24 (2026-06-03, RAG v2 F.1b): tryResolveEntity probeert eerst de DB-RPC
//   rag_resolve_entity (pg_trgm word_similarity + entity_resolution: exacte e-mail,
//   company/deal/contact-naam fuzzy). Robuuster dan de ILIKE-substring+lengte-ratio,
//   die als fallback blijft staan. duplicate_count → disambiguatie-UI.
// v3.23 (2026-05-22):
//   - Rassers-vraag hing aan einde: meta-event met 40 chunks × 800 chars preview =
//     ~32k chars JSON → grote auto-save naar Supabase JSONB. Fix:
//   - citation.preview cap 800 → 400 (uit metaPayload).
//   - MAX_CTX_PER_CHUNK 1500 → 1000 (compromis: nog genoeg voor transcript-segmenten).
//   - Frontend in useRagChat stript preview tot 280 chars bij persist.
// v3.22: Fireflies-koppeling + transcript-segmenten
// =============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { createRun, runHop, resumeRun, callerSub, parseEffort, waitUntil, RAG_CHAT_VERSION, type RunRequest, type RunMode, type HopResult } from "./run.ts";

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function sseChunk(obj: any): Uint8Array { return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`); }

// Constante-tijd vergelijking (zelfde vorm als _shared/edge-auth.ts, hier lokaal
// zodat rag-chat geen _shared importeert en de deploy-bundel exact de zes
// rag-chat-bestanden blijft — geheugen: rag-chat is de enige multi-file functie).
function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}
function isServiceCall(req: Request): boolean {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  return !!token && !!SERVICE_KEY && timingSafeEqual(token, SERVICE_KEY);
}
const isUuid = (s: unknown) => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);

function parseRequest(body: any, mode: RunMode): RunRequest {
  return {
    message: String(body.message ?? "").trim(),
    history: Array.isArray(body.history) ? body.history.slice(-10) : [],
    filter_sources: Array.isArray(body.filter_sources) ? body.filter_sources : null,
    force_no_entity: body.force_no_entity === true,
    web_search: body.web_search === true,
    writing_style: typeof body.writing_style === "string" ? body.writing_style : null,
    tone: typeof body.tone === "string" ? body.tone : null,
    focus: typeof body.focus === "string" ? body.focus : null,
    // Spoor 01 — evalverkeer is herkenbaar: alleen een uuid telt.
    eval_run_id: isUuid(body.eval_run_id) ? body.eval_run_id : null,
    effort_requested: parseEffort(body.effort),
    mode,
  };
}
function originOf(body: any, req: RunRequest, sub: string | null): string {
  if (req.eval_run_id) return "eval";
  if (body.origin === "smoke" || body.origin === "api" || body.origin === "browser") return body.origin;
  return sub ? "browser" : "api";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept" }});
  const baseHeaders = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: baseHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY);
  let body: any;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: "invalid_json" }), { status: 400, headers: baseHeaders }); }
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: baseHeaders });

  try {
    // ── Volgende hop (zelf-fetch vanuit de vorige hop; alleen de service-key) ──
    if (isUuid(body._run_id) && body._hop !== undefined && body.resume !== true) {
      if (!isServiceCall(req)) return json({ ok: false, error: "unauthorized" }, 401);
      const hop = Number(body._hop) || 0;
      waitUntil(runHop(supabase, body._run_id, hop, { inline: false }).catch((e) => console.error("[rag-chat] hop crashed", body._run_id, e instanceof Error ? e.message : String(e))));
      return json({ ok: true, run_id: body._run_id, hop, accepted: true }, 202);
    }

    // ── Hervatten: eigenaar (JWT-sub = owner_id) of service-key ───────────────
    if (isUuid(body._run_id) && body.resume === true) {
      const service = isServiceCall(req);
      const sub = callerSub(req);
      if (!service && !sub) return json({ ok: false, error: "unauthorized" }, 401);
      if (!service) {
        const { data: row } = await supabase.from("agent_chat_runs").select("id, owner_id").eq("id", body._run_id).maybeSingle();
        // Eén antwoord voor "bestaat niet" en "niet van jou": het bestaan van een run is informatie.
        if (!row || row.owner_id !== sub) return json({ ok: false, error: "forbidden" }, 403);
      }
      const r = await resumeRun(supabase, body._run_id);
      if (!r.ok) return json({ ok: false, error: r.reason }, r.reason === "not_found" ? 404 : 409);
      waitUntil(runHop(supabase, body._run_id, (r.row?.hop ?? 0) + 1, { inline: false }).catch((e) => console.error("[rag-chat] resume hop crashed", body._run_id, e instanceof Error ? e.message : String(e))));
      return json({ ok: true, run_id: body._run_id, state: r.row?.state, resumed: true }, 202);
    }

    const wantsRun: boolean = body.run === true;
    const wantsStream: boolean = body.stream === true;
    const mode: RunMode = wantsRun ? "run" : wantsStream ? "compat_stream" : "compat_json";
    const request = parseRequest(body, mode);
    if (!request.message || request.message.length < 2) return json({ ok: false, error: "message_required", min_chars: 2 }, 400);
    // v1.145/v1.141 — WIE stelt deze vraag? De `sub` uit de JWT is de eigenaar (RLS) én
    // de ACL-identiteit (caller_user_id). Service-key/cron: null = org-baseline, voor
    // geen enkele browser zichtbaar.
    const sub = callerSub(req);
    const sessionId = isUuid(body.session_id) ? body.session_id : null;
    const origin = originOf(body, request, sub);

    // ── run:true — de rij is het antwoord; hop 1 draait ná deze response ───────
    if (wantsRun) {
      const created = await createRun(supabase, { req: request, ownerId: sub, callerUserId: sub, origin, sessionId });
      waitUntil(runHop(supabase, created.id, 1, { inline: false }).catch((e) => console.error("[rag-chat] hop 1 crashed", created.id, e instanceof Error ? e.message : String(e))));
      return json({ ok: true, run_id: created.id, state: "queued", effort: created.effort, budget: created.budget, version: RAG_CHAT_VERSION });
    }

    // ── Compat (vork V7): hops inline, antwoordcontract als v5.8 ──────────────
    const t0 = Date.now();
    if (!wantsStream) {
      const created = await createRun(supabase, { req: request, ownerId: sub, callerUserId: sub, origin, sessionId });
      const hop: HopResult = await runHop(supabase, created.id, 1, { inline: true, t0 });
      if (hop.error) return json({ ok: false, error: hop.error.message, run_id: created.id }, hop.error.http);
      if (!hop.result) return json({ ok: false, error: hop.skipped || "run_not_completed", run_id: created.id }, 500);
      const r = hop.result;
      return json({
        ok: true, answer: r.answer, ...r.metaPayload, envelope: r.envelope, web_citations: r.web_citations,
        timing_ms: { total: Date.now() - t0, grok: r.timing_ms.grok }, tokens: r.tokens,
      });
    }

    // Stream-modus (v5.1): verbinding gaat DIRECT open; de run draait daarna binnen de
    // stream zodat status-events live bij de UI aankomen — óók bij een agentic-run.
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const safeEnqueue = (chunk: Uint8Array) => { if (closed) return; try { controller.enqueue(chunk); } catch { closed = true; } };
        const emit = (ev: any) => safeEnqueue(sseChunk(ev));
        const onDelta = (text: string) => safeEnqueue(sseChunk({ type: "delta", text }));
        try {
          const created = await createRun(supabase, { req: request, ownerId: sub, callerUserId: sub, origin, sessionId });
          const hop = await runHop(supabase, created.id, 1, { inline: true, emit, onDelta, t0 });
          if (hop.error) {
            safeEnqueue(sseChunk({ type: "error", error: hop.error.message, run_id: created.id }));
          } else if (hop.result) {
            const r = hop.result;
            if (r.streamError) safeEnqueue(sseChunk({ type: "error", error: r.streamError }));
            // WP4 — de afgemaakte envelop in het slot-event: pas hier is het antwoord compleet.
            safeEnqueue(sseChunk({ type: "done", envelope: r.envelope, timing_ms: { total: Date.now() - t0, grok: r.timing_ms.grok }, tokens: r.tokens, finish_reason: r.finish_reason, web_citations: r.web_citations, web_search_used: r.metaPayload.web_search_used, web_search_calls: r.metaPayload.web_search_calls, run_id: created.id }));
          } else {
            safeEnqueue(sseChunk({ type: "error", error: hop.skipped || "run_not_completed", run_id: created.id }));
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[rag-chat] stream pipeline error", msg);
          safeEnqueue(sseChunk({ type: "error", error: msg }));
        }
        try { controller.close(); } catch { /* already closed */ }
        closed = true;
      },
    });
    return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "Connection": "keep-alive", "Access-Control-Allow-Origin": "*", "X-Accel-Buffering": "no" } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[rag-chat] top-level error", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
