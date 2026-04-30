---
name: sales-on-road
description: >
  Event-agent die Jelle's korte Slack-berichten na kennismakingsgesprekken en prospect-
  contact verwerkt: haalt klant/bedrijf op in HubSpot, zet de juiste stage in de Sales
  Pipeline, voegt contactpersonen en gespreksnotitie toe, en bereidt een follow-up mail
  voor als concept in de Outlook-map "SalesAgent". Leest Slack #sales-on-road
  (C0AU2LSVCMC). Gedraait door de orchestrator elke 30 min op werktijden, en is ook
  handmatig triggerbaar.
  Trigger bij: "sales on road", "verwerk slack sales", "draai sales-on-road", "ik heb
  een kennismakingsgesprek gehad", "zet dit in hubspot", "na mijn gesprek met [kantoor]",
  of wanneer de orchestrator een poll doet en er nieuwe berichten in #sales-on-road
  staan sinds de laatste run.
  Trigger NIET voor HubSpot-data-analyse zonder Slack-trigger (dat is hubspot-daily-sync),
  niet voor eigen drafts in de gewone inbox (dat is auto-draft), niet voor bulk-deal-imports.
---

# Road Notes

> Interne `agent_name` blijft `sales-on-road` (matcht het Slack-kanaal en de
> lookup-key in DB). Display-naam (dashboard + rapportage) is **"Road Notes"**.

Jelle rijdt de hele dag naar kantoren voor kennismakingen, pitches en opvolgingen.
Na elk gesprek stuurt hij één bericht naar Slack **#sales-on-road** in zijn eigen stijl:

> "Net bij Stellicher geweest. Goed gesprek. 8 advocaten, interesse in trial. Stuur
> offerte komende week. Erik van partners was er ook bij (erik@stellicher.nl)."

Deze skill haalt dat bericht op, haalt er zoveel mogelijk structuur uit, en legt het
vast in HubSpot + bereidt een follow-up mail voor.

## Trigger & DB-schrijfgedrag

**Trigger-bron:**
- Primair: orchestrator (`agent-orchestrator`, draait elke 30 min 06:00–22:30). Hij
  leest `agent_schedules.cron_expression = '0,30 6-22 * * *'` en voert deze skill uit.
- Handmatig: "sales on road", "verwerk slack sales", directe skill-aanroep.
- Per-agent Cloud scheduled tasks zijn UIT — enige externe trigger is de orchestrator.

**Cron in agent_schedules:** `0,30 6-22 * * *` — elke 30 min werktijden.

**Leest:**
- Slack `#sales-on-road` (`C0AU2LSVCMC`) — alle berichten sinds `agent_schedules.last_run_at`
- HubSpot MCP — company/deal-zoekopdrachten per bericht
- `sales_on_road_events` — om te checken of een `slack_ts` al verwerkt is (idempotentie)

**Schrijft naar Supabase:**
- `sales_on_road_events` — één rij per Slack-bericht. `slack_ts` is UNIQUE, dus dubbele
  runs doen niks. Kolommen: `raw_message`, `company_name`, `hubspot_company_id`,
  `hubspot_deal_id`, `stage_before`, `stage_after`, `actions[]`, `outlook_draft_created`,
  `license_requested`, `status` (`pending`/`processed`/`needs_review`/`error`/`skipped`).
- `agent_runs` — één rij per uitvoering (elke keer dat de skill draait, ook als er 0
  berichten waren). Verplichte stats: `triggered_by`, `triggered_at`. Agent-specifiek:
  `events_seen`, `events_processed`, `events_skipped`, `events_errored`.
