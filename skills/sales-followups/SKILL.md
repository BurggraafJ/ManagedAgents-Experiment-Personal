---
name: sales-followups
description: "Proactieve sales-opvolger (display-naam 'Sales Follow-ups', voorheen sales-todos). Scant HubSpot deals + mail-historie en flagt deals die actie vragen — offerte-reminders, eindigende proefperiodes, stille contacten zonder mail-respons. Sinds v3 (2026-04-28) leest deals uit hubspot_deals mirror ipv direct HubSpot. Schrijft taken naar sales_todos en zet concept-mails klaar in Outlook-map 'Sales Agent' via Composio. Draait elke werkochtend 08:00 via orchestrator. Trigger ook bij 'sales follow-ups', 'welke deals hebben actie nodig', 'offerte-reminders', 'trial eindigt', 'check openstaande offertes', 'reminder mails'. Trigger NIET voor post-meeting verwerking (dat is sales-on-road) of dagelijkse admin (dat is daily-admin)."
---

# Sales Follow-ups — v3 (mirror-driven)

> **v3 wijziging (2026-04-28):** Deal-scan via `hubspot_deals` + `hubspot_pipelines` mirror, gevuld door `hubspot-sync-etl` Edge Function elke 30 min. Geen directe HubSpot-MCP-calls meer voor deal-reads. Outlook-write voor concept-drafts blijft via Composio. Naamswijziging: `sales-todos` → `sales-followups`. Tabel `sales_todos` blijft (beschrijft de output).

## Trigger
- **Primair:** orchestrator, cron `0 8 * * 1-5` (werkochtend 08:00).
- **Manual:** "sales follow-ups", "welke deals hebben actie nodig".

## Doel per run
Voor elke deal in HubSpot Sales Pipeline + Customer Base, detecteer actie-momenten:
1. Offerte-reminder — offerte verstuurd >5 dagen geleden, geen mail-reactie.
2. Trial-einde — proefperiode eindigt binnen 7 dagen, geen recente touch.
3. Stille contacten — actieve deal, geen mail-uitwisseling >14 dagen.
4. Bevestigingen niet ontvangen — licentieovereenkomst gestuurd, geen reply.

Voor elk gevonden todo: schrijf naar `sales_todos` + concept-mail in Outlook-map "Sales Agent".

## Stap 1 — Connectie + state
- Supabase service-role.
- `hubspot_deals` + `hubspot_pipelines` + `hubspot_users` mirror.
- Composio Outlook MCP voor draft-create.
- `agent_config.sales-followups.config` voor settings.

**Mirror-freshness check:**
```sql
SELECT extract(epoch FROM (now() - last_delta_sync))/60 AS minutes_old
  FROM hubspot_sync_state WHERE id = 1;
```
>60 min: log warning `hubspot_mirror_stale`. Skill draait door.

## Stap 2 — Haal relevante deals op (uit hubspot_deals mirror)

Label-based stage-filter (overleeft stage-id renames):

```sql
WITH active_stages AS (
  SELECT p.pipeline_id, s.value->>'id' AS stage_id, s.value->>'label' AS stage_label
    FROM hubspot_pipelines p, jsonb_array_elements(p.stages) s
   WHERE p.label IN ('Sales Pipeline', 'Customer Base')
     AND trim(s.value->>'label') IN (
           '1-pitters in proefperiode (zonder ovk)', 'Offerte gestuurd',
           'Mondeling/mail/offerte akkoord', 'Licentieovereenkomst gestuurd',
           'Proeftijd', 'Actieve deals'
         )
)
SELECT d.deal_id, d.dealname, d.dealstage, d.pipeline_id,
       d.amount, d.closedate, d.dealtype,
       d.hubspot_owner_id, u.full_name AS owner_name, u.email AS owner_email,
       p.label AS pipeline_label, a.stage_label,
       d.associated_contact_ids, d.associated_company_ids,
       d.properties, d.hs_lastmodifieddate, d.hs_created_at
  FROM hubspot_deals d
  JOIN active_stages a
    ON a.pipeline_id = d.pipeline_id AND a.stage_id = d.dealstage
  JOIN hubspot_pipelines p ON p.pipeline_id = d.pipeline_id
  LEFT JOIN hubspot_users u ON u.hubspot_owner_id = d.hubspot_owner_id
 WHERE NOT d.is_archived
 ORDER BY d.hs_lastmodifieddate DESC;
```

