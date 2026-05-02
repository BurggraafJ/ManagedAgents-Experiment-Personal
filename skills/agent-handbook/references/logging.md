# Logging — log-contract voor alle agents

> **Lees dit voor je een agent-skill aanpast die naar `agent_runs` schrijft, een `*_proposals` of `*_decisions`-tabel toevoegt, of een output-state enum kiest.** Logging in Legal Mind heeft drie lagen die door elkaar lopen — als je ze niet uit elkaar trekt eindig je met inconsistente data en een onbruikbaar Health-overzicht.

## Bron-regel

| Vraag | Bron |
|---|---|
| Hoe loggen agents (contract, naming, severity)? | **Deze referentie** |
| Wat staat er nu in `agent_runs` / `*_proposals` / `*_decisions`? | **Live query** in Supabase |

Bij twijfel over werkwijze: deze doc. Bij twijfel over content: query de live state.

## De drie lagen — wat hoort waar

Logging is geen één-tabel-probleem. Drie soorten "log" hebben elk een eigen contract:

| Laag | Tabel(len) | Wat het vertelt | Antwoordt op |
|---|---|---|---|
| **1. Run-logs** | `agent_runs` | Wat de skill _deed_ tijdens een run — passes, timing, fouten | "Wat heeft de agent gedaan en hoe lang?" |
| **2. Output-state** | `agent_proposals`, `autodraft_mails`, `tasks`, `sales_on_road_events`, `sales_todos`, `jellemind_lesson_proposals`, `*_inbox` | In welke fase staat een door de agent geproduceerde output | "Moet ik dit nog reviewen?" |
| **3. Decision-trail** | `autodraft_decisions`, `agent_proposals.amendment+reviewed_*`, `jellemind_lesson_proposals.review_*`, `agent_feedback` | Wat Jelle heeft gedaan met de output | "Hoe heb ik eerder gehandeld?" |

**Plus de overkoepelende severity-laag** — view `agent_issues_aggregate` die alle drie samenvoegt tot één lijst van échte problemen voor de Health-pagina.

---

## Laag 1 — Run-logs (`agent_runs`)

### Het contract (`schema_version=1`)

Alle nieuwe runs schrijven `stats jsonb` met deze top-level keys:

```jsonc
{
  "schema_version": "1",                        // verplicht — ALTIJD STRING "1", nooit integer 1
  "skill_version": "auto-draft-v5.2",          // verplicht — format: "<agent-naam>-v<major>.<minor>"
  "mode": "scan|learn|...",                    // optioneel — agent-keuze
  "triggered_by": "orchestrator|pg_cron|manual_run_request|user-button",
  "triggered_at": "2026-04-30T11:40:14+00:00", // verplicht ISO-8601
  "passes": [                                   // optioneel — agents met >1 pass
    { "name": "harvest", "ms": 4123, "status": "success" },
    { "name": "cluster", "ms": 240,  "status": "success" }
  ],
  "warnings": ["soft issue text"],              // verplicht (mag leeg [] maar NIET ontbreken)
  "counts": {                                   // verplicht (mag leeg {} maar NIET ontbreken) — summary-tellers
    "items_processed": 12,
    "items_skipped": 3
  },
  "extra": {                                    // optioneel — agent-eigen detail buiten de summary
    "_diagnose": { /* auto-draft */ },
    "feature_flag_x": true
  }
}
```

> **⚠️ Veelgemaakte fouten:**
> - `"schema_version": 1` (integer) → **FOUT**. Moet string zijn: `"schema_version": "1"`. De DB-query `WHERE stats->>'schema_version' = '1'` matcht alleen strings.
> - `warnings` of `counts` weglaten → **FOUT**. Ze mogen leeg zijn (`[]` / `{}`), maar het key moet aanwezig zijn zodat health-views er op kunnen filteren.
> - Counts als losse top-level keys (`"tasks_seen": 12`) → **FOUT**. Horen genest onder `"counts": { "tasks_seen": 12 }`.

