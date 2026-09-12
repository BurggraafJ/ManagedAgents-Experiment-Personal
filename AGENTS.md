# Legal Mind Agent Development Guide

This repository uses a **skill-based routing system** for cloud agents working on the Legal Mind dashboard.

## Quick start

1. **Read the hard-rules first:** `/workspace/CLAUDE.md` contains non-negotiable project rules (realtime helper, no FooV2, anthropic wrapper, version bump, RAG cron verify_jwt:false, edge-deploy 1:1). These always apply.

2. **Check the router:** `.cursor/rules/legal-mind-dev.mdc` routes your work to the right skill based on topic keywords.

3. **Read the matching skill:** `docs/legal-mind-skills/{agent-manager,agent-handbook,database-manager,datascience}/SKILL.md` contains domain-specific guidance and reference links.

## Skill domains

| **Skill** | **Use for** | **Path** |
|-----------|-------------|----------|
| **agent-manager** | Agent runs, schedules, health monitoring, cron jobs | `docs/legal-mind-skills/agent-manager/` |
| **agent-handbook** | Auth, Vault secrets, deployment, git, logging, security, edge functions | `docs/legal-mind-skills/agent-handbook/` |
| **database-manager** | Tables, views, RPCs, RLS policies, migrations, schema, Postgres optimization | `docs/legal-mind-skills/database-manager/` |
| **datascience** | RAG pipeline, chunks, embeddings, kb-* functions, vector search, chunker | `docs/legal-mind-skills/datascience/` |

## Core principles

- **Live data over memory:** Always query Supabase (project `ezxihctobrqoklufawim`) for current state
- **Hand off across skills:** Complex changes often span multiple domains — read all relevant skills
- **No orchestrator execution:** Never run the daily agent orchestrator; only modify code/config when requested
- **Pre-flight checks:** CLAUDE.md checklist must pass before every push

## Project context

- **Stack:** Vite + React 18 (JavaScript) + Supabase RLS + React Router v6
- **Hosting:** Vercel auto-deploy from `main` branch
- **Live DB:** `ezxihctobrqoklufawim`
- **Vercel project:** `legal-mind-dashboard`
- **Live URL:** https://legal-mind-dashboard-git-main-jelle-burggraaf.vercel.app

## Router logic

The `.cursor/rules/legal-mind-dev.mdc` router automatically loads for every cloud agent. It matches your task keywords to the right skill, ensuring you have the correct context before making changes.

**Default:** If no keyword matches, read `agent-handbook/SKILL.md` as the operational fallback.
