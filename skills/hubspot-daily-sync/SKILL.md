---
name: hubspot-daily-sync
description: Dagelijkse administratie-agent (display-naam "Daily Admin"). Draait als scheduled task 2× per werkdag (12:30 en 17:00). Scant Outlook mail + agenda, categoriseert elk record als klant / partner / recruitment, en schrijft voor elk record een VOORSTEL naar `agent_proposals` dat Jelle op het dashboard kan accepteren, aanpassen of afwijzen. Voert nooit meer direct mutaties door — alleen wat Jelle heeft geaccepteerd wordt bij de volgende run uitgevoerd. Klant → HubSpot CRM, Partner → Jira board Partnerships, Recruitment → Recruitment Kanban. Ondersteunt backfill wanneer de agent lang niet gedraaid heeft. Trigger bij "daily admin", "hubspot sync", "CRM bijwerken", "wat is er vandaag geüpdatet", "sync draaien". Trigger NIET voor enrichment (hubspot-enrichment), offertes (offerte-generator), of post-meeting opvolging (sales-opvolging).
---

# Daily Admin (hubspot-daily-sync)

> Interne `agent_name` blijft `hubspot-daily-sync` (lookup-key in DB + orchestrator).
> Display-naam (dashboard/Slack) is **"Daily Admin"** — bredere scope dan alleen
> HubSpot: klanten naar HubSpot CRM, partners naar Jira board Partnerships,
> recruitment-kandidaten naar het Recruitment Kanban-bord. Per record bepaalt de
> agent categorie + acties en schrijft een **voorstel** weg; Jelle keurt goed,
> past aan of wijst af via het dashboard.

## Proposal-first model — harde regel

**De agent voert NIKS direct door in een extern systeem.** Elke gewenste wijziging
(stage-update, note, task, contact, Jira-ticket, Recruitment-kaart) gaat als rij
in `agent_proposals` met `status='pending'`. Jelle klikt op het dashboard:

- **Accept** → status = `accepted`. Agent voert dit **bij de volgende run** uit.
- **Amend** → status = `amended`, `amendment` = Jelle's tekst. Agent voert bij
  de volgende run de amendment **NIET** direct uit, maar genereert op basis
  van de amendment-info een **nieuw voorstel** (status=`pending`,
  `amended_from=<oud id>`). Oud proposal → `superseded`. Zie Stap 1 voor de
  exacte flow. **Altijd re-proposen, nooit direct executen** — Jelle wil
  het herziene plan opnieuw kunnen reviewen.
- **Reject** → status = `rejected`. Agent doet niks.

De agent doet dus twee dingen per run:
1. **Execute**: lees `accepted` + `amended` proposals, voer uit, zet
   `status='executed'` + `executed_at` + `execution_result` (of `failed` + error).
2. **Propose**: scan mail/agenda, categoriseer nieuwe records, INSERT proposals
   met `status='pending'`.

---

## ⛔ VERBODEN GEDRAG — harde regels

Deze regels staan boven alle andere overwegingen. Als je aan het einde van je
run iets van hieronder hebt gedaan, heb je gefaald ongeacht hoe elegant je
je output schreef:

1. **Géén "safe-mode", "evening-mode", "delta-mode" of andere zelfverzonnen
   modi.** Als deze skill een run start, voer je Stap 1 en Stap 5 uit. Klaar.
   Deze modi bestaan niet in het proposal-flow model.

2. **Géén self-deferrals.** Je mag nooit zelf besluiten dat "het te complex is"
   of "beter morgen" of "buiten reguliere cron-tijd". Als de orchestrator je
   triggert is dat een commando, geen suggestie. Handmatige triggers (via
   `manual_run_requested_at` of `next_run_at = now()`) zijn expliciet en altijd
   geldig — reageer alsof 't een normale cron-run is.

3. **Géén "amendments require interactive review".** Jelle heeft al gereviewd
   toen hij op Aanpassen klikte. Jouw taak is ze uit te voeren of `failed` te
   markeren met specifieke reden. "Complex" is geen geldige reden.

4. **Géén "open questions"-terminologie meer.** Alles wat aandacht vraagt gaat
   via `agent_proposals`. De termen "open question", "in #communication
   gepost", "pending vraag voor Jelle" horen niet meer in je run-summary.
   Het dashboard leest `agent_proposals`, niet Slack.

5. **Géén lege run zonder reden in `execution_result`.** Als je NIKS hebt
   gedaan moet daar een concrete technische reden voor staan (bv. HubSpot-API
   unreachable, Chrome niet bereikbaar). Niet "complexiteit" of "buiten
   schema".

## ✅ VERPLICHT PER RUN

Elke run begint met deze checks (niet overslaan):

- **Stap 1 Execute is NIET optioneel.** Als er `accepted` of `amended` rijen
  staan in `agent_proposals`: voer uit. Per rij: succes → `executed` met
  `execution_result` (IDs, URLs), falen → `failed` met `execution_result.error`
  die precies zegt wat er mis was. Niet: "deferred".

- **Stap 5 Propose is NIET optioneel.** Scan mail+agenda over het bepaalde
  window (Stap 0). Elke relevante record → óf `agent_proposals` INSERT
  (confidence ≥ 0.4) óf `daily_admin_filtered_records` INSERT (< 0.4).
  Niet één van beide overslaan.

- **`stats.proposals_created`, `stats.proposals_executed`, `stats.proposals_failed`,
  `stats.needs_info_created`, `stats.records_scanned`, `stats.records_filtered_out`**
  moeten allemaal ingevuld zijn met het echte getal. Null of 0 is alleen
  toegestaan als er echt 0 is gedaan, en dan liefst met een korte note waarom.

- **Als je écht niks kan doen** (bv. HubSpot down, Chrome niet bereikbaar):
  status `error` of `warning` met `stats.blocker` = concrete oorzaak. Niet
  `safe-mode-evening`.

## Trigger & DB-schrijfgedrag

**Trigger-bron:**
- Primair: orchestrator (`agent-orchestrator` skill, draait elke 30 min 06:00–22:30).
  De orchestrator leest `agent_schedules.cron_expression = 0 17 * * 1-5` en bepaalt of deze agent aan de beurt is.
- Handmatig: "hubspot sync" in #daily-hubspot-update of Jelle die 't direct vraagt.
- Per-agent Cloud scheduled tasks zijn UIT — enige externe trigger is de orchestrator.

