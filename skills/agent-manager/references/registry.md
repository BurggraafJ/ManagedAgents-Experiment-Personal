# Agent Registry — Legal Mind / Burggraaf Group

**Source of truth is de DB**, niet dit bestand. Dit is een human-readable index + quick-reference. Voor actuele schedules, statussen en run-data: altijd Supabase raadplegen.

---

## Hoe vraag je de live staat op

```sql
-- Welke agents bestaan, welk cron-schema, staan ze aan
SELECT agent_name, display_name, skill_name, cron_expression, enabled,
       last_run_at, next_run_at, is_running, timeout_minutes, slack_channel
FROM agent_schedules
ORDER BY agent_name;

-- Laatste run per agent (met audit-trail van hoe 'ie getriggerd werd)
SELECT DISTINCT ON (agent_name)
  agent_name, status, summary, stats->>'triggered_by' AS triggered_by,
  started_at, completed_at
FROM agent_runs
ORDER BY agent_name, started_at DESC;

-- Orchestrator-heartbeat + wat 'ie vorige poll heeft getriggerd
SELECT started_at, status, summary,
       stats->'triggered' AS triggered_agents,
       stats->'skipped'   AS skipped_agents,
       stats->'stale_locks_reset' AS stale_resets
FROM agent_runs
WHERE agent_name = 'orchestrator'
ORDER BY started_at DESC LIMIT 5;
```

Project: `ezxihctobrqoklufawim` (EU-West-1). MCP prefix: `mcp__7a90b865-a649-4156-8646-6c3475a8118b__`.

---

## Architectuur — hoe alles samen hangt

**Enige externe trigger** = de orchestrator, draait elke 30 min 06:00–22:30 lokaal
via een Cloud scheduled task. Per-agent Cloud tasks zijn uitgeschakeld; de orchestrator
is de enige bron voor auto-triggers.

```
Cloud task "agent-orchestrator-poller"  (cron: 0,30 6-22 * * *)
        │
        ▼
agent-orchestrator skill
        │ leest agent_schedules
        │ bepaalt wie verlopen is
        │ reset stale locks
        │
        ├── triggert verschuldigde agent → agent schrijft zelf agent_runs
        │   met stats.triggered_by='orchestrator'
        │
        └── schrijft eigen run-record → agent_runs (agent_name='orchestrator')
            met stats.triggered[], skipped[], stale_locks_reset[]
```

**Handmatige triggers** (Jelle roept agent direct aan via Slack of chat) werken altijd —
daarvoor hoeft de orchestrator niet te draaien. Agent schrijft dan zelf
`stats.triggered_by='manual'` of `'slack'`.

---

## Skills per rol

### Orchestrator & management (geen agents op zichzelf)

| Skill | Rol | Trigger |
|---|---|---|
| `agent-orchestrator` | Centrale scheduler. Leest `agent_schedules`, triggert agents. Schrijft eigen heartbeat + audit-run. | Cloud task elke 30 min (06–22) |
| `agent-manager` | Strategische hub. Verwerkt feedback, rapporteert. | Handmatig + dagelijks 08:00 (`0 8 * * *`, nog disabled) |
| `dashboard-refresh` | Beheert dashboard-code + deploy naar Vercel. | Handmatig (enabled=false) |

### Werk-agents (doen daadwerkelijke taken)

| Agent | Cron | Slack | Schrijft naar |
|---|---|---|---|
| `auto-draft` | `0 8,10,12,14,16,18,20 * * 1-5` + weekend-pattern in config | `#daily-drafting` | `draft_events`, `agent_runs` |
| `hubspot-daily-sync` | `0 17 * * 1-5` | `#daily-hubspot-update` | `hubspot_activities`, `open_questions`, `agent_runs` |
| `linkedin-connect` | `0 9 * * 1` | `#linkedin-connect` | `linkedin_progress`, `agent_runs` |
| `kilometerregistratie` | `0 9 2 * *` | `#kilometerregistratie` | `km_trips`, `agent_config` (laatste_maand), `agent_runs` |

Alle werk-agents nemen `stats.triggered_by` op in hun `agent_runs` insert — zo blijft
de trigger-bron achterhaalbaar.

---

## Shared tabellen

| Tabel | Wie schrijft | Wie leest |
|---|---|---|
| `agent_schedules` | orchestrator (locks, timestamps) | orchestrator + dashboard |
| `agent_runs` | elke agent (eigen run) + orchestrator (eigen poll) | dashboard + agent-manager |
| `open_questions` | agents die Jelle iets vragen | agent-manager + dashboard + orchestrator (om dubbele vragen te voorkomen) |
| `agent_feedback` | agent-manager (import uit #feedback) | dashboard + agent-manager |
| `agent_config` | per agent (credentials, state) | zelfde agent + dashboard-refresh |
| `linkedin_progress` | linkedin-connect | dashboard |
| `km_trips` | kilometerregistratie | niemand automatisch |
| `draft_events` | auto-draft | niemand automatisch |
| `hubspot_activities` | hubspot-daily-sync | niemand automatisch |

---

## Dashboard

Live: https://legal-mind-dashboard-git-main-jelle-burggraaf.vercel.app/ (canonical — altijd laatste main-commit). Aliassen: `legal-mind-dashboard-jelle-burggraaf.vercel.app` (production-promotion, kan achterlopen), `legal-mind-dashboard-pi.vercel.app` (korte alias).

Drie views: **Nu** (live-status + agents + timeline + week), **Inbox** (vragen + feedback),
**Systeem** (schedules + linkedin + config). Realtime via Supabase subscriptions + 2-min polling fallback.

---

## Slack

Workspace: Personal Ops (`pe