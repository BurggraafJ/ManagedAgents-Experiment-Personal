# Design System — AI Learning Center

Alle visuele richtlijnen voor het AI Learning Center portaal.

## Kleuren

| Kleur | Hex | Tailwind | Gebruik |
|-------|-----|----------|---------|
| Oranje accent | `#DC6F3F` | `bg-[#DC6F3F]` / `text-[#DC6F3F]` | Icons, progress dots, active states, hover, knoppen |
| Donker hero | slate-900 | `bg-slate-900` | Hero blokken bovenaan elke module |
| Donkere achtergrond | slate-800/900 | `bg-slate-800` | Full-screen case flow, examen omgeving |
| Card achtergrond | white | `bg-white` | Cards, content blokken |
| Pagina achtergrond | slate-50 | `bg-slate-50` | Hoofdachtergrond |
| Tekst primair | slate-900 | `text-slate-900` | Titels, koppen |
| Tekst secundair | slate-600 | `text-slate-600` | Beschrijvingen, labels |
| Tekst muted | slate-400 | `text-slate-400` | Timestamps, metadata |
| Border | slate-200 | `ring-1 ring-slate-200` | Card borders, scheidingslijnen |
| Success groen | emerald-500 | `text-emerald-500` | Voltooide stappen, checks |
| Locked grijs | slate-300 | `text-slate-300` | Niet-beschikbare items |

### Oranje accent regels
- Gebruik `#DC6F3F` — dit is de Legal Mind brand-oranje in het portaal
- Toepassing: icon achtergronden (`bg-[#DC6F3F]`), progress bar fills, active tab dots,
  hover left-borders, knoppen voor primaire acties
- NOOIT als achtergrondkleur voor grote vlakken
- Subtiel maar CONSISTENT op elke pagina — als een pagina geen oranje heeft, ontbreekt er iets

## Typografie

| Element | Tailwind classes | Gebruik |
|---------|-----------------|---------|
| Pagina titel (hero) | `text-3xl font-bold text-white` | In het donkere hero-blok |
| Sectie titel | `text-2xl font-bold text-slate-900` | Module koppen |
| Card titel | `text-xl font-semibold text-slate-900` | Kaart titels |
| Card subtitel | `text-base text-slate-600` | Beschrijvingen in cards |
| Body text | `text-sm text-slate-600` | Standaard tekst |
| Label | `text-xs font-medium text-slate-500 uppercase tracking-wider` | Categorie labels |
| AO-punt badge | `text-xs font-bold text-[#DC6F3F]` | Punten indicators |

## Componenten

### Module Card (hoofdoverzicht)

```
Structuur:
┌─────────────────────────┐
│ [Icoon]  Titel          │  ← icon in oranje cirkel
│ Korte beschrijving      │  ← max 1 zin
│                         │
│ 3 / 12 AO              │  ← AO-punten indicator
│ ███████░░░░░░░░░░░░░░░  │  ← oranje progress bar onderaan
└─────────────────────────┘

Tailwind: bg-white ring-1 ring-slate-200 rounded-xl p-6 hover:ring-[#DC6F3F]/30
          hover:shadow-lg transition-all duration-200
Oranje hover: border-l-4 border-[#DC6F3F] (of subtle ring kleurverandering)
Progress bar: h-1 bg-slate-100 rounded-full met bg-[#DC6F3F] fill
```

### Hero Blok (bovenaan elke module)

```
Tailwind: bg-slate-900 rounded-2xl p-8 text-white
Bevat: titel (text-3xl bold), beschrijving (text-slate-300),
       AO-punten rechtsbovenin (bg-white/10 rounded-full px-4 py-1)
```

### Examen Card

```
Structuur:
┌─────────────────────────┐
│ [Icoon]                 │
│ Titel                   │
│ Beschrijving            │
│                         │
│ Leerfase: 30/50         │
│ Examen: Niet gestart    │
│ 4 AO                   │
│ ███████░░░░░░░░░░░░░░░  │
└─────────────────────────┘

Cards moeten iets langwerpiger (hoger) zijn — geef ze meer body/hoogte.
Progress bar onderaan in oranje, consistent met alle andere cards.
```

### Praktijkcase Card

```
Structuur:
┌─────────────────────────┐
│ Titel                   │
│ Rechtsgebied · Niveau   │
│ 4 AO                   │
│ ███████░░░░░░░░░░░░░░░  │
└─────────────────────────┘

NIET alle modules benoemen in de card — dat maakt ze te vol.
Geef ze voldoende hoogte zodat ze niet te plat zijn.
```

