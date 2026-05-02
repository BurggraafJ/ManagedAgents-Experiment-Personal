# Data-laag (Supabase) + Vercel + GitHub config

> Reference voor alles wat te maken heeft met data-fetching, RLS, hosting-config.
> Lees on-demand — meestal niet nodig voor simpele UI-tweaks.

## Supabase — project info

| Veld | Waarde |
|---|---|
| Project ID | `ezxihctobrqoklufawim` |
| MCP prefix | `mcp__7a90b865-a649-4156-8646-6c3475a8118b__` |
| Anon key | `agent_config.supabase_anon_key` (als publishable) of via `get_publishable_keys` — gebruikt als `VITE_SUPABASE_ANON_KEY` in Vercel |

## Queries die useDashboard.js draait (parallel)

```sql
-- Laatste 500 runs (voor latest-per-agent + today-timeline)
SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT 500;

-- Alle open vragen
SELECT * FROM open_questions ORDER BY expires_at ASC NULLS LAST;

-- Laatste 50 feedback-rijen
SELECT * FROM agent_feedback ORDER BY created_at DESC LIMIT 50;

-- Schedules
SELECT * FROM agent_schedules ORDER BY agent_name;

-- 14-daagse run-history (voor sparklines)
SELECT agent_name, status, started_at FROM agent_runs
WHERE started_at >= now() - interval '14 days'
ORDER BY started_at DESC;

-- LinkedIn voortgang (alleen dit jaar)
SELECT * FROM linkedin_progress
WHERE year = EXTRACT(YEAR FROM now())
ORDER BY week_number DESC LIMIT 30;
```

Meer queries (autodraft_*, sales_*, tasks, mail_messages, secrets_inventory etc.) staan in `useDashboard.js` zelf.

De hook leidt af: `latestRuns`, `history`, `todayRuns`, `questionsWithUrgency`,
`weekStats`, `lastWeekStats`, `orchestratorAgeMin`, `overdueSchedules`, `runningSchedules`,
`nextRun`.

## Realtime subscriptions

Gedebounced refetch bij elke change op alle public tables. Polling elke 2 min als fallback.
Zie `useDashboard.js` effect onderin.

## Row-Level Security

Frontend gebruikt de **anon key**. Elke tabel die de UI leest moet een read-only anon-policy
hebben. `agent_config` (bevat secrets) juist NIET.

```sql
ALTER TABLE agent_runs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE open_questions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_feedback    ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_schedules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE linkedin_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon read" ON agent_runs FOR SELECT TO anon USING (true);
-- etc. per tabel
```

`agent_config` blijft service_role-only (is_secret rijen) + authenticated voor niet-secret.
`secrets_inventory` heeft anon-read voor de Keys-view (geen plaintext, alleen metadata).

## Agent-data status-regels

### Status-logica per agent-card

- **Running (pulsing accent):** `agent_schedules.is_running = true`
- **Success (groen):** laatste run `status='success'` en geen open vragen
- **Warning (oranje):** `status='warning'` OF open vragen > 0
- **Error (rood):** `status='error'` of run ouder dan verwachte interval
- **Idle (grijs):** geen run-data

### Urgency-logica per open vraag

- `expired` — `expires_at < now`
- `urgent` — `expires_at` binnen 24 uur
- `warning` — 3+ dagen open
- `ok` — rest

### Verwachte run-intervallen

| Agent | Verwacht |
|---|---|
| auto-draft | werkdag 08-20 elke 5 min; weekend 11:00 en 17:00 |
| hubspot-daily-sync | werkdag 12:30 + 17:00 |
| linkedin-connect | werkdag 17:00 |
| kilometerregistratie | 2e van de maand 09:00 |
| orchestrator | elke 15 min (heartbeat-bron) |
| dashboard-refresh zelf | on-demand, geen staleness-check |

### Orchestrator-heartbeat

Afgeleid uit `latestRuns['orchestrator'].started_at`:
- `< 20 min` → groen pulsing
- `20–60 min` → oranje
- `> 60 min` → rood
- geen data → idle-grijs

## Vercel — hosting

Alle metadata leeft in Supabase `agent_config` met `agent_name='dashboard-refresh'`:

| Key | Is secret | Voorbeeld |
|---|---|---|
| `vercel_project_name` | nee | `legal-mind-dashboard` |
| `vercel_project_id` | nee | `prj_lpz5GovvE3bfXwicMbiyA5KIqjNJ` |
| `vercel_team_id` / `_slug` | nee | `team_Zoitfw8ULKvq7TUE4qGswbuT` / `jelle-burggraaf` |
| `vercel_live_url` | nee | production URL |
| `vercel_last_deploy` | nee | timestamp |
| `vercel_token` | **ja** | `vcp_…` REST API bearer |
| `vercel_token_created_at` / `_expires_at` | nee | voor expiry-check |

Lees de values on-demand, niet bij elke sessie-start.

### Project-configuratie (al ingesteld)

- Framework: `vite`, output: `dist`
- Env-vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- Repo-koppeling: `BurggraafJ/ManagedAgents-Experiment-Personal` (repoId `1215342015`), branch `main`
- Deployment Protection: uitgeschakeld (publieke toegang)

## GitHub — repo

| Key | Is secret | Waarde |
|---|---|---|
| `github_username` | nee | `BurggraafJ` |
| `github_repo_owner` / `_name` | nee | `BurggraafJ` / `ManagedAgents-Experiment-Personal` |
| `github_token` | **ja** | `github_pat_…` fine-grained, scope = 1 repo |

Push altijd via tijdelijke token-in-URL vorm — nooit in `.git/config`:

```
git push "https://BurggraafJ:${GH_TOKEN}@github.com/<owner>/<repo>.git" main:main
```

Maskeer output: `| sed -E 's/github_pat_[A-Za-z0-9_]+/<redacted>/g'`.
