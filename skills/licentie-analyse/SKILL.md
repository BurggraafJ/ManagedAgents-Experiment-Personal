---
name: licentie-analyse
description: >
  Categoriseert licentie- en abonnementskosten uit AFAS-exports tot een
  begrijpelijk Excel-rapport. Splitst kosten in INTERN (team — Software,
  AI-tools, Tokens Intern) en EXTERN (klant — Tokens Extern / cloud).
  Stopgezette licenties worden apart getoond en tellen niet mee in
  maandgemiddeldes. Beslislijst is een verplaatsings­overzicht ("staat
  hier, hoort hier") plus open classificatievragen.
  Trigger bij: "licentiekosten", "AFAS export", "kosten per team",
  "wat kost een nieuwe medewerker", "categoriseer licenties",
  "tokenkosten", "cloudkosten", "financiële mutaties", "software budget",
  "AI kosten", "AI licenties", "token usage", "licentie analyse",
  "wat geven we uit aan licenties", "welke licenties kunnen weg",
  "intern vs extern", "klantkosten cloud".
  Trigger NIET voor kilometerregistratie, offertes, SLA's, of HubSpot
  CRM-taken.
---

# Licentie-analyse Skill (v4)

## Doel

Verwerkt AFAS-exports van grootboekrekeningen "licenties en abonnementen"
en "inkoop cloud" tot een Excel-rapport dat een niet-financial in 30
seconden begrijpt. Twee belangrijke splitsingen:

1. **Intern vs. Extern:** wat verbruikt het team zelf (engineering,
   tooling, dienstverbetering) versus wat we direct voor de klant maken
   (cloud-productie, Moonlit, Anthropic API, Azure, GCP).
2. **Actief vs. Stopgezet:** alleen actieve leveranciers tellen mee in
   maandgemiddeldes en totalen. Stopgezette items worden historisch wel
   getoond maar verwarren de cijfers niet.

Jelle gebruikt dit cumulatief: elke maand stuurt hij de nieuwe YTD-exports
en de skill genereert het rapport opnieuw.

## Vier buckets

In de UI worden alle leveranciers ingedeeld in **vier** buckets:

| Bucket | Wat | Voorbeelden | Hoort op grootboek |
|--------|-----|-------------|-------------------|
| **Software** | Vaste software-abonnementen + niet-software abonnementen | Atlassian, HubSpot, Cursor, AFAS, GitHub, FD | Abonnementen |
| **AI-tools** | AI-diensten met vast abonnement (geen variabel verbruik) | DeepL, Lovable, HeyGen, xAI/Grok, Synthesia | Abonnementen |
| **Tokens Intern** | Variabele AI/cloud DOOR HET TEAM (engineering, dienstverbetering, organisatiebreed gebruik) | Anthropic Claude Team, ChatGPT Team, Cursor AI usage, Fireflies.ai | Abonnementen |
| **Tokens Extern** | Variabele cloud/tokens DIRECT VOOR DE KLANT (productie/infrastructuur) | Microsoft Azure, Google Cloud, Anthropic API (productie), AWS, Moonlit Legal, Supabase | Inkoop cloud |

> Intern in `references/leveranciers.json` staan 5 codes:
> `saas_licentie`, `abonnement`, `ai_licentie`, `tokens_intern`,
> `tokens_extern`. Mapping: `saas_licentie` + `abonnement` → Software;
> `ai_licentie` → AI-tools; `tokens_intern` → Tokens Intern;
> `tokens_extern` → Tokens Extern.

### Beslisboom bij nieuwe leverancier

1. Is het direct verbonden aan klant-productie (cloud, infra, third-party
   product-leverancier)?
   - **Ja** → `tokens_extern`. Ongeacht of vast of variabel.
2. Anders: is het een AI-dienst?
   - **Nee** → `saas_licentie` of `abonnement` (Software bucket)
   - **Ja, vast abonnement zonder verbruik-effect** → `ai_licentie` (AI-tools)
   - **Ja, met variabel/seat-effect** → `tokens_intern` (schaalt mee)

### Speciale regels

- **Anthropic Claude Team & OpenAI ChatGPT Team** → `tokens_intern`. Dit
  zijn vaste-prijs subscriptions maar schalen lineair met het aantal
  medewerkers, dus token-achtig karakter.
- **Anthropic API (PBC/SF)** → `tokens_extern`. Productie-tokens voor klant.
- **Cursor (subscription)** → `ai_licentie`. **Cursor AI usage** → `tokens_intern`.
- **Moonlit Legal Technologies** → `tokens_extern`. Directe leverancier voor het product.

## Status-veld (`actief` | `stopgezet`)

Elke leverancier heeft een `status`. Stopgezette leveranciers tellen NIET
mee in actieve totalen of maandgemiddeldes — alleen historisch zichtbaar
in een apart blok in de Samenvatting.

Status moet handmatig in `leveranciers.json` worden onderhouden zodra
Jelle een licentie afsluit.

## Stap 1 — Data inlezen (multi-source)

De skill ondersteunt meerdere AFAS-exports tegelijk. Vanaf april 2026 zijn
er standaard twee:

1. **Abonnementen** — grootboek licenties/abonnementen
2. **Inkoop cloud** — grootboek cloudkosten (Azure, GCP, Anthropic API)

Roep het script aan met komma-gescheiden `pad=label`:

```bash
python verwerk_licenties.py "abon.xlsx=Abonnementen,cloud.xlsx=Inkoop cloud" \
    leveranciers.json teams.json output.xlsx
```

Single-source aanroep blijft werken (krijgt label "Hoofdgrootboek").

Lees elk Excel met `pandas + engine='calamine'`. Per source wordt
automatisch een `Bron`-kolom toegevoegd. De skill bepaalt automatisch of
een mutatie op de juiste grootboekrekening staat (Tokens Extern hoort op
Inkoop cloud, alle andere buckets op Abonnementen).

**Detectie van reguliere maanden:** alleen maanden tot/met de huidige
maand op basis van Boekstuk-datum. Vooruit-geboekte spreidingen
(jaarlicenties uitgesmeerd over 12 maanden) tellen NIET als extra
YTD-maand.

## Stap 2 — Leveranciers matchen

`references/leveranciers.json` bevat per leverancier:
- `naam` — genormaliseerde naam
- `patronen` — strings die in de Boeking-kolom voorkomen (langste match wint)
- `categorie` — interne code (zie 4 buckets)
- `team` — toegewezen team of "Organisatiebreed"
- `per_seat` — true/false
- `seats_team` — voor per-seat: welke teams gebruiken het
- `status` — `actief` | `stopgezet`
- `btw_inclusief` — true voor NL leveranciers waarvan het bedrag in AFAS
  inclusief 21% BTW staat. Skill rekent automatisch naar excl. BTW
  (`Saldo / 1.21`). Default false (= bedrag is al excl, of buitenlandse
  leverancier met 0% verlegging). NL bedrijven met 21% BTW: Cloud86, AFAS,
  Exact, Amoh, FD, HubSpot Netherlands, GitHub B.V., DigitalOcean EU.
- `notities` — context (gebruik `??` prefix om aan te geven dat
  classificatie nog onzeker is — die komen vanzelf in de Beslislijst)

Onbekende leveranciers worden niet automatisch geclassificeerd — ze komen
in de Beslislijst sectie B als open vraag.

## Stap 3 — Teams laden

`references/teams.json` — wie zit in welk team. Let op: George/Jelle/Tarik
zitten in twee teams (MT + IT/Sales/Marketing). Het totaal aantal
**unieke** personen staat in `totaal_unieke_personen`.

## Stap 4 — Excel genereren

Run `scripts/verwerk_licenties.py`. Het rapport heeft **5 tabbladen**:

### Tab 1 — Samenvatting
De enige tab die Jelle écht leest. Bevat in deze volgorde:

1. **Vier KPI-tegels** (donkerblauwe headers, witte cijfers, hele euro's):
   - Totaal actief YTD
   - Intern / maand
   - Extern (klant) / maand
   - Totaal / maand

2. **Per maand totaal** — kolom per maand, vier buckets + totaal-rij. Met
   correctieboekingen-melding als die er zijn, lopende-maand
   waarschuwing als de huidige maand in de data zit, en
   **uitschieter-meldingen** (geel) als een maand in een bucket >1.5×
   het gemiddelde van de overige maanden is — met top-3 leveranciers die
   de uitschieter veroorzaken.

3. **Top 10 actieve uitgaven YTD** — leverancier, bucket, team, totaal,
   % van totaal, trend.

4. **✅ Reeds stopgezet** — historische YTD per stopgezette leverancier.
   Telt niet mee in totalen, alleen ter informatie.

5. **❓ Te classificeren** — onbekende leveranciers (alleen als die er zijn).

### Tab 2 — AI & Tokens Intern (incl. Per team)
Vijf secties:

- **A. AI-tools (vaste abonnementen)** — per tool: gem./mnd, aantal seats,
  per persoon/mnd, trend
- **B. Tokens Intern (variabel)** — per provider: gem./mnd, YTD, trend, notitie
- **C. Software (overige vaste licenties team)** — alle Software-bucket items,
  **gesorteerd van laag naar hoog op gem/maand** voor leesbaarheid (kleine
  abonnementen bovenaan, grote uitgaven onderaan)
- **D. Per team** — gemiddelde kosten per maand met **toerekening** van
  gedeelde licenties: HubSpot (Sales+Marketing) en Pitch (Sales+CS) worden
  50/50 gesplitst, en de organisatiebrede pool (Atlassian, Bitwarden, Loom,
  Claude Team, ChatGPT Team, Fireflies) wordt naar rato van personen
  toegerekend. Daardoor heeft elk team een realistische "Totaal/mnd" en
  "Per persoon/mnd". Drie kolommen: Eigen Software / Eigen AI-Tokens /
  Toegerekend.
- **E. Projectie** — wat als we groeien naar +1, +5, +10 personen?
  Per-seat licenties schalen lineair, tokens schalen ~lineair (met disclaimer).

### Tab 3 — Cloud Extern
Productiekosten direct voor de klant. Kort en helder:

- KPI-regel met YTD en gem./mnd
- **Per leverancier** — gem./mnd, YTD, % van extern, trend, notitie
- **Per maand** — kolom per maand, leverancier op rij
- Toelichting wat hier hoort en waarom

### Tab 4 — Beslislijst (verplaatsingsoverzicht)
GEEN advies meer over wat afgesloten moet worden — dat is statusveld.
Alleen nog:

- **A. Verplaatsen — staat hier, hoort hier:** overzicht per leverancier
  met aantal regels en bedrag, plus detail-tabel per mutatie. Skill
  bepaalt automatisch welke bucket op welk grootboek hoort.
- **B. Te classificeren:** onbekende leveranciers + leveranciers met `??`
  in hun notities (= onzekere classificatie waar Jelle nog op moet
  bevestigen).

### Tab 5 — Alle mutaties (met legenda)
Bovenaan een legenda van alle buckets, statussen en de Bron-kolom. Daarna
de ruwe data verrijkt met datum, maand, leverancier, bucket, status, team,
per-seat, bedrag, **Bron**, "verkeerd geboekt?"-vlag, en originele velden.

## Opmaak

- Arial 10pt, professioneel
- Headers: donkerblauw (#1F4E79) wit
- Bedragen: hele euro's in samenvatting/team/AI tabs; centen in mutaties
- Totalen: vetgedrukt + lichtgrijs (#D9E2F3)
- Bucket-kleuren:
  - Software: standaard (geen extra kleur)
  - AI-tools: lichtpaars (#E8D5F5)
  - Tokens Intern: lichtgeel (#FFE699)
  - Tokens Extern: oranje (#FFC000)
- Stopgezet: lichtgrijs (#EDEDED), telt niet mee in actieve berekeningen
- Beslislijst-rijen die verplaatst moeten worden: oranje (#FCE4D6)
- Beslislijst-rijen die geclassificeerd moeten worden: geel (#FFF2CC)

## Cumulatieve werking

Jelle stuurt elke maand de actuele AFAS-exports (die bevatten altijd de
hele YTD). De skill detecteert hoeveel maanden er in zitten en past zich
automatisch aan: meer maanden = meer kolommen in alle per-maand-secties,
betere trend, betere projectie. Output-bestandsnaam volgt het patroon
`Licentie-analyse YTD [JAAR].xlsx`.

## Interactiepatroon

**Eerste run van een jaar:**
1. Data inlezen, bekende leveranciers matchen
2. Onbekende leveranciers tonen → vraag classificatie + team aan Jelle
3. `leveranciers.json` aanvullen (incl. `status`)
4. Excel genereren

**Vervolgrun (zelfde jaar, nieuwe maand):**
1. Data inlezen
2. Alleen nieuwe onbekende leveranciers vragen
3. Eventuele status-wijzigingen verifiëren (nieuwe stopgezet?)
4. Excel regenereren

**Wat het rapport NIET doet:**
- Geen automatische classificatie van "Onbekend" — die blijft expliciet zichtbaar
- Geen advies over wat afgesloten moet worden — dat is een handmatige
  status-update in `leveranciers.json`
- Geen prognose op basis van extrapolatie zonder context — alleen lineaire
  schaling van per-seat licenties

## Wijzigingsgeschiedenis

- **v4.1 (april 2026)**: BTW-correctie via `btw_inclusief` veld per
  leverancier. Software-sectie gesorteerd laag→hoog. Per-team toerekening
  van gedeelde + organisatiebrede licenties (Sales heeft niet meer €0).
  Uitschieter-detectie per bucket per maand.
- **v4 (april 2026)**: Tokens gesplitst in Intern/Extern; status-veld
  toegevoegd; besparing/afsluitlijst verwijderd uit rapport;
  "AI & Tokens Intern" en "Per team" samengevoegd op tab 2; aparte
  Cloud-tabblad voor extern; beslislijst is nu puur verplaatsings­overzicht;
  legenda toegevoegd aan Tab 5.
- **v3 (april 2026)**: Multi-source ondersteuning; Bron-kolom in Tab 5;
  betere maand-detectie (lopend tot vandaag).
- **v2 (maart 2026)**: 4 categorieën → 3 buckets; vijf-tab structuur.