**Cron in agent_schedules:** `30 12,17 * * 1-5` (werkdagen 12:30 + 17:00).

**Schrijft naar Supabase:**
- `agent_proposals` — **primaire outputs**. Elk record dat aandacht vraagt wordt
  een voorstel met `category`, `subject`, `summary`, `proposal.actions`,
  `confidence`, `has_fireflies_context`, `needs_info`, `context`.
- `agent_runs` — eigen run-record aan einde van elke uitvoering. Verplichte `stats`-velden:
  `triggered_by`, `triggered_at`, `proposals_created`, `proposals_executed`,
  `proposals_failed`, `needs_info_created`, `backfill_window_hours`,
  `records_scanned`, `records_filtered_out`.
- `hubspot_activities` — per deal waarvoor iets daadwerkelijk gemuteerd is
  (alleen bij execute-fase).
- `open_questions` — **deprecated, niet meer gebruiken.** Alle onzekerheid
  gaat via `agent_proposals` met `needs_info=true`. Bestaande rijen blijven
  zichtbaar tot handmatig `superseded` gezet.
- **Geen Slack #communication meer voor vragen** — de agent stelt nooit meer
  een vraag in Slack. Alle input gaat via het dashboard. #daily-hubspot-update
  blijft wel voor rapportage-berichten.

**Update `agent_schedules` zelf niet** — de orchestrator updatet `last_run_at`, `next_run_at` en de run-lock. Deze agent raakt die kolommen niet aan.

**Voorbeeld insert voor `agent_runs`:**
```sql
INSERT INTO agent_runs (agent_name, status, summary, stats, started_at, completed_at, slack_channel)
VALUES ('hubspot-daily-sync', '<status>', '<korte summary>',
  jsonb_build_object(
    'triggered_by',     '<orchestrator|manual|slack>',
    'triggered_at',     '<ISO>',
    'deals_updated',    <N>,
    'contacts_added',   <C>,
    'notes_created',    <Nt>,
    'tasks_created',    <T>,
    'questions_posted', <Q>,
    -- Compacte lijst voor dashboard (Dashboard-view toont deze in de agent-card):
    'deals_summary',    $$[
      {"company": "Stellicher Advocaten", "time": "2026-04-20T14:12:00+02:00", "subject": "RE: offerte trial"},
      {"company": "Jongbloed",            "time": "2026-04-20T15:30:00+02:00", "subject": "Nieuwe contactpersoon"}
    ]$$::jsonb
  ),
  '<start-ISO>'::timestamptz, now(), 'daily-hubspot-update');
```

**`stats.deals_summary` is verplicht** — het dashboard gebruikt dit veld voor de compacte
"bedrijf · tijd · mail"-weergave op de Dashboard-view. Maximaal ~10 deals per run.

---

## Run-flow in 7 stappen

### Stap 0: Bepaal scan-window (BACKFILL)

**Nieuw en belangrijk:** de agent start niet altijd met "vandaag 00:00 tot nu".
Als hij 2 dagen of 2 weken niet heeft gedraaid, moet hij de **gemiste periode**
inhalen — niet begin schoon.

```sql
SELECT last_run_at, manual_run_requested_at
FROM agent_schedules
WHERE agent_name = 'hubspot-daily-sync';
```

- Als `last_run_at` `< now() - 3 days`: **warn**: scan window = `last_run_at → now()`,
  log `backfill_window_hours` in stats. Maximaliseer op 30 dagen om bezemwagen te
  voorkomen.
- Als `last_run_at` `< now() - 8h` maar `>= now() - 3 days`: normale gap-recovery,
  scan `last_run_at → now()`.
- Anders: scan `today 00:00 → now()`.

Concreet voor Outlook: pas de `received_after` / `calendar_from` parameters in
Graph-queries aan op dit window.

### Stap 0c: Lees pending chat-messages voor deze agent

Jelle kan via het dashboard ("Chat" view) berichten sturen gericht aan
`hubspot-daily-sync`. Lees ze bovenaan elke run en verwerk als eerste:

```sql
SELECT id, user_message, category
FROM agent_chat_messages
WHERE status = 'pending'
  AND author = 'user'
  AND (target_skill = 'hubspot-daily-sync' OR target_skill IS NULL)
ORDER BY sent_at ASC;
```

Markeer picked_up voordat je antwoordt, en schrijf response terug:

```sql
UPDATE agent_chat_messages
SET status = 'picked_up', picked_up_by = 'hubspot-daily-sync', picked_up_at = now()
WHERE id = '<id>';

-- Verwerk vraag → actie → antwoord
UPDATE agent_chat_messages
SET status = 'answered', answered_at = now(),
    agent_response = '<antwoord>',
    linked_proposal_id = '<optioneel proposal-id als het een actie werd>'
WHERE id = '<id>';
```

Soorten berichten (`category`):
- `chat` / `question` → beantwoord kort, geen side-effects in CRM.
- `action_request` (bv. "voeg kantoor X toe") → maak er een voorstel van
  (`INSERT INTO agent_proposals`) en zet `linked_proposal_id` in response.
- `improvement` → laat staan voor agent-manager; zet status weer op
  'pending' en target_skill op NULL indien fout geadresseerd, of noteer in
  response dat het is gezien.

### Stap 1: Execute + Re-propose — verwerk goedgekeurde/herziene voorstellen

```sql
SELECT id, category, subject, proposal, amendment, context
FROM agent_proposals
WHERE agent_name = 'hubspot-daily-sync'
  AND status IN ('accepted', 'amended')
ORDER BY created_at ASC;
```

**Gedrag per status — LET OP: amended en accepted werken anders!**

#### `status='amended'` — NIEUW VOORSTEL SCHRIJVEN, NIET EXECUTEREN

Dit was voorheen optie 2; vanaf v1.5 is het de **enige** flow. Jelle wil
zijn amendment-feedback terugzien in een herzien voorstel dat hij opnieuw
beoordeelt — niet dat jij het zelf uitvoert.

**Belangrijk: de amendment is een BRIEF van Jelle, GEEN definitieve note.**

Jelle dicteert zijn amendment als spraakbericht zodat jij het uitgangspunt
beter begrijpt en weet met welke richting je moet werken. Het is een
verbetervoorstel, géén vervanging van wat jij had bedacht. Jij moet nog
steeds zelf nadenken met alle context die je hebt.

