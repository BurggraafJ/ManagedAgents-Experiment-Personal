---
name: sales-todos
description: >
  Proactieve sales-opvolger die HubSpot scant op deals die actie vragen —
  offerte-herinneringen, eindigende proefperiodes, stille contacten — en
  concept-mails klaarzet in Outlook-map "Sales Agent" zodat Jelle alleen
  hoeft te reviewen en verzenden. Draait elke werkochtend om 08:00 via de
  orchestrator, zodat Jelle 's ochtends zijn sales-taken voor de dag op
  scherp heeft staan.
  Trigger bij: "sales todos", "draai sales todos", "welke deals hebben actie
  nodig", "offerte-reminders", "trial eindigt", "check openstaande offertes",
  "follow-ups sales", "reminder mails".
  Trigger NIET voor post-meeting verwerking (dat is sales-on-road), niet voor
  algemene HubSpot-sync (dat is hubspot-daily-sync).
---

# Sales TODO's

De HubSpot Hygiene Sync houdt CRM up-to-date, `sales-on-road` verwerkt
kennismakingen, maar daartussen zit nog een gat: **deals die actie vragen**.
Een offerte van 10 dagen geleden zonder reactie. Een trial die volgende week
afloopt. Een klant die al 2 weken stil is. Deze skill vult dat gat.

Elke poll scant de skill HubSpot op een set regels, schrijft gevonden TODO's
naar `sales_todos`, en bereidt per TODO een Outlook-concept-mail voor in de
map **Sales Agent**. Jelle ziet ze terug op het dashboard-tabblad "Sales
TODO's" — één klik en de mail staat klaar om te versturen.

## Trigger & DB-schrijfgedrag

**Trigger-bron:**
- Primair: orchestrator — pikt deze skill op tijdens zijn eerstvolgende poll **op of
  na 08:00 op werkdagen** (poll om 08:00 draait de skill). De skill is dus strikt
  dagelijks, niet continu.
- Handmatig: "sales todos", "draai sales todos", "offerte reminders check".

**Cron in agent_schedules:** `0 8 * * 1-5` — elke werkochtend 08:00 één keer. De
orchestrator pakt het op bij zijn eerstvolgende poll (elke 30 min vanaf 06:00), dus
de feitelijke draaitijd is 08:00 ± 30 min.

**Ochtend-rhythm:** de skill is bewust één-keer-per-dag zodat de drafts in de Sales
Agent-map Jelle's sales-ochtend voorbereiden. Als hij een mail tussendoor nog wil
versturen of bijwerken: die blijft staan (drafts worden niet verwijderd bij volgende
run, alleen status op `completed`/`dismissed` als `outlook_sent_at` detecteerbaar is).

**Leest:**
- HubSpot (via MCP `mcp__82f94de2-e5ca-4223-ae7e-dc4513165411__`) — open deals in Sales Pipeline + Customer base, met stages, last activity, trial-einddatum, etc.
- `sales_todos` — om dubbele TODO's te voorkomen (`dedup_key` is UNIQUE)
- `sales_on_road_events` (laatste 24u) — gesprekken die net verwerkt zijn → geen reminder voor die deals
- Outlook `Verzonden items` (via Chrome) — is er recent al een mail gestuurd over deze deal? → geen duplicate reminder

**Schrijft naar Supabase:**
- `sales_todos` — per gevonden actie één rij. Velden: `type`, `hubspot_deal_id`,
  `company_name`, `contact_email`, `reason` (waarom deze TODO), `suggested_action`,
  `outlook_draft_created`, `outlook_draft_subject`, `status` (`pending` / `draft_ready`
  / `completed` / `dismissed` / `error`), `dedup_key`.
- `agent_runs` — één rij per uitvoering met `stats.triggered_by`, `stats.triggered_at`,
  `stats.todos_created`, `stats.drafts_prepared`, `stats.todos_skipped`.

