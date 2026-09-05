// =============================================================================
// ragChatPersist — wat er van een chatbericht in de database landt
// =============================================================================
// Afgesplitst uit useRagChat.js (v1.146): die hook liep over de 400-regelgrens
// uit CLAUDE.md toen de antwoord-envelop erbij kwam. Het gaat hier om één
// duidelijke taak — een bericht in het geheugen omzetten naar een compacte rij
// in `rag_chat_sessions.messages` — en die taak hoort in een eigen bestand.
//
// De rode draad in alle vier de strippers: een chatsessie wordt bij ELKE
// wijziging opnieuw weggeschreven, dus een bericht dat 32 kB aan
// chunk-previews meedraagt maakt de pagina traag bij elke volgende beurt.
// Bewaar wat de UI na een reload nodig heeft, gooi de rest weg.
// =============================================================================

// Citations.preview kan groot worden (40 chunks × 800 chars = 32k chars per
// bericht); slim afgekapt zodat de DB-save snel blijft en de pagina niet hangt
// op een grote upload.
export const stripCitations = (cites) =>
  Array.isArray(cites) ? cites.map(c => ({
    n: c.n, chunk_id: c.chunk_id, source: c.source, id: c.id,
    subject: c.subject, from_name: c.from_name,
    occurred_at: c.occurred_at, similarity: c.similarity,
    rerank_score: c.rerank_score, entity_path: c.entity_path, via: c.via,
    preview: (c.preview || '').slice(0, 280),
  })) : []

// Analytics-blok (Vragenbak): rijen compact persisteren zodat de tabel ook na
// sessie-reload rendert. Cap op 100 rijen houdt de save licht.
export const stripAnalytics = (a) => a ? {
  route: a.route, tool: a.tool || null, claim: a.claim, definition: a.definition,
  scanned_n: a.scanned_n ?? null, columns: a.columns || [],
  rows: Array.isArray(a.rows) ? a.rows.slice(0, 100) : [],
  ...(a.cost ? { cost: a.cost } : {}),
} : null

// WP4 — de envelop compact persisteren zodat de dekking-melding en de
// downloadknop een sessie-reload overleven. `rows` gaan NIET mee: die staan al
// in `analytics` en zouden de save verdubbelen; ArtifactBar leest ze daar
// vandaan zodra de envelop ze niet heeft.
export const stripEnvelope = (e) => e ? {
  version: e.version, claim: e.claim, definition: e.definition, route: e.route,
  columns: e.columns || [],
  artifacts_available: e.artifacts_available || [],
  coverage: e.coverage || null,
  ...(e.cost ? { cost: { usd: e.cost.usd, tokens_in: e.cost.tokens_in, tokens_out: e.cost.tokens_out } } : {}),
} : null

// Reasoning-steps (v5.1/v2.3): compact persisteren — incl. args + top-vondsten
// per tool-call, zodat de trace na sessie-reload volledig uitklapbaar blijft.
export const stripSteps = (arr) =>
  Array.isArray(arr) ? arr.slice(0, 24).map(st => ({
    t: st.t, stage: st.stage || null, label: st.label,
    ...(st.detail ? { detail: st.detail } : {}),
    ...(st.args ? { args: String(st.args).slice(0, 140) } : {}),
    ...(Array.isArray(st.findings) && st.findings.length ? {
      findings: st.findings.slice(0, 4).map(f => ({
        datum: f.datum || null,
        naam: String(f.naam || '').slice(0, 60),
        detail: String(f.detail || '').slice(0, 90),
      })),
    } : {}),
  })) : []

// Eén bericht → één rij. Alleen assistent-berichten dragen de zware velden.
export function toPersistable(m) {
  return {
    role: m.role,
    content: m.content,
    ts: m.ts,
    ...(m.role === 'assistant' && m.citations ? { citations: stripCitations(m.citations) } : {}),
    ...(m.role === 'assistant' && m.entity_used ? { entity_used: m.entity_used } : {}),
    ...(m.role === 'assistant' && m.web_citations ? { web_citations: m.web_citations } : {}),
    ...(m.role === 'assistant' && m.analytics ? { analytics: stripAnalytics(m.analytics) } : {}),
    ...(m.role === 'assistant' && m.steps?.length ? { steps: stripSteps(m.steps) } : {}),
    ...(m.role === 'assistant' && m.envelope ? { envelope: stripEnvelope(m.envelope) } : {}),
    ...(m.role === 'assistant' && m.query_log_id ? { query_log_id: m.query_log_id } : {}),
    ...(m.error ? { error: m.error } : {}),
  }
}
