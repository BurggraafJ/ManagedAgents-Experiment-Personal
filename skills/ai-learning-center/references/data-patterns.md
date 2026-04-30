# Data Patterns — AI Learning Center

Hoe content-bestanden zijn opgezet zodat niet-programmeurs ze kunnen bewerken.

## Principe

Alle content leeft in TypeScript-bestanden met uitgebreide Nederlandse comments die uitleggen
hoe je het bestand aanpast. De bestanden zijn zo geschreven dat iemand die geen code kan lezen
toch begrijpt wat waar staat en hoe je iets toevoegt of wijzigt.

## Mappenstructuur

```
data/
├── videos.ts              # Eén bestand voor alle video's
├── cases/                 # Eén bestand PER praktijkcasus
│   ├── types.ts           # TypeScript interfaces
│   ├── case-verb-1.ts     # Verborgen gebreken (verbintenissenrecht, niveau 1)
│   ├── case-arb-1.ts      # Ontslag (arbeidsrecht, niveau 1)
│   ├── case-best-1.ts     # Bezwaar (bestuursrecht, niveau 1)
│   ├── case-ond-1.ts      # Bestuurdersaansprakelijkheid
│   ├── case-straf-1.ts    # Economisch delict
│   ├── case-bed-1.ts      # Bedrijfsrecht
│   └── index.ts           # Verzamelt alle cases, biedt helper functies
├── sops/                  # Eén bestand PER SOP
│   ├── types.ts
│   ├── klachtenproces-ova.ts
│   ├── letselschade.ts
│   ├── due-diligence.ts
│   ├── incasso.ts
│   ├── bezwaar-bestuursrecht.ts
│   └── index.ts           # Verzamelt alle SOPs, biedt helper functies
└── exams/                 # Eén bestand PER examenmodule
    ├── types.ts
    ├── ai-act.ts
    ├── ova-richtlijnen.ts
    ├── legal-mind.ts
    ├── intern-beleid.ts
    ├── effectieve-prompts.ts
    └── index.ts           # Verzamelt alle modules, biedt helper functies
```

## Bestandspatroon — Examens

```typescript
// ============================================================
// EXAMENMODULE: AI Act — Europese AI-verordening
// ============================================================
//
// HOE DIT BESTAND TE BEWERKEN:
// - Elke vraag heeft een "vraag" (de vraagtekst), "antwoorden" (de opties),
//   "uitleg" (wordt altijd getoond na beantwoording) en "tip" (extra hint bij fout).
// - Bij de antwoorden: zet "correct: true" bij het JUISTE antwoord.
//   Alle andere antwoorden hoeven geen "correct" veld (of zet "correct: false").
// - Voeg nieuwe vragen toe door een blok te kopiëren en aan te passen.
// - De "leervragen" zijn voor de studeerfase, de "examenvragen" voor het echte examen.
//
// ============================================================

import type { ExamModule } from "./types";

export const aiAct: ExamModule = {
  id: "ai-act",
  titel: "AI Act",
  beschrijving: "De Europese AI-verordening en wat het betekent voor advocaten.",
  onderwerpen: ["Risicocategorieën", "Verplichtingen", "Toezicht"],
  cesuur: 70, // percentage dat je goed moet hebben om te slagen
  aoPuntenLeren: 4,
  aoPuntenExamen: 4,
  leervragen: [
    {
      vraag: "Wat is het doel van de AI Act?",
      antwoorden: [
        { tekst: "AI volledig verbieden in de EU", correct: false },
        { tekst: "Een juridisch kader scheppen voor veilig en verantwoord AI-gebruik", correct: true },
        { tekst: "Alleen grote techbedrijven reguleren", correct: false },
        { tekst: "AI-ontwikkeling vertragen", correct: false },
      ],
      uitleg: "De AI Act creëert een juridisch kader dat veilig, transparant en verantwoord gebruik van AI in de EU waarborgt.",
      tip: "Denk aan regulering, niet aan verbieden.",
    },
    // ... meer vragen
  ],
  examenvragen: [
    // ... 15 examenvragen
  ],
};
```

### Types bestand (exams/types.ts)

```typescript
export interface Antwoord {
  tekst: string;
  correct: boolean;
}

export interface Vraag {
  vraag: string;
  antwoorden: Antwoord[];
  uitleg: string;
  tip: string;
}

export interface ExamModule {
  id: string;
  titel: string;
  beschrijving: string;
  onderwerpen: string[];
  cesuur: number; // percentage om te slagen
  aoPuntenLeren: number;
  aoPuntenExamen: number;
  leervragen: Vraag[];
  examenvragen: Vraag[];
}
```

### Index bestand (exams/index.ts)

```typescript
import { aiAct } from "./ai-act";
import { ovaRichtlijnen } from "./ova-richtlijnen";
// ... alle imports

export const alleModules = [aiAct, ovaRichtlijnen, legalMind, internBeleid, effectievePrompts];

export function getModule(id: string) {
  return alleModules.find((m) => m.id === id) ?? null;
}
```

## Bestandspatroon — Praktijkcases

