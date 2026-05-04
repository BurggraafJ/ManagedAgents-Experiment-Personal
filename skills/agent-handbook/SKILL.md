---
name: agent-handbook
description: Handboek voor Legal Mind's tech-stack. Referentie-skill die agent-manager raadpleegt voor "hoe doe ik X". Zes domein-playbooks. Trigger bij vragen over Authenticatie (Vault, Composio MCP/REST, fallbacks, HubSpot writes), Platform/Deployment (Vercel, React, git, Edge Functions), Database (Supabase migrations, RPC, RLS, pg_cron, HNSW, sync_health), Security (settings.json allowlist, RLS-architectuur), Data Science (RAG, embeddings, MMR, GraphRAG, match_all_sources) of Confluence (page-aanmaak, fase-structuur, projecten, naming-conventies). Voorbeelden "hoe doe ik auth", "Vault secret lezen", "Composio fallback", "hoe deploy ik dit", "git push faalt", "RLS policy", "secret in git", "hoe tune ik MMR", "nieuwe Confluence-pagina aanmaken". Lees eerst de relevante reference voor je antwoordt. Trigger NIET voor agent-orchestration, scheduling of dashboard-architectuur (delegeer naar agent-manager).
---

# Agent Handbook — Legal Mind

Referentie-handboek voor `agent-manager`. Zes domeinen, elk een eigen playbook in `references/`.

## Routerings-tabel

| Vraag | Playbook |
|---|---|
| **Authenticatie — Vault, Composio (MCP/REST/v2-proxy), Cloud-MCP, secrets, fallbacks, HubSpot writes** | **`references/authentication.md`** (single source of truth, sinds 2026-05-03) |
| Deploy, Vercel, git, React, Edge Functions, dashboard-react | `references/platform.md` |
| Migrations, RPC vs trigger, RLS, pg_cron, HNSW, sync_health | `references/database.md` |
| settings.json, allowlist, sandbox bootstrap (`.claude/`-niveau, niet secret-storage) | `references/security.md` |
| RAG, embedding, similarity, MMR, recency, GraphRAG | `references/datascience-*.md` (4 files) |
| Confluence — page aanmaken/updaten/verwijderen, fase-structuur, koffie-doc, projecten, sessies, beslisboom-sectie, naming, onderhoudsregels | `references/confluence.md` |
| Skills backuppen naar GitHub, persoonlijke vs generieke skills, herstel na herinstallatie | `references/skill-backup.md` |

**Sinds 2026-05-03:** alle auth-vragen (Vault-secrets, Composio MCP/REST, Cloud-MCP fallbacks, HubSpot association-writes, Supabase DB-toegang) lopen via één file: `references/authentication.md`. Skills hebben daar één pointer-regel naartoe in plaats van een eigen auth-blok. Eén bron-van-waarheid, geen invariants/implementatie split. Zie Confluence project "Authenticatie als single source of truth" (id 422707202).

Bij twijfel of cross-domein: lees alle relevante playbooks. Cite expliciet welke je gebruikt: *"Volgens database.md…"*.

## Werkwijze

1. Bepaal welke playbook(s) relevant zijn.
2. Lees ze eerst.
3. Bij data-science vragen: begin met `SELECT sync_health_all();` om verse data te bevestigen.
4. Pas dan antwoorden.

## Wanneer overdragen

| Vraag | Skill |
|---|---|
| Skill-iteratie / schedules / orchestrator | `agent-manager` |
| Dashboard code-changes | `dashboard-refresh` (cowork) |
| Live security-monitoring (DB scans) | `security-monitor` |

## Schaalbaarheid

Splits een playbook af naar eigen skill bij: file > 12KB · > 5×/week geraadpleegd · > 5 sub-references nodig.

## Bijbehorende bestanden

- `references/authentication.md` — **single source of truth voor auth.** Drie kanalen (Vault / Composio / Cloud-MCP), code-templates, HubSpot v2/proxy uitzondering, bootstrap, glossary, anti-patterns, checklist
- `references/platform.md` — Vercel + Git + React/Vite + Edge Functions
- `references/database.md` — Supabase migrations + RPC patterns + RLS + pg_cron + HNSW
- `references/security.md` — `.claude/settings.json` allowlist + RLS-architectuur (3 hardening rondes 2026-05-02). Voor secret-storage zelf: pointer naar `authentication.md`.
- `references/datascience-embeddings.md` — model-keuze, input-design, kosten
- `references/datascience-retrieval.md` — match_all_sources, MMR, recency, threshold-tuning
- `references/datascience-quality.md` — F.1-F.7 fasen RAG Quality Engineering
- `references/datascience-graphrag.md` — Vector vs Graph, hybride pad
- `references/confluence.md` — spaces, zes-secties-structuur, beslisboom, fase-templates, koffie-doc-vorm, naming-conventies, onderhoudsregels (samenvattend kompas; live page id `412483585` is bron-van-waarheid)
- `references/skill-backup.md` — backup persoonlijke skills naar GitHub: locaties, filter generiek vs. persoonlijk, stappenplan, herstel
- `references/composio-rest-fallback.md` — **DEPRECATED 2026-05-03**, stub die naar `authentication.md` verwijst. Te verwijderen vanaf 2026-06-03.
