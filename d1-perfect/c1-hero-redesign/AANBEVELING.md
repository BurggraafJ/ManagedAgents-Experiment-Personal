# Aanbeveling — Optie A: getal links, strip rechts, metric-pairs als vakjes

## Waarom A

De hero is een ander ding dan een MetricCard. Een MetricCard is een getal met context eronder — dat is precies goed voor kaart 2, 3 en 4. Maar kaart 1 draagt een grafiek als primair beeld, en een grafiek past niet in een flex-column tekstkaart. Optie A erkent dat verschil: de hero wordt een eigen component, MetricCard blijft wat het is.

Optie B (getal boven, metrics rechts) concurreert op de bovenrand: het grote getal en de drie metric-vakjes staan op dezelfde hoogte en trekken allebei de aandacht. Je leest geen van beide eerst. Optie C (strip als het hele bord, overlay links) is visueel het sterkst als chart-first, maar de overlay bedekt de eerste 3–4 staven en maakt die niet klikbaar — dat breekt G7 (drill-target).

Optie A geeft de strip de volle breedte rechts van een vaste kolom. De metric-vakjes staan onder de strip, in hetzelfde grid-cel, dus ze horen visueel bij de grafiek. Het getal staat links als een leesregel: label → getal → suffix, met een verticale border die de scheiding markeert. De three vakjes hebben elk een achtergrond, een rand, eigen padding — het zijn blokken, geen telegramtekst.

## Wat wordt gebouwd (nieuw of herschreven)

| Bestand | Actie | Reden |
|---|---|---|
| `src/components/ui/HeroStrip.jsx` | **nieuw** | Eigen component: 2-koloms grid (getal-kolom + strip-kolom), metric-pairs als flex-rij onder de strip. Gebruikt `<Periodestrip variant="hero">` als kind. |
| `src/components/ui/hero-strip.css` | **nieuw** | Eigen `--hs-*` tokenblok, scoped onder `.theme-maestro`. Grid, metric-pair vakjes, responsief. |
| `src/components/views/stuurinformatie/d1/D1Antwoord.jsx` | **herschrijven zone 2** | Hero-kaart wordt `<HeroStrip>` in plaats van `<MetricCard variant="hero" tussen={...}>`. De metric-pairs verhuizen van `vergelijking`-prop naar `HeroStrip`-props. De drie contextkaarten blijven `<MetricCard>`. |
| `src/components/views/stuurinformatie/d1/d1.css` | **opruimen** | De hero-breed grid-override (`.bs--d1 .bs__antwoord > .mc--hero`) en `.d1-metrics`/`.d1-metric` worden verwijderd. De contextkaart-styling blijft. |
| `src/components/ui/MetricCard.jsx` | **ongewijzigd** | Geen patch, geen variant erbij. De contextkaarten gebruiken hem gewoon. |
| `src/components/ui/metric-card.css` | **ongewijzigd** | Idem. |
| `src/components/ui/charts/Periodestrip.jsx` | **ongewijzigd** | De strip zelf is goed gebouwd. HeroStrip importeert hem. |
| `src/components/ui/charts/periodestrip.css` | **ongewijzigd** | Idem. |

## Wat niet verandert

- De drie contextkaarten (Actieve pipeline, Waarde fase 3, Blokkers) blijven MetricCard.
- De Periodestrip-component zelf (maten, staven, tooltip, drill) verandert niet.
- AanvoerStrip.jsx (datawiring, wekenOnderDoel, nettoStand) verandert niet — HeroStrip neemt die data als props.
- De vijf-zone-grammatica, de kopbalk, zone 3/4/5 veranderen niet.
- Mobiel: HeroStrip stackt de kolommen verticaal (getal boven, strip onder, vakjes onder de strip) — dezelfde volgorde als nu, maar met vakjes in plaats van telegram.

## Meting na bouw

```
npm run meet   # verwacht: hero-breed ≤ 175 px, zone 2 ≤ 280 px
```

De huidige meting is 321 px (hero + context). Doel: ≤ 280 px, onder de 273 px van het hero-breed voorstel.
