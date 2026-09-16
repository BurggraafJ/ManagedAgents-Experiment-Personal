# Legal Mind Agent Manager Skill

**Domain:** Agent orchestration, scheduling, health monitoring, and cron job management.

## Scope

Use this skill when working on:
- **Agent runs** (`agent_runs` table): lifecycle, status, results, run history
- **Agent schedules** (`agent_schedules` table): cron expressions, enabled/disabled state, schedule metadata
- **Health monitoring**: agent staleness checks, failure alerts, retry logic
- **Cron jobs**: pg_cron configuration, schedule changes, execution logs

## Core principles

1. **Live data first:** Always query `agent_runs`, `agent_schedules`, and related tables from Supabase project `ezxihctobrqoklufawim`. Never rely on cached or remembered state.

2. **Hand off to other skills:**
   - **Database changes** (new tables, RLS, RPCs, migrations) → read `database-manager/SKILL.md`
   - **RAG pipeline scheduling** (chunker, kb-curator, context-build crons) → read `datascience/SKILL.md`
   - **Edge function deployment** (auth, logging, Vault secrets) → read `agent-handbook/SKILL.md`

3. **No orchestrator execution:** Do **not** run the daily agent orchestrator or trigger scheduled agents. Only modify orchestrator code, config, or schedule definitions when explicitly requested.

4. **Hard-rules apply:** Before any commit, validate against `/workspace/CLAUDE.md` hard-rules:
   - Realtime channels via `createRealtimeChannel()` helper (never direct `supabase.channel()`)
   - Version bump for visible changes (`src/version.js`)
   - Pre-flight checklist (build, grep checks, no hook duplication)

## Reference documentation

See `references/` directory for:
- Agent run lifecycle and state transitions
- Schedule expression syntax and examples
- Health check implementation patterns
- Cron job configuration and debugging
- Edge Functions for agent orchestration

*(Note: `references/` files are populated by the team; consult them before making changes.)*

## Project metadata

- **Live DB:** `ezxihctobrqoklufawim`
- **Vercel project:** `legal-mind-dashboard`
- **Live URL:** https://legal-mind-dashboard-git-main-jelle-burggraaf.vercel.app

## Cross-skill workflow example

**Task:** "Add a new daily RAG chunker schedule and monitor its health"

1. Read this skill (`agent-manager/SKILL.md`) for schedule creation
2. Read `datascience/SKILL.md` for RAG chunker specifics
3. Read `database-manager/SKILL.md` if new health-check tables are needed
4. Read `agent-handbook/SKILL.md` for edge function deployment (if chunker is updated)
5. Validate all changes against `/workspace/CLAUDE.md` pre-flight checklist

## See also

- `/workspace/.cursor/rules/legal-mind-dev.mdc` — skill routing logic
- `/workspace/AGENTS.md` — skill system overview
- `/workspace/CLAUDE.md` — project hard-rules
