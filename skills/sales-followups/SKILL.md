---
name: sales-followups
description: "Proactieve sales-opvolger (display-naam 'Sales Follow-ups', voorheen sales-todos). Scant HubSpot deals + mail-historie en flagt deals die actie vragen — offerte-reminders, eindigende proefperiodes, stille contacten zonder mail-respons. Sinds v3 (2026-04-28) leest deals uit hubspot_deals mirror ipv direct HubSpot. Schrijft taken naar sales_todos en zet concept-mails klaar in Outlook-map 'Sales Agent' via Composio. Draait elke werkochtend 08:00 via orchestrator. Trigger ook bij 'sales follow-ups', 'welke deals hebben actie nodig', 'offerte-reminders', 'trial eindigt', 'check openstaande offertes', 'reminder mails'. Trigger NIET voor post-meeting verwerking (dat is sales-on-road) of dagelijkse admin (dat is daily-admin)."
---

# Sales Follow-ups — v4 (entity-aware RAG)

> **v4 wijziging (2026-05-04):** Per deal die een todo krijgt, haal entity-aware RAG-context op via `match_chunks_for_entity('deal', deal_id, ...)`. Concept-drafts worden zo geschreven mét historische context (eerdere mails, engagements, calls, meetings rond deze klant). Zie nieuwe Stap 3.5. Geen extra API-calls vanuit de skill — query-embedding wordt hergebruikt uit de bestaande deal-master-chunk in `chunks`-tabel.
>
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
- Composio Outlook voor draft-create (`OUTLOOK_LIST_FOLDERS`, `OUTLOOK_CREATE_DRAFT_IN_FOLDER`).
- **Auth & MCP-fallback:** zie [`agent-handbook/references/authentication.md`](../agent-handbook/references/authentication.md) — single source of truth. Decision-tree bepaalt route, skill noemt geen v-route hier.
- Per-skill specifiek (niet door handbook gedicteerd): `composio_connection_id` in `agent_config(sales-followups, ...)` (fallback `agent_config(global, composio_connection_id_outlook)`).
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

## Stap 3.5 — RAG-context per deal (v4 — sinds 2026-05-04)

Voor elke deal die een todo gaat krijgen, haal entity-aware RAG-context op uit
de chunks-tabel. Dat verrijkt de concept-draft met historische cross-source-info
(eerdere mails, engagements/calls/notes/tasks, gerelateerde meetings).

```sql
WITH deal_query AS (
  -- Hergebruik de embedding van de deal-master-chunk zelf als query.
  -- Geen externe embed-call vanuit de skill nodig.
  SELECT embedding FROM chunks
   WHERE source = 'deal' AND source_id = $deal_id
   LIMIT 1
)
SELECT *
  FROM match_chunks_for_entity(
    p_entity_type      := 'deal',
    p_entity_id        := $deal_id,
    p_query_embedding  := (SELECT embedding FROM deal_query),
    p_query_text       := $deal_name,                 -- BM25-query
    p_top_k            := 5,
    p_hop_depth        := 1,
    p_filter_after     := (now() - interval '12 months')::timestamptz,
    p_min_similarity   := 0.3,
    p_recency_weight   := 0.20,
    p_recency_decay_days := 90.0
  );
```

**Skip-condities** (geen RAG, draft toch zonder context):
- Deal-master-chunk bestaat niet (deal te nieuw, nog niet gechunkt) → skip silent.
- Geen hits met `combined_score ≥ 0.3` → skip silent.

**Hoe te gebruiken in de draft-prompt** (combined_score ≥ 0.5 voor harde citaten;
0.3-0.5 voor zachte context-prime):

1. Format relevante hits als citaat-blokken:
   ```
   > Eerder besproken (mail van Veerle, 12-mrt-2026): "kunnen we volgende week..."
   > Engagement op deze deal (call notes, 14-mrt-2026): "klant vraagt om gefaseerde uitrol".
   > Meeting (27-feb-2026, MT): "Veerle akkoord op €X — wachten op contractversie".
   ```
