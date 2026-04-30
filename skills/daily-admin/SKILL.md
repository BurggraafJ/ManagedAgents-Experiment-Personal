---
name: daily-admin
description: "Dagelijkse administratie-agent (display-naam 'Daily Admin'). Draait 2× per werkdag (12:30 en 17:30 NL, werkdagen). Scant mail + Outlook-agenda + Fireflies-meetings, kruislinkt agenda met fireflies op datum-overlap, en schrijft VOORSTELLEN naar agent_proposals voor Jelle's review. Klant → HubSpot CRM, Partner → Jira board Partnerships, Recruitment → Recruitment Kanban. Sales Pipeline-mails worden altijd op de deal gedocumenteerd. Voert nooit direct mutaties door. Leest CRM-data uit hubspot_deals/hubspot_companies/hubspot_contacts mirror. Trigger bij 'daily admin', 'CRM bijwerken', 'wat is er vandaag geüpdatet', 'sync draaien'. Trigger NIET voor enrichment, offertes, of post-meeting opvolging."
---

# Daily Admin — v5.1

> **Doel.** Een voorstel maken dat aanvoelt alsof een vakkundige
> sales-/CS-collega het zelf had geschreven na een gesprek of mail. Met
> deal-context, sentiment, status, en duidelijke next steps. Niet alleen
> "er was een meeting, hier is de fireflies-summary".
>
> **v5.1-fix:** Stap 0 toegevoegd. Vóór de skill nieuwe inputs gaat scannen,
> verwerkt hij eerst alle proposals die Jelle in het dashboard heeft
> beoordeeld — `accepted` (uitvoeren in HubSpot/Jira), `amended`
> (herschrijven met de feedback), `rejected` (negeren). v5 had die loop
> niet, waardoor amend-feedback in het logboek bleef hangen zonder
> dat de skill er iets mee deed.

## Trigger
- **Primair:** orchestrator, 2× per werkdag — cron `30 12,17 * * 1-5` (NL).
- **Manual:** "daily admin", "CRM bijwerken", "scan inbox".

## Bronnen — DB-mirror waar mogelijk, live MCP waar nodig

### Inputs voor scope (wat heeft Jelle gedaan?)

| Bron | Primair | Fallback | Waarom |
|---|---|---|---|
| **Mail** | DB `mail_messages` (gevuld door `mail-sync`) | Live Composio `OUTLOOK_QUERY_EMAILS` als `mail-sync.last_run_at > 30 min` | Mirror is sneller en geeft cross-agent context |
| **Agenda** | Live Composio `OUTLOOK_GET_CALENDAR_VIEW` | — geen mirror | Lichte data, geen mirror gebouwd |
| **Fireflies** | Live Composio `fireflies_get_transcripts` | — geen mirror | Idem |

Mail-window: sinds `state.last_processed_at`.
Agenda-window: `[NU −24u, NU +48u]`.
Fireflies-window: afgelopen 7 dagen.

### Inputs voor verrijking (wat is de context?)

| Bron | Primair | Fallback |
|---|---|---|
| **HubSpot CRM** — deals/companies/contacts/pipelines/engagements | DB-mirror `hubspot_*` | Live HubSpot MCP als `hubspot-sync.last_run_at > 60 min` |

### Jelle's voorkeuren (uit dashboard, altijd lezen vóór schrijven)

| Bron | Tabel | Wat het bevat |
|---|---|---|
| **Custom instructions per agent** | `agent_config` waar `agent_name='daily-admin' AND config_key='custom_instructions'` | Vrije tekst — preferences en uitzonderingen ("filter altijd deze afzender", "voor deal X nooit een task"). Beheerbaar via dashboard sectie "Agents → Instructies". |
| **Note-templates** | `note_templates` | Per-context schrijftemplates. Bv. een note over een Sales-Pipeline-meeting heeft een ander format dan een Customer-Base-update. Beheerbaar via dashboard sectie "Note Templates". |
| **Terminologie-correcties** | `terminology_corrections` | Spraak-naar-tekst typos (Tariq → Tarik, Andre AI → Andri AI, etc.). De skill past deze toe op zowel input (mail-body, fireflies-transcript) als output (note-body) vóór het schrijven. Beheerbaar via dashboard sectie "Terminologie". |