> **passes[] vs. counts vs. extra — wanneer wat:**
> - `passes[]` = **timing + status** per stap. Doel: Health-pagina ziet waar een run vastloopt. Één entry per pass, met `ms` en `status`.
> - `counts{}` = **summary-getallen** voor dashboard en analytics. Wat er inhoudelijk is verwerkt.
> - `extra{}` = **agent-eigen detail** dat niet in counts past (bijv. volledige RPC-terugkoppeling, debug-velden). Niet verplicht, wel handig voor debugging.

### Errors-discipline

`agent_runs.errors jsonb` is **niet** hetzelfde als `stats.warnings`. Hard rule:

| Issue-niveau | Plek | Voorbeeld |
|---|---|---|
| Hard error (run breekt af, retry nodig, of feature werkte echt niet) | `errors[]` als `[{severity, code, message, context}]` | `[{"severity":"error","code":"composio_token_expired","message":"...","context":{"endpoint":"outlook"}}]` |
| Soft warning (run completeert, attention gewenst) | `stats.warnings[]` (string-array) | `["mail_sync_well_known_name_recurring_bug"]` |
| Info / normaal resultaat | `summary` (text) + `stats.counts` | "11 nieuwe signalen geoogst" |

**`errors[].severity`** mapt 1-op-1 op het severity-model (zie verderop).

### Correlation: parent_run_id

`agent_runs.parent_run_id uuid` (nullable) — wanneer orchestrator een agent triggert, schrijft hij zijn eigen `run.id` mee in de child-run. Dat geeft een directe trace zonder timestamp-puzzelen. Bij pg_cron / manual-run blijft NULL.

### Helper-functie

`record_agent_run_v1(...)` — SQL-functie die het contract afdwingt en defaults vult. Niet verplicht, wel makkelijk:

```sql
SELECT record_agent_run_v1(
  p_agent_name      => 'auto-draft',
  p_run_type        => 'scheduled',
  p_started_at      => v_started,
  p_completed_at    => now(),
  p_status          => 'success',
  p_summary         => '38 mails verwerkt, 4 drafts klaar.',
  p_skill_version   => 'auto-draft-v5.2',
  p_triggered_by    => 'orchestrator',
  p_passes          => v_passes_jsonb,
  p_counts          => v_counts_jsonb,
  p_extra           => '{"_diagnose": {...}}'::jsonb,
  p_warnings        => ARRAY['some_warning'],
  p_errors          => '[]'::jsonb,
  p_parent_run_id   => v_parent
);
```

---

## Laag 2 — Output-state (`*_proposals`, `*_inbox`, etc.)

Output-tabellen hebben elk een eigen kolom (`status`, `state`, `decision_status`) — dat blijft. We standaardiseren wel de **mogelijke waarden** zodat één query ze kan kruisen.

### Standaard enum-set (MVP)

Type `output_state`:

| Waarde | Betekenis |
|---|---|
| `pending` | Wacht op review |
| `amended` | Door Jelle bewerkt; agent moet opnieuw verwerken |
| `executed` | Uitgevoerd / verzonden / verwerkt |
| `dismissed` | Door Jelle weggeklikt zonder actie |
| `expired` | Te oud, niet meer relevant (default ≥30d pending) |
| `failed` | Uitvoer geprobeerd maar mislukt; retry of manual nodig |

**Agent-specifieke extensies blijven mogelijk.** Auto-draft mag `flagged` houden, daily-admin mag `pending_retry` houden. We voegen toe, we hernoemen niet wat werkt. Nieuwe agents: gebruik MVP-set tenzij echt iets ontbreekt.

### Verplichte audit-kolommen

Elke output-tabel met state-flow heeft minimaal:

| Kolom | Type | Doel |
|---|---|---|
| `created_at` | timestamptz | Wanneer kwam de output binnen |
| `last_state_at` | timestamptz | Wanneer is state laatst gewijzigd |
| `reviewed_at` | timestamptz nullable | Wanneer reviewde Jelle (bij dismissed/amended/executed) |
| `reviewed_by` | text nullable | Vrijwel altijd `'jelle'` — toekomstige multi-user vergt geen schema-change |

