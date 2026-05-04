---
name: task-organizer
description: Beheert Jelle's Taken-tabblad. Vier passes per run — (1) Fireflies-scan voor action-items voor Jelle Burggraaf met is_newly_found=true, (2) Jira-sync van Sales/Management/Recruitment-boards (upsert open issues, auto-close gesloten), (3) clustering in projecten + deadlines/prioriteiten, (4) completion-detection. Draait dagelijks 06:00 en handmatig via dashboard-knop "✨ AI herindelen". Trigger bij "herorganiseer taken", "indeel taken", "taken opschonen", "scan fireflies", "sync jira", "task-organizer", of vragen om Fireflies/Jira-takenoverzicht te verversen. Trigger NIET voor nieuwe taken schrijven (quick-capture in dashboard) of voor mail/HubSpot/Sales-acties (eigen agents).
---

# Task Organizer

Centrale skill die de **Taken**-pagina van het dashboard schoonhoudt. Sinds 2026-05-01 werkt deze skill als **dunne orchestrator**: bron-syncs en zware fuzzy-matching draaien als RPC's of Edge Functions in Supabase. De skill blijft verantwoordelijk voor LLM-werk (deadline detectie, prioriteit, effort, tags, reasoning).

## Doel in één zin

Lees alle `tasks` waar `ai_processed = false` en open zijn, en zet voor elk: het juiste project, een vermoede deadline of doe-datum, een prioriteit, een paar tags, en een korte uitleg waarom.

## Wat de skill NIET doet

- **Geen nieuwe taken schrijven via quick-capture.** Die schrijft direct naar `tasks`.
- **Geen taken afmaken.** Status `done` of `dropped` zet alleen Jelle.
- **Niets overschrijven dat Jelle handmatig heeft gezet.** Behoud bestaand `project_id` tenzij `ai_processed=false` (Jelle vraagt herindeling).
- **Geen mails versturen, geen HubSpot-mutaties, geen Slack-berichten.**

## Architectuur — wat doet wat

| Component | Verantwoordelijkheid |
|---|---|
| **Edge Function `task-organizer-fireflies`** | Stap 0: haalt Fireflies-transcripts op, parsed action_items voor Jelle, dedupt fuzzy via RPC `register_fireflies_action_items`, insert in `tasks`. Triggered via pg_cron 06:00. |
| **RPC `ingest_jira_into_tasks`** | Stap 0.5: leest `jira_issues` mirror, upsert open issues van Jelle in `tasks`, auto-close gesloten/niet-toegewezen. |
| **RPC `suggest_task_project(title, notes, top_n)`** | Stap 1: fuzzy-match tegen `task_projects.ai_match_hint` + top-3 sibling-tasks via pg_trgm. Returns top-N candidates met scores + best_match (≥0.4). |
| **Skill (LLM)** | Stappen 2-5: deadline detection, priority, effort, tags, reasoning per taak. + clustering-beslissing (één nieuw project per run). |
| **RPC `detect_task_completion_candidates(p_lookback_days, p_min_confidence, p_apply)`** | Stap 6: pattern-match over 7 bronnen (autodraft, sales_todos, linkedin, agent_proposals, sales_on_road, km_trips, agent_runs). Met `p_apply=true` schrijft direct naar `tasks.completion_*`. |

## Werkvolgorde per run

```
1. Acquire run-lock (orchestrator regelt).
2. INSERT agent_runs row, status='running'.
3. (Edge Fn task-organizer-fireflies handelt zijn eigen cron af —
    skill wacht NIET, leest gewoon nieuwe tasks bij stap 5.)
4. SELECT ingest_jira_into_tasks()                 -> Jira-mirror sync.
5. SELECT id, title, notes, ... FROM tasks
     WHERE ai_processed=false AND status IN ('open');
6. Per taak: SELECT suggest_task_project(title, notes, 3) -> candidates.
7. Per taak: skill bepaalt deadline / priority / effort / tags / reasoning.
8. UPDATE tasks SET project_id=..., priority=..., ... WHERE id=...
9. SELECT detect_task_completion_candidates(30, 0.6, true) -> applied count.
10. UPDATE agent_runs status='success' met stats.
```

## Stap 1 — Project-toewijzing (RPC + skill-beslissing)

```sql
SELECT public.suggest_task_project(
  p_title := <title>,
  p_notes := <notes>,
  p_top_n := 3
);
```

