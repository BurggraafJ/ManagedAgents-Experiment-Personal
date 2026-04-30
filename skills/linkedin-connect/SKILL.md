---
name: linkedin-connect
description: >
  Stuurt automatisch LinkedIn connectieverzoeken naar alle medewerkers van advocatenkantoren.
  Draait elke maandag automatisch: haalt uit HubSpot de deals in proefperiode op, kiest zelf
  welke kantoren deze week verbonden worden, en rapporteert via Slack (#linkedin-connect,
  Personal Ops workspace). Houdt week-op-week bij waar het gebleven is zodat voortgang
  zichtbaar is in de thread. Kan ook handmatig getriggerd worden voor een specifiek kantoor.
  Trigger bij: "connect met [kantoornaam]", "LinkedIn connecties sturen naar [kantoor]",
  "connectieverzoeken sturen", "netwerk uitbreiden [kantoor]", "LinkedIn connect [bedrijf]",
  "stuur connectieverzoeken naar medewerkers van [kantoor]", "doe linkedin", "linkedin run",
  of wanneer Jelle vraagt om advocaten/medewerkers van een specifiek kantoor toe te voegen.
  Trigger ook wanneer Jelle "doe linkedin" of "run linkedin" in Slack post.
  Trigger NIET voor het posten op LinkedIn of het zoeken van bedrijfsinformatie zonder connect-intentie.
---

# LinkedIn Connect — Bulk connectieverzoeken voor advocatenkantoren

## Trigger & DB-schrijfgedrag

**Trigger-bron:**
- Primair: orchestrator (`agent-orchestrator` skill, draait elke 30 min 06:00–22:30).
  De orchestrator leest `agent_schedules.cron_expression = 0 9 * * 1` en bepaalt of deze agent aan de beurt is.
- Handmatig: "connect met [kantoor]", "doe linkedin", "run linkedin".
- Per-agent Cloud scheduled tasks zijn UIT — enige externe trigger is de orchestrator.

**Cron in agent_schedules:** `0 9 * * 1` (elke maandag 09:00)

**Schrijft naar Supabase:**
- `agent_runs` — eigen run-record aan einde van elke uitvoering. Verplichte `stats`-velden: `triggered_by` (`'orchestrator'` | `'manual'` | `'slack'`), `triggered_at` (ISO). Agent-specifieke metrics: `connects_sent`, `companies_processed`, `companies_completed`, `follows`, `already_connected`.
- `linkedin_progress` — week/kantoor upsert per verwerkt kantoor.
- Leest uit HubSpot voor selectie (geen schrijf-actie daar).

**Update `agent_schedules` zelf niet** — de orchestrator updatet `last_run_at`, `next_run_at` en de run-lock. Deze agent raakt die kolommen niet aan.

**Voorbeeld insert voor `agent_runs`:**
```sql
INSERT INTO agent_runs (agent_name, status, summary, stats, started_at, completed_at, slack_channel)
VALUES ('linkedin-connect', '<status>', '<korte summary>',
  jsonb_build_object(
    'triggered_by',         '<orchestrator|manual|slack>',
    'triggered_at',         '<ISO>',
    'connects_sent',        <N>,
    'companies_processed',  <Cp>,
    'companies_completed',  <Cc>,
    'follows',              <F>,
    'already_connected',    <A>,
    -- Compacte lijst voor dashboard-card — PER KANTOOR MET COUNT (niet per connect):
    'connects_summary',     $$[
      {"company": "Stellicher Advocaten", "count": 5},
      {"company": "JPR Advocaten",        "count": 3},
      {"company": "Beer Advocaten",       "count": 2}
    ]$$::jsonb
  ),
  '<start-ISO>'::timestamptz, now(), 'linkedin-connect');
```

**`stats.connects_summary` shape (per 2026-04-21)** — dashboard toont deze array als
compacte lijst "kantoor · aantal connects". Velden: `company` (verplicht), `count`
(int, aantal individueel verstuurde connects voor dit kantoor in deze run). Groepeer
per kantoor vóór je insert — individuele contact-namen zijn op deze dashboard-view
niet nodig.

Als backward-compat: oude `[{company, contact, time}]`-vorm werkt nog; dashboard
aggregeert dan zelf per kantoor.

