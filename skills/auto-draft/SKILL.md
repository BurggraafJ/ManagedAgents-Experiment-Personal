---
name: auto-draft
description: "Schrijft draft-voorstellen voor mails in Jelle's inbox. Leest uit Supabase mail_messages (gevuld door mail-sync), schrijft naar autodraft_mails — verstuurt nooit zelf (dat is auto-draft-execute). Per mail: classificeer audience (for_you/not_for_you), kies categorie, en bij audience=for_you ALTIJD 2 draft-varianten + verplichte target_folder; bij not_for_you suggested_action=skip met target_folder='Archief/Nieuwsbrieven' of 'Archief/Notificaties'. Twee modes: scan (heartbeat */5 6-22) en learn (dagelijks 17:00, distilleer style-regels uit amendments + max 1 categorie-voorstel/dag). Verplichte _diagnose-block in elke run-stats. Trigger op 'check mijn mail', 'scan inbox', 'leer van amendments'. Trigger NIET voor versturen of voor mail-ophalen."
---

# Auto-Draft Skill — v7 (mail-DB driven, robuust)

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
UPDATE autodraft_mails am
   SET status = 'stale'
  FROM mail_messages mm
 WHERE am.mail_id = mm.id
   AND am.status IN ('pending', 'amended')
   AND (mm.is_deleted = true
        OR mm.folder_id NOT IN (
             SELECT id FROM mail_folders WHERE well_known_name = 'inbox'
           ));
```

Mails die in Outlook handmatig verplaatst/gewist zijn worden hier
automatisch gestale-d. Dat is goedkoop want we lezen alleen de DB.

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

### Stap 7 — Draft schrijven (TWEE varianten per draft-mail)

**HARDE REGEL — for_you = altijd draft + target_folder:**
- Bij `audience='for_you'`: ALTIJD `suggested_action='draft'` (NIET skip),
  ALTIJD twee varianten in `draft_variants`, EN ALTIJD een ingevulde
  `target_folder` (val terug op `category.default_target_folder`, of als die
  ook leeg is op `'Klanten/Customer Base'`). Geen for_you-mail mag zonder
  draft of zonder map de DB in.
- Bij `audience='not_for_you'`: `suggested_action='skip'`, geen draft,
  `target_folder` = `'Archief/Nieuwsbrieven'` (voor newsletters/marketing) of
  `'Archief/Notificaties'` (voor systeem-notifs). Default → 'Archief/Notificaties'.

Voor mails met `category.default_action = 'draft'`: schrijf **twee
verschillende drafts** in `draft_variants` jsonb-array.

Lees eerst:
- `category.handling_instructions` (verplicht)
- `agent_config.auto-draft.custom_instructions.text` (globale richtlijnen)
- `autodraft_style_lessons` met scope `global` / `category=this` / `domain=sender_domain` / `sender=from_email`

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
  "skill_version": "auto-draft-v7",
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
    "folders_synced": <N>
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
  "skill_version": "auto-draft-v7",
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
