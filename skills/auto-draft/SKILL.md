---
name: auto-draft
description: "Schrijft draft-voorstellen voor mails in Jelle's inbox. Leest uit Supabase mail_messages (gevuld door mail-sync), schrijft naar autodraft_mails — verstuurt nooit zelf (dat is auto-draft-execute). Per mail: classificeer audience (for_you/not_for_you), kies categorie, en bij audience=for_you ALTIJD 2 draft-varianten + verplichte target_folder; bij not_for_you suggested_action=skip met target_folder='Archief/Nieuwsbrieven' of 'Archief/Notificaties'. Twee modes: scan (heartbeat */5 6-22) en learn (dagelijks 17:00, distilleer style-regels uit amendments + max 1 categorie-voorstel/dag). Verplichte _diagnose-block in elke run-stats. Trigger op 'check mijn mail', 'scan inbox', 'leer van amendments'. Trigger NIET voor versturen of voor mail-ophalen."
---

# Auto-Draft Skill — v10 (agenda-relevance gate vóór drafting + waiting_agenda status)

> **v10 wijzigingen (2026-05-07):** vóór elke `for_you`-draft beoordeelt Sonnet
> of de mail Jelle's agenda raakt — wacht- of beschikbaarheids-vraag, externe
> afspraak voorstellen, deadline-koppeling. Bij `agenda_relevance.relevant=true`
> draaien we eerst de agenda-check (slot-finder + conflict-check) en zetten
> mail op `status='waiting_agenda'` als de check nog niet klaar is. **Geen
> draft schrijven zonder agenda-zicht** — geen verzonnen datums of toezeggingen.
> Werkt voor ÁLLE categorieën, niet alleen `in_te_plannen_afspraak`.

> **v7 wijzigingen:** geen Outlook-fallback meer (te broos), verplichte
> diagnostische stats per scan-run, elke stap idempotent en losstaand zodat
> één falen niet de hele run sloopt. Reden: v6 had een bug waarbij scan-
> runs "0 nieuwe mails" rapporteerden terwijl 153 mails wachtten in DB.
>
> **Truth-of-source:** `public.mail_messages` (gevuld door mail-sync of een
> ander process). Deze skill schrijft NOOIT naar mail_messages — alleen
> lezen, en schrijven naar `autodraft_mails`/`autodraft_decisions`.

## Heartbeat & mode-selectie

**Cron:** `*/5 6-22 * * *` — elke 5 minuten werktijd, weekend ook.

**Mode-selectie aan begin van run:**

1. Huidig uur (Europe/Amsterdam).
2. **Learn-mode** wordt 1× per dag op 17:00 gedaan:
   - Tussen 17:00-17:59?
   - Geen succesvolle learn-run vandaag in `agent_runs`
     (`agent_name='auto-draft' AND status='success' AND
       stats->>'mode'='learn' AND started_at >= current_date::timestamp
       AT TIME ZONE 'Europe/Amsterdam'`)?
   - Beide ja → `mode = learn`. Anders → `mode = scan`.
3. Manual-override: bij learn-intentie ("leer", "feedback", "categoriseer") → `mode = learn`.

Eén run = één mode.

---

## Mode: SCAN

### Stap 1 — Diagnose (ALTIJD eerst, in elke run)

Voer DEZE drie queries uit en zet de resultaten ALTIJD in `agent_runs.stats`,
ook als de rest van de run faalt of 0 mails verwerkt:

```sql
-- A. Resolve Inbox-folder-id
SELECT id FROM mail_folders WHERE well_known_name = 'inbox' LIMIT 1;
-- → stats.inbox_folder_id (of null)

-- B. Hoeveel inbox-mails zijn er totaal in de DB?
SELECT count(*) FROM mail_messages
 WHERE folder_id = $inbox_folder_id
   AND NOT is_deleted AND NOT is_from_me
   AND received_at >= now() - interval '14 days';
-- → stats.inbox_mails_total

-- C. Hoeveel staan er al in autodraft (= 'al gezien')?
SELECT count(*) FROM autodraft_mails
 WHERE status NOT IN ('stale')
   AND received_at >= now() - interval '14 days';
-- → stats.autodraft_existing
```

**Berekend:** `stats.mails_to_process = inbox_mails_total - <overlap met autodraft>`.

**Hard-fail-checks:**
- `inbox_folder_id IS NULL` → schrijf `agent_runs.status='error'`, summary
  `"Inbox-folder ontbreekt — well_known_name='inbox' niet ingesteld op mail_folders"`,
  STOP de run. (DB-trigger preserve_inbox_well_known_name zou dit moeten voorkomen.)
- `inbox_mails_total = 0` → status='warning', summary
  `"Geen inbox-mails in mail_messages (mail-sync probleem?)"`. Skip naar stale-detect.

### Stap 2 — Lees nieuwe mails uit mail_messages

```sql
SELECT id AS mail_id, conversation_id, received_at,
       from_email, from_name, to_recipients, cc_recipients,
       subject, body_preview, body_html, body_text,
       has_attachments, folder_path, is_read, is_from_me, is_calendar_invite
  FROM mail_messages
 WHERE folder_id = $inbox_folder_id
   AND NOT is_deleted
   AND NOT is_from_me
   AND NOT is_calendar_invite           -- skip Outlook-uitnodigingen (geen draft nodig)
   AND received_at >= now() - interval '14 days'
   AND id NOT IN (
         SELECT mail_id FROM autodraft_mails
          WHERE status NOT IN ('stale')
       )
 ORDER BY received_at DESC
 LIMIT 50;                              -- max 50 per run, voorkomt timeout
```

Schrijf `stats.mails_new = <rij-count>`. Dit is de echte poel.

**GEEN FALLBACK naar Outlook.** Als deze query 0 returned terwijl
`inbox_mails_total > autodraft_existing`, dan is er een filter-mismatch (bv.
is_calendar_invite, of received_at-cutoff). Schrijf dan
`stats.warnings += ["query_returned_zero_despite_backlog"]` zodat dashboard
het ziet, en STOP de run.

### Stap 3 — Stale-detect (Outlook = source-of-truth via mail-sync)

