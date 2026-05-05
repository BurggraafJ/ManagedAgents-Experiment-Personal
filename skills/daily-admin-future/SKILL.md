---
name: daily-admin-future
description: "Future-variant van Daily Admin (display-naam 'Administratie · Toekomst'). Scant ALLE aankomende externe-attendee events in Outlook-agenda (28d vooruit), classificeert per categorie (recruitment / customer / sales / lead / partner / onbekend) via Jira-REC + HubSpot-mirror + partner_domains, en doet voor onbekend een RAG-lookup via context-build. Schrijft alleen ECHTE twijfelgevallen als voorstel — al-lopende relaties (Customer Base, Sales-deal voorbij kennismaking, personal domain, lead met al-ingeplande historie) worden geskipt. Voorstellen via agent_proposals met agent_name='daily-admin-future', voert nooit direct mutaties door. Acties per categorie: REC-card update, kennismaking_datum op bestaande deal, of nieuwe Sales Pipeline-deal. Los van daily-admin zodat huidig-flow ongewijzigd blijft. Trigger op 'scan toekomst', 'future scan', 'kennismakingen voorbereiden', of dagelijks 07:00 NL via orchestrator."
---

# daily-admin-future — v1.13

> **v1.13 (2026-05-05):** HubSpot custom-property fetch via Composio REST proxy. Voor elke gematchte deal_id roept skill `/crm/v3/objects/deals/{id}?properties=kennismaking_datum,verwachte_omvang,verwachte_kantooromvang` aan en cached in `hubspot_deal_property_cache`. Customer Base-events worden niet meer geskipt als de datum-property leeg is of niet matcht event-datum — dan komt er ALSNOG een voorstel voor datum-update onder Goedkeuren. Lead/onbekend-trio's krijgen een extra **note-actie** met deal_owner / pipeline-context / locatie / deelnemers / next-steps zodat de note direct op de nieuwe deal klaar staat.

> **v1.12 (2026-05-05):** soft cross-agent dedup; cache-tabel hubspot_deal_property_cache.

> **v1.11 (2026-05-05):** pipeline-fix (altijd Leads non-campaign + Kennismaking gepland voor toekomst-flow), cross-agent dedup (eerste versie), pipeline_label/stage_label expliciet in context.

# daily-admin-future — v1.9

> **v1.9 (2026-05-05):** Pipeline-keuze per lead/onbekend. Helper `pickLeadPipeline` kijkt naar RAG-matches:
> - Substantial mail/engagement-context (combined-score ≥ 0.20 in source 'mail' of 'engagement') → **Sales Pipeline (default) + stage `appointmentscheduled`** ("Kennismaking plaatsgevonden") — er is al communicatie geweest.
> - Geen mail-historie → **Leads (non-campaign) + stage "Kennismaking gepland"** — echt eerste contact, hoort nog in leads-funnel.
>
> Pipeline-keuze + reden komen in proposal-summary zodat Jelle direct ziet waarom de skill die pipeline koos. Kan correctie via dashboard accept/amend.

> **v1.8 (2026-05-05):** Per-event dismiss. Tabel `daily_admin_future_dismissed` houdt bij welke events Jelle in dashboard heeft weggeklikt ("🗑 Niet meer tonen"). Skill checkt deze set vóór de classifier en skipt dismissed events met counts.events_skipped_dismissed_by_user. Bij undo (↶ in dashboard) verwijdert dashboard de rij en wordt het event weer een kandidaat.

> **v1.7 (2026-05-05):** filter-laag toegevoegd. Skip vóór proposal-creatie:
> - Customer Base-klant → al onboarded, geen kennismaking
> - Sales-deal in stage > Kennismaking plaatsgevonden → te ver
> - Sales-deal mét kennismaking_datum al ingevuld → al gedaan
> - Alle externe attendees @gmail/@hotmail/@outlook.com/etc. → personal/familie
> - Lead met ≥2 RAG-matches waarvan ≥1 in source 'event' → kennismaking IS deze afspraak, niet een nieuwe
>
> Skip-redenen komen in run-stats; geen rij in agent_proposals.

> **v1.6 (2026-05-05):** RAG-laag. Voor `onbekend`-events roept de skill `context-build` aan (intent=`enrich_record`) met subject + naam + domain. Top-3 matches in proposal-summary, `rag_bundle_id` in `context`. Heuristiek: combined-score ≥ 0.20 + match in mail/engagement/event/meeting → upgrade naar `lead`.

> **v1.5 (2026-05-05):** detectie verbreed naar alle externe-attendee events; categorie-classifier (recruitment/customer/sales/lead/partner/onbekend) via Jira REC + HubSpot deal-pipeline + partner_domains.

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
