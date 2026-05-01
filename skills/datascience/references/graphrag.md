# GraphRAG roadmap — wanneer wel/niet, hoe migreren

## TL;DR

**Vector RAG (huidig)**: snel, simpel, werkt voor "wat lijkt hier op". Bij ~20k entities ruim voldoende.

**GraphRAG**: nodig zodra **multi-hop redenering** essentieel wordt — vragen als "welke deals van klanten van type X zijn behandeld door owner Y in maand Z" werken slecht via pure similarity.

**Voor Legal Mind**: nu nog Vector RAG. Roadmap voor GraphRAG-migratie alleen als concrete bottleneck verschijnt — niet preventief bouwen.

## Verschillen kort

| Aspect | Vector RAG (huidig) | GraphRAG |
|---|---|---|
| Datastructuur | Embeddings + cosine similarity | Knowledge graph (nodes + edges) over entities |
| Query | "lijk op deze tekst" | "vind pad/relatie tussen X en Y" |
| Schaalbaarheid | Goed tot ~10M vectors zonder partitioning | Vereist graph-DB (Neo4j, Memgraph) of pgRouting |
| Bouwkosten | 1 dim-vector per entity ($0.02 per 1M tokens) | Entity-extraction (LLM-call per record, ~5x duurder) + edge-resolution |
| Onderhoud | Re-embed bij content-wijziging | Re-extract bij content + edge-mutations bij relatie-wijziging |
| Antwoordkwaliteit | Goed bij similarity-vragen | Goed bij relation-vragen, EN je kunt de graph traversal als "reasoning trace" tonen |

## Wanneer is GraphRAG noodzakelijk?

Concrete signalen:

1. **Multi-hop queries falen**: "Welke kantoren zijn in 2025 met onze sales-pipeline gestart maar geen offerte ontvangen" — vereist join over deal-stages, contacts, mails. Vector RAG matcht woorden, niet relaties.
2. **Multi-document synthesis nodig**: "Wat is de status van klant X in alle systemen" — nu doe je via 6× `match_all_sources` met `filter_company_id`. Werkt, maar je krijgt 30 records die de skill moet samenvatten. Met graph: één traversal, gestructureerde samenvatting.
3. **Dataset > 100k entities**: HNSW recall begint te degraden, en de ratio "relevant per top-K" zakt. Graph kan slimmer prunen.

**Geen van deze drie is in 2026 voor Legal Mind hard issue.** ~20k entities, vragen zijn 80% similarity-based, multi-system queries doen we via filter_company_id en SQL-joins.

## Hybride: graph-light bovenop Vector RAG

Tussenoplossing als je toch graph-properties wil zonder Neo4j:

- Bestaande relaties in HubSpot zijn al graph-edges: `hubspot_deals.associated_company_ids`, `hubspot_deals.associated_contact_ids`, `hubspot_engagements.associated_*`
- Jira heeft `parent_key`, sprint-membership
- Mail: `conversation_id` is een natuurlijke thread-edge

Bouw **één view** die deze als edges presenteert:

```sql
CREATE OR REPLACE VIEW v_entity_edges AS
  SELECT 'deal' AS src_type, deal_id AS src_id, 'company' AS dst_type, c::text AS dst_id, 'belongs_to' AS edge_type
    FROM hubspot_deals, unnest(associated_company_ids) c
  UNION ALL
  SELECT 'engagement', id, 'deal', d::text, 'about'
    FROM hubspot_engagements, unnest(associated_deal_ids) d
  UNION ALL
  SELECT 'mail', id::text, 'mail', conversation_id::text, 'in_thread'
    FROM mail_messages
   WHERE conversation_id IS NOT NULL
  UNION ALL
  SELECT 'jira', issue_key, 'jira', parent_key, 'sub_of'
    FROM jira_issues
   WHERE parent_key IS NOT NULL;
```

Dan kun je in een nieuwe RPC `match_with_neighbors(query_embedding, hop_depth)` eerst Vector RAG doen, daarna 1-hop neighbors expanderen. **80% van GraphRAG-waarde, 5% van de complexiteit.**

## Migration-pad ALS we ooit naar full GraphRAG gaan

Volgorde (niet uitvoeren tenzij signaal er is):

| Fase | Wat | Risico |
|---|---|---|
| **G.1 Edge-view** | Bouw `v_entity_edges` over bestaande FK-relaties (zie hybride hierboven). Gratis. | Laag |
| **G.2 Hybride RPC** | `match_with_neighbors` — Vector top-K + 1-hop expansion via edge-view | Laag |
| **G.3 Entity-extraction** | LLM-call op elke entity om "named entities" eruit te halen (personen, organisaties, projecten). Schrijf naar `entity_mentions` tabel. | Medium — kost €€€ op 20k records (~€20-50) |
| **G.4 Resolved edges** | Match named entities cross-source. "Veerle Branderhorst" in mail = `legal-mind-contacts.contact_id=42` | Medium — fuzzy matching, edge-resolution-ratio meten |
| **G.5 Graph-DB** | Migreer naar Neo4j of Memgraph als pgRouting+CTE niet meer voldoen. | Hoog — nieuwe stack, sync-pipeline op te bouwen |

Tot G.2 blijft alles in Postgres. G.3+ is een echt project.

## Beslis-criterium: wanneer agenderen?

Trigger het project "GraphRAG-migration" als **één van de volgende geldt**:

- ≥ 5 user-cases in 1 maand waarin Vector RAG ruis geeft op multi-hop vragen
- Acceptance-rate op AutoDraft plateau bij 70-80% en blijft 4 weken liggen, terwijl analyse zegt "ontbreekt context van andere systemen"
- Aantal entities > 100k EN HNSW recall onder 90% gemeten op gold-set
- Een specifiek skill-feature vereist het (bv. "geef me alle interacties met dit kantoor van afgelopen 2 jaar over alle systemen heen, gecategoriseerd")

**Tot dan**: Vector RAG verfijnen via Quality Engineering (MMR, recency, citation, threshold-tuning). Daar zit de marginale-winst nu.

## Anti-pattern: te vroeg GraphRAG

Veel teams bouwen GraphRAG als "het is nieuwer dus beter". In de praktijk:

- 80% van retrieval-vragen is similarity-based. Graph is overkill.
- Entity-extraction is foutgevoelig (LLM hallucineert namen)
- Onderhoudslast bij elke schema-wijziging
- Je verliest de eenvoud van `match_all_sources` als enkel-RPC-API

Beter: **Vector RAG met smart filters** (zoals filter_company_id, filter_owner_id, filter_after) + post-retrieval LLM-synthesis dekt al heel veel.

## Referentie-leesvoer

- [Microsoft GraphRAG paper (2024)](https://arxiv.org/abs/2404.16130) — wanneer het écht meerwaarde geeft
- [Anthropic Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval) — Vector RAG met context-augmentation, simpeler dan GraphRAG
- [pgvector + pgRouting combo](https://github.com/pgvector/pgvector) — hybride graph zonder Neo4j
