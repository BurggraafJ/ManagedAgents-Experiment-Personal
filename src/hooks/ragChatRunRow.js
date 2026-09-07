// =============================================================================
// ragChatRunRow — van een agent_chat_runs-rij naar een chatbericht
// =============================================================================
// Spoor 02 I2 (v1.151). De rij is de bron van het antwoord; het bericht in
// `messages[]` blijft de weergave (RESEARCH §3.8). Deze vertaling is bewust
// één pure functie zonder React, zodat useRagChat.js onder de 400 regels blijft
// en de mapping los te testen is.
//
// Wat waar vandaan komt:
//   steps / phase_label / route / effort / budget / spent / hop  — elke UPDATE
//   content   ← answer_md (klaar) ?? answer_partial (tijdens composing) ?? vorige
//   done      ← envelope, citations, analytics, query_log_id, kosten, timing
//   meta      ← wat vóór v6.1 alleen in het compat-antwoord zat: entity_used,
//               retrieval_strategy, bundle_id, model, web_citations, tokens,
//               debug_pipeline (compact) — de UI (RetrievalDebug, entity-badge,
//               web-tab in SourcesPanel, feedback-RPC) leest die velden al.
//   failed    ← error → leesbare regel; cancelled → run_state, geen fout
//   needs_input ← input_request {question}
// =============================================================================
import { TERMINAL_STATES } from './useRunFollow'

const ERROR_LABEL = {
  provider_error: 'een leverancier gaf een fout',
  hop_lost: 'de verwerking viel stil',
  budget_wall: 'het tijdsbudget is op',
  internal: 'interne fout',
  config: 'configuratiefout',
  stream_error: 'het antwoordmodel brak af',
  not_visible: 'de run is niet meer zichtbaar',
}

export function describeRunError(err) {
  if (!err) return 'onbekende fout'
  const code = err.code || 'internal'
  const head = ERROR_LABEL[code] || code
  const detail = [err.provider, err.http_status].filter(Boolean).join(' ')
  const msg = err.message ? String(err.message).slice(0, 160) : ''
  return [head, detail ? `(${detail})` : null, msg ? `— ${msg}` : null].filter(Boolean).join(' ')
}

export function runRowToMessage(row, prev) {
  const terminal = TERMINAL_STATES.has(row.state)
  const meta = row.meta || {}
  const content = row.answer_md ?? row.answer_partial ?? prev.content ?? ''
  const spent = row.spent || null
  const next = {
    ...prev,
    run_id: row.id,
    run_state: row.state,
    // Wanneer de run begon: de live-teller in ReasoningTrace rekent hiermee, zodat
    // hij na een reload niet opnieuw bij 0,0 s begint.
    run_started_at: row.created_at || prev.run_started_at || null,
    phase_label: row.phase_label || prev.phase_label || null,
    route: row.route || prev.route || null,
    effort: row.effort || prev.effort || null,
    budget: row.budget || prev.budget || null,
    spent,
    hops: typeof row.hop === 'number' ? row.hop : prev.hops,
    steps: Array.isArray(row.steps) && row.steps.length ? row.steps : (prev.steps || []),
    content,
    input_request: row.state === 'needs_input' ? (row.input_request || null) : null,
    loading: !terminal && !content,
    streaming: !terminal,
  }
  if (!terminal) return next

  const envelope = row.envelope || prev.envelope || null
  const citations = Array.isArray(row.citations) ? row.citations : (prev.citations || [])
  const tokens = spent?.tokens
    ? { chat_in: spent.tokens.grok_in ?? 0, chat_out: spent.tokens.grok_out ?? 0, retrieval: meta.tokens?.retrieval ?? 0 }
    : (meta.tokens || prev.tokens || null)
  return {
    ...next,
    envelope,
    citations,
    analytics: row.analytics ?? prev.analytics ?? null,
    query_log_id: row.query_log_id || prev.query_log_id || null,
    chunk_count: envelope?.coverage?.chunk_count ?? citations.length,
    timing_ms: spent?.wall_ms != null ? { total: spent.wall_ms, grok: meta.grok_ms ?? null } : prev.timing_ms,
    tokens,
    model: meta.model || prev.model || null,
    entity_used: meta.entity_used ?? prev.entity_used ?? null,
    retrieval_strategy: meta.retrieval_strategy ?? prev.retrieval_strategy ?? null,
    bundle_id: meta.bundle_id ?? prev.bundle_id ?? null,
    debug_pipeline: meta.debug_pipeline ?? prev.debug_pipeline ?? null,
    web_citations: Array.isArray(meta.web_citations) ? meta.web_citations : (prev.web_citations || []),
    web_search_used: meta.web_search_used ?? prev.web_search_used,
    web_search_calls: meta.web_search_calls ?? prev.web_search_calls,
    finish_reason: meta.finish_reason ?? prev.finish_reason ?? null,
    error: row.state === 'failed' ? describeRunError(row.error) : null,
    ts: prev.ts || Date.now(),
  }
}
