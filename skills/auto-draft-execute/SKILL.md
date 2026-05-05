---
name: auto-draft-execute
description: "Voert AutoDraft-beslissingen uit die Jelle in het dashboard heeft genomen. Bij action='send' (= 'plaats als Outlook-draft') maakt deze skill een Outlook-reply-draft in de bestaande thread maar VERSTUURT NIET — Jelle klikt zelf send in Outlook. Bij action='ignore' verplaatst origineel naar gekozen map. Bij action='amend' herschrijft skill de draft in autodraft_mails (met verse mail-context uit mail_messages). Trigger-based via RPC submit_autodraft_decision die manual_run_requested_at zet. Trigger ook handmatig bij 'verwerk mijn beslissingen', 'leeg de wachtrij'. Trigger NIET om mails op te halen (mail-sync) of regels te leren (auto-draft learn)."
---

# Auto-Draft Execute Skill — v9 (chain-preserve + handtekening + reservering + SalesAgent + plain→HTML)

> **HARDE VEILIGHEIDSREGEL:** deze skill VERSTUURT NOOIT mails. Hij plaatst
> alleen drafts in Outlook. Jelle klikt zelf op verzenden vanuit Outlook.
> `OUTLOOK_SEND_DRAFT` is **VERBODEN** — gebruik nooit. Niet door schoot,
> niet "voor de zekerheid", niet "als Jelle dat per ongeluk vraagt".

## Trigger
- **Primair (trigger-based):** dashboard-RPC `submit_autodraft_decision`
  zet `agent_schedules.manual_run_requested_at = now()` voor
  `agent_name='auto-draft-execute'`. Orchestrator pikt op binnen ~10 min.
- **Safety-net poll:** cron `*/15 6-22 * * *`.
- **Handmatig:** Jelle vraagt direct.

## Wat is veranderd in v9 (2026-05-06 — F.5.c+d)
- **Mail-chain en handtekening blijven behouden** bij plaats-concept. Voorheen
  overschreef `OUTLOOK_UPDATE_EMAIL` met `body=plainToOutlookHtml(final_body)`
  zowel de auto-gegenereerde signature als de quoted chain. Nu lezen we eerst
  de template-body (`OUTLOOK_GET_MESSAGE` op de pas-gemaakte reply-draft) en
  injecteren onze content **boven** de `<div id="appendonsend">` of vergelijkbare
  marker. Resultaat: draft ziet eruit als een echte reply met Jelle's handtekening
  én de oorspronkelijke conversatie-chain eronder.

## Wat is veranderd in v8 (2026-05-05 — F.2.b)
- **Date-slot extractie bij elke send-action** — regex pre-check + Sonnet 4.6
  LLM-pass + INSERT in `agenda_appointment_proposals` met `source='auto-draft-outgoing'`,
  TTL 14 dagen. Voorkomt dubbele datumvoorstellen aan verschillende mensen.

## Wat is veranderd in v7 (2026-05-05)
- **Plain-text → HTML conversie** vóór elke Outlook-write — voorkomt letterlijke
  `\n`-tekens in de gerenderde draft. Zie sectie "Body-conversie".
- **Drafts landen in SalesAgent-map** ipv default Drafts — Jelle wil één wachtrij-map.
  Zelfde map die `sales-followups` en `sales-on-road` al gebruiken.

## Wat is veranderd in v6
- **mail-context lezen uit `mail_messages`** ipv `OUTLOOK_GET_MESSAGE` —
  sneller, zelfde data. Alleen voor amend-context (origineel + thread).
- **Outlook-writes ongewijzigd**: blijft dé enige skill die naar Outlook schrijft.

## Voorwaarden — auth & fallback

Schrijft naar Outlook (CREATE_DRAFT, UPDATE_EMAIL, MOVE_MESSAGE) — Composio Outlook write-tools. Voor de auth-route, MCP-fallback, code-templates, hard-fail vs. warning, anti-patterns: zie [`agent-handbook/references/authentication.md`](../agent-handbook/references/authentication.md) — single source of truth sinds 2026-05-03. Geen eigen auth-blok in deze skill.

Per-skill specifiek (niet door handbook gedicteerd): `connected_account_id` uit `agent_config(auto-draft-execute, composio_connection_id)` (fallback `agent_config(global, composio_connection_id_outlook)`). Decisions blijven `pending` als beide MCP en REST falen.

