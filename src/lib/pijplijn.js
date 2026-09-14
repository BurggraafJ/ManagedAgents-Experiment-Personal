// Pijplijn — de zeven stappen van de RAG-keten, als pure data (v1.195).
//
// Woont sinds v1.195 onder Instellingen › Uitleg (P9, PRODUCT-PURGE): de
// Organisatie-pagina met de klikbare stappen, de recente runs en het
// bundel-auditspoor is weg. Wat bleef is de uitleg — en per stap één cijfer,
// zodat de tekst niet losraakt van de werkelijkheid.
//
// `explainer` is de copy van de oude detailpagina, ingekort tot twee zinnen;
// `detail` is de technische handgreep (tabel, functie, index) waarmee je het
// zelf kunt nakijken. Geen React, geen Supabase.

export const STAGES = [
  {
    id: 'sync',
    nr: 1,
    label: 'Sync',
    detail: 'mail_messages · hubspot_* · jira_issues · calendar_events · fireflies_meetings',
    explainer: 'Elke 5 tot 30 minuten halen de sync-functies nieuwe mails, agenda-items, deals, Jira-issues en meetings op en spiegelen die in Supabase. Die spiegels zijn de bron voor alles wat volgt: zonder verse sync werkt de rest op oude data.',
  },
  {
    id: 'chunk',
    nr: 2,
    label: 'Chunk',
    detail: 'chunks.content · chunks.content_with_context · fetch_unchunked_source_ids',
    explainer: 'De chunker knipt nieuwe records uit negen bronnen in stukken van ongeveer 200 tot 1500 tekens. Een klein model schrijft er een contextregel bovenop, zodat een losse mailreply zijn verband bewaart als hij later alleen wordt teruggevonden.',
  },
  {
    id: 'embed',
    nr: 3,
    label: 'Embed',
    detail: 'text-embedding-3-large · 3072d halfvec · metadata.prefix_tokens',
    explainer: 'Elke chunk wordt een vector van 3072 dimensies. Dat is de kern van semantisch zoeken: wat lijkt qua betekenis op de vraag, los van de woordkeuze. Structureel een paar euro per maand; de hele index opnieuw doen kost ongeveer $0,40 per duizend chunks.',
  },
  {
    id: 'index',
    nr: 4,
    label: 'Index',
    detail: 'HNSW (halfvec_cosine_ops) · GIN FTS · v_entity_edges_full',
    explainer: 'Twee indexen en één view dragen alle zoekvragen. HNSW maakt vector-zoeken sub-seconde, GIN-FTS doet hetzelfde voor tekstzoeken, en de edge-view verbindt mails, contacten, bedrijven en deals zodat een vraag over één klant ook de omliggende stukken vindt.',
  },
  {
    id: 'retrieve',
    nr: 5,
    label: 'Retrieve',
    detail: 'match_chunks · match_chunks_for_entity · context_bundles',
    explainer: 'match_chunks combineert per vraag vier signalen: vector-gelijkenis, BM25-tekstscore, Reciprocal Rank Fusion en een recency-weging. Elke call laat een context_bundle achter, zodat achteraf te zien is welke stukken een antwoord droegen.',
  },
  {
    id: 'consume',
    nr: 6,
    label: 'Consume',
    detail: 'context_intents (recept per intent) · context_bundles.bundle_id',
    explainer: 'Elke skill die context nodig heeft — AutoDraft, de agenda, daily-admin — roept context-build aan met een intent: een recept dat zegt wat er in de bundel hoort. Het bundle_id gaat mee, zodat de kwaliteitslus het antwoord later kan terugvinden.',
  },
  {
    id: 'quality',
    nr: 7,
    label: 'Quality',
    detail: 'rag_outcomes · log_rag_outcome · log_search_feedback',
    explainer: 'Wat je met een concept doet telt terug: plaatsen als draft is een accept, aanpassen een amend, negeren een reject. Zo meet de keten zichzelf aan echte beslissingen in plaats van aan bedachte testvragen.',
  },
]

// Het cijfer onder elke stap. `null` = niet beschikbaar; de stap toont dan een
// streep, niet een verzonnen getal.
export function stageCounts(data) {
  if (!data) return {}
  const n = (v) => (v == null ? null : Number(v).toLocaleString('nl-NL'))
  const health = data.health
  const healthKeys = health
    ? Object.keys(health).filter(k => k !== 'all_fresh' && k !== 'checked_at' && health[k] && typeof health[k] === 'object')
    : []
  const fresh = healthKeys.filter(k => health[k].is_fresh === true).length
  return {
    sync:     health ? `${fresh}/${healthKeys.length} bronnen vers` : null,
    chunk:    data.chunksTotal != null ? `${n(data.chunksTotal)} chunks` : null,
    embed:    data.chunksTotal != null ? `${n(data.chunksTotal)} vectoren · 3072d` : null,
    index:    data.edges != null && data.resolutions != null ? `${n(data.edges)} edges · ${n(data.resolutions)} aliases` : null,
    retrieve: data.bundles7d != null ? `${n(data.bundles7d)} bundels · 7 d` : null,
    // Consume heeft geen cijfer. "6 skills" stond hier tot v1.194 hard-coded;
    // dat is productkennis die verouderd zodra er een zevende bijkomt, geen
    // meting. Liever geen getal dan een getal dat stilletjes verkeerd wordt.
    quality:  data.outcomes != null ? `${n(data.outcomes)} outcomes` : null,
  }
}