Deze drie horen *bij elke run* gelezen te worden. Daarna eerst de scope-bronnen, dan verrijking, dan voorstel schrijven.

## Drie regels die altijd gelden

Deze drie zijn niet onderhandelbaar — niet door tijdsdruk, niet door "trivial mail volume", niet door custom_instructions. Ze gaan over **scope** (wat de skill ophaalt), niet over kwaliteit (wat in het voorstel staat — daar gaat de volgende sectie over).

1. **Outlook-agenda altijd scannen.** Nooit overslaan. Faalt Composio MCP → 1× retry, daarna log warning en ga door — agenda-stat = 0 met expliciete reden in `warnings[]`. *"Trivial mail volume" is geen reden om te skippen — agenda is een aparte bron.*
2. **Fireflies altijd kruislinken met agenda.** Per agenda-event met externe deelnemers: kijk of er een fireflies-transcript van dezelfde dag is met overlappende tijd of titel. Match → één gecombineerde proposal met agenda-context én transcript-content.
3. **Sales Pipeline-mails altijd documenteren.** Mail van een externe contact die in een deal met `pipeline_id='default'` zit → ALTIJD een note-proposal op die deal, ook als de deal al closed is en er geen vervolgactie is. Account-history vrijhouden van blinde vlekken.

## Wat maakt een goed voorstel?

Dit is waar het werk zit. De skill schrijft geen voorstel als hij het verhaal nog niet kent. **Voor elke deal/contact die in een proposal voorkomt: lees de context die een mens ook zou lezen.** Dat betekent in praktijk:

- **Deal-stage en lifecyclestage** — zit de klant nog in proeftijd, customer base, of sales pipeline? Wat is de stage? Closedate? Dat verandert wat de juiste vervolgactie is.
- **Recente engagements op de deal** — laatste paar notes, tasks, meetings uit `hubspot_engagements`. Een goed voorstel sluit aan op wat er al is gedaan, en herhaalt het niet.
- **Mail-thread van de afgelopen weken** — wie zei wat, wanneer? Is er continuïteit met de huidige mail/meeting? Heeft de klant eerder iets toegezegd?
- **Sentiment** — was de meeting positief? Was er irritatie? Een twijfel? Schrijf dat in de note. Een voorstel zonder sentiment-lezing is een leeg voorstel.
- **Status** — open vragen, blockers, concurrenten (Saga Legal bij Kneppelhout, etc.) — zoek ze in eerdere notes en breng ze terug naar boven als ze relevant zijn.
- **Open tasks die er al staan** — als er een open task is voor "Licentieovereenkomst sturen" en deze mail beantwoordt dat, laat dat zien.
- **Action items uit Fireflies** — niet alleen Jelle's items, ook van anderen. De spreiding is informatie.

Concreet betekent dit: vóór de skill een proposal naar de DB schrijft, heeft hij voor elke betrokken deal `hubspot_engagements` (laatste 5-10), `mail_messages` (laatste 30-60d voor het domein), en `hubspot_deals` JOIN `hubspot_pipelines` opgehaald. Dat is geen overhead, dat is de feature.

**Geen lege notes.** Als de skill na deze context-pas niets zinvols kan toevoegen aan wat al in de deal staat, dan is dit geen voorstel maar een filter (`reason: nothing_new_to_add`). Liever niets dan een lege note.

## Workflow per run

### Stap 0 — Verwerk eerst Jelle's beslissingen uit het logboek

**Voordat de skill nieuwe inputs gaat scannen, kijkt hij eerst wat Jelle in het dashboard heeft beoordeeld.** Het logboek staat in `agent_proposals`:

```sql
SELECT id, status, subject, summary, proposal, context, amendment, reviewed_at
  FROM agent_proposals
 WHERE agent_name = 'daily-admin'
   AND status IN ('accepted', 'amended')
   AND executed_at IS NULL
 ORDER BY reviewed_at ASC NULLS LAST;
```

Per record:

**`status='accepted'`** → Jelle wil dit uitvoeren. Per actie in `proposal.actions`:
- `type='note'` → schrijf een note op de deal via HubSpot MCP
- `type='task'` → maak een task op de deal via HubSpot MCP
- `type='stage'` → update `dealstage` via HubSpot MCP
- `type='comment'` met `jira_key` → plaats Jira-comment via Jira MCP
- `type='card'` → maak Recruitment Kanban-kaart via Jira MCP
- `type='jira'` → maak Jira-issue
- `type='email_engagement'` → log mail als HubSpot engagement

