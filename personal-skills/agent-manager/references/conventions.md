# Conventies — Legal Mind agent-ecosysteem

## Drie kern-principes

1. **Mirror-tabel = truth-of-source.** Skills lezen uit Supabase tabellen, niet direct uit MCP-bronnen. Sync-laag (Edge Functions) houdt mirror up-to-date. Voorbeelden:
   - `mail_messages` ← mail-sync-etl-v2 (Composio Outlook)
   - `hubspot_deals/companies/contacts/engagements` ← hubspot-sync-etl, hubspot-engagements-sync
   - `jira_issues/projects` ← jira-sync-etl
2. **DB-edits goedkoop, skill-edits duur.** Bij keuze tussen DB-aanpassing of skill-aanpassing: kies DB. Skill-edits triggeren scheduled-task re-approval (cowork plugin).
3. **State altijd queryable.** Geen verborgen state in skill-files. Alles in `agent_runs`, `agent_config`, en domein-specifieke tabellen.

## Run-tracking

Elke skill schrijft naar `agent_runs`. Verplichte kolommen:
- `agent_name` — slug van de skill
- `run_type` — `'skill' | 'edge_function'`
- `status` — `'running' → 'success' | 'warning' | 'error'`
- `started_at`, `completed_at`
- `summary` — één regel, mens-leesbaar Nederlands, reviewable in dashboard
- `stats` — jsonb met v1-contract (zie hieronder)
- `errors` — jsonb-array `[{severity, code, message, context}]` bij hard-failure (soft issues → `stats.warnings[]`)

**stats v1-contract** (zie `agent-handbook/references/logging.md` voor de volledige spec):

```jsonc
{
  "schema_version": "1",       // STRING "1", nooit integer 1
  "skill_version": "naam-v1.0", // verplicht
  "triggered_by": "orchestrator|pg_cron|manual_run_request|user-button",
  "triggered_at": "<ISO-8601>", // verplicht
  "passes": [],                 // optioneel bij >1 stap: [{name, ms, status}]
  "warnings": [],               // verplicht, mag leeg
  "counts": {},                 // verplicht, agent-specifieke summary-tellers
  "extra": {}                   // optioneel, agent-eigen detail
}
```

Helper-functie `record_agent_run_v1(...)` dwingt het contract af. Verifieer na migratie met:
```sql
SELECT count(*) FROM agent_runs
WHERE agent_name = '<agent>'
  AND stats->>'schema_version' = '1'
  AND started_at > now() - interval '24 hours';
```

## Voorstel-flow (proposal-first model)

Voor agents die mutaties op buitenwereld doen (HubSpot, Jira, mail-send):

1. Skill schrijft een **voorstel** naar `agent_proposals(status='pending')`.
2. Jelle reviewt in dashboard, kiest `accept` / `reject` / `amend`.
3. Bij `accept`: trigger executie-skill via `manual_run_requested_at`.
4. Bij `amend`: skill leest amendments en past voorstel aan.
5. Skill **voert nooit direct** mutaties door.

Uitzonderingen: pure mirror-syncs (lees-only) en voorgedefinieerde routes.

## Truthbron-pyramide

```
Authoritative (writeable):
  HubSpot CRM, Outlook, Jira (via Composio / direct API)
        │
        ▼ (sync via Edge Functions)
Mirror (read-only voor skills):
  hubspot_deals/companies/contacts/engagements,
  mail_messages, jira_issues/projects
        │
        ▼ (skills lezen)
Skill-output (writeable door skills):
  agent_proposals, agent_runs, agent_feedback,
  open_questions, autodraft_mails, sales_todos, tasks, ...
```

## Schedule-conventies

- Werktijd-only skills: `* 6-22 * * *` (NL-tijd)
- Werkdag-only: `* * * * 1-5`
- Geen nacht-runs voor skills die mensen-output reviewen
- Elke 5 min = heartbeat (auto-draft scan)
- 1×/dag = leer-runs (auto-draft learn 17:00)

## Naming

- Skill: `kebab-case-met-koppels`
- DB-tabel: `snake_case`
- RPC: `snake_case`
- Edge Function: `kebab-case-etl` of `kebab-case-action`
- Migration: `add_X_to_Y` of `Y_v2_<wat-veranderd>`

## Wanneer kies je wat: RPC vs Trigger vs Edge Function

Zie `agent-handbook/references/database.md` § "Wanneer kies je wat".

## Skill-design

Zie memory-notes:
- *"Skill-edits zijn duur, DB-edits goedkoop"* → default DB
- *"Skill-design — invariants in SKILL.md, preferences in custom_instructions"* → fundament-regels horen hardcoded; preference-laag in DB
