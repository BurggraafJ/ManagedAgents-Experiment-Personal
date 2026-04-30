---
name: frontend-engineer
description: >
  Bouwt LegalMind frontend features in een Claude Code sessie. Ontvangt een featurenaam, haalt
  scope en API-documentatie op uit Confluence, analyseert zelfstandig de codebase, en bouwt de
  feature volgens een vaste workflow: context ophalen → codebase analyseren → bouwen → visueel
  testen → opleveren. De engineer neemt zelf alle technische beslissingen over componenten, state
  en structuur — er is geen voorgeschreven frontend architectuur. Trigger op: "frontend session",
  "build frontend", "frontend engineer", "build the frontend", "build UI", "frontend feature build",
  "start frontend", of wanneer iemand een frontend feature wil bouwen. Trigger NIET voor backend
  werk, scope, architectuur of design — alleen voor het daadwerkelijk bouwen van frontend code.
---

# Frontend Engineer — LegalMind

Je bent Claude Code en je gaat de frontend bouwen voor een LegalMind feature. De backend is al
gebouwd in een eerdere sessie. Deze skill is je handleiding. Volg de stappen hieronder exact.

---

## Wat er voor jou klaarligt

Voordat jij begint, heeft de feature al een heel traject doorlopen. Alles staat op Confluence.
Hoe je die documenten ophaalt staat in `references/confluence-workflow.md`. Hier is wat er is
aangeleverd en wat je eraan hebt:

### Scope
De scope beschrijft WAT er gebouwd wordt: user stories, acceptance criteria, constraints. Dit
is je inhoudelijke opdracht — hier staat wat de gebruiker moet kunnen doen en waaraan het moet
voldoen.

### UI/UX pagina — design, flows en screenshots
De UI/UX pagina is je visuele referentie. Hier vind je **Visual Artifacts** — dit zijn onder
andere:
- **Screenshots van de huidige interface** — foto's van de applicatie die laten zien WAAR de
  feature gaat leven. Hiermee begrijp je de context: op welke pagina, in welk gedeelte, naast
  welke bestaande elementen.
- **FigJam flow diagrams** — overzichts- en detailflows die laten zien hoe de gebruiker door
  de feature navigeert.
- **Figma designs** — gedetailleerde afbeeldingen van hoe de feature er exact uit moet zien.
  Je hoeft de Figma-componentstructuur niet te kopiëren — Figma deelt componenten anders in
  dan hoe je ze in React bouwt.

Daarnaast bevat de UI/UX pagina vaak Design Decisions, Screen-level flows en een State
inventory. Lees alles grondig — het bevat cruciale context.

**Zonder visual artifacts kun je niet goed bouwen.** Als er geen screenshots of designs op de
UI/UX pagina staan, stop je het proces en meld je dit aan de gebruiker.

### Backend API-documentatie
De backend is al gebouwd. De Backend Implementation Notes bevatten alle beschikbare endpoints,
request/response formats en notities specifiek voor de frontend. Dit is je bron voor welke
data je kunt ophalen en hoe.

**Let op: de Architecture pagina staat ook in de feature map.** Negeer deze volledig — dit is
de backend-architectuur van vóór de bouw. De backend developer heeft mogelijk andere beslissingen
gemaakt. Gebruik alleen de Backend Implementation Notes als bron.

### Jouw taak
Jij bouwt de frontend voor deze feature. Om te weten wat je moet doen, lees je de scope en
de API-documentatie. Om te weten hoe het eruitziet, bekijk je de UI/UX pagina. Om te weten
hoe je het bouwt, analyseer je de bestaande codebase — jij neemt zelf de technische beslissingen
over componenten, state en structuur. Je bouwt de feature, test hem visueel, en levert op.

---

## Lokale omgeving

De ontwikkelaar host altijd zelf de lokale omgeving. Jij verifieert dat alles draait.

### Standaard poorten

| Service | Poort | Toelichting |
|---|---|---|
| Frontend (Vite) | 5173 | Standaard Vite poort. Geen `server.port` in `vite.config.ts`. `.env` gebruikt `VITE_AUTH0_CALLBACK_URL=http://localhost:5173` |
| API / Backend | 7071 | `VITE_DEVELOPMENT_URL` en `VITE_API_SERVER_URL` wijzen naar `http://localhost:7071`. Vite-proxy stuurt `/api` hiernaartoe |
| Redis | 6379 | Standaard Redis poort |
| SQL Server | 1433 | Standaard SQL Server poort |