**Schrijft naar Outlook:**
- Concept-mail in map **Sales Agent** (onder Concepten) per `draft_ready` TODO.
  Status blijft draft — Jelle controleert en verstuurt zelf.

---

## TODO-typen — herkenningsregels

| Type | Wanneer | Wachttijd |
|---|---|---|
| `offerte_reminder` | Deal stage = "Offerte" én laatste mail richting prospect > 7 dagen geleden | 1 reminder na 7d, 2e na 14d, daarna niet meer auto |
| `trial_ending` | Deal stage = "Proeftijd" én trial-einddatum binnen 7 dagen | Eén keer 7 dagen voor einde, geen herhaling |
| `checkin` | Deal stage = "Kennismakinggehad" én geen activiteit > 14 dagen | Maximaal 1 check-in per maand |
| `onboarding_followup` | Deal stage = "Not started" + startdatum binnen 7 dagen | Eén keer ~5 dagen voor start |
| `other` | Ad-hoc, bv. handmatig via Slack-trigger | n.v.t. |

**Dedup-sleutel** voorkomt dat dezelfde TODO elke poll opnieuw aangemaakt wordt:

```
offerte_reminder:<dealId>:<ISO-week>    # max 1 per week per deal
trial_ending:<dealId>                   # max 1 ooit per deal
checkin:<dealId>:<year-month>           # max 1 per maand per deal
onboarding_followup:<dealId>            # max 1 ooit
```

Insert gebruikt `ON CONFLICT (dedup_key) DO NOTHING` zodat een al bestaande
TODO niet gedupliceerd wordt.

---

## Stap 0 — Sessie-context

Noteer `now_ts` (lokale tijd NL). Haal `last_run_at`:

```sql
SELECT last_run_at FROM agent_schedules WHERE agent_name = 'sales-todos';
```

## Stap 1 — Relevante deals ophalen uit HubSpot

```
search_crm_objects(
  objectType: "deals",
  filter: "hs_pipeline IN ('Sales Pipeline','Customer base') AND hs_is_closed != true",
  properties: ["dealname","dealstage","hs_lastmodifieddate","closedate",
               "trial_start_date","trial_end_date","amount"],
  associations: ["contacts","companies"]
)
```

Typisch 20–60 open deals. Per deal: bepaal of een TODO-regel van toepassing is.

## Stap 2 — Per deal: check regels + sales-on-road context

Voor elke deal:

1. **Check sales-on-road**: query `sales_on_road_events` met `hubspot_deal_id = <deal>`
   in laatste 24u. Zo ja: skip (sales-on-road heeft de gunst gedaan).
2. **Check verzonden mails**: query Outlook Sent Items voor mails naar primary contact
   in de relevante periode. Zo recent verzonden: skip (Jelle heeft zelf gehandeld).
3. **Evalueer regels** uit de tabel hierboven. Als een regel matcht → TODO kandidaat.

## Stap 3 — TODO insert met dedup

```sql
INSERT INTO sales_todos
  (type, hubspot_deal_id, hubspot_company_id, company_name, contact_email, contact_name,
   reason, suggested_action, priority, dedup_key, status)
VALUES
  ($type, $deal_id, $company_id, $company_name, $contact_email, $contact_name,
   $reason, $suggested_action, $priority, $dedup_key, 'pending')
ON CONFLICT (dedup_key) DO NOTHING
RETURNING id;
```

Als `id` teruggegeven wordt → nieuwe TODO, ga naar Stap 4. Zo niet → al bestaat, skip.

## Stap 4 — Outlook-concept voorbereiden

Gebruik de **brandguide-legal-mind** skill voor tone-of-voice. Kies de juiste template:

| Type | Template / Toon |
|---|---|
| `offerte_reminder` | Vriendelijke follow-up: "Ik hoor je graag als er nog vragen zijn over de offerte die ik op {datum} stuurde." |
| `trial_ending` | Heads-up + volgende stap: "De proefperiode loopt {datum} af. Laat even weten hoe het bevallen is — dan plannen we een korte evaluatie." |
| `checkin` | Open vraag: "Ik hoorde even niks meer na ons gesprek op {datum} — is er iets wat ik kan oppakken om verder te komen?" |
| `onboarding_followup` | Praktisch: "Volgende week begint de licentie. Hier nog de onboarding-planning en wat je kan verwachten." |