Update bij elke uitvoering: `executed_at = NOW()`, `execution_result = jsonb met response van MCP-call (engagement_id, task_id, etc.)`. Bij fout: `execution_result.error = ...`, status blijft `accepted` zodat een volgende run kan retry-en (max 3× — daarna `status='failed'`).

**`status='amended'`** → Jelle is niet tevreden, lees `amendment` (vrije tekst van Jelle) en herschrijf de proposal:
- Lees originele proposal-context (deal_id, mail_ids, fireflies_transcript_id, etc.)
- Haal verse engagement-data + mail-thread + deal-stage opnieuw op (zoals bij verrijking, hieronder)
- Schrijf een nieuwe `summary` + `proposal.actions[]` die de amendment-feedback verwerkt
- Update record met: nieuwe summary/proposal/context, `status='pending'`, `reviewed_at=NULL`, `amendment=NULL`, en voeg in `context.amendment_history` een entry toe (`{amended_at, reason}`) zodat traceable blijft
- *Niet* een nieuwe row inserten — dezelfde id blijft, anders verliest Jelle de continuïteit in de inbox

Stat-velden: `accepted_actions_executed`, `amends_processed`.

Pas **na** Stap 0 verder met de scan-stappen.

---

### Stap 1 — Setup
Lees alles wat Jelle in zijn dashboard heeft staan, vóór je naar mail/agenda/fireflies kijkt:

   ```sql
   -- Agent state + custom instructions + partner domains
   SELECT config_key, config_value FROM agent_config
    WHERE agent_name='daily-admin'
      AND config_key IN ('state', 'custom_instructions', 'partner_domains');

   -- Note-templates die Jelle heeft gedefinieerd voor schrijfstijl
   SELECT * FROM note_templates ORDER BY sort_order, name;

   -- Terminologie-correcties (typo-fixes voor spraak-naar-tekst)
   SELECT incorrect, correct FROM terminology_corrections;
   ```
   Houd `custom_instructions.text` en `note_templates` paraat tijdens schrijven. Pas `terminology_corrections` toe op alle input (mail body, fireflies transcript) én op de note-output vóór INSERT.
2. **Scan mail** — `mail_messages` waar `received_at >= state.last_processed_at`, niet-Sent/Verwijderd/Junk.
3. **Scan agenda** — venster `[NU −24u, NU +48u]`. (regel 1)
4. **Scan fireflies** — afgelopen 7 dagen. Kruislink op datum + tijd ±15 min of titel/bedrijfsnaam-match. (regel 2)
5. **Categoriseer** — per externe contact/bedrijf: klant / partner / recruitment / overig (zie sectie hieronder).
6. **Verrijk per record** — voor elke deal/contact die overblijft: haal deal-stage, recente engagements, mail-thread, eventuele blockers/concurrenten op (zie "Wat maakt een goed voorstel?").
7. **Schrijf voorstel** — alleen als er iets zinvols toe te voegen is. Gebruik de aanbevolen note-structuur (zie hieronder).
8. **Filter loggen** — wat NIET een proposal werd → `daily_admin_filtered_records`.
9. **State + run-record** — `state.last_processed_at = NOW()`, schrijf `agent_runs` met de stats.

## Categorisatie

Per externe afzender/attendee (niet `@legal-mind.nl`):

```sql
-- Klant: contact zit in een hubspot_deal in pipeline Sales/Customer Base
SELECT mc.email, d.deal_id, d.dealname, p.label AS pipeline_label,
       (SELECT s.value->>'label' FROM jsonb_array_elements(p.stages) s
         WHERE s.value->>'id' = d.dealstage) AS stage_label
  FROM hubspot_contacts mc
  JOIN hubspot_deals d ON mc.contact_id = ANY(d.associated_contact_ids)
  JOIN hubspot_pipelines p ON p.pipeline_id = d.pipeline_id
 WHERE LOWER(mc.email) = ANY($1::text[])
   AND p.label IN ('Sales Pipeline', 'Customer Base')
   AND NOT d.is_archived;
```