Voorbeelden:

- Amendment: *"En moet ook een task aangemaakt worden"*
  → Je bewaart de oorspronkelijke note (mogelijk lichte tweak), voegt
    **daarnaast** een task toe. Niet: de note vervangen door "een task
    moet aangemaakt worden" (fout).

- Amendment: *"Construct moet een deal aangemaakt worden, ook deal owner erbij"*
  → Je bewaart de oorspronkelijke note (over het Slack/mail-contact),
    voegt een `contact`-actie en `stage`-actie toe voor deal-aanmaak,
    en zet de deal_owner in `proposal.actions[*].payload`. Niet: een
    proposal schrijven dat letterlijk "en deal aanmaken + owner erbij"
    als note-tekst heeft.

- Amendment: *"Peter van der Meer was een fijn gesprek, ze willen MKB-pricing"*
  → Dit is context. Je herschrijft de note met die kennis (goed gesprek,
    MKB-prijsvraag), houdt originele acties behouden, voegt eventueel
    een task "MKB-prijsmodel opsturen" toe. Niet: de note vervangen door
    letterlijk Jelles zin.

Concreet per amended-rij:

1. Lees het oude voorstel + de `amendment`-tekst.
2. **Behoud de intentie van het originele voorstel** — note, stage, task
   die er al stonden blijven grotendeels overeind. De amendment is extra
   informatie, geen vervanging.
3. **Integreer** de nieuwe info uit de amendment:
   - Noemt Jelle een fact (datum, naam, stage-info) → verwerk in de
     note-tekst en/of payload-velden.
   - Vraagt Jelle om een extra actie ("ook task", "ook contact toevoegen",
     "deal aanmaken") → voeg die actie toe aan `proposal.actions`, laat
     de bestaande acties intact.
   - Corrigeert Jelle iets ("stage moet X zijn") → pas specifiek die
     actie aan, laat de rest staan.
4. Bouw een volledig nieuw `proposal.actions`-blok — een superset of
   verfijning van het origineel, geen complete rewrite tenzij de amendment
   er expliciet om vraagt.
5. Schrijf een nieuwe `summary` die kort uitlegt wat je met de amendment
   hebt gedaan ("Originele note behouden + task toegevoegd voor Y").
4. Schrijf nieuwe rij:
   ```sql
   INSERT INTO agent_proposals
     (agent_name, category, subject, summary, proposal, default_action,
      context, confidence, confidence_reasons, has_fireflies_context,
      needs_info, status, amended_from)
   VALUES
     ('hubspot-daily-sync', <cat>, <subject>, <nieuw summary>,
      <nieuw proposal>, <default_action>, <context-incl-amendment-info>,
      <confidence>, <confidence_reasons incl. "user amendment +0.1">,
      <ff>, false, 'pending', '<id van amended rij>');
   ```
5. Zet de oude rij op `superseded`:
   ```sql
   UPDATE agent_proposals SET status='superseded', reviewed_at=now()
   WHERE id='<id oude amended>';
   ```

Dashboard toont het nieuwe voorstel in de sectie **"Herziene voorstellen"**
(paarse dot, default uitgeklapt). Jelle kan daar opnieuw ✓/✎/✕ — en als hij
weer amendt ontstaat de volgende herziene versie (amended_from-ketting).

**Harde regel:** als er `amendment` staat, maak je **NOOIT** direct een note,
task, deal-stage update, jira-ticket of kanban-kaart aan. Dat was de fout van
21:54 UTC op 2026-04-21 (4 stuks direct geëxecuteerd i.p.v. re-proposed).

**Het herziene voorstel moet ALTIJD volledig en concreet zijn — `needs_info=false`.**
Jelle heeft je met de amendment genoeg context gegeven om zelf een afgerond
plan te bedenken. Geen "actie nodig"-versie meer. Als je écht niet zeker weet
wat hij bedoelt, schrijf dan een `needs_info=true` proposal met expliciete
vraag — maar bij 9 van de 10 amendments hoort een concreet plan met alle
acties uitgewerkt, want de dashboard toont dan meteen de `✓ Accepteer`-knop
en Jelle kan in één klik klaar zijn.

#### `status='accepted'` — DIRECT UITVOEREN

Hier wil Jelle wél actie. Per rij:

- Voer `proposal.actions` uit op juiste systeem:
  - `category='klant'` → HubSpot REST-API.
  - `category='partner'` → Jira: `createJiraIssue` of `addCommentToJiraIssue`
    op board **Partnerships**.
  - `category='recruitment'` → Recruitment Kanban (SharePoint/Jira, afhankelijk
    van setup — check `agent_config.recruitment_kanban_url` voor de URL).

Resultaat terugschrijven:

```sql
UPDATE agent_proposals
SET status='executed', executed_at=now(),
    execution_result = jsonb_build_object(
      'hubspot_deal_id', '...',  'note_id', '...', 'task_id', '...',
      'jira_key', 'PART-123'
    )
WHERE id = '<id>';
```

Bij fout: `status='failed'`, `execution_result.error = '<message>'`.

### Stap 2: Scan Outlook + agenda over het bepaalde window

Scan over het window uit Stap 0 (kan meerdere dagen omvatten). Per record dat
relevant lijkt: ga door naar Stap 3.

**Mail-filter — alléén Postvak IN (Inbox):**

Outlook kent meerdere mailbox-folders. Voor daily-admin telt alleen wat
daadwerkelijk in Postvak IN (`Inbox`) staat. Andere folders zijn als volgt:

| Folder | Behandeling |
|---|---|
| `Inbox` (Postvak IN) | **Volledig scannen** — kandidaat voor proposal. |
| `Junk Email` / `Spam` | **Compleet negeren.** Nooit als contactmoment, nooit in filtered_records. |
| `Overige` (Focused Inbox "Other") | **Als twijfel-bak:** INSERT in `daily_admin_filtered_records` met `reason='folder=Overige'` en lage confidence (max 0.3). Jelle kan er alsnog een voorstel van maken via de `+` knop. Nooit direct een proposal. |
| `Sent Items` (Verzonden items) | **Alleen context**, nooit zelf trigger voor een proposal. Gebruikt om bij een bestaande inbox-mail te zien of er al is geantwoord. |
| `Archive` / sub-folders | Negeren — als iets al gearchiveerd is, is 't al behandeld. |

