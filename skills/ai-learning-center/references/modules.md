# Modules — AI Learning Center

Gedetailleerde specificatie van alle 6 modules. Lees dit bestand wanneer je een specifieke
module bouwt of aanpast.

## Inhoudsopgave

1. [Instructievideo's](#1-instructievideo's)
2. [Praktijkcases](#2-praktijkcases)
3. [Prompting](#3-prompting)
4. [Examens & Certificaten](#4-examens--certificaten)
5. [Processen / SOPs](#5-processen--sops)
6. [Kennisbank](#6-kennisbank)

---

## 1. Instructievideo's

### Doel
Platform en modules leren kennen via video's, georganiseerd per categorie en rechtsgebied.

### AO-punten
Maximaal 12 AO-punten. Niet alle video's leveren punten op (bijv. DMS-integratie = 0 AO).
Per video staat in het databestand hoeveel AO-punten die oplevert.
Bij elke video toon je de AO-punten die je ermee verdient.

### Structuur — 3 tabs

**Tab 1: Platform Introductie**
Algemene introductievideo's over het platform als geheel. Geen rechtsgebied-selectie nodig.
Voorbeelden: "Welkom bij Legal Mind", "Navigatie en basisgebruik", "Je eerste dossier".

**Tab 2: Module Verdieping**
Video's per Legal Mind module (Assistent, Dossiermodule, Tabelmodule, Documentdrafter).
NIET te veel video's hier — houd het beperkt tot 2-3 per module. Te veel video's maakt het
overweldigend en onhaalbaar. Rechtsgebied-selectie is hier NIET relevant (modules werken
hetzelfde ongeacht rechtsgebied).

**Tab 3: Vaardigheden**
Verdiepende video's: DMS-integratie, effectieve prompts schrijven, dossierbeheer.
Praktische skills die niet module-specifiek zijn.

### Video content status
Alle video's zijn voorlopig PLACEHOLDERS — thumbnail-afbeeldingen met een play-icoon overlay.
De video-infrastructuur (hosting, player-integratie) komt later. Bouw de UI alsof de video's
er zijn (thumbnails, duur, play-knop), maar de player hoeft nog niet echt te werken.

### UI-elementen
- Donker hero-blok bovenaan met titel, beschrijving, AO-punten (X / 12 AO rechtsbovenin)
- Tabs als pills (oranje actieve indicator)
- Contextuele beschrijving onder elke tab (1-2 zinnen wat je hier leert)
- Video cards met thumbnail (h-40), play icon overlay, titel, duur
- Bij bekeken video's: groene check overlay
- AO-punt badge bij elke video die punten oplevert
- Card-stijl consistent met hoofdoverzicht (ring-1 ring-slate-200, progress bar onderaan)

### Belangrijke feedback
- "Bij module verdieping heb je teveel filmpjes. Echt heel veel weghalen."
- Rechtsgebied maakt bij instructievideo's niet echt uit — alleen bij praktijkcases
- Houd het overzichtelijk: minder is meer

---

## 2. Praktijkcases

### Doel
Echte juridische zaken doorlopen in Legal Mind, stap voor stap, in 3 moeilijkheidsniveaus.

### AO-punten
4 AO-punten per AFGERONDE praktijkcasus (niet per stap). Je krijgt pas punten als alle
stappen voltooid zijn.

### Structuur

**Rechtsgebied-selectie:**
- Elke gebruiker heeft "profielrechtsgebieden" (standaard 2, configureerbaar)
- Profielrechtsgebieden worden BOVEN getoond met alle 3 niveaus zichtbaar
- Andere rechtsgebieden staan ERONDER in een compacte dropdown/selector
- Meerdere rechtsgebieden kunnen tegelijk geselecteerd zijn
- Bij selectie zie je ze onder elkaar, elk met hun 3 niveaus

**Niveaus per rechtsgebied:**
- Niveau 1: Basis — altijd beschikbaar
- Niveau 2: Gevorderd — pas beschikbaar na voltooien van niveau 1
- Niveau 3: Expert — pas beschikbaar na voltooien van niveau 2
- Locked niveaus tonen een lock-icoon en zijn niet klikbaar

**Rechtsgebieden (voorbeelden):**
Verbintenissenrecht, Arbeidsrecht, Bestuursrecht, Ondernemingsrecht, Strafrecht,
Bedrijfsrecht, Familierecht, Intellectueel eigendom, etc.

### Case overzicht (na klikken op een case)
- Brede layout (meer width dan standaard)
- Titel + rechtsgebied + niveau
- Samenvatting van de casus (wat ga je doen, welke onderdelen)
- Kerngegevens (standaard ingeklapt)
- Stappen overzicht — verdeel in 2 kolommen als er veel stappen zijn (5 links, rest rechts)
- Module-badges per stap (welke Legal Mind module je gebruikt)
- Leerdoelen
- Grote "Start casus" knop (of "Verder met casus" als al begonnen)
- "Opnieuw starten" knop als er voortgang is

### Case flow (na "Start casus")

**DIT IS DE KERNERVARING VAN HET PORTAAL.**

Bij het starten verschijnt een glassmorphism popup:
"We hebben je dossier toegevoegd aan je Legal Mind-omgeving. Je kunt de stappen in dit
scherm volgen."

**Let op:** Dit is voorlopig een SIMULATIE — er wordt geen echt dossier aangemaakt in de
hoofdapp. De popup is informatief. Later wordt dit een echte koppeling waar daadwerkelijk
een demodossier wordt aangemaakt in de Legal Mind-omgeving van de gebruiker.

Dan: full-screen immersive flow:
- `fixed inset-0` — het hele viewport, geen sidebar
- Eén stap per scherm, grote weergave
- Slide-transities (350ms): vooruit = slide links, achteruit = slide rechts
- Vaste navigatiebalk onderaan: ← Vorige | Stap voltooid → | Volgende →
- Floating dot indicator boven de nav bar (oranje actieve dot)
- Elke stap toont: titel, beschrijving, welke module je gebruikt, concrete instructies
- Prompts in stappen zijn kopieerbaar (kopieer-knop) én vergroot-baar (fullscreen modal)
- Completion screen met felicitatie wanneer alle stappen klaar

### Case data (per bestand)
Elk case-bestand bevat: id, titel, rechtsgebied, niveau, beschrijving, kerngegevens,
leerdoelen, en een array van stappen. Elke stap heeft: titel, beschrijving, module,
instructies, en optioneel een prompt.

### Belangrijke feedback
- "Als je een praktijkcase start, moet het een full, full width en full height scherm worden"
- "Het moet echt een ervaring zijn, een fijne ervaring"
- "Meer als een flow waar je doorheen gaat, niet een scrollpagina"
- "De pop-up bij start moet glassmorphism zijn met uitleg dat dossier is toegevoegd"
- "Opnieuw starten moet mogelijk zijn"
- Cards consistent met alle andere modules (progress bar onderaan)

---

## 3. Prompting

### Doel
Effectieve prompts leren maken en een prompt library opbouwen.

### AO-punten
2 AO-punten per geïmplementeerde collectie (maximaal 2 collecties tellen mee = 4 AO max).

### Structuur — 2 tabs

**Tab 1: Collecties**
Vooraf gemaakte prompt-collecties per proces (bijv. "Letselschadeprocedure" = 5 prompts).
- Elke collectie toont de prompts als lijst met titels
- "Alles toevoegen aan Prompt Library" knop per collectie
- Bij de collecties-tab: referentie naar examens ("Wilt u uw prompt-vaardigheden testen?
  Bekijk Examens & Certificaten →") — ALLEEN zichtbaar bij collecties-tab, niet bij builder
- Deze tekst staat rechts van de zoekbalk

**Tab 2: Prompt Builder**
De grote interactieve prompt-generator. Dit is een GROOT, prominent scherm — niet weggestopt.

**Layout prompt builder:**
- Full-width, geen 2-koloms layout
- Video rechtsbovenin (lg:w-72, iets groter dan standaard) met play icon
- Genummerde stappen voor de basisvelden

**Basisvelden (in deze volgorde):**
1. **Selecteer dossier** — dropdown/popup met mappen (zoals in Legal Mind)
2. **Kies module** — grote klikbare blokken (Assistent, Dossiermodule, Tabelmodule, Documentdrafter)
3. **Rechtsgebied** — selecteerbare pills in de breedte
4. **Wat wilt u doen? (Doel)** — multiselect met opties: "Open laten" (eerste optie!),
   Samenvatten, Risico's signaleren, Tegenstrijdigheden vinden, Relevante clausules extraheren,
   Vragen beantwoorden, etc.
5. **Instructie** — open tekstveld
6. **Bronverwijzingen** — toggle (standaard veld, niet geavanceerd)
7. **Toepassing** — naast bronverwijzingen op dezelfde regel

**Geavanceerde opties:**
Duidelijk zichtbare toggle: "Maak hem nog specifieker" of vergelijkbaar — NIET "Geavanceerde
opties" (dat klinkt te technisch). Wanneer geopend, extra velden:
- Rol van de gebruiker (advocaat eiser, advocaat gedaagde, etc.)
- Gewenste output formaat (samenvatting, bullet points, tabel, actielijst)
- Detailniveau (hoog-over, praktisch, diepgaand)
- Schrijfstijl (formeel, to-the-point, klantvriendelijk)
- Voor wie is de output (partner, tegenpartij, cliënt, intern)
- Omgang met ontbrekende informatie

**GEEN dubbele velden** — als iets al in de basisvelden staat, niet herhalen in geavanceerd.

**Gegenereerde prompt:**
Na invullen → "Genereer" knop → prompt verschijnt full-width onderaan.
Met kopieer-knop en "Toevoegen aan Prompt Library" knop.

**Waar leeft de Prompt Library?**
De Prompt Library zelf leeft in de Legal Mind hoofdapplicatie (niet in het Learning Center).
"Toevoegen aan Prompt Library" stuurt de prompt naar de hoofdapp. De collecties (tab 1)
leven WEL in het onboarding portaal — die zijn onderdeel van het leertraject.

**Dossier-selectie popup:**
Wanneer je een dossier selecteert, GEEN "dossier toegevoegd" melding — je kiest een bestaand
dossier uit je Legal Mind-omgeving. De popup toont mappen onder elkaar, klikbaar.

### Belangrijke feedback
- "De promptbuilder moet gewoon groter worden, veel meer aanwezig"
- "Hij wordt een beetje weggestopt, dat moet je anders gaan indelen"
- "Er moet echt een easy mode zijn en dan een advanced optie"
- "Geavanceerde opties mag duidelijker zijn dat dat bestaat"
- "Veel dingen dubbel bij de geavanceerde instellingen — dat moet je beter indelen"
- "Video rechtsbovenin, die is precies zoals ik wil, maar net iets groter nog"

---

## 4. Examens & Certificaten

### Doel
Kennis toetsen over AI-regelgeving, richtlijnen en platformgebruik. Certificaten behalen.

### AO-punten
Per examenmodule: 4 AO voor het afronden van de leerfase + 4 AO voor het halen van het examen.

### Structuur

**Examen Hub:**
- Donker hero-blok (bg-slate-900) met titel, beschrijving, AO-punten
- 2 categorieën examens (logisch ingedeeld met een selectable balk, zoals bij instructievideo's)
- Examen-cards met: titel, beschrijving, voortgang, AO-punten badge

**5 (+3) Examenmodules:**

Standaard 5:
1. **AI Act** — Europese AI-verordening (15 examenvragen, 50 leervragen)
2. **OvA Richtlijnen** — Orde van Advocaten regels voor AI
3. **AI gebruik met Legal Mind** — Hallucinaties, kwaliteitscontrole
4. **Intern AI-beleid** — Kantoorspecifiek beleid volgen
5. **Effectieve Prompts** — Prompt engineering voor juridische context

Toegevoegd:
6. **AI & Beroepsaansprakelijkheid**
7. **AI & Vertrouwelijkheid (AVG)**
8. **AI Output & Kwaliteitscontrole**

**Per module — 2 fases:**

**Fase 1: Studeren (leerfase)**
- Vragen met multiple choice antwoorden
- Na beantwoording: altijd uitleg tonen (uitleg veld in data)
- Bij fout antwoord: extra tip tonen (tip veld in data)
- Voortgang bijhouden (X / 50 vragen)
- "Opnieuw" knop om leerfase te resetten

**Fase 2: Examen**
- Pas beschikbaar na afronden leerfase (of configureerbaar)
- 15 vragen, multiple choice (GEEN open vragen)
- Cesuur: configureerbaar in databestand (bijv. 70%)
- Resultaat met score
- "Examen herkansen" knop
- Bij halen: certificaat markering

**Examen scherm styling:**
Het examen moet er professioneel uitzien — "alsof je echt in een examen-omgeving zit".
Donkere hero, clean layout, duidelijke voortgangsindicator.

**Data:** Elk examenbestand bevat per module: leervragen en examenvragen. Elke vraag heeft
antwoorden met `correct: true` op het juiste antwoord (niet correctIndex), plus `uitleg`
en `tip` velden. Non-programmeurs moeten vragen kunnen toevoegen/wijzigen.

### Certificaten

Rechterkolom van het hoofdscherm toont behaalde certificaten. In het admin dashboard zijn
certificaten één van de belangrijkste metrics.

### Belangrijke feedback
- "Bij examens en certificaten moet je duidelijker zijn wat behaald moet worden"
- "Het doel enzo moet allemaal ook duidelijk zijn"
- "De blokken bij examens zijn erg druk geworden — alles zoals die tags mogen weg"
- "Het examen scherm is spuuglelijk — maak die veel mooier en professioneler"
- "Alle examenvragen moeten options zijn, niet open tekstvelden"
- Examens in 2 logische categorieën met selectable balk

---

## 5. Processen (SOPs)

### Doel
Standaard procedures in Legal Mind stapsgewijs doorlopen en begrijpen.

### AO-punten
5 AO-punten per afgeronde SOP (niet per stap).

### Structuur

**SOP Overzicht:**
- Donker hero-blok bovenaan
- Cards per SOP met: titel, beschrijving, aantal stappen, geschatte tijd, rechtsgebied
- Rechtsgebied-filter
- Zoekfunctie
- Card-stijl consistent (progress bar onderaan)

**SOP Detail (na klikken):**
- Intro sectie met: video placeholder bovenaan, beschrijving, stappen-overzicht
- "Start SOP" of "Verder met SOP" knop
- "Opnieuw starten" knop bij bestaande voortgang

**SOP Flow (na starten):**
DEZELFDE full-screen immersive flow als praktijkcases:
- `fixed inset-0` — het hele viewport, geen sidebar
- Eén stap per scherm, grote weergave
- Slide-transities (350ms): vooruit = slide links, achteruit = slide rechts
- Vaste navigatiebalk onderaan: ← Vorige | Stap voltooid → | Volgende →
- Floating dot indicator boven de nav bar (oranje actieve dot)
- Elke stap toont:
  - Titel en beschrijving
  - Concrete instructies (genummerde acties: "Open Legal Mind", "Upload bestanden", etc.)
  - Kopieerbaar prompt blok (als de stap een prompt bevat)
  - Prompt expand knop (fullscreen modal)
- Completion screen met felicitatie wanneer alle stappen klaar

**Prompts in SOPs:**
Onder het stappen-blok: apart blok "Alle prompts van dit proces" met titels.
"Voeg alles toe aan Prompt Library" knop.
Bij de LAATSTE stap (SOP afronden): prominentere prompt-library integratie.

**Na voltooien:**
Samenvatting dat je de SOP begrijpt en de stappen kunt integreren in je prompt library.

### SOP Data (per bestand)
Elk SOP-bestand bevat: id, titel, beschrijving, rechtsgebied, geschatteTijd, en stappen.
Elke stap heeft: titel, beschrijving, instructies (string[]), en optioneel prompt (string).

### Belangrijke feedback
- "Bij de SOP's mag de SOP nog iets meer zijn zoals de praktijkcases flow is"
- "Er moet een zoekfunctie of categorisering zijn"
- "Elke stap moet concrete instructies hebben — niet vaag"
- "Bij elke SOP eerst een video, daaronder de uitvoering"
- "Opnieuw starten moet mogelijk zijn"
- "Alle prompts van het proces in één blok met toevoegen-knop"

---

## 6. Kennisbank

### Doel
AI-gestuurde Q&A waar gebruikers vragen kunnen stellen en artikelen kunnen raadplegen.

### AO-punten
Geen AO-punten — dit is een naslagwerk.

### Structuur
- **AI-chat bovenaan**: een echte chat-interface waar gebruikers vragen stellen en AI
  antwoorden geeft die verwijzen naar relevante artikelen. Vergelijkbaar met hoe de
  Legal Mind assistent werkt, maar gericht op kennisbank-content.
- **Artikelen eronder**: browsbaar overzicht van alle artikelen, gefilterd/gesorteerd
  op basis van de chat-vraag of via een zoekbalk
- Breed scherm (meer width dan standaard)
- Donker hero-blok bovenaan
- Zoekfunctie voor artikelen (los van de chat)

### AI-chat gedrag
- Chat verwijst altijd naar specifieke artikelen in het antwoord
- Klikbare links naar de relevante artikelen
- Artikelen-sectie eronder past zich aan op basis van het chat-antwoord
- Zonder chat-vraag: alle artikelen browsbaar

### Belangrijke feedback
- "De kennisbank mag je iets meer breedte geven"
- "Het is allemaal heel smalletjes gemaakt"
- "AI chat die verwijst naar artikelen, en de artikelen die daaronder beschikbaar zijn"
- Scroll-to-top fix nodig (pagina begon middenin)

---

## Hoofdoverzicht (OnboardingHub)

Het startscherm dat alle 6 modules toont.

### Layout
- Donker hero-blok: "AI Learning Center", welkomstbericht met gebruikersnaam,
  AO-punten indicator (bijv. "10 / 20 AO-punten dit kwartaal")
- Voortgang: inklapbaar label dat details toont (video's bekeken, stappen voltooid,
  SOPs geïmplementeerd, etc.) — standaard INGEKLAPT
- Groeiplan: tweede inklapbaar label met voorgestelde stappen
- 6 module-cards in grid (2x3 of 3x2 afhankelijk van schermgrootte)
  - Elke card: icoon, titel, korte beschrijving (1 zin!), AO-punten indicator, progress bar
  - Oranje hover accent (left-border of subtle glow)
  - Card 6 (Kennisbank) mag visueel net iets anders zijn (subtle verschil, NIET drastisch)
- Rechterkant: inklapbare sidebar met voorgestelde stappen, certificaten, teamvoortgang
  - Standaard INGEKLAPT
  - Toggle-tabs aan de rechterkant van het scherm
  - Bij uitklappen: content schuift, sidebar duwt NIET over content heen
  - CSS transitions voor smooth open/close (niet Framer Motion)

### Navigatie bovenin
- Links: "AI Learning Center" titel
- Rechts: Beheerder knop (grijs, "coming soon" label) + UserSwitcher profiel
- Vraagteken-icoon dat een welkomst-popup opent met introductievideo

### Welkomst-popup (vraagteken)
- "Welkom bij het AI Learning Center"
- Introductievideo (placeholder)
- Korte uitleg wat het portaal is en hoe het werkt
- "Hoe werken AO-punten?" link
- Smooth open/close animatie

### AO-punten popup
Bij klikken op de AO-punten indicator → grote brede popup met:
- Huidige kwartaalvoortgang
- AO-punten per module (niet totaal, maar per stuk)
- 3 niveaus: Kantoorminimum, AI Gebruiker, AI Kartrekker
- "Hoe werken AO-punten?" uitleg
- Video rechtsbovenin of er ergens prominent

### Help & Feedback card (7e card)
Onder de 6 module-cards staat één extra card: "Help & Feedback". Dit is GEEN volwaardige
module — het is een servicepagina die 3 onderdelen combineert:

**1. Roadmap**
Legal Mind product roadmap: wat er aan nieuwe features komt. Gebruikers zien wat gepland
staat en wat er recent is uitgerold. Simpele timeline of lijst, geen complexe interactie.

**2. Support**
- Eerst verwijzing naar de Kennisbank ("Misschien vind je het antwoord hier")
- Link naar de Kennisbank module
- Als de Kennisbank niet helpt: ticketformulier om een supportvraag in te schieten
- Het doel is om gebruikers zoveel mogelijk naar de Kennisbank te leiden

**3. Feedback**
- Simpel feedbackformulier: onderwerp, bericht, eventueel categorie (bug/suggestie/vraag)
- Geen feature request board of stemfunctie — houd het simpel

**Styling:** De card op het hoofdscherm mag visueel net iets anders zijn dan de 6 module-cards
(kleinere card, ander icoon, subtiel verschil) zodat duidelijk is dat dit geen leermodule is.
Geen AO-punten, geen progress bar.

### Belangrijke feedback over het hoofdscherm
- "De beschrijvingen van de 6 blokken iets korter — één zin zou voldoende zijn"
- "De voortgang details standaard ingeklapt"
- "De rechterkant standaard ingeklapt, smooth uitklapbaar"
- "Sidebar mag NIET over content heen komen — content moet meeschuiven"
- "Meer oranje elementen, maar niet te veel — clean en minimalistisch"
- "Elke module een donker hero-blok bovenaan — dat is het professionele gevoel"
