# Feedback Geschiedenis — AI Learning Center

Alle iteratie-feedback en ontwerpbeslissingen die zijn gemaakt tijdens het bouwen.
Lees dit om dezelfde fouten te voorkomen.

## Iteratie-overzicht

Het portaal is gebouwd in ~15 iteraties. Hieronder de belangrijkste lessen per thema.

---

## Thema: "Te druk"

Dit was de meest terugkerende feedback. Na bijna ELKE iteratie: "het is te druk".

**Wat "te druk" betekent:**
- Te veel elementen zichtbaar tegelijk
- Te veel kleur (vooral kleurtjes bij module-badges)
- Te veel tekst in cards
- Te veel statistieken zichtbaar
- Te veel blokken naast/onder elkaar

**De oplossing die werkte:**
- Inklapbare secties (voortgang, sidebar, geavanceerde opties)
- Standaard ingeklapt, uitklapbaar wanneer nodig
- Korte beschrijvingen (max 1 zin per card)
- Consistente card-stijl (niet elke card anders)
- Subtiele kleuren (geen felgekleurde badges, wel oranje accenten)

**Regel:** Als je twijfelt of iets te veel is → het is te veel. Haal het weg of klap het in.

---

## Thema: Flow vs. Scroll

**Probleem:** Praktijkcases en SOPs waren lange scrollpagina's — niet uitnodigend.

**Iteraties:**
1. Eerste versie: lange scrollpagina met alle stappen → "heel statisch"
2. Tweede versie: vorige/volgende knoppen toegevoegd → "beter, maar niet immersive"
3. Derde versie: full-screen flow (fixed inset-0) → "ja! dit is het"

**Les:** Voor alles waar je "doorheen loopt" (cases, SOPs), gebruik een full-screen flow
met één stap per scherm en slide-transities. NIET een scrollpagina met knoppen.

**De kernervaring:** Na "Start casus" → popup "dossier toegevoegd" → full-viewport met
alleen de actieve stap → navigatie onderaan → auto-scroll → completion screen.

---

## Thema: Oranje accenten

**Probleem:** Eerste versies hadden geen oranje, zagen er saai uit.

