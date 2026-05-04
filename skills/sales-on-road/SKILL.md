---
name: sales-on-road
description: "Event-agent (display-naam 'Road Notes') die post-meeting aantekeningen verwerkt uit Jelle's dashboard quick-capture. Haalt klant op in HubSpot, zet juiste deal-stage in Sales Pipeline, voegt contactpersonen + gespreksnotitie toe, en bereidt follow-up mail voor in Outlook-map 'SalesAgent'. Leest input uit Supabase tabel sales_on_road_inbox (gevuld door dashboard 'Nieuwe aantekening'-formulier) en mail-historie uit mail_messages (mail-sync skill). Schrijft naar sales_on_road_events. Draait elke 30 min werktijd via orchestrator. Trigger ook bij 'sales on road', 'verwerk aantekeningen', 'ik heb een kennismakingsgesprek gehad', 'zet dit in hubspot', 'na mijn gesprek met [kantoor]'. Trigger NIET voor algemene HubSpot-sync of bulk-imports."
---

# Sales on Road (Road Notes) — v5 (context-build CaaS)

> **v5 wijziging (2026-05-04):** Stap 4 directe RPC-call vervangen door één POST naar `context-build` met `intent='compose_followup'`. Centraal beheerbare retrieval-recipe via `context_intents`. Bundle_id voor R.7-link.
>
> **v4 wijziging (2026-05-04):** Stap 4 mail-historie vervangen door
> entity-aware RAG via `match_chunks_for_entity('company', X)`. Cross-source
> context (mail + engagements + meetings) ipv alleen mail. Legacy mail-query
> blijft als fallback.
>
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
- HubSpot voor company/contact/deal/notes (lookup, update, association-writes).
- Composio Outlook voor draft-create (`OUTLOOK_LIST_FOLDERS`, `OUTLOOK_CREATE_DRAFT_IN_FOLDER`).
- **Auth & MCP-fallback:** zie [`agent-handbook/references/authentication.md`](../agent-handbook/references/authentication.md) — single source of truth. Decision-tree (sectie 1) bepaalt automatisch route per operatie; skill noemt geen specifieke v-route hier.
- Per-skill specifiek (niet door handbook gedicteerd): `composio_connection_id_hubspot` + `composio_connection_id_outlook` in `agent_config(sales-on-road, ...)` (fallback `agent_config(global, ...)`).
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

## Stap 4 — Cross-source context via context-build CaaS (sinds v5)

In plaats van zelf RPC's aan te roepen, vraag context op via één POST naar de
centrale `context-build` Edge Function. Recipe `compose_followup` levert
top_k=10, recency_weight=0.20, max_per_source=3 (mix mail/eng/meeting).

```bash
POST /functions/v1/context-build
Authorization: Bearer <skill:global:cron_secret>

{
  "intent": "compose_followup",
  "audience": "sales-on-road",
  "trigger_type": "company_visit",
  "trigger_id": "<hubspot_company_id>",
  "query_text": "<company_name>",
  "options": {
    "entity_type": "company",
    "entity_id": "<hubspot_company_id>"
  }
}
```

Response: `{bundle_id, matches, entity_used, retrieval_meta, freshness}`. Bewaar
`bundle_id` voor R.7-link in stap 7 telemetrie.

Dit retourneert top-10 chunks: mails van klant-domein, engagements/notes/calls
op deals van deze klant, eerdere meeting-transcripten — gerangschikt op
combined_score (vector + BM25 + recency).

**JelleMind-lessons consumeren** (sinds 2026-05-04 — JelleMind Activation): naast
`bundle.matches[]` retourneert context-build ook `bundle.knowledge_lessons[]` —
top-3 lessons in mind_scopes `jelle` + `skill` + `legalmind` (post-meeting
follow-up combineert toon, proces én organisatie-feiten). Gebruik ze om de
follow-up mail te kleuren — zet de sectie **boven** de mail-instructies in de
prompt:

> ## Toepasselijke regels uit JelleMind
> - **[skill]** Bij vervolgactie maakt agent zelf de taak/kaart aan
> - **[jelle]** Jelle gebruikt 'je' i.p.v. 'u'

Als `knowledge_lessons` leeg is → laat de sectie weg. Telemetrie: tel
`stats.jellemind_lessons_used += knowledge_lessons.length`.

**Skip-conditie**: company-master-chunk bestaat niet → val terug op de legacy
mail_messages-query hieronder. RAG is feature-add, niet vervanger.

**Legacy fallback (als chunks-tabel niet hit)**:

```sql
SELECT received_at, from_email, is_from_me, subject, body_preview
  FROM mail_messages
 WHERE NOT is_deleted
   AND received_at >= now() - interval '90 days'
   AND (lower(from_email) = lower($contact_email)
        OR to_recipients::text ILIKE '%' || $contact_email || '%')
 ORDER BY received_at DESC
 LIMIT 20;
```

**Mail_messages stale (>30 min) bij legacy-pad** → val terug op `OUTLOOK_SEARCH_MESSAGES`.

**Telemetrie** (na proposal-create in stap 7): roep `log_rag_outcome` aan met
de chunks die in de context-pas zijn meegegaan zodat acceptance-rate per
chunk-type later meetbaar is via R.7.

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

