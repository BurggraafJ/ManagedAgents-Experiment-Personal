# Bouwvolgorde — AI Learning Center

Stap-voor-stap plan om het portaal op te bouwen in ~11 Claude Code prompts.
Elke stap is één afgebakende prompt die één ding goed doet.

## Waarom stapsgewijs?

Het portaal is te groot om in één prompt te bouwen. Door het op te delen:
- Blijft elke prompt beheersbaar (~200-400 regels code per stap)
- Kun je na elke stap testen en feedback geven
- Voorkom je dat de AI vastloopt op te veel tegelijk
- Kun je de "rekenkracht verdelen" over meerdere sessies

## De 11 stappen

### Stap 1: Basis & Hub
**Wat:** OnboardingHub, OnboardingLayout, routing, basis componenten
**Bouw:**
- OnboardingLayout.tsx (UserProvider wrapper)
- OnboardingHub.tsx met 6 module-cards (titels, beschrijvingen, placeholder AO-punten)
- Donker hero-blok met welkomstbericht
- Basis routing in Router.tsx
- Placeholder pagina's voor alle 6 modules (lege componenten die "Coming soon" tonen)
**Resultaat:** Je kunt naar /onboarding-claude navigeren en de 6 cards zien.

### Stap 2: Progress System & Data Layer
**Wat:** useOnboardingProgress hook, Vite API plugin, UserContext, UserSwitcher
**Bouw:**
- vite-onboarding-api.ts (Vite server plugin)
- services/progressApi.ts (API client)
- services/UserContext.tsx (React context)
- hooks/useOnboardingProgress.ts (centrale hook)
- components/UserSwitcher.tsx (demo user switching)
- Data types (cases/types.ts, sops/types.ts, exams/types.ts)
**Resultaat:** Voortgang kan worden opgeslagen en opgehaald per gebruiker.

### Stap 3: Instructievideo's
**Wat:** InstructieVideos.tsx + data/videos.ts
**Bouw:**
- data/videos.ts met alle video data (platform, module, vaardigheden)
- InstructieVideos.tsx met 3 tabs, video cards, bekeken-status
- AO-punten weergave rechtsbovenin
**Resultaat:** Je kunt video's bekijken en markeren als bekeken.

### Stap 4: Praktijkcases — Overzicht
**Wat:** PraktijkCases.tsx + data/cases/ bestanden
**Bouw:**
- Alle case data bestanden in data/cases/
- PraktijkCases.tsx met rechtsgebied-selectie (profiel + andere)
- Case cards met niveaus (basis/gevorderd/expert)
- Lock/unlock logica
**Resultaat:** Je ziet alle cases per rechtsgebied en niveau.

### Stap 5: Praktijkcases — Detail & Flow
**Wat:** PraktijkCaseDetail.tsx (de immersive full-screen flow)
**Bouw:**
- Case intro pagina (samenvatting, stappen-overzicht, "Start casus")
- Full-screen flow (fixed inset-0, slide-transities, navigatie onderaan)
- Glassmorphism popup bij start ("Dossier toegevoegd")
- Stap voltooid/navigatie logica
- Completion screen
- Opnieuw starten functionaliteit
**Resultaat:** Je kunt een complete case doorlopen als immersive flow.

### Stap 6: Processen (SOPs)
**Wat:** SOPs.tsx + SOPDetail.tsx + data/sops/ bestanden
**Bouw:**
- Alle SOP data bestanden in data/sops/
- SOPs.tsx overzicht met rechtsgebied-filter en zoekfunctie
- SOPDetail.tsx met intro (video placeholder), stappen-flow, prompt blokken
- "Alle prompts" blok met "Voeg toe aan Prompt Library"
- Opnieuw starten functionaliteit
**Resultaat:** Je kunt SOPs doorlopen en prompts toevoegen aan je library.

### Stap 7: Prompting
**Wat:** Prompting.tsx met collecties en prompt builder
**Bouw:**
- Tab 1: Collecties (prompt-sets per proces)
- Tab 2: Prompt Builder (full-width, genummerde stappen, geavanceerde opties)
- Dossier-selectie popup
- Prompt generatie logica
- Video rechtsbovenin
- "Maak hem nog specifieker" toggle voor geavanceerd
**Resultaat:** Je kunt collecties bekijken en eigen prompts bouwen.

### Stap 8: Examens & Certificaten
**Wat:** Examens.tsx + ExamDetail.tsx + data/exams/ bestanden
**Bouw:**
- Alle examen data bestanden in data/exams/
- Examens.tsx hub met 2 categorieën, selectable balk
- ExamDetail.tsx met leerfase (studeren) en examenfase
- Uitleg + tip bij elke vraag
- Score berekening, certificaat markering
- Opnieuw starten / herkansen
**Resultaat:** Je kunt studeren en examens afleggen.

### Stap 9: Kennisbank
**Wat:** Kennisbank.tsx
**Bouw:**
- Chat-interface (conceptueel — placeholder voor AI)
- Artikel-overzicht
- Zoekfunctie
- Brede layout
**Resultaat:** Je kunt artikelen zoeken en de chat-interface zien.

### Stap 10: Help & Feedback
**Wat:** HelpFeedback.tsx — de 7e card op het hoofdscherm
**Bouw:**
- Donker hero-blok (iets anders dan de modules — dit is geen leermodule)
- 3 secties: Roadmap (product timeline), Support (→ kennisbank verwijzing + ticketformulier), Feedback (formulier)
- Support leidt eerst naar Kennisbank, dan pas ticketoptie
- Feedbackformulier: onderwerp, bericht, categorie (bug/suggestie/vraag)
- Geen AO-punten, geen progress bar
- Card op hoofdscherm visueel net anders dan de 6 module-cards
**Resultaat:** Gebruikers kunnen roadmap bekijken, hulp zoeken en feedback geven.

### Stap 11: Admin Dashboard
**Wat:** KantoorGroeicentrum.tsx
**Bouw:**
- Ander hero-blok dan Learning Center
- Kantoormetrics (certificaten, AO-punten, actieve medewerkers)
- Achterblijvers sectie (scrollbaar, herinnering sturen — demo/mockup)
- Toppers sectie
- Medewerkersoverzicht (klikbaar naar detail)
- Medewerker detail: certificaten, activiteit, voortgang
**Resultaat:** Partners kunnen kantoorvoortgang meten en sturen.

## Na de 11 stappen

### Polish ronde
- AO-punten overal consistent maken
- Oranje accenten op elke pagina controleren
- Inklapbare secties op het hoofdscherm
- Welkomst-popup met video
- Scroll-to-top op elke pagina
- Responsive check

### Iteratie
- Feedback verwerken per module
- Cards styling consistent maken
- Hero-blokken afstemmen
- Edge cases afhandelen

## Tips voor elke prompt

1. **Geef de stap-nummer mee** — "Bouw stap 4: Praktijkcases overzicht"
2. **Refereer naar deze skill** — de AI leest dan de juiste module-specs
3. **Test na elke stap** — open de browser, klik door, geef feedback
4. **Eén ding per prompt** — niet combineren, anders wordt het te veel
5. **Bij bugs: apart fixen** — maak een aparte prompt voor bugfixes, meng niet met nieuwe features
