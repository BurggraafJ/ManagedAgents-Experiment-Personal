# LegalMind Frontend Architectuur Standaarden

Referentiedocument met de tech stack, codebase structuur en patronen. Gebruik dit als startpunt
bij je codebase-analyse — verifieer altijd tegen de actuele code.

---

## Tech Stack

- **Framework**: React 18+ met TypeScript
- **Build tool**: Vite
- **Routing**: react-router-dom v6 (createBrowserRouter)
- **Styling**: Tailwind CSS
- **State management**: Zustand (stores/)
- **Internationalisatie**: i18next (en, nl)
- **Auth**: Auth0 (via AuthWrapper component)
- **Monitoring**: Sentry + Azure Application Insights
- **Hosting**: Azure Static Web Apps

---

## Mappenstructuur

```
FrontEnd/src/
├── pages/                    # Pagina-componenten (één per route)
│   ├── Assistant.tsx, AssistantNew.tsx, AssistantSession.tsx
│   ├── Case.tsx, CaseDetails.tsx, Cases.tsx
│   ├── Drafter.tsx, Editor.tsx, Table.tsx
│   ├── Home.tsx, Landing.tsx, LandingNew.tsx
│   ├── Login.tsx, Register.tsx, Profile.tsx
│   └── LegalSearch.tsx, Verdict.tsx, NotFound.tsx
│
├── components/               # Herbruikbare UI-componenten (per domein)
│   ├── assistant/            # Assistant-specifiek
│   ├── case/, case-management/, cases/
│   ├── chat/                 # Chat UI
│   ├── drafter/              # Drafter-specifiek
│   ├── general/              # Gedeeld/algemeen
│   ├── icons/, logos/        # Iconen en logo's
│   ├── integrations/         # Integraties
│   ├── legal-search/         # Juridisch zoeken
│   ├── modals/               # Modal dialogen
│   ├── settings/             # Instellingen
│   ├── sources/              # Bronweergave
│   ├── table/                # Tabelextractie
│   └── [root: ConfirmModal, Logo, ProgressBar, QueryInput, etc.]
│
├── hooks/                    # Custom React hooks (per domein)
│   ├── assistant/, case/, cases/, drafter/, table/, templates/
│   ├── useUser.ts            # User info
│   ├── useSSEQuery.ts        # SSE query
│   ├── useSSEMutation.ts     # SSE mutation
│   ├── useEventSourceQuery.ts
│   ├── useDebounce.ts, useMediaQuery.tsx
│   └── useCaseDocumentUpload.ts, useIntegrationInfo.ts, etc.
│
├── stores/                   # Zustand state stores (per domein)
│   ├── assistant/, base/, case/, cases/, common/
│   ├── drafter/, upload/
│   └── documentProcessing/, promptStore/
│
├── context/                  # React context providers
│   ├── NotificationContext.tsx, adminMode.tsx
│   ├── caseManagementSetting.tsx, caseUpload.tsx
│   ├── feedback.tsx, gradient.tsx, language.tsx, load.tsx, location.tsx
│
├── types/                    # TypeScript type definities
│   ├── assistant.ts, case.ts, config.ts, filters.ts
│   ├── legal.ts, navigation.ts, search.ts, updates.ts
│
├── i18n/                     # Internationalisatie
│   ├── config.ts
│   ├── en/                   # Engels
│   └── nl/                   # Nederlands
│
├── lib/services/             # Utility libraries
├── config/                   # App configuratie
├── helpers/                  # Helper functies
├── styles/                   # Globale stijlen
├── assets/                   # Statische assets
│
├── App.tsx                   # Root app component
├── AuthWrapper.tsx           # Auth0 wrapper
├── Layout.tsx                # Hoofd-layout (sidebar + content)
├── ChatLayout.tsx            # Chat-specifieke layout
├── Router.tsx                # Route definities
└── main.tsx                  # Entry point
```

---

## Routes

| Pad | Component | Beschrijving |
|-----|-----------|-------------|
| `/` | LandingNew | Landingspagina |
| `/search` | Home | Zoekpagina |
| `/login` | Login | Login (geen auth) |
| `/register` | Register | Registratie (geen auth) |
| `/profile` | Profile | Gebruikersprofiel |
| `/cases` | Cases | Zakenlijst |
| `/case/:caseId` | Case | Zaakweergave |
| `/editor` | Editor | Document editor |
| `/drafter` | Drafter | AI document drafter |
| `/assistant` | AssistantNew | AI assistent (nieuw) |
| `/assistant/:sessionId` | AssistantSession | AI assistent (bestaand) |
| `/table` | Table | Tabelextractie |
| `/verdict/:caseId` | Verdict | Uitspraak (ChatLayout) |
| `/law/:caseId` | Verdict | Wet (ChatLayout) |
| `/msintegration` | MSIntegrationHandler | MS integratie callback |

---

## Patronen

### State Management

| State type | Gebruik |
|---|---|
| Feature/domein data (opgehaald, gecachet, gedeeld) | Zustand store |
| Cross-cutting concerns (notificaties, taal, thema) | React Context |
| UI-only state (form inputs, toggles, hover) | Lokale useState |

Stores georganiseerd per domein in `stores/`. Elke store heeft: state velden, actions, selectors.

### Data Fetching

- **SSE** voor streaming: `useSSEQuery`, `useSSEMutation`, `useEventSourceQuery`
- **Standaard fetch** voor REST/CRUD: volg bestaande hook patronen per domein

### Authenticatie

- Auth0 via `AuthWrapper`
- Alle auth routes gewrapt in `<AuthWrapper>`
- `useUser` hook voor user info (ID, firm ID, permissies)
- Nooit direct auth state benaderen

### Internationalisatie

- i18next met `en` en `nl`
- Elke user-facing string via translation keys
- Keys: `{domein}.{sectie}.{element}`
- Gebruik `useTranslation()` hook

### Error Handling

- ErrorBoundary op root niveau met `GenericErrorPopup`
- Sentry + Application Insights
- Componenten handelen eigen error states af

### Component Organisatie

- Domein-specifiek in submappen: `components/{domein}/`
- Gedeeld in `components/general/` of root
- Eén component per bestand, PascalCase

### Tailwind Styling

- Utility classes voor alle styling
- Volg bestaande spacing/kleurpatronen
- Responsive via breakpoints (`sm:`, `md:`, `lg:`, `xl:`)

---

## Belangrijke bestanden

| Bestand | Doel |
|---|---|
| `Router.tsx` | Alle route definities |
| `Layout.tsx` | Hoofd layout (sidebar + content) |
| `ChatLayout.tsx` | Chat layout |
| `AuthWrapper.tsx` | Auth0 integratie |
| `hooks/useUser.ts` | User info |
| `hooks/useSSEQuery.ts` | SSE data fetching |
| `hooks/useSSEMutation.ts` | SSE mutations |
| `i18n/config.ts` | i18n setup |

---

## Waar hoort code thuis?

| Code Type | Locatie |
|---|---|
| Pagina-component (route) | `pages/` |
| Domein UI-component | `components/{domein}/` |
| Gedeeld UI-component | `components/general/` of root |
| Data fetching / domeinlogica hook | `hooks/{domein}/` |
| Gedeelde hook | `hooks/` root |
| Zustand store | `stores/{domein}/` |
| TypeScript interfaces | `types/{domein}.ts` |
| Vertaalstrings | `i18n/en/{domein}.json` + `i18n/nl/{domein}.json` |
| Helpers | `helpers/` |
| Stijlen | `styles/` |
| Assets | `assets/` |
