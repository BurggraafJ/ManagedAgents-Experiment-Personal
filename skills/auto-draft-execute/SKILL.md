---
name: auto-draft-execute
description: "Voert AutoDraft-beslissingen uit die Jelle in het dashboard heeft genomen. Bij action='send' (= 'plaats als Outlook-draft') maakt deze skill een Outlook-reply-draft in de bestaande thread maar VERSTUURT NIET — Jelle klikt zelf send in Outlook. Bij action='ignore' verplaatst origineel naar gekozen map. Bij action='amend' herschrijft skill de draft in autodraft_mails (met verse mail-context uit mail_messages). Trigger-based via RPC submit_autodraft_decision die manual_run_requested_at zet. Trigger ook handmatig bij 'verwerk mijn beslissingen', 'leeg de wachtrij'. Trigger NIET om mails op te halen (mail-sync) of regels te leren (auto-draft learn)."
---

# Auto-Draft Execute Skill — v6 (mail-DB aware)

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

## Wat is veranderd in v6
- **mail-context lezen uit `mail_messages`** ipv `OUTLOOK_GET_MESSAGE` —
  sneller, zelfde data. Alleen voor amend-context (origineel + thread).
- **Outlook-writes ongewijzigd**: blijft dé enige skill die naar Outlook schrijft.

## Voorwaarden
- Composio Outlook MCP connectie actief op alias `legal-mind`.
- Bij 401/403: stop, schrijf `agent_runs.status='error'` met
  `summary='Composio Outlook auth verloren — reconnect via Composio dashboard'`,
  `stats.error='composio_auth_failed'`. Decisions blijven pending. Dashboard banner pikt het op.

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

#### action = 'send' — "Plaats als Outlook-draft" (NIET versturen!)

**Bepaal eerst `decision.decision_kind`:**

##### decision_kind = 'reply' (default)
1. `OUTLOOK_CREATE_ME_MESSAGE_REPLY_ALL_DRAFT` op `decision.mail_id`.
2. `OUTLOOK_UPDATE_EMAIL` op de nieuwe draft-id: subject=`final_subject`, body=`final_body`.
3. **STOP. NIET VERSTUREN. NIET VERPLAATSEN.**
4. Update mail.status='sent' (= "Outlook-draft geplaatst", zie schema-comment).
5. Optioneel: bewaar draft-id in `decision.execution_result`.

##### decision_kind = 'forward' (quick-action: doorsturen naar bv. Finance)
1. `OUTLOOK_CREATE_FORWARD_DRAFT` op `decision.mail_id` (of equivalent;
   sommige Composio-versies heten `OUTLOOK_FORWARD_MESSAGE` met `comment` param —
   in dat geval gebruik je de `saveOnly` flag zodat het concept blijft, niet verstuurt).
   Als forward-draft niet bestaat: maak een nieuwe message via
   `OUTLOOK_CREATE_DRAFT_IN_FOLDER` (folder=Drafts) met:
     - `to`     = `decision.final_to` (verplicht aanwezig)
     - `subject`= `decision.final_subject` (typisch "FW: <origineel>")
     - `body`   = `decision.final_body` (bevat al de gequoted originele mail)
2. **STOP. NIET VERSTUREN.**
3. Origineel: verplaats naar `decision.target_folder` (typisch "Verwijderd"),
   markeer als gelezen — dit is de "doorgestuurd, klaar"-flow.
4. Update mail.status='sent'.
5. Optioneel: bewaar draft-id in `decision.execution_result`.

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

## Run-record
```jsonb
{
  "triggered_by": "<manual_run_request|orchestrator|manual>",
  "triggered_at": "<ISO>",
  "decisions_processed": <N>,
  "drafts_placed": <N>, "ignored": <N>, "amended": <N>,
  "spammed": <N>, "flagged": <N>, "unflagged": <N>,
  "failed": <N>, "skipped": <N>
}
```

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
