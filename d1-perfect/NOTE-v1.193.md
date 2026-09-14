## v1.193 — D1 chrome-pijn (Pass A)

Vier pijnpunten op het Pipeline-bord, Jelle 14-09-2026.

### Pain 1 — Dubbele navigatie in de witte balk
- Datakwaliteit-links verwijderd uit D1View en D1Kwartaal.
- BordZuster vervangen door **BordTabs** ("Live overzicht" / "Kwartaal"):
  echte page-tabs met accentlijn, in het `filters`-slot van BordKop.
- Nieuwe component `BordTabs` in BordShell.jsx, stijl `.bs-tabs` in bord-kop.css.

### Pain 2 — D1 kan op periode filteren
- BordPeriode toegevoegd aan D1View: "6 maanden" (default) / "Dit kwartaal".
- Eerlijk over scope: het filter werkt op de forecast in "Landt het?" (zone 3).
  Zone 2 toont altijd "nu" en verandert niet.
- D1LandtHet accepteert `periode` prop, filtert forecast op `binnen_kwartaal`.

### Pain 3 — Eerste blik te hoog
- Hero-breed layout: de hero-kaart spant de volle breedte, getal links,
  aanvoerstrip (C1) rechts ernaast via CSS grid.
- MetricCard: `tussen`-prop gewrapped in `.mc__tussen` div (al eerder gedaan).
- Drie contextkaarten op de tweede rij (was: vier kolommen met hero ertussen).
- Verwachte reductie: ~321 px naar ~273 px eerste blik.

### Pain 4 — Geen terug op smalle schermen
- `.dsk-narrow-back` bar in AppShell.jsx: verborgen op desktop, zichtbaar <900 px.
- Gebruikt dezelfde `topBack` prop als TopBar (label + onClick uit parentFor).
- Werkt voor alle nested pagina's, niet alleen borden.

### Bestanden geraakt
- src/version.js (1.191 -> 1.193)
- src/components/ui/BordShell.jsx (BordTabs component)
- src/components/ui/bord-kop.css (.bs-tabs stijlen)
- src/components/ui/MetricCard.jsx (.mc__tussen wrapper)
- src/components/views/stuurinformatie/d1/D1View.jsx (tabs, periode, import)
- src/components/views/stuurinformatie/d1/D1Kwartaal.jsx (tabs, Datakwaliteit weg)
- src/components/views/stuurinformatie/d1/D1LandtHet.jsx (periode filter)
- src/components/views/stuurinformatie/d1/d1.css (hero-breed layout)
- src/components/shell/AppShell.jsx (narrow-back bar)
- src/components/shell/desktop-shell.css (narrow-back stijlen)
