# Database playbook — Supabase Postgres

## Project: Legal Mind setup project

| Detail | Waarde |
|---|---|
| Project ID | `ezxihctobrqoklufawim` |
| Region | eu-west-1 |
| Postgres | 17.6 |
| Geactiveerde extensies | `vector` (pgvector 0.8), `pg_cron`, `pg_net`, `pgcrypto`, `uuid-ossp`, `vault`, `pg_stat_statements` |

## Drie principes

1. **DB-edits zijn goedkoop, skill-edits zijn duur.** Bij een keuze tussen DB-aanpassing en skill-aanpassing → DB. Skill-edits triggeren cowork-plugin re-approval.
2. **Tabel = truth-of-source.** Skills lezen uit tabellen, niet direct uit MCP-bronnen. Sync-laag (Edge Functions) houdt mirror up-to-date.
3. **State altijd queryable.** Geen verborgen status in skill-files — alle agent-state in `agent_runs`, `agent_config`, en domain-specifieke tabellen.

## Wanneer kies je wat: RPC vs Trigger vs Edge Function

| Need | Tool | Voorbeeld in Legal Mind |
|---|---|---|
| Read-only query met logica voor frontend | **RPC** (`CREATE FUNCTION ... LANGUAGE sql STABLE`) | `match_all_sources`, `sync_health` |
| Read + light write, in DB-context | **RPC LANGUAGE plpgsql** | `assert_freshness` (RAISE EXCEPTION) |
| Reactie op DB-mutatie (insert/update/delete) | **Trigger** | `submit_autodraft_decision` zet manual_run_requested_at |
| Externe API-calls (HubSpot, OpenAI, Composio) | **Edge Function** | `mail-embed`, `mail-sync-etl-v2`, `vercel-control` |
| Periodieke taken (cron) | **pg_cron** met `net.http_post` naar Edge Function | `mail-embed-cron`, `hubspot-sync-etl` |
| Heavy compute > 10s | **Edge Function** met run-record in `agent_runs` | alle ETL's |
| Skill-orchestratie / LLM-call | **Skill via agent-orchestrator** | auto-draft, daily-admin |

**Vuistregel:** als het in <100ms in pure SQL kan en geen externe IO heeft → RPC. Anders Edge Function.

## Migration-flow

### Schema-changes (DDL)

```typescript
mcp__7a90b865-...__apply_migration({
  project_id: "ezxihctobrqoklufawim",
  name: "add_embedding_to_X",                  // snake_case, descriptief
  query: "ALTER TABLE ... ADD COLUMN ...;"     // idempotent: gebruik IF NOT EXISTS
});
```

**Regels:**
- `IF NOT EXISTS` op alle ADD COLUMN/INDEX/CONSTRAINT — migration moet idempotent zijn
- Geen DROP COLUMN zonder backup-plan (data-verlies)
- Bij grote tabellen: `CREATE INDEX CONCURRENTLY` om geen lock te plaatsen

### Pure data-mutaties

```typescript
mcp__7a90b865-...__execute_sql({
  project_id: "ezxihctobrqoklufawim",
  query: "UPDATE ... WHERE ...;"
});
```

`apply_migration` is voor DDL en wordt gelogged in migrations-tabel. `execute_sql` voor ad-hoc queries en kleine data-fixes.

## RLS — wanneer wel, wanneer niet

Legal Mind is single-tenant: één gebruiker (Jelle). Daarom:

- **Service-role bypass**: alle Edge Functions gebruiken service-role key, RLS speelt geen rol
- **Anon-key vanaf dashboard**: WEL onder RLS — anon mag lezen, niet schrijven
- **Geen RLS = security-risico** als de tabel publiek bereikbaar is via Supabase API

**Default RLS-policy voor read-only access vanuit dashboard:**

```sql
ALTER TABLE public.<table> ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_read_all" ON public.<table>
  FOR SELECT TO anon, authenticated
  USING (true);

-- Geen INSERT/UPDATE/DELETE policy = geen schrijftoegang voor anon
```

**Voor user-specifieke writes** (zoals dashboard quick-capture):

```sql
CREATE POLICY "auth_insert" ON public.<table>
  FOR INSERT TO authenticated
  WITH CHECK (true);
```

Single-user betekent: geen `auth.uid() = user_id` check nodig — er is maar één user.

## pg_cron patterns

### Basis: aanroep van Edge Function

```sql
-- cron_secret leest uit Vault (canoniek sinds 2026-05-02). Volledige uitleg: authentication.md § 2.3.
SELECT cron.schedule('<job_name>', '*/5 * * * *', $$
  SELECT net.http_post(
    url := 'https://ezxihctobrqoklufawim.supabase.co/functions/v1/<slug>',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets
         WHERE name = 'skill:global:cron_secret'
      )
    ),
    body := '{}'::jsonb
  );
$$);
```

### Gated cron (alleen als werk te doen)

```sql
... WHERE EXISTS (SELECT 1 FROM <pending_table> WHERE status='pending' LIMIT 1);
```