Voor elke deal: contacts via `hubspot_contacts` waar `contact_id = ANY(d.associated_contact_ids)`. Fallback indien leeg: domein-match op `hubspot_companies.domain`.

## Stap 3 — Mail-respons-check (uit mail_messages)

```sql
-- Laatste mail van deze contact naar ons
SELECT max(received_at) AS last_mail_in
  FROM mail_messages
 WHERE NOT is_deleted
   AND lower(from_email) = lower($contact_email)
   AND NOT is_from_me;

-- Laatste mail van ons naar deze contact
SELECT max(received_at) AS last_mail_out
  FROM mail_messages
 WHERE NOT is_deleted AND is_from_me
   AND to_recipients::text ILIKE '%' || $contact_email || '%';
```

| Conditie | Trigger todo |
|---|---|
| `last_mail_in` IS NULL én `last_mail_out > deal.hs_lastmodifieddate + 5 days` én stage_label='Offerte gestuurd' | offerte_reminder |
| Trial einddatum (custom property) ≤ now() + 7 days, geen recente mails | trial_einde |
| `greatest(last_mail_in, last_mail_out) < now() - interval '14 days'` én actieve stage | stille_contact |
| stage_label='Licentieovereenkomst gestuurd' >7 dagen, geen `last_mail_in` | ovk_geen_reactie |

## Stap 4 — Schrijf todo + concept-draft

```sql
INSERT INTO sales_todos (
  deal_id, deal_name, contact_email, contact_name,
  todo_type, reason, draft_subject, draft_body,
  status = 'draft_ready', created_at = now()
);
```

Daarna concept-draft in Outlook "Sales Agent"-map via `OUTLOOK_LIST_FOLDERS` + `OUTLOOK_CREATE_DRAFT_IN_FOLDER`. Optioneel: `outlook_draft_id` terug-linken in `sales_todos`.

Skill verstuurt NIETS — Jelle reviewt en klikt zelf send.

## Stap 5 — Run-record

```jsonb
{
  "triggered_by": "<orchestrator|manual>",
  "triggered_at": "<ISO>",
  "source": "hubspot_deals mirror + mail_messages",
  "mirror_age_min": <N>,
  "deals_scanned": <N>,
  "todos_created": {
    "offerte_reminder": <N>, "trial_einde": <N>,
    "stille_contact": <N>, "ovk_geen_reactie": <N>
  },
  "drafts_placed_in_outlook": <N>,
  "warnings": [...]
}
```

## Veiligheidsregels
1. Geen verzending — alleen drafts in Sales Agent-map.
2. Geen HubSpot-mutaties.
3. Mail-context uit `mail_messages`; fallback bij stale (>30 min).
4. Deal-context uit `hubspot_deals` mirror; warning bij stale (>60 min).
5. Idempotent — geen dubbele todos voor dezelfde deal+todo_type binnen 3 dagen.

## Rapportage
Geen externe meldingen. Dashboard Sales-pagina "Sales Follow-ups" toont open todos.

## Supabase service-role
Vereist (`skill_secrets_registry` → `sales-followups` → `SUPABASE_SERVICE_ROLE_KEY`).

## Skill-familie
- `mail-sync-etl-v2` (Edge Function) — vult `mail_messages`.
- `hubspot-sync-etl` (Edge Function) — vult `hubspot_*` tabellen.
- `sales-followups` (deze) — proactieve detectie uit mirror.
- `sales-on-road` — post-gesprek verwerking.
- `daily-admin` — bredere admin-sync.
