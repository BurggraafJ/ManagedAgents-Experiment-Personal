# Security playbook (architect-niveau)

> **Voor diepe audits van `.claude/settings.json` met risk-catalog en audit-log: gebruik de `security-settings` skill.** Dit playbook is voor architectuur-keuzes rond secrets, secret-storage en allowlist-patterns.

## De drie locaties van secrets

| Locatie | Wat hoort er | Wat NIET |
|---|---|---|
| **`agent_config(<agent>, <key>)`** | API-keys, PATs, OAuth-tokens — gebruikt door Edge Functions, RPC's, skills | Geen wachtwoorden van Jelle zelf |
| **`.claude/settings.local.json` env vars** | Machine-specifieke tokens (zoals VITE_SUPABASE_ANON_KEY voor lokale build) | Service-role keys, geen plaintext PATs liever |
| **Vercel env vars** (project-settings) | Production frontend secrets (anon-key, etc.) | Service-role key — die hoort in Supabase Edge Function secrets |

**Vuistregel:** als een skill of Edge Function het nodig heeft → `agent_config`. Single source of truth, queryable, rotatie via UPDATE.

## Inventaris (huidige stand 2026-04-28)

| Secret | Locatie | Eigenaar | Rotatie-cadence |
|---|---|---|---|
| `cron_secret` | `agent_config(global, cron_secret)` | infra | jaarlijks |
| `composio_api_key` | `agent_config(global, composio_api_key)` | mail/HubSpot integratie | bij Composio rotatie |
| `composio_user_id` | `agent_config(global, composio_user_id)` | idem | static |
| `atlassian_api_token` | `agent_config(global, atlassian_api_token)` | jira-sync | bij Atlassian rotatie |
| `google_maps_api_key` | `agent_config(global, google_maps_api_key)` | km-distance-lookup | jaarlijks |
| `openai/embedding_key` | `agent_config(openai, embedding_key)` | mail-embed, autodraft-rag-prefill | jaarlijks of bij lekkage |
| `openai/whisper_key` | `agent_config(openai, whisper_key)` | transcribe | jaarlijks |
| `dashboard-refresh/github_token` | `agent_config(...)` (PAT) | Git-push, dashboard deploys | bij verloop (90d/jaarlijks) |
| `dashboard-refresh/vercel_token` | idem | Vercel-control Edge Function | jaarlijks |
| `hubspot-sync-etl/access_token` | `agent_config(...)` | HubSpot CRM mirror | bij HubSpot rotatie |

## Allowlist-design voor Jelle's setup

Jelle draait Claude Code in een VM-sandbox op Windows 11. Dat geeft ruimte om **breed te approven** voor productiviteit, mits:

1. **Geen arbitrary code execution wildcards.** Patronen verboden:
   - `Bash(python *)`, `Bash(node *)`, `Bash(bun *)`, `Bash(deno *)`
   - `Bash(bash *)`, `Bash(sh *)`, `Bash(eval *)`, `Bash(exec *)`
   - `Bash(npx *)`, `Bash(bunx *)`, `Bash(uvx *)`, `Bash(uv run *)`
   - `Bash(npm run *)`, `Bash(bun run *)`, `Bash(make *)`
   - **Reden**: sandbox beschermt niet tegen exfiltratie via netwerk. Een typefout in arbitrary-exec = catastrofaal.

2. **Geen privilege escalation.** `Bash(sudo *)`, `Bash(ssh *)`, `Bash(scp *)`.

3. **Geen MCP arbitrary-exec.** `mcp__Claude_in_Chrome__javascript_tool`, `mcp__Claude_in_Chrome__computer`, `mcp__Claude_Preview__preview_eval` blijven uit.

4. **MCP write-tools genereus aan**: Slack send, Jira create, Vercel deploy, Supabase apply_migration, HubSpot manage_crm_objects. Jelle gebruikt deze actief via skills — sandbox beschermt niet, maar zonder deze tools werken de agents niet.

5. **Specifiek-gebonden bash writes oké**: `Bash(bun run typecheck)` mag, `Bash(bun run *)` niet. Het verschil: één commando vs alle commando's onder bun.

Voor diepe risk-catalog en review-procedure: gebruik **`security-settings` skill** (heeft de complete lijst en audit-log functionaliteit).

## Secret-rotatie flows

### OpenAI key (embedding_key of whisper_key)