2. Plaats deze blokken **boven** de draft-instructies, onder een sectie-kop
   `## Eerdere context rond deze deal`.
3. Gebruik de context impliciet in de toon — citeer alleen letterlijk wanneer
   zinvol (datums, getallen, expliciete afspraken).

**Telemetrie**: tel per todo `rag_context_used: true|false` en
`rag_top_similarity: <combined_score van top-1>` zodat we acceptance-rate
per RAG-vs-zonder-RAG kunnen meten via R.7 (`rag_outcomes` tabel — autodraft
heeft een trigger; sales-followups schrijft handmatig naar `rag_outcomes` via
`log_rag_outcome` als de draft daadwerkelijk geplaatst is).

## Stap 4 — Schrijf todo + concept-draft

```sql
INSERT INTO sales_todos (
  deal_id, deal_name, contact_email, contact_name,
  todo_type, reason, draft_subject, draft_body,
  status = 'draft_ready', created_at = now()
);
```

Daarna concept-draft in Outlook "Sales Agent"-map via `OUTLOOK_LIST_FOLDERS` + `OUTLOOK_CREATE_DRAFT_IN_FOLDER`. Optioneel: `outlook_draft_id` terug-linken in `sales_todos`.

**Na succesvolle draft-placement** — log RAG-outcome (R.7-instrumentatie):

```sql
SELECT log_rag_outcome(
  p_source_type        := 'sales-followups',
  p_source_id          := $sales_todo_id,
  p_decision_action    := 'draft_placed',
  p_chunks_used        := $rag_chunks_jsonb,         -- [{chunk_id, source, similarity}, ...]
  p_retrieval_strategy := 'match_chunks_for_entity',
  p_retrieval_params   := jsonb_build_object('hop_depth', 1, 'top_k', 5),
  p_outcome            := 'pending'                  -- wordt 'accept' bij send, 'reject' bij ignore — handmatig later
);
```

Skill verstuurt NIETS — Jelle reviewt en klikt zelf send.

## Stap 5 — Run-record (v1-contract — zie agent-handbook/references/logging.md)

```jsonb
{
  "schema_version": "1",                    // STRING "1" — nooit integer
  "skill_version": "sales-followups-v4",
  "mode": null,
  "triggered_by": "<orchestrator|manual>",
  "triggered_at": "<ISO-8601>",
  "passes": [
    { "name": "mirror-fetch",  "ms": <N>, "status": "success" },
    { "name": "mail-check",    "ms": <N>, "status": "success" },
    { "name": "rag-context",   "ms": <N>, "status": "success" },
    { "name": "todo-create",   "ms": <N>, "status": "success" },
    { "name": "draft-place",   "ms": <N>, "status": "success" }
  ],
  "warnings": [],
  "counts": {
    "deals_scanned": <N>,
    "todos_created_total": <N>,
    "todos_offerte_reminder": <N>,
    "todos_trial_einde": <N>,
    "todos_stille_contact": <N>,
    "todos_ovk_geen_reactie": <N>,
    "drafts_placed_in_outlook": <N>,
    "todos_with_rag_context": <N>,
    "todos_skipped_rag_no_chunk": <N>,
    "rag_avg_top_similarity": <float|null>
  },
  "extra": {
    "source": "hubspot_deals mirror + mail_messages + chunks (R.5)",
    "mirror_age_min": <N>,
    "rag_strategy": "match_chunks_for_entity"
  }
}
```

Hard errors horen in `agent_runs.errors[]`, niet in `stats`. **Composio MCP-uitval is
géén hard error** — handbook regelt fallback + welke warning-string in `warnings[]` (zie
auth-pointer Stap 1, sectie 6 logging). Skill-specifieke warnings (niet door handbook
gedicteerd): bij stale mirror (>60 min) voeg `"hubspot_mirror_stale"` toe aan
`warnings[]` zodat de Health-pagina het pikt.

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
