---
name: datascience
description: >
  Specialist in RAG-architectuur, embeddings en vector retrieval voor Legal Mind.
  Vier playbooks: embeddings (model-keuze text-embedding-3-small, input-design per
  source, hash-dedup, kosten), retrieval (match_all_sources v2, MMR, recency-bias,
  threshold-tuning, cross-source zoeken), quality (F.1-F.7 RAG Quality Engineering
  fasen, acceptance-rate meting, autodraft-rag-prefill), graphrag (Vector vs Graph,
  hybride pad via v_entity_edges, wanneer migreren). Trigger bij vragen als "hoe tune
  ik MMR", "retrieval geeft te weinig resultaten", "GraphRAG vs Vector RAG", "embedding
  model upgraden", "RAG Quality Engineering fasen", "match_all_sources debuggen".
  Gebruik op afroep — voor algemene tech-vragen is agent-handbook het startpunt.
  Trigger NIET voor agent-orchestration of dashboard-code.
---

# Data Science — RAG & Vector Retrieval

Specialistisch playbook voor Legal Mind's RAG-stack. Vier domeinen, elk een eigen reference.

## Routerings-tabel

| Vraag | Playbook |
|---|---|
| **Helikopterview, doelarchitectuur, migratiepad, "hoe zit het allemaal in elkaar"** | **`references/current_architecture.md`** (lees als eerste bij architectuur-vragen) |
| Embedding model-keuze, input-design per source, hash-dedup, kosten | `references/embeddings.md` |
| `match_all_sources` / `match_chunks` tunen, MMR, recency-bias, threshold, cross-source | `references/retrieval.md` |
| RAG Quality Engineering fasen F.1-F.7, acceptance-rate, A/B-design | `references/quality.md` |
| Vector RAG vs GraphRAG, hybride pad, wanneer migreren | `references/graphrag.md` |
| **Fireflies — chunking, categorisatie, audience/privacy, drie-laags + intent-recepten** | **`references/fireflies.md`** (specifieke deep-dive, aanvullend op §10-§11 van `current_architecture.md`) |

## Werkwijze

1. Bepaal welke playbook relevant is.
2. Lees die eerst volledig.
3. Bij quality-vragen: begin met `SELECT sync_health_all();` om verse pipeline-data te bevestigen.
4. Pas dan antwoorden.

## Wanneer overdragen

| Vraag | Skill |
|---|---|
| Platform, Database, Security, Confluence | `agent-handbook` |
| Agent-orchestration, schedules, nieuwe agents | `agent-manager` |
| Dashboard code-wijzigingen | `dashboard-refresh` |

## Bijbehorende bestanden

- `references/current_architecture.md` — **single source of truth** voor de hele stack: huidige staat, eerlijke kritiek, ontwerpprincipes, doelarchitectuur, migratiepad (R.1-R.8), beslismomenten. Werk dit bij in dezelfde commit als elke architectuur-wijziging.
- `references/embeddings.md` — model-keuze, input-design per source, hash-dedup, kosten, edge cases
- `references/retrieval.md` — match_all_sources v2, MMR, recency, threshold-strategieën, smoke-tests
- `references/quality.md` — F.1-F.7 RAG Quality Engineering, rag_quality_baselines tabel, A/B-design
- `references/graphrag.md` — Vector vs GraphRAG vergelijking, hybride v_entity_edges, migratie-pad G.1-G.5
- `references/fireflies.md` — Fireflies deep-dive: drie-laags chunking, categorisatie (audience + meeting-type), privacy (kerk-meetings = 0 chunks), intent-recept-filters, migratiepad F-1 t/m F-7

## Context

Supabase project: `ezxihctobrqoklufawim`. Embedding-model: `text-embedding-3-small` (1536 dim).
RAG Quality Engineering project: https://bg-intelligence.atlassian.net/wiki/spaces/LM/pages/415137797