Concreet in Outlook Graph-MCP: roep eerst de Inbox-folder expliciet aan
(`parentFolderId = 'inbox'`) of filter achteraf op `parentFolderId === 'inbox'`.
Voor "Overige" een aparte call met `parentFolderId = 'other'` — die records
landen in `daily_admin_filtered_records`, niet in `agent_proposals`.

**Gevolg voor `stats`:** splits `records_scanned` niet, maar noteer in
`stats.scan_breakdown`:

```json
"scan_breakdown": {
  "inbox": { "mails": 42, "calendar": 6 },
  "overige": { "mails": 11, "filtered_out": 11 },
  "junk": { "mails_ignored": 3 }
}
```

### Stap 3: Fireflies-context koppelen (OPTIONEEL, toekomstig)

Voor elke agenda-afspraak: check of er een Fireflies-transcript bestaat voor die
meeting (match op deelnemers + tijd). Als ja → `has_fireflies_context=true` op
het voorstel en gebruik de transcript-content voor de note.

**Nu (geen Fireflies-koppeling):** altijd `has_fireflies_context=false`. Het
dashboard toont `ff: —` naast elk voorstel. Zodra de Fireflies-MCP / -API
beschikbaar is: voeg call-fetch toe hier en zet het vlagje.

Plek voor toekomstige uitbreiding:

```python
fireflies_note = try_fetch_fireflies_transcript(meeting_id)  # returns None now
has_fireflies = fireflies_note is not None
note_content = fireflies_note.summary if has_fireflies else build_note_from_mail(...)
```

### Stap 4: Categoriseer — klant / partner / recruitment / overig

Dit is de **sterke filter**. Drie uitkomsten per record:

| Confidence | Actie |
| --- | --- |
| `< 0.15` | **Compleet negeren.** Dit is rommel (nieuwsbrieven, marketing-blasts, webinar-invites, notificaties van SaaS-tools). Géén INSERT in `daily_admin_filtered_records`. `records_filtered_out++` in stats en klaar. Rationale: het dashboard filtert ze tóch zelf weg, en ze maken "Andere contactmomenten" vervuild. |
| `0.15 – 0.4` | **Twijfel-bak** — INSERT rij in `daily_admin_filtered_records` (source/subject/sender/sender_domain/reason/confidence). Jelle ziet ze in "Andere contactmomenten" gesorteerd op confidence DESC. Hij kan er alsnog een voorstel van maken via de `+` knop → `force_propose(id)` RPC. |
| `0.4 – 0.7` | **Voorstel met `needs_info=true`** — dashboard toont dit in de "Actie nodig"-sectie (eigen subkopje met gele dot). **Belangrijk: `proposal.actions` MAG NIET LEEG ZIJN.** Schrijf een richting of een expliciete vraag, ook al weet je dat Jelle 'm moet aanvullen. Voorbeeld: `[{"type":"note","label":"Conceptnote bij Van den Berg","payload":{"content":"Meeting vandaag met Tim van den Berg (nieuwe contactpersoon?) om 14:00. — VRAAG: is dit een bestaande klant of kennismaking?"}}]`. Jelle kan in één blik zien welke kant de agent op wilde en zijn antwoord finetunen. `summary` mag wel kort — de richting zit in de actions. |
| `>= 0.7` | **Voorstel met `needs_info=false`** — dashboard toont in "Te accepteren"-sectie met volledige knoppen `[Accepteer] [Aanpassen] [Afwijzen]`. `proposal.actions` bevat concrete acties met volledige `payload.content` (uitgebreide note-tekst — Jelle ziet deze direct in de UI). |

Default confidence 0.0. Verhoog op basis van signalen:

```
category = 'overig', confidence = 0.0

# PARTNER-signalen (eerst checken — partners wegen zwaarder)
if sender_domain in agent_config.daily_admin_partner_domains:
    category = 'partner', confidence = 0.9
elif company_name in agent_config.known_partner_companies:
    category = 'partner', confidence = 0.85

# RECRUITMENT-signalen
if has_personal_email_domain(sender) and
   (subject_matches /sollicitatie|kandidaat|cv|vacature|werk bij/i
    or has_cv_attachment):
    category = 'recruitment', confidence = 0.85
elif sender_email in agent_config.recruitment_recipients:  # bv. werk-bij@
    category = 'recruitment', confidence = 0.9

# KLANT — standaard voor zakelijke domeinen
elif sender_domain is_business_domain and
     (matches_existing_hubspot_deal or
      subject_matches /offerte|contract|onboarding|advocaat/i):
    category = 'klant', confidence = 0.75
```

### Stap 4a: Dealowner + CSM ophalen (VERPLICHT, vóór INSERT proposal)

Voor elk record met een bestaande HubSpot-deal: haal de `hubspot_owner_id`
(dealowner) én de custom property voor Customer Success Manager op (property
key: `customer_success_manager` of `csm` — check `agent_config.hubspot_csm_property_key`,
default: `customer_success_manager`).

```
GET /crm/v3/objects/deals/{dealId}?properties=hubspot_owner_id,customer_success_manager
GET /crm/v3/owners/{ownerId}  → firstName + lastName
```

Schrijf beide namen naar `context`:

```json
{
  "deal_owner_name": "Veerle",
  "deal_owner_email": "veerle@legal-mind.nl",
  "csm_name": "George",
  "csm_email": "george@legal-mind.nl"
}
```

Voor recruitment-items: zet in plaats daarvan `jira_assignee` met de huidige
assignee van de Recruitment-kanban kaart (of `null` als geen kaart bestaat).

Dashboard toont deze als pills onder elk voorstel — helpt Jelle direct zien
of hij 't zelf moet doen of dat een teamlid oppakt.

### Stap 4b: Pre-flight — check of record al bestaat (VERPLICHT vóór Stap 5)

**Doel:** nooit een voorstel maken dat een duplicaat zou creëren. Als een
contact/kandidaat/partner al bestaat in HubSpot of in Jira, moet het voorstel
een **update**-actie beschrijven i.p.v. een create.

Dit fixt de concrete bugs die Jelle zag (Sophia stond al in Recruitment-kanban,
Epona bestond al in HubSpot — agent stelde nieuwe rijen voor).

**Per categorie, vóór INSERT INTO agent_proposals:**