**Plaats de draft via Claude in Chrome**:
1. Open/focus Outlook tab (hergebruik `activeOutlookTabId` uit state zoals auto-draft doet).
2. Klik "Nieuwe mail".
3. Vul `Aan`, `Onderwerp`, `Body` met de gerenderde template.
4. Klik "Verplaatsen" → selecteer map **Sales Agent**.
5. Sluit als draft (niet verzenden).

Als Chrome/Outlook onbereikbaar: TODO blijft staan met `status='pending'`,
`outlook_draft_created=false`, `error_message="Chrome niet bereikbaar"`. Volgende
poll probeert opnieuw.

## Stap 5 — Status updaten

```sql
UPDATE sales_todos
SET status='draft_ready',
    outlook_draft_created=true,
    outlook_draft_subject=$subject,
    outlook_draft_folder='Sales Agent',
    updated_at=now()
WHERE id=$todo_id;
```

## Stap 6 — Run-record (verplicht)

```sql
INSERT INTO agent_runs
  (agent_name, status, summary, stats, started_at, completed_at, slack_channel)
VALUES (
  'sales-todos',
  $status,  -- success | warning (bij Chrome-issues) | error
  format('%s TODOs gevonden (%s drafts klaar, %s geskipped)', todos_created, drafts_prepared, todos_skipped),
  jsonb_build_object(
    'triggered_by',     $triggered_by,
    'triggered_at',     now()::text,
    'todos_created',    $todos_created,
    'drafts_prepared',  $drafts_prepared,
    'todos_skipped',    $todos_skipped,
    'deals_scanned',    $deals_scanned,
    'todos_summary',    $$[
      {"company": "Stellicher", "type": "offerte_reminder", "time": "<ISO>"},
      {"company": "Epona",      "type": "trial_ending",      "time": "<ISO>"}
    ]$$::jsonb
  ),
  $start_ts, now(), 'sales'
);
```

---

## Aandachtspunten

1. **Nooit zelf verzenden.** De skill maakt alleen drafts. Jelle blijft de final
   sender — persoonlijke blik is verplicht in sales.
2. **Dedup-sleutel is de verzekering** tegen herhaaldelijk dezelfde mail voorbereiden.
3. **Outlook Sent Items lezen** voorkomt dubbele reminders voor deals waar Jelle zelf al heeft gehandeld.
4. **Brandguide-legal-mind** integreren voor tone-of-voice.
5. **HubSpot dealstage-namen** — case-sensitive, actuele namen lezen bij elke run.
6. **Sales Agent Outlook-map** — dezelfde map die sales-on-road gebruikt.
7. **Geen Slack-ruis** — skill post niet bij elke run. Alleen bij fouten of >5 TODOs.

---

## Dashboard-pagina

Op https://legal-mind-dashboard-jelle-burggraaf.vercel.app/ tab **Sales TODO's**:
- Status-kaart (laatste run, volgende poll)
- KPI's: draft klaar, in behandeling, vandaag voltooid, fouten
- Tabel: type · bedrijf · reden · draft · status
- Sectie "Klaar om te versturen" met de draft_ready items

---

## Referenties

- Supabase tabel: `sales_todos` (migratie `create_sales_todos_and_rename_hubspot`)
- HubSpot MCP prefix: `mcp__82f94de2-e5ca-4223-ae7e-dc4513165411__`
- Outlook draft-flow: zie `auto-draft/SKILL.md` stappen 4–5
- Sales-on-road interactie: deals aangeraakt vandaag door sales-on-road → skip in Stap 2
- Brand tone-of-voice: `brandguide-legal-mind` skill
