---
name: task-organizer
description: Beheert Jelle's Taken-tabblad. Vier passes per run — (1) Fireflies-scan voor action-items voor Jelle Burggraaf met is_newly_found=true, (2) Jira-sync van Sales/Management/Recruitment-boards (upsert open issues, auto-close gesloten), (3) clustering in projecten + deadlines/prioriteiten, (4) completion-detection. Draait dagelijks 06:00 en handmatig via dashboard-knop "✨ AI herindelen". Trigger bij "herorganiseer taken", "indeel taken", "taken opschonen", "scan fireflies", "sync jira", "task-organizer", of vragen om Fireflies/Jira-takenoverzicht te verversen. Trigger NIET voor nieuwe taken schrijven (quick-capture in dashboard) of voor mail/HubSpot/Sales-acties (eigen agents).
---

# Task Organizer

Centrale skill die de **Taken**-pagina van het dashboard schoonhoudt. Eén verantwoordelijkheid: losse, niet-gecategoriseerde taken nadenkend indelen in de juiste projecten.

## Doel in één zin

Lees alle `tasks` waar `ai_processed = false` en open zijn, en zet voor elk: het juiste project, een vermoede deadline of doe-datum, een prioriteit, een paar tags, en een korte uitleg waarom. Stel zo nodig een nieuw project voor.

## Wat de skill NIET doet

- **Geen nieuwe taken schrijven.** De quick-capture in het dashboard schrijft direct naar `tasks` met `ai_processed=false`. Deze skill ziet die rijen vanzelf.
- **Geen taken afmaken.** Status `done` of `dropped` zet alleen Jelle handmatig.
- **Niets overschrijven dat Jelle handmatig heeft gezet.** Als de taak al een `project_id` heeft, vul alleen aanvullende velden — laat het project staan tenzij Jelle expliciet `ai_processed=false` heeft gezet (dan mag je herindelen).
- **Geen mails versturen, geen HubSpot-mutaties, geen externe meldingen.** Andere agents doen dat.

## Bronnen die de skill leest

| Tabel | Waarvoor |
|---|---|
| `public.tasks` | de taken zelf — filteren op `ai_processed=false AND status NOT IN ('done','dropped')` |
| `public.task_projects` | bestaande projecten + hun `ai_match_hint` om tegen te matchen |
| `public.tasks` (alle) | ter referentie — als 5 andere taken in project X duidelijk lijken op deze taak, is dat een sterk signaal |
| `public.agent_schedules` | run-state lezen, niet schrijven (orchestrator beheert dit) |
| `public.agent_config` | bewaart `fireflies_last_scan_at` voor de Fireflies-scanner |
| Fireflies MCP | `mcp__*__fireflies_get_transcripts` + `fireflies_get_summary` voor action-items |
| `public.jira_issues` | gevuld door `jira-sync` skill — task-organizer LEEST hieruit, raakt Jira zelf niet aan |
| `public.jira_projects` | gevuld door `jira-sync` skill — voor board-mapping (category) |

## Hoe je de skill draait

Je draait via de orchestrator. Bij een handmatige run vanuit Jelle's prompt of vanaf het dashboard:

1. **Authenticeer naar Supabase.** Gebruik de service-role key uit `skill_secrets_registry` of `.env` (zelfde patroon als andere skills — vraag de orchestrator-context).
2. **Haal werkset op.**
   ```sql
   select id, title, notes, source, source_ref, source_url, project_id, priority,
          deadline, do_date, tags, created_at, ai_reasoning
   from public.tasks
   where ai_processed = false
     and status not in ('done','dropped')
   order by created_at asc
   limit 100;
   ```
3. **Haal projecten op.**
   ```sql
   select id, name, description, ai_match_hint, deadline, status
   from public.task_projects
   where status = 'active'
   order by sort_order;
   ```
4. **Haal context op.** Tel per project hoeveel open taken er al inzitten, en pak titels van de laatste 5 per project — dit helpt fuzzy-matching.
   ```sql
   select project_id, title from public.tasks
   where status = 'open' and project_id is not null
   order by updated_at desc
   limit 200;
   ```

## Stap 0 — Fireflies action-items voor Jelle ophalen