## Stap 9 — Run-record schrijven (verplicht, v1-contract)

Volledige spec in `agent-handbook/references/logging.md`. Per-event details horen in `extra.events[]`,
niet in stats top-level. Hard errors (Composio/HubSpot/Chrome unreachable) → `agent_runs.errors[]`.

```sql
INSERT INTO agent_runs
  (agent_name, status, summary, stats, started_at, completed_at, slack_channel)
VALUES (
  'sales-on-road',
  -- success als alle events verwerkt; warning als needs_review>0; error als alles faalde
  $status,
  format('%s events gezien, %s verwerkt, %s needs_review, %s errors',
    events_seen, events_processed, events_needs_review, events_errored),
  jsonb_build_object(
    'schema_version', '1',                    -- STRING "1" — nooit integer
    'skill_version',  'sales-on-road-v2',
    'mode',           null,
    'triggered_by',   $triggered_by,          -- 'orchestrator'|'manual'|'slack'
    'triggered_at',   now()::text,
    'passes',         $passes_jsonb,          -- één entry per inbox-event: [{name,ms,status}]
    'warnings',       '[]'::jsonb,
    'counts',         jsonb_build_object(
      'events_seen',         $events_seen,
      'events_processed',    $events_processed,
      'events_needs_review', $events_needs_review,
      'events_errored',      $events_errored,
      'events_skipped',      $events_skipped   -- al verwerkt bij eerdere run
    ),
    'extra',          jsonb_build_object()
  ),
  $start_ts, now(), 'sales-on-road'
);
```

---

## Aandachtspunten

1. **Idempotentie** — `slack_ts` is UNIQUE in `sales_on_road_events`. Een dubbele run
   (bijvoorbeeld orchestrator + handmatige trigger kort na elkaar) kan geen dubbele
   HubSpot-mutaties veroorzaken: de skill checkt eerst of de rij al bestaat.
2. **Dubbele bedrijven in HubSpot** — altijd vragen in Slack-thread, nooit gokken.
   `needs_review` blijft staan tot Jelle antwoord geeft; volgende orchestrator-poll
   pikt het antwoord op uit de thread.
3. **Chrome-dependentie** — Outlook-draft vereist open Chrome + actieve Outlook-tab.
   Als onbereikbaar: skill faalt niet, Outlook-stap wordt overgeslagen, status
   `needs_review`. Jelle kan handmatig triggeren zodra Chrome weer beschikbaar is.
4. **HubSpot-daily-sync interactie** — die draait dagelijks om 17:00 en leest nu óók
   `#sales-on-road` voor context ("is er vandaag een nieuw gesprek geweest met kantoor
   X dat ik moet meenemen"). Dit voorkomt dat sales-on-road én daily-sync in dezelfde
   uren tegenstrijdige updates doen — sales-on-road is leading binnen zijn eigen kanaal.
5. **Licentie-generatie** — nog handmatig. De `licentie-analyse` skill is financieel-
   analytisch, niet contract-genererend. Zodra er een `licentie-contract` skill komt:
   integreren in Stap 7 (draft-stage "Proeflicentie") om de PDF als bijlage toe te voegen.
6. **SalesAgent Outlook-map** — map bestaat onder Jelle's Concepten. Als de map niet
   gevonden wordt: val terug op root Concepten-map en noteer in `summary`.

---

## Security

- HubSpot + Slack + Chrome MCP tokens leven in hun eigen auth-scope — deze skill
  gebruikt alleen MCP-aanroepen, nooit directe tokens.
- Slack-bericht kan persoonlijke namen/e-mails bevatten → **niet** loggen in klaartekst
  in `agent_runs.summary`. Dashboard leest alleen geaggregeerde stats. Rauwe tekst
  leeft in `sales_on_road_events.raw_message` (public-read via RLS) — als dit een
  probleem wordt: `raw_message` naar aparte secret-kolom verhuizen.

## Referenties

- Supabase tabel: `sales_on_road_events` (migratie `create_sales_on_road_events`)
- Supabase bucket: `offertes` (private, 50MB/file, PDF+DOCX only; service-role key vereist voor upload)
- Nieuwe kolommen (v1.1): `offerte_url`, `offerte_storage_path`
- Slack conventies: `slack-communication` skill
- HubSpot property-namen: `hubspot-daily-sync/references/properties-*.md`
- Brand tone-of-voice: `brandguide-legal-mind` skill
- Offerte-generator: `offerte-generator` skill (levert PDF/DOCX paths)

---

**Versie:** 1.1
**Laatste update:** 2026-04-21
**Status:** Production Ready

**Changelog 1.1:**
- Stap 7a toegevoegd: bij `license_requested=true` roept de skill nu
  automatisch `offerte-generator` aan, uploadt de resulterende PDF naar de
  Supabase-bucket `offertes` en plakt een signed URL (7 dagen) in zowel
  de Outlook-draft als een HubSpot-note op de deal.
- Nieuwe DB-kolommen: `sales_on_road_events.offerte_url` + `offerte_storage_path`.
- Event-status `needs_review` wordt alleen nog gezet als offerte-generator
  of de upload zelf faalt — bij succes is het gewoon `processed`.