```sql
-- 3a. Mails verplaatst of gewist in Outlook (mail-sync zet is_deleted of moved folder_id)
UPDATE autodraft_mails am
   SET status = 'stale'
  FROM mail_messages mm
 WHERE am.mail_id = mm.id
   AND am.status IN ('pending', 'amended')
   AND (mm.is_deleted = true
        OR mm.folder_id NOT IN (
             SELECT id FROM mail_folders WHERE well_known_name = 'inbox'
           ));

-- 3b. Ghost-rijen — autodraft-row bestaat maar mail_messages-rij is verdwenen
-- (mail-sync heeft 'm hard-delete't, of mail is uit een ander mechanisme weg).
-- Zonder deze pass blijven ze in Postvak staan en jagen ze de "Alle"-teller op.
UPDATE autodraft_mails am
   SET status = 'stale'
 WHERE am.status IN ('pending', 'amended')
   AND NOT EXISTS (
         SELECT 1 FROM mail_messages mm WHERE mm.id = am.mail_id
       );
```

Mails die in Outlook handmatig verplaatst/gewist zijn worden hier
automatisch gestale-d. Dat is goedkoop want we lezen alleen de DB.

Schrijf `stats.stale_marked = <SUM van beide UPDATE-rijen>` zodat we ghost-row-cleanup kunnen monitoren.

### Stap 4 — Folders verversen (vanuit mail-DB)

```sql
DELETE FROM autodraft_folders WHERE folder_id NOT IN (SELECT id FROM mail_folders);

INSERT INTO autodraft_folders (folder_id, display_name, parent_folder_id, full_path, last_seen_at)
SELECT id, display_name, parent_folder_id, full_path, last_seen_at
  FROM mail_folders
ON CONFLICT (folder_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  full_path    = EXCLUDED.full_path,
  last_seen_at = EXCLUDED.last_seen_at;
```

Dashboard's doelmap-dropdown blijft up-to-date.

### Stap 5a — Pas ignore-rules toe (vóór categorisatie!)

Lees actieve regels uit `autodraft_ignore_rules` waar `active=true`.

Voor elke mail uit stap 2: check tegen elke rule:
- `pattern_type='domain'`: match als `lower(from_email)` eindigt op `'@' || pattern_value`
- `pattern_type='sender'`: match als `lower(from_email) = pattern_value`
- `pattern_type='subject_keyword'`: match als `lower(subject) ILIKE '%' || pattern_value || '%'`
- `pattern_type='category'`: match als gekozen `category_key = pattern_value` (na stap 5b)

Match? Dan:
1. `audience='not_for_you'`, `suggested_action='skip'`, `target_folder='Archief/Notificaties'`
2. `category_key='notificatie'`
3. Increment hits + last_hit_at:
   ```sql
   UPDATE autodraft_ignore_rules
      SET hits = hits + 1, last_hit_at = now()
    WHERE id = $rule_id;
   ```
4. `confidence=0.95` (gebruiker heeft dit zelf geleerd)
5. `suggested_reasoning = 'Geleerd: ' || rule.reason || ' (regel uit ' || rule.created_at::date || ')'`

Sla stap 6+7 over voor deze mail (geen draft, geen audience-heroverweging).

### Stap 5b — Categoriseren

Voor mails die NIET door een ignore-rule zijn afgevangen:

**Kies categorie uit `autodraft_categories` (active=true).**

Beslissingsbasis:
1. **Style-lessons** met scope=`domain` of `sender` voor afzender-domein/email — zwaarst gewogen.
2. **Domein-mapping**: bekende klant-domeinen → klant_customer_base, etc.
3. **Subject-keywords** vergelijken met `category.description` + `handling_instructions`.
4. **Thread-context**: query mail_messages voor andere mails met dezelfde `conversation_id` om eerdere replies te zien.
5. **HubSpot-context**: als `from_email` in `agent_proposals` voorkomt, gebruik die deal-stage om te kiezen tussen klant_sales_lead, klant_sales_opvolging, klant_pilot, klant_customer_base.

Geen match (alle <0.3 confidence)? → `category_key='onbekend'`.

### Stap 6 — Audience bepalen

Default = `category.default_audience`. Override op afzender-context:
- Mail expliciet aan Jelle gericht of vraagt iets van hem → `'for_you'`
- Bulk/marketing/notification met geen menselijke afzender → `'not_for_you'`
- Recruiter-spam, cold sales pitches → `'not_for_you'`
- Twijfel → `'for_you'` (better safe).

**Hard-fail-checks audience='not_for_you':**
- afzender-localpart matcht `^(no-?reply|noreply|notifications?|bounce|do-?not-?reply|team|news|newsletter|marketing|welcome|onboarding|info|hello|help|support|security|privacy|feedback|digest|alerts?|automated|system)@`
- afzender-domein in: uber.com, ubereats.*, spotify.com, github.com, gitlab.com, slack.com, supabase.com, cursor.com, mail.cursor.com, email.openai.com, attiomail.com, mail.moonlit.ai, notifications.hubspot.com, email.hubspot.com, azure-noreply.com, mail.notion.so, mail.figma.com, mail.atlassian.net, mail.databricks.com, mail.linear.app, mailer.linkedin.com, mail.linkedin.com, noreply.github.com, invite.zoom.us
- Subdomein van een van bovenstaande (eindigt op `.<domain>`).
Als één van deze hits → `audience='not_for_you'` ALTIJD, ongeacht andere context.

### Stap 6b — RAG-context lezen (R.2 — sinds 2026-05-03)

Voor elke mail die in stap 6 audience='for_you' kreeg, lees vóór het draft-schrijven
het pre-computed `autodraft_mails.rag_context` veld (jsonb, gevuld door
`autodraft-rag-prefill` Edge Function — cron */3 min).

```sql
SELECT rag_context
  FROM autodraft_mails
 WHERE mail_id = $current_mail_id
 LIMIT 1;
```

`rag_context.matches[]` bevat tot 5 verwante chunks uit het hele archief
(mail, engagement, jira, deal, company, contact, meeting, event, lesson) —
gevonden via een **hybrid retrieval-pipeline** (R.4 + R.5, sinds 2026-05-04):

1. **Semantic pass** (`match_chunks`): vector + BM25 + RRF + recency-decay over de chunks-tabel.
2. **Entity-aware pass** (`match_chunks_for_entity`, alleen als `mail.from_email` of
   `mail.from_domain` resolveert via `entity_resolution`): zelfde retrieval maar
   gefilterd op chunks die 1-hop verbonden zijn met de afzender's contact/company.

