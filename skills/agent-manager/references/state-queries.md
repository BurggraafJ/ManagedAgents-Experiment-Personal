# State Queries — live Supabase reads

Gebruik deze queries om live state van Jelle's agent-ecosysteem te bekijken. **Nooit hardgecodeerde feiten** — alles wat hier staat is queryable.

## Welke agents bestaan + cadans + status

```sql
SELECT agent_name, display_name, cron_expression, enabled,
       last_run_at, next_run_at, is_running, tier
  FROM agent_schedules
 ORDER BY tier, agent_name;
```

## Recente runs per agent (laatste 10)

```sql
SELECT agent_name, status, summary, started_at, completed_at,
       extract(epoch from (completed_at - started_at))::int AS duration_s
  FROM agent_runs
 WHERE agent_name = '<agent>'
 ORDER BY started_at DESC
 LIMIT 10;
```

## Health van alle truth-of-sources

```sql
SELECT sync_health_all();
```

Returneert per source (mail/engagement/jira/deal/company/contact/embedding): `is_fresh`, `age_minutes`, `last_sync_at`, `source_count`.

## Open voorstellen voor Jelle

```sql
SELECT id, agent_name, kind, status, summary, created_at
  FROM agent_proposals
 WHERE status IN ('pending', 'amended')
 ORDER BY created_at DESC;
```

## Open vragen + feedback

```sql
SELECT * FROM open_questions WHERE status='open' ORDER BY created_at DESC;
SELECT * FROM agent_feedback WHERE status='open' ORDER BY created_at DESC;
```

## Config per agent

```sql
SELECT agent_name, config_key, config_value, updated_at
  FROM agent_config
 WHERE agent_name = '<agent>'
 ORDER BY config_key;
```

## Schedule wijzigen

```sql
UPDATE agent_schedules
   SET cron_expression = '<new>',
       enabled = true,
       updated_at = now()
 WHERE agent_name = '<agent>';
```

## Manueel een agent triggeren

```sql
UPDATE agent_schedules
   SET manual_run_requested_at = now()
 WHERE agent_name = '<agent>';
```

Orchestrator pakt 'm op binnen 15 min (zijn cadans). Voor edge-functions zonder schedule: directe `net.http_post`-call.

## Run-locks resetten (als agent vastloopt)

```sql
UPDATE agent_schedules
   SET is_running = false,
       run_lock_acquired_at = null
 WHERE agent_name = '<agent>' AND is_running = true;
```

Doe dit ALLEEN na bevestiging dat de agent ECHT niet meer draait (check `agent_runs.status='running'` met oude `started_at`).

## Cron-jobs op DB-niveau

```sql
SELECT jobname, schedule, active, command FROM cron.job ORDER BY jobname;
```

Activeren/deactiveren:

```sql
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='<name>'), active := true);
```

## Edge Functions overzicht

```sql
SELECT slug, status, version, updated_at
  FROM (VALUES
    ('mail-sync-etl-v2'), ('mail-backfill'), ('mail-embed'),
    ('hubspot-sync-etl'), ('hubspot-engagements-sync'),
    ('jira-sync-etl'), ('autodraft-rag-prefill'), ('rag-search'),
    ('vercel-control'), ('km-distance-lookup'), ('km-excel-generate')
  ) v(slug)
 ORDER BY slug;
```

(Live status via `mcp__7a90b865-...__list_edge_functions`.)
