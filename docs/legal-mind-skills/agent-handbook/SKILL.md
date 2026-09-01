# Legal Mind Agent Handbook Skill

**Domain:** Authentication, Vault secrets, deployment, git workflows, logging, security, and operational infrastructure.

## Scope

Use this skill when working on:
- **Authentication**: Supabase Auth integration, RLS policies (row-level security), user sessions
- **Vault secrets**: `skill:anthropic:api_key`, cron_secret, service_role tokens
- **Deployment**: Vercel deploys, edge function deployment (`deploy_edge_function` MCP), environment variables
- **Git workflows**: Branch management, PR creation, commit strategy
- **Logging**: `claude_api_calls`, `security_findings`, edge function logs, error tracking
- **Security**: Security findings, audit logs, access control, vulnerability monitoring
- **Edge Functions**: Supabase Edge Functions (Deno runtime), verify_jwt configuration

## Core principles

1. **Live data first:** Query Supabase project `ezxihctobrqoklufawim` for current auth, logs, and security state. Never rely on stale memory.

2. **Hand off to other skills:**
   - **Database schema** (new tables, RLS, migrations) → read `database-manager/SKILL.md`
   - **Agent scheduling** (cron jobs, orchestrator) → read `agent-manager/SKILL.md`
   - **RAG pipeline** (chunker, kb-*, embeddings) → read `datascience/SKILL.md`

3. **Edge-deploy hard-rule:** When deploying edge functions via MCP `deploy_edge_function`, **always read the repo file(s) fully and paste the content verbatim**. Never reconstruct from memory. See `/workspace/CLAUDE.md` "Edge-deploy via MCP-paste = repo-file 1:1" for details.

4. **RAG cron functions:** Edge Functions called by pg_cron or server-to-server **must** use `verify_jwt: false`. See `/workspace/CLAUDE.md` "RAG-cron Edge Functions = verify_jwt:false" for the full list and exception (`kb-compose` uses `verify_jwt: true`).

5. **Anthropic wrapper:** All Anthropic API calls from edge functions must use `callAnthropic()` from `_shared/anthropic-fetch.ts`. Never call `fetch('https://api.anthropic.com/v1/messages')` directly. See `/workspace/CLAUDE.md` "Anthropic-calls via centrale wrapper".

6. **Hard-rules apply:** Before any commit, validate against `/workspace/CLAUDE.md` hard-rules:
   - Realtime channels via `createRealtimeChannel()` helper
   - Version bump for visible changes
   - Pre-flight checklist (build, grep checks, audit scripts)

## Reference documentation

See `references/` directory for:
- Edge function deployment patterns and examples
- Vault secret access and rotation procedures
- RLS policy templates and testing strategies
- Logging schema and query patterns
- Security finding remediation workflows
- Git branching and PR templates

*(Note: `references/` files are populated by the team; consult them before making changes.)*

## Project metadata

- **Live DB:** `ezxihctobrqoklufawim`
- **Vercel project:** `legal-mind-dashboard`
- **Live URL:** https://legal-mind-dashboard-git-main-jelle-burggraaf.vercel.app

## Cross-skill workflow example

**Task:** "Deploy a new edge function that queries agent health and logs failures"

1. Read this skill (`agent-handbook/SKILL.md`) for edge function deployment and logging
2. Read `agent-manager/SKILL.md` for agent health query patterns
3. Read `database-manager/SKILL.md` if new log tables or RLS policies are needed
4. Read repo edge function file(s) fully before `deploy_edge_function` MCP call
5. Set `verify_jwt: false` if the function is called by cron; `true` if called by browser
6. Test with one behavioral call after deploy (not just 200-check)
7. Validate all changes against `/workspace/CLAUDE.md` pre-flight checklist

## See also

- `/workspace/.cursor/rules/legal-mind-dev.mdc` — skill routing logic
- `/workspace/AGENTS.md` — skill system overview
- `/workspace/CLAUDE.md` — project hard-rules (edge-deploy, RAG cron verify_jwt, anthropic wrapper)