Beide passes worden gemerged + gededupliceerd op chunk_id. Per match staat
`source_strategy: 'semantic' | 'entity'` zodat je weet via welk pad hij gevonden is.

**Extra metadata in `rag_context`** (voor telemetry/inspectie, niet voor draft-prompt):
- `retrieval_strategy`: `'match_chunks'` of `'match_chunks+match_chunks_for_entity'`
- `entity_used`: `{type, id, via, confidence}` of `null` als geen entity gevonden
- `passes`: `{semantic_n, entity_n}` — hoeveel hits per pass

**Hoe te gebruiken in de draft-prompt** (pas alleen toe bij `similarity ≥ 0.6`):

1. Format elke relevante match als citaat-block:
   ```
   > Eerder besproken (mail van Veerle, 12-mrt-2026): "kunnen we volgende week..."
   > Eerder besproken (deal "Houthoff trial", stage Demo): bedrag €X.XXX, status...
   > Eerder besproken (meeting "MT 14-mrt"): Veerle vroeg naar prijspositionering.
   ```
2. Plaats deze blokken **boven** de draft-instructies in de Claude API-call,
   onder een sectie-kop `## Eerdere context uit jullie geschiedenis`.
3. Gebruik de context impliciet in de toon (geen letterlijk citaat in de draft
   tenzij specifiek relevant — vermijd "zoals besproken op X" tenzij je dat
   echt zou zeggen).

**Threshold**: `similarity ≥ 0.6` (legacy field-name — is in werkelijkheid `combined_score`
uit hybrid retrieval). Onder die drempel is de match meestal ruis. Als alle matches
onder 0.6 zitten, draft je zonder context.

**Fallback**: als `rag_context IS NULL` (prefill nog niet gedraaid voor deze mail),
draft zonder context. Niet zelf een retrieval-RPC aanroepen — de prefill-pipeline
is owner van de retrieval-strategie.

**Telemetrie**: schrijf `stats.rag_context_used = true|false` per mail,
`stats.rag_top_similarity = <hoogste similarity in matches>`, en
`stats.rag_strategy = <rag_context.retrieval_strategy>` zodat we semantic-only
vs entity-aware kunnen vergelijken in acceptance-rate over tijd.

**Bundle-link voor RagBadge** (sinds 2026-05-06): wanneer `rag_context.bundle_id`
aanwezig is (door `autodraft-rag-prefill` v6+ of een directe context-build call),
schrijf hem ÓÓK naar de kolom `autodraft_mails.context_bundle_id`. Dat is een
directe FK naar `context_bundles` zodat de RagBadge in Postvak per mail kan
laten zien welke chunks zijn opgehaald + klikken voor details.

```sql
UPDATE autodraft_mails
   SET context_bundle_id = (rag_context->>'bundle_id')::uuid
 WHERE id = $current_autodraft_mail_id
   AND rag_context ? 'bundle_id'
   AND context_bundle_id IS NULL;
```

Doe dit altijd direct na Stap 6b — niet tijdens write-out in Stap 8. Reden: de
RagBadge moet ook werken voor mails die de skill ZONDER nieuwe draft heeft
verwerkt (bv. via lesson-only path).

### Stap 6b-2 — Agenda-relevantie detecteren (sinds 2026-05-07 — v10)

**Wanneer:** elke mail met `audience='for_you'` waarvoor `agenda_relevance` nog
NULL is. Skip bij `not_for_you` of als `agenda_relevance` al gevuld is door een
eerdere run.

**Doel:** vóór drafting beoordelen of een reply-draft Jelle's agenda nodig heeft.
Dat overruled de category-keuze — een interne mail (`category='intern'`) die om
een meeting vraagt OF om beschikbaarheid voor een deadline, MOET ook agenda-zicht
hebben vóór de draft. Voorkomt verzonnen datums of toezeggingen.

**Roep Sonnet 4.6 aan** met deze prompt:

```
Je bent een agenda-relevantie-detector voor inkomende mails. Lees de mail en
bepaal: moet een goede reply Jelle's agenda raadplegen voordat hij verstuurd wordt?

JA (relevant=true) wanneer de mail:
- vraagt om een afspraak, meeting of telefoongesprek (extern of intern)
- vraagt naar Jelle's beschikbaarheid op specifieke dagen/data
- voorstelt een datum/tijd voor een actie waarvan Jelle's aanwezigheid nodig is
- bevat een deadline waarop Jelle moet leveren / verschijnen
- vraagt om een "korte sync" / "overleggen" / "agenda inkijken"
- noemt agenda-overleg ("agenda CS-meeting", "wanneer past het")

NEE (relevant=false) bij:
- pure informatieve mails (newsletters, updates, notificaties)
- vraag om documentatie/info zonder tijdsdimensie
- afgeronde acties of bevestigingen
- discussies zonder agenda-implicatie

Output exact dit JSON-formaat (geen extra tekst):
{
  "relevant": true | false,
  "reason": "korte uitleg waarom",
  "confidence": 0.0-1.0,
  "request_type": "meeting_request" | "availability_check" | "deadline" | "none",
  "suggested_range_start": "ISO-8601-date | null",
  "suggested_range_end": "ISO-8601-date | null",
  "duration_minutes_hint": <int | null>
}

Mail-context:
Onderwerp: {{subject}}
Van: {{from_name}} <{{from_email}}>
Categorie (door auto-draft gekozen): {{category_key}}
Body:
{{body_text_or_preview}}
```

**Schrijf direct naar autodraft_mails.agenda_relevance** (jsonb) na de call:

```sql
UPDATE autodraft_mails
   SET agenda_relevance = jsonb_build_object(
         'relevant', $relevant,
         'reason', $reason,
         'confidence', $confidence,
         'request_type', $request_type,
         'suggested_range_start', $range_start,
         'suggested_range_end', $range_end,
         'duration_minutes_hint', $duration,
         'detected_at', now()::text,
         'model', 'sonnet-4-6'
       )
 WHERE mail_id = $current_mail_id;
```

**Als `relevant=true` EN `agenda_check_result` is NULL:**