---

## Slack

> **Verplicht:** Lees de `slack-communication` skill (SKILL.md) vóór je een Slack-bericht
> stuurt. Die bevat alle channel IDs, emoji-conventies, berichtformaten, threading-protocol
> en foutafhandeling. Alles hieronder is linkedin-connect-specifiek en veronderstelt
> dat je de slack-communication skill gelezen hebt.

Alle communicatie verloopt via **#linkedin-connect** in de **Personal Ops** workspace
(`personal-ops-group.slack.com`).

| Channel | ID |
|---|---|
| #linkedin-connect | `C0ARX7VNDC6` |

**Communicatiepatroon per week:**

- **Start van elke run** → post een weekbericht als nieuw top-level bericht:
  `🔗 LinkedIn Connect — week [X], [datum] — bezig met selectie uit HubSpot...`
  Sla de `ts` van dit bericht op — alle updates deze week gaan als thread-reply hierop.
- **Plan** → thread-reply met welke kantoren deze week worden opgepakt en waarom:
  `📋 Plan deze week: [Kantoor A] (proefperiode), [Kantoor B] (proefperiode), [Kantoor C] (pijplijn)`
- **Per kantoor** → thread-reply na afronding met het standaard rapport (zie Stap 8)
- **Vragen** → thread-reply met duidelijke vraag als de skill niet verder kan:
  `❓ [Vraag]. Reply in deze thread om door te gaan.`
  Wacht dan op antwoord — de volgende run pikt het op.
- **Weekafsluiting** → thread-reply met totaaloverzicht:
  `✅ Week [X] klaar — [N] kantoren, [X] connects verstuurd. Volgende week: [preview]`

**Voortgangsoverzicht in thread:** elke thread toont de cumulatieve voortgang over
alle proefperiode-kantoren: `📊 Totaal proefperiode: [X]/[Y] kantoren volledig verbonden`

## Schedule

De skill draait **elke maandag om 09:00** automatisch.

- **Scheduled run:** kiest zelf welke kantoren deze week worden opgepakt (zie "Autonome selectie")
- **Manuele run:** Jelle typt "connect met [kantoor]" in Cowork of in #linkedin-connect, of
  "doe linkedin" voor een autonome run zonder specifiek kantoor

## HubSpot — Proefperiode & Pijplijn

Bij elke (scheduled) run haalt de skill eerst de relevante kantoren op uit HubSpot:

### 1. Deals in proefperiode (hoogste prioriteit)

Zoek in HubSpot naar deals met dealstage = proefperiode (of vergelijkbare stagename):
```
search_crm_objects(objectType: "deals", filter: dealstage = "proefperiode")
```
Haal per deal op: bedrijfsnaam, bijbehorend company object, contactpersonen.
Dit zijn actieve klanten — LinkedIn-connectie met hun team is urgent.

### 2. Recente deals (secundaire prioriteit)

Deals die recent zijn aangemaakt of bijgewerkt maar nog niet in proefperiode zitten.
Dit zijn warme leads waar LinkedIn-connectie zinvol is voor zichtbaarheid.

### Voortgang bijhouden

Gebruik #linkedin-connect als primaire state. Lees bij elke run de laatste berichten
uit het kanaal om te bepalen welke kantoren al verwerkt zijn:
```
slack_read_channel(channel_id: "C0ARX7VNDC6", limit: 20)
```
Parse de thread-replies op kantoornamen en "✅" rapportage om te bepalen wat al gedaan is.

Voor persistent bijhouden: sla verwerkte kantoren op in
`/sessions/[session-id]/mnt/outputs/linkedin_state.json`:
```json
{
  "processedKantoren": {
    "De Brauw Blackstone Westbroek": {
      "processedAt": "2026-04-07",
      "connects": 45,
      "source": "proefperiode",
      "dealId": "12345"
    }
  },
  "lastRun": "2026-04-07T09:00:00Z"
}
```
Als het bestand niet bestaat: gebruik alleen Slack als state (lees laatste 30 berichten).

## Autonome selectie — welke kantoren deze week?

Bij een scheduled run (of manuele "doe linkedin" zonder specifiek kantoor) kiest de skill
zelf welke kantoren worden opgepakt. Logica:

1. **Haal alle proefperiode-deals op** uit HubSpot
2. **Filter weg** wat al volledig verwerkt is (check linkedin_state.json + Slack-berichten)
3. **Prioriteitsvolgorde:**
   - Proefperiode-deals: altijd eerst
   - Recente deals (< 4 weken oud): daarna
   - Overige pipeline-kantoren: als er ruimte is
4. **Kies 2-3 kantoren per week** — niet meer, om LinkedIn rate-limiting te voorkomen
5. **Post het plan in Slack** (thread-reply) voordat je begint met connecten

Als alle proefperiode-kantoren al verwerkt zijn → post dit in Slack en vraag Jelle
of hij wil uitbreiden naar andere pipeline-kantoren.

Als er vragen zijn (bijv. welk kantoor bij een deal hoort, of een kantoornaam onduidelijk is)
→ post de vraag als thread-reply in #linkedin-connect en stop de run.

## Doel

Jelle wil dat alle advocaten, juridisch ondersteuners en secretaresses van advocatenkantoren in zijn LinkedIn-netwerk zitten. Wanneer hij een kantoornaam noemt, stuur je connectieverzoeken naar alle medewerkers. Het gaat puur om het klikken op "Connect" — nooit een bericht, nooit een persoonlijke notitie.

## Waarom dit belangrijk is

Als Legal Mind-oprichter in de advocatuur is Jelle's LinkedIn-bereik cruciaal. Wanneer hij content post, moet die zichtbaar zijn voor zoveel mogelijk mensen in de branche. Door systematisch te connecten met medewerkers van advocatenkantoren bouwt hij een relevant netwerk op.

## Vereisten

- **Claude in Chrome** browser-tools (navigate, computer, read_page, tabs_create_mcp, tabs_close_mcp, javascript_tool)
- Jelle moet ingelogd zijn op LinkedIn in Chrome

## Workflow

### Stap 0: Slack-check & Planning (scheduled en autonome runs)

Doe dit altijd als eerste bij een scheduled of autonome run:

1. **Lees #linkedin-connect** — check openstaande vragen en vorige week's rapport:
   ```
   slack_read_channel(channel_id: "C0ARX7VNDC6", limit: 20)
   ```
2. **Zijn er onbeantwoorde vragen?** → beantwoord die eerst (of check thread op antwoorden van Jelle)
3. **Lees linkedin_state.json** (als die bestaat) voor verwerkte kantoren
4. **Haal HubSpot-data op** (proefperiode deals + recente deals) — zie "HubSpot" sectie
5. **Selecteer 2-3 kantoren** op basis van prioriteit — zie "Autonome selectie"
6. **Post weekbericht** in #linkedin-connect als nieuw top-level bericht
7. **Post plan** als thread-reply: welke kantoren, waarom, in welke volgorde

Bij een **manuele run met specifiek kantoor** (bijv. "connect met De Brauw"):
- Sla Stap 0 over, ga direct naar Stap 1
- Post wel een startbericht in #linkedin-connect: `🔗 Manuele run: [Kantoornaam] — bezig...`

### Stap 1: Bedrijf zoeken op LinkedIn

Navigeer direct naar de Companies-zoekresultaten via URL. Dit is sneller en betrouwbaarder dan handmatig de zoekbalk te gebruiken:

```
https://www.linkedin.com/search/results/companies/?keywords=KANTOORNAAM
```

Klik vervolgens op het juiste advocatenkantoor:
- Let op: LinkedIn kan een spellingsuggestie tonen ("Did you mean...?") — klik daar op als relevant
- Controleer dat je het juiste kantoor hebt: check op "Law Practice" als industry en vestiging in Nederland
- Bij meerdere resultaten met dezelfde naam: kies het kantoor met de meeste followers en "Law Practice" als industry

### Stap 2: Navigeer naar People tab

Navigeer direct naar de People-pagina via URL (betrouwbaarder dan op de tab klikken, want soms laadt de tab niet goed):

```
https://www.linkedin.com/company/BEDRIJFSNAAM/people/
```

Wacht 2-3 seconden tot de pagina volledig geladen is. Je ziet eerst statistieken (Where they live, Where they studied) — de medewerkerkaarten staan daaronder.