```typescript
// ============================================================
// PRAKTIJKCASUS: Verborgen Gebreken bij Woningverkoop
// ============================================================
//
// HOE DIT BESTAND TE BEWERKEN:
// - Pas de titel, beschrijving en kerngegevens aan
// - Voeg stappen toe of verwijder ze
// - Elke stap heeft een titel, beschrijving, module (welke LM module), 
//   instructies (array van strings) en optioneel een prompt
// - De "modules" zijn: "assistent", "dossier", "tabel", "documentdrafter"
//
// ============================================================

import type { PraktijkCase } from "./types";

export const caseVerb1: PraktijkCase = {
  id: "case-verb-1",
  titel: "Verborgen Gebreken bij Woningverkoop",
  rechtsgebied: "Verbintenissenrecht",
  niveau: 1,
  beschrijving: "Je client heeft een woning gekocht met ernstige vochtproblemen...",
  kerngegevens: {
    partijen: "Koper vs. Verkoper",
    onderwerp: "Non-conformiteit art. 7:17 BW",
    // ...
  },
  leerdoelen: [
    "Dossier opbouwen in Legal Mind",
    "Juridische analyse uitvoeren met de Assistent",
    // ...
  ],
  aoPunten: 4,
  stappen: [
    {
      titel: "Dossier importeren",
      beschrijving: "Open Legal Mind en importeer het casedossier.",
      module: "dossier",
      instructies: [
        "Open de Dossiermodule in Legal Mind",
        "Klik op 'Nieuw dossier'",
        "Upload de aangeleverde documenten",
      ],
      prompt: null, // geen prompt bij deze stap
    },
    {
      titel: "Juridische analyse",
      beschrijving: "Analyseer de zaak met de AI Assistent.",
      module: "assistent",
      instructies: [
        "Open de Assistent in je dossier",
        "Gebruik onderstaande prompt",
      ],
      prompt: "Analyseer dit dossier op non-conformiteit volgens art. 7:17 BW...",
    },
    // ... meer stappen
  ],
};
```

## Bestandspatroon — SOPs

Identiek aan cases maar met `geschatteTijd` en zonder `niveau`/`rechtsgebied`:

```typescript
export const letselschade: SOP = {
  id: "letselschade",
  titel: "Letselschadeprocedure",
  beschrijving: "Stapsgewijs een letselschadezaak opzetten in Legal Mind.",
  rechtsgebied: "Letselschade",
  geschatteTijd: "45 minuten",
  aoPunten: 5,
  stappen: [
    {
      titel: "Intake en dossieropbouw",
      beschrijving: "...",
      instructies: ["Open Legal Mind", "Maak een nieuw dossier", "..."],
      prompt: "Maak een samenvatting van de intake...",
    },
    // ...
  ],
};
```

## Bestandspatroon — Video's

Eén bestand met alle video's, georganiseerd per categorie:

```typescript
// ============================================================
// INSTRUCTIEVIDEO'S — AI Learning Center
// ============================================================
//
// HOE DIT BESTAND TE BEWERKEN:
// - Voeg een nieuw video-object toe aan de juiste categorie-array
// - Categorieën: "platform" (introductie), "module" (verdieping), "vaardigheden"
// - aoPunten: zet op 0 als de video geen punten oplevert
// - duurMinuten: lengte in minuten
//
// ============================================================

export const videos = {
  platform: [
    {
      id: "vid-intro-1",
      titel: "Welkom bij Legal Mind",
      beschrijving: "Eerste kennismaking met het platform.",
      duurMinuten: 5,
      aoPunten: 2,
      thumbnailUrl: null, // placeholder
      videoUrl: null, // placeholder
    },
    // ...
  ],
  module: [
    // NIET te veel hier — max 2-3 per module
  ],
  vaardigheden: [
    // DMS integratie, prompts, etc.
  ],
};
```

## Nieuw bestand toevoegen

### Nieuwe praktijkcasus
1. Maak een nieuw bestand in `data/cases/`, bijv. `case-fam-1.ts`
2. Kopieer de structuur van een bestaand case-bestand
3. Pas alle velden aan
4. Voeg de import + export toe aan `data/cases/index.ts`

### Nieuw examen
1. Maak een nieuw bestand in `data/exams/`, bijv. `beroepsaansprakelijkheid.ts`
2. Kopieer de structuur van een bestaand examen
3. Voeg minimaal 50 leervragen en 15 examenvragen toe
4. Voeg de import + export toe aan `data/exams/index.ts`

### Nieuwe SOP
1. Maak een nieuw bestand in `data/sops/`, bijv. `arbitrage.ts`
2. Kopieer de structuur van een bestaand SOP
3. Voeg de import + export toe aan `data/sops/index.ts`

## Correctheid-patroon

Examenvragen gebruiken `correct: true` op het juiste antwoord (NIET een `correctIndex` nummer).
De component gebruikt een helper functie:

```typescript
function getCorrectIndex(vraag: Vraag): number {
  return vraag.antwoorden.findIndex((a) => a.correct);
}
```

Dit maakt het voor niet-programmeurs makkelijker: je ziet direct welk antwoord juist is.

## Content genereren met een skill

Het Legal Mind team beheert alle content. Om nieuwe examenvragen, praktijkcases en SOPs
efficiënt te maken, gebruik je een aparte **content-generator skill**. Deze skill:

1. Vraagt om het type content (examen, case, SOP)
2. Vraagt om het onderwerp, rechtsgebied, niveau, etc.
3. Genereert de content in exact het TypeScript-formaat zoals hierboven beschreven
4. Output is direct kopieerbaar naar het juiste databestand

**Workflow:**
- Draai de content-generator skill → krijg TypeScript output
- Kopieer de output naar het juiste bestand in `data/`
- Voeg de import/export toe aan de `index.ts`
- Klaar — geen handmatig formatteren nodig

Dit voorkomt fouten in het dataformaat en versnelt het toevoegen van content enorm.