**Iteratie:**
1. Geen oranje → "iets te saai"
2. Te veel oranje → "wordt lelijk"
3. Subtiel maar consistent (#DC6F3F op icon containers, progress dots, hover states) → "perfect"

**Regel:** Oranje moet op ELKE pagina aanwezig zijn, maar altijd subtiel:
- Icon achtergronden (kleine cirkel)
- Progress bar fills
- Active tab dots
- Hover left-borders op cards
- Niet als grote vlakken of achtergronden

---

## Thema: AO-punten vs. Percentages

**Probleem:** Eerste versies gebruikten percentages (25% voltooid).

**Beslissing:** Alles omzetten naar AO-punten. Overal "3 / 12 AO" in plaats van "25%".
Dit maakt het meetbaar, vergelijkbaar, en voelt professioneel (zoals studiepunten).

**Implementatie:** AO-punten worden berekend uit voortgangsdata, niet apart opgeslagen.

---

## Thema: Sidebar overlap

**Probleem:** De rechterkant sidebar (voorgestelde stappen, certificaten) overlapte de content.

**Oplossingen die NIET werkten:**
- Fixed positioning → overlapt content
- Framer Motion AnimatePresence → exit animaties werken niet (wrapper is no-op)
- Conditional rendering → geen smooth animatie

**Oplossing die WEL werkte:**
- Altijd gerenderd (geen conditional rendering)
- CSS transitions: `transition-all duration-300 ease-out`
- Open: `w-80 opacity-100`, Dicht: `w-0 opacity-0 overflow-hidden`
- Main content: `max-w-[calc(100%-20rem)]` bij open, `max-w-7xl` bij dicht
- Toggle tabs: opacity + pointer-events voor smooth verschijnen/verdwijnen

---

## Thema: Examen cards

**Probleem:** Examen cards werden na elke iteratie drukker (tags, badges, percentages).

**Les:** Cards moeten simpel blijven:
- Titel
- Korte beschrijving
- Leerfase / examen voortgang (simpel)
- AO-punten
- Progress bar onderaan

Geen tags, geen gekleurde badges, geen extra metadata.
Cards iets langwerpiger (meer hoogte) zodat ze "body" hebben.

---

## Thema: Profiel en beheerder knoppen

**Iteraties:**
1. Beheerder als aparte knop + profiel → "draai om"
2. Profiel links, beheerder rechts → "nee, beheerder bij het profiel"
3. Profiel dropdown met "Beheerder" optie erin → "ja, cleaner"

**Uitkomst:** UserSwitcher (profiel) rechts in de navigatie, "Beheerder" als optie in
het profiel-menu of als kleine knop ernaast. Iconen even groot.

---

## Thema: Popups en modals

**Probleem:** Popups openden en sloten niet smooth.

**Les:**
- Gebruik glassmorphism voor belangrijke meldingen (bg-white/95 backdrop-blur-xl)
- Altijd smooth open/close (scale-95 → scale-100, 150ms)
- Overlay: bg-black/40 backdrop-blur-sm
- Altijd een duidelijke sluit-knop

---

## Thema: Prompt Builder te complex

**Probleem:** De prompt builder had te veel velden, dubbele opties, was te klein.

**Iteraties:**
1. Alles op één scherm → "te ingewikkeld"
2. Easy mode + advanced toggle → "goed idee"
3. Basisvelden genummerd (5 stappen) + "Maak hem nog specifieker" → "dit werkt"

**Les:** 
- Basisvelden: dossier → module → rechtsgebied → doel → instructie → bronverwijzing + toepassing
- Geavanceerd: rol, output format, detailniveau, schrijfstijl, doelgroep, ontbrekende info
- GEEN dubbele velden (als het al in basis staat, niet herhalen in geavanceerd)
- Video rechtsbovenin (lg:w-72)
- Full-width layout, niet 2-koloms

---

## Thema: Praktijkcases rechtsgebied-selectie

**Iteraties:**
1. Alle rechtsgebieden als pills → "niet handig als er veel zijn"
2. Dropdown → "te verstopt"
3. Profielrechtsgebieden (2) prominent bovenaan + dropdown voor de rest → "ja, dit is het"

**Uitkomst:** Gebruiker heeft profielrechtsgebieden (standaard 2). Die staan boven,
met alle 3 niveaus zichtbaar. Andere rechtsgebieden in een compacte dropdown eronder.
Meerdere tegelijk selecteerbaar, staan dan onder elkaar.

---

## Thema: Module beschrijvingen

**Feedback:** "De beschrijvingen van de 6 blokken iets korter — één zin zou voldoende zijn."

**Voor:** 3-4 regels tekst per card → te veel, te druk
**Na:** Eén zin per card → clean, scanbaar

---

## Thema: Kennisbank als 6e module

**Feedback:** "De 6e blok kennisbank net iets anders maken, maar heel iets hoor."

Het verschil moet MINIMAAL zijn — bijv. de hover-kleur iets anders, of een subtiel
icoontje. NIET een compleet ander design. De eerste poging was een zwart blok — veel
te drastisch.

---

## Thema: Scroll-to-top bug

Kennisbank en Examens scrollden automatisch naar beneden bij navigatie.
Fix: `useEffect(() => { window.scrollTo(0, 0); }, [])` op elke pagina,
of een ScrollToTop component in de layout.

---

## Samenvatting: Top 5 regels

1. **Minder is meer** — als het er druk uitziet, haal dingen weg of klap ze in
2. **AO-punten, geen percentages** — overal consistent
3. **Full-screen flows** — cases en SOPs, niet scrollen maar navigeren
4. **CSS transitions, niet Framer Motion** — voor in/uit animaties
5. **Oranje subtiel maar overal** — #DC6F3F op elke pagina, nooit te veel
