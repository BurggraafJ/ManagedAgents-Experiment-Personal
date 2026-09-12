# Legal Mind Database Manager Skill

**Domain:** Postgres schema, tables, views, RPCs, RLS policies, migrations, and database optimization.

## Scope

Use this skill when working on:
- **Tables**: Schema design, column types, constraints, indexes
- **Views**: Materialized views, view definitions, query optimization
- **RPCs**: Postgres functions (PL/pgSQL), function arguments, return types
- **RLS policies**: Row-level security rules, policy testing, access control
- **Migrations**: Schema migrations, migration rollback, migration history
- **Optimization**: Query performance, index strategy, explain plans, connection pooling

## Core principles

1. **Live data first:** Always query Supabase project `ezxihctobrqoklufawim` for current schema, policies, and table state. Use `list_tables`, `execute_sql`, `get_advisors` MCP tools. Never rely on stale schema knowledge.

2. **Hand off to other skills:**
   - **RAG tables** (chunks, embeddings, kb-* data) → read `datascience/SKILL.md`
   - **Agent tables** (agent_runs, agent_schedules) → read `agent-manager/SKILL.md`
   - **RLS for auth** (user roles, security policies) → read `agent-handbook/SKILL.md`

3. **Migration strategy:** Before applying migrations to production:
   - Test locally with Supabase CLI (`supabase db reset`, `supabase db push`)
   - Use `apply_migration` MCP tool with caution (changes go directly to remote)
   - Include rollback plan in migration comments

4. **RLS testing:** After creating or modifying RLS policies:
   - Test with different user roles (anon, authenticated, service_role)
   - Verify policies don't leak data across tenants/users
   - Check policy performance impact (use `EXPLAIN`)

5. **Hard-rules apply:** Before any commit, validate against `/workspace/CLAUDE.md` hard-rules:
   - Realtime channels via `createRealtimeChannel()` helper
   - Version bump for visible changes
   - Pre-flight checklist

## Reference documentation

See `references/` directory for:
- Schema design patterns and naming conventions
- RLS policy templates and examples
- Migration best practices and rollback procedures
- Index strategy and query optimization guides
- Common RPC patterns (CRUD, aggregations, admin functions)

*(Note: `references/` files are populated by the team; consult them before making changes.)*

## Project metadata

- **Live DB:** `ezxihctobrqoklufawim`
- **Vercel project:** `legal-mind-dashboard`
- **Live URL:** https://legal-mind-dashboard-git-main-jelle-burggraaf.vercel.app

## Cross-skill workflow example

**Task:** "Add a new table for agent health metrics with RLS and a cron job to populate it"

1. Read this skill (`database-manager/SKILL.md`) for table design and RLS
2. Read `agent-manager/SKILL.md` for health metric requirements and cron setup
3. Read `agent-handbook/SKILL.md` if edge function changes are needed (logging, auth)
4. Create migration with table, indexes, and RLS policies
5. Test migration locally before `apply_migration`
6. Validate all changes against `/workspace/CLAUDE.md` pre-flight checklist

## See also

- `/workspace/.cursor/rules/legal-mind-dev.mdc` — skill routing logic
- `/workspace/AGENTS.md` — skill system overview
- `/workspace/CLAUDE.md` — project hard-rules
- [Supabase Postgres Best Practices](https://supabase.com/docs/guides/database/postgres-best-practices) — official optimization guide