## Per-decision flow

### 1. Pak alle pending op, oudste eerst
```sql
SELECT d.*, am.subject, am.from_email,
       am.draft_variants, am.selected_variant_index,
       mm.body_text, mm.body_html, mm.conversation_id, mm.folder_id
  FROM autodraft_decisions d
  JOIN autodraft_mails am USING (mail_id)
  LEFT JOIN mail_messages mm ON mm.id = d.mail_id
 WHERE d.execution_status = 'pending'
 ORDER BY d.decided_at ASC
 LIMIT 10;
```

### 2. Verhoog attempts
`UPDATE autodraft_decisions SET execution_attempts = execution_attempts + 1 WHERE id = $1;`

>5 attempts → `execution_status='failed'`, mail.status='failed'. Skip.

### 3. Sanity-check
mail.status in ('sent','ignored','stale') → set decision skipped.

### 4. Voer actie uit

#### Body-conversie — ALTIJD voor elke Outlook-write

**HARDE REGEL — `final_body` van DB is plain-text met `\n` newlines.**
Outlook accepteert HTML in `body.content` (met `body.contentType='HTML'`). Plain-text
zonder conversie levert óf één lange regel óf letterlijke `\n`-tekens in de gerenderde
draft. Pas dus deze conversie toe vóór elke `OUTLOOK_UPDATE_EMAIL` /
`OUTLOOK_CREATE_DRAFT_IN_FOLDER`-call:

```typescript
function plainToOutlookHtml(text: string): string {
  if (!text) return '';
  // Als 't al begint met '<' is het waarschijnlijk al HTML — laat staan.
  if (/^\s*<[a-z!]/i.test(text)) return text;
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // Dubbele newlines = paragraph-breaks; enkele = <br>.
  const paragraphs = escaped.split(/\n\n+/);
  return paragraphs
    .map(p => '<p>' + p.replace(/\n/g, '<br>') + '</p>')
    .join('');
}
```

Geef in elke Composio-call expliciet `body.contentType='HTML'` mee.

#### Date-slot extractie — bij action='send' vóór Outlook-write (sinds F.2.b, 2026-05-05)

