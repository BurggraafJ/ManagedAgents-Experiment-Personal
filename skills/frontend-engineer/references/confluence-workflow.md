# Confluence & Slack Workflow

Dit document beschrijft hoe je context ophaalt uit Confluence en hoe je de pipeline bijwerkt
als je klaar bent. Dit zijn de technische stappen — de SKILL.md beschrijft de fases en werkwijze.

---

## Context ophalen

### 1. Vind de Index-pagina

De Index-pagina is de enige bron van waarheid voor elke feature. Zoek via CQL:

```
searchConfluenceUsingCql(
  cloudId: "bg-intelligence.atlassian.net",
  cql: "title = \"[Feature Naam]\" AND type = page AND space = \"AS\""
)
```

Als de gebruiker een directe Confluence-link geeft, haal het page ID uit de URL.

### 2. Lees de Index-pagina

```
getConfluencePage(cloudId: "bg-intelligence.atlassian.net", pageId: "[index page ID]", format: "markdown")
```

De Index-pagina bevat:
- Een **statustabel** met ✅ (klaar) of ⏳ (in afwachting) per pipeline-stap
- **Directe links** naar elke pagina in de feature folder
- Een **Slack thread URL**

**Bewaar deze waarden — je hebt ze nodig:**
- Het Index page ID (voor statusupdate later)
- De Slack thread URL (voor je reply)
- De paginalink voor de **Scope**
- De paginalink voor de **UI/UX** pagina (je visuele referentie — design, screenshots, FigJam flows)
- De paginalink voor de **Backend Implementation Notes** (je API-documentatie)
- De paginalink voor de **Frontend Implementation Notes** (jouw pagina om bij te werken)

**Let op: de Architecture pagina staat ook in de feature map.** Dit is de backend-architectuur
die geschreven is vóór de backend werd gebouwd. **Negeer deze pagina volledig.** De backend
developer heeft mogelijk andere beslissingen gemaakt dan wat in de architectuur staat. Jouw
enige bron voor de backend is de Backend Implementation Notes — dat beschrijft wat er
daadwerkelijk gebouwd is.

### 3. Valideer vereisten

Controleer de statustabel:

| Stap | Vereiste |
|---|---|
| Scope | Moet ✅ zijn — stop zonder scope |
| UI/UX | Moet ✅ zijn — je hebt het design en de screenshots nodig |
| Backend Implementation | Moet ✅ zijn — je hebt de API-documentatie nodig |

Als de Scope nog ⏳ is:

> "Ik heb de Index-pagina gecheckt en zie dat de **Scope** nog niet klaar is (nog ⏳).
> Ik kan niet beginnen zonder scope. Draai eerst de Scope Creator, of zeg dat ik toch
> door moet gaan."

Als UI/UX nog ⏳ is:

> "Het **UI/UX design** is nog niet klaar (nog ⏳). Ik heb de visual artifacts (FigJam flows,
> Figma designs, screenshots) nodig om te weten hoe de feature eruitziet en waar die komt.
> Wil je dat ik toch doorga, of moet eerst de UX stap draaien?"

Als Backend Implementation nog ⏳ is:

> "De backend is nog niet gebouwd (Backend Implementation is nog ⏳). Ik heb de API-documentatie
> nodig om te weten welke endpoints beschikbaar zijn. Wil je dat ik toch doorga, of moet eerst
> de Backend Engineer draaien?"

Ga NIET verder totdat de gebruiker bevestigt.

### 4. Lees de vereiste documenten

Gebruik de directe links om elk document op te halen:

```
getConfluencePage(cloudId: "bg-intelligence.atlassian.net", pageId: "[page ID]", format: "markdown")
```

| Document | Waarom |
|---|---|
| **Scope** | WAT je bouwt — acceptance criteria, user stories, constraints |
| **UI/UX** | HOE het eruitziet en WAAR het komt — visual artifacts, design decisions, screen flows |
| **Backend Implementation Notes** | Je API-documentatie — endpoints, request/response formats, notities voor frontend |

De Backend Implementation Notes bevatten:
- Alle beschikbare endpoints met method, path en beschrijving
- Request/response formats per endpoint
- Notities specifiek voor de frontend sessie
- Bekende eigenaardigheden