Voorkomt elke 2-min lege wakeup. Belangrijk voor cost en log-noise.

### Cron beheren

```sql
-- Pauzeren
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='X'), active := false);

-- Lijst
SELECT jobname, schedule, active, command FROM cron.job ORDER BY jobname;

-- Verwijderen + opnieuw maken (bij wijziging)
SELECT cron.unschedule('X');
SELECT cron.schedule('X', '...', $$...$$);
```

## HNSW vector-index tuning

Voor pgvector cosine similarity:

```sql
CREATE INDEX idx_X_embedding_hnsw
  ON public.X USING hnsw (embedding vector_cosine_ops);
```

**Defaults zijn prima tot ~100k rows.** Bij grote sets:

```sql
-- ef_search omhoog voor recall (default 40):
SET hnsw.ef_search = 80;

-- Bij INSERT-zwaar gebruik: m + ef_construction tunen tijdens CREATE INDEX
CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

**VACUUM** doet pgvector niet automatisch — bij heavy delete/update batches:

```sql
VACUUM ANALYZE public.X;
```

## sync-health design

`sync_health(source_name)` retourneert per source `is_fresh`, `age_minutes`, `last_sync_at`. **Belangrijke design-keuze:** voor mirror-tabellen die delta-sync doen (HubSpot, Jira), gebruik **`<sync_state>.last_delta_sync`** ipv `max(synced_at)` op de mirror-tabel.

Reden: een delta-sync zonder wijzigingen update geen rijen, dus `max(synced_at)` blijft op oude waarde — false stale-detection. De sync-state tabel logt elke run.

```sql
-- Goed (HubSpot/Jira):
SELECT last_delta_sync FROM hubspot_sync_state WHERE id = 1;

-- Slecht (HubSpot/Jira) — geeft false stale bij delta-runs zonder wijzigingen:
SELECT max(synced_at) FROM hubspot_deals;

-- Goed (Mail) — mail-sync schrijft vrijwel elke run iets:
SELECT max(synced_at) FROM mail_messages;
```

## Tabel-design conventies

| Aspect | Conventie |
|---|---|
| PK | `id uuid DEFAULT uuid_generate_v4()` óf domein-key (zoals `deal_id text` voor HubSpot) |
| Timestamps | `created_at`, `updated_at`, `synced_at` (sync-from-source) — allemaal `timestamptz NOT NULL DEFAULT now()` |
| Soft-delete | `is_deleted boolean DEFAULT false` ipv DELETE |
| jsonb voor flexibel veld | `properties jsonb` — bewaart originele upstream-data |
| Status-enum | `status text CHECK (status IN ('pending','done','error'))` |
| Run-tracking | Schrijf altijd naar `agent_runs` met `agent_name`, `run_type`, `started_at`, `status`, `summary`, `stats` |

## RPC-patterns die werken

### Health-check pattern

```sql
CREATE OR REPLACE FUNCTION sync_health(source_name text, max_age_minutes int DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_last timestamptz;
  v_max int := COALESCE(max_age_minutes, CASE source_name ... END);
BEGIN
  -- pak last_sync per source
  -- bereken age, fresh-flag
  RETURN jsonb_build_object(
    'source', source_name,
    'is_fresh', ...,
    'age_minutes', ...,
    'checked_at', now()
  );
END $$;
```

### Search-pattern (zie data-scientist-manager voor RAG-specifiek)

CTE per source met identieke output-structuur, UNION ALL, ORDER BY relevance.

### Trigger-action pattern (skill-aanroep via dashboard)

```sql
CREATE OR REPLACE FUNCTION submit_user_action(...)
RETURNS uuid LANGUAGE plpgsql
AS $$
BEGIN
  -- Validate input
  -- Insert in queue/inbox table
  -- Update agent_schedules SET manual_run_requested_at = now() WHERE agent_name = '...'
  -- Return action_id
END $$;
```

## Pitfalls

| Probleem | Voorkomen |
|---|---|
| Schema-drift tussen prod en git | Alle DDL via `apply_migration`, nooit handmatig in dashboard |
| Vergeten RLS bij nieuwe tabel | Migration template bevat altijd `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + minimum policy |
| 1536-dim vector bulk-update timeout | Update in slices van 50 rijen, niet één bulk |
| pg_cron niet gestart | Check `SELECT * FROM cron.job` — leeg kan betekenen extension niet enabled |
| Edge Function timeout op grote query | Wall-time `MAX_WALL_TIME_MS = 90_000`, plan SAFETY_MARGIN_MS = 15_000 |
| RPC die service-role-only data exposed via anon | Voeg `SECURITY INVOKER` toe (default) en check kolom-projection |

## Cross-skill verwijzingen

- RAG-RPC's specifiek (match_all_sources, MMR, recency): `data-scientist-manager`
- Vercel deploy van Edge Function: `platform.md`
- Settings/secrets voor service-role: `security.md`
- Skill-iteratie zelf: `agent-manager` (cowork)