**Doel:** voorkomen dat Jelle dezelfde datum aan twee mensen voorstelt. Wanneer
de draft concrete datum-tijdslots noemt, registreer ze als reservering in
`agenda_appointment_proposals` zodat de agenda-skill (mode #2) ze niet opnieuw
aan een andere recipient aanbiedt.

**Pre-check via regex** (kosten-besparing — 90% van drafts heeft geen datums):

```typescript
const DATE_HINT_RE = new RegExp([
  // Weekdagen
  '\\b(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag)\\b',
  // Maand-namen
  '\\b\\d{1,2}\\s*(jan|feb|mrt|apr|mei|jun|jul|aug|sep|okt|nov|dec)',
  // Datum dd-mm of dd/mm
  '\\b\\d{1,2}[-/]\\d{1,2}([-/]\\d{2,4})?\\b',
  // Tijd hh:mm
  '\\b\\d{1,2}[:.]\\d{2}\\b',
  // Periode-aanduidingen
  '\\b(volgende week|aanstaande|aankomende|morgen|overmorgen|vandaag)\\b',
].join('|'), 'i');
```

Geen match → skip extractie, geen reservering.

**Match → roep Sonnet 4.6 aan met deze prompt:**

```
Je bent een datum-extractor. Lees de mail-body en lever ALLEEN concrete
datum-tijdslots terug die de schrijver (Jelle) als afspraak-voorstel doet.
Vandaag is {{today_iso}} in tijdzone Europe/Amsterdam.

Negeer:
- Vage hints ("ergens volgende week", "later eens") — alleen concrete slots
- Datum-referenties die over verleden gaan ("zoals besproken op 3 mei")
- Deadlines voor ander werk ("graag voor 12 mei reageren")

Output exact dit JSON-formaat (geen extra tekst):
{
  "slots": [
    {
      "start": "ISO-8601 met tijdzone",
      "end": "ISO-8601 met tijdzone",
      "duration_minutes": 60,
      "verbatim": "wat letterlijk in tekst stond",
      "confidence": 0.0-1.0
    }
  ]
}

Lege array als geen concrete slots. Default duur = 60 min als niet gespecificeerd.

Mail-body:
{{final_body}}
```

**Persisteer reservering** als minstens één slot met `confidence ≥ 0.7`:

```sql
INSERT INTO agenda_appointment_proposals (
  conversation_id,
  mail_id,
  recipient_email,
  recipient_name,
  subject_context,
  proposed_slots,
  meeting_type_hint,
  is_online,
  urgency_level,
  status,
  source,
  proposed_by,
  sent_at,
  expires_at,
  draft_decision_id,
  notes_ai
) VALUES (
  $conversation_id,
  $mail_id,
  $recipient_email,           -- final_to[0] of mail.from_email
  $recipient_name,
  $subject_or_first_60_chars,
  $slots_jsonb,                -- direct uit LLM-output
  null,                        -- meeting-type onbekend bij outgoing
  null,                        -- online/fysiek onbekend bij outgoing
  'normaal',
  'sent',
  'auto-draft-outgoing',
  'jelle',
  now(),
  now() + interval '14 days',  -- TTL
  $decision_id,
  'Auto-extracted bij send via Sonnet 4.6 (F.2.b)'
);
```

**Skip (geen INSERT) als:**
- LLM levert lege `slots[]` of alle confidence < 0.7
- Mail is een reply waarop al een open proposal bestaat — controleer eerst:
  ```sql
  SELECT id FROM agenda_appointment_proposals
   WHERE conversation_id = $conv_id
     AND status IN ('sent','accepted')
     AND (expires_at IS NULL OR expires_at > now())
  ```
  Bij hit → log `stats.warnings += ["proposal_already_open_for_conversation"]` en
  voeg de slots toe als counter-update aan bestaande rij (`proposed_by='jelle'` blijft;
  `proposed_slots` wordt aangevuld). Geen aparte rij.

**Rapportage:** `stats.counts.date_proposals_created += 1` per geslaagde reservering.
Bij regex-hit zonder LLM-match: `stats.counts.date_extraction_attempted += 1`.

**Tokenkost:** ~500 input + ~150 output tokens per scan-call ≈ $0.005 per match.
Skip-rate ~90% via regex-pre-check, dus echt dure runs zijn zeldzaam.

#### action = 'send' — "Plaats als Outlook-draft" (NIET versturen!)

**Bepaal eerst `decision.decision_kind`:**

##### decision_kind = 'reply' (default)
1. `OUTLOOK_CREATE_ME_MESSAGE_REPLY_ALL_DRAFT` op `decision.mail_id`.
   Outlook genereert automatisch een draft met:
   - Lege ruimte bovenaan (waar gebruiker zou typen)
   - Jelle's handtekening (incl. embedded image, indien geconfigureerd in Outlook)
   - `<div id="appendonsend"></div>` marker
   - Chain-divider + originele bericht-citaat ("Van: …, Verzonden: …, Aan: …")
2. **Lees de auto-gegenereerde body** (sinds F.5.c+d 2026-05-06):
   - `OUTLOOK_GET_MESSAGE` op de nieuwe draft-id → bevat `body.content` met
     signature + chain.
   - Bewaar dit als `template_html`. Faalt deze stap? → fallback naar
     plainToOutlookHtml(final_body) zonder chain (oude gedrag), voeg
     `"reply_template_fetch_failed"` toe aan `stats.warnings[]`.
3. **Construct combined body** zodat handtekening + chain behouden blijven:
   ```typescript
   function injectBodyAboveSignature(template: string, bodyHtml: string): string {
     // Outlook plaatst altijd één van deze markers vóór signature/chain.
     // Probeer ze in volgorde; eerste hit wint.
     const markers = [
       '<div id="appendonsend">',           // Outlook 365 standard
       '<div id="Signature">',              // Outlook desktop oudere versie
       '<hr id="stopSpelling">',            // Outlook chain-divider
       '<div class="WordSection1">',        // Word-rendered template
       '<div class="OutlookMessageHeader">',// Chain-header alternatief
     ];
     for (const m of markers) {
       const idx = template.indexOf(m);
       if (idx !== -1) {
         return template.slice(0, idx) + bodyHtml + template.slice(idx);
       }
     }
     // Geen marker gevonden? Prepend body — chain + signature staan dan onder
     return bodyHtml + template;
   }
   const combined = injectBodyAboveSignature(template_html, plainToOutlookHtml(final_body));
   ```
4. `OUTLOOK_UPDATE_EMAIL` op de draft-id met:
   - `subject = final_subject`
   - `body = { contentType: 'HTML', content: combined }`
5. **Verplaats draft naar SalesAgent-map**:
   - Resolve folder-id:
     ```sql
     SELECT id FROM mail_folders
       WHERE display_name = 'SalesAgent' AND full_path ILIKE 'Inbox/SalesAgent%'
       LIMIT 1;
     ```
   - Bij gevonden: `OUTLOOK_MOVE_MESSAGE` op draft-id naar deze folder.
   - Niet-gevonden: laat in default Drafts, voeg
     `"salesagent_folder_missing"` toe aan `stats.warnings[]`.
6. **STOP. NIET VERSTUREN.**
7. Update mail.status='sent' (= "Outlook-draft geplaatst").
8. Optioneel: bewaar draft-id in `decision.execution_result`.

##### decision_kind = 'forward' (quick-action: doorsturen naar bv. Finance)
1. `OUTLOOK_CREATE_FORWARD_DRAFT` op `decision.mail_id`. Outlook genereert
   automatisch een draft met handtekening + de originele mail als citaat.
   Als die tool niet bestaat: maak een nieuwe message via
   `OUTLOOK_CREATE_DRAFT_IN_FOLDER` (folder=SalesAgent) met:
     - `to`     = `decision.final_to` (verplicht aanwezig)
     - `subject`= `decision.final_subject` (typisch "FW: <origineel>")
     - `body`   = `{ contentType: 'HTML', content: plainToOutlookHtml(decision.final_body) }`
     (geen template = geen handtekening — accepted trade-off voor de fallback-pad)
2. **Bij CREATE_FORWARD_DRAFT** (heeft template): toepasselijk dezelfde
   chain-preserve flow als reply (sinds F.5.c+d 2026-05-06):
   - `OUTLOOK_GET_MESSAGE` op draft-id → template_html
   - `injectBodyAboveSignature(template_html, plainToOutlookHtml(final_body))` → combined
   - `OUTLOOK_UPDATE_EMAIL` met subject + combined HTML
   - Daarna: set recipient via UPDATE_EMAIL (forward-draft heeft geen pre-set
     `to` — gebruik `decision.final_to`).
3. Verplaats draft naar SalesAgent (`OUTLOOK_MOVE_MESSAGE` zelfde resolve-pattern).
4. **STOP. NIET VERSTUREN.**
5. Origineel: verplaats naar `decision.target_folder` (typisch "Verwijderd"),
   markeer als gelezen — dit is de "doorgestuurd, klaar"-flow.
6. Update mail.status='sent'.
7. Optioneel: bewaar draft-id in `decision.execution_result`.

#### action = 'ignore'
1. Geen draft. Verplaats origineel naar `decision.target_folder` (`OUTLOOK_MOVE_MESSAGE`).
2. Markeer als gelezen (`OUTLOOK_BATCH_UPDATE_MESSAGES isRead=true`).
3. mail.status='ignored'.

#### action = 'spam' — markeer als spam, verplaats naar Junk Email
1. `OUTLOOK_MOVE_MESSAGE` op `decision.mail_id` naar folder met `well_known_name='junkemail'`
   (of full_path='Junk Email'). Outlook leert hierop voor toekomstige spam-detectie.
2. Markeer als gelezen (`OUTLOOK_BATCH_UPDATE_MESSAGES isRead=true`).
3. Update DB:
   ```sql
   UPDATE mail_messages SET flagged_as_spam = true WHERE id = $1;
   ```
4. mail.status='ignored' (als autodraft_mails-row bestaat). decision.execution_status='done'.
5. Run-record: tel onder `spammed`.

#### action = 'flag' / 'unflag' — Outlook-vlag aan/uit
1. `flag` → Graph API `setFlag` op message: `{flag: { flagStatus: "flagged" }}`.
   Composio-passthrough: `OUTLOOK_UPDATE_EMAIL` met `flag.flagStatus='flagged'`.
2. `unflag` → idem maar `flagStatus='notFlagged'`.
3. **Geen mail-verplaatsing.** Vlag is alleen markering.
4. Update DB:
   ```sql
   UPDATE mail_messages
      SET flag_status = CASE WHEN $action='flag' THEN 'flagged' ELSE NULL END
    WHERE id = $1;
   ```
5. decision.execution_status='done'. Run-record: tel onder `flagged`/`unflagged`.

#### action = 'amend'
1. **Niets in Outlook aanraken.**
2. Lees:
   - `decision.amend_instructions`
   - `decision.source_draft_body`
   - `mm.body_text` of `mm.body_html` (origineel, uit mail_messages — geen Composio nodig)
   - thread-context: query `mail_messages WHERE conversation_id = mm.conversation_id ORDER BY received_at`
   - `category.handling_instructions`
   - actieve `autodraft_style_lessons` met scope passend
3. Schrijf **2 nieuwe varianten** in Jelle's stijl die zijn correctie verwerken.
4. Update `autodraft_mails`:
   ```sql
   UPDATE autodraft_mails
      SET draft_variants = $variants,
          draft_subject = $subj_v0, draft_body = $body_v0,
          selected_variant_index = 0, status = 'amended', updated_at = now()
    WHERE mail_id = $1;
   ```

### 5. Decision afsluiten
**Succes:** `execution_status='done', executed_at=now()`.
**Failure:** zie veiligheidsregels onderaan.

## Run-record (v1-contract — zie agent-handbook/references/logging.md)
```jsonb
{
  "schema_version": "1",                    // STRING "1" — nooit integer
  "skill_version": "auto-draft-execute-v9",
  "mode": null,
  "triggered_by": "<manual_run_request|orchestrator|manual>",
  "triggered_at": "<ISO-8601>",
  "passes": [
    { "name": "fetch-pending", "ms": <N>, "status": "success" },
    { "name": "execute",       "ms": <N>, "status": "success" },
    { "name": "log",           "ms": <N>, "status": "success" }
  ],
  "warnings": [],
  "counts": {
    "decisions_processed": <N>,
    "drafts_placed": <N>,
    "ignored": <N>,
    "amended": <N>,
    "spammed": <N>,
    "flagged": <N>,
    "unflagged": <N>,
    "failed": <N>,
    "skipped": <N>,
    "date_proposals_created": <N>,
    "date_extraction_attempted": <N>
  },
  "extra": {}
}
```

Hard errors (auth-fail, 5xx na retries) horen in `agent_runs.errors[]`, niet in `stats`.
Definitief gefaalde decisions (na 5x retry) → `stats.warnings[] += ["decision_<id>_failed"]`.

## Veiligheidsregels
1. **NOOIT `OUTLOOK_SEND_DRAFT`.** Geen uitzonderingen.
2. **action='send' = "plaats als Outlook-draft", NIET versturen.**
3. **Origineel pas verplaatsen NA succesvolle send-actie** (alleen bij ignore).
4. **Idempotent:** check mail.status voor je begint.

## Foutafhandeling
- 429: backoff 5/15/45s, max 3 retries.
- 404 op origineel: `execution_status='skipped', execution_error='source_message_gone'`, mail.status='stale'.
- 401/403: stop hele run.
- Anders: `execution_status='failed', execution_error=<msg>`. Na 5x: definitief failed.

## Rapportage
Geen externe meldingen. Status loopt via `agent_runs`:
- Per run: `summary` met counts (`Placed 3 drafts, ignored 2, 1 amended`).
- Errors: `agent_runs.status='error'` met leesbare summary.
- Definitief gefaalde decision (na 5x): `agent_runs.status='warning'` met decision-id
  in summary; dashboard mail-pagina toont decision als failed.

## Supabase service-role
Vereist (`skill_secrets_registry` → `auto-draft-execute` → `SUPABASE_SERVICE_ROLE_KEY`).

## Skill-familie
- **mail-sync** — schrijft mail_messages (heartbeat 5 min).
- **auto-draft** — leest mail_messages, schrijft autodraft_mails.
- **auto-draft-execute** (deze) — leest autodraft_decisions + mail_messages, schrijft naar Outlook (drafts plaatsen, geen send).