### 5. Bekijk de visual artifacts op de UI/UX pagina

De UI/UX pagina bevat een **Visual Artifacts** sectie. Hier vind je de visuele referenties die
je nodig hebt om de feature te bouwen. Dit kunnen onder andere zijn:

- **FigJam flow diagrams** — overzichts- en detailflows die laten zien hoe de gebruiker door de
  feature navigeert. Bekijk deze om het complete pad van de gebruiker te begrijpen.
- **Figma designs** — de actuele designs van de componenten en schermen.
- **Screenshots van de huidige interface** — foto's van de applicatie die laten zien WAAR de
  feature gaat leven. Hiermee begrijp je de context: op welke pagina, in welk gedeelte, naast
  welke bestaande elementen.

**Dit is verplicht.** Bekijk alle visual artifacts vóórdat je technische beslissingen neemt.
Als er geen screenshots of design-referenties zijn:

> "Ik heb de UI/UX pagina bekeken maar er staan **geen visual artifacts** (geen screenshots,
> geen FigJam flows, geen Figma designs). Ik kan niet goed bouwen zonder visuele referentie.
> Wil je dat ik toch doorga op basis van bestaande UI-patronen, of moeten er eerst designs
> worden toegevoegd?"

**Stop het proces** en wacht op bevestiging van de gebruiker.

Daarnaast bevat de UI/UX pagina vaak ook:
- **Design Decisions** — bevestigde keuzes over UI-elementen, kleuren, interactiepatronen
- **Screen-level flows** — gedetailleerde beschrijvingen per scherm/state
- **State inventory** — overzicht van alle mogelijke states

Lees deze secties grondig — ze bevatten cruciale context voor je implementatie.

---

## Backend endpoints verifiëren

Na het ophalen van de API-documentatie, verifieer dat de endpoints live zijn:

```bash
curl -s http://localhost:7071/api/v1/domain/endpoint | python -m json.tool
```

Vergelijk de response met de documentatie. Afwijkingen? De daadwerkelijke response is wat telt.

Als de documentatie onvolledig is:
- Lees de backend route-bestanden voor deze feature
- Lees Pydantic schemas voor request/response formats
- Check authenticatie en permissies per endpoint

---

## Pipeline bijwerken (na oplevering)

### 1. Update Frontend Implementation Notes

Zoek de pagina via de link uit de Index-pagina. Update met `updateConfluencePage`:

```
updateConfluencePage(
  cloudId: "bg-intelligence.atlassian.net",
  pageId: "[Frontend Implementation page ID from Index]",
  ...
)
```

**Schrijf deze inhoud:**

```markdown
# Frontend Implementation Notes — [Feature Name]

## Status
**Sessiedatum**: [datum]
**Status**: ✅ Voltooid / 🔧 Deels klaar / ❌ Geblokkeerd
**Branch**: `feature/[naam]-frontend`
**PR**: [link indien beschikbaar]

## Aangemaakte bestanden
- `src/types/domain.ts` — TypeScript interfaces voor [feature]
- `src/hooks/domain/useDomainData.ts` — Data fetching hook
- `src/components/domain/DomainCard.tsx` — Hoofdcomponent voor [feature]
- `src/pages/DomainPage.tsx` — Pagina-component
- `src/stores/domain/domainStore.ts` — Zustand store
- `src/i18n/en/domain.json` — Engelse vertalingen
- `src/i18n/nl/domain.json` — Nederlandse vertalingen

## Gewijzigde bestanden
- `src/Router.tsx` — Route toegevoegd voor [feature]
- `src/i18n/config.ts` — Nieuwe translation namespace (indien nodig)

## Componenten

| Component | Locatie | Beschrijving |
|---|---|---|
| DomainCard | `src/components/domain/` | Toont [data] |
| DomainList | `src/components/domain/` | Lijst van [items] |
| DomainModal | `src/components/domain/` | Aanmaak/bewerk modal |

## Routes
- `/domain` — Hoofdpagina
- `/domain/:id` — Detailpagina

## Technische beslissingen
- [Welke componenten hergebruikt en waarom]
- [Welke componenten nieuw gemaakt en waarom]
- [State management keuzes]
- [Data fetching aanpak]

## Notities
- [Belangrijke implementatiedetails]
- [Bekende beperkingen of edge cases]

## Openstaande items
- [Wat nog niet klaar is]
- [Handmatige stappen nodig]

## Testresultaten
- ✅ Happy path: [beschrijving]
- ✅ Loading state: [beschrijving]
- ✅ Error state: [beschrijving]
- ✅ Empty state: [beschrijving]
- ✅ Responsive: [geteste breedtes]
- ✅ Design match: [vergelijking]
- ⚠️ [eventuele zorgen]
```