1. Roep `find_agenda_slots_for_request` aan met de hint-range (fallback: vandaag+4 t/m +14 dagen)
   en duration uit de detectie (default 60 min):

   ```sql
   SELECT public.find_agenda_slots_for_request(
     greatest(current_date + 4, COALESCE($range_start, current_date + 4))::date,
     COALESCE($range_end, (current_date + 14))::date,
     COALESCE($duration_minutes_hint, 60),
     3, true, 10, 17, true
   );
   ```

2. Schrijf het resultaat naar `agenda_check_result` zodat de RagDetailsModal het toont:

   ```sql
   UPDATE autodraft_mails
      SET agenda_check_result = jsonb_build_object(
            'checked_at', now()::text,
            'verdict', CASE WHEN slot_count > 0 THEN 'ok' ELSE 'no_slots' END,
            'available_slots', slots,
            'slot_count', slot_count,
            'reason', 'pre_draft_relevance_check',
            'triggered_by', 'agenda_relevance.relevant=true'
          )
    WHERE mail_id = $current_mail_id;
   ```

3. **Als slot-finder geen slots oplevert (`slot_count=0`)** OF de Sonnet-call faalt:
   zet mail op `status='waiting_agenda'`, schrijf `suggested_action='waiting_agenda'`,
   `target_folder=category.default_target_folder` (of `Inbox`), GEEN draft_variants.
   Mail blijft uit Postvak's draft-tabblad totdat agenda gecheckt is in volgende run.

4. **Als slots gevonden:** ga door naar Stap 7 met de slots als input voor de
   draft (zelfde patroon als Stap 7 pre/in_te_plannen_afspraak — gebruik slots
   LETTERLIJK, geen LLM-verzonnen datums).

**Als `relevant=false`:** ga normaal door naar Stap 7. Geen agenda-call nodig.

**Telemetrie:**
* `stats.counts.agenda_relevance_checked` += 1 per Sonnet-call
* `stats.counts.agenda_relevance_true` += 1 per `relevant=true`
* `stats.counts.waiting_agenda_set` += 1 per mail die op die status komt

**Tokenkost:** ~600 input + ~120 output tokens per for_you-mail ≈ $0.004 per call.
~50 for_you-mails/dag = $0.20/dag = $6/mnd. Acceptabel.

### Stap 6c — JelleMind-lessons consumeren (sinds 2026-05-04 — JelleMind Activation)

Naast `rag_context.matches[]` bevat `rag_context.knowledge_lessons[]` tot 3
JelleMind-lessons die semantisch passen bij de mail-query, gefilterd op de
voor het `draft_reply` intent ingestelde mind_scopes (`jelle` + `skill` —
toon-voorkeuren plus procesregels). Komen direct uit `context-build` v1.2.

**Hoe te gebruiken in de draft-prompt**: format ze in een aparte sectie
**boven** de instructie-block:

> ## Toepasselijke regels uit JelleMind
>
> - **[skill]** Voor proposal: eerst mail-historie + HubSpot + KvK checken
> - **[jelle]** Jelle gebruikt 'je' i.p.v. 'u', ook bij eerste contact

Als `knowledge_lessons` leeg of niet aanwezig is → laat de hele sectie weg.
Geen fallback-tekst, geen waarschuwing in de draft. Beschouw lessons als
hardere regels dan `matches` (similarity-drempel was al 0.40 op DB-niveau).

**Telemetrie**: tel `stats.lessons_in_prompt += knowledge_lessons.length` per
mail zodat we kunnen meten of lessons écht in de prompt landen.

### Stap 6d — Datumvoorstel-reply detectie (sinds 2026-05-05 — F.3.a)

**Doel:** detecteren of een inkomende reply een gemaakt datumvoorstel
**accepteert**, **afwijst**, of **counter-voorstelt**. Bij accept worden de
andere slots vrijgegeven zodat de agenda-skill ze opnieuw mag aanbieden aan
iemand anders.

**Pre-check** — alleen draaien voor mails met audience='for_you' EN waar een
open proposal voor de conversation_id bestaat:

```sql
SELECT id, proposed_slots, sent_at, expires_at, accepted_slot_index, released_slot_indices
  FROM agenda_appointment_proposals
 WHERE conversation_id = $mail.conversation_id
   AND status IN ('sent','accepted')
   AND (expires_at IS NULL OR expires_at > now())
   AND proposed_by = 'jelle'
 ORDER BY sent_at DESC
 LIMIT 1;
```

Geen rij → skip deze stap.

**Match → roep Sonnet 4.6 aan met deze prompt:**

```
Je bent een datum-acceptatie-detector. Jelle stelde eerder deze datum-tijdslots voor:
{{proposed_slots als nummerde lijst — bv. "Slot 0: vr 8 mei 14:00-15:00, Slot 1: ma 11 mei 10:00-11:00, ..."}}

Lees de incoming reply en bepaal:
- "accept" — recipient kiest expliciet één slot. Geef slot_index (0-based).
- "reject" — recipient zegt "geen van deze past" of stelt nieuwe datums voor zonder een gepresenteerde te kiezen.
- "counter" — recipient stelt nieuwe datums voor (kan met of zonder afwijzing van bestaande).
- "unclear" — geen duidelijk signaal over de datums.

Output exact dit JSON-formaat (geen extra tekst):
{
  "verdict": "accept" | "reject" | "counter" | "unclear",
  "accepted_slot_index": null | <int>,
  "counter_slots": [
    { "start": "ISO-8601", "end": "ISO-8601", "verbatim": "wat letterlijk in tekst stond" }
  ],
  "confidence": 0.0-1.0,
  "reasoning": "kort waarom"
}

counter_slots is leeg bij accept. Bij reject zonder counter ook leeg.

Reply-body:
{{mail.body_text}}
```

**Update reservering** o.b.v. verdict (alleen bij `confidence ≥ 0.7`):

* **accept** —
  ```sql
  UPDATE agenda_appointment_proposals
     SET status = 'accepted',
         accepted_at = now(),
         accepted_slot_index = $idx,
         released_slot_indices = (
           SELECT array_agg(i)
             FROM generate_series(0, jsonb_array_length(proposed_slots) - 1) AS i
            WHERE i <> $idx
         )
   WHERE id = $proposal_id;
  ```
