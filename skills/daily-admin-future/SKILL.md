---
name: daily-admin-future
description: "Future-variant van Daily Admin (display-naam 'Administratie · Toekomst'). Scant ALLE aankomende externe-attendee events in Outlook-agenda (28d vooruit) en classificeert per categorie: recruitment (Jira-REC name-match), customer (Customer Base-deal), sales/lead (Sales-pipeline of contact-zonder-deal), partner (partner_domains) of onbekend. Voor onbekend roept skill context-build (RAG via match_chunks) aan en kan een event upgraden naar lead bij eerder mail/meeting-contact. Schrijft VOORSTELLEN naar agent_proposals met agent_name='daily-admin-future' — voert nooit direct mutaties door. Acties per categorie: REC-card update, kennismaking_datum op bestaande deal, of nieuwe Sales Pipeline-deal. Los van daily-admin zodat huidig-flow ongewijzigd blijft. Trigger op 'scan toekomst', 'future scan', 'kennismakingen voorbereiden', of dagelijks 07:00 NL via orchestrator."
---

# daily-admin-future — v1.6

> **v1.6 (2026-05-05):** RAG-laag toegevoegd. Voor `onbekend`-events roept de skill `context-build` aan (intent=`enrich_record`) met subject + attendee-naam + domain. Top-3 matches worden in de proposal-summary getoond, `rag_bundle_id` in `context` voor R.7-link. Heuristiek: top-match in mail/engagement/fireflies van een attendee-domein → upgrade categorie naar `lead`.

> **v1.5 (2026-05-05):** detectie verbreed naar alle externe-attendee events (geen kennismaking-keyword filter); categorie-classifier (recruitment/customer/sales/lead/partner/onbekend); acties per categorie i.p.v. één template.

> **Doel.** Aankomende kennismakingen in de agenda omzetten naar HubSpot-pre-fills *vóór* de afspraak, zodat de Power BI-rapportage (kennismaking-datum, verwachte omvang, kantooromvang) compleet is. Alle mutaties als voorstel — Jelle accepteert/wijzigt/rejecteert.

> **Bewust géén overlap met daily-admin.** Huidig-flow (mail/agenda/fireflies van afgelopen 24-48u → notes/tasks op bestaande deals) blijft ongewijzigd. Toekomst-flow kijkt 28 dagen vooruit en gaat alleen over deal-aanmaak en pre-fill.

## Trigger
- **Primair:** orchestrator, dagelijks 07:00 NL (cron `0 7 * * 1-5`).
- **Manual:** dashboard-knop "⟳ Scan toekomst nu" zet `agent_schedules.manual_run_requested_at`.

## Bronnen

| Bron | Wat | Filter |
|---|---|---|
| `calendar_events` + `calendar_attendees` | Outlook-agenda mirror (gevuld door `outlook-calendar-sync-etl`) | `start_time` ∈ [NU, NU+28d], niet `is_cancelled`, kennismaking-keywords in subject/body, ≥1 externe attendee |
| `hubspot_contacts` | Mirror | match op `email` van externe attendees |
| `hubspot_companies` | Mirror | match op `domain` of via `associated_company_id` van contact |
| `hubspot_deals` | Mirror | overlap op `associated_contact_ids`/`associated_company_ids`, niet `is_archived` |
| `hubspot_pipelines` | Mirror | voor stage-resolutie |
| `agent_config(daily-admin-future, *)` | Skill-config | `state`, `custom_instructions`, `property_mapping` |

## Kennismaking-detectie

Subject + body_preview (lowercase) bevat een van:
`kennismaking`, `kennismakingsgesprek`, `intake`, `intro`, `introductie`, `eerste gesprek`, `eerste afspraak`, `demo`, `pilot`, `proefperiode`, `prospect`.

Plus minimaal één externe attendee (email niet `@legal-mind.nl`, attendee_type ≠ `resource`).

## Beslislogica per event

Match externe attendees → contact → deal/company:

| Match-status | Voorstel-acties |
|---|---|
| **Geen contact, geen company** | `company` (create, vraag KvK/website-info als bekend uit body) + `contact` (create) + `deal` (create in Sales Pipeline, stage `Kennismaking gepland` (zo niet beschikbaar dan `appointmentscheduled` met note) + `kennismaking_datum` property) |
| **Contact wel, geen deal in Sales Pipeline** | `deal` (create in Sales Pipeline) + `kennismaking_datum` property + linken aan contact + company |
| **Deal in Sales Pipeline, `kennismaking_datum` leeg** | `stage` (→ Kennismaking plaatsgevonden bij datum in verleden, anders Gepland) + `deal_property_update` (`kennismaking_datum`, optioneel `verwachte_omvang`/`verwachte_kantooromvang` als skill iets kan afleiden uit `num_employees`) |
| **Deal en `kennismaking_datum` aanwezig en correct** | Skip (filter-record) |

## Property-mapping

`agent_config(daily-admin-future, property_mapping)` levert internal HubSpot-namen:
```json
{
  "kennismaking_datum": "kennismaking_datum",
  "verwachte_omvang":   "verwachte_omvang",
  "verwachte_kantooromvang": "verwachte_kantooromvang"
}
```
Default-namen zijn educated guesses — Jelle kan ze in dashboard onder **Instellingen → Skill-instellingen → daily-admin-future** corrigeren als de echte property internal_name anders is. Skill leest deze mapping élke run, hardcodet niets.

## Voorstel-structuur (jsonb)

Hergebruikt het schema van `daily-admin` zodat `ProposalCardCompact` werkt zonder aanpassingen:

```json
{
  "target": { "id": "<event_graph_id|hubspot_id>", "type": "calendar_event|deal|company" },
  "actions": [
    { "type": "company", "label": "Company: <name>", "payload": { "name": "...", "domain": "...", "industry": "...", "num_employees": 25, "city": "..." } },
    { "type": "contact", "label": "Contact: <name>", "payload": { "email": "...", "firstname": "...", "lastname": "...", "jobtitle": "...", "company_domain": "..." } },
    { "type": "deal",    "label": "Deal: <name> · Sales Pipeline · Kennismaking gepland", "payload": { "dealname": "...", "pipeline": "default", "dealstage": "appointmentscheduled", "amount": null } },
    { "type": "deal_property_update", "label": "Property: kennismaking_datum = <date>", "payload": { "deal_id": "<id of empty if linked to new deal>", "property": "kennismaking_datum", "value": "2026-05-12" } }
  ]
}
```

`context` bevat ALTIJD: `calendar_event_id` (UUID), `calendar_event_graph_id` (Outlook-id), `start_time`, `attendee_emails[]`, `pipeline` (= `default`), `pipeline_stage` (= `appointmentscheduled`).

## Run-record (v1-contract)

```json
{
  "schema_version": "1",
  "skill_version": "daily-admin-future-v1",
  "triggered_by": "<orchestrator|manual|edge_cron>",
  "triggered_at": "<ISO>",
  "passes": [
    { "name": "calendar-scan",      "status": "success" },
    { "name": "match-resolve",      "status": "success" },
    { "name": "proposal-create",    "status": "success" }
  ],
  "counts": {
    "calendar_events_scanned": 0,
    "kennismakingen_detected": 0,
    "events_with_externals":   0,
    "contacts_matched":        0,
    "companies_matched":       0,
    "deals_matched":           0,
    "proposals_created":       0,
    "events_skipped_already_proposed": 0,
    "events_skipped_complete":         0
  }
}
```

## Veiligheid
1. Geen directe HubSpot-writes — alleen voorstellen.
2. Skip events waar al een `pending`/`accepted` voorstel voor bestaat (`context.calendar_event_id`-match).
3. `expires_at = NOW() + 14 dagen` (langer dan daily-admin omdat het over toekomstige afspraken gaat).
4. Filter recurring-master events; alleen instances tellen mee.

## Skill-familie
- `outlook-calendar-sync-etl` — vult `calendar_events` + `calendar_attendees`.
- `hubspot-sync-etl` — vult `hubspot_*`.
- `daily-admin` — historie/huidig.
- `daily-admin-future` (deze) — toekomst, kennismakings-pre-fill.

## Open punten v1
- Executor voor accepted proposals (HubSpot-writes) — komt in v2 zodra Jelle de eerste output heeft beoordeeld en de property-mapping bevestigd is.
- Verwachte omvang / kantooromvang afleiden — v1 alleen heuristiek op `hubspot_companies.num_employees`. Verfijning komt later.
- Andere pipelines dan Sales Pipeline (`default`) — v1 negeert leads-pipelines.
