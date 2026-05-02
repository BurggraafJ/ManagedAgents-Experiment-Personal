---
name: agent-handbook
description: Het handboek voor Legal Mind's tech-stack. Referentie-skill die agent-manager raadpleegt voor "hoe doe ik X". Bevat 5 domein-playbooks. Trigger bij vragen over Platform/Deployment (Vercel, React, git, Edge Functions), Database (Supabase migrations, RPC, RLS, pg_cron, HNSW, sync_health), Security (settings.json, allowlist, secret rotation, PAT), Data Science (RAG, vector, embeddings, MMR, recency, GraphRAG, match_all_sources, mail-embed, autodraft-rag-prefill) of Confluence (page-aanmaak, fase-structuur, koffie-documenten, projecten, sessies, naming-conventies, onderhoudsregels). Voorbeelden "hoe deploy ik dit", "git push faalt", "RLS policy", "settings.json review", "secret in git", "hoe tune ik MMR", "GraphRAG vs Vector RAG", "nieuwe Confluence-pagina aanmaken", "waar hoort dit document", "fase-2-onderzoek toevoegen". Lees altijd eerst de relevante reference uit references voor je antwoordt. Trigger NIET voor pure agent-orchestration, scheduling of dashboard-architectuur (delegeer naar agent-manager).
---

# Agent Handbook — Legal Mind

Referentie-handboek voor `agent-manager`. Vijf domeinen, elk een eigen playbook in `references/`.

## Routerings-tabel

| Vraag | Playbook |
|---|---|
| Deploy, Vercel, git, React, Edge Functions, dashboard-react | `references/platform.md` |
| Migrations, RPC vs trigger, RLS, pg_cron, HNSW, sync_health | `references/database.md` |
| settings.json, allowlist, secrets, PAT, sandbox bootstrap | `references/security.md` |
| RAG, embedding, similarity, MMR, recency, GraphRAG | `references/datascience-*.md` (4 files) |
| Confluence — page aanmaken/updaten/verwijderen, fase-structuur, koffie-doc, projecten, sessies, beslisboom-sectie, naming, onderhoudsregels | `references/confluence.md` |
| Skills backuppen naar GitHub, persoonlijke vs generieke skills, herstel na herinstallatie | `references/skill-backup.md` |

Bij twijfel of cross-domein: lees alle relevante playbooks. Cite expliciet welke je gebruikt: *"Volgens database.md…"*.

## Werkwijze

1. Bepaal welke playbook(s) relevant zijn.
2. Lees ze eerst.
3. Bij data-science vragen: begin met `SELECT sync_health_all();` om verse data te bevestigen.
4. Pas dan antwoorden.

## Wanneer overdragen

| Vraag | Skill |
|---|---|
| Diepe `.claude/settings.json` audit | `security-settings` |
| Skill-iteratie / schedules / orchestrator | `agent-manager` |
| Dashboard code-changes | `dashboard-refresh` (cowork) |

## Schaalbaarheid

Splits een playbook af naar eigen skill bij: file > 12KB · > 5×/week geraadpleegd · > 5 sub-references nodig.

## Bijbehorende bestanden

- `references/platform.md` — Vercel + Git + React/Vite + Edge Functions
- `references/database.md` — Supabase migrations + RPC patterns + RLS + pg_cron + HNSW
- `references/security.md` — secret-storage in agent_config + allowlist + rotatie-flows
- `references/datascience-embeddings.md` — model-keuze, input-design, kosten
- `references/datascience-retrieval.md` — match_all_sources, MMR, recency, threshold-tuning
- `references/datascience-quality.md` — F.1-F.7 fasen RAG Quality Engineering
- `references/datascience-graphrag.md` — Vector vs Graph, hybride pad
- `references/confluence.md` — spaces, zes-secties-structuur, beslisboom, fase-templates, koffie-doc-vorm, naming-conventies, onderhoudsregels (samenvattend kompas; live page id `412483585` is bron-van-waarheid)
- `references/skill-backup.md` — backup persoonlijke skills naar GitHub: locaties, filter generiek vs. persoonlijk, stappenplan, herstel