* **reject** —
  ```sql
  UPDATE agenda_appointment_proposals
     SET status = 'cancelled',
         cancelled_at = now(),
         released_slot_indices = (
           SELECT array_agg(i)
             FROM generate_series(0, jsonb_array_length(proposed_slots) - 1) AS i
         )
   WHERE id = $proposal_id;
  ```
* **counter** — laat originele rij staan (status blijft 'sent' tot Jelle reageert),
  INSERT nieuwe rij met `proposed_by='recipient'`, `source='auto-draft-incoming'`,
  `proposed_slots=$counter_slots`, `expires_at=now()+'14d'`.
* **unclear** — geen DB-write. Voeg `"unclear_date_response_for_<conv_id>"` toe aan
  `stats.warnings[]` zodat Jelle weet dat hij handmatig moet beoordelen.

**Telemetrie:**
* `stats.counts.date_replies_accepted` += 1 per accept
* `stats.counts.date_replies_rejected` += 1 per reject
* `stats.counts.date_replies_counter` += 1 per counter

**Schrijf detectie-uitkomst naar `autodraft_mails.rag_context.date_reply_detection`**
zodat de drafter (stap 7) er gebruik van kan maken:

```jsonb
{
  "date_reply_detection": {
    "verdict": "accept",
    "accepted_slot": { "start": "...", "end": "...", "verbatim": "..." },
    "counter_slots": [],
    "proposal_id": "<uuid>"
  }
}
```

### Stap 7 (pre) — Categorie-voorkeuren ophalen (sinds 2026-05-06 — F.5.e)

**Voor ELKE for_you-mail:** lees `category_preferences` rijen die op deze
mail van toepassing zijn. Format ze als bullets in het draft-prompt onder
het kopje "Toepasselijke voorkeuren":

```sql
SELECT scope_type, scope_value, preference_text
  FROM public.category_preferences
 WHERE active = true
   AND (
        (scope_type = 'global')
     OR (scope_type = 'mail_category' AND scope_value = $category_key)
     OR (scope_type = 'draft_tone')   -- alle tone-voorkeuren; matcht per variant
       )
 ORDER BY scope_type, created_at DESC
 LIMIT 50;
```

Bij het schrijven van elke variant: filter de `draft_tone` rijen op de tone
van die variant (`concise`/`warm`/`done`/`formal`/`casual`). De andere twee
scopes (`mail_category` en `global`) gelden voor alle varianten.

Telemetrie: `stats.counts.preferences_in_prompt += <aantal toegepaste rijen>`.

### Stap 7 (pre/in_te_plannen_afspraak) — Agenda VERPLICHT raadplegen (sinds 2026-05-06 — F.5.e)

**Wanneer:** category_key = `'in_te_plannen_afspraak'` EN audience = `'for_you'`.

**Doel:** geen verzonnen datums meer in varianten. Roep de RPC aan, gebruik
de teruggegeven slots LETTERLIJK in variant-3 ("Afgerond, concrete data") en
ALS bron voor variant-2 ("Warm & uitgebreid"). Schrijf óók een rij in
`agenda_appointment_proposals` met `proposed_by='jelle'`, `source='auto-draft-prefilled'`
zodat het Postvak ze toont en andere skills weten dat deze tijden gereserveerd zijn.

```sql
SELECT public.find_agenda_slots_for_request(
  /* range_start */ greatest(current_date + 4, $sender_requested_start)::date,
  /* range_end   */ $sender_requested_end::date,            -- valt terug op range_start + 14d
  /* duration    */ coalesce($estimated_minutes, 60),
  /* n_slots     */ 3,
  /* skip_wed    */ true,                                     -- Jelle's intern-dag
  /* earliest    */ 10,
  /* latest      */ 17,
  /* lunch       */ true
);
```

Verwerk het resultaat:

* **`slot_count = 3`**: gebruik alle drie de slots in variant-3 als bullet-list.
  Ook variant-2 noemt minstens één van deze slots concreet ("vrijdag 22 mei
  is voor mij ruim — past dat?").
* **`slot_count = 1 of 2`**: schrijf eerlijk in variant-3 dat er weinig vrij is
  ("Op { {slots[0].label} } heb ik nog ruimte; voor de rest van die periode loopt
  het vol — kun jij anders { {alternatief: range +1 week} } aanleveren?"). Variant-2
  noemt zelfde slot.
* **`slot_count = 0`**: GEEN datums in variant-2 of variant-3. Variant-3 vervalt
  óf wordt een eerlijke "Mijn agenda is dicht in deze range — kun je { {nieuwe range} }
  proberen?". Schrijf de reden in `suggested_reasoning`. NOOIT terugvallen op
  LLM-verzonnen data.

**Reservering schrijven** (alleen als `slot_count >= 1`):

```sql
INSERT INTO public.agenda_appointment_proposals (
  conversation_id, mail_id, recipient_email, recipient_name,
  subject_context, proposed_slots, urgency_level, status,
  source, proposed_by, sent_at, expires_at, notes_ai
) VALUES (
  $conv_id, $mail_id, $sender_email, $sender_name,
  $subject_first_60, $slots_jsonb,                      -- direct uit RPC.slots
  'normaal', 'pending',
  'auto-draft-prefilled', 'jelle', NULL,
  now() + interval '14 days',
  'Pre-filled door auto-draft op basis van find_agenda_slots_for_request (F.5.e).'
)
ON CONFLICT (conversation_id) DO UPDATE
  SET proposed_slots = EXCLUDED.proposed_slots,
      sent_at = now()
WHERE agenda_appointment_proposals.status = 'pending'
   OR agenda_appointment_proposals.status = 'cancelled';
```

> **Status-keuze:** `pending` (niet `sent`) totdat Jelle daadwerkelijk de draft
> verstuurt — dan zet `auto-draft-execute` (date-extractie pass) hem op `sent`.
> Zo blokkeren we niet onnodig slots in andere conversaties als Jelle deze
> draft uiteindelijk verwerpt.

### Stap 7 — Draft schrijven (TWEE varianten per draft-mail)

**HARDE VEILIGHEIDSREGEL — agenda-gate (sinds v10, 2026-05-07):**
Als `agenda_relevance.relevant=true` EN `agenda_check_result` is `NULL` of
ontbreekt `available_slots`: STOP hier. Schrijf `suggested_action='waiting_agenda'`,
`status='waiting_agenda'`, `draft_variants=[]`, `confidence=0.0`,
`suggested_reasoning='Wacht op agenda-check (' || agenda_relevance.reason || ')'`.
Geen verzonnen data, geen draft. De volgende run probeert opnieuw zodra
agenda-data beschikbaar is.

**HARDE REGEL — for_you = altijd draft + target_folder:**
- Bij `audience='for_you'`: ALTIJD `suggested_action='draft'` (NIET skip),
  ALTIJD twee varianten in `draft_variants`, EN ALTIJD een ingevulde
  `target_folder`. Val terug op `category.default_target_folder`, of als die
  ook leeg is op `'Inbox'`. Geen for_you-mail mag zonder draft of zonder map
  de DB in.
- Bij `audience='not_for_you'`: `suggested_action='skip'`, geen draft,
  `target_folder = 'Archive'` (algemeen archief, bestaande Outlook-map).

**HARDE REGEL — `target_folder` MOET een bestaand `mail_folders.full_path` zijn (sinds F.5.b, 2026-05-06):**
- Verzin geen mappen ("Aandeelhouders", "Sales/Leads", "Intern" — die bestaan
  NIET in Jelle's Outlook). Kies altijd uit de echte mappen die in
  `mail_folders` staan.
- DB-trigger `_normalize_autodraft_target_folder` vangt fouten op (resolved
  via `validate_target_folder` of fallback `Inbox`), maar dat is een
  vangnet — schrijf de **eerste keer al** een correcte string.
- Vóór UPSERT, check je waarde:
  ```sql
  SELECT public.validate_target_folder($candidate);  -- returns geldig pad of NULL
  ```
  NULL? → fallback naar `category.default_target_folder` (al gevalideerd) of `Inbox`.
- Voor sub-folders: gebruik altijd de volle `Inbox/...` of `Inbox/General Storage/...`-paden,
  niet "Sales" of "Klanten" zonder prefix.

Voor mails met `category.default_action = 'draft'`: schrijf **twee
verschillende drafts** in `draft_variants` jsonb-array.

Lees eerst:
- `category.handling_instructions` (verplicht)
- `agent_config.auto-draft.custom_instructions.text` (globale richtlijnen)
- `autodraft_style_lessons` met scope `global` / `category=this` / `domain=sender_domain` / `sender=from_email`
- **`category_preferences` (sinds F.5.e, 2026-05-06)** — alle actieve rijen
  uit stap 7 (pre); voeg ze toe in een aparte sectie boven de instructies:

  > ## Toepasselijke voorkeuren (van Jelle)
  >
  > **Voor categorie `<label>`:**
  > - {voorkeur 1}
  > - {voorkeur 2}
  >
  > **Globaal:**
  > - {voorkeur globaal 1}
  >
  > **Voor tone "warm":** (alleen tonen bij variant met `tone='warm'`)
  > - {tone-specifieke voorkeur}

  Voorkeuren > stijl-lessons > category-instructions in prioriteit als ze
  conflicteren — Jelle's directe input is altijd leidend.

- **Voor `in_te_plannen_afspraak`-mails:** de slots uit
  `find_agenda_slots_for_request` (stap 7 pre) zijn LETTERLIJKE input voor
  variant-3 — niet alleen "context", maar de te gebruiken datums.

```jsonb
[
  {
    "label": "Kort & direct",
    "subject": "RE: ...",
    "body": "Hoi X,\n\n...kort, 3-4 zinnen...\n\nVriendelijke groet,\nJelle",
    "tone": "concise"
  },
  {
    "label": "Warm & uitgebreid",
    "subject": "RE: ...",
    "body": "Hoi X,\n\n...erkennen + context + voorstel + open vraag...\n\nVriendelijke groet,\nJelle",
    "tone": "warm"
  }
]
```

Goede label-paren (kies 2 die het meest verschillend zijn):
- "Kort & direct" / "Warm & uitgebreid"
- "Formeel" / "Informeel"

**3e variant — "Afgerond" / "Het is gebeurd":**
Schrijf een 3e variant ALS de mail om een actie/verzoek vraagt waarvan
plausibel is dat Jelle het al gedaan heeft, of dat hij het kort kan
afronden. Voorbeelden:
- "Kun je login X in Bitwarden zetten?" → "Done, staat in Bitwarden onder
  vault-naam Y."
- "Stuur even het document door" → "Bijgevoegd / link in deze mail."
- "Ben je akkoord?" → "Ja prima, ga ervoor."

Het uitgangspunt is dat Jelle zijn werk **af wil maken**, niet uitstellen.
Schrijf in stelt-direct stijl: "Het is gebeurd." / "Done." / "Afgerond." +
korte verwijzing waar/hoe. Geen "ik ga het later doen"-formulering.

Skip deze 3e variant alleen als de mail puur informatief is, of een vraag
om mening/discussie waarop "afgerond" niet past — dan blijft het bij 2.

**Datumvoorstel-context (sinds 2026-05-05 — F.3.b):**
Als `rag_context.date_reply_detection` aanwezig is (gevuld in stap 6d), pas
dan deze schrijf-strategie toe op de varianten:

* **verdict='accept'** — recipient koos slot. Schrijf variant 0 als
  bevestiging: "Top, dan zie/spreek ik je op {{accepted_slot.verbatim}}."
  Vermeld **één** keer expliciet de gekozen datum/tijd zodat de mail-thread
  hem als bevestiging vasthoudt. Voeg eventueel agenda-uitnodiging-aanbod
  toe als variant 1 ("Zal ik een Teams-uitnodiging sturen?").
* **verdict='counter'** — recipient stelt nieuwe datums voor. Schrijf
  variant 0 als korte acknowledgement + ja-of-nee op de eerste counter-slot
  ("Maandag 10:00 lukt — zal ik die vasthouden?"). Variant 1 als alternatief
  voorstel als de counter-slots niet handig zijn ("Maandag 10:00 lukt me niet,
  wat dacht je van dinsdag 14:00?").
* **verdict='reject'** — recipient wijst af zonder counter. Schrijf variant 0
  als verkenning ("Geen probleem, wat zou wel passen voor jou?") en variant 1
  als nieuw concreet voorstel met andere data (laat de drafter rekening houden
  met al-gereserveerde slots in andere conversation_ids — zie agenda mode #2).
* **verdict='unclear'** — voeg een waarschuwing toe in `suggested_reasoning`
  ("Onduidelijk of een datum gekozen is — even handmatig checken") en schrijf
  varianten zonder datum-aannames.

Vul ook `draft_subject = variants[0].subject`, `draft_body = variants[0].body`,
`selected_variant_index = 0`.

**⚠️ NOOIT concat-tekst in `draft_body`!**
Pre-v5.4 schreven sommige runs alle varianten samen in `draft_body` met
markers als `Optie 1 (warm):` ... `---` ... `Optie 2 (formeel):`. Dat moet
echt niet meer. Dashboard verwacht losse varianten in `draft_variants`
zodat Jelle ze met ←/→ door kan bladeren. Concat-tekst maakt dat onmogelijk.

Als helper voor backwards-fix bestaat de DB-functie `split_concatenated_drafts(body, subject)`
maar zie dat als noodgreep — schrijf nooit zelf concat.

Voor `'skip'` of `'flag'`: geen draft, alleen `suggested_action` + `suggested_reasoning`.

### Stap 7b — Agenda-check op draft-datums (sinds 2026-05-06 — F.4.b)

**Doel:** vóór Jelle send klikt al een groen/rood vinkje tonen in Postvak —
"deze datums passen in je agenda" / "deze datums geven een conflict".
Voorkomt dat hij een draft verstuurt met datum die overlapt met bestaande
afspraak, planner-regel (woensdag-intern, vóór 10:00, na 19:00) of
uitstaande reservering aan iemand anders.

**Regex pre-check** (zelfde patroon als auto-draft-execute F.2.b):

```typescript
const DATE_HINT_RE = new RegExp([
  '\\b(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\\b',
  '\\b\\d{1,2}\\s*(jan|feb|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec)',
  '\\b\\d{1,2}[-/]\\d{1,2}([-/]\\d{2,4})?\\b',
  '\\b\\d{1,2}[:.]\\d{2}\\b',
  '\\b(volgende week|aanstaande|aankomende|morgen|overmorgen|vandaag)\\b',
].join('|'), 'i');
```

Geen regex-match in `variants[0].body` → schrijf
`agenda_check_result = { verdict: 'not_checked', slots_in_draft: [], reason: 'no_date_hints' }`
en sla LLM-extractie over.

**Match → roep Sonnet 4.6 aan met dezelfde extractie-prompt als F.2.b**
(uit `auto-draft-execute` SKILL — zie sectie "Date-slot extractie").
Drempel `confidence ≥ 0.7` per slot.

**Geen slots boven drempel** → schrijf
`agenda_check_result = { verdict: 'not_checked', slots_in_draft: [], reason: 'no_high_confidence_slots' }`.

**≥1 slot** → roep `check_slots_against_agenda` RPC aan:

```sql
SELECT public.check_slots_against_agenda(
  $extracted_slots::jsonb,         -- [{start, end, ...}]
  $current_conv_id::text           -- mag null zijn
);
```

Schrijf het volledige RPC-resultaat naar `autodraft_mails.agenda_check_result`,
verrijkt met de geëxtraheerde slots zodat Postvak ze kan tonen:

```jsonb
{
  "checked_at": "<ISO-8601>",
  "slots_in_draft": [
    { "start": "...", "end": "...", "verbatim": "...", "confidence": 0.85 }
  ],
  "verdict": "ok" | "conflict" | "not_checked",
  "conflicts": [
    { "slot_index": 0, "reason": "calendar_overlap", "detail": "..." }
  ],
  "reason": "<optioneel — alleen bij not_checked: no_date_hints | no_high_confidence_slots>"
}
```

**Telemetrie:**
* `stats.counts.agenda_check_ok` += 1 per `verdict='ok'`
* `stats.counts.agenda_check_conflict` += 1 per `verdict='conflict'`

**Skip deze stap** als:
* `audience='not_for_you'` of `suggested_action ∈ ('skip','flag')`
* `draft_variants` is leeg of `variants[0].body` is leeg
* Mail heeft al `agenda_check_result` met `checked_at >= updated_at` van de mail
  (geen onnodige re-check als de draft niet veranderd is)

### Stap 8 — UPSERT naar autodraft_mails

```sql
INSERT INTO autodraft_mails (
  mail_id, conversation_id, received_at,
  from_email, from_name, to_recipients, cc_recipients,
  subject, body_preview, body_html, body_text,    -- kopieer uit mail_messages voor backwards compat
  has_attachments,
  category_key, audience,
  draft_variants, draft_subject, draft_body, selected_variant_index,
  suggested_action, suggested_reasoning, confidence, target_folder,
  current_folder_name,
  scanned_at, skill_version, run_id, status
)
VALUES (...)
ON CONFLICT (mail_id) DO UPDATE SET
  -- alleen kolommen updaten die kunnen veranderen, en alleen als status='pending'
  ...
```

### Stap 9 — Run-record (v1-contract — zie agent-handbook/references/logging.md)

```jsonb
{
  "schema_version": "1",                    // STRING "1" — nooit integer
  "skill_version": "auto-draft-v9",
  "mode": "scan",
  "triggered_by": "<orchestrator|manual_run_request|user-button>",
  "triggered_at": "<ISO-8601>",
  "passes": [
    { "name": "diagnose",       "ms": <N>, "status": "success" },
    { "name": "fetch-mails",    "ms": <N>, "status": "success" },
    { "name": "stale-detect",   "ms": <N>, "status": "success" },
    { "name": "folder-sync",    "ms": <N>, "status": "success" },
    { "name": "classify-draft", "ms": <N>, "status": "success" }
  ],
  "warnings": ["<soft-issue codes, mag leeg [] zijn>"],
  "counts": {
    "mails_new": <N>,
    "mails_drafted": <N>,
    "mails_skip_suggested": <N>,
    "mails_flagged": <N>,
    "stale_marked": <N>,
    "folders_synced": <N>,
    "date_replies_accepted": <N>,
    "date_replies_rejected": <N>,
    "date_replies_counter": <N>,
    "agenda_check_ok": <N>,
    "agenda_check_conflict": <N>
  },
  "extra": {
    "source": "mail_messages",
    "_diagnose": {
      "inbox_folder_id": "<text|null>",
      "inbox_mails_total": <N>,
      "autodraft_existing": <N>,
      "mails_to_process": <N>
    }
  }
}
```

**Belangrijk:** `extra._diagnose` blok ALTIJD vullen, ook bij 0 nieuwe mails.
Dat is hoe v6 dichtgetimmerd raakte zonder dat we 't zagen. Hard errors (niet
soft warnings) horen in `agent_runs.errors[]` als
`[{"severity":"error","code":"<code>","message":"<text>","context":{}}]`.

### Wat scan-mode NIET doet
- ❌ Composio-call naar Outlook (tenzij fallback bij lege mail_messages)
- ❌ Outlook-draft aanmaken
- ❌ Mails verplaatsen of als gelezen markeren
- ❌ Categorie-voorstellen doen — dat is learn-mode, max 1/dag.

---

## Mode: LEARN (dagelijks 17:00, max 1× per dag)

**Doel:** uit Jelle's amendments en ignore-patronen van vandaag concrete
schrijfregels distilleren én — maximaal één — categorie-voorstel doen.

### Stap 1 — Haal beslissingen van vandaag

```sql
SELECT d.*, m.subject, m.from_email, m.category_key, m.audience,
       d.source_draft_body, d.final_body, d.amend_instructions,
       mm.body_text AS original_mail
  FROM autodraft_decisions d
  JOIN autodraft_mails m USING (mail_id)
  LEFT JOIN mail_messages mm ON mm.id = d.mail_id
 WHERE d.decided_at >= now()::date
 ORDER BY d.decided_at DESC;
```

Focus op `action='amend'` plus `action='send'` waar `final_body` >20% afwijkt van `source_draft_body`.

### Stap 2 — Lesson-VOORSTELLEN (NIET direct inserten!)

Schrijf naar `autodraft_lesson_proposals`. Jelle accepteert in dashboard.

Min 2 voorbeelden per groep. Goede regels: concreet, testbaar.
Slechte regels: "korter", "professioneler". Skip die.

Max 3 lesson-proposals per learn-run.

### Stap 3 — Bestaande lessons bijwerken
- Volgt regel? `times_applied + 1`
- Tegengesproken? `times_contradicted + 1`
- Drempel: `times_contradicted > times_applied * 2` én beide ≥5 →
  `active=false, retired_at=now()`.

### Stap 4 — Max 1 categorie-voorstel per dag

```sql
SELECT count(*) FROM autodraft_category_proposals
 WHERE created_at >= (current_date::timestamp AT TIME ZONE 'Europe/Amsterdam');
```

Resultaat ≥1? **Stop hier.**

Anders: cluster pending mails laatste 14d met `category_key='onbekend'`.
Cluster ≥5 mails, niet onder bestaande categorie passend → INSERT
proposal in `autodraft_category_proposals`. Reasoning expliciet.

DB-trigger blokkeert hoe dan ook ≥2 voorstellen op dezelfde dag.

### Stap 5 — Run-record (v1-contract)
```jsonb
{
  "schema_version": "1",
  "skill_version": "auto-draft-v9",
  "mode": "learn",
  "triggered_by": "orchestrator",
  "triggered_at": "<ISO-8601>",
  "passes": [
    { "name": "fetch-decisions",  "ms": <N>, "status": "success" },
    { "name": "lesson-propose",   "ms": <N>, "status": "success" },
    { "name": "lesson-update",    "ms": <N>, "status": "success" },
    { "name": "category-cluster", "ms": <N>, "status": "success" }
  ],
  "warnings": [],
  "counts": {
    "decisions_analyzed": <N>,
    "lesson_proposals_created": <N>,
    "lessons_updated": <N>,
    "lessons_retired": <N>,
    "category_proposals_created": <0|1>
  },
  "extra": {}
}
```

---

## Schrijfregels voor drafts (HARD)

- **NOOIT em-dashes (—) of dubbele streepjes (--) in draft-body of subject.**
  Vervang door komma, punt, of nieuwe regel. Ziet er te AI-achtig uit.
  Goed: "Korte reminder. Ik mailde je gisteren." Slecht: "Korte reminder — ik mailde…"
- **Begroeting variëren per mail** — niet altijd "Hoi". Gebruik 'Hi', 'Hé',
  'Beste [naam]', of een eerste-naam-only opener afhankelijk van eerdere
  correspondentie-toon.
- **Reminder-stijl uit `agent_config`** — lees `config_value` van rij met
  `agent_name='auto-draft' AND config_key='reminder_style'` en pas de
  schrijfstijl daarop aan voor follow-up/reminder-mails.

## Veiligheidsregels

1. **Verstuur nooit** — geen `OUTLOOK_SEND_DRAFT` ooit.
2. **Schrijf nooit naar Outlook** — geen draft-creatie, geen folder-move, geen markering.
3. **Lees primair uit mail_messages** — Outlook fallback alleen bij lege DB.
4. **Lessons en categorieën gaan via voorstellen** — nooit direct in `autodraft_style_lessons` of `autodraft_categories`.
5. **Confidence eerlijk** — laag bij twijfel.

## Supabase service-role
Vereist (`skill_secrets_registry` → `auto-draft` → `SUPABASE_SERVICE_ROLE_KEY`).

## Skill-familie
- **mail-sync** — schrijft mail_messages (heartbeat 5 min, leest Outlook).
- **auto-draft** (deze) — leest mail_messages, schrijft autodraft_mails (scan + learn).
- **auto-draft-execute** — leest autodraft_decisions, schrijft naar Outlook (drafts plaatsen, geen send).

## Rapportage
Geen externe meldingen. Status loopt via `agent_runs`:
- Per run: `summary` met counts (`Drafted 4 mails, 2 categorieën onbekend, 1 lesson updated`).
- Errors: `agent_runs.status='error'` met leesbare summary — dashboard pikt het op.
- Vragen aan Jelle: gebruik `suggested_action='flag'` of schrijf naar `open_questions`.

Het dashboard mail-pagina toont per draft de status; de Live-feed toont run-level events.
