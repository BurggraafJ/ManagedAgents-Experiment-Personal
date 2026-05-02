---
name: kilometerregistratie
description: >
  Verwerkt zakelijke ritten en reiskosten tot een complete kilometerregistratie in Excel
  voor Burggraaf Group B.V. Draait automatisch op de 2e van elke maand en verwerkt de
  vorige maand. Alle communicatie verloopt via Slack (#kilometerregistratie, Personal Ops
  workspace). Gebruik deze skill wanneer Jelle vraagt om reiskosten te verwerken, een
  maand uit te lezen, ritten te registreren, parkeerkosten toe te voegen, of de
  kilometerregistratie bij te werken. Trigger ook bij: "doe [maand]", "lees [maand] uit",
  "verwerk mijn ritten", "kilometerregistratie", "reiskosten", "parkeerkosten",
  "reiskostendeclaratie", of wanneer het Excel-bestand reiskosten_2026.xlsx ter sprake
  komt. Trigger ook wanneer Jelle "doe [maand]" of "verwerk [maand]" in Slack post.
  Trigger NIET voor algemene Excel-vragen die niets met reiskosten te maken hebben.
---

# Kilometerregistratie & Reiskosten 2026 – Burggraaf Group B.V.

## Trigger & DB-schrijfgedrag

**Trigger-bron:**
- Primair: orchestrator (`agent-orchestrator` skill, draait elke 30 min 06:00–22:30).
  De orchestrator leest `agent_schedules.cron_expression = 0 9 2 * *` en bepaalt of deze agent aan de beurt is.
- Handmatig: "doe [maand]", "verwerk [maand]" in #kilometerregistratie of Slack.
- Per-agent Cloud scheduled tasks zijn UIT — enige externe trigger is de orchestrator.

**Cron in agent_schedules:** `0 9 2 * *` (2e van de maand, 09:00 — verwerkt de vorige kalendermaand)

**Schrijft naar Supabase:**
- `agent_runs` — eigen run-record aan einde van elke uitvoering, volgens v1-contract (zie `agent-handbook/references/logging.md`). Verplicht: `schema_version='1'` (string), `skill_version`, `triggered_by`, `triggered_at`, `passes[]`, `warnings[]`, `counts{}` met agent-specifieke metrics (`ritten`, `totaal_km`, `km_vergoeding`, `parkeerkosten`, `totaal`).
- `km_trips` — per rit één record.
- `agent_config['kilometerregistratie']['laatste_verwerkte_maand']` — upsert na verwerking.

**Update `agent_schedules` zelf niet** — de orchestrator updatet `last_run_at`, `next_run_at` en de run-lock. Deze agent raakt die kolommen niet aan.

**Voorbeeld insert voor `agent_runs` (v1-contract):**
```sql
INSERT INTO agent_runs (agent_name, status, summary, stats, started_at, completed_at, slack_channel)
VALUES ('kilometerregistratie', '<status>', '<korte summary>',
  jsonb_build_object(
    'schema_version', '1',                    -- STRING "1" — nooit integer
    'skill_version',  'kilometerregistratie-v3',
    'mode',           null,
    'triggered_by',   '<orchestrator|manual|slack>',
    'triggered_at',   '<ISO-8601>',
    'passes',         '[]'::jsonb,
    'warnings',       '[]'::jsonb,
    'counts',         jsonb_build_object(
      'ritten',         <N>,
      'totaal_km',      <Km>,
      'km_vergoeding',  <V>,
      'parkeerkosten',  <P>,
      'totaal',         <T>
    ),
    'extra',          '{}'::jsonb
  ),
  '<start-ISO>'::timestamptz, now(), 'kilometerregistratie');
```

---

## Slack

> **Verplicht:** Lees de `slack-communication` skill (SKILL.md) vóór je een Slack-bericht
> stuurt. Die bevat alle channel IDs, emoji-conventies, berichtformaten, threading-protocol
> en foutafhandeling. Alles hieronder is kilometerregistratie-specifiek en veronderstelt
> dat je de slack-communication skill gelezen hebt.

Alle communicatie verloopt via Slack. Het kanaal is **#kilometerregistratie** in de
**Personal Ops** workspace (`personal-ops-group.slack.com`).

| Channel | ID |
|---|---|
| #kilometerregistratie | `C0ARSSS57BM` |

**Communicatiepatroon:**

- **Start van elke run** → post een startbericht in het kanaal:
  `🚗 Kilometerregistratie [maand] gestart — Outlook uitlezen...`
- **Conceptoverzicht** → post als bericht in het kanaal (splits in meerdere berichten
  als het te lang is). Sla de `ts` (timestamp) van dit bericht op — alle vervolgberichten
  gaan als thread-reply hierop.