### Stuck-pending regel

Een rij met `state='pending'` en `created_at < now() - interval '7 days'` → severity=warning op de Health-pagina. Threshold instelbaar per tabel via config; default 7d.

### View `agent_outputs_v1_view`

Read-time normalisatie: union van alle output-tabellen naar één shape `(agent_name, output_table, output_id, state, subject, created_at, last_state_at, reviewed_at, age_days)`. Dashboard en Health-pagina queryen alleen deze view.

---

## Laag 3 — Decision-trail

Decision-bronnen blijven gefragmenteerd (zoals nu) — elke agent heeft zijn eigen decision-flow met agent-eigen kolommen. We formaliseren een **minimum-set** + een unified read-view.

### Minimum-set kolommen

Elke decision-tabel heeft (of moet krijgen):

| Kolom | Type | Doel |
|---|---|---|
| `decided_at` | timestamptz | Wanneer is de keuze gemaakt |
| `decided_by` | text | Vrijwel altijd `'jelle'` |
| `action` | text | `accept` / `amend` / `dismiss` / `retire` / agent-specifiek |
| `amendment` | text nullable | Vrije tekst van Jelle's correctie |
| `reason` | text nullable | Kort waarom (optioneel) |

Bestaande tabellen die al hieraan voldoen: `autodraft_decisions`, `jellemind_lesson_proposals`, `agent_proposals`. Tabellen die nog kolommen missen: `tasks` (mist `amendment` als aparte kolom), `sales_on_road_events` (mist `decided_*`).

### Unified view `agent_decisions_unified`

```sql
CREATE OR REPLACE VIEW agent_decisions_unified AS
SELECT 'autodraft' AS source, ad.id, ad.autodraft_mail_id AS subject_id,
       ad.action, ad.amendment, ad.reason, ad.decided_at, ad.decided_by
  FROM autodraft_decisions ad
UNION ALL
SELECT 'jellemind', jp.id, jp.id, jp.status, jp.amend_instructions, jp.review_reason,
       jp.reviewed_at, jp.reviewed_by
  FROM jellemind_lesson_proposals jp
WHERE jp.status IN ('accepted','amended','dismissed')
-- ... etc per bron
;
```

Doel: één query voor analytics, voor de Health-pagina, en straks voor RAG-context ("hoe handelde Jelle eerder soortgelijke voorstellen af?").

---

## Severity-model — wat verschijnt op de Health-pagina

Type `agent_issue_severity`:

| Severity | Trigger | Kleur | Voorbeeld |
|---|---|---|---|
| `critical` | `errors[].severity='critical'` laatste 24u, OF 3+ opeenvolgende `agent_runs.status='error'` voor zelfde agent | 🔴 | "auto-draft 3× faillure: Composio-token expired" |
| `error` | `errors[].severity='error'` laatste 7d, OF status='error' run | 🟠 | "linkedin-connect: sessie verlopen" |
| `warning` | `errors[].severity='warning'`, OF non-empty `stats.warnings[]`, OF stuck-pending >7d | 🟡 | "23 voorstellen 10 dagen onaangeraakt" |
| `info` | runs successful, output in flow | 🟢 | (verborgen tenzij filter) |

**Deduplicatie:** Health-pagina toont één regel per `(agent_name, code, scope)` — niet 50 herhalingen van dezelfde recurring warning. View `agent_issues_aggregate` doet dit server-side.

**Click-through:** elk issue linkt naar context — run-detail bij run-error, output-row bij stuck-pending, decision-detail bij amend-conflict.

---

## Naming-conventie (hard vastgelegd)