**Voorbij de statistieken scrollen**: De LinkedIn People-pagina heeft een sticky header die normaal scrollen bemoeilijkt. Gebruik `javascript_tool` met `window.scrollTo(0, 1200)` om direct voorbij de statistieken te scrollen naar de medewerkerkaarten. Controleer met een screenshot of je de kaarten ziet — zo niet, scroll iets verder.

### Stap 3: Medewerkers scannen met JavaScript

Gebruik `javascript_tool` om alle medewerkerkaarten in bulk te scannen. Dit is veel efficiënter dan visueel kaart voor kaart door te lopen. De CSS-selector voor kaarten is `.org-people-profile-card__profile-card-spacing`, en de naam zit in `.artdeco-entity-lockup__title`.

Scan per kaart de knoptekst en categoriseer:

| Knop | Actie |
|------|-------|
| **Connect** | ✅ KLIK — dit is wat we zoeken |
| **Pending** | ⏭ SKIP — verzoek al verstuurd, tel als "al verstuurd" |
| **Message** | ⏭ SKIP — al verbonden (1e graad), tel als "al geconnect" |
| **Follow** | 🔍 OPEN PROFIEL — zie sectie "Follow-knoppen afhandelen" |
| Geen knop / "LinkedIn Member" | ⏭ SKIP — verborgen profiel of Jelle zelf, tel als "overgeslagen" |

### Stap 4: Connect-knoppen klikken

Werk alle Connect-knoppen één voor één af. Je kunt de knop vinden en klikken via JavaScript, maar de modal die verschijnt moet je visueel afhandelen.

#### Na het klikken op Connect — drie mogelijke reacties:

1. **"Add a note?" modal** met knoppen "Add a note" en "Send without a note"
   → Klik op **"Send without a note"**. Dit is de meest voorkomende reactie.

2. **"You're growing your network!" popup** met een tip en een "Got it" knop
   → Dit betekent dat de Connect **al direct is verstuurd** (zonder note-keuze). Klik op **"Got it"** om de popup te sluiten en ga door. Dit gebeurt soms bij 2e-graads connecties met veel mutual connections.

3. **"Email required"** of **verplicht bericht** (geen optie om zonder notitie te sturen)
   → **Sluit de modal** en sla deze persoon over. Tel als "overgeslagen".

We sturen **NOOIT** een bericht of notitie mee. Geen uitzonderingen.

**Tempo**: Wacht ~1-2 seconden tussen elke Connect-klik (de `wait` na de modal-klik is voldoende).
**Rate limiting**: Als LinkedIn een waarschuwing toont over te veel verzoeken → **STOP DIRECT** en meld aan Jelle.

### Stap 5: Follow-knoppen afhandelen

Wanneer je een "Follow"-knop ziet bij iemand op de People-pagina, zit de "Connect"-optie vaak verstopt in het "More" (···) menu op hun profielpagina. Check dit als volgt:

1. Zoek de profiel-URL via JavaScript: scan de `<a>`-tags in de kaart voor een link met `/in/` in het pad
2. Open een **nieuw tabblad** via `tabs_create_mcp` + `navigate` naar `https://www.linkedin.com/in/PROFIELNAAM`
   - **Gebruik NIET Ctrl+click** — dit opent het tabblad buiten de MCP tab group en is dan niet bereikbaar
3. Bekijk de knoppen op het profiel:
   - Als er direct een **"Connect"** knop zichtbaar is → klik erop
   - Als er "Follow" + "Message" + "···" staat → klik op het **"More" (···) menu** en zoek **"Connect"**
   - Als er nergens een Connect-optie is → sla over
4. Bij een Connect-klik verschijnt weer de "Add a note?" modal → klik **"Send without a note"**
5. **Sluit het tabblad** via `tabs_close_mcp` en ga terug naar de People-pagina

**Let op**: Na het sturen van Connect via een profiel-pagina, blijft de People-pagina nog steeds "Follow" tonen bij die persoon. Dit is normaal — de pagina ververst niet automatisch. Houd zelf bij dat je deze persoon al hebt afgehandeld (tel mee als "verstuurd via profiel").

### Stap 6: Paginering — "Show more results"

LinkedIn toont niet alle medewerkers tegelijk. Na het verwerken van alle zichtbare kaarten:

