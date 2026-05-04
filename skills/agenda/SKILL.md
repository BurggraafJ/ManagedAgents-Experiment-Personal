---
name: agenda
description: "Centrale agenda-skill voor Jelle Burggraaf — drie hoofdfuncties die met de tijd verbreden. (1) Locatieprognose: dagelijks bepaalt Sonnet per werkdag (4 wk vooruit) waar Jelle is op basis van events, voice-notes en spelregels. Schrijft naar agenda_location_forecast met confidence + intern-flag + reistijd-flag. Max 1 week per run, skip <24u oud. (2) Appointment-matching: bij mails met categorie 'in_te_plannen_afspraak' scant skill agenda + regels en stelt 3 slots voor (fysiek/Teams, verkeer, woensdag-intern, niet-aankomende-week tenzij belangrijk). Schrijft naar agenda_appointment_proposals. (3) Voorstellen-tracking: voorkomt dubbele datumvoorstellen via conversation_id-koppeling, bekijkbaar in Postvak. Trigger op 'agenda', 'forecast', 'datumvoorstel', 'plan afspraak', 'check beschikbaarheid' — of dagelijks 06:30 NL via orchestrator. Trigger NIET voor outlook write-back of het schrijven van mail-drafts."
---

# Agenda — v1

> **Doel.** Eén skill die Jelle's agenda intelligent ondersteunt — locatieprognose, slot-voorstellen voor afspraken, en bijhouden welke datums hij al heeft voorgesteld. De skill verbreedt over tijd; alle agenda-gerelateerde AI-logica woont hier.

## Trigger

| Mode | Cron / signaal |
| --- | --- |
| Dagelijkse locatieprognose | orchestrator `30 6 * * 1-5` (NL werkdagen) |
| Appointment-matching | trigger-based: nieuwe `autodraft_mail` met `category_key='in_te_plannen_afspraak'` |
| Manueel | "draai agenda", "forecast", "plan afspraak voor [persoon]", "datumvoorstel" |

## Scope — drie hoofdfuncties

### 1. Locatieprognose (dagelijks)

Voor elke werkdag van de komende 4 weken:

* Default-locatie uit `agenda_planner_rules` (rule_type=`location_rule`):
  ma/wo/vr → Amsterdam · di/do → Geldermalsen
