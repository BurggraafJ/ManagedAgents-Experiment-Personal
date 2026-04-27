# mail-sync-etl — Edge Function (v2 Composio)

Vervangt de `mail-sync` skill via **Composio's REST API + SDK** in plaats van Microsoft
Graph direct. Pivot van v1 (Fase 2.5b, 2026-04-27): Composio doet de OAuth-magic met de
bestaande `legal-mind` connection, geen Azure AD app-registration nodig.

## Architectuur

```
pg_cron (*/5 * * * *)
   │  POST + Authorization: Bearer CRON_SECRET
   ▼
Edge Function mail-sync-etl
   │  composio.tools.execute(...)
   ├─► Composio API → OUTLOOK_LIST_MAIL_FOLDERS
   ├─► Composio API → OUTLOOK_QUERY_EMAILS
   │       (filter: receivedDateTime ge ... of lastModifiedDateTime gt ...)
   │
   └─► supabase
           ├─► upsert mail_folders
           ├─► upsert mail_messages
           ├─► upsert mail_sync_state (timestamp-based delta state)
           └─► insert/update agent_runs (run_type='edge_function')
```

Composio handelt onder de motorkap:
- OAuth-token-refresh voor Outlook
- Microsoft Graph rate-limit handling
- Token-rotation (90-dagen Microsoft refresh-tokens)

## Edge Function secrets

Set via Supabase dashboard → Project Settings → Edge Functions → Secrets:

| Secret | Bron | Notes |
| --- | --- | --- |
| `COMPOSIO_API_KEY` | Composio dashboard → API Keys | Status in `secrets_inventory.composio_api_key` |
| `COMPOSIO_USER_ID` | Default `user-jelle` (set indien anders) | Composio user-id voor multi-tenancy |
| `COMPOSIO_CONNECTION_ID` | Composio dashboard → Connections → `legal-mind` Outlook | `ca_xxxxx` formaat |
| `CRON_SECRET` | Random 32-byte hex | Auth tussen pg_cron en deze function |

> **Veel minder dan v1.** Geen Azure AD app, geen Microsoft Graph credentials, geen 90-dagen
> refresh-token onderhoud. Composio handelt alles.

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

## pg_cron schedule (al aangemaakt — disabled)

Bestaat al sinds v1. Activeren na succesvolle smoke-test:

```sql
SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname='mail-sync-etl'),
  active := true
);
```

## Verschil v1 → v2

| Aspect | v1 (Microsoft Graph) | v2 (Composio SDK) |
| --- | --- | --- |
| Code-regels | 614 | ~360 |
| OAuth-management | Eigen Azure AD app + refresh-token | Composio managed |
| Secrets nodig | 5 (4× MS_GRAPH_* + CRON_SECRET) | 4 (COMPOSIO_* + CRON_SECRET) |
| Refresh-token rotation | 90 dagen handmatig | Composio doet 't |
| Delta-sync model | Graph delta-link (`@odata.deltaLink`) | timestamp filter (`lastModifiedDateTime gt ...`) |
| @removed deletion-detect | Ja (via Graph delta) | Nee — alleen tijdens 7-daagse full-scan |

**Trade-off v2:** verwijderde mails worden alleen detecteerd tijdens de wekelijkse
full-scan (FULL_SCAN_REFRESH_DAYS). Voor delta-runs alleen upserts. Acceptabel voor
mail-sync use case.

## Cutover (Fase 2.5.9 — na 48u parallel-run)

```sql
-- Skill uitzetten
UPDATE agent_schedules SET enabled = false, updated_at = now()
 WHERE agent_name = 'mail-sync';

-- Cron-job activeren
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='mail-sync-etl'), active := true);
```

## Rollback

```sql
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='mail-sync-etl'), active := false);
UPDATE agent_schedules SET enabled = true, updated_at = now() WHERE agent_name = 'mail-sync';
```

## Logs

```sql
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

1. **Tool-naam fallback:** `OUTLOOK_LIST_MAIL_FOLDERS` of `OUTLOOK_LIST_FOLDERS` — Composio
   accepteert beide afhankelijk van toolkit-versie. Pas `TOOL_LIST_FOLDERS` constant aan
   indien een 404 op tool-name.
2. **Body-cap 200KB:** zware HTML-mails worden afgekapt — Jelle opent die in Outlook.
3. **Max 500 messages per run:** beschermt tegen runaway delta-batches.
4. **Composio rate-limits:** retry pattern in `execTool` met 5/15/45s backoff.
5. **Run-lock niet nodig:** Edge Function instances zijn stateless. Twee runs tegelijk =
   beide upserten via `ON CONFLICT (id)` → eindstate identiek.