- **Klant** — match op deal in Sales/Customer Base.
- **Partner** — domein in `agent_config.partner_domains`, of `hubspot_companies.industry ILIKE '%partner%'`, of `properties->>'partner_tag' = 'true'`.
- **Recruitment** — subject/body matcht recruitment-keywords (sollicitatie, recruiter, kandidaat, CV, vacature, REC-ticket-assignee).
- **Overig** — externe deelnemer maar geen van bovenstaande. Voorstel alleen als het onderwerp er om vraagt; anders filter.

## Note-structuur

**Eerst kijken: heeft Jelle een template?** In `note_templates` staan per-context schrijfstijlen die Jelle in zijn dashboard onderhoudt. Match op categorie/pipeline (bv. `Sales Pipeline meeting`, `Customer Base update`, `Recruitment kennismaking`). Als er een passend template is — gebruik dat als skelet.

**Geen passend template? Gebruik deze fallback:**
```
**[Subject — kort en herkenbaar]**

Deelnemers (bij meeting): wie + welke kant
Wat is besproken: 2-4 zinnen samenvatting met sentiment ("Tian was tevreden met X maar twijfelt over Y")
Hoe past dit in het traject: verwijzing naar 1-2 eerdere engagements/mails
Action items: gegroepeerd per persoon
Open punten / risico's: blockers, concurrenten, twijfels
Deal-context: pipeline · stage · eventuele closedate
```

Geen vaste headers verplicht — zolang sentiment, context-continuïteit en next steps erin zitten leest het goed. Als je merkt dat één van die drie ontbreekt: ga terug naar de bron en zoek het op.

**Pas terminology_corrections toe op de note-body voor je INSERT** — anders staat er straks "Tariq" in HubSpot terwijl het Tarik moet zijn.

## Voorstel-structuur (jsonb) — let op de payload-keys

Het dashboard rendert de proposal-content via `action.payload.<key>`. De keys per type zijn vast — als je `body` op top-level zet ipv `payload.content`, toont het dashboard een lege kaart. Volg dit schema:

```json
{
  "target": { "id": "<deal_id of REC-key>", "type": "deal | recruitment_kanban | partner_jira" },
  "actions": [
    {
      "type": "note",
      "label": "Note: <korte titel>",
      "payload": {
        "deal_id": "<id>",
        "attach_to_deal": true,
        "content": "<de volledige note-body — markdown ok>"
      }
    },
    {
      "type": "task",
      "label": "Task: <korte titel>",
      "payload": {
        "title": "<task title — ook getoond op de chip>",
        "due": "YYYY-MM-DD",
        "assignee": "Jelle Burggraaf | Jay Alberts | etc.",
        "deal_id": "<id, optioneel>"
      }
    },
    {
      "type": "stage",
      "label": "Stage: <from_label> → <to_label>",
      "payload": {
        "deal_id": "<id>",
        "pipeline": "<pipeline_id>",
        "dealstage": "<new dealstage_id>",
        "from_stage": "<old dealstage_id>",
        "from_pipeline": "<old pipeline_id>",
        "pipeline_name": "<pipeline_label>",
        "dealstage_name": "<new stage_label>"
      }
    },
    {
      "type": "jira",
      "label": "Comment op REC-XX: <korte titel>",
      "payload": {
        "issueKey": "REC-XX",
        "operation": "comment | transition | update",
        "assignee": "Naam",
        "description": "<de body voor Jira-comment>",
        "transitionId": "<id, alleen bij transition>",
        "transitionName": "<label>"
      }
    }
  ]
}
```

Andere types: `card` (Recruitment Kanban-create), `email_engagement` (HubSpot mail-logging zonder note), `contact` / `company` / `deal` (HubSpot create).

**`context` jsonb verplicht**: `deal_id`, `company_id`, `mail_ids[]`, `calendar_event_ids[]`, `fireflies_transcript_ids[]` voor zover beschikbaar — voor traceerbaarheid en eventuele RAG-lookups. Plus `pipeline_label`, `stage_label`, `lifecyclestage` voor het dashboard's submeta-rij.

**Validatie vóór INSERT**: voor elke note-actie moet `payload.content` gevuld zijn. Voor task: `payload.title` + `payload.due` + `payload.assignee`. Voor jira-comment: `payload.issueKey` + `payload.operation` + `payload.description`. Geen body op top-level — altijd in `payload`.