- **Vragen** → post als thread-reply op het conceptoverzicht. Geef elk
  vraagnummer duidelijk aan zodat Jelle per nummer kan antwoorden.
- **Goedkeuring** → Jelle antwoordt in de thread ("akkoord", "goedgekeurd", of
  beantwoordt de vragen). Bij de volgende run (of direct als het een manuele run is):
  lees de thread uit en verwerk de antwoorden.
- **Resultaat na verwerking** → post een afrondingsbericht als thread-reply:
  `✅ [maand] verwerkt — [X] ritten, [Y] km, EUR [Z]. Excel bijgevoegd.`

**Vóór elke run:** controleer eerst of er openstaande thread-replies zijn van Jelle
(antwoorden op vragen uit een vorige run). Als die er zijn, verwerk die eerst
voordat je nieuwe Outlook-data ophaalt.

## Schedule

De skill draait **automatisch op de 2e van elke maand** en verwerkt dan de
**vorige kalendermaand** volledig (Outlook uitlezen → conceptoverzicht → Excel).

- **Scheduled run:** 2e van de maand, verwerkt vorige maand automatisch.
  Post direct een startbericht in #kilometerregistratie zodat Jelle weet dat het
  loopt. Als er vragen zijn, post die in de thread — Jelle beantwoordt ze, en de
  skill verwerkt de antwoorden bij de volgende manuele run of een herstart.
- **Manuele run:** Jelle typt "doe [maand]" in Cowork chat OF post "doe [maand]"
  in #kilometerregistratie. Zelfde flow als de scheduled run.

**Bepaal bij een scheduled run de te verwerken maand** op basis van de huidige datum:
als het de 2e is, is de te verwerken maand de vorige kalendermaand
(bijv. 2 mei → verwerk april).

## Eerste stap: lees de xlsx skill

Lees ALTIJD eerst de xlsx skill (SKILL.md) voordat je het Excel-bestand bewerkt.
Die skill bevat essentieel informatie over openpyxl, formules en recalculatie.

## Het Excel-bestand

Het bestand `reiskosten_2026.xlsx` zit gebundeld in `assets/` van deze skill.
Kopieer het naar je werkmap als startpunt, tenzij Jelle een recentere versie uploadt — gebruik dan die.

**Bij elke nieuwe sessie:** lees ALLE tabbladen van de Excel door voordat je begint.
Begrijp welke maanden al gevuld zijn en welke nog leeg.

## Bedrijfsgegevens

- **Bedrijf:** Burggraaf Group B.V. | **KvK:** 96581840 | **Bestuurder:** J. Burggraaf
- **Tarief 2026:** EUR 0,21 per kilometer
- **Thuisadres jan 2026:** Nieuwe Tielseweg 43, 4001 JT Tiel
- **Thuisadres vanaf 1 feb 2026:** Bulckesteynstraat 15, 4158 CR Deil

Alle afstanden zijn vanaf februari gebaseerd op Deil. Januari-afstanden wijken af (Tiel).

**BELANGRIJK — Notatie thuisadres in alle output:**
- Vanaf februari: schrijf ALTIJD **"Deil (thuis)"**, nooit alleen "Deil".
- Januari: schrijf ALTIJD **"Tiel (thuis)"**, nooit alleen "Tiel".
- Dit geldt voor het conceptoverzicht, de voorstelberekening, EN de Excel-ritten in kolom C.
- Voorbeeld: "Rit 1: Deil (thuis) → Amsterdam (68,4)" en "Amsterdam → Deil (thuis) (68,4)".

## Werkwijze — het 6-stappenproces

### Stap 0: Slack-check (altijd als eerste)

Lees bij elke run eerst #kilometerregistratie uit (`slack_read_channel`) om te zien:
1. Of er een openstaande thread is met onbeantwoorde vragen van een vorige run.
2. Of Jelle al een antwoord/goedkeuring heeft gepost in een bestaande thread.

Als er een openstaande thread is met Jelle's antwoorden → verwerk die eerst, ga dan
door met de normale flow. Als er een openstaande thread is zonder antwoord → post een
korte herinnering als thread-reply en stop de run.

Post daarna een startbericht: `🚗 Kilometerregistratie [maand] gestart — Outlook uitlezen...`
Sla de `ts` van dit bericht op voor alle vervolgberichten als thread-reply.

### Stap 1: Input ontvangen

Er zijn vier methoden:

**Methode A – Outlook uitlezen (voorkeur):**
Jelle zegt "doe [maand]" of "lees [maand] uit" (in Cowork of in #kilometerregistratie).
Gebruik dan `outlook_calendar_search` om alle events van die maand op te halen.

**LET OP — paginering:** Outlook geeft max ~50 events per call. Splits de maand in
meerdere zoekopdrachten (bijv. 1-15 en 15-einde) zodat je GEEN werkdagen mist.
Controleer na het ophalen dat je events hebt voor ELKE werkdag van de maand.
Als een werkdag of volledige week ontbreekt, doe ALTIJD een gerichte re-query voor
die specifieke periode — ga nooit er vanuit dat een week echt leeg is zonder re-check.
Lege weken in Outlook-resultaten zijn vrijwel altijd een pagineringsprobleem, geen echte leegte.

Analyseer elk event op basis van de signaalregels hieronder.

**Methode B – Slack-trigger:** Jelle post "doe [maand]" in #kilometerregistratie.
De skill herkent dit bij de volgende run als een manuele opdracht en verwerkt die maand.

**Methode C – Spraak/tekst:** Jelle dicteert of typt zijn ritten.

**Methode D – Combinatie:** Outlook uitlezen + Jelle corrigeert.

#### Signaalregels voor Outlook — events grondiger uitlezen

Analyseer ALLE velden van elk event, niet alleen het "location" veld:

1. **Locatie-veld**: Fysiek adres = sterke aanwijzing (V)
2. **Categorie**: Blauwe categorie = fysiek op locatie (V). Rode categorie = privé → OVERSLAAN
3. **Titel/subject**: Check op bekende firmanamen (zie "Kantooradressen herkennen" hieronder)
4. **Body/summary**: Zoek naar adressen, gebouwnamen, verdiepingen, "boardroom", "kantoor"
5. **"In-person"** in titel = fysiek (V)
6. **Teams/Google Meet/Zoom URL** in locatie = online (geen rit)

**Standaardpatroon werkdagen (BELANGRIJK):**
- **Ma/wo/vr = ALTIJD Legal Mind Amsterdam** — markeer direct als **V**, geen vragen stellen.
  Uitzonderingen (enkel dan twijfelen):
  - Er is een **aantoonbaar fysiek event op een andere locatie ver van Amsterdam** (klantbezoek
    Haarlem, Rotterdam, etc.) dat de dag vult — vraag dan of dat naast JH400 is of in plaats van.
  - Er is een expliciete afwezigheid (vakantienotitie, ziekmelding).
  - **NIET** twijfelen als alle events Teams/online zijn: Jelle werkt op kantoor ook met Teams-calls.
  - **NIET** twijfelen bij groene categorie events (Burggraaf Group admin): Jelle doet dit ook vanuit Amsterdam.
- **Di/do = variabel** (Amsterdam, Geldermalsen, thuis, klant). Check events op fysieke
  locatie-aanwijzingen. Als alles Teams/online is → waarschijnlijk thuisdag, maar check
  of er blauwe categorie events zijn voor extra zekerheid.

**Spraakinvoer-correcties** — Jelle dicteert vaak via spraak. Herken deze varianten:
- "Jozan Advocaat" / "Jozan" = **Joosten Advocaten** (Noordhollandstraat 71, Amsterdam)
- "Schildermalsen" / "Schildermaalzen" = **Geldermalsen** (Burggraaf Group kantoor)
- "Rewin" / "Reewin" = persoonstitel Rebin (controleer of zakelijk)
- Spellingsvarianten van bekende kantoren altijd matchen tegen references/afstanden.md

**Hybride uitnodigingen** (fysiek adres + Teams-link in body): als het locatieveld een
fysiek adres bevat én er een blauwe categorie is → ALTIJD markeer als V (fysiek aanwezig).
De Teams-link is bedoeld voor externe/remote deelnemers, niet voor Jelle zelf.

**Privé-events (rode categorie):** NOOIT tonen in het overzicht. Maar sla de werkdag
zelf NIET over — check of er ook zakelijke events op die dag staan.

#### Kantooradressen herkennen

Wanneer een firmanaam in een Outlook-event verschijnt maar GEEN volledig adres:

1. **Check `references/afstanden.md`** — staat de firma erin?
   - **Ja, één locatie** → gebruik dat adres automatisch, markeer als V
   - **Ja, meerdere locaties** → vraag Jelle welke
   - **Nee** → ga naar stap 2
2. **Zoek het kantooradres op** via websearch ("kantoor [firmanaam] adres")
3. **Controleer het event** — soms staat het adres in de body/summary, niet in het locatie-veld
4. **Presenteer het gevonden adres** in het conceptoverzicht met een ? markering
5. **Na bevestiging door Jelle** → voeg toe aan references/afstanden.md EN Excel Instructies-tab

**Voorbeeld:** Event "introductie Legal Mind" met locatie "HabrakenRutten (boardroom)"
→ Check references → Habraken Rutten staat erin → Gustav Mahlerplein 70, Amsterdam
→ Gebruik dat adres automatisch, markeer V.

#### Conceptoverzicht met statusiconen (bij Outlook)

Presenteer het overzicht **per week gegroepeerd** met visuele opmaak.
Gebruik **dikgedrukt** voor bestemmingen, *cursief* voor opmerkingen, en duidelijke status-iconen.

```
### Week 1 (2–6 februari)

| | Datum | Bestemming | Ritten | Km | |
|---|-------|-----------|--------|-----|---|
| **V** | **(ma) 2 feb** | **Legal Mind, Amsterdam** | Deil (thuis) → JH400 (68,4) / retour | **136,8** | Sales Meeting |
| **?** | **(di) 3 feb** | **Thuisdag?** | *Alleen Teams-calls zichtbaar* | **0?** | *Bevestiging nodig* |
| **X** | **(wo) 4 feb** | **Onbekend** | *Geen events gevonden* | **—** | *Vraag nodig* |
```

**Statusiconen:**
- **V** = Zeker (vet) — fysiek adres bevestigd of standaardpatroon
- **?** = Onzeker — waarschijnlijk thuisdag maar niet 100% zeker
- **X** = Onbekend — geen info, vraag nodig

**Multi-stop dagen** duidelijk markeren met de volledige route:
```
| **V** | **(do) 5 feb** | **Multi-stop: Doetinchem → Enschede** | Deil (thuis) → JPR (~80?) / JPR → Kienhuis (~63) / Kienhuis → Deil (thuis) (~130?) | **~273?** | JPR + Kienhuis |
```

### Stap 2: Voorstelberekening

Maak ALTIJD EERST een voorstel — post dit als bericht in #kilometerregistratie
(als thread-reply op het startbericht). Toon het ook in de Cowork-chat.

Structuur van het Slack-bericht (compact, want Slack heeft geen tabellen):
```
📋 *Conceptoverzicht [maand] 2026*

✅ (ma) 2 feb — Legal Mind Amsterdam — 136,8 km
❓ (di) 3 feb — Thuisdag? (bevestiging nodig)
❌ (wo) 4 feb — Onbekend

*Totaal: ~XXX km | EUR XX,XX*
Vragen staan hieronder 👇
```

Lever het gedetailleerde voorstel ook op als .txt-bestand in de outputs-map
(`voorstel_[maand]_2026.txt`) — zie originele Stap 2 hieronder.

Maak ALTIJD EERST een voorstel voordat je de Excel aanraakt:

```
| Datum               | Omschrijving | Ritten                                        | Km    | Vergoeding |
|---------------------|-------------|-----------------------------------------------|-------|------------|
| (ma) 2 februari 2026| Legal Mind  | Rit 1: Deil (thuis) → Amsterdam (68,4)        | 136,8 | EUR 28,73  |
|                     |             | Rit 2: Amsterdam → Deil (thuis) (68,4)        |       |            |
```

- Gebruik bekende afstanden uit `references/afstanden.md`
- Onbekende afstanden: zoek op via de methode in "Afstanden opzoeken" en markeer met ?
- Toon totaal kilometers, totaal vergoeding, aantal werkdagen
- Parkeerkosten apart tonen onder de ritten
- **Toon per rit de afstand per leg** — bijv. "Deil (thuis) → JPR (90,4) / JPR → Kienhuis (61,2) / Kienhuis → Deil (thuis) (149,0)". Dit maakt het overzichtelijk en controleerbaar.
- **Lever het voorstel ook op als kopieerbaar tekstbestand** (`voorstel_[maand]_2026.txt`) in de outputs-map, zodat Jelle het makkelijk kan doorlezen en bevestigen.

### Stap 3: Vragen stellen

Stel ALLE ontbrekende vragen in een keer — post als thread-reply op het startbericht
in #kilometerregistratie. Geef elk vraagnummer duidelijk aan zodat Jelle per nummer
kan antwoorden in de thread.

Slack-format voor vragen:
```
❓ *Vragen voor [maand]*

1. Donderdag 5 feb — thuisdag of had je een afspraak?
2. Nieuwe klant Tilburg — wat is het exacte adres?
```

In de Cowork-chat ook in tabelvorm tonen:

```
| # | Wat ontbreekt                    | Vraag                                        |
|---|----------------------------------|----------------------------------------------|
| 1 | Nieuwe klant Tilburg             | Wat is het exacte adres en afstand?           |
| 2 | Donderdag 5 feb                  | Thuisdag of had je een afspraak?              |
```

**Na kleine naronde (stap 3B):** als Jelle een paar vragen beantwoordt, toon NIET
het hele overzicht opnieuw. Benoem alleen de wijzigingen en ga door naar goedkeuring.

### Stap 4: Goedkeuring

Goedkeuring kan op twee manieren binnenkomen:
- **Via Cowork chat:** Jelle typt "akkoord" of "goedgekeurd".
- **Via Slack:** Jelle post een reply in de thread van het conceptoverzicht.

Bij een **scheduled run**: als het conceptoverzicht is gepost in Slack maar Jelle nog
niet heeft geantwoord, stop de run dan. De volgende run (of manuele trigger) checkt
de thread opnieuw (Stap 0) en gaat verder zodra de goedkeuring er is.

Vraag altijd expliciet:
1. "Klopt dit overzicht? Dan verwerk ik het in de Excel."
2. Als er nieuwe afstanden zijn: "Mag ik [locatie] ([km]) toevoegen aan het Instructies-tabblad?"

**Verwerk NOOIT zonder goedkeuring. Voeg NOOIT afstanden toe zonder toestemming.**

**Snelle doorverwerking:** Na goedkeuring van het voorstel NIET opnieuw bevestiging vragen
voor de Excel-verwerking. Het voorstel IS de goedkeuring — ga direct door naar stap 5.
Eén goedkeuringsmoment is genoeg; vermijd onnodige tussenstops.

### Stap 5: Verwerken in Excel

Na goedkeuring — lees dan eerst de xlsx SKILL.md en volg die werkwijze:

1. Open de Excel (uit assets/ of Jelle's upload)
2. Voeg ritten toe aan het juiste maandtabblad **met weekindeling** (zie "Weekindeling" hieronder)
3. Voeg parkeerkosten toe (onder de ritten in hetzelfde tabblad)
4. Werk totaalformules bij (SUM-bereik uitbreiden)
5. Werk het Overzicht-tabblad bij met de maandtotalen
6. Voeg nieuwe afstanden toe aan Instructies-tabblad (als goedgekeurd)
7. Voeg nieuwe afstanden ook toe aan `references/afstanden.md`
8. Recalculeer met `scripts/recalc.py`
9. Presenteer het bestand

### Stap 5b: Slack afronden

Na het verwerken in Excel, post een afrondingsbericht als thread-reply in
#kilometerregistratie:

```
✅ *[Maand] verwerkt*

📍 X ritten | Y km | EUR Z,ZZ km-vergoeding
🅿️ Parkeerkosten: EUR P,PP
💰 Totaal: EUR T,TT

Excel bijgewerkt. Mail aan accountant volgt 👇
```

### Stap 5c: Supabase — schrijven naar DB

> **Fase 4 — kilometerregistratie schrijft zelf naar Supabase.**
> Drie onderdelen: (1) ritten naar `km_trips`, (2) config update naar `agent_config`,
> (3) één run-record naar `agent_runs`.
> MCP prefix: `mcp__7a90b865-a649-4156-8646-6c3475a8118b__`

#### 5c-1. Ritten (per individuele rit)

Schrijf voor elke verwerkte rit een record in `km_trips`:

```sql
INSERT INTO km_trips
  (agent_name, trip_date, departure, destination, km, purpose, maand, stats)
VALUES
  ('kilometerregistratie',
   '[datum als YYYY-MM-DD]',
   '[vertrekpunt — bijv. "Amersfoort"]',
   '[bestemming — bijv. "Amsterdam (Legal Mind)"]',
   [aantal kilometer],
   '[doel — bijv. "Kantoordag Legal Mind"]',
   '[maand als YYYY-MM — bijv. "2026-03"]',
   '{"parking_costs": [parkeerkosten in euro of 0], "return_trip": true}'::jsonb)
ON CONFLICT (trip_date, departure, destination) DO NOTHING;
```

Voer de inserts uit na Stap 5 (Excel bijgewerkt). Één record per rit.

#### 5c-2. Config update (laatste verwerkte maand)

Na verwerking: update `agent_config` zodat het dashboard de laatste maand toont:

```sql
INSERT INTO agent_config
  (agent_name, config_key, config_value)
VALUES
  ('kilometerregistratie',
   'laatste_verwerkte_maand',
   '"[YYYY-MM — bijv. 2026-03]"')
ON CONFLICT (agent_name, config_key) DO UPDATE SET
  config_value = EXCLUDED.config_value,
  updated_at   = now();
```

#### 5c-3. Agent run (één record aan het einde)

Na Excel bijgewerkt en config updated, schrijf één `agent_runs` record volgens v1-contract:

```sql
INSERT INTO agent_runs
  (agent_name, status, summary, stats, started_at, completed_at, slack_channel)
VALUES
  ('kilometerregistratie',
   '[success|warning|error]',
   '[bijv. "Maart 2026 verwerkt: 12 ritten, 847 km, EUR 422,65" — max 200 tekens]',
   jsonb_build_object(
     'schema_version', '1',
     'skill_version',  'kilometerregistratie-v3',
     'mode',           null,
     'triggered_by',   '<orchestrator|manual|slack>',
     'triggered_at',   '[starttijd ISO]',
     'passes',         '[]'::jsonb,
     'warnings',       '[]'::jsonb,                         -- mag leeg, sleutel verplicht
     'counts',         jsonb_build_object(
       'ritten',         [aantal],
       'totaal_km',      [totaal kilometer],
       'km_vergoeding',  [bedrag in euro],
       'parkeerkosten',  [bedrag in euro],
       'totaal',         [km_vergoeding + parkeerkosten]
     ),
     'extra',          jsonb_build_object('maand', '[YYYY-MM]')
   ),
   '[starttijd ISO]'::timestamptz,
   now(),
   'C0ARSSS57BM');
```

**Status-bepaling:**
- `success` — Excel bijgewerkt, alle ritten verwerkt
- `warning` — Excel bijgewerkt maar vragen open of parkeerkosten geschat
- `error` — Excel niet beschikbaar of run gecrasht voor verwerking

Bij `error`: zet de fout in `agent_runs.errors[]`, niet in `stats`.

**Altijd uitvoeren**, ook bij een fout.

---

### Stap 6: Mail aan accountant

**Na het opleveren van de Excel**, stel ALTIJD automatisch een professionele mail op
voor de accountant. Dit is een standaard onderdeel van de verwerking.

**Ontvanger(s):**
- BurggraafGroup Finance <finance@burggraafgroup.nl>
- Joriena Weiman | Numberwise <joriena.weiman@numberwise.nl>

**Inhoud van de mail:**
- Aanhef: "Hi Joriena,"
- Verzoek: 2 facturen (per verwerkte maand) voor reiskosten naar Legal Mind
- Per maand tonen:
  - Kilometervergoeding: EUR [bedrag]
  - Parkeerkosten: EUR [bedrag]
  - Totaal: EUR [bedrag]
- Verwijzing naar Excel in bijlage ("zie bijgevoegd Excel-bestand waar alles uitgewerkt is")
- Parkeerkosten-bonnen meesturen als bijlage (ter inboeking voor Burggraaf Group)
- Afsluiting: "Dank! Vriendelijke groet, Jelle Burggraaf"

**Oplevering:**
- Sla de mail op als kopieerbaar tekstbestand: `mail_reiskosten_[maanden]_2026.txt`
- Vermeld bovenaan het bestand: Aan, CC, Onderwerp
- Professionele maar bondige toon (niet te formeel, niet te casual)
- Presenteer het bestand aan Jelle zodat hij het kan kopiëren naar Outlook

## Excel-structuur — samenvatting

**Overzicht:** Maandoverzicht met kolommen Maand | Dagen | Km | Tarief | KM-vergoeding | Parkeerkosten | Totaal. Formules verwijzen naar maandtotalen.

**Maandtabbladen:** Ritten met weekindeling (zie hieronder). Daaronder: TOTAAL KILOMETERS (SUM). Dan parkeerkosten-sectie. Dan TOTAAL REISKOSTEN.

**Instructies:** Kennisbank met afstanden, regels, kleurcodes.

## Weekindeling in maandtabbladen

Elke gevulde maand wordt visueel gegroepeerd per week. Dit maakt de registratie
veel leesbaarder.

**Structuur per maandtabblad:**

```
Row 4:  Headers (Datum | Omschrijving | Ritten | Kilometers | Vergoeding)
Row 5:  "Week 1 (5–9 januari)" — header (merged A-E, B4C6E7 achtergrond, bold 2F5496 font)
Row 6-10: Data Week 1
Row 11: Blank separator (hoogte 8px)
Row 12: "Week 2 (12–16 januari)" — header
Row 13-17: Data Week 2
...enzovoort per week...
Row N:  TOTAAL KILOMETERS (=SUM(eerste_data:laatste_data))
        Parkeerkosten sectie
        TOTAAL REISKOSTEN
```

**Opmaakregels weekheaders:**
- Achtergrondkleur: `B4C6E7` (lichtblauw)
- Font: Bold, 10pt, kleur `2F5496`
- Cellen A-E gemerged
- Rijhoogte: 20
- Tekst: "Week N (eerste_dag–laatste_dag maandnaam)" — bijv. "Week 2 (9–13 februari)"

**Blank separators tussen weken:**
- Rijhoogte: 8px
- Geen inhoud, geen opmaak

**Bij het vullen van een maand:** bereken de weekgrenzen op basis van de kalender.
Groepeer werkdagen (ma-vr) per ISO-week. Week 1 van een maand is de eerste werkweek
die (deels) in die maand valt.

**SUM-bereiken:** De SUM-formules voor totaal kilometers en vergoeding moeten het
volledige bereik van eerste tot laatste data-rij omvatten (inclusief de weekheader-rijen
en separator-rijen — die bevatten geen getallen en worden genegeerd door SUM).

## Opmaakregels

**Datumformat:** `(ma) 5 januari 2026`

**Ritten in cellen:** Elke rit op eigen regel met `chr(10)`. Nooit alles op een regel.

**Thuisadres in ritten:** Altijd "Deil (thuis)" of "Tiel (thuis)" schrijven, nooit alleen de plaatsnaam.

**Omschrijving:**
- Legal Mind = kantoor Amsterdam
- Burggraaf Group = werkplek Geldermalsen
- Bekende klant = bedrijfsnaam
- Onbekend = "Externe afspraak" of "Klantbezoek [Plaats]"
- Geen rit = "Thuisdag"
- Korte notitie (3-5 woorden) uit Outlook mag, alleen zakelijk

**Kleurcodes (openpyxl fgColor):**
- `FFF2CC` = Geel = Thuisdag
- `E2EFDA` = Groen = Burggraaf Group (Geldermalsen)
- `DDEBF7` = Blauw = Legal Mind (Amsterdam)
- Wit = Externe afspraken
- `FCE4D6` = Licht oranje = Parkeerkosten headers
- `F4B183` = Donker oranje = Parkeerkosten titel
- `B4C6E7` = Lichtblauw = Weekheader-rijen

**Vergoeding:** Altijd Excel-formule `=Dn*0.21`, geen hardcoded waarden.

## Retourrit-regel

Elke bestemming = heenrit + terugrit naar huis. Uitzonderingen:
- **Tussenstop:** meerdere bestemmingen op een dag -> A -> B -> C -> huis
- **Overnachting:** dag eindigt bij hotel, volgende dag start vanuit hotel

"Thuis" = Tiel (thuis) (jan) of Deil (thuis) (feb+).

## Parkeerkosten

Komen binnen als tekst, foto's van bonnen, of batch-uploads.

**Verwerking:** Lees bon uit (datum, locatie, bedrag, type) -> koppel aan rit van die dag -> voorstel tonen -> na goedkeuring in Excel.

**Type:** Standaard "EasyPark". Bij fysieke bon: "Handmatig – [type]".

**Proactief vragen** bij bestemmingen waar vaak parkeerkosten zijn (Den Haag, Haarlem, Enschede, Breda, Amsterdam extern).

## Afstanden opzoeken — methode

Als een afstand niet in `references/afstanden.md` staat, gebruik de volgende methode
(in volgorde van betrouwbaarheid):

### Primaire methode: Google Maps via Claude in Chrome

1. Open een nieuw tabblad via Claude in Chrome (`tabs_create_mcp`)
2. Navigeer naar `https://www.google.com/maps/dir/[vertrekadres]/[bestemmingsadres]`
   - URL-encode de adressen (spaties → +)
   - Voorbeeld: `https://www.google.com/maps/dir/Bulckesteynstraat+15+Deil/Sophiastraat+22+Breda`
3. Wacht tot de pagina geladen is, lees het resultaat uit via `get_page_text` of `read_page`
4. Zoek de rijafstand in kilometers (Google Maps toont dit prominent)
5. Rond af op 1 decimaal
6. Sluit het tabblad na gebruik

**Voordeel:** Exacte rijafstanden, betrouwbaar, consistent.

### Secundaire methode: WebSearch

Als Claude in Chrome niet beschikbaar is:
1. Zoek "rijafstand [volledig vertrekadres] naar [volledig bestemmingsadres] km"
2. Probeer meerdere zoektermen als de eerste geen resultaat geeft
3. Markeer het resultaat ALTIJD met ? in het voorstel

### Bij ALLE nieuwe afstanden:
- Markeer met **?** in de voorstelberekening
- Vraag Jelle ter bevestiging
- Na bevestiging: voeg toe aan `references/afstanden.md` EN aan het Instructies-tabblad in de Excel

### Tussenstop-afstanden

Bij multi-stop dagen (A → B → C → thuis) bereken je ELKE tussenafstand apart:
- Deil (thuis) → locatie A
- Locatie A → locatie B
- Locatie B → Deil (thuis)
Zoek elke deelafstand apart op. Voeg tussenstop-afstanden ook toe aan de sectie
"Afstanden tussen locaties" in references/afstanden.md.

## Veiligheidsregels

**NOOIT:**
- Bestaande ritgegevens verwijderen
- Bestaande afstanden verwijderen
- Bestaande parkeerkosten verwijderen
- Cellen met data overschrijven (tenzij Jelle expliciet om correctie vraagt)

**WEL:**
- Nieuwe rijen toevoegen
- Nieuwe afstanden toevoegen
- Totaalformules aanpassen (SUM-bereik uitbreiden)
- Correcties na expliciete vraag van Jelle
- Overzicht-tabblad bijwerken

**Bij twijfel: vraag het aan Jelle.**

## SharePoint beheer

Na het opleveren van de Excel in Stap 5, upload het bestand naar SharePoint voor
versiebeheer. Elke run krijgt zijn eigen versie zodat Jelle altijd terug kan naar
een eerdere versie.

**SharePoint-map:**
`bgintelligence.sharepoint.com` → Sites → MT → Management → Personeel → Jelle Burggraaf → Kilometerregistratie

**Directe link (bookmark):**
`https://bgintelligence.sharepoint.com/sites/MT/Management/Forms/AllItems.aspx?id=%2Fsites%2FMT%2FManagement%2FPersoneel%2FJelle%20Burggraaf%2FKilometerregistratie&viewid=74d3a7a8-d728-4b9c-8aa3-df34e78b7952`

**Upload-procedure (via Claude in Chrome):**
1. Open de SharePoint-link hierboven via `navigate` in Claude in Chrome
2. Gebruik `find` of `javascript_tool` om de upload-knop te vinden (SharePoint: "Uploaden" of "Upload")
3. Upload het bestand `reiskosten_2026.xlsx` — SharePoint beheert versiehistorie automatisch
4. Na succesvolle upload: kopieer de directe link naar het bestand
5. Post de SharePoint-link als thread-reply in #kilometerregistratie

**Naamgeving:** Upload altijd als `reiskosten_2026.xlsx` (overschrijf de vorige versie).
SharePoint slaat automatisch versiehistorie op, zodat oudere versies altijd bereikbaar zijn
via Versiegeschiedenis in de SharePoint-interface.

**Als upload mislukt:** Post in de Slack-thread dat de upload handmatig gedaan moet worden,
en zet het Excel-bestand klaar als download-link in de chat.

## Gedragsregels (samenvatting)

1. Altijd eerst voorstel, dan pas Excel
2. Alle vragen in een keer (tabelvorm in chat, genummerd in Slack)
3. Nooit verwijderen, alleen toevoegen
4. Afstanden op twee plekken: references/afstanden.md EN Excel Instructies-tabblad
5. Kleuren respecteren
6. Ritten op eigen regels (chr(10))
7. Excel-formules, geen hardcoded berekeningen
8. Datumformat: (ma) 5 januari 2026
9. Parkeerkosten in maandtabblad, niet apart
10. Privé NOOIT in Excel
11. Thuisadres ALTIJD als "Deil (thuis)" of "Tiel (thuis)" noteren
12. Conceptoverzicht per week groeperen met visuele opmaak (vet, iconen, variatie)
13. Firmanamen herkennen en adressen opzoeken uit references of via websearch
14. Ma/wo/vr = ALTIJD Legal Mind Amsterdam — geen vragen tenzij duidelijk ander fysiek event
15. Outlook-events grondig lezen: locatie, body, summary, categorie, firmanamen
16. Afstanden opzoeken via Google Maps (Claude in Chrome) als primaire methode
17. Bij multi-stop: elke tussenafstand apart berekenen en opslaan
18. Weekindeling in maandtabbladen — altijd Week 1/2/3/4 headers met separators
19. Per-leg km tonen — in voorstel elke rit de afstand per leg weergeven
20. Voorstel als tekstbestand — voorstelberekening ook als .txt opleveren
21. Mail aan accountant — na verwerking automatisch mail opstellen (stap 6)
22. Na goedkeuring direct doorwerken — geen extra bevestiging voor Excel-verwerking
23. Slack eerst — elke run begint met Stap 0: thread check + startbericht posten
24. Re-query lege weken — als een week leeg lijkt na Outlook-query, altijd opnieuw bevragen
25. Excel uploaden naar SharePoint na elke verwerking — gebruik Claude in Chrome
26. Spraakinvoer-varianten herkennen (Jozan=Joosten, Schildermalsen=Geldermalsen, etc.)
27. Groene categorie events = Burggraaf Group (Geldermalsen) — GEEN reden om ma als thuisdag te markeren