**Voer deze pas eerst uit, vóór de werkset uit `tasks` op te halen.** Resultaat: nieuwe rijen in `tasks` met `source='fireflies'` en `is_newly_found=true` zodat het dashboard ze in het "Nieuw gevonden taken"-blok toont.

1. **Lees laatste scan-tijd:**
   ```sql
   select config_value->>'iso' as last_scan
   from public.agent_config
   where agent_name='task-organizer' and config_key='fireflies_last_scan_at';
   ```
   Default: 7 dagen geleden. Cap op 30 dagen geleden om grote bulk-imports te voorkomen.

2. **Haal Fireflies-transcripts sinds last_scan op** via `fireflies_get_transcripts` (filter op `from_date`/`to_date`, paginate als > 50). Voor elk transcript: `fireflies_get_summary` om de **action_items** te krijgen.

3. **Filter action-items op Jelle.** Jelle = `Jelle Burggraaf` / `Jelle` / `burggraaf@legal-mind.nl`. Match case-insensitive. Skip generieke action-items (geen assignee), skip items voor anderen.

4. **Dedupe.** Voor elk gevonden action-item, bouw `source_ref = '{transcript_id}::{action_item_index_or_short_hash}'`. Check:
   ```sql
   select 1 from public.tasks
   where source='fireflies' and source_ref=$ref
   limit 1;
   ```
   Als bestaat: skippen. Anders insert:
   ```sql
   insert into public.tasks (
     title, notes, source, source_ref, source_url,
     is_newly_found, discovered_at, ai_processed
   ) values (
     $action_item_text,                              -- bv. "Stuur offerte naar Acme"
     $context_zin || E'\n\nUit meeting: ' || $title || ' (' || $date || ')',
     'fireflies',
     $ref,
     $fireflies_meeting_url,                          -- klikbaar terug naar transcript
     true,                                            -- toont in "Nieuw gevonden"-blok
     now(),
     false                                            -- regel-pas pakt 'm later op
   );
   ```

5. **Update last_scan-tijd** wanneer alles gelukt is:
   ```sql
   update public.agent_config
   set config_value = jsonb_build_object('iso', now()::text),
       updated_at   = now()
   where agent_name='task-organizer' and config_key='fireflies_last_scan_at';
   ```
   **Niet** updaten als de Fireflies-call faalde — anders mis je meetings.

**Veiligheidsklep**: max 30 nieuwe Fireflies-taken per run. Als er meer zijn (zeldzaam), log waarschuwing en pak de rest volgende run.

**Geen duplicaten van bestaande tasks**: voor elke kandidaat eerst fuzzy-vergelijken met open `tasks` waarvan `created_at > now() - 14 days` — als titels > 0.85 lijken (bv. "Mail stuurplan naar Acme" vs. "Stuur stuurplan naar Acme"), skip insert en log dat in agent_runs.stats.

## Stap 0.5 — Jira-pas (lees `jira_issues`, upsert in `tasks`)

Doel: alle open Jira-issues toegewezen aan Jelle verschijnen in zijn taken-overzicht. Issues die in Jira gesloten/niet-meer-toegewezen zijn worden in `tasks` ook automatisch op `done` gezet ("wegwerken als ze al weg zijn").

**Belangrijk:** deze skill praat NIET direct met Jira. Dat doet de aparte `jira-sync` skill (heartbeat elke 5 min). Wij lezen de mirror-tabellen `jira_issues` en `jira_projects`. Voordeel: snel, geen rate-limits, en consistent met de mail-sync architectuur.

1. **Lees freshness van de mirror:**
   ```sql
   select last_delta_sync, last_full_sync, total_issues, last_error
   from public.jira_sync_state where id=1;
   ```
   Als `last_delta_sync IS NULL` of > 30 minuten oud: log waarschuwing in `agent_runs.stats.jira_sync_stale = true` maar ga toch door — beter stale data dan niets.

2. **Haal open Jira-issues van Jelle op:**
   ```sql
   select i.*, p.category as board_category
   from public.jira_issues i
   join public.jira_projects p on p.key = i.project_key
   where i.status_category != 'done'
     and (i.assignee_email = 'burggraaf@legal-mind.nl'
          or lower(coalesce(i.assignee_name, '')) like '%jelle%burggraaf%'
          or lower(coalesce(i.assignee_name, '')) like '%burggraaf%jelle%')
   order by coalesce(p.category, 'zzz'), i.due_date nulls last;
   ```

