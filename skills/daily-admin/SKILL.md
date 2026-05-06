---
name: daily-admin
description: "Dagelijkse administratie-agent (display-naam 'Daily Admin'). Draait 2× per werkdag (12:30 en 17:30 NL, werkdagen). Scant mail + Outlook-agenda + Fireflies-meetings, kruislinkt agenda met fireflies op datum-overlap, en schrijft VOORSTELLEN naar agent_proposals voor Jelle's review. Klant → HubSpot CRM, Partner → Jira board Partnerships, Recruitment → Recruitment Kanban. Sales Pipeline-mails worden altijd op de deal gedocumenteerd. Voert nooit direct mutaties door. Leest CRM-data uit hubspot_deals/hubspot_companies/hubspot_contacts mirror. Trigger bij 'daily admin', 'CRM bijwerken', 'wat is er vandaag geüpdatet', 'sync draaien'. Trigger NIET voor enrichment, offertes, of post-meeting opvolging."
---

# Daily Admin — v5.3 (context-build CaaS)

> **v5.3 wijziging (2026-05-04):** Stap "verrijking via match_chunks_for_entity" vervangen door één POST naar `context-build` met `intent='enrich_record'`. Skill hoeft niet meer zelf chunks-embedding te queryen of recipe-knoppen te kennen. Bundle_id geschreven voor R.7-link.

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

**Auth & MCP-fallback voor alle Composio-calls hieronder:** zie [`agent-handbook/references/authentication.md`](../agent-handbook/references/authentication.md) — single source. Decision-tree (sectie 1) bepaalt automatisch v2/v3 route op basis van read vs write-met-associations. Skill noemt geen route hier; de handbook is leidend.

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

1. **Outlook-agenda altijd scannen.** Nooit overslaan. Bij Composio MCP-uitval automatisch REST-fallback (zie auth-pointer hierboven). Niet stoppen, niet "agenda-stat = 0" — REST geeft dezelfde data. *"Trivial mail volume" is geen reden om te skippen — agenda is een aparte bron.*
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

Concreet betekent dit: vóór de skill een proposal naar de DB schrijft, vraagt hij context op via de centrale `context-build` Edge Function (sinds v5.3 — vervangt de losse RPC-call van v5.2 en de drie ad-hoc queries van v5.1):

```bash
POST /functions/v1/context-build
Authorization: Bearer <skill:global:cron_secret>

{
  "intent": "enrich_record",
  "audience": "daily-admin",
  "trigger_type": "deal_or_contact",
  "trigger_id": "<deal_id of contact_id>",
  "query_text": "<deal_name of contact_name>",
  "options": {
    "entity_type": "deal",        // of "contact"
    "entity_id": "<id>"
  }
}
```

Recipe `enrich_record` levert defaults: top_k=8, recency_weight=0.25, recency_decay_days=60, min_similarity=0.3, max_per_source=2 (diversity), lookback=90d. Bundle_id wordt teruggegeven voor R.7-link.

**JelleMind-lessons consumeren** (sinds 2026-05-04 — JelleMind Activation): naast `bundle.matches[]` levert context-build ook `bundle.knowledge_lessons[]` — top-3 lessons in mind_scopes `skill` + `legalmind` (CRM-procesregels en organisatie-feiten). Zet ze in een sectie **boven** de proposal-instructies in de prompt:

> ## Toepasselijke regels uit JelleMind
> - **[skill]** Voor proposal: eerst mail-historie + HubSpot + KvK checken
> - **[legalmind]** Standaard trial-duur is 14 dagen

Als `knowledge_lessons` leeg is → laat de sectie weg. Telemetrie: `stats.jellemind_lessons_used += knowledge_lessons.length`.

**Skip-conditie**: chunks-tabel heeft nog geen master-chunk voor deze entity (te nieuw) → val terug op losse legacy-queries (`hubspot_engagements`, `mail_messages`). Context-build retourneert dan een lege bundle, geen error.

**Geen lege notes.** Als de skill na deze context-pas niets zinvols kan toevoegen aan wat al in de deal staat, dan is dit geen voorstel maar een filter (`reason: nothing_new_to_add`). Liever niets dan een lege note.

**Telemetrie**: na elk geplaatst proposal — log met bundle-link:

```sql
WITH new_outcome AS (
  SELECT log_rag_outcome(
    p_source_type        := 'daily-admin',
    p_source_id          := $proposal_id,
    p_decision_action    := 'proposal_placed',
    p_chunks_used        := $matches_jsonb,
    p_retrieval_strategy := 'context-build/enrich_record',
    p_retrieval_params   := jsonb_build_object('bundle_id', $bundle_id),
    p_outcome            := 'pending'
  ) AS id
)
UPDATE rag_outcomes SET context_bundle_id = $bundle_id::uuid
WHERE id = (SELECT id FROM new_outcome);
```

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

### Stap 0.5 — Dedup-check (verplicht vóór elke INSERT)