Returns:
```json
{
  "candidates": [
    { "project_id": "...", "project_name": "Legal Mind",
      "hint_score": 0.82, "sibling_score": 0.45, "sibling_count": 3,
      "combined_score": 0.95 },
    ...
  ],
  "best_match": { "project_id": "...", "project_name": "Legal Mind", "combined_score": 0.95 }
}
```

**Skill-beslissing:**
- `best_match.combined_score >= 0.7` → toewijzen aan dat project, set `ai_confidence = score`.
- `0.4 <= score < 0.7` → laat in Inbox (`project_id=null`), zet `ai_suggested_project = best_match.project_name`.
- `< 0.4` → laat in Inbox.

**Speciaal: clustering.** Als 3+ onbeoordeelde taken duidelijk over hetzelfde nieuwe thema gaan (en geen project past): stel **één** nieuw project voor (max 1 per run):

```sql
INSERT INTO task_projects (name, description, color, icon, ai_match_hint, sort_order)
VALUES ($1, $2, $3, $4, $5, 90)
RETURNING id;
```

## Stap 2-5 — Deadline / priority / effort / tags / reasoning (skill, LLM)

Voor elke taak (na project-keuze):

- **deadline / do_date:** detecteer expliciete data ("vrijdag", "morgen", "voor 12 mei"), doe-context ("vandaag oppakken"), indirecte signalen (meeting-context). Liever leeg dan fout.
- **priority:** default `normal`. Verhoog naar `high` (deadline binnen 2 dagen, "belangrijk", late-stage klant), `urgent` ("spoed", "asap", overdue). Verlaag naar `low` ("ooit", "kleinigheidje").
- **effort:** `quick` (<15 min), `medium` (default), `deep` (>1u, "schrijf SOP", "bouw skill").
- **tags:** max 3, lowercase. Gebaseerd op tekst, niet op verzinning.
- **reasoning:** één korte zin (≤120 tekens). "Genoemde klant 'Acme' valt onder Legal Mind sales-pipeline; deadline uit 'voor maandag'."
- **ai_confidence:** 0..1, voor de project-keuze.

## Stap 5b — Optionele entity-context verrijking (v3 — context-build CaaS)

Wanneer een taak duidelijk een **bekende klant** noemt in title/notes (matched via
`entity_resolution.alias_value` op company-name of contact-name), doe één optionele
context-build call om de reasoning-string te verrijken:

```bash
POST /functions/v1/context-build

{
  "intent": "extract_actions",
  "audience": "task-organizer",
  "trigger_type": "task",
  "trigger_id": "<task_id>",
  "query_text": "<task_title>",
  "options": {
    "entity_type": "<contact|company|deal>",
    "entity_id": "<id>",
    "top_k": 3,
    "min_similarity": 0.4
  }
}
```

Gebruik de top-1 chunk om de `reasoning`-string te verrijken — **bv.**: "klant Acme had
12-mrt-2026 een meeting waarin licentieoffertes besproken; deze taak hangt waarschijnlijk
daarmee samen". Niet langer dan 120 tekens. **Skip** als geen entity-match of geen chunk
boven 0.4 — basis-reasoning blijft genoeg.

**JelleMind-lessons consumeren** (sinds 2026-05-04 — JelleMind Activation):
context-build retourneert ook `bundle.knowledge_lessons[]` — top-2 lessons in
mind_scope `skill` (extract-werk-procesregels). Voorbeeld-lesson "agent maakt
zelf vervolgtaak aan, geen actie-bij-Jelle" → mag het project-toewijzings-pad
beinvloeden (bijv. high-priority bij externe deadline). Telemetrie:
`stats.jellemind_lessons_used += knowledge_lessons.length`. Geen sectie als leeg.

Dit is optioneel; de project-toewijzing zelf gebruikt nog steeds `suggest_task_project`.

## Stap 6 — Completion-detection (RPC met direct apply)

```sql
SELECT public.detect_task_completion_candidates(
  p_lookback_days := 30,
  p_min_confidence := 0.6,
  p_apply := true
);
```

Returns:
```json
{
  "candidates": [
    { "task_id": "...", "source": "autodraft", "confidence": 0.85,
      "evidence_text": "Mail-actie via auto-draft op 2026-04-23",
      "evidence_url": null }
  ],
  "count": 4, "applied": 4,
  "lookback_days": 30, "min_confidence": 0.6
}
```

