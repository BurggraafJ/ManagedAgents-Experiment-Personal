// Pure helpers + constanten voor Intelligence Hub + Quality views.
// Geen React; geen Supabase.

export const PIPELINE_STAGES = [
  { id: 'sync',     label: 'Sync',     desc: 'Outlook · HubSpot · Jira · Fireflies · Calendar' },
  { id: 'chunk',    label: 'Chunk',    desc: '9 source-types → chunks-tabel (halfvec 3072)' },
  { id: 'embed',    label: 'Embed',    desc: 'text-embedding-3-large + GPT-5-nano context-prefix' },
  { id: 'index',    label: 'Index',    desc: 'HNSW + GIN FTS · v_entity_edges_full' },
  { id: 'retrieve', label: 'Retrieve', desc: 'match_chunks (BM25+vec+RRF) + match_chunks_for_entity' },
  { id: 'consume',  label: 'Consume',  desc: '6 skills · auto-draft · sales-* · daily-admin · agenda · task-organizer' },
  { id: 'quality',  label: 'Quality',  desc: 'rag_outcomes via R.7 trigger op autodraft_decisions' },
]

export const STAGE_DETAILS = {
  sync: {
    explainer: "Haalt elke 15-30 min nieuwe mails, agenda-items, deals, Jira-issues en Fireflies-meetings binnen via externe APIs en spiegelt die in Supabase als 'truth-of-source mirrors'. Zonder verse sync valt het hele systeem terug op oude data.",
    agents: ['mail-sync-etl-v2', 'hubspot-sync-etl', 'hubspot-engagements-sync', 'jira-sync-etl', 'outlook-calendar-sync-etl', 'fireflies-sync-etl'],
    source: 'mail_messages · hubspot_deals · hubspot_companies · hubspot_contacts · jira_issues · calendar_events · fireflies_meetings',
  },
  chunk: {
    explainer: "De chunker draait elke 5 min, knipt nieuwe records uit alle 9 bronnen in 'chunks' (logische stukken tekst, ~200-1500 chars per chunk). Per chunk schrijft GPT-5-nano een korte contextuele samenvatting bovenaan zodat losse stukjes (bv. mail-replies) hun verband bewaren bij retrieval.",
    agents: ['chunker'],
    source: 'chunks.content + chunks.content_with_context',
  },
  embed: {
    explainer: "Elke chunk wordt door OpenAI text-embedding-3-large vertaald naar een 3072-dim vector (halfvec). Dat is de kern van semantic search: 'wat lijkt qua betekenis op de vraag, ongeacht woordkeuze'. ~$0.05/maand structureel; eenmalige re-embed kostte ~$0.50.",
    agents: ['chunker'],
    source: 'chunks.embedding (HNSW halfvec_cosine_ops)',
  },
  index: {
    explainer: "Twee indexen + één view dragen alle queries. HNSW maakt vector-search sub-second over 20k chunks. GIN-FTS doet hetzelfde voor BM25-tekst-zoek. v_entity_edges_full verbindt mails ↔ contacts ↔ companies ↔ deals via 36k edges.",
    agents: [],
    source: 'v_entity_edges_full · entity_resolution · idx HNSW + GIN',
  },
  retrieve: {
    explainer: "match_chunks combineert per query: HNSW vector-similarity, BM25 ts_rank_cd, Reciprocal Rank Fusion en recency-weight. match_chunks_for_entity pakt eerst 1-hop edges van een entity en zoekt daarbinnen.",
    agents: [],
    source: 'match_chunks · match_chunks_for_entity · context_bundles (audit-trail)',
    bundleAudit: true,
  },
  consume: {
    explainer: "Elke skill die context nodig heeft roept context-build aan met een intent. Bundle_id wordt gelogd zodat de quality-loop later kan meten welke chunks tot accept/amend/reject leidden.",
    agents: ['autodraft-rag-prefill', 'sales-followups', 'daily-admin', 'task-organizer-fireflies', 'agenda'],
    source: 'context_bundles · context_intents (recipes per intent)',
  },
  quality: {
    explainer: "rag_outcomes wordt automatisch gevuld door een trigger op autodraft_decisions: send → accept, amend → amend, ignore/spam → reject. Plus zoekpagina-feedback (✓/✕) schrijft direct via log_search_feedback.",
    agents: [],
    source: 'rag_outcomes · log_rag_outcome RPC · log_search_feedback RPC',
  },
}

export const DECISIONS = [
  { id: 'B.1', status: '✓', title: 'Contextual augmentation: GPT-5-nano',
    body: '~€15 eenmalig + €3/maand. Templates per source-type definitief geversioneerd (§11.6).' },
  { id: 'B.2', status: '✓', title: 'Embedding: text-embedding-3-large + halfvec(3072)',
    body: 'Cutover compleet 2026-05-03. 20.698 records herembed.' },
  { id: 'B.3', status: '✓', title: 'GraphRAG: graph-light',
    body: 'Postgres views + 1-hop entity-traversal. Volle GraphRAG pas heroverwegen bij ≥5 multi-hop fails/maand.' },
  { id: 'B.4', status: '✓', title: 'autodraft-rag-prefill blijft, vervangt later context-build',
    body: 'In R.6 vervangen door generieke CaaS-endpoint.' },
  { id: 'B.5', status: '✓', title: 'Maandbudget intelligence-stack',
    body: '~€3-5/maand structureel. Ruim binnen €50/maand budget.' },
  { id: 'B.6', status: '✓', title: 'Owner: datascience skill',
    body: 'Single source of truth = current_architecture.md.' },
  { id: 'B.7', status: '○', title: 'LLM-rerank (Stage F)',
    body: 'Geparkeerd als optionele R.10. Alleen als R.7 baseline plateau bij 70-80% acceptance laat zien.' },
]

export const SOURCE_LABELS = {
  mail: 'Mail', engagement: 'Engagement', jira: 'Jira',
  deal: 'Deal', company: 'Company', contact: 'Contact',
  meeting: 'Meeting', event: 'Event',
  embedding: 'Embedding', chunks: 'Chunks', lesson: 'Lesson',
}

export const OUTCOME_COLORS = {
  accept:  '#22c55e',
  amend:   '#f59e0b',
  reject:  '#94a3b8',
  pending: 'var(--text-muted)',
  timeout: '#ef4444',
  error:   '#ef4444',
}

/**
 * Format Euro met 2 of 4 decimalen afhankelijk van bedrag.
 */
export function formatEur(n) {
  if (n == null) return '–'
  return '€' + n.toFixed(n < 0.10 ? 4 : 2)
}

/**
 * Percentage helper voor StatRow.
 */
export function pct(n, d) {
  if (!d) return '–'
  return `${((n / d) * 100).toFixed(1)}%`
}