**Eén klant = één open voorstel.** Voordat je een nieuwe rij in `agent_proposals` schrijft, kijk je of er al een open voorstel is voor dezelfde entiteit. Pak dan dat bestaande voorstel en *consolideer* — niet een tweede rij maken.

```sql
-- Open voorstellen voor zelfde deal/company/recruitment-key
SELECT id, status, subject, summary, proposal, context, created_at
  FROM agent_proposals
 WHERE agent_name='daily-admin'
   AND status IN ('pending','amended')
   AND (
        (context->>'deal_id')    = $deal_id          -- match op deal
     OR (context->>'company_id') = $company_id        -- match op company (als geen deal)
     OR (context->>'jira_key')   = $rec_key           -- match op REC-XX
   );
```

Match-resolutie:

| Bron-prioriteit | Wanneer matchen |
|---|---|
| `deal_id`     | Klant- of partner-flow met bestaande HubSpot-deal — sterkste match |
| `company_id` | Klant zonder deal of nieuwe deal-thread — match op company |
| `jira_key`   | Recruitment of partner-Jira | 

Bij match: **werk de bestaande rij bij**, schrijf geen nieuwe rij.
- `proposal.actions[]` ← merge: behoud bestaande acties, voeg nieuwe toe (skip duplicaten op `type+payload.deal_id` of identieke note-content).
- `summary` ← herschrijf zodat zowel de eerdere context als de nieuwe trigger samen zinvol zijn (geen "appendix"-tekst, één geconsolideerd verhaal).
- `context.mail_ids[]`, `context.calendar_event_ids[]`, `context.fireflies_transcript_ids[]` ← unie van oud en nieuw.
- `context.consolidation_history[]` ← append `{at, source, reason}` voor traceerbaarheid.
- `created_at` blijft staan (volgorde inbox), `expires_at` reset naar NOW()+7d.
- Geen status-wissel — als oud `pending` was blijft het `pending`; als oud `amended` was zet je terug op `pending` (zoals bij amend-rewrite).

Stat: `consolidations_into_existing` — telt elke keer dat dedup een nieuwe insert voorkomt.

**Geen match → gewoon INSERT** zoals voorheen.

Wat NIET telt als match (bewust nieuwe rij OK):
- Andere deal voor dezelfde company maar in andere pipeline (Sales vs. Customer Base verschillend dossier).
- Volledig ander subject + andere mail-thread + andere meeting-context, óók al matcht de company. *Filter blijft contextueel — twijfel? voorkeur is consolideren, want twee rijen voor dezelfde klant is altijd het hardere ergernispunt voor Jelle.*

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

**Dashboard-instructies zijn leidend, niet de fallback hieronder.** De `note_templates`-tabel is bron-van-waarheid voor schrijfstijl. Voor elke note:

1. **Match een template op `context`** uit `note_templates`:
   - `customer_base` → bestaande klant (Customer Base-pipeline of betalend kantoor zonder deal-rij)
   - `sales_pipeline` → prospect / proefperiode (Sales Pipeline-pipeline)
   - `partner` → samenwerking / Jira Partnerships
   - `recruitment` → kandidaat / Jira REC

2. **Volg `body_template` als skelet en `tone_guide` als schrijf-instructie** — beide zijn verplicht. Tone_guide gaat letterlijk in de prompt naast je note-instructies, niet als suggestie.

3. **Vier regels die uit de tone_guides komen en die de skill nooit mag negeren** — hier expliciet omdat ze in praktijk fout gingen:

   - **Geen tijdstempels in de note-body, ook niet als header.** Geen `**Status (4 mei, 08:23 NL):**`, geen `**Update 14:00:**`. Datum is fine voor een tijdlijn-onderdeel ("26 mrt — Jan vroeg pilot te beëindigen"), exact-tijden niet — die zijn logboek-metadata, niet inhoud. *Uitzondering:* een afspraaktijdstip in een task ("Plan 30 min Teams om 14:00") is OK omdat het functioneel is, niet historisch.

   - **Derde persoon, niet eerste.** Niet *"Jelle's mail"*, niet *"Jelle reageert"*, niet *"Ik belde"*. Wel: *"Mail aan Henk gestuurd"*, *"Reactie aan Jan: ..."*, of weglaten. Tone_guide noemt dit expliciet voor `customer_base` en `sales_pipeline`.

   - **Inhoud eerst, geen logboek-metadata.** Eerste regel = wat er aan de hand is, niet wanneer of door wie. Geen `Sentiment: ...` als losse header bovenin — verwerk sentiment in de zin (*"Henk reageerde hard, persoonlijk"*) niet als label.

   - **Geen pipeline / stage / closedate in de note-body.** Het dashboard rendert die via een aparte data-strip onder elk voorstel (uit `context.pipeline_label` + `context.stage_label`). Schrijf NIET regels als `Deal-context: Customer Base · Proeftijd · closedate 3-2-2026` of `Pipeline: Sales · stage: Offerte gestuurd`. Dat is dubbele info en visuele ruis.

4. **Geen passend template?** Schrijf compact (3-6 zinnen), zonder headers, in derde persoon, geen tijdstempels, geen pipeline-info. Sentiment + context-continuïteit + next step — niets meer. Liever korter dan langer.

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

