---
name: ai-learning-center
description: >
  Bouwt en onderhoudt het AI Learning Center (onboarding portaal) voor Legal Mind — change management platform voor AI-adoptie bij advocatenkantoren. Hub + AO-puntensysteem + welkomstwizard zijn af; 6 modules staan klaar om gebouwd te worden volgens een vast patroon-systeem. Roadmap, scope en architectuurbeslissingen leven in Atlassian Confluence (SD space, parent ID 399704065). Trigger bij: "onboarding portaal", "AI Learning Center", "groeicentrum", "learning center", "AO-punten", "praktijkcasus bouwen", "SOP module", "examens module", "promptbuilder", "kennisbank module", "instructievideo's module", "admin dashboard onboarding", "change management portaal", "onboarding portal bouwen", "learning center uitbreiden", "nieuwe module toevoegen", "onboarding redesign", "portal feature", "adoptie meten", "gamification", "roadmap portaal", "backlog learning center". Trigger NIET voor de hoofdapplicatie Legal Mind zelf — alleen voor het learning center/onboarding portaal.
---

# AI Learning Center — Legal Mind

Je bouwt het AI Learning Center voor Legal Mind. Dit is het change management platform waarmee
advocatenkantoren AI-adoptie stimuleren, meten en borgen. Het portaal leeft als onderdeel van
de Legal Mind SaaS-applicatie op de route `/onboarding-claude`.

## Waarom dit portaal bestaat

Advocatenkantoren kopen Legal Mind, maar adoptie is het echte probleem. Advocaten zijn van nature
conservatief met nieuwe technologie. Dit portaal lost dat op door:

1. **Gestructureerd leren** — van instructievideo's tot praktijkcases tot examens
2. **Meetbare voortgang** — AO-punten (AI Ontwikkelpunten) per kwartaal, per persoon
3. **Kantoorbreed sturen** — het admin dashboard laat partners zien wie achterloopt
4. **Intrinsieke motivatie** — gamification die professioneel aanvoelt, niet kinderachtig

Het portaal is geen nice-to-have. Het is het verschil tussen een kantoor dat Legal Mind écht
gebruikt en een kantoor dat na 3 maanden opzegt.

---

## 📖 Live documentatie — Confluence (bron van waarheid)

Roadmap, scope, architectuurbeslissingen en migratieplannen worden **bijgehouden in Confluence**.
Lees deze pagina's eerst bij elke grotere wijziging of nieuwe module — daar staat de meest actuele
stand van zaken.

**Space:** SD (Software Development) — `bg-intelligence.atlassian.net`
**Parent:** `AI Learning Center — Technische Documentatie` (ID: **399704065**)

| Document | Confluence ID | Wanneer lezen |
|----------|--------------|---------------|
| Architectuur | `399736833` | Voor het wijzigen van hooks, services of data flow |
| Module Scope | `399769601` | Voor het bouwen van een nieuwe module (architectuurpatroon, volgorde, shared components) |
| Dev → Productie | `399802369` | Voor Azure-migratie, env vars, auth switch |
| Content Beheer | `399835137` | Voor CMS-strategie, admin UI, content data structuur |

**Gebruik de Atlassian MCP tools** om deze pagina's te lezen/updaten. Werk de Confluence-pagina bij
wanneer er architectuurbeslissingen veranderen, een fase wordt afgerond, of scope wijzigt.

---

## 📊 Huidige status (stand: april 2026)

### ✅ Compleet en productie-ready

| Onderdeel | Locatie | Wat het doet |
|-----------|---------|-------------|
| **Hub** | `hub/OnboardingHub.tsx` | Hoofdpagina met hero, 6 module cards, level journey, AO widget |
| **HeroBanner** | `hub/HeroBanner.tsx` | Donker gradient hero met welkomsttekst + pill help-buttons |
| **ModuleCard** | `hub/ModuleCard.tsx` | Herbruikbare module kaart met progress bar |
| **LevelJourney** | `hub/LevelJourney.tsx` | Minimumdoel + 3 levels pad + certificaten (inline op hub) |
| **AOWidget** | `hub/AOWidget.tsx` | Floating AO-indicator rechtsonder, klikbaar |
| **AOProgressModal** | `hub/AOProgressModal.tsx` | Rechter slide-over panel met compacte samenvatting + per-module breakdown + "Bijna klaar" insight |
| **WelcomeModal** | `hub/WelcomeModal.tsx` | 3-stap wizard (welkom → modules overzicht → quick start) |
| **FeedbackModal** | `help/FeedbackModal.tsx` | Feedback formulier |
| **RoadmapPage** | `help/RoadmapPage.tsx` | Product roadmap weergave |
| **Progress systeem** | `hooks/useOnboardingProgress.ts` + `services/progressApi.ts` | Complete read/write via Vite plugin → JSON |
| **AO-puntensysteem** | `data/ao-levels.ts` + `data/modules.ts` | 3 levels (10/20/30+), max 33 AO, level progress |
| **Type definities** | `types.ts` | Alle interfaces voor video, case, exam, SOP, etc. |
| **Dev API** | `vite-onboarding-api.ts` | REST endpoints op `/onboarding-api/*` |
| **User context (dev)** | `services/OnboardingUserContext.tsx` | Demo user switcher |