| Soort | Conventie | Voorbeeld |
|---|---|---|
| Tabel — runs | `*_runs` | `agent_runs` |
| Tabel — voorstellen | `*_proposals` | `agent_proposals`, `jellemind_lesson_proposals` |
| Tabel — beslissingen | `*_decisions` | `autodraft_decisions` |
| Tabel — inbox / queue | `*_inbox` | `sales_on_road_inbox`, `kilometerregistratie_inbox` |
| Tabel — events / ledger | `*_events` | `sales_on_road_events` |
| Enum — state | `<entity>_state` | `output_state`, `agent_issue_severity` |
| SQL helper — insert/write | `record_*` | `record_agent_run_v1` |
| SQL helper — vector search | `match_*` | `match_jellemind_lessons` |
| SQL helper — cleanup | `cleanup_*` | `cleanup_agent_runs` |
| View — normalisatie | `*_v1_view` | `agent_runs_v1_view` |
| View — cross-source | `*_unified` | `agent_decisions_unified` |
| View — aggregatie | `*_aggregate` of `*_health_<window>` | `agent_issues_aggregate`, `agent_runs_health_7d` |

**Niet doen:** `*_log`, `*_history`, `*_audit` — onduidelijk welk laag-niveau. Gebruik specifiekere naam.

---

## Migration-checklist per agent

Voor elke agent die naar v1-contract migreert:

- [ ] Top-level keys aanwezig: `schema_version="1"` (STRING), `skill_version`, `triggered_by`, `triggered_at`
- [ ] `schema_version` is string `"1"`, niet integer `1` — verifieer met `jsonb_typeof(stats->'schema_version') = 'string'`
- [ ] `passes[]` gevuld OF bewuste opt-out (single-pass agent — geen passes is OK)
- [ ] `warnings[]` is array (mag leeg `[]`, sleutel mag NIET ontbreken)
- [ ] `counts{}` is object (mag leeg `{}`, sleutel mag NIET ontbreken)
- [ ] Geen losse counts als top-level keys — horen genest onder `counts{}`
- [ ] Hard errors verplaatst van summary-tekst naar `errors[]` met severity-veld
- [ ] Bij door-orchestrator-getriggerde agents: `parent_run_id` wordt doorgegeven
- [ ] Output-tabel (zo aanwezig): kolommen `created_at`, `last_state_at`, `reviewed_at`, `reviewed_by` aanwezig
- [ ] State-waarden zitten in MVP-set (of agent-specifieke extensie + nota waarom)
- [ ] Decision-tabel (zo aanwezig): `decided_at`, `decided_by`, `action`, `amendment` aanwezig
- [ ] Smoke-test: SQL-query `WHERE stats->>'schema_version'='1'` toont nieuwe runs
- [ ] Health-pagina toont agent met success_pct binnen verwachting

---

## Voorbeeld-stats per agent-categorie

### Sync-agent (mail-sync, hubspot-sync)

```jsonc
{
  "schema_version": "1",
  "skill_version": "mail-sync-etl-v2",
  "mode": "delta",
  "triggered_by": "pg_cron",
  "triggered_at": "2026-04-30T14:05:00.645Z",
  "passes": [],
  "warnings": [],
  "counts": {
    "folders_synced": 2,
    "messages_upserted": 153,
    "messages_deleted": 0,
    "delta_runs": 2,
    "full_scans": 0
  },
  "extra": {}
}
```

### Autonomous skill (auto-draft, daily-admin, jellemind)

```jsonc
{
  "schema_version": "1",
  "skill_version": "jellemind-v1.0",
  "mode": null,
  "triggered_by": "orchestrator",
  "triggered_at": "2026-04-30T07:25:37.537904+00:00",
  "passes": [
    { "name": "harvest", "ms": 1820, "status": "success" },
    { "name": "cluster", "ms": 340,  "status": "success" },
    { "name": "propose", "ms": 12400, "status": "success" },
    { "name": "embed",   "ms": 0,    "status": "skipped", "reason": "no accepted lessons" }
  ],
  "warnings": [],
  "counts": {
    "signals_new": 11,
    "proposals_created": 2,
    "proposals_amended_re_emitted": 0
  },
  "extra": {
    "window_from": "2026-03-31T00:00:00Z",
    "window_to":   "2026-04-30T07:27:37.537904+00:00"
  }
}
```

