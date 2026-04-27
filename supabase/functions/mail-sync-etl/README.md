# mail-sync-etl — Edge Function

Vervangt de `mail-sync` skill (Fase 2.5 PoC). Pure ETL: Microsoft Graph delta-sync → Supabase
`mail_messages` / `mail_folders` / `mail_sync_state`. Geen LLM, geen Composio, geen Jelle's PC.

## Architectuur

```
pg_cron (*/5 * * * *)
   │  POST + Authorization: Bearer CRON_SECRET
   ▼
Edge Function mail-sync-etl
   │  refresh_token grant
   ├─► login.microsoftonline.com  → access_token
   │
   ├─► Graph /me/mailFolders             → upsert mail_folders
   ├─► Graph /me/mailFolders/{id}/messages/delta
   │       ├─► full-scan (eerste keer of >7d)
   │       └─► delta-sync (normale heartbeat)
   │
   └─► supabase
           ├─► upsert mail_messages
           ├─► upsert mail_sync_state (delta_link bewaren)
           └─► insert/update agent_runs (run_type='edge_function')
```

## Edge Function secrets — Jelle vult in

Zet via Supabase dashboard → Project Settings → Edge Functions → Secrets, of
`supabase secrets set NAME=value` (Supabase CLI):

| Secret | Bron | Notes |
| --- | --- | --- |
| `MS_GRAPH_TENANT_ID` | Azure AD tenant id | Zelfde als Composio gebruikt |
| `MS_GRAPH_CLIENT_ID` | Azure AD app registration id | Eventueel hergebruiken van Composio |
| `MS_GRAPH_CLIENT_SECRET` | Azure AD app client secret | Confidential client flow |
| `MS_GRAPH_REFRESH_TOKEN` | OAuth refresh-token | Scope: `Mail.Read offline_access` |
| `CRON_SECRET` | Random 32-byte string | Auth tussen pg_cron en deze function |

> **Waarom geen Vault?** Edge Function secrets en Postgres Vault secrets zijn twee
> aparte mechanismen. Edge Function leest via `Deno.env.get(...)`, niet via SQL. Vault
> blijft voor RPC-only secrets (HubSpot token, etc).

## Smoke-test

Eerste run handmatig na secrets gezet zijn:

```sql
-- vanuit Supabase SQL editor
SELECT net.http_post(
  url := 'https://ezxihctobrqoklufawim.supabase.co/functions/v1/mail-sync-etl',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || current_setting('app.cron_secret', true),
    'x-trigger-source', 'smoke_test'
  ),
  body := '{}'::jsonb
);

-- Wacht 30s, check resultaat
SELECT id, status, summary, stats
  FROM agent_runs
 WHERE agent_name = 'mail-sync' AND run_type = 'edge_function'
 ORDER BY started_at DESC LIMIT 1;
```

Verwacht na succesvolle run:
- `status = 'success'`
- `summary` = "2 folder(s), N upsert, 0 deleted"
- `mail_messages` count toegenomen (eerste run = 14 dagen historie)
- `mail_sync_state` heeft 2 rijen (Inbox + Sent Items) met `delta_link` gevuld

## pg_cron schedule (Fase 2.5.7)

Wordt aangemaakt _disabled_ tijdens deploy. Enable na 1 succesvolle smoke-test:

```sql
-- App-secret voor cron-trigger zetten (eenmalig — sync met CRON_SECRET in Edge Function)
ALTER DATABASE postgres SET app.cron_secret = 'PLAATS_HIER_DEZELFDE_CRON_SECRET';

-- Schedule
SELECT cron.schedule(
  'mail-sync-etl',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://ezxihctobrqoklufawim.supabase.co/functions/v1/mail-sync-etl',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.cron_secret', true),
      'x-trigger-source', 'pg_cron'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

## Cutover (Fase 2.5.9 — na 48u parallel-run)

```sql
-- Skill uitzetten
UPDATE agent_schedules SET enabled = false, updated_at = now()
 WHERE agent_name = 'mail-sync';

-- Verifieer cron-job actief
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'mail-sync-etl';
```

## Rollback (als ETL niet stabiel)

```sql
SELECT cron.unschedule('mail-sync-etl');
UPDATE agent_schedules SET enabled = true, updated_at = now()
 WHERE agent_name = 'mail-sync';
```

## Logs

```sql
-- Per-run resultaat (zelfde tabel als skill-runs)
SELECT started_at, status, summary,
       stats->>'messages_upserted' AS upserted,
       stats->>'full_scans' AS fulls,
       stats->'warnings' AS warnings
  FROM agent_runs
 WHERE agent_name = 'mail-sync'
   AND run_type = 'edge_function'
 ORDER BY started_at DESC LIMIT 20;
```

Voor lower-level Deno-logs: Supabase dashboard → Edge Functions → mail-sync-etl → Logs.

## Aandachtspunten

1. **Refresh-token rotation:** Microsoft kan nieuwe refresh-tokens uitgeven. Voor MVP
   accepteren we dat de oude blijft werken (90 dagen rolling). Bij `invalid_grant` errors:
   Jelle moet handmatig nieuwe refresh-token genereren en `MS_GRAPH_REFRESH_TOKEN` updaten.
2. **Body-cap 200KB:** zware HTML-mails worden afgekapt — Jelle opent die in Outlook.
3. **Max 500 messages per run:** beschermt tegen runaway delta-batches. Volgende run pakt rest op.
4. **410 Gone op delta-link:** Graph invalideert delta-links periodiek. Function valt
   automatisch terug op full-scan in volgende run.
5. **Run-lock niet nodig:** Edge Function instances zijn stateless. Twee runs tegelijk =
   beide upserten via `ON CONFLICT (id)` → eindstate identiek (laatste wint).