1. Zoek de **"Show more results"** knop via JavaScript: `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim().toLowerCase().includes('show more'))`
2. Klik erop en wacht 2-3 seconden tot nieuwe kaarten geladen zijn
3. Scan en verwerk de nieuw geladen kaarten (dezelfde JavaScript-scan als in Stap 3)
4. **Herhaal dit proces** totdat er geen "Show more results" knop meer is
5. Bij grote kantoren (50+ medewerkers) kan dit meerdere rondes kosten — blijf klikken!

**Efficiënte werkwijze bij meerdere rondes**: Na elke "Show more" klik, scan opnieuw ALLE kaarten op de pagina. De nieuwe kaarten worden onder de bestaande toegevoegd. Focus alleen op kaarten met "Connect" of "Follow" status die je nog niet hebt verwerkt.

### Stap 7: Opruimen

Wanneer alle medewerkers verwerkt zijn:

1. **Sluit alle extra tabbladen** die je geopend hebt (profiel-tabbladen van Follow-checks) via `tabs_close_mcp`
2. Laat alleen het originele tabblad open

### Stap 8: Rapportage

Na elk kantoor: post het rapport als **thread-reply** in #linkedin-connect (op het weekbericht).
Toon ook in de Cowork-chat. Gebruik dit gestandaardiseerde format:

```
📊 *LinkedIn Connect — [Kantoornaam]*
_(proefperiode / pijplijn / handmatig)_

👥 Medewerkers gevonden:          [aantal]
✅ Connectieverzoek verstuurd:     [aantal] (waarvan [X] via profiel)
⏳ Al verstuurd (Pending):         [aantal]
🤝 Al geconnect (Message):         [aantal]
👁 Follow (geen Connect mogelijk): [aantal]
⏭ Overgeslagen (overig):          [aantal]
⚠️ Problemen:                      [beschrijving of "geen"]

📊 Proefperiode totaal: [X]/[Y] kantoren volledig verbonden
```

Na het laatste kantoor van de week: post een **weekafsluiting** als thread-reply:
```
✅ *Week [weeknummer] afgerond*

Verwerkt: [Kantoor A] ([X] connects), [Kantoor B] ([Y] connects)
Totaal deze week: [Z] connectieverzoeken verstuurd
Proefperiode: [X]/[Y] kantoren volledig verbonden

Volgende week op de planning: [preview van 1-2 kantoren]
```

Werk `linkedin_state.json` bij na elk kantoor — voeg toe aan `processedKantoren`.

De "via profiel" specificatie in de Connect-regel is belangrijk: het laat Jelle weten
dat je bij Follow-profielen het More-menu hebt gecheckt in plaats van ze te skippen.

### Stap 8b: Supabase — schrijven naar DB

> **Fase 4 — linkedin-connect schrijft zelf naar Supabase.**
> Twee onderdelen: (1) voortgang per kantoor naar `linkedin_progress`,
> (2) één run-record naar `agent_runs`.
> MCP prefix: `mcp__7a90b865-a649-4156-8646-6c3475a8118b__`

#### 8b-1. LinkedIn voortgang per kantoor (upsert)

Na elk verwerkt kantoor, upsert een record in `linkedin_progress`:

```sql
INSERT INTO linkedin_progress
  (week_number, year, company_name, pipeline_stage,
   connects_sent, connects_pending, batch_completed, notes, updated_at)
VALUES
  ([weeknummer],
   [jaar],
   '[kantoornaam]',
   '[proefperiode|pijplijn|handmatig]',
   [aantal connects verstuurd deze run],
   [aantal pending/al geconnect],
   [true als alle medewerkers verwerkt, false als er meer pagina's zijn],
   '[eventuele aantekening — bijv. "batch 2 nog te verwerken"]',
   now())
ON CONFLICT (week_number, year, company_name) DO UPDATE SET
  connects_sent    = linkedin_progress.connects_sent + EXCLUDED.connects_sent,
  connects_pending = EXCLUDED.connects_pending,
  batch_completed  = EXCLUDED.batch_completed,
  notes            = EXCLUDED.notes,
  updated_at       = now();
```