### Tab Pills

```
Tailwind: flex gap-2
Actief: bg-slate-900 text-white px-5 py-2.5 rounded-full
Inactief: bg-white text-slate-600 ring-1 ring-slate-200 px-5 py-2.5 rounded-full
          hover:bg-slate-50
Oranje dot: kleine ronde dot (w-1.5 h-1.5 bg-[#DC6F3F] rounded-full) onder actieve tab
```

### Inklapbare Sidebar (hoofdoverzicht)

```
Altijd gerenderd (geen conditional rendering — CSS transitions):

Sidebar panel:
  hidden xl:block shrink-0 py-8 pr-6
  transition-all duration-300 ease-out overflow-hidden
  Open: w-80 opacity-100
  Dicht: w-0 opacity-0

Toggle tabs (rechts van scherm):
  hidden xl:flex fixed right-0 top-1/2 -translate-y-1/2 flex-col z-10
  transition-all duration-300
  Open: opacity-0 pointer-events-none translate-x-4
  Dicht: opacity-100 translate-x-0

Main content past mee:
  Open: xl:max-w-[calc(100%-20rem)] xl:mr-0
  Dicht: max-w-7xl (gecentreerd)
```

### Full-Screen Case Flow

```
Container: fixed inset-0 z-50 bg-slate-50 overflow-hidden
Header: sticky, donker, met case titel + progress percentage
Content: flex-1 overflow-y-auto, per stap een groot card (p-8 lg:p-10)
Footer: fixed bottom-0, navigatie met prev/next/voltooien knoppen
Dot indicator: flex gap-2, oranje dot = actief, groen = voltooid, grijs = nog niet

Slide transitie: transform translateX, transition 350ms ease
Vooruit: nieuwe stap schuift van rechts naar links
Achteruit: nieuwe stap schuift van links naar rechts
```

### Glassmorphism Popup

```
Overlay: fixed inset-0 z-50 bg-black/40 backdrop-blur-sm
Popup: bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl p-8 max-w-lg mx-auto
       border border-white/20
Animatie: scale-95 opacity-0 → scale-100 opacity-100 (150ms ease-out)
```

### Prompt Expand Modal

```
Overlay: fixed inset-0 z-50 bg-black/60 backdrop-blur-sm
Modal: bg-white rounded-2xl shadow-2xl max-w-4xl w-full mx-auto my-8
       max-h-[80vh] overflow-y-auto p-8
Header: flex justify-between, titel + X knop
Content: whitespace-pre-wrap text-base text-slate-700
Footer: kopieer-knop + toevoegen aan library knop
```

## Animaties

| Animatie | Tailwind | Gebruik |
|----------|----------|---------|
| Hover card | `transition-all duration-200` | Cards, knoppen |
| Sidebar open/close | `transition-all duration-300 ease-out` | Inklapbare sidebar |
| Page transition | Geen (React Router doet instant switch) | — |
| Slide (case flow) | Custom CSS transform + transition 350ms | Stap-wisseling |
| Popup open | `transition-all duration-150 ease-out` | Modals, popups |
| Progress fill | `transition-all duration-500 ease-out` | Progress bars |

## Responsive

| Breakpoint | Layout |
|------------|--------|
| < lg (mobile) | Sidebar verborgen, 1 kolom cards, geen toggle tabs |
| lg-xl | 2 kolom cards, sidebar toggle beschikbaar |
| > xl | 3 kolom cards, sidebar toggle tabs zichtbaar |

## Anti-patterns (NIET doen)

1. **Percentages als voortgang** — gebruik AO-punten ("3 / 12 AO", niet "25%")
2. **Te veel kleur** — het portaal is primair wit/grijs met oranje accenten, niet kleurrijk
3. **Kinderachtige elementen** — geen emoji's, geen confetti, geen "achievements"
4. **Statische scrollpagina's** — cases en SOPs zijn flows, niet lange pagina's
5. **localStorage/cookies** — alle opslag via API
6. **AnimatePresence voor exit-animaties** — gebruik CSS transitions
7. **Dubbele herhaling van data** — toon module-namen niet in elke card als het te druk wordt
8. **Te veel tekst in cards** — max 1 zin beschrijving op het hoofdoverzicht
9. **Puur witte achtergrond** — gebruik slate-50 of het off-white van de brand
