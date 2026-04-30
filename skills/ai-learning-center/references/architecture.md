# Technische Architectuur — AI Learning Center

## Tech Stack

| Technologie | Versie | Gebruik |
|-------------|--------|---------|
| React | 18 | UI framework |
| TypeScript | Strict mode | Type safety |
| Vite | Latest | Dev server + bundling |
| Tailwind CSS | 3.x | Styling (utility-first) |
| React Router | v6 | Client-side routing (nested routes) |
| Framer Motion | Via custom wrapper | Animaties (beperkt — AnimatePresence is no-op) |
| Lucide React | Icons | Iconenbibliotheek |

### Belangrijke nuance: Framer Motion wrapper

Het project gebruikt een custom `Motion.tsx` wrapper rond Framer Motion. De `AnimatePresence` 
component in deze wrapper is een **no-op passthrough** — exit animaties werken NIET. Gebruik
daarom CSS transitions (`transition-all duration-300`) voor animaties die in/uit moeten gaan,
zoals de sidebar. Framer Motion's `motion.div` werkt wel voor enter-animaties en layout-animaties.

## Dev Server

| Onderdeel | Poort | Toelichting |
|-----------|-------|-------------|
| Frontend (Vite) | 5174 | Onboarding-claude draait op 5174 (niet 5173, dat is de hoofdapp) |
| Onboarding API | Ingebouwd | Vite server plugin, geen aparte server |

De onboarding API draait als Vite plugin (`vite-onboarding-api.ts`) en biedt REST endpoints
voor gebruikersvoortgang. In productie wordt dit vervangen door de echte backend.

## Mappenstructuur

```
src/pages/onboarding-claude/
├── OnboardingHub.tsx          # Hoofdoverzicht met 6 module-cards
├── OnboardingLayout.tsx       # Layout wrapper met UserProvider
├── InstructieVideos.tsx       # Module 1: Instructievideo's
├── PraktijkCases.tsx          # Module 2: Praktijkcases overzicht
├── PraktijkCaseDetail.tsx     # Module 2: Individuele case flow
├── Prompting.tsx              # Module 3: Prompt builder + collecties
├── Examens.tsx                # Module 4: Examens & certificaten hub
├── ExamDetail.tsx             # Module 4: Individueel examen
├── SOPs.tsx                   # Module 5: Processen overzicht
├── SOPDetail.tsx              # Module 5: Individuele SOP flow
├── Kennisbank.tsx             # Module 6: AI-chat + artikelen kennisbank
├── HelpFeedback.tsx           # Help & Feedback: roadmap, support, feedbackformulier
├── KantoorGroeicentrum.tsx    # Admin dashboard
│
├── components/
│   ├── Motion.tsx             # Framer Motion wrapper (AnimatePresence = no-op!)
│   ├── UserSwitcher.tsx       # Demo user switching dropdown
│   └── ...                    # Overige gedeelde componenten
│
├── hooks/
│   └── useOnboardingProgress.ts  # Centrale voortgang hook (in-memory + API sync)
│
├── services/
│   ├── progressApi.ts         # API client voor voortgang endpoints
│   └── UserContext.tsx         # React context voor huidige gebruiker
│
├── data/
│   ├── videos.ts              # Instructievideo's data (één bestand)
│   ├── cases/                 # Praktijkcases (één bestand per case)
│   │   ├── types.ts
│   │   ├── case-verb-1.ts     # Verborgen gebreken case
│   │   ├── case-arb-1.ts      # Arbeidsrecht case
│   │   ├── ...
│   │   └── index.ts           # Exports: alleCases, getCaseById(), etc.
│   ├── sops/                  # SOPs (één bestand per SOP)
│   │   ├── types.ts
│   │   ├── klachtenproces-ova.ts
│   │   ├── letselschade.ts
│   │   ├── ...
│   │   └── index.ts           # Exports: alleSops, getSopById(), etc.
│   └── exams/                 # Examens (één bestand per module)
│       ├── types.ts
│       ├── ai-act.ts
│       ├── ova-richtlijnen.ts
│       ├── legal-mind.ts
│       ├── intern-beleid.ts
│       ├── effectieve-prompts.ts
│       └── index.ts           # Exports: alleModules, getModule(), etc.
│
├── vite-onboarding-api.ts     # Vite server plugin voor progress API
├── INSTRUCTIE-AI.md           # Uitgebreide AI-documentatie
└── INSTRUCTIE-DEVELOPER.md    # Beknopte developer-documentatie
```

## Routing

Routes zijn genest onder een layout component:

```tsx
// In Router.tsx
{
  path: "/onboarding-claude",
  element: <OnboardingLayout />,  // Wraps children in UserProvider
  children: [
    { index: true, element: <OnboardingHub /> },
    { path: "videos", element: <InstructieVideos /> },
    { path: "cases", element: <PraktijkCases /> },
    { path: "cases/:caseId", element: <PraktijkCaseDetail /> },
    { path: "prompting", element: <Prompting /> },
    { path: "examens", element: <Examens /> },
    { path: "examens/:moduleId", element: <ExamDetail /> },
    { path: "examens/:moduleId/learn", element: <ExamDetail /> },
    { path: "examens/:moduleId/exam", element: <ExamDetail /> },
    { path: "sops", element: <SOPs /> },
    { path: "sops/:sopId", element: <SOPDetail /> },
    { path: "kennisbank", element: <Kennisbank /> },
    { path: "help", element: <HelpFeedback /> },
    { path: "beheerder", element: <KantoorGroeicentrum /> },
  ],
}
```

### OnboardingLayout

Wraps alle onboarding routes in een `<UserProvider>` zodat elke pagina toegang heeft tot
de huidige gebruiker via `useCurrentUser()`.

## Voortgang Systeem

### Architectuur (3 lagen)

```
Component (UI)
    ↓ useOnboardingProgress() hook
In-Memory Store (useSyncExternalStore)
    ↓ fire-and-forget API calls
Vite Server Plugin → JSON bestanden per user
```

### useOnboardingProgress hook

De centrale hook die ALLE voortgang beheert. Biedt:

**Check functies:**
- `isVideoWatched(videoId)` → boolean
- `isCaseStepCompleted(caseId, stepIndex)` → boolean
- `isSOPStepCompleted(sopId, stepIndex)` → boolean
- `isCaseCompleted(caseId)` → boolean (alle stappen voltooid)
- `isSOPCompleted(sopId)` → boolean

**Toggle functies:**
- `toggleVideoWatched(videoId)`
- `toggleCaseStep(caseId, stepIndex)`
- `toggleSOPStep(sopId, stepIndex)`
- `markCaseCompleted(caseId)`
- `markSOPCompleted(sopId)`

**Reset functies:**
- `resetCase(caseId)` — wist alle stappen voor een case
- `resetSOP(sopId)` — wist alle stappen voor een SOP

**Data:**
- `progress` — het volledige progress object
- `progress.completedVideos: string[]`
- `progress.completedCaseSteps: Record<string, number[]>`
- `progress.completedSOPSteps: Record<string, number[]>`
- `progress.completedSOPs: string[]`
- `progress.completedExamLearns: string[]`
- `progress.completedExams: Record<string, { score: number, total: number }>`
- `progress.promptLibrary: string[]` (toegevoegde prompt collecties)

### Vite Server Plugin API

Endpoints (alleen voor dev — in productie vervangen door echte backend):

| Method | Endpoint | Beschrijving |
|--------|----------|-------------|
| GET | `/onboarding-api/users` | Lijst alle gebruikers |
| GET | `/onboarding-api/progress/:userId` | Haal voortgang op |
| PUT | `/onboarding-api/progress/:userId` | Sla voortgang op |
| DELETE | `/onboarding-api/progress/:userId` | Reset voortgang |

Data wordt opgeslagen in `server-data/` directory als JSON per gebruiker.
Drie standaard demo-users: Sophie van der Berg, Mark de Vries, Lisa Jansen.

### User Context

`UserContext.tsx` biedt `useCurrentUser()` die de huidige geselecteerde gebruiker teruggeeft.
De selectie wordt opgeslagen in `sessionStorage` (key: `lm-onboarding-current-user`).
Dit is het ENIGE gebruik van sessionStorage — alle voortgang gaat via de API.

## Scroll-to-top

Elke pagina moet bij navigatie bovenaan beginnen. Implementeer een `useEffect` die bij
mount naar boven scrollt, of gebruik een ScrollToTop component in de layout. Dit was een
bug die meerdere keren voorkwam (kennisbank, examens scrollden naar beneden).

## Bekende technische beperkingen

1. **AnimatePresence werkt niet** — gebruik CSS transitions voor in/uit animaties
2. **Pad met dubbele streepjes** — het worktree-pad bevat `--` wat Write/Edit tools kan breken
   in agents. Gebruik `cat > "filepath" << 'ENDOFFILE'` als workaround in Bash.
3. **sessionStorage alleen voor user ID** — alle andere opslag via API calls
4. **Geen i18n** — het onboarding portaal gebruikt hardcoded Nederlandse strings (verschilt
   van de hoofdapp die i18n heeft). Dit is bewust — het portaal is alleen voor NL markt.