Gebruik `ON CONFLICT ... DO UPDATE` zodat een tweede batch in dezelfde week
de totalen optelt in plaats van overschrijft.

#### 8b-2. Agent run (één record per volledige run)

Na het laatste kantoor van de run, schrijf één `agent_runs` record:

```sql
INSERT INTO agent_runs
  (agent_name, status, summary, stats, started_at, completed_at, slack_channel)
VALUES
  ('linkedin-connect',
   '[success|warning|error]',
   '[bijv. "39 connects verstuurd — JPR volledig, Kneppelhout batch 1" — max 200 tekens]',
   '{
     "connects_sent":        [totaal verstuurd],
     "companies_processed":  [aantal kantoren],
     "companies_completed":  [volledig afgerond],
     "follows":              [aantal follows],
     "already_connected":    [aantal al geconnect/pending]
   }'::jsonb,
   '[starttijd ISO]'::timestamptz,
   now(),
   'C0ARX7VNDC6');
```

**Status-bepaling:**
- `success` — minstens 1 connect verstuurd of bewust 0 als limiet bereikt
- `warning` — run gelukt maar met problemen (rate limit, profiel niet bereikbaar)
- `error` — Chrome niet bereikbaar, LinkedIn crash, of 0 kantoren verwerkt

**Altijd uitvoeren**, ook bij een lege of mislukte run.

## Voorbeeldinteracties

**Voorbeeld 1:**
```
Jelle: "Connect met De Brauw"
→ Navigeer naar linkedin.com/search/results/companies/?keywords=De+Brauw
→ Klik bedrijf → Navigeer naar /people/ → JavaScript-scan → Connect bij iedereen → rapport
```

**Voorbeeld 2:**
```
Jelle: "Stuur connectieverzoeken naar Ploum"
→ Navigeer naar linkedin.com/search/results/companies/?keywords=Ploum
→ Klik bedrijf → Navigeer naar /people/ → JavaScript-scan → Connect bij iedereen → rapport
```

**Voorbeeld 3:**
```
Jelle: "Netwerk uitbreiden bij Kneppelhout"
→ Navigeer naar linkedin.com/search/results/companies/?keywords=Kneppelhout
→ Klik bedrijf → /people/ → JavaScript-scan → Connect bij iedereen → rapport
```

## Edge cases

- **Bedrijfspagina niet gevonden**: Meld dit en probeer alternatieve spelling of zoek via People-search met company filter
- **Groot kantoor (100+ medewerkers)**: Ga gewoon door met Show more results, maar wees alert op LinkedIn rate-limiting
- **Spelfouten**: LinkedIn toont vaak "Did you mean...?" — gebruik die suggestie
- **Meerdere bedrijven met dezelfde naam**: Kies het kantoor met "Law Practice" als industry en gevestigd in Nederland
- **"LinkedIn Member" zonder foto/naam**: Dit zijn verborgen profielen. Overslaan en tellen als "overgeslagen (overig)"
- **People-pagina laadt niet goed**: Als de read_page zoekresultaten toont in plaats van de People-tab, navigeer direct via URL: `https://www.linkedin.com/company/NAAM/people/`
- **Statistieken blokkeren de view**: Gebruik `javascript_tool` met `window.scrollTo(0, 1200)` of hoger om voorbij de statistieken te scrollen

## Veiligheidsregels

1. **NOOIT een bericht of notitie meesturen** — alleen simpele Connect-klik of "Send without a note"
2. **STOP bij LinkedIn-waarschuwingen** over te veel activiteit — post direct in #linkedin-connect:
   `⚠️ LinkedIn rate-limit waarschuwing — gestopt na [X] connects bij [kantoor]. Morgen verdergaan?`
3. **Maximaal 2-3 kantoren per week** bij scheduled runs — voorkomt rate-limiting
4. **Altijd rapporteren** in het standaardformat, zowel in Slack als Cowork-chat
5. **Tabbladen opruimen** na afloop via tabs_close_mcp
6. **Vragen in Slack** — als de skill niet verder kan (kantoornaam onduidelijk, HubSpot-data
   ontbreekt, LinkedIn niet bereikbaar): post een vraag in #linkedin-connect en stop de run.
   Ga NIET verder gissen — wacht op antwoord van Jelle in de thread.
7. **State bijwer