```sql
-- 1. Genereer nieuwe key in OpenAI dashboard
-- 2. Update Supabase
UPDATE agent_config
   SET config_value = '<new_key>'::jsonb,
       updated_at = now()
 WHERE agent_name = 'openai' AND config_key = 'embedding_key';

-- 3. Test direct
SELECT net.http_post(
  url := 'https://ezxihctobrqoklufawim.supabase.co/functions/v1/mail-embed',
  headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT replace(config_value::text, '"', '') FROM agent_config WHERE agent_name='global' AND config_key='cron_secret')),
  body := '{}'::jsonb
);
-- Wacht 30s, check agent_runs.summary

-- 4. Revoke oude key in OpenAI dashboard pas NA bevestiging dat nieuwe werkt
```

### GitHub PAT (`github_token`)

```sql
-- 1. Genereer nieuwe fine-grained PAT op github.com (90 dagen geldig, scopes: repo + workflow)
-- 2. Update Supabase
UPDATE agent_config
   SET config_value = '"<new_pat>"'::jsonb,
       updated_at = now()
 WHERE agent_name = 'dashboard-refresh' AND config_key = 'github_token';

-- 3. Update lokale ~/.git-credentials file:
-- bash:
echo "https://x-access-token:<new_pat>@github.com" > ~/.git-credentials

-- 4. Test
git fetch     # mag geen prompt geven
```

### Vercel token

```sql
-- 1. Genereer in Vercel Account Settings → Tokens
-- 2. Update Supabase
UPDATE agent_config SET config_value = '"<new_token>"'::jsonb, updated_at = now()
 WHERE agent_name = 'dashboard-refresh' AND config_key = 'vercel_token';

-- 3. Test via vercel-control list-action (zie platform.md)
```

### Cron secret (rare-rotation, kritiek)

`cron_secret` wordt door **alle Edge Functions** gechecked als auth-header. Rotatie:

```sql
-- 1. Genereer nieuw 32-byte hex secret
-- 2. Update agent_config
UPDATE agent_config SET config_value = '"<new_secret>"'::jsonb WHERE agent_name='global' AND config_key='cron_secret';

-- 3. Alle pg_cron jobs werken automatisch — die lezen agent_config bij elke run
-- 4. Geen Edge Function deploys nodig — die lezen ook agent_config bij elke run
```

**Kritiek punt:** als de cron_secret rotatie faalt (bv. JSON-quote-issue in update), staan alle Edge Functions stil. Dubbel-check na rotatie:

```sql
SELECT count(*), max(started_at) FROM agent_runs
 WHERE started_at > now() - interval '5 minutes' AND status='running';
```

## Sandbox-bootstrap (verse VM)

Bij een nieuwe machine: gebruik **`security-settings` skill bootstrap-mode**. Genereert kant-en-klare `settings.json` op basis van `references/safe-baseline.md`.

Daarna handmatig (of via aparte skill):
1. Git credential.helper instellen (zie `platform.md`)
2. Supabase env-vars zetten in `.env` of Vercel-project
3. Test deploy van een Edge Function (round-trip-check)

## Wanneer escaleren naar `security-settings` skill

| Vraag | Naar |
|---|---|
| "is mijn settings.json veilig" | `security-settings` (audit-mode) |
| "voeg deze permission toe / haal die weg" | `security-settings` (update-mode) |
| "verse VM, geef me een startset" | `security-settings` (bootstrap-mode) |
| "deze secret hoort in agent_config" (architectuur) | dit playbook |
| "PAT roteren — hoe?" | dit playbook |
| "wie mag wat MCP-tool aanroepen" | architectuur-keuze hier, executie via `security-settings` |

Beide skills werken samen — dit playbook geeft de architectuur, `security-settings` voert audit/update uit met logging.

## Pitfalls die we al kennen

| Probleem | Voorkomen |
|---|---|
| PAT in `.git/config` na `git remote set-url` | Liever `credential.helper=store` met aparte file |
| Service-role key in VITE_-var | Gebruik anon-key voor browser, service-role alleen in Edge Functions |
| Secrets in commit-message of code-comment | Pre-commit hook kan helpen, of secret-scanning op GitHub |
| Vergeten oude key te revoken na rotatie | Setpoint: revoke binnen 24u na succesvolle nieuwe key |
| `.claude/settings.local.json` in git committed | `.gitignore` regel `.claude/settings.local.json` — check bij elke nieuwe project-init |

## Cross-skill verwijzingen

- Diepe `.claude/settings.json` audit/update: `security-settings`
- Allowlist-niveau permission-prompts verminderen: `fewer-permission-prompts` (Anthropic skill)
- Hooks instellen voor PostToolUse-checks: `update-config`
- Token-cost monitoring (los onderwerp): zie Token Cost Counter project