**`context` jsonb VERPLICHT** — niet NULL, niet leeg, niet "ik vergat 'm in te vullen". Validatie-criteria die een proposal moet halen:

| Veld | Wanneer verplicht | Waarom |
|---|---|---|
| `deal_id`        | als de proposal over een HubSpot-deal gaat (note/task/stage op een deal) | dashboard rendert pipeline-strip via deal_id |
| `company_id`     | als er een match op company is | submeta-rij + dedup-check |
| `mail_ids[]`     | als de scope-trigger een mail was | RAG-lookup + Stap 0.5 dedup |
| `calendar_event_ids[]` | als trigger een agenda-event was | idem |
| `fireflies_transcript_ids[]` | als trigger een fireflies-meeting was | idem |
| `bundle_id`      | **bij elke deal/contact-gerelateerde proposal** — de bundle_id van context-build (Stap "Wat maakt een goed voorstel") | bewijs dat verrijking is gebeurd |
| **`context_bundle_id` (kolom, niet jsonb)** | **bij elke proposal waar bundle_id is opgehaald** | RagBadge in dashboard joint hierop. ZET ALTIJD `agent_proposals.context_bundle_id = bundle_id` als top-level kolom naast `context.bundle_id` (jsonb). |
| `pipeline_label`, `stage_label`, `lifecyclestage` | bij elke deal-proposal | dashboard's submeta-rij toont dit zonder dat de skill het in de note-body zet |

**Hard validatie vóór INSERT** (skill mag NIET een proposal schrijven die deze checks faalt):

1. `context IS NOT NULL` — anders run = error, proposal niet inserted.
2. Voor proposals met deal-actie: `context.deal_id` ingevuld én `context.bundle_id` ingevuld. Geen bundle_id = context-build niet gedraaid = stap overgeslagen = run-status `error` met code `context_build_not_called`.
2b. **Top-level kolom `context_bundle_id` (uuid) ÓÓK gevuld** wanneer `context.bundle_id` is gezet — dat is wat RagBadge in dashboard joint. Eén INSERT met beide velden:
```sql
INSERT INTO agent_proposals (..., context, context_bundle_id, ...)
VALUES (..., $context_jsonb, ($context_jsonb->>'bundle_id')::uuid, ...);
```
3. `payload.content` (note), `payload.title`+`due`+`assignee` (task), `payload.issueKey`+`operation`+`description` (jira) — body altijd in `payload`, nooit top-level.
4. Note-body MAG NIET `Pipeline:`, `Stage:`, `Customer Base ·`, `Sales Pipeline ·` of `closedate ` bevatten — die info hoort in `context`-strip, niet in de body. Regex-check vóór INSERT.

Run-record `counts.context_build_calls` telt elke `context-build`-aanroep. Als `proposals_created > 0` maar `context_build_calls = 0` → run-status `error` met code `rag_layer_skipped` (= heel concreet wat AK Advocaten 4-mei overkwam).

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

## Run-record (v1-contract — zie agent-handbook/references/logging.md)

```jsonb
{
  "schema_version": "1",                    // STRING "1" — nooit integer
  "skill_version": "daily-admin-v5.1",
  "mode": null,
  "triggered_by": "<orchestrator|manual>",
  "triggered_at": "<ISO-8601>",
  "passes": [
    { "name": "amend-handling",       "ms": <N>, "status": "success" },
    { "name": "accepted-execute",     "ms": <N>, "status": "success" },
    { "name": "mail-scan",            "ms": <N>, "status": "success" },
    { "name": "calendar-scan",        "ms": <N>, "status": "success" },
    { "name": "fireflies-crosslink",  "ms": <N>, "status": "success" },
    { "name": "proposal-create",      "ms": <N>, "status": "success" }
  ],
  "warnings": [],
  "counts": {
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
    "consolidations_into_existing": 0,
    "context_build_calls": 0,
    "context_null_skipped": 0
  },
  "extra": {
    "source": "mail_messages + hubspot_mirror + outlook_calendar + fireflies"
  }
}
```

Hard errors horen in `agent_runs.errors[]` (NIET in stats), als
`[{"severity":"error","code":"<code>","message":"<text>","context":{}}]`.

Validatie:
- `counts.calendar_events_processed=0` zonder agenda-warning in `warnings[]` → run-status `error` (regel 1).
- `counts.fireflies_transcripts_processed=0` zonder fireflies-warning idem.
- Als er bij run-start `accepted`/`amended` proposals stonden maar
  `counts.amends_processed + counts.accepted_actions_executed = 0` → run-status `error` (Stap 0 niet gehaald).
- **`counts.proposals_created > 0` maar `counts.context_build_calls = 0`** → run-status `error` met code `rag_layer_skipped`. Geen verrijking betekent dat skill geen rekening hield met eerdere notes/mails — dat is precies de Habraken / AK-fout.
- **`counts.context_null_skipped > 0`** → run-status `error`. Een proposal zonder `context` jsonb is technisch incompleet.

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