### 2. Update de Index-pagina

Lees de huidige content en update:
- Frontend Implementation status van ⏳ naar ✅
- Alle andere rijen exact laten staan

```
updateConfluencePage(
  cloudId: "bg-intelligence.atlassian.net",
  pageId: "[index page ID]",
  ...
)
```

### 3. Reply in de Slack thread

Haal channel ID en thread_ts uit de Slack URL:
`https://legal-mind-group.slack.com/archives/[CHANNEL_ID]/p[TIMESTAMP]`

Timestamp aanpassen: `p1774708340452659` → `1774708340.452659`

Post een threaded reply:

```
🎨 Frontend klaar: [Feature Name]

Gebouwde componenten:
• [Component] — [beschrijving]
• [Component] — [beschrijving]

Route: /[route]
Branch: feature/[naam]-frontend
Confluence: [link naar implementation notes]

Feature is klaar voor review.
```

---

## Sessie-continuïteit (als de feature niet in één sessie past)

Als de feature te groot is om in één sessie te voltooien, zorg je dat de volgende sessie
naadloos kan oppakken. Je doet dit via Confluence — niet via git.

### 1. Maak een voortgangspagina aan op Confluence

Maak een child page aan onder de feature folder met de titel:
`Frontend Voortgang — [Feature Name]`

```
createConfluencePage(
  cloudId: "bg-intelligence.atlassian.net",
  parentPageId: "[index page ID]",
  title: "Frontend Voortgang — [Feature Name]",
  ...
)
```

**Schrijf deze inhoud:**

```markdown
# Frontend Voortgang — [Feature Name]

## Status
**Laatste sessiedatum**: [datum]
**Status**: 🔧 In uitvoering

## Wat is klaar
- [Component X] — volledig gebouwd en getest
- [Hook Y] — data fetching werkt
- [Route Z] — toegevoegd aan Router.tsx
- ...

## Wat staat nog open
- [Component A] — nog niet gebouwd
- [Vertaalbestanden] — nl nog niet aangevuld
- [Edge case B] — nog niet afgehandeld
- ...

## Aangemaakte / gewijzigde bestanden
Volledige lijst van alle bestanden die in deze sessie zijn aangemaakt of gewijzigd:
- `src/types/domain.ts` — NIEUW
- `src/components/domain/Card.tsx` — NIEUW
- `src/Router.tsx` — GEWIJZIGD (route toegevoegd)
- ...

## Technische beslissingen
- [Welke componenten hergebruikt en waarom]
- [State management keuze en waarom]
- [Data fetching aanpak]

## Waar de volgende sessie moet oppakken
- Begin met [specifiek onderdeel]
- Let op [specifiek aandachtspunt]
- [Eventuele blokkades of vragen voor de gebruiker]

## Testresultaten tot nu toe
- ✅ [wat al getest is]
- ⏳ [wat nog getest moet worden]
```

### 2. Update de Index-pagina

Verander Frontend Implementation status naar 🔧 (in uitvoering):

```
updateConfluencePage(
  cloudId: "bg-intelligence.atlassian.net",
  pageId: "[index page ID]",
  ...
)
```

### 3. Reply in de Slack thread

Post een threaded reply met indicatie van gedeeltelijke voltooiing:

```
🔧 Frontend in uitvoering: [Feature Name]

Klaar:
• [Component] — [beschrijving]
• [Component] — [beschrijving]

Nog open:
• [Wat nog moet]

Voortgang: [link naar voortgangspagina]
Volgende sessie kan hier oppakken.
```
