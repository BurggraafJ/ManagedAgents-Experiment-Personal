---
name: sales-on-road
description: "Event-agent (display-naam 'Road Notes') die post-meeting aantekeningen verwerkt uit Jelle's dashboard quick-capture. Haalt klant op in HubSpot, zet juiste deal-stage in Sales Pipeline, voegt contactpersonen + gespreksnotitie toe, en bereidt follow-up mail voor in Outlook-map 'SalesAgent'. Leest input uit Supabase tabel sales_on_road_inbox (gevuld door dashboard 'Nieuwe aantekening'-formulier) en mail-historie uit mail_messages (mail-sync skill). Schrijft naar sales_on_road_events. Draait elke 30 min werktijd via orchestrator. Trigger ook bij 'sales on road', 'verwerk aantekeningen', 'ik heb een kennismakingsgesprek gehad', 'zet dit in hubspot', 'na mijn gesprek met [kantoor]'. Trigger NIET voor algemene HubSpot-sync of bulk-imports."
---

# Sales on Road (Road Notes) — v3 (dashboard-input)

> **v3 wijziging:** input-bron is dashboard quick-capture via tabel
> `sales_on_road_inbox` (Slack #sales-on-road uitgefaseerd in Fase 2.c).
> Mail-historie uit `mail_messages` (mail-sync). Outlook-write voor
> follow-up draft blijft Composio.

## Trigger
- **Primair:** orchestrator, cron `*/30 8-18 * * 1-5` (elke 30 min werktijd).
- **Manual:** "sales on road", "verwerk aantekeningen".

## Doel per run

Lees nieuwe aantekeningen uit `sales_on_road_inbox WHERE status='pending'`.
Voor elke aantekening (= one event):
1. Parse: kantoor/klant + welk type contact (kennismaking, demo, terugkoppeling, no-show).
2. Vind/maak HubSpot-records (company + contacts + deal).
3. Zet deal-stage en voeg contactpersonen toe.
4. Schrijf gespreksnotitie naar deal in juiste pipeline-context.
5. Bereid follow-up mail-draft in Outlook-map "SalesAgent".
6. Schrijf event naar `sales_on_road_events` met `status='needs_review'`
   zodat Jelle in dashboard kan accepteren/aanpassen.
7. Markeer inbox-rij als `status='done'` met `processed_event_id`.

## Stap 1 — Connectie + state

- Supabase service-role (read inbox, write events + status).
- HubSpot MCP voor company/contact/deal/notes.
- Composio Outlook MCP voor draft-create (write only).
- Geen watermark meer nodig — inbox-status doet dat (`pending` → `done`).

## Stap 2 — Inbox-aantekening ophalen + parsen

```sql
-- Pak oudste pending-rijen, max 10 per run om Graph-throttling te voorkomen
SELECT id, raw_text, created_at, source
  FROM sales_on_road_inbox
 WHERE status = 'pending'
 ORDER BY created_at ASC
 LIMIT 10;
```

Voor elke rij:
- Markeer eerst `status='processing'` (voorkomt dubbele claim bij overlappende runs):
  ```sql
  UPDATE sales_on_road_inbox SET status='processing'
   WHERE id = $1 AND status = 'pending'
  RETURNING id;
  ```
  Niets terug = andere run claimde deze al, skip.
- Parse `raw_text`: typisch `"[kantoor] [type contact] [korte notitie]"`.

LLM-parse extracteert: `kantoor_naam`, `contact_type`, `notitie_text`,
optionele `contactpersoon_naam`, optionele `next_step`.

Pas `terminology_corrections` toe op `raw_text` vóór extractie (Tarik/Tariq,
Joosten/Jozan, Geldermalsen/Schildermalsen, etc.).

## Stap 3 — HubSpot lookup + matching

Zoek company in HubSpot op naam (fuzzy match).
Niet gevonden? → flag voor Jelle in `sales_on_road_events.status='needs_company_match'`,
geen mutaties tot Jelle accepteert.

Wel gevonden:
- Lees alle deals van company in pipeline 'Sales Pipeline' / 'Leads (paddles)' / etc.
- Pak meest recente actieve deal of maak nieuwe als geen.

## Stap 4 — Mail-historie ophalen (uit mail_messages, niet meer Composio!)

Voor elke contact-email die hoort bij de company:

```sql
-- Volledige mail-historie laatste 90 dagen voor context
SELECT received_at, from_email, is_from_me, subject, body_preview
  FROM mail_messages
 WHERE NOT is_deleted
   AND received_at >= now() - interval '90 days'
   AND (lower(from_email) = lower($contact_email)
        OR to_recipients::text ILIKE '%' || $contact_email || '%')
 ORDER BY received_at DESC
 LIMIT 20;
```

Deze historie geeft de follow-up-draft context: wat is recent besproken?
Welke onderwerpen lopen al? Cross-deal-context: andere contacten van
zelfde company kunnen zelfde context delen.

**Fallback:** mail_messages stale (>30 min) → val terug op
`OUTLOOK_SEARCH_MESSAGES` met email-filter.

## Stap 5 — HubSpot mutaties voorbereiden

Bouw een acties-array (NIET direct uitvoeren — schrijf naar sales_on_road_events
met status='needs_review' zodat Jelle dashboard reviewt):

```jsonb
{
  "actions": [
    {"type": "stage", "payload": {"deal_id": "...", "dealstage": "..."}},
    {"type": "contact", "payload": {"firstname": "...", "lastname": "...",
                                    "email": "...", "associate_to_deal": "..."}},
    {"type": "note", "payload": {"deal_id": "...", "content": "..."}}
  ]
}
```

## Stap 6 — Follow-up mail-draft (Composio write — geen verzending!)

```
1. OUTLOOK_LIST_FOLDERS → vind "SalesAgent" folder-id
2. OUTLOOK_CREATE_DRAFT_IN_FOLDER → to=primary_contact, subject, body
   met context uit mail-historie (stap 4)
3. Sla draft-id op in sales_on_road_events.outlook_draft_id
```

Skill VERSTUURT NIETS.

## Stap 7 — Schrijf naar sales_on_road_events + sluit inbox-rij af

```sql
-- Schrijf event
INSERT INTO sales_on_road_events (
  inbox_id, raw_text,
  parsed_kantoor, parsed_contact_type, parsed_notitie,
  hubspot_company_id, hubspot_deal_id,
  proposed_actions,           -- jsonb (zie stap 5)
  draft_subject, draft_body, outlook_draft_id,
  mail_history_summary,       -- korte samenvatting uit stap 4
  status,                     -- 'needs_review' default
  created_at
)
VALUES ($inbox_id, $raw_text, ..., 'needs_review', now())
RETURNING id;

-- Markeer inbox-rij als verwerkt
UPDATE sales_on_road_inbox
   SET status = 'done',
       processed_at = now(),
       processed_event_id = $event_id
 WHERE id = $inbox_id;
```

**Bij parse-fout / fail in HubSpot-lookup:**
```sql
UPDATE sales_on_road_inbox
   SET status = 'error',
       error = $error_message
 WHERE id = $inbox_id;
```

`error`-rijen blijven zichtbaar in dashboard zodat Jelle ze kan repareren
of opnieuw kan submitten.

**Idempotency:** `inbox_id` is uniek (PK in `sales_on_road_inbox`), dus
agent zal nooit twee events voor dezelfde aantekening maken. Het oude
`slack_message_ts`-veld in `sales_on_road_events` blijft bestaan voor
historische data, maar nieuwe rijen gebruiken `inbox_id`.

## Stap 8 — Run-record

```jsonb
{
  "triggered_by": "<orchestrator|manual>",
  "triggered_at": "<ISO>",
  "source": "sales_on_road_inbox + mail_messages + hubspot",
  "inbox_entries_processed": <N>,
  "events_created": <N>,
  "drafts_placed_in_outlook": <N>,
  "events_skipped_company_match": <N>,
  "inbox_errors": <N>,
  "warnings": [...]
}
```

## Veiligheidsregels

1. **Geen verzending** van mails.
2. **Geen HubSpot-mutaties** zonder accepted event in dashboard.
3. **Mail-historie uit mail_messages**, fallback bij stale.
4. **Idempotent op inbox_id** — `processing`-claim voorkomt dubbele runs op zelfde rij.
5. **Bij fout: status='error' op inbox-rij** met error-message — Jelle kan in dashboard reactiveren.

## Rapportage
Geen externe meldingen. Status loopt via `agent_runs`:
- Per run: `summary` met counts (`Processed 3 inbox-entries, 2 events created, 1 needs review`).
- Errors: `agent_runs.status='error'` met leesbare summary.

Het dashboard Sales-pagina "Road Notes" toont open events en inbox-status; de Live-feed toont run-events.

## Supabase service-role
Vereist (`skill_secrets_registry` → `sales-on-road` → `SUPABASE_SERVICE_ROLE_KEY`).

## Skill-familie
- **mail-sync** — vult mail_messages.
- **sales-on-road** (deze) — dashboard-input → HubSpot+Outlook event-flow.
- **sales-todos** — proactieve detectie van actie-momenten.
- **hubspot-daily-sync** — bredere dagelijkse sync.