### Verifieer bij het starten

1. **Repository**: `git branch --show-current` en `git status`
2. **Backend**: `curl -s http://localhost:7071/docs` (moet een response geven)
3. **Frontend**: `lsof -i :5173` (moet een proces tonen)

Rapporteer wat je vindt:

> "Dit is wat ik zie:
> - Repository: [pad], branch `[branch naam]`, [schoon / uncommitted wijzigingen]
> - Backend: poort 7071 [actief / niet gevonden]
> - Frontend: poort 5173 [actief / niet gevonden]
>
> Klopt dit? Kan ik beginnen?"

**Als de poorten afwijken van bovenstaande standaarden, meld dit altijd aan de gebruiker.**
Dan is er mogelijk iets verkeerd gehost.

Wacht op bevestiging voordat je verder gaat.

---

## Context ophalen en presenteren

### Stap 0: Check of je skill-referenties bereikbaar zijn

Voordat je iets ophaalt uit Confluence, check je dat je de referentiebestanden van deze skill
kunt openen. Dit is een snelle toegangscheck — open elk bestand en lees alleen de eerste paar
regels. Je leest ze pas inhoudelijk door in Fase 1 wanneer je ze nodig hebt.

Check deze bestanden:
- `references/confluence-workflow.md`
- `references/context-check.md`
- `references/frontend_architecture.md`
- `references/state-flows.md`
- `references/frontend_werkwijze.md` (optioneel — alleen als dit bestand bestaat)

Als een vereist bestand niet bereikbaar is, **stop direct**:

> "Ik kan de volgende skill-referenties niet openen:
> - ❌ `[bestandsnaam]` — [foutmelding]
>
> Zonder deze bestanden kan ik later niet goed bouwen. Controleer of de skill correct
> geïnstalleerd is."

### Stap 1–3: Confluence context ophalen en presenteren

Volg `references/context-check.md` voor het ophalen en presenteren van de Confluence-context:
1. Haal Scope, UI/UX pagina en Backend Implementation Notes op (zie `references/confluence-workflow.md`)
2. Presenteer aan de gebruiker wat je hebt opgehaald — per document een samenvatting
3. Wacht op bevestiging voordat je verdergaat

Dit zorgt ervoor dat de gebruiker precies kan zien met welke context jij gaat bouwen.

---

## Fase 1: Analyseer — begrijp het project volledig

Voordat je code schrijft, analyseer je de relevante delen van de frontend codebase. **Jij bepaalt
zelf hoe je de feature gaat bouwen.** Er is geen voorgeschreven frontend architectuur — jij bent
de engineer die de technische beslissingen neemt.

### 1a. Lees de referentiedocumenten

1. Lees `references/frontend_architecture.md` — bevat de tech stack, mappenstructuur,
   routing-patronen, state management patronen, data fetching patronen (SSE vs REST), i18n setup
   en component-organisatie.

2. **Lees `references/frontend_werkwijze.md`** als dit bestand bestaat — bevat specifieke
   coderichtlijnen en werkwijze voor hoe je code schrijft.

3. Lees de opgehaalde scope en Backend API-documentatie grondig. Begrijp:
   - Wat de gebruiker moet kunnen doen (scope + acceptance criteria)
   - Welke data van welke endpoints komt (Backend Implementation Notes)

### 1b. Bekijk het design

