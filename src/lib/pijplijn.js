// Pijplijn — de zeven stappen van de RAG-keten, als pure data (v1.183).
//
// Vervangt lib/intelligence.js (PIPELINE_STAGES + STAGE_DETAILS) nu de
// Intelligence-hub uit Organisatie is (Jelle 2026-09-14). De labels en de
// éénregel-omschrijving zijn Jelle's copy; de uitleg per stap is ingekort uit
// de oude hub. Geen React, geen Supabase.

export const STAGES = [
  { id: 'sync',     nr: 1, label: 'Sync',     desc: 'Outlook · HubSpot · Jira · Fireflies · Calendar' },
  { id: 'chunk',    nr: 2, label: 'Chunk',    desc: '9 source-types → chunks-tabel (halfvec 3072)' },
  { id: 'embed',    nr: 3, label: 'Embed',    desc: 'text-embedding-3-large + GPT-5-nano context-prefix · 3072d halfvec' },
  { id: 'index',    nr: 4, label: 'Index',    desc: 'HNSW + GIN FTS · v_entity_edges_full' },
  { id: 'retrieve', nr: 5, label: 'Retrieve', desc: 'match_chunks (BM25+vec+RRF) + match_chunks_for_entity' },
  { id: 'consume',  nr: 6, label: 'Consume',  desc: '6 skills · auto-draft · sales-* · daily-admin · agenda · task-organizer' },
  { id: 'quality',  nr: 7, label: 'Quality',  desc: 'rag_outcomes via R.7 op autodraft_decisions' },
]

// Per stap: uitleg, welke agent_runs erbij horen (voor "recente runs"), en de
// tabellen/RPC's die je opent als je het zelf wilt nakijken. `bundleAudit`
// haalt op de Retrieve-stap de laatste context_bundles erbij.
export const STAGE_DETAILS = {
  sync: {
    explainer: 'Elke 5–30 minuten halen de sync-functies nieuwe mails, agenda-items, deals, Jira-issues en Fireflies-meetings op en spiegelen die in Supabase. Die spiegels zijn de bron voor alles wat volgt: zonder verse sync werkt de rest op oude data.',
    agents: ['mail-sync-etl-v2', 'mail-sync', 'hubspot-sync-etl', 'hubspot-sync', 'hubspot-engagements-sync', 'jira-sync-etl', 'jira-sync', 'outlook-calendar-sync-etl', 'outlook-calendar-sync', 'fireflies-sync-etl', 'fireflies-sync'],
    source: 'mail_messages · hubspot_deals · hubspot_companies · hubspot_contacts · hubspot_engagements · jira_issues · calendar_events · fireflies_meetings',
  },
  chunk: {
    explainer: 'De chunker draait elke 5 minuten en knipt nieuwe records uit alle negen bronnen in chunks van ongeveer 200 tot 1500 tekens. GPT-5-nano schrijft per chunk een korte contextregel bovenaan, zodat een los stuk (een mailreply, een notitie) zijn verband bewaart als het later alleen wordt teruggevonden.',
    agents: ['chunker'],
    source: 'chunks.content · chunks.content_with_context · fetch_unchunked_source_ids',
  },
  embed: {
    explainer: 'Elke chunk gaat door OpenAI text-embedding-3-large en wordt een vector van 3072 dimensies (halfvec). Dat is de kern van semantisch zoeken: wat lijkt qua betekenis op de vraag, los van de woordkeuze. Structureel een paar euro per maand; een her-embed van de hele index kost ongeveer $0,40 per duizend chunks.',
    agents: ['chunker'],
    source: 'chunks.embedding (HNSW halfvec_cosine_ops) · metadata.prefix_tokens',
  },
  index: {
    explainer: 'Twee indexen en één view dragen alle zoekvragen. HNSW maakt vector-zoeken sub-seconde over tienduizenden chunks, GIN-FTS doet hetzelfde voor BM25-tekstzoeken, en v_entity_edges_full verbindt mails, contacten, bedrijven en deals met elkaar zodat een vraag over één klant ook de omliggende stukken vindt.',
    agents: [],
    source: 'v_entity_edges_full · entity_resolution · idx HNSW + GIN',
  },
  retrieve: {
    explainer: 'match_chunks combineert per vraag vier signalen: vector-gelijkenis (HNSW), BM25-tekstscore, Reciprocal Rank Fusion en een recency-weging. match_chunks_for_entity pakt eerst de 1-hop buren van een entiteit en zoekt daarbinnen. Elke call laat een context_bundle achter als audit-spoor.',
    agents: [],
    source: 'match_chunks · match_chunks_for_entity · context_bundles',
    bundleAudit: true,
  },
  consume: {
    explainer: 'Elke skill die context nodig heeft roept context-build aan met een intent (een recept). De bundle_id wordt gelogd, zodat de kwaliteitslus later kan meten welke chunks tot een goedgekeurde, aangepaste of afgewezen actie leidden.',
    agents: ['autodraft-rag-prefill', 'auto-draft', 'sales-followups', 'daily-admin', 'task-organizer-fireflies', 'agenda'],
    source: 'context_bundles · context_intents (recepten per intent)',
  },
  quality: {
    explainer: 'rag_outcomes wordt automatisch gevuld door de R.7-trigger op autodraft_decisions: plaatsen als draft telt als accept, aanpassen als amend, negeren of spam als reject. Zo meet de keten zichzelf aan echte beslissingen, niet aan bedachte testvragen.',
    agents: [],
    source: 'rag_outcomes · log_rag_outcome · log_search_feedback',
  },
}

export const SOURCE_LABELS = {
  mail: 'Mail', engagement: 'Engagement', jira: 'Jira',
  deal: 'Deal', company: 'Company', contact: 'Contact',
  meeting: 'Meeting', event: 'Event', calendar: 'Agenda',
  chunks: 'Chunks', confluence: 'Confluence', kb_article: 'Kennisbank',
}

// De cijfers op de stapkaarten. `null` = niet beschikbaar; de kaart toont dan
// een streep, niet een verzonnen getal.
export function stageCounts(data) {
  if (!data) return {}
  const n = (v) => (v == null ? null : Number(v).toLocaleString('nl-NL'))
  const health = data.health
  const healthKeys = health ? Object.keys(health).filter(k => k !== 'all_fresh' && k !== 'checked_at' && health[k] && typeof health[k] === 'object') : []
  const fresh = healthKeys.filter(k => health[k].is_fresh === true).length
  return {
    sync:     health ? `${fresh}/${healthKeys.length} bronnen vers` : null,
    chunk:    data.chunksTotal != null ? `${n(data.chunksTotal)} chunks` : null,
    embed:    data.chunksTotal != null ? `${n(data.chunksTotal)} vectoren · 3072d` : null,
    index:    data.edges != null && data.resolutions != null ? `${n(data.edges)} edges · ${n(data.resolutions)} aliases` : null,
    retrieve: data.bundles7d != null ? `${n(data.bundles7d)} bundels · 7 d` : null,
    consume:  '6 skills',
    quality:  data.outcomes ? `${n(data.outcomes.total)} outcomes` : null,
  }
}