3. **Per issue: upsert in `tasks`.** `source_ref = issue.issue_key`. Lookup eerst:
   ```sql
   select id, status from public.tasks
   where source='jira' and source_ref=$issue_key limit 1;
   ```

   - **Bestaat**: UPDATE met verse mirror-data (title, status, board, deadline, priority, in_backlog). Behoud `tasks.status` tenzij Jira `status_category='done'` is — dan zet je `tasks.status='done'`.
   - **Nieuw**: INSERT met `source='jira'`, `source_ref=issue_key`, `source_url=jira_issues.url`, `is_newly_found=true` zodat het in het "Nieuw gevonden"-blok verschijnt.

   Velden uit `jira_issues`:
   ```
   title              = summary
   notes              = first 500 chars van description
   deadline           = due_date
   jira_status        = status
   jira_status_category = status_category
   jira_in_backlog    = in_backlog
   jira_board         = board_category   (Sales/Management/Recruitment/null)
   jira_priority      = priority
   jira_issue_type    = issue_type
   jira_last_synced   = synced_at
   priority           = map_jira_priority(priority)  -- Highest/High→'high', Lowest→'low', else 'normal'
   ai_processed       = true            -- skip clustering, project komt uit board-mapping
   ai_reasoning       = 'Uit Jira ' || coalesce(board_category, project_key) || ' (' || issue_key || ')'
   ```

   Project-toewijzing op basis van `jira_board`:
   - `Sales` → bestaand "Legal Mind"-project, of een dedicated "Sales"-project als die er is
   - `Management` → "Legal Mind" of "Agents & dashboard"
   - `Recruitment` → bestaand "Recruitment"-project, anders aanmaken (telt als de "1 nieuw project per run"-regel uit Stap 1)
   - `null` → laat `project_id` leeg, valt in Inbox

4. **Auto-cleanup**: tasks waar de Jira-issue niet meer open is.
   ```sql
   update public.tasks
   set status='done',
       ai_reasoning = 'Auto-closed — Jira-issue ' || source_ref || ' is niet meer open of niet aan Jelle toegewezen'
   where source='jira'
     and status not in ('done','dropped')
     and source_ref not in (
       select issue_key from public.jira_issues
       where status_category != 'done'
         and (assignee_email='burggraaf@legal-mind.nl'
              or lower(coalesce(assignee_name,'')) like '%jelle%burggraaf%')
     );
   ```

5. **Veiligheidsklep**: als `jira_sync_state.last_error IS NOT NULL` van de laatste run: skip de auto-cleanup. Anders zou je alle Jira-tasks ten onrechte sluiten als jira-sync net faalde.

## Beslisproces per taak

Voor elke taak in de werkset, denk hardop in deze volgorde:

### Stap 1 — project kiezen

Als de taak al een `project_id` heeft: **niet wijzigen**, ga door naar stap 2.

Anders: vergelijk de titel + notes met elke project-`ai_match_hint` én met de bestaande titels in dat project. Geef elk project een mentale score 0–1.

- **> 0.7** → toewijzen.
- **0.4–0.7** → twijfel: laat in Inbox (project_id blijft `null`), maar zet wel `ai_suggested_project` op de naam van de beste kandidaat met `ai_confidence` op de score.
- **< 0.4** voor alle projecten → laat in Inbox.

**Speciaal geval — clustering:** Als 3 of meer onbeoordeelde taken duidelijk over hetzelfde nieuwe thema gaan (bv. "skill-creator", "pdf-tool werkt niet", "schrijf SOP voor X" → "Documentatie & SOPs"), stel **één** nieuw project voor:

```sql
insert into public.task_projects (name, description, color, icon, ai_match_hint, sort_order)
values ('<bedachte naam>', '<korte omschrijving>', '<hex>', '<emoji>', '<match-hint>', 90)
returning id;
```

…en wijs de cluster-taken toe aan dat nieuwe project. Doe dit hoogstens **één keer per run**, anders wordt de projectenlijst rommel.

