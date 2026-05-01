---
name: agent-handbook
description: >
  Handboek voor Legal Mind's tech-stack. Vier domein-playbooks. Trigger bij vragen
  over Platform/Deployment (Vercel, React, git, Edge Functions), Database (Supabase
  migrations, RPC, RLS, pg_cron, HNSW, sync_health), Security (settings.json,
  allowlist, secret rotation, PAT), Confluence (page-aanmaak, fase-structuur,
  koffie-documenten, sessies, naming-conventies) of Skill Backup (skills naar GitHub,
  persoonlijk vs. generiek). Voorbeelden: "hoe deploy ik dit", "git push faalt",
  "RLS policy", "settings.json review", "secret in git", "nieuwe Confluence-pagina",
  "waar hoort dit document", "skills backuppen". Voor RAG, embeddings, MMR, GraphRAG
  of match_all_sources: delegeer naar de datascience skill. Trigger NIET voor
  agent-orchestration of dashboard-architectuur (delegeer naar agent-manager).
---

# Agent Handbook — Legal Mind

Referentie-handboek voor `agent-manager`. Vier domein-playbooks in `references/`; data science heeft een eigen skill.

## Routerings-tabel

| Vraag | Playbook |
|---|---|
| Deploy, Vercel, git, React, Edge Functions, dashboard-react | `references/platform.md` |
| Migrations, RPC vs trigger, RLS, pg_cron, HNSW, sync_health | `references/database.md` |
| settings.json, allowlist, secrets, PAT, sandbox bootstrap | `references/security.md` |
| Confluence — page aanmaken/updaten/verwijderen, fase-structuur, koffie-doc, projecten, sessies, beslisboom-sectie, naming, onderhoudsregels | `references/confluence.md` |
| Skills backuppen naar GitHub, persoonlijke vs generieke skills, herstel na herinstallatie | `references/skill-backup.md` |
| RAG, embeddings, MMR, recency, GraphRAG, match_all_sources, RAG Quality Engineering | **`datascience` skill laden** |

Bij twijfel of cross-domein: lees alle relevante playbooks. Cite expliciet welke je gebruikt: *"Volgens database.md…"*.

## Werkwijze

1. Bepaal welke playbook(s) relevant zijn.
2. Lees ze eerst.
3. Pas dan antwoorden.
4. Bij data-science vragen: laad de `datascience` skill — die heeft de diepe playbooks.

## Wanneer overdragen

| Vraag | Skill |
|---|---|
| Diepe `.claude/settings.json` audit | `security-settings` |
| Skill-iteratie / schedules / orchestrator | `agent-manager` |
| Dashboard code-changes | `dashboard-refresh` (cowork) |
| RAG, embeddings, MMR, GraphRAG, retrieval-tuning | `datascience` |

## Schaalbaarheid

Splits een playbook af naar eigen skill bij: file > 12KB · > 5×/week geraadpleegd · > 5 sub-references nodig.
Data science is afgesplitst naar de `datascience` skill (4 playbooks, 36KB).

## Bijbehorende bestanden

- `references/platform.md` — Vercel + Git + React/Vite + Edge Functions
- `references/database.md` — Supabase migrations + RPC patterns + RLS + pg_cron + HNSW
- `references/security.md` — secret-storage in agent_config + allowlist + rotatie-flows
- `references/confluence.md` — spaces, zes-secties-structuur, beslisboom, fase-templates, koffie-doc-vorm, naming-conventies, onderhoudsregels (samenvattend kompas; live page id `412483585` is bron-van-waarheid)
- `references/skill-backup.md` — backup persoonlijke skills naar GitHub: locaties, filter generiek vs. persoonlijk, stappenplan, herstel