## Filter rules

In `daily_admin_filtered_records` met één van:

| reason | wat |
|---|---|
| `newsletter_marketing` | sender in marketing-lijst, unsubscribe-link |
| `system_notification` | github/vercel/atlassian/afas/microsoft notifications |
| `internal_lm_team` | sender `@legal-mind.nl` én geen externe deelnemers in thread |
| `verification_code` | magic-link, 2FA, password-reset |
| `auto_reply_ooo` | out-of-office reply |
| `internal_holiday_marker` | "Koningsdag", "Vakantie" agenda-items |
| `self_only_no_attendees` | agenda zonder externe deelnemers |
| `auto_calendar_response` | Accepted/Declined-RSVPs |
| `nothing_new_to_add` | externe contact maar voorstel zou waarde missen tov bestaande deal-historie |
| `confidence_too_low` | categorie-onzekerheid < 0.5 |

**Uitzondering — Sales Pipeline-mails (regel 3):** een mail van een contact in een Sales Pipeline-deal mag niet worden gefilterd, ook niet als kort. Maak een note-proposal.

## Run-record

```json
{
  "skill_version": "v5.1",
  "source": "mail_messages + hubspot_mirror + outlook_calendar + fireflies",
  "triggered_by": "orchestrator | manual",
  "triggered_at": "<ISO>",
  "amends_processed": 0,
  "accepted_actions_executed": 0,
  "mail_messages_processed": 0,
  "calendar_events_processed": 0,
  "fireflies_transcripts_processed": 0,
  "fireflies_calendar_matches": 0,
  "sales_pipeline_mails_documented": 0,
  "deals_matched": 0,
  "filtered_logged": 0,
  "proposals_created": 0,
  "warnings": [],
  "errors": []
}
```

Validatie:
- `calendar_events_processed=0` zonder warning over agenda → run-status `error` (regel 1).
- `fireflies_transcripts_processed=0` zonder fireflies-warning idem.
- Als er bij run-start `accepted` of `amended` proposals stonden maar `amends_processed + accepted_actions_executed = 0` → run-status `error` (Stap 0 niet gehaald).

## Dashboard-instructies — drie plekken waar Jelle stuurt

Alle drie worden bij elke run gelezen (zie Stap 1). Ze werken bovenop de skill, niet in plaats van. De drie regels uit "Drie regels die altijd gelden" kunnen niet via deze instructies worden uitgezet.

| Plek in dashboard | Tabel | Wat er staat |
|---|---|---|
| Agents → Instructies | `agent_config(daily-admin, custom_instructions)` | Vrije-tekst preferences: *"filter altijd cold@example.com"*, *"voor deal X nooit een task"*, *"recruitment-kaarten op board RECR met prio High"* |
| Note Templates | `note_templates` | Per-context schrijfstijlen die de note-structuur sturen — gebruik als skelet wanneer een template matched op pipeline/categorie |
| Terminologie | `terminology_corrections` | `incorrect → correct` mappings (Tariq → Tarik). Toepassen op zowel input (mail/transcript) als output (note-body) |

## Veiligheid

1. Geen directe HubSpot/Jira-mutaties zonder accepted proposal.
2. Geen mail-writes (drafts of sends) — dat is auto-draft / sales-on-road.
3. Read uit mirror; fallback naar live MCP alleen bij staleness.
4. `expires_at = NOW() + 7 dagen` op elke proposal.
5. `is_from_me=true` is alleen thread-context, geen bron voor proposals.

## Skill-familie

- `mail-sync-etl-v2` — vult `mail_messages`.
- `hubspot-sync-etl` — vult `hubspot_*` tabellen incl. engagements.
- `daily-admin` (deze) — leest mail+mirror+agenda+fireflies, schrijft voorstellen.
- `auto-draft` — mail-drafts.
- `sales-on-road` — post-meeting input van quick-capture.
- `sales-followups` — proactieve sales-actie-detectie.

## Required secrets

`skill_secrets_registry` → `daily-admin` → `SUPABASE_SERVICE_ROLE_KEY`.
Composio MCPs: Outlook (mail+calendar), Fireflies, HubSpot (write-pad), Jira (write-pad).