### Stap 2 — deadline / doe-datum detecteren

Lees `title` en `notes`. Detecteer:
- **Expliciete data:** "vrijdag", "morgen", "voor 12 mei", "deadline 30/04". Zet als `deadline`.
- **Doe-context:** "moet ik vandaag oppakken", "morgen even", "deze week". Zet als `do_date`.
- **Indirecte signalen:** "voor de meeting van …", "vóór onze call met …" — als de meeting-datum bekend is uit `source_ref`/`source_url` of recente Fireflies-data, gebruik die.

Als geen datum overtuigend is: laat beide velden `null`. **Liever leeg dan fout.**

Respecteer reeds gezette waarden — overschrijf alleen als de bestaande waarde duidelijk fout is (bv. deadline in het verleden voor een nieuwe taak).

### Stap 3 — prioriteit

Default `normal`. Verhoog op:
- **urgent**: woorden als "spoed", "asap", "vandaag nog", "morgen klant", "kritiek", of overdue deadline.
- **high**: "belangrijk", "moet zeker", "voor klant X" (als X in pipeline-fase late stage zit), of deadline binnen 2 dagen.
- **low**: "ooit", "als ik tijd heb", "kleinigheidje".

### Stap 4 — effort en tags

- **effort**: detecteer `quick` (< 15 min: "even mailen", "snel checken"), `medium` (default voor de meeste taken), `deep` (> 1u, "schrijf SOP", "bouw skill").
- **tags**: max 3, lowercase, geen spaties. Bv. `#klant-acme`, `#offerte`, `#bug`. Voeg toe wat je in de tekst leest, niet wat je verzint.

### Stap 5 — reasoning + confidence

Schrijf één korte zin (`ai_reasoning`, max ±120 tekens) waarom je deze keuzes maakte. Dit is wat Jelle ziet onder de taak en wat hem helpt jou te corrigeren. Voorbeelden:

- "Genoemde klant 'Acme' valt onder Legal Mind sales-pipeline; deadline uit 'voor maandag'."
- "Lijkt op 3 andere skill-bouw-taken in 'Agents & dashboard'."
- "Geen project past goed (0.5 voor Legal Mind) — laat in Inbox met suggestie."

`ai_confidence`: float 0..1 — hoe zeker ben je van de project-keuze?

### Stap 6 — "mogelijk al klaar" detecteren

Dit is de **completion-detection-pas**. Voor elke open taak (status='open' en `completion_rejected=false`): kijk in andere Supabase-tabellen of er recent (laatste 30 dagen) een signaal staat dat suggereert dat deze taak al uitgevoerd is.

Bronnen + patronen:

| Bron | Wat tellen als "klaar"-signaal | Hoe matchen |
|---|---|---|
| `autodraft_decisions` | `action='send'` en `executed_at IS NOT NULL` | taak vermeldt "mail X / antwoord X" + recipient overlapt met `from_email` van de mail |
| `draft_events` | events met sent/delivered status | zelfde mail-id of recipient match |
| `sales_todos` | `status='completed'` | taak vermeldt company_name uit sales_todos |
| `linkedin_activity_log` | `status='sent'` of `event_type='invite_sent'` | taak vermeldt persoon/kantoor uit `target_name` |
| `agent_proposals` | `status='accepted'` of executed | taak vermeldt company/contact uit proposal |
| `hubspot_activities` | recent processed met stage-change | taak vermeldt deal/company en stage past bij verwachte uitkomst |
| `sales_on_road_events` | `status='processed'` | taak vermeldt persoon/kantoor uit dashboard quick-capture |
| `km_trips` | rij voor periode in title | taak "doe maand X kilometerregistratie" + km_trips heeft rijen voor X |
| `agent_runs` | succesvolle run van een specifieke skill | taak "draai skill X" → recente success run |

Wees **conservatief**:

- Alleen flaggen als je `confidence >= 0.6` hebt.
- Liever niet flaggen dan een echte taak verstoppen — Jelle moet erop kunnen vertrouwen dat als iets in zijn lijst staat, het er hoort.
- Sla over wanneer `completion_rejected=true` (Jelle heeft al "nee, dat moest ik nog doen" gezegd).
- Sla over wanneer `completion_candidate` al `true` staat én `completion_detected_at` < 7 dagen oud (we hebben hem al geflagd, niet opnieuw doen).

