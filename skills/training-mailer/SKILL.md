---
name: training-mailer
description: >
  Stuurt voorbereidende trainingsmails naar alle deelnemers van een Legal Mind
  training. Zoekt de training in Outlook-agenda, extraheert genodigden, en maakt
  een concept-mail met bijlagen (Aan de slag met Legal Mind PDF, Praktijkcasus PDF)
  en dossier-link. Trigger bij: "stuur training info", "training mail sturen",
  "trainingsmail", "training voorbereiding mailen", "stuur dossier naar training",
  "training materiaal mailen", "mail de training deelnemers", "stuur info naar
  [kantoornaam] training", "training voorbereiding sturen", "voorbereidingsmail
  training", of wanneer Jelle (via voice dispatch of handmatig) vraagt om
  trainingsmateriaal te mailen naar deelnemers van een geplande training. Trigger
  ook bij voice dispatches als "stuur de training info voor [klant]" of "mail het
  dossier voor de training bij [kantoor]". Trigger NIET voor het inplannen van
  trainingen (agenda-afspraakplanner), het maken van trainingsmateriaal, of het
  geven van de training zelf.
---

# Training Mailer

Maakt concept-mails aan in Outlook met trainingsmateriaal voor alle deelnemers van een geplande Legal Mind training.

**Auth & MCP-fallback:** voor `outlook_calendar_search` en eventuele Outlook write-fallback: zie [`agent-handbook/references/authentication.md`](../agent-handbook/references/authentication.md) — single source. Decision-tree bepaalt route. Skill-specifiek: drafts gaan via Chrome (geen Composio voor write); alleen calendar-search heeft auth nodig.

## Overzicht

Deze skill wordt aangestuurd door een voice dispatch of handmatig commando. De skill:
1. Identificeert de juiste training in de Outlook-agenda
2. Extraheert alle genodigden uit het agenda-event
3. Bepaalt welk dossier bij de training hoort
4. Maakt een concept-mail aan in Outlook via Chrome met de juiste bijlagen en links

## Architectuur — Dossier-selectie

De skill ondersteunt meerdere trainingsdossiers. Lees `references/dossiers.md` voor de actuele dossier-configuratie. Elk dossier bevat:
- Een naam en beschrijving
- SharePoint-links naar het dossier (map) en de praktijkcasus (PDF)
- Zoektermen om het dossier automatisch te matchen aan een training

Op dit moment is er één dossier: **Dossier Houtrot** (rechtsgebied: Verborgen Gebreken). In de toekomst komen hier meerdere rechtsgebieden bij. De architectuur is hier al op voorbereid.

---

## Workflow

### Stap 0: Input verwerken

Analyseer het commando (voice dispatch of handmatige input) om te bepalen:
- **Kantoornaam** — Als genoemd, gebruik dit om de training te zoeken
- **Datum** — Als genoemd (bijv. "volgende week dinsdag", "12 april"), gebruik als filter
- **Dossier** — Als expliciet genoemd, gebruik dat dossier. Zo niet: bepaal op basis van de training-titel of gebruik het standaarddossier (Dossier Houtrot)

### Stap 1: Training zoeken in Outlook-agenda

Zoek het agenda-event via `outlook_calendar_search`:

**Zoekstrategie:**
1. Zoek op `"Introductietraining"` of `"training"` in combinatie met de kantoornaam (als bekend)
2. Filter op events in de toekomst (komende 30 dagen)
3. Als meerdere trainingen gevonden: kies de eerstvolgende, of vraag Jelle om te kiezen

**Verwachte event-namen volgen het format:**
- `Introductietraining [Kantoornaam] / Legal Mind [Stad]`
- `Training Legal Mind / [Kantoornaam]`
- Of varianten hierop

Als geen training gevonden wordt:
- Verbreed de zoekopdracht (zoek alleen op "training" of alleen op kantoornaam)
- Als nog steeds niets: meld dit aan Jelle en vraag om verduidelijking

### Stap 2: Genodigden extraheren

Uit het gevonden agenda-event:
1. Lees alle attendees/genodigden
2. Filter de Legal Mind-mailadressen eruit (alles op `@legal-mind.nl`)
3. De overgebleven mailadressen zijn de trainingsdeelnemers — dit zijn de ontvangers van de mail
4. Bewaar ook de kantoornaam en trainingsdatum voor gebruik in de mail

Als er geen externe genodigden zijn:
- Meld dit aan Jelle — mogelijk is het event nog niet volledig ingevuld

### Stap 3: Dossier bepalen

Lees `references/dossiers.md` en bepaal welk dossier bij deze training hoort:

1. **Expliciet genoemd in commando** — Gebruik dat dossier
2. **Match op training-titel** — Controleer of de titel van het agenda-event een van de zoektermen uit dossiers.md bevat
3. **Standaarddossier** — Als geen match: gebruik het standaarddossier (momenteel Dossier Houtrot)

### Stap 4: Concept-mail samenstellen

Lees `references/mail-template.md` voor het exacte mail-format.