### Edge function (autodraft-rag-prefill, hubspot-engagements-sync)

```jsonc
{
  "schema_version": "1",
  "skill_version": "autodraft-rag-prefill-v1.0",
  "mode": null,
  "triggered_by": "pg_cron",
  "triggered_at": "2026-04-30T11:48:01.405Z",
  "passes": [],
  "warnings": [],
  "counts": {
    "processed": 40,
    "skipped_empty": 0,
    "total_tokens": 33505
  },
  "extra": {
    "avg_top_similarity": 0.935,
    "sync_check": { "is_fresh": true, "age_minutes": 2.8 }
  }
}
```

---

## Future-ready hooks

- **`schema_version`** — als we naar v2 evolueren (bijv. token-cost erbij), schrijven nieuwe runs v2; oude blijven v1; views normaliseren beide naar laatste shape.
- **`extra`** is bewust ongetypeerd — agent-specifieke metadata zonder schema-migration. Vraag voor je iets toevoegt: hoort dit in `counts` (gestructureerde teller) of `extra` (agent-eigen)?
- **Severity-enum** uitbreiden = `ALTER TYPE agent_issue_severity ADD VALUE 'security'` — geen breaking change.
- **`summary`** in mens-leesbaar Nederlands schrijven bij elke skill — straks bruikbaar voor RAG/analytics zonder embed-werk vooraf.
- **Decision-trail uniform** = één query straks voor "hoe handelde Jelle eerder?" ten behoeve van JelleMind F.4+ of soortgelijke skills.

---

## Cleanup-flow (akkoord-gestuurd, geen pg_cron tot expliciete go)

| Stap | Wat | Veiligheidsklep |
|---|---|---|
| 1 | Dry-run query `agent_runs_cleanup_dryrun(p_tier text)` toont per agent hoeveel oude rijen verwijderd zouden worden + oudste datum | Read-only |
| 2 | Jelle reviewt het rapport en geeft expliciet akkoord per tier | Geen actie zonder ja |
| 3 | Handmatige run `cleanup_agent_runs(5000)` — verwijdert max 5000 rijen | LIMIT cap, ruim boven dagelijkse instroom |
| 4 | Verifieer: `count(*)` daalde met verwacht aantal | Sanity-check |
| 5 | Pas na meerdere succesvolle handmatige runs + Jelle's go: pg_cron-job schedulen | Geen automation tot expliciete akkoord |

**Default tier-retentie (te valideren):**

| Tier | Retentie | Reden |
|---|---|---|
| source (mail-sync, hubspot-sync, jira-sync, mail-embed, mail-backfill, hubspot-engagements-sync) | 30d | Hoog volume, lage info-dichtheid per run |
| infra (orchestrator, dashboard-refresh) | 90d | Polling-loop |
| primary/secondary (auto-draft, daily-admin, jellemind, etc.) | 365d | Lage volume, hoge info-waarde — debug-bron |

**Lean-fase regel:** geen forced backfill van oude rijen naar v1-shape. Oude rijen blijven oud-format in de tabel; helper-views normaliseren bij read-time. Pas na cleanup verdwijnen ze.

---

## Cross-skill kennis

- `database.md` — voor migration-conventies, RLS-patronen, pg_cron-setup
- `confluence.md` — wanneer je deze regels-update wilt documenteren in een project-page
- `datascience-embeddings.md` — als je log-data ooit wilt embedden (out-of-scope nu, future-ready geborgd via `summary`-discipline)

---

_Laatste update: 2026-05-02 (v1.1 — schema_version type-waarschuwing, passes/counts/extra toelichting, migration-checklist aangescherpt). Update hier — niet ergens anders. Confluence-pages mogen pointers naar dit bestand bevatten, geen content-duplicaat (regel 1)._