* Voice-notes overrulen (Jelle's expliciete uitspraken: "die maandag bij klant in [stad]")
* Calendar-events met fysieke locatie matchen tegen `cities_lookup` + bekende NL-steden
* Sonnet 4.6 weegt alles af → JSON output: `{location, confidence, intern_dag, reistijd_nodig, dominante_meeting, waarschuwingen}`
* UPSERT in `agenda_location_forecast` (source='ai')

**Caching:** view `agenda_forecast_freshness` toont per week status (never/partial/stale/fresh). Skill verwerkt **max 1 week per run** — kies eerste niet-fresh week. Token-budget: ~$0.01 per run.

### 2. Appointment-matching (trigger-based)

Wanneer auto-draft een mail classificeert als `category_key='in_te_plannen_afspraak'`:

* Lees mail-context (afzender, subject, body) + eerdere thread-mails
* **Entity-aware context-fetch (sinds v2 — 2026-05-04)**: resolve afzender-email
  via `entity_resolution` naar contact_id (of domain → company_id), pak relevante
  historie via `match_chunks_for_entity`:
  ```sql
  WITH q AS (
    SELECT embedding FROM chunks
     WHERE source = $entity_type AND source_id = $entity_id LIMIT 1
  )
  SELECT * FROM match_chunks_for_entity(
    p_entity_type := $entity_type,           -- 'contact' | 'company'
    p_entity_id   := $entity_id,
    p_query_embedding := (SELECT embedding FROM q),
    p_query_text  := $mail_subject,
    p_top_k := 5,
    p_filter_after := (now() - interval '90 days')::timestamptz,
    p_min_similarity := 0.3,
    p_max_per_source := 2                    -- mix mail / meeting / engagement
  );
  ```
  Gebruik deze context om:
  - **Urgentie-detectie te scherpen**: stilte van >30d + offerte-stage = hoog;
    recent al meeting gehad = standaard niet aankomende week.
  - **Meeting-thema te schrijven** in `notes_ai`: "follow-up op meeting 12-mrt
    over licentieoffertes" ipv "afspraak met X".
  - **Dubbele-afspraak-check**: als er recent (≤7d) al een meeting met deze
    persoon was over hetzelfde onderwerp → flag in `notes_ai` voor Jelle.
* Detecteer:
  - Vraagt afzender om een tijdstip OF deelt afzender een tijdstip ter accordering?
  - Welke meeting-type (klant/intern/partner)?
  - Online (Teams) of fysiek?
  - Bij fysiek: welke stad?
  - Urgentie-niveau (heel belangrijk → mag in aankomende week, anders niet)
* Genereer 3 slot-voorstellen die voldoen aan:
  - Geen meetings vóór 10:00 (rule `no_meetings_before_09`, params.block_end='10:00')
  - Geen meetings na 19:00 (rule `no_meetings_after_18`, params.block_start='19:00')
  - Verkeer-windows 09–10 + 18–19 vermijden tenzij Teams-only
  - Woensdag = intern dag → alleen Teams + heel belangrijk
  - Standaard NIET in aankomende week (te druk) — wel als urgentie='hoog'
  - Reistijd-buffer 60 min voor/na fysieke meeting buiten kantoor-locatie
  - Post-meeting buffer 15 min na meetings ≥90 min
  - Geen overlap met bestaande events
  - Match met `agenda_location_forecast` (Jelle al op die stad → fysieke meeting daar oké)
* Schrijf naar `agenda_appointment_proposals`:
  ```sql
  INSERT INTO agenda_appointment_proposals (
    conversation_id, mail_id, recipient_email,
    proposed_slots, meeting_type_hint, is_online,
    physical_location, urgency_level, status, notes_ai
  ) VALUES (...);
  ```

**Geen mail-draft maken** — alleen voorstellen. Jelle bekijkt en kiest in dashboard.

### 3. Voorstellen-tracking

Bij elke run:

* Check `agenda_appointment_proposals` waar `status='sent'` voor de afgelopen 14 dagen
* Markeer in postvak-context dat er al voorstellen uitstaan voor deze conversation_id
* Bij appointment-matching: skip slots die al in een uitstaand voorstel zitten (geen dubbele voorstellen)
* Status-transitions: `pending` → `sent` (Jelle stuurt mail) → `accepted` (afzender koos slot) of `cancelled`

## Inputs

| Bron | Tabel | Voor wat |
|---|---|---|
| Calendar-events | `calendar_events` (mirror) | Bestaande afspraken |
| Attendees | `calendar_attendees` | Wie is intern/extern/klant |
| Customer-base | `hubspot_customer_emails` | Externe domein → klant detecteren |
| Voice-notes | `agenda_voice_notes` | Jelle's expliciete uitspraken |
| Spelregels | `agenda_planner_rules` | Alle plan-regels |
| Locaties | `cities_lookup` | Steden + clusters |
| Forecast | `agenda_location_forecast` | Eigen output, ook input voor #2 |
| Voorstellen | `agenda_appointment_proposals` | Voorkomt dubbele slots |
| Mails | `autodraft_mails` + `mail_messages` | Mail-context bij appointment-matching |

## Werkwijze per run

1. **Stap 0 — Self-provision**
   * Check rules `location_mon_wed_fri_amsterdam`, `location_tue_thu_geldermalsen`, `traffic_window_18_19`, `post_long_meeting_buffer_15min`, `no_meetings_before_09` (block_end '10:00') → INSERT bij ontbreken
   * Check tabel `agenda_appointment_proposals` bestaat → log naar `agenda_skill_requests` als ontbreekt
   * Check AutoDraft categorie `in_te_plannen_afspraak` bestaat → INSERT bij ontbreken

2. **Stap 1 — Bepaal mode**
   * Manual run met "plan afspraak voor X" → skip naar mode #2 met X als input
   * Trigger uit autodraft_mails (category_key='in_te_plannen_afspraak') → mode #2
   * Anders (cron) → mode #1 (locatieprognose)

3. **Stap 2 — Mode #1 (locatieprognose)**
   * Query `agenda_forecast_freshness` → kies eerste week status≠'fresh'
   * Per dag (5 werkdagen): bouw input-package + AI-call + UPSERT
   * Token-budget: max 5 calls × 600 tokens

4. **Stap 3 — Mode #2 (appointment-matching)**
   * Voor elke pending-mail in scope:
     - Read thread-context (afzender, subject, body, vorige mails)
     - Sonnet 4.6 detecteert: meeting-type, online/fysiek, locatie, urgentie
     - Bouw 3 slot-voorstellen met deterministische slot-finder (geen overlap, regel-conform)
     - Skip slots die in `agenda_appointment_proposals (status='sent')` staan voor dezelfde conversation_id
     - INSERT proposal-rij; status='pending'
   * Token-budget: ~$0.02 per mail (1 detect-call + 1 reasoning-call)

5. **Stap 4 — Voorstellen-tracking refresh**
   * Detect of Jelle's verstuurde mails sinds laatste run een proposal-koppeling hebben → status `pending` → `sent`
   * Detect accepted/cancelled via reply-content + thread-analyse → status update

6. **Stap 5 — agent_runs record schrijven**

## Output: hoe consumers het lezen

| Consumer | Hoe |
|---|---|
| `AgendaView.jsx` | Day-header pills uit `agenda_location_forecast` (source='ai' overrult client-side defaults) |
| Postvak (`AutoDraftView.jsx`) | Voor mails met `category_key='in_te_plannen_afspraak'` toont een toggle "Bekijk voorgestelde slots" → laadt uit `agenda_appointment_proposals WHERE conversation_id = X`. Ook "Bekijk verstuurde datumvoorstellen" voor `status='sent'`. |
| Toekomst F.4 planner | Kan `agenda_appointment_proposals` lezen voor slot-context bij eigen voorstellen |

## Veiligheidsnetten

* **AI-fout** → fallback rule-default met confidence 0.5, source='default'
* **Cancelled events** uitsluiten via `WHERE NOT is_cancelled`
* **Voice-notes** met source='voice' worden alleen overschreven als nieuwe confidence hoger is
* **Geen dubbel-slot**: check `agenda_appointment_proposals (status='sent')` voor de aankomende 30 dagen
* **Token-budget** per run begrensd; bij overschrijding skip restant

## Custom instructions

`agent_config WHERE agent_name='agenda' AND config_key='custom_instructions'` — vrije tekst van Jelle (bv. "Op vrijdag werk ik vanaf 14:00 thuis", "Stuur klant-voorstellen liefst 2 weken vooruit").

## Self-provisioning + code-change-trail

* DB-rules: zie Stap 0
* Frontend-veranderingen: schrijf naar `agenda_skill_requests` (request_type='frontend_change')
* AutoDraft-aanpassingen: schrijf naar `agenda_skill_requests` (request_type='autodraft_integration')

## Eerste run — bootstrap

1. Self-provision (rules + tabel + categorie check)
2. Mode #1: scope = komende week (eerste niet-fresh week)
3. Skip mode #2 als nog geen mails met `category_key='in_te_plannen_afspraak'`

## Niet in scope

⛔ Outlook write-back · ⛔ Mail-drafts schrijven (alleen slot-voorstellen) · ⛔ Andermans agenda · ⛔ Drag-and-drop in agenda · ⛔ Auto-versturen van datumvoorstellen