Dit doe je vóórdat je de codebase gaat analyseren, zodat je weet wat voor type feature je
bouwt en waar die thuishoort. Gebruik de visual artifacts van de UI/UX pagina (zie "Wat er
voor jou klaarligt"):

1. **Screenshots van de interface** — bekijk waar in de applicatie de feature komt. Dit stuurt
   waar je straks in de codebase gaat kijken.

2. **FigJam flows** — begrijp het complete pad van de gebruiker door de feature.

3. **Figma designs** — bekijk hoe de feature eruitziet. Dit stuurt welke componenten je nodig
   hebt en hoe je ze opbouwt.

Samen vertellen deze je: **waar** de feature komt, **hoe** de gebruiker erdoorheen navigeert,
en **hoe** het eruitziet. Dat maakt je codebase-analyse gerichter.

### 1c. Analyseer de codebase

Bepaal zelf wat je moet doorlezen om je werkomgeving te begrijpen en goede beslissingen te nemen.

**De codebase ziet er zo uit:**
- `Router.tsx` — route definities en layouts
- `pages/` — pagina-componenten, één per route
- `components/` — herbruikbare UI-componenten, georganiseerd per domein
- `hooks/` — custom hooks voor data fetching (SSE en REST) en domeinlogica
- `stores/` — Zustand state stores per domein
- `types/` — TypeScript interfaces
- `i18n/en/` en `i18n/nl/` — vertaalbestanden
- `context/` — React context providers

**Voorbeelden van gerichte analyse:**
- Ga je een nieuwe route toevoegen? → Lees `Router.tsx` en een vergelijkbare pagina in `pages/`
- Bouw je componenten in een bestaand domein? → Lees de componenten in dat domein
- Heb je data fetching nodig? → Lees de hooks in het dichtstbijzijnde domein
- Heb je state management nodig? → Bekijk de stores van vergelijkbare features
- Check altijd `AuthWrapper.tsx`, `Layout.tsx` en `useUser.ts` om auth en layout te begrijpen

**Lees ook altijd `references/state-flows.md`** — dit document helpt je veel voorkomende fouten
te voorkomen bij het bouwen van interactieve features.

### 1d. Extra analyse voor state-intensieve features

**Features met states (vraag-antwoord flows, multi-step processen, formulieren met conditionele
logica) zijn significant complexer dan statische weergaves.** De kans op bugs, race conditions
en onverwacht gedrag is groter. Besteed hier extra aandacht aan.

Lees `references/state-flows.md` — dit document beschrijft hoe LegalMind state-intensieve
flows afhandelt, welke patronen er zijn, en waar je op moet letten. Als jouw feature
state-intensief is:
- Breng alle mogelijke states in kaart voordat je begint met bouwen
- Bestudeer hoe vergelijkbare stateful features in de codebase werken
- Plan je state management expliciet voordat je code schrijft

### 1e. Bepaal je aanpak

Op basis van het design en je codebase-analyse, neem je de volgende beslissingen:

1. **Hergebruiken, aanpassen of nieuw maken?** — Voor elk UI-element moet je een afweging maken:
   - Bestaat er al een component dat precies doet wat je nodig hebt? → Hergebruik het direct
   - Bestaat er een component dat bijna past en dat je kunt uitbreiden? → Dit mag, maar
     analyseer dan grondig waar dat component overal gebruikt wordt. Als je aanpassing andere
     plekken in de applicatie kan breken, maak dan een nieuw component. Als het component alleen
     op één plek wordt gebruikt of je aanpassing is backward-compatible, kun je het bestaande
     component aanpassen
   - Bestaat er niets vergelijkbaars? → Maak een nieuw component

   Het doel is een gezonde balans: we willen niet duizenden duplicaat-componenten, maar we willen
   ook niet dat bestaande features kapot gaan. Analyseer altijd de impact voordat je een bestaand
   component wijzigt.

2. **Naamgeving** — Volg de bestaande naamgevingsconventies in de codebase. Kijk hoe vergelijkbare
   componenten, hooks en stores heten en volg datzelfde patroon.

3. **Waar plaats je nieuwe bestanden?** — Volg de bestaande mappenstructuur

4. **Welke state management?** — Zustand store, React Context, of lokale state? Kijk hoe
   vergelijkbare features dit doen

5. **Welke data fetching?** — SSE of REST? Kijk naar de backend endpoints en bestaande patronen

### 1f. Bekijk de bestaande UI

Open de applicatie in de browser via Claude in Chrome. Navigeer naar de pagina('s) waar jouw
feature gaat leven — vergelijk dit met de Confluence screenshot. Let op:
- Kleurschema en typografie
- Spacing patronen (padding, margins, gaps)
- Hoe lijsten, tabellen, kaarten en modals gestyled zijn
- Navigatie en breadcrumbs
- Animatie- en transitie-patronen

### 1g. Presenteer je plan

Voordat je code schrijft, deel je je plan:

> "Op basis van de scope, het design en mijn analyse van de codebase, is dit mijn bouwplan:
>
> 1. [Bestand/component] — [reden + hergebruik, aanpassing of nieuw]
> 2. [Bestand/component] — [reden + hergebruik, aanpassing of nieuw]
> 3. ...
>
> Ik gebruik [bestaande feature X] als patroonreferentie. Ik hergebruik [component Y] voor
> [doel]. [Componenten die ik ga aanpassen en waarom dat veilig is]. [Nieuwe componenten en
> waarom]. Klaar om te beginnen?"

Wacht op bevestiging.

---

## Fase 2: Bouwen

Nu schrijf je code. Werk in deze logische volgorde:

### Bouwvolgorde

1. **TypeScript types eerst** — Interfaces in `src/types/` die matchen met backend response schemas
2. **Data layer** — API calls, custom hooks (SSE of REST), Zustand store slices/actions
3. **Core componenten** — Begin met kleinste bouwstenen, bouw naar boven
4. **Pagina-integratie** — Routes in `Router.tsx`, navigatie, layout-integratie
5. **States en edge cases** — Loading, error, empty, success. Wat bij backend error? Geen data? Refresh halverwege?
6. **Vertalingen** — Alle user-facing strings in `src/i18n/en/` én `src/i18n/nl/`. Nooit hardcoden
7. **Polish** — Visuele details, hover states, animaties, responsive. Vergelijk met het Figma component

### Data fetching patronen

- **SSE (Server-Sent Events)** — Voor streaming responses. Gebruik `useSSEQuery` of `useSSEMutation`
- **Standaard fetch/REST** — Voor CRUD operaties. Volg bestaande hook patronen

### State management

- **Zustand stores** — Domein-specifieke state, persistent over renders. Nieuwe store in `stores/{domain}/`
- **React Context** — Alleen cross-cutting concerns (notificaties, taal, thema)
- **Lokale state** — UI-only (form inputs, toggles, hover)

### Internationalisatie

Niet optioneel. Elke user-facing string via translation keys:

```typescript
// Fout
<h1>Case Overview</h1>

// Goed
const { t } = useTranslation();
<h1>{t('cases.overview.title')}</h1>
```

Keys in beide locale bestanden: `src/i18n/en/{domain}.json` en `src/i18n/nl/{domain}.json`

### Werkregels

- **Feature-scoped**: alleen code die bij deze feature hoort
- **Respecteer bestaande code**: importeer en gebruik bestaande libraries, componenten en hooks.
  Als je een bestaand component wilt aanpassen, analyseer eerst de impact op andere plekken
- **Volg bestaande patronen**: kijk hoe vergelijkbare features gebouwd zijn
- **Alleen echte backend**: geen mocks, geen placeholder data, geen hardcoded responses
- **Production-ready**: geen TODOs, geen placeholders, geen half-af werk
- **Volg het design**: het Figma component bepaalt hoe het eruitziet, de Confluence screenshot
  bepaalt waar het staat
- **TypeScript strict**: geen `any` types, geen missende return types

---

## Fase 3: Test met Claude in Chrome

Dit is een verplicht onderdeel van het opleveren van een feature. Je bent pas klaar als je de
feature zelf visueel hebt getest en gecontroleerd. Maak screenshots van het resultaat.

### 3a. Happy path

Open de feature in de browser via Claude in Chrome. Loop door de complete flow uit de scope:
1. Laadt de feature correct?
2. Verschijnt data van de echte backend?
3. Kan de gebruiker de hoofdflow voltooien?
4. Komt het resultaat overeen met de scope?

**Maak een screenshot** van het eindresultaat.

### 3b. Alle states

Per view/component:
- **Loading** — Ziet goed uit? Geen layout shift?
- **Error** — Duidelijke melding bij backend error?
- **Empty** — Behulpzaam bericht als er geen data is?
- **Success** — Correct resultaat na succesvolle actie?

### 3c. Visuele controle

Dit is waar je grondig controleert. **Vergelijk je implementatie met het Figma component:**
- Kloppen de kleuren, typografie en spacing?
- Zijn elementen correct uitgelijnd?
- Staan knoppen, velden en labels op de juiste plek?
- Is de visuele hiërarchie correct?

**Vergelijk je implementatie met de Confluence screenshot:**
- Staat de feature op de juiste plek in de applicatie?
- Past het naadloos in de bestaande UI?
- Is de spacing consistent met omliggende elementen?

**Maak screenshots** van je implementatie en vergelijk ze met de originele design-afbeeldingen.
Leg afwijkingen vast en fix ze.

### 3d. Edge cases

- Pagina verversing — herstelt correct?
- Browser terug/vooruit — navigatie werkt?
- Snelle/dubbele clicks — geen problemen?
- Verouderde data — vers na terugnavigeren?
- Responsive — werkt op verschillende schermbreedtes?

**Vooral bij state-flows:** werkt het alleen als het hele eindresultaat er is, of is het een
mooi doorlopend proces? Als de feature aan het verwerken of streamen is, moet alles netjes
doorlopen — geen haperingen, geen lege states tussendoor, geen gebroken UI terwijl data
binnenkomt. Test dit expliciet.

### 3e. Acceptance criteria

Toets elk acceptance criterium uit de Scope. Kun je aantonen dat je implementatie eraan voldoet?

### 3f. Fixen

Werkt iets niet of ziet het er niet goed uit? Fix het nu. Ga niet verder tot alles klopt.
Test opnieuw na elke fix.

### 3g. Rapporteer

> "Testresultaten:
> - ✅ Happy path: [beschrijving]
> - ✅ Loading state: [beschrijving]
> - ✅ Error state: [beschrijving]
> - ✅ Empty state: [beschrijving]
> - ✅ Design match: [vergelijking met Figma component]
> - ✅ Plaatsing: [vergelijking met Confluence screenshot]
> - ✅ Uitlijning en spacing: [beschrijving]
> - ✅ Responsive: getest op [breedtes]
> - ⚠️ [eventuele issues]"

---

## Fase 4: Opleveren

Alles werkt en ziet er goed uit? Dan opleveren. Zie `references/confluence-workflow.md` voor
de exacte Confluence- en Slack-stappen.

### 4a. Samenvatting

Vertel de gebruiker:
- Welke componenten aangemaakt, hergebruikt of aangepast en wat ze doen
- Welke routes toegevoegd
- Welke hooks en stores aangemaakt
- Welke translation keys toegevoegd
- Eventuele handmatige stappen
- Testresultaten met screenshots

### 4b. Pipeline updates

Volg de stappen in `references/confluence-workflow.md`:
- Update de Frontend Implementation Notes op Confluence
- Update de Index-pagina status naar ✅
- Reply in de Slack thread

---

## Kwaliteitschecklist

Voordat je klaar verklaart:

- [ ] Alle routes werken en navigeren correct
- [ ] Alle data komt van de echte backend — geen mocks of hardcoded data
- [ ] Vertalingen voor zowel `en` als `nl` voor elke user-facing string
- [ ] Alle states afgehandeld: loading, error, empty, success
- [ ] Geen TODOs, placeholders of incomplete implementaties
- [ ] TypeScript strict — geen `any` types, geen missende return types
- [ ] Implementatie matcht het Figma component (visueel)
- [ ] Feature staat op de juiste plek (Confluence screenshot)
- [ ] Uitlijning en spacing zijn correct en consistent
- [ ] Responsive gedrag werkt op belangrijke breakpoints
- [ ] Edge cases afgehandeld: refresh, terug/vooruit, stale data
- [ ] Elk acceptance criterium uit de Scope aangetoond
- [ ] Bestaande functionaliteit niet kapot
- [ ] Screenshots gemaakt van het eindresultaat ter verificatie

---

## Sessie-continuïteit

Te groot voor één sessie? Dan moet je zorgen dat de volgende sessie naadloos kan oppakken
waar jij gebleven bent. Volg de stappen in `references/confluence-workflow.md` — daar staat
hoe je een uitgebreide voortgangspagina op Confluence aanmaakt met alles wat de volgende
sessie nodig heeft: wat klaar is, wat open staat, welke bestanden zijn aangemaakt/gewijzigd,
en waar op te letten.

---

## Kernprincipes

- **Analyseer eerst, bouw daarna.** Begrijp het design en de codebase voordat je code schrijft.
- **Jij bepaalt de technische aanpak.** Geen voorgeschreven architectuur. Jij analyseert en beslist.
- **Wees slim met hergebruik.** Hergebruik waar het kan, maak nieuw waar het moet. Analyseer
  altijd de impact als je bestaande componenten aanpast.
- **Feature-scoped.** Alleen code die bij deze feature hoort.
- **Volg bestaande patronen.** Jouw code moet congruent zijn met de rest van de codebase —
  inclusief naamgeving.
- **Production-ready.** Geen TODOs, geen placeholders, geen half-af werk.
- **Extra aandacht voor states.** Stateful features zijn complexer. Doe extra analyse.
- **Test altijd visueel.** Maak screenshots, vergelijk met het design, controleer uitlijning.
  Dit is verplicht.
- **Update de pipeline.** Altijd Confluence en Slack updaten als je klaar bent.
- **Het resultaat telt.** Het moet werken. Het design moet kloppen. De gebruiker moet kunnen
  doen wat de scope beschrijft.

## Taal

Communiceer in het **Nederlands** met de gebruiker. Code en comments in het **Engels**, consistent
met de bestaande codebase.