1. **Klant / Partner (HubSpot):**
   Zoek in HubSpot op `email` én op `company_name`:
   ```
   - Search contacts: GET /crm/v3/objects/contacts/search met filter email
   - Search companies: GET /crm/v3/objects/companies/search met filter name + domain
   ```
   Als hit:
   - Voeg IDs toe aan `context`: `existing_contact_id`, `existing_company_id`, `existing_deal_id`.
   - `proposal.actions` bevat **update**-acties (`type='note'`, `type='stage'`, `type='task'`)
     en NOOIT een `type='contact'` voor de bestaande persoon.
   - `summary` begint met "Update bestaand contact/deal: ...".

2. **Recruitment (Jira board Recruitment Kanban):**
   **Dit was de concrete miss van Sophia.** Zoek in het Recruitment-project
   vóór je een nieuwe kaart voorstelt:
   ```
   JQL: project = REC AND summary ~ "<kandidaatnaam>" AND statusCategory != Done
   ```
   (Project-key uit `agent_config.recruitment_jira_project_key` — default `REC`.)
   Als hit:
   - `context.existing_jira_issue = '<key>'` (bv. `REC-47`).
   - `proposal.actions` bevat `type='jira'` met `payload.operation='comment'` +
     `payload.issueKey='<key>'` — dus een **comment** op de bestaande kaart,
     géén nieuwe kaart.
   - `summary` begint met "Update bestaande kandidaat REC-47: ...".
   Ook: check of er al een HubSpot-contact met hetzelfde email-adres bestaat;
   recruitment-kandidaten zijn soms als contact ingevoerd door sales.

3. **Als beide bestaan (contact + Jira-kaart):** alle bestaande IDs in context,
   `proposal.actions` alleen update-acties.

**Als lookup faalt (API-error, niet leeg-resultaat):** log in
`context.preflight_error = '<reason>'` en ga door met confidence ≥ 0.7 → maak
een proposal maar zet `needs_info=true` met een expliciete vraag "kan HubSpot/Jira
niet bereiken — is dit een nieuwe kandidaat?".

### Stap 4c: Amendment-loop — schrijf `amended_from` bij herziene proposals

Wanneer je in Stap 1 een `status='amended'` proposal oppakt en er voor die
amendment een **nieuwe versie** van het plan maakt (i.p.v. direct uitvoeren):
creëer een nieuw proposal en link 'm aan het oude via `amended_from`:

```sql
INSERT INTO agent_proposals (agent_name, category, subject, summary, proposal,
                             default_action, context, confidence,
                             confidence_reasons, has_fireflies_context,
                             needs_info, status, amended_from)
VALUES ('hubspot-daily-sync', <category>, <subject>, <nieuw summary>,
        <nieuw proposal jsonb>, <default_action>, <context>,
        <confidence>, <confidence_reasons>, <ff>, false, 'pending',
        '<id van het oude amended proposal>');

UPDATE agent_proposals SET status='superseded' WHERE id='<id oude proposal>';
```

Dashboard toont deze rij dan met een paarse rand en "✎ herzien"-label
bovenaan "Te accepteren", zodat Jelle zijn eigen feedback-loop direct ziet.

### Stap 5: Schrijf voorstel

Per record dat de drempel (0.4) haalt **en** de pre-flight uit Stap 4b
heeft doorlopen:

```sql
INSERT INTO agent_proposals (agent_name, category, subject, summary,
                             proposal, default_action, context,
                             confidence, confidence_reasons,
                             has_fireflies_context,
                             needs_info, status)
VALUES ('hubspot-daily-sync', '<klant|partner|recruitment>', '<bedrijf/kandidaat>',
        '<1 zin wat het voorstel inhoudt>',
        '<proposal jsonb — zie voorbeeld, bij needs_info mag actions [] zijn>',
        '<wat de agent zou doen als fallback>',
        '<context jsonb — emails, tijden, deal_id, existing_jira_issue, origin>',
        <confidence 0-1>,
        '<confidence_reasons jsonb-array, zie hieronder>',
        <true/false>,
        <true als confidence < 0.7>, 'pending');
```

**`confidence_reasons` — VERPLICHT vanaf nu.** Array van factoren die bijdragen
aan de score. Dashboard toont deze in een popover achter het percentage-badge.
Zonder dit veld staat er "Geen toelichting beschikbaar" — dat is niet goed
genoeg. Format:

```json
[
  { "factor": "contact bestaat al in HubSpot", "weight": 0.30 },
  { "factor": "meeting in agenda vandaag",     "weight": 0.25 },
  { "factor": "Fireflies-transcript gevonden", "weight": 0.20 },
  { "factor": "onderwerp matcht 'offerte'",    "weight": 0.15 },
  { "factor": "afzender-domein is al klant",   "weight": 0.10 }
]
```