Wegschrijven van een match:

```sql
update public.tasks
set completion_candidate    = true,
    completion_evidence     = $human_zin,           -- bv. "Mail naar john@acme.com verstuurd op 2026-04-23 via auto-draft"
    completion_evidence_url = $optional_url,        -- klikbaar terug naar bron, indien bekend
    completion_source       = $source,              -- 'autodraft', 'sales_todos', 'linkedin', etc
    completion_confidence   = $0_to_1,
    completion_detected_at  = now()
where id = $id and status not in ('done','dropped') and completion_rejected = false;
```

Belangrijk: zet `status` zelf NIET op 'done'. Jelle accepteert in het dashboard, dat zet status='done'. Als hij rejecteert wordt `completion_rejected=true` gezet.

## Wegschrijven

Doe het in één UPDATE per taak (geen RPC nodig — service-role mag direct schrijven):

```sql
update public.tasks
set project_id           = $project_id,
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
where id = $id;
```

## Run-resultaat naar Supabase

Schrijf één rij naar `agent_runs` met agent_name='task-organizer', status, summary en stats:

```json
{
  "fireflies_meetings_scanned": 6,
  "fireflies_action_items_found": 4,
  "fireflies_skipped_duplicate": 1,
  "jira_boards_resolved": ["Sales", "Management", "Recruitment"],
  "jira_issues_synced": 17,
  "jira_issues_inserted": 3,
  "jira_issues_updated": 14,
  "jira_issues_auto_closed": 2,
  "tasks_seen": 12,
  "tasks_assigned": 9,
  "tasks_left_in_inbox": 3,
  "deadlines_detected": 4,
  "new_project_proposed": "Documentatie & SOPs",
  "high_confidence_count": 7,
  "low_confidence_count": 2,
  "completion_candidates_flagged": 4,
  "completion_evidence_sources": ["autodraft", "sales_todos", "linkedin"]
}
```

In `summary`: één zin in NL — "4 nieuwe Fireflies-taken, 9 van 12 ingedeeld (1 nieuw project), 4 mogelijk al klaar."

## Veiligheidsklep

- **Maximaal 100 taken per run.** Als er meer zijn, doe de oudste eerst — volgende run pakt de rest.
- **Maximaal 1 nieuw project per run.**
- **Geen mutaties op `task_projects.name`** — projecten hernoemen doet Jelle handmatig.
- **Bij twijfel: skip.** Beter een taak nóg een dag in de Inbox dan verkeerd ingedeeld; Jelle ziet dit terug en kan corrigeren door zelf een project te pikken (en dan `ai_processed=true` te zetten zodat jij hem niet nog eens probeert).

## Stop-condities

Stop direct en log een waarschuwing als:
- Geen Supabase-credentials beschikbaar → "skill_secret missing".
- > 200 taken openstaan met `ai_processed=false` → er gebeurt iets vreemds (bulk-import?). Doe niets, vraag Jelle in `agent_feedback` of `open_questions`.
- Een UPDATE faalt door RLS — log en sla die taak over.

## Rapportage

- **Geen externe meldingen** — deze skill is een stille opruimer. De resultaten zijn zichtbaar in het Taken-tabblad zelf.
- **Wel `agent_runs`-rij** — heartbeat voor het dashboard. Errors landen als `status='error'` met leesbare summary.
- **Bij voorgesteld nieuw project**: het project wordt direct aangemaakt (status='active'). Jelle kan in het tabblad een project archiveren of hernoemen — dat is de feedback-loop.

## Iteratie

Deze skill is bewust simpel v1. Mogelijke uitbreidingen later (alleen als Jelle ze vraagt):
- Lessons-tabel zoals `autodraft_style_lessons` waar correcties van Jelle (project-wijziging na AI-toewijzing) gecondenseerd worden.
- Fireflies/Outlook integratie: taken automatisch laten ontstaan uit action-items in een meeting-transcript.
- Wekelijkse "review": haal taken die > 30 dagen open staan boven en stel snooze of dropped voor.