- `open_questions` — bij onduidelijkheid ("welk kantoor bedoel je, er zijn er 2 met die
  naam"), ask in Slack en noteer vraag.

**Schrijft naar HubSpot (via MCP):**
- Company (nieuw aanmaken of bestaand updaten)
- Deal (update stage binnen Sales Pipeline; indien geen deal bestaat: aanmaken in
  Sales Pipeline)
- Note op de deal met de rauwe Slack-tekst + timestamp + link terug naar het Slack-bericht
- Contact(en) indien in het bericht genoemd

**Schrijft naar Outlook:**
- Concept-mail in map **SalesAgent** (onder Concepten). Onderwerpsregel + body op basis
  van het gesprekstype (kennismaking → terugkoppeling, offerte → volgt-offerte, etc.).
  Status blijft draft — Jelle stuurt zelf.

**Update `agent_schedules` zelf niet** — de orchestrator updatet `last_run_at`,
`next_run_at` en de run-lock.

---

## Slack-workspace & kanaal

| Veld | Waarde |
|---|---|
| Workspace | Personal Ops (`personal-ops-group.slack.com`) |
| Kanaal | `#sales-on-road` |
| Channel ID | `C0AU2LSVCMC` |
| MCP prefix | `mcp__37030035-4322-4e41-980f-53e1bd45be11__` |

Alle Slack-communicatie via de `slack-communication` skill conventies (emoji-reacties
✅/⚠️/❌, threaded replies in plaats van nieuwe berichten).

---

## HubSpot — pipelines & stages

Jelle's HubSpot (`mcp__82f94de2-e5ca-4223-ae7e-dc4513165411__`) heeft twee hoofd-
pipelines voor deze agent:

| Pipeline | Stages (typisch voor sales-on-road) |
|---|---|
| **Sales Pipeline** | Nieuwe Lead → Kennismakinggehad → Offerte → Onderhandeling → Gewonnen/Verloren |
| **Customer base** | (post-sale) Not started → Proeftijd → Actief → … |

Sales-on-road werkt primair in **Sales Pipeline**. Stages worden niet hardgecodeerd;
de skill leest actuele stage-namen via `get_crm_objects` / `search_properties` en
matcht op naam (`Kennismakinggehad`, `Offerte`, etc.) uit de Slack-tekst.

**Belangrijke vuistregels:**
- "Kennismakingsgesprek gehad" / "Pitch gegeven" / "Demo gedaan" → **Kennismakinggehad**
- "Offerte verstuurd" of "Stuur offerte" (intent) → Jelle zegt zelf "ik heb 'm niet
  verstuurd" → **blijf op huidige stage**, flag `needs_review=false`, laat
  hubspot-daily-sync dit de volgende dag oppikken zodra de mail daadwerkelijk verstuurd
  is (sent-folder-detectie)
- "Proeflicentie aangevraagd" / "trial afgesproken" → stage **Offerte** (voorbereidend)
- Geen duidelijke stage-indicatie → laat stage ongemoeid; alleen note + contactpersoon
  toevoegen

---

## Stap 0 — Sessie-context

Noteer huidige tijd (`now_ts`) voor vergelijking. Haal `last_run_at` op:

```sql
SELECT last_run_at FROM agent_schedules WHERE agent_name = 'sales-on-road';
```

Als `last_run_at` NULL is: pak berichten van de laatste 24 uur.

## Stap 1 — Slack-kanaal lezen

```
mcp__37030035-4322-4e41-980f-53e1bd45be11__slack_read_channel(
  channel_id: "C0AU2LSVCMC",
  oldest: [last_run_at als unix epoch, anders now - 24h],
  limit: 50
)
```

Filter:
- Alleen berichten van Jelle zelf (user `U0ARF0X5W1W`). Bot-berichten, reacties,
  thread-replies van de skill zelf negeren.
- Skip berichten die alleen uit een emoji bestaan (bv. ✅ als reactie-marker)
- Skip berichten waarvan `slack_ts` al in `sales_on_road_events` staat

Als de lijst leeg is: ga door naar **Stap 9** (run-record schrijven) met status `success`
en `events_seen=0`.

## Stap 2 — Per bericht: idempotentie + extractie

Voor elk bericht, maak een **pending record** aan:

```sql
INSERT INTO sales_on_road_events
  (slack_ts, slack_channel, slack_permalink, raw_message, posted_by, status)
VALUES ($ts, 'sales-on-road', $permalink, $text, $user, 'pending')
ON CONFLICT (slack_ts) DO NOTHING
RETURNING id;
```

Als geen `id` teruggegeven wordt → al verwerkt, skip.

Extractie uit de tekst:
- **Kantoornaam** — look for capitalized proper nouns + known-firm-patterns (advocatenkantoren
  eindigen vaak op `BV` / `Advocaten` / `& Partners`)
- **E-mailadressen** (regex `[\w.+-]+@[\w-]+\.[\w.-]+`) → contactpersonen
- **Stage-keywords** (zie "Vuistregels" boven)
- **Aantal personen** (regex `\b(\d{1,3})\s+(advocaten|juristen|medewerkers|fte|users)\b`)
- **Vrije tekst** (rest van het bericht) → gaat in de note en Outlook-concept

Bij twijfel (bv. bedrijfsnaam komt meerdere keren voor in HubSpot): **ask in thread**
via `open_questions` én reply in Slack-thread met 🤔 + vraag. Status → `needs_review`,
ga naar volgend bericht.

## Stap 3 — HubSpot company + deal ophalen/aanmaken

```
mcp__82f94de2-e5ca-4223-ae7e-dc4513165411__search_crm_objects(
  objectType: "companies",
  query: $company_name
)
```

**Geen match** → maak nieuwe company via `manage_crm_objects` (create). Vul minimaal
`name`, `domain` (als afleidbaar uit e-mailadres).

**Eén match** → gebruik die `hubspot_company_id`.

**Meerdere matches** → vraag in Slack-thread welke ("Ik vind 2 bedrijven met de naam
X — bedoel je [1] X BV (Amsterdam) of [2] X Advocaten (Utrecht)?"). Status →
`needs_review`.

Zelfde logica voor deal:
```
mcp__82f94de2-e5ca-4223-ae7e-dc4513165411__search_crm_objects(
  objectType: "deals",
  query: [company_name],
  filter: "pipeline = 'Sales Pipeline' AND closed = false"
)
```

Geen deal → maak er een aan in Sales Pipeline, start-stage = **Kennismakinggehad**.

## Stap 4 — Stage updaten (als af te leiden)

Match extractie-keywords aan huidige stages. Als match + huidige stage is *eerder* in
de pipeline → update via `manage_crm_objects`. Anders: laat ongemoeid, noteer in
`actions` dat stage-update overgeslagen is.

Bewaar `stage_before` en `stage_after` in de event-rij.

## Stap 5 — Note op de deal

```
mcp__82f94de2-e5ca-4223-ae7e-dc4513165411__manage_crm_objects(
  objectType: "notes",
  action: "create",
  properties: {
    hs_note_body: "📞 Sales on Road — {timestamp lokale tijd}\n\n{rauw Slack-bericht}\n\n[Slack-bericht openen]({slack_permalink})",
    hs_timestamp: now_ms
  },
  associations: [{to_object_type: "deals", to_object_id: $deal_id}]
)
```

## Stap 6 — Contactpersonen toevoegen

Voor elk gevonden e-mailadres:

1. `search_crm_objects(objectType: "contacts", query: email)` — bestaat al?
2. Zo nee: `manage_crm_objects(objectType: "contacts", action: "create", properties: {email, firstname, lastname})` + associate met company
3. Zo ja: check of associate met deze company/deal — zo niet, associeer.

Naam afleiden uit `voornaam.achternaam@...` of uit context in de tekst.

## Stap 7 — Outlook draft voorbereiden

Genereer concept op basis van gesprekstype + gebruik `brandguide-legal-mind` skill
voor tone-of-voice-consistency. Bewaar in map **SalesAgent** (map moet bestaan onder
Jelle's Concepten).

**Draft-recept per stage:**

| Stage | Onderwerp | Body-template |
|---|---|---|
| Kennismakinggehad (nieuw) | "Terugkoppeling gesprek — Legal Mind" | Bedankt voor kennismaking + highlights gesprek + vervolgactie + handtekening |
| Offerte (voorbereidend) | "Offerte Legal Mind voor {kantoor}" | Body leeg gelaten met placeholder-alinea's, Jelle vult bedragen handmatig |
| Proeflicentie | "Proefperiode Legal Mind — aanvraag" | Introductie + link naar licentieovereenkomst (placeholder voor bijlage) |

Als het bericht "licentie" of "offerte" bevat: zet `license_requested=true` in de
event-rij en volg **Stap 7a** hieronder vóór je de draft schrijft — dan bevat de
draft ook direct een werkende link naar het PDF-document.

Hoe de draft feitelijk naar Outlook komt:
- Via Claude in Chrome tab-beheer (zie `auto-draft` SKILL.md stap 5 voor het exacte
  DOM-flow-patroon: open Outlook tab, klik Nieuwe mail, typ inhoud, selecteer map
  SalesAgent, klik Opslaan als concept).
- Als Chrome/Outlook niet bereikbaar is: `outlook_draft_created=false`, zet status op
  `needs_review`, plaats Slack-reactie ⚠️ met uitleg.

## Stap 7a — Offerte-generator aanroepen + PDF naar Supabase Storage

**Alleen uitvoeren wanneer `license_requested=true`** (trefwoorden "licentie",
"offerte", "contract voor" in het Slack-bericht).

### Flow

1. **Roep de `offerte-generator` skill aan** via de standaard skill-chain, met
   een voorbereide payload:
   ```
   {
     "klant": {
       "naam": "<company_name>",                 // uit Stap 3
       "hubspot_deal_id": "<deal_id>",
       "contactpersoon": "<naam uit Slack/mail>",
       "email": "<email uit Stap 6>"
     },
     "licentie": {
       "startdatum": "<YYYY-MM-DD — uit Slack-bericht>",
       "looptijd_mnd": <12 | 24 | fallback 12>,
       "user_count": <aantal advocaten — uit Slack of laatste deal-note; fallback null>
     },
     "opmerkingen": "<1 zin context uit Slack-bericht>",
     "output_format": ["pdf", "docx"],
     "return_paths": true
   }
   ```

   Offerte-generator levert op:
   ```json
   {
     "pdf_local_path": "/tmp/offerte_dvdw_2026-04-21.pdf",
     "docx_local_path": "/tmp/offerte_dvdw_2026-04-21.docx",
     "offer_reference": "OFF-2026-0047"
   }
   ```

2. **Upload de PDF naar Supabase-Storage bucket `offertes`** via de
   Storage-REST API:
   ```
   POST https://ezxihctobrqoklufawim.supabase.co/storage/v1/object/offertes/<pad>
   Authorization: Bearer <service-role-key uit agent_config.supabase_service_role_key>
   Content-Type: application/pdf
   Body: <binary pdf>
   ```

   Gebruik als pad: `<YYYY>/<MM>/<slug-of-company>-<offer_reference>.pdf` —
   bv. `2026/04/dvdw-advocaten-OFF-2026-0047.pdf`. Houd `slug` kleine letters,
   spaties → streepjes, geen speciale tekens.

3. **Genereer een signed URL** (7 dagen geldig):
   ```
   POST https://ezxihctobrqoklufawim.supabase.co/storage/v1/object/sign/offertes/<pad>
   Body: {"expiresIn": 604800}
   ```
   Response bevat `signedURL` — absolute URL die Jelle kan klikken zonder
   login. De volle URL begint met `https://ezxihctobrqoklufawim.supabase.co/storage/v1/...`.

4. **Schrijf URL terug in de event-rij:**
   ```sql
   UPDATE sales_on_road_events
   SET offerte_url          = '<signed-URL>',
       offerte_storage_path = '<pad>',
       license_requested    = true
   WHERE slack_ts = $ts;
   ```

5. **Gebruik de URL in de Outlook-draft** (Stap 7):
   ```
   Beste <naam>,

   Zoals besproken stuur ik je hierbij onze offerte voor het licentieabonnement.
   Je kunt 'm bekijken via deze link:

   → <signed-URL>

   Ik hoor graag je reactie.
   ```
   Dus **geen losse PDF-bijlage meer** — Jelle hoeft niks meer handmatig aan
   te hechten. Als hij liever een bijlage wilt, downloadt hij 'm één keer en
   voegt 'm toe voor hij verstuurt.

6. **Voeg een HubSpot-note toe op de deal** met de URL en het
   `offer_reference`-nummer, zodat de link ook in HubSpot bewaard blijft:
   ```
   "Offerte OFF-2026-0047 gegenereerd via sales-on-road → <signed-URL>
    (7 dagen geldig, hergenereer via dashboard na expiry)"
   ```

### Foutafhandeling

| Fout | Actie |
|---|---|
| `offerte-generator` skill faalt | `status='needs_review'`, Slack-reactie ⚠️ "offerte-generator gaf fout: X — probeer handmatig". Draft *wel* schrijven, maar met placeholder-alinea zoals voorheen. |
| Supabase-upload faalt (401, 5xx) | `status='needs_review'`, log `error_message='storage upload failed'`, lokaal pad bewaren in `sales_on_road_events.offerte_storage_path` voor retry. |
| Signed URL faalt | Upload succes was → bewaar path, URL kan opnieuw gegenereerd worden later via dashboard-knop. |
| `agent_config.supabase_service_role_key` ontbreekt | Fatal — `status='error'`, zeg in Slack: "Service-role key mist in config — agent-manager moet fixen". Zie **Eenmalige setup** hieronder. |

### Waarom service-role key en niet anon?
Bucket `offertes` staat op `public=false`. Anon kan alleen `SELECT` op
metadata, niet uploaden of signed URL genereren. Service-role key mag het wel
en wordt alleen vanuit de agent-context gebruikt (nooit in de browser/
dashboard).

### Eenmalige setup — service_role key registreren

De eerste run kan Stap 7a niet uitvoeren tot deze key in `agent_config` staat.
Haal 'm uit Supabase Dashboard → Project Settings → API → `service_role`
(onder "Project API keys"), en registreer via:

```sql
INSERT INTO agent_config (agent_name, config_key, config_value, is_secret)
VALUES ('sales-on-road', 'supabase_service_role_key',
        to_jsonb('<de-service-role-key>'::text), true)
ON CONFLICT (agent_name, config_key) DO UPDATE
SET config_value = EXCLUDED.config_value, is_secret = true, updated_at = now();
```

`is_secret=true` zorgt dat het dashboard 'm niet toont in de config-view.

## Stap 8 — Event-rij updaten

Update de pending-rij naar `processed`:

```sql
UPDATE sales_on_road_events
SET status='processed',
    company_name=$name, hubspot_company_id=$cid, hubspot_deal_id=$did,
    pipeline='Sales Pipeline',
    stage_before=$sb, stage_after=$sa,
    actions=$actions::jsonb,
    outlook_draft_created=$draft_ok, outlook_draft_subject=$subj,
    license_requested=$lic,
    summary=$human_summary,
    processed_at=now()
WHERE slack_ts=$ts;
```

Post een Slack-reactie op het oorspronkelijke bericht:

```
✅ Verwerkt
• {company_name} → stage {stage_after}
• Note + {n} contact(en) toegevoegd
• Concept-mail staat in SalesAgent-map{license_note}
```

(`license_note` = " · ⚠️ licentiebijlage nog handmatig" als `license_requested=true`)

Bij fouten: status `error`, `error_message`, post ❌-reactie met korte uitleg.

## Stap 9 — Run-record schrijven (verplicht)

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
    'triggered_by',         $triggered_by,   -- 'orchestrator'|'manual'|'slack'
    'triggered_at',         now()::text,
    'events_seen',          $events_seen,
    'events_processed',     $events_processed,
    'events_needs_review',  $events_needs_review,
    'events_errored',       $events_errored,
    'events_skipped',       $events_skipped   -- al verwerkt bij eerdere run
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