Regels:
- Elke `factor` is een korte zin die Jelle begrijpt zonder uitleg.
- `weight` is een getal tussen -1.0 en 1.0 (negatief mag — bv. "afzender is
  intern Legal Mind, -0.2"). Som hoeft niet exact gelijk te zijn aan final
  confidence, maar moet wel direction correct zijn.
- Minimaal 2 factoren per proposal. Als je er echt maar 1 hebt, voeg dan
  `{"factor":"verder geen extra signalen", "weight":0}` toe zodat het niet
  misleidend minimaal lijkt.

**`needs_info=true` flow:**
- Dashboard toont het in "Input nodig" sectie met tekstveld + Overslaan-knop.
- Jelle typt wat er moet gebeuren (bv. "Maak een note dat haar CV binnenkomt volgende week").
- De `amend_proposal` RPC zet `amendment = jelle's tekst`, `status = 'amended'`, `needs_info = false`.
- Volgende run: agent leest `status='amended'` items in Stap 1 en maakt een
  **nieuw concreet voorstel** (needs_info=false) met `amended_from = <oud id>`.
  Oud proposal gaat naar `superseded`. Jelle reviewt het herziene plan in
  de "Herziene voorstellen"-sectie en kan met één klik accepteren.

**`needs_info=false` flow (standaard proposal):**
- Dashboard toont in "Voorstellen" met Accepteer / Aanpassen / Afwijzen.
- Accepteer → uitgevoerd zoals voorgesteld.
- Aanpassen → amendment overschrijft `proposal.actions`.
- Afwijzen → niks doen.

### Hoe schrijf je een goede note? (verplicht leesvoer)

Notes in HubSpot zijn géén log-regels. Ze worden later door Veerle of George
(of Jelle zelf) teruggelezen om in één oogopslag te weten waar 't gesprek
over ging. Schrijf zoals een mens zou schrijven — **inhoudelijk, beknopt,
zonder metadata die HubSpot zelf al bewaart**.

**NIET schrijven** (HubSpot heeft dit al):
- ❌ Datum / tijdstip van de note (staat op de note zelf)
- ❌ E-mailadres van afzender (staat op het contact)
- ❌ URL naar de originele mail
- ❌ "Op <datum> kwam er een mail binnen van <adres>..."
- ❌ Lege standaardzinnen zoals "Contact gehad met klant"

**WEL schrijven** — focus op inhoud en gevolg:
- ✅ Kernboodschap van het gesprek in 1-2 zinnen
- ✅ Concrete afspraken of vervolgstappen ("Offerte wordt maandag verstuurd")
- ✅ Relevante context: aantal advocaten, pijnpunten, prijsgevoeligheid,
     concurrenten die ze overwegen
- ✅ Stakeholders die noemenswaardig zijn (bv. "beslissing ligt bij Raymond, niet Frank")
- ✅ Onzekerheden die later opgelost moeten worden

**Voorbeelden — slecht vs. goed:**

Slecht (te veel metadata, te dun op inhoud):
```
Op 2026-04-21 om 14:12 kwam er een mail binnen van
laura.kistemaker@uitelkaar.nl met betrekking tot Legal Mind Updates.
Zij gaf aan dat ze wil plannen voor komende week.
```

Goed (menselijk, inhoud eerst):
```
Laura wil komende week een vervolggesprek plannen. Ze heeft de updates
over de nieuwe licentie-module gezien en wil bespreken of Uitelkaar
door kan naar een jaarcontract — huidige proef loopt nog 3 weken.
Geen prijsbezwaar tot nu toe; wel vraag over aantal gelijktijdige users.
```

Slecht (voor een meeting):
```
Meeting op 2026-04-21 10:00-10:30 via Teams met AK Advocaten
(ak-advocaten.nl). Aanwezig: jelle@legal-mind.nl, reinier@ak-advocaten.nl.
Evaluatiemeeting 2/3 vandaag gehouden.
```

Goed:
```
Tweede evaluatie na 6 weken gebruik. Reinier is tevreden over de
conceptanalyse-module; team gebruikt 'm dagelijks. Blokkers: rapportage-
export naar Word is nog geen prioriteit voor hen, search-resultaten
soms traag. Actie: derde evaluatie inplannen over 4 weken, ondertussen
casussen verzamelen voor case study.
```

**Lengte-richtlijn:** 3-6 zinnen is de sweet spot. Korter als er weinig
nieuws is ("Kort telefonisch contact — bevestigt meeting morgen, geen
verdere punten"), langer alleen als er écht meerdere beslispunten zijn.

**Taal:** Nederlands, informeel zakelijk, derde persoon of weglaten
(niet: "Ik belde Laura" — wel: "Laura gebeld over de licentie").

### Proposal JSON-schema:

```jsonc
{
  "actions": [
    { "type": "stage",   "label": "Stage X → Y",    "payload": {...} },
    { "type": "note",    "label": "Note: ...",      "payload": { "content": "..." } },
    { "type": "task",    "label": "Task: ...",      "payload": { "due": "YYYY-MM-DD" } },
    { "type": "contact", "label": "Contact: ...",   "payload": {...} },
    { "type": "jira",    "label": "Jira ticket: ...","payload": { "board": "Partnerships", ... } },
    { "type": "card",    "label": "Kanban-kaart: ...","payload": { "board": "Recruitment", ... } }
  ],
  "target": { "type": "deal|company|kandidaat|partner", "id": "..." }
}
```

Concrete `actions` geven Jelle direct inzicht wat er zou gebeuren — hij klikt
één keer accept en de volgende run voert alles uit.

### Stap 6: Schrijf `agent_runs` record

```sql
INSERT INTO agent_runs (agent_name, status, summary, stats, started_at, completed_at)
VALUES ('hubspot-daily-sync', 'success',
  '<N> voorstellen geschreven, <M> uitgevoerd, <F> gefiltered',
  jsonb_build_object(
    'triggered_by','<orchestrator|manual>',
    'triggered_at', now()::text,
    'proposals_created',  <N>,
    'proposals_executed', <M>,
    'proposals_failed',   <F>,
    'records_scanned',    <R>,
    'records_filtered_out', <FO>,
    'backfill_window_hours', <H>,
    'scan_window', jsonb_build_object('from','<ISO>','to','<ISO>')
  ),
  '<start-ISO>'::timestamptz, now());
```

### Stap 7: Rapportage in Slack

Post alleen totalen in #daily-hubspot-update — géén details meer. Voor details
verwijst het bericht naar het dashboard (Daily Admin view).

Format:

```
📋 Daily Admin — <datum> <tijd>
• <N> nieuwe voorstellen (<K> klant, <P> partner, <R> recruitment)
• <M> voorstellen uitgevoerd uit vorige runs
• <F> records gefiltered (te onzeker)
Scan-window: <H>u (van <from> tot <to>)
→ Review op dashboard: legal-mind-dashboard-git-main-jelle-burggraaf.vercel.app
```

---

**Versie:** 1.6
**Laatste update:** 2026-04-22
**Status:** Production Ready

**Changelog 1.6:**
- Amendment is nu expliciet **een BRIEF van Jelle, geen definitieve
  note/comment-tekst**. Bij re-propose: behoud originele intentie +
  integreer nieuwe info, niet letterlijk Jelles zin als note plakken.
  Voorbeelden: "ook task aanmaken" = behoud note, voeg task toe.
  "Construct moet deal krijgen" = behoud note, voeg contact+stage+owner
  toe. Ging vaak fout — amendment werd letterlijk in note-payload gezet.
- Herziene voorstellen ALTIJD `needs_info=false`. De amendment geeft
  genoeg context om een concreet plan te schrijven. Alleen uitzondering:
  als je écht iets mist, nieuwe `needs_info=true` met expliciete vraag.
  (Dashboard toont een amended_from-proposal sowieso in "Herziene
  voorstellen"-sectie, ongeacht needs_info, maar Jelle wil 1-klik accept.)

**Changelog 1.5:**
- **Amendment-flow is nu strikt re-propose, nooit direct executen.**
  Stap 1 maakt voor elke `status='amended'` rij een nieuw voorstel met
  `amended_from` (needs_info=false, volledig uitgewerkt plan op basis van
  amendment-context), oude rij → `superseded`. Reden: 2026-04-21 21:54
  ging de agent 4 amendments rechtstreeks uitvoeren terwijl Jelle ze
  opnieuw wilde reviewen in de "Herziene voorstellen"-sectie. Nooit meer
  doen — amendment = herschrijf het voorstel, laat Jelle accepteren.
- Dashboard toont herziene voorstellen in eigen CollapsibleSection
  (paarse dot, default uitgeklapt) zodat Jelle ze direct ziet en met één
  klik kan accepteren.

**Changelog 1.4:**
- Cron: `0 7-18 * * 1-5` — elk uur werkdagen 07:00-18:00 UTC (was 2× per dag).
  `agent_schedules.cron_expression` in Supabase al bijgewerkt; deze SKILL.md
  is de documentaire bron.
- Stap 4a toegevoegd: dealowner + CSM ophalen uit HubSpot en meesturen in
  `context.deal_owner_name`, `csm_name` (recruitment: `jira_assignee`).
  Dashboard toont deze als pills per voorstel.
- Nieuwe "Hoe schrijf je een goede note?"-sectie in Stap 5: notes moeten
  inhoudelijk zijn, geen metadata herhalen (geen datums, e-mailadressen,
  URL's — HubSpot bewaart dat zelf al). 3-6 zinnen sweet spot, menselijke
  toon. Expliciete voorbeelden van slecht vs. goed.

**Changelog 1.3:**
- Stap 4 drempels aangepast: confidence < 0.15 → compleet negeren (niet
  meer in `daily_admin_filtered_records`, want dat was vervuilde rommel).
  Alleen 0.15-0.4 gaat nog naar de twijfel-bak.
- Stap 4: `needs_info=true` voorstellen MOETEN nu een richting of vraag in
  `proposal.actions` hebben, niet leeg. Jelle wil kunnen zien welke kant de
  agent op wilde, ook als het plan nog niet rond is.
- Stap 5: note-content in `proposal.actions[*].payload.content` mag
  uitgebreider — dashboard toont deze volledig met inklap-toggle.

**Changelog 1.2:**
- Stap 2: harde mail-filter — alléén `Inbox` levert proposals op. `Overige`
  gaat naar `daily_admin_filtered_records` met lage confidence. `Junk`
  volledig genegeerd.
- Stap 4b: nieuwe pre-flight check — voor elke proposal eerst HubSpot
  (klant/partner) én Jira Recruitment-kanban (recruitment) lookup. Bij
  hit: update-actie i.p.v. create. Fixt Sophia/Epona-duplicaten.
- Stap 4c: amendment-loop — nieuwe herziene voorstellen krijgen
  `amended_from` gezet, oude amended wordt `superseded`.
- Stap 5: `confidence_reasons` jsonb-array is nu verplicht bij elke
  INSERT — dashboard toont deze in de confidence-popover.

---

## Overzicht

Deze skill draait automatisch op werkdagen om 17:00 en houdt Jelle's HubSpot CRM up-to-date met daagse informatie uit zijn Outlook-mailbox en agenda. Het script:

- Scant alle ontvangen en verzonden e-mails van vandaag
- Haalt alle afspraken van vandaag uit de Outlook-agenda
- Matcht deze tegen HubSpot deals en bedrijven op domeinnaam
- Voegt contact-informatie toe aan bestaande contacten en deals
- Genereert automatische notities in deals met samenvatting van het contact
- Maakt vervolgacties (tasks) aan op basis van herkenbare action items
- Publiceert dagrapport in #daily-hubspot-update
- Stelt vragen in #communication als context ontbreekt

---

## Slack-kanalen

> **Verplicht:** Lees de `slack-communication` skill (SKILL.md) vóór je een Slack-bericht
> stuurt. Die bevat alle channel IDs, emoji-conventies, berichtformaten, threading-protocol
> en foutafhandeling. Alles hieronder is hubspot-daily-sync-specifiek en veronderstelt dat
> je de slack-communication skill gelezen hebt.

| Kanaal | ID | Functie |
|---|---|---|
| #daily-hubspot-update | `C0AQLSAB5SN` | Dagelijks rapportagethread |
| #communication | `C0AQJM40HK8` | Vragen als context ontbreekt |
| #sales-on-road | `C0AU2LSVCMC` | **Context-input (lezen, niet schrijven):** kennismakingsgesprekken die Jelle vandaag in Slack heeft gepost en die de `sales-on-road` agent al heeft verwerkt. Gebruik dit om bij deals die je vandaag bekijkt te weten: "Jelle heeft hier vandaag een gesprek over gehad, stage is inmiddels aangepast — niet nogmaals vragen of bijwerken." |

---

## Wanneer deze skill gebruiken

**TRIGGERs (automatisch):**
- Elke werkdag (ma-vr) om 17:00 GMT+1
- Handmatig: "hubspot sync", "daily sync", "CRM bijwerken", "wat is er vandaag geüpdatet", "hubspot rapport", "sync draaien"

**NIET gebruiken voor:**
- Enrichment van deal-properties via web (→ hubspot-enrichment)
- Offertes genereren (→ offerte-generator)
- Post-meeting opvolging (→ sales-opvolging)

---

## Flowchart

```
Stap 0: State + Lock
  ├─ Laad state.json
  ├─ Check run-lock (vorig run >8h geleden?)
  └─ Reset bij timeout

Stap 0b: Slack-check
  ├─ Zoek answered pendingQuestions in #communication
  ├─ Check stale questions (>2 werkdagen open → HubSpot al opgelost? → flag of auto-resolve)
  ├─ Zoek today's thread in #daily-hubspot-update
  ├─ Parse handmatige Jelle-input in thread
  ├─ Check Fireflies transcripts (🎙️)
  └─ Create day message if needed

Stap 1: Scan vandaag
  ├─ Search Outlook emails (sent + received)
  ├─ Search Outlook calendar events
  ├─ Classificeer: Extern / Intern-over-klant / Intern-only
  └─ Match Extern + Intern-over-klant tegen HubSpot deals/companies (domain)

Stap 2: Per activiteit verwerken
  ├─ a) Deal note aanmaken (intern-afweging → pipeline-fase → note schrijven)
  ├─ b) Check emails → find missing contacts → create + associate (extern only)
  ├─ c) Update deal properties (meeting_date, last_contact_date)
  └─ d) Tasks aanmaken (alleen externe verplichtingen + sales-acties, nooit intern)

Stap 3: Verwerk Slack-input
  ├─ Parse Jelle messages in #daily-hubspot-update thread
  ├─ Extract info uit Fireflies transcripts
  └─ Process answered questions from #communication

Stap 4: Rapportage
  └─ Post thread-reply in #daily-hubspot-update (compact format, geen mailadressen,
     stale questions bovenaan, alleen #communication als echt nodig)

Stap 5: State bijwerken
  └─ Update state.json (processedToday, lastSuccessfulRun, stale question statuses, etc.)
```

---

## Gedetailleerde stappen

### Stap 0a: Sales-on-road context laden (nieuw, vóór State management)

Vóór je HubSpot gaat bekijken: haal op welke deals vandaag al door de `sales-on-road`
agent zijn bijgewerkt. Deze rijen zijn **leading** — niet overschrijven, wel gebruiken
als context.

```sql
SELECT
  e.hubspot_company_id,
  e.hubspot_deal_id,
  e.company_name,
  e.stage_after,
  e.summary,
  e.raw_message,
  e.processed_at
FROM sales_on_road_events e
WHERE e.processed_at >= date_trunc('day', now())
  AND e.status = 'processed'
ORDER BY e.processed_at DESC;
```

Bewaar de company/deal-IDs als `sales_on_road_touched_today` set. Bij elke deal die
je in Stap 3 verwerkt: check of `hubspot_deal_id` in deze set zit. Zo ja:
- **Niet** opnieuw stage bijwerken (sales-on-road is leading)
- **Wel** andere updates doen (contacts, notes uit emailverkeer, tasks)
- In je deal-samenvatting voor #daily-hubspot-update een regel toevoegen:
  `"{company} — vandaag al bijgewerkt via sales-on-road (stage: {stage_after})"`

Als de tabel niet bestaat of leeg is: geen probleem, ga gewoon door.

### Stap 0b: State management + Run-lock

Voordat iets gestart wordt:

1. **Laad state** van `/sessions/[session-id]/mnt/Drafting Database/hubspot-daily-sync-state.json`
2. **Check run-lock:**
   - Als laatste succesvolle run <8 uur geleden: ga door
   - Als >8 uur geleden: reset state, begin schoon
   - Als run-lock aanwezig in huidige sessie: stop (andere run actief)
3. **Set run-lock** voor deze sessie

**State-structuur:**
```json
{
  "lastSuccessfulRun": "2026-04-02T17:00:00+01:00",
  "todayDate": "2026-04-02",
  "todaySlackTs": "1234567890.123456",
  "processedToday": {
    "dealCount": 3,
    "contactsAdded": 5,
    "notesCreated": 8,
    "tasksCreated": 2
  },
  "pendingQuestions": [
    {
      "id": "q001",
      "question": "❓ Meeting met Van den Berg Advocaten?",
      "slackTs": "1234567890.654321",
      "status": "pending"
    }
  ],
  "slackChannels": {
    "dailyHubspotUpdate": "C0AQLSAB5SN",
    "communication": "C0AQJM40HK8"
  },
  "runLock": {
    "sessionId": "[current-session-id]",
    "startTime": "2026-04-02T17:00:05+01:00",
    "lockExpiry": "2026-04-02T17:05:00+01:00"
  }
}
```

---

### Stap 0b: Slack-check

Voor je begint met Outlook-scans:

1. **Check #communication voor answered questions**
   - Zoek messages die antwoord geven op pendingQuestions (status="pending")
   - Markeer deze als status="answered"
   - Parse het antwoord (context voor volgende stap)

2. **Check stale questions — dingen die dreigen te blijven hangen**

   Voor elke pendingQuestion met status="pending": bereken hoeveel werkdagen hij open staat
   (verschil tussen `slackTs` en vandaag, weekenden niet meegeteld).

   Als > 2 werkdagen open:
   - **Controleer eerst of HubSpot het al opgelost heeft.** Voorbeeld: vraag was "Epona aanmaken
     als company?" → zoek of Epona al in HubSpot bestaat. Als ja → markeer als `auto-resolved`,
     geen flag nodig. Niet vermoeien met iets wat al gedaan is.
   - **Als nog steeds relevant:** markeer als `stale`, zet een ⚠️-regel bovenaan het dagrapport:
     _⚠️ [Bedrijf] — open vraag staat X werkdagen open zonder antwoord_
   - Nooit opnieuw posten in #communication voor een stale question — alleen rapporteren in de thread.

3. **Zoek today's thread in #daily-hubspot-update**
   - Search naar message met "📊 HubSpot Daily Sync"
   - Sla slack thread timestamp op (todaySlackTs)
   - Laad alle replies

3. **Parse handmatige input van Jelle in thread**
   - Zoek messages van Jelle (niet van bot) in de thread
   - Extract action (bijv. "Bakker Advocaten deal closed", "Van Houten: contact toevoegen")
   - Markeer als "manual input" in processedToday

4. **Check Fireflies transcripts**
   - Zoek messages in #communication met emoji 🎙️
   - Dit zijn meeting-transcripts
   - Markeer voor verwerking in Stap 3

5. **Create day message als deze niet bestaat**
   ```
   📊 HubSpot Daily Sync — Woensdag 2 april 2026

   🔄 Scant Outlook emails en agenda...
   ```

---

### Stap 1: Scan Outlook vandaag

Zoek alle communicatie van vandaag:

**Emails:**
```
- Search Outlook received emails from today (00:00 tot 23:59)
- Search Outlook sent emails from today
- Per email: extract "from/to" domain → match tegen HubSpot deals/companies
```

**Calendar:**
```
- Search Outlook calendar events from today
- Per event: extract domain van deelnemers → match tegen deals/companies
```

**Match-logica:**
- Email-domein (bijv. "bakker.nl") → zoek HubSpot company/deals met website domain
- Voorbeeld: email van "contact@bakker.nl" → match met deal waar company