### ❌ Nog te bouwen

| Onderdeel | Fase | Blokkeert |
|-----------|------|-----------|
| Shared components (ModulePageShell, ContentGrid, StepFlow) | 0 | Alle module pagina's |
| `contentApi.ts` + Vite content plugin | 0 | Alle module pagina's |
| Content JSON data bestanden | 0 | Alle module pagina's |
| Instructievideo's module | 1 | — |
| Examens & Certificaten module (incl. QuizEngine) | 2 | — |
| Praktijkcases module | 3 | — |
| Processen (SOP's) module | 4 | — |
| Prompting module | 5 | — |
| Kennisbank module | 6 | — |
| AchievementToast | 1+ | Pop-up bij AO behaald |
| VideoPlayer | 1 | Video's module |
| Admin dashboard (Kantoor AI Groeicentrum) | Later | — |

**Voor de actuele bouwvolgorde en welke shared components nodig zijn per patroon, zie
Confluence Module Scope (ID 399769601).**

---

## De 6 modules + admin

| # | Module | Patroon | AO-punten |
|---|--------|---------|-----------|
| 1 | Instructievideo's | Browse & Doorloop | Max 12 |
| 2 | Praktijkcases | Interactieve oefening | 4 per case |
| 3 | Prompting | Interactieve oefening | 2 per collectie (max 4) |
| 4 | Examens & Certificaten | Leer & Toets | 4 leren + 4 examen = 8 totaal |
| 5 | Processen (SOPs) | Browse & Doorloop | 5 per SOP |
| 6 | Kennisbank | Naslagwerk | — |
| 7 | Help & Feedback | — | — |
| — | Kantoor AI Groeicentrum | Admin dashboard | — |

**Drie architectuurpatronen** gedeeld tussen modules (zie Confluence Module Scope voor details):
- **Patroon A — "Browse & Doorloop"** (Video's, SOP's) → `ContentGrid` + `StepFlow`
- **Patroon B — "Interactieve oefening"** (Cases, Prompting) → `StepFlow` + `AchievementToast`
- **Patroon C — "Leer & Toets"** (Examens) → `QuizEngine` + `LearnContent` + `CertificateCard`
- **Patroon D — "Naslagwerk"** (Kennisbank) → `ArticleGrid` + AI-chat integratie

---

## Hoe deze skill te gebruiken

### Bij het bouwen van een nieuwe module

1. **Check Confluence eerst** — lees Module Scope (399769601) voor het patroon + shared components
2. Lees `references/modules.md` voor module-specifieke details (UI/UX beslissingen)
3. Lees `references/design-system.md` voor styling en componenten
4. Lees `references/data-patterns.md` voor data-formaat en content-structuur
5. Bouw volgens het shared patroon — hergebruik bestaande componenten

### Bij het itereren/verbeteren

Lees het relevante reference-bestand:
- Module-specifiek → `references/modules.md`
- Styling/design → `references/design-system.md`
- Databestanden → `references/data-patterns.md`
- AO-punten → `references/ao-punten.md`
- Admin dashboard → `references/admin-dashboard.md`
- Technische architectuur → `references/architecture.md` (+ Confluence 399736833)

### Bij roadmap/backlog vragen

**Ga naar Confluence.** Roadmap en backlog leven daar, niet in deze skill. Update Confluence wanneer
fases worden afgerond of scope wijzigt.

### Bij strategisch meedenken

Lees `references/feedback-history.md` om te begrijpen welke keuzes er zijn gemaakt en waarom.
Dit voorkomt dat je dezelfde fouten maakt die al gecorrigeerd zijn.

---

## Kernprincipes (altijd geldend)

### Design & UX

1. **Clean en minimalistisch** — het portaal mag nooit "druk" aanvoelen. Liever te weinig dan
   te veel elementen. Inklapbare secties zijn je vriend.
2. **Flow boven statisch** — praktijkcases en SOPs zijn immersive full-screen flows, niet lange
   scrollpagina's. Eén stap per scherm, slide-transities, vaste navigatie onderaan.
3. **Oranje accent (#DC6F3F)** — subtiel en consistent op elke pagina: icon containers, progress
   dots, hover states, active indicators. Nooit te veel, altijd aanwezig.
4. **Professioneel, niet kinderachtig** — het zijn advocaten. Gamification mag, maar denk aan
   "AO-punten" en "certificaten", niet aan "badges" en "achievements".
5. **Cards met progress bar onderaan** — alle module-cards op het hoofdscherm en in de modules
   hebben dezelfde card-stijl met een oranje progress bar onderaan.
6. **Hero blokken** — elke module heeft een donker hero-blok bovenaan met titel, beschrijving en
   AO-punten indicator. Dit geeft een professioneel, consistent gevoel.
7. **Inklapbaar waar mogelijk** — voortgang details, sidebar, geavanceerde opties: standaard
   ingeklapt, uitklapbaar wanneer nodig.

### Architectuur — "Sandwich Pattern"

```
UI Componenten  →  Hooks  →  Service Layer  →  Data Source
                                                ├─ DEV:  Vite plugin + JSON
                                                └─ PROD: Azure Functions + Cosmos DB + Blob Storage
```

De frontend is **volledig losgekoppeld** van de data source. Bij migratie naar productie verandert
alleen de onderste laag (~10 regels code). Zie Confluence Dev → Productie (399802369).

1. **Productie-ready databestanden** — alle content (cases, SOPs, examens, video's) leeft in
   bewerkbare TypeScript/JSON-bestanden. Een niet-programmeur moet ze kunnen aanpassen (zie
   Confluence Content Beheer 399835137 voor admin UI strategie).
2. **Per item een eigen bestand** — praktijkcases in `data/cases/`, SOPs in `data/sops/`,
   examens in `data/exams/`. Instructievideo's mogen in één bestand.
3. **AO-punten centraal** — voortgang wordt gemeten in AO-punten, niet in percentages. Overal
   consistent: "3 / 12 AO" in plaats van "25%".
4. **File-based API (dev)** — voortgang via Vite server plugin die JSON-bestanden schrijft per
   gebruiker. Geen localStorage voor progress, geen cookies.
5. **User-scoped** — elke gebruiker heeft eigen voortgang. UserSwitcher voor demo, Auth0 in prod.

### Bouwvolgorde

Bouw ALTIJD in deze volgorde (zie Confluence Module Scope 399769601 voor detail):
1. **Fase 0** — Shared components eerst (ModulePageShell, ContentGrid, StepFlow, contentApi)
2. **Fase 1** — Instructievideo's (hoogste AO, patroon A voorbeeld)
3. **Fase 2** — Examens (QuizEngine herbruikbaar voor later)
4. **Fase 3** — Praktijkcases (patroon B voorbeeld)
5. **Fase 4** — SOP's (hergebruik fase 0-1)
6. **Fase 5** — Prompting (parallel met fase 4 mogelijk)
7. **Fase 6** — Kennisbank (laagste prio, geen AO)
8. Dan pas admin dashboard

---

## Quick Reference — Bestanden

| Reference | Inhoud |
|-----------|--------|
| `references/architecture.md` | Tech stack, routing, file structure, progress system, API |
| `references/modules.md` | Gedetailleerde spec per module: UI, functionaliteit, interacties |
| `references/design-system.md` | Kleuren, typografie, componenten, card-stijlen, animaties |
| `references/admin-dashboard.md` | Kantoor AI Groeicentrum: layout, metrics, medewerkers |
| `references/data-patterns.md` | Data file structuur, types, hoe content toe te voegen |
| `references/ao-punten.md` | AO-puntensysteem: verdeling, niveaus, kwartaaldoelen |
| `references/build-workflow.md` | Stap-voor-stap bouwvolgorde in ~10 prompts |
| `references/feedback-history.md` | Alle iteratie-feedback en ontwerpbeslissingen |

**Live bronnen (actueler dan de references hierboven):**

| Confluence ID | Inhoud |
|---------------|--------|
| 399704065 | Parent / overzicht |
| 399736833 | Architectuur (sandwich pattern, componenten, folders) |
| 399769601 | Module Scope (patronen, bouwvolgorde, wat ontbreekt) |
| 399802369 | Dev → Productie migratiepad |
| 399835137 | Content Beheer + CMS strategie |

---

## Content beheer

Alle content (examenvragen, cases, SOPs, video's) leeft in TypeScript/JSON databestanden en wordt
beheerd door het Legal Mind team. Kantoren krijgen standaard content.

**Content toevoegen (dev):** Direct in de TypeScript/JSON bestanden onder `data/` of
`.onboarding-data/content/`.

**Content toevoegen (productie):** Via admin UI (nog te bouwen) → Azure Blob Storage. Zie
Confluence Content Beheer (399835137) voor de CMS strategie.

**Video's:** Alle video's zijn voorlopig placeholders (thumbnails + play-icoon). De
video-infrastructuur (hosting, player) wordt later geïntegreerd.

**Simulaties:** Het "dossier toegevoegd" moment bij praktijkcases en de "herinnering sturen"
flow in het admin dashboard zijn voorlopig demo/mockups.

---

## Taal

Communiceer in het **Nederlands** met de gebruiker. Code, comments en variabelenamen in het
**Engels**, consistent met de Legal Mind codebase.
