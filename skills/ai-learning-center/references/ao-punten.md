# AO-Punten — AI Ontwikkelpunten

Het meetbare voortgangsysteem van het AI Learning Center.

## Wat zijn AO-punten?

AO staat voor "AI Ontwikkeling". Het is het puntensysteem waarmee advocatenkantoren meten
hoe ver hun medewerkers zijn in het leren en adopteren van AI via Legal Mind.

De naam is bewust gekozen: advocaten kennen "studiepunten" (PO-punten) die ze jaarlijks moeten
behalen. AO-punten voelen daarom vertrouwd en professioneel aan.

## Puntenverdeling per module

| Module | Activiteit | AO-punten | Toelichting |
|--------|-----------|-----------|-------------|
| Instructievideo's | Video bekijken | Variabel (0-2 per video) | Max 12 AO totaal. Sommige video's = 0 (bijv. DMS integratie) |
| Praktijkcases | Case AFRONDEN | 4 per case | Niet per stap! Pas bij voltooien van ALLE stappen |
| Prompting | Collectie implementeren | 2 per collectie | Max 2 collecties tellen mee = 4 AO max |
| Examens | Leerfase afronden | 4 per module | Alle leervragen doorgewerkt |
| Examens | Examen halen | 4 per module | Cesuur behalen op het examen |
| Processen (SOPs) | SOP AFRONDEN | 5 per SOP | Niet per stap! Pas bij voltooien |
| Kennisbank | — | 0 | Geen punten, is naslagwerk |

## Kwartaaldoelen

AO-punten worden per kwartaal gemeten. Als je meer punten haalt dan het doel, neem je het
overschot mee naar het volgende kwartaal.

### 3 Niveaus

| Niveau | Naam | Kwartaaldoel | Beschrijving |
|--------|------|-------------|-------------|
| 1 | Kantoorminimum | ~10 AO | Minimale betrokkenheid, een paar video's en een case |
| 2 | AI Gebruiker | ~25 AO | Actief bezig, cases + examens + SOPs |
| 3 | AI Kartrekker | ~45 AO | Alles doorlopen, certificaten behaald, prompt library actief |

De exacte aantallen zijn configureerbaar.

## Weergave in het portaal

### Overal consistent
Voortgang wordt ALTIJD in AO-punten getoond, NIET in percentages.

Voorbeelden:
- Hoofdoverzicht: "10 / 25 AO-punten dit kwartaal"
- Module card: "3 / 12 AO" (niet "25%")
- In de module zelf: rechtsbovenin "4 / 12 AO behaald"
- Bij individuele items: AO-badge "4 AO" bij een case card

### AO-punten popup
Klikbaar vanuit het hoofdoverzicht → grote popup met:
- Huidige kwartaalvoortgang met niveau-indicator
- Per module: behaald vs beschikbaar
- "Hoe werken AO-punten?" uitleg-sectie
- Video (introductie op AO-punten)

### In het admin dashboard
- Kantoorgemiddelde AO-punten
- Per medewerker: behaalde AO-punten
- Vergelijking met kwartaaldoel
- Achterblijvers = mensen onder het kantoorminimum

## Technische implementatie

AO-punten worden BEREKEND uit de voortgangsdata, niet apart opgeslagen.
De hook `useOnboardingProgress` biedt de ruwe data, en een aparte functie berekent
de AO-punten:

```typescript
function berekenAOPunten(progress: OnboardingProgress): AOPuntenOverzicht {
  return {
    videos: telVideoAOPunten(progress.completedVideos),
    cases: progress.completedCases.length * 4,
    prompting: Math.min(progress.promptLibrary.length, 2) * 2,
    examensLeren: progress.completedExamLearns.length * 4,
    examensExamen: Object.keys(progress.completedExams).filter(
      id => progress.completedExams[id].score >= getCesuur(id)
    ).length * 4,
    sops: progress.completedSOPs.length * 5,
  };
}
```

## Belangrijke feedback

- "We noemen het AO-punten!"
- "Geen procenten meer — AO-punten overal"
- "Per kwartaal, 3 niveaus: kantoorminimum, AI gebruiker, AI kartrekker"
- "Instructievideo's niet allemaal AO-punten — sommige ook 0"
- "Alleen hele praktijkcasus afronden, niet per stap"
- "Maximaal 2 collecties voor prompt library punten"