**Belangrijk:**
- RPC zet `completion_candidate=true` + evidence-velden, nooit `status='done'` (Jelle accepteert in dashboard).
- RPC slaat al `completion_rejected=true` taken over.
- RPC slaat al-recent-gedetecteerde taken over (`completion_detected_at < 7 days ago`).
- Bij twijfel skip — Jelle's vertrouwen is belangrijker dan extra detecties.

## Wegschrijven per taak (skill)

```sql
UPDATE public.tasks
SET project_id           = $project_id,
    priority             = $priority,
    deadline             = $deadline,
    do_date              = $do_date,
    tags                 = $tags,
    effort               = $effort,
    ai_processed         = true,
    ai_last_review       = now(),
    ai_confidence        = $confidence,
    ai_suggested_project = $suggested_project_name_or_null,
    ai_reasoning         = $reasoning
WHERE id = $id;
```

## Run-resultaat — stats jsonb

v1-contract — lees `agent-handbook/references/logging.md` voor de volledige spec.

```jsonc
{
  "schema_version": "1",                  // STRING "1" — nooit integer
  "skill_version": "task-organizer-v1.0", // update bij backwards-incompatibele wijziging
  "mode": null,
  "triggered_by": "orchestrator",         // of "manual_run_request" bij dashboard-knop
  "triggered_at": "<ISO-8601>",
  "passes": [
    { "name": "jira-sync",            "ms": 850,  "status": "success" },
    { "name": "project-suggest",      "ms": 1200, "status": "success" },
    { "name": "deadline-priority",    "ms": 9400, "status": "success" },
    { "name": "completion-detection", "ms": 320,  "status": "success" }
  ],
  "warnings": [],
  "counts": {
    "tasks_seen": 12,
    "tasks_assigned": 9,
    "tasks_left_in_inbox": 3,
    "deadlines_detected": 4,
    "high_confidence_count": 7,
    "low_confidence_count": 2
  },
  "extra": {
    "fireflies_handled_by_edge_fn": true,
    "new_project_proposed": "Documentatie & SOPs",
    "jira": { "...van ingest_jira_into_tasks RPC..." },
    "completion": { "...van detect_task_completion_candidates RPC..." }
  }
}
```

**Toelichting structuur:**
- `counts{}` = summary-getallen per pass. Platte velden (niet genest per pass).
- `extra{}` = gedetailleerde RPC-terugkoppelingen en meta-info die niet in counts passen.
- `passes[]` = timing + status per stap. Geeft de Health-pagina zicht op waar een trage run zit.

Summary-zin (NL): `"9/12 ingedeeld (1 nieuw project), Jira: 3 nieuw + 2 auto-closed, 4 mogelijk al klaar."`

## Veiligheidskleppen (invariants)

- **Maximaal 100 taken per run** (skill-side cap).
- **Maximaal 1 nieuw project per run** (skill-side cap).
- **Geen mutaties op `task_projects.name`** — projecten hernoemen doet Jelle handmatig.
- **Bij twijfel: skip.**
- RPC's hebben eigen clamps: completion `p_min_confidence` [0, 1], suggest `p_top_n` [1, 10].

## Stop-condities

- Geen Supabase-credentials → log "skill_secret missing".
- > 200 taken openstaan met `ai_processed=false` → bulk-import vermoed; skip pass, log waarschuwing.
- Een UPDATE faalt door RLS → log en sla die taak over.

## Hoe orchestrator triggert

1. `agent_schedules`-cron: `0 6 * * *` (dagelijks 06:00 NL).
2. Manueel via dashboard: knop "✨ AI herindelen" → orchestrator pakt deze skill op.

De Fireflies-scan loopt **onafhankelijk** via Edge Function pg_cron (zelfde 06:00). De skill leest gewoon de nieuwe tasks die de Edge Function inserted.

## Locaties

- **SKILL.md:** dit bestand (`C:\Users\LM\.claude\skills\task-organizer\SKILL.md`).
- **DB-RPC's:** `suggest_task_project`, `detect_task_completion_candidates`, `ingest_jira_into_tasks`, `register_fireflies_action_items`.
- **Edge Function:** `task-organizer-fireflies` (vervangt stap 0).
- **Dashboard:** tabblad `Taken` (component `TasksView.jsx`).

## Wat in v1 NIET zit

- Lessons-tabel zoals `autodraft_style_lessons` voor task-organizer-correcties (kan via JelleMind).
- Outlook-agenda als bron voor automatische taken.
- Wekelijkse "review" voor taken > 30 dagen open.