Vul de template aan met:
- **Aan:** alle externe genodigden uit Stap 2 (gescheiden door puntkomma's)
- **Onderwerp:** uit de template, met kantoornaam ingevuld
- **Body:** uit de template, met kantoornaam, trainingsdatum en dossier-links ingevuld
- **Bijlagen:** De SharePoint-links naar de documenten (als klikbare links in de mail-body, niet als fysieke bijlagen)

### Stap 5: Draft plaatsen in Outlook via Chrome

Volg het Chrome-protocol van de auto-draft skill voor het aanmaken van mails:

**5a. Chrome-check**
- Controleer of Chrome beschikbaar is via `tabs_context_mcp`
- Als Chrome niet beschikbaar: stop en meld dit. Geen workarounds.

**5b. Nieuwe mail openen**
- Navigeer naar `https://outlook.office.com/mail/deeplink/compose` via `navigate`
- Wacht tot de pagina geladen is
- Neem een screenshot om te bevestigen dat het compose-venster open is

**5c. Ontvangers invoeren**
- Klik op het "Aan"-veld
- Voer alle mailadressen in, gescheiden door puntkomma's
- Tab uit het veld om de adressen te bevestigen

**5d. Onderwerp invoeren**
- Klik op het onderwerp-veld
- Voer het onderwerp in uit Stap 4
- Tab uit het veld

**5e. Mail-body invoeren**
- Gebruik `javascript_tool` om de HTML-content in te voegen in het contenteditable body-veld
- Zoek het element met `aria-label` die "Berichttekst" of "Message body" bevat
- Voeg de HTML in via `innerHTML` assignment
- Dispatch input/change events zodat Outlook de wijziging registreert

```javascript
// Voorbeeld van HTML-insertie
const editor = document.querySelector('[aria-label*="Berichttekst"], [aria-label*="Message body"]');
if (editor) {
  editor.innerHTML = MAIL_HTML_HIER;
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  editor.dispatchEvent(new Event('change', { bubbles: true }));
}
```

**5f. Handtekening**
- De handtekening van Jelle wordt automatisch toegevoegd door Outlook bij een nieuwe mail
- Controleer via screenshot of de handtekening aanwezig is
- Als de handtekening niet zichtbaar is: haal deze op uit de Concepten-map (zoek "handtekening-080329") zoals beschreven in de auto-draft skill, en voeg deze toe aan het einde van de body

**5g. Verificatie**
- Neem een screenshot van de volledige concept-mail
- Controleer:
  - Alle ontvangers staan in het Aan-veld
  - Het onderwerp is correct
  - De links in de body zijn klikbaar
  - De handtekening is aanwezig
  - Er staat "Concept opgeslagen" of soortgelijk

**5h. NOOIT versturen**
- Klik NOOIT op Verzenden/Send
- Navigeer weg van het compose-venster na bevestiging dat het concept is opgeslagen
- Sluit de tab via `tabs_close_mcp`

### Stap 6: Bevestiging aan Jelle

Meld terug aan Jelle:
- Concept-mail is aangemaakt
- Hoeveel ontvangers
- Welk dossier is gekoppeld
- Welke training (naam + datum)

Format:
```
✅ Concept-mail aangemaakt voor [Kantoornaam]

📅 Training: [event-titel] — [datum]
👥 Ontvangers: [aantal] personen ([email1], [email2], ...)
📁 Dossier: [dossiernaam]
📎 Bijlagen: Aan de slag met Legal Mind.pdf, Praktijkcasus [naam].pdf

De mail staat klaar als concept in Outlook. Controleer en verstuur wanneer je wilt.
```

### Stap 7: Run-record naar `agent_runs` (v1-contract)

Schrijf één rij naar `agent_runs` zodat de Health-pagina deze skill ziet draaien.
Volledige spec in `agent-handbook/references/logging.md`.

```jsonb
{
  "schema_version": "1",                    // STRING "1" — nooit integer
  "skill_version": "training-mailer-v1.0",
  "mode": null,
  "triggered_by": "manual",                 // of "voice-dispatch"
  "triggered_at": "<ISO-8601>",
  "passes": [
    { "name": "find-training",    "ms": <N>, "status": "success" },
    { "name": "extract-invitees", "ms": <N>, "status": "success" },
    { "name": "compose-mail",     "ms": <N>, "status": "success" },
    { "name": "place-draft",      "ms": <N>, "status": "success" }
  ],
  "warnings": [],
  "counts": {
    "trainings_found": 1,
    "invitees_count": <N>,
    "drafts_created": 1
  },
  "extra": {
    "training_title": "<text>",
    "training_date": "<ISO-8601>",
    "dossier": "<dossier-naam>"
  }
}
```

Hard errors (Chrome niet beschikbaar, body niet ingevoegd na 2 retries) → `agent_runs.errors[]`
met `[{"severity":"error","code":"<code>","message":"<text>","context":{}}]`.

---

## Foutafhandeling

| Situatie | Actie |
|----------|-------|
| Chrome niet beschikbaar | Stop direct, meld aan Jelle |
| Geen training gevonden | Vraag Jelle om verduidelijking (kantoornaam, datum) |
| Geen externe genodigden | Meld aan Jelle, vraag of event volledig is |
| Outlook compose laadt niet | Retry na 10s, max 2x. Daarna stoppen. |
| Body niet ingevoegd | Probeer `form_input` als fallback, max 2x |
| Meerdere trainingen gevonden | Toon opties aan Jelle, laat kiezen |

---

## Veiligheidsregels

1. **NOOIT mails versturen** — Alleen concepten aanmaken
2. **Chrome is verplicht** — Als Chrome niet beschikbaar, stop direct
3. **Geen geïmproviseerde links** — Gebruik alleen de links uit `references/dossiers.md`
4. **Geen ontvangers verzinnen** — Gebruik alleen de mailadressen uit het agenda-event
5. **Altijd controleren via screenshot** — Bevestig visueel dat het concept correct is
