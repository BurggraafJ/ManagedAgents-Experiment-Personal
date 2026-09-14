# Diagnose — waarom de huidige C1/MetricCard-structuur de lelijke uitkomst dwingt

## Het probleem in één zin

De hero-kaart is een MetricCard die een Periodestrip als `tussen`-slot draagt, en dat is dezelfde component als een contextkaart met een ander hoogtegetal. Daardoor erft de hero alle beperkingen van een kaart (padding, gap-ritme, flex-column) en kan de strip nooit een grafiek worden — hij is een illustratie in een tekstvak.

## Drie structurele oorzaken

### 1. MetricCard is een verticale stapel, geen grid

MetricCard is `flex-direction: column; gap: 7px` met zes vaste lagen:

```
kop        (label + merk)
waarde     (het grote getal + suffix)
[waarde2]
[tussen]   ← hier wordt de hele C1-strip in geperst
context    (vergelijking + basis)
[children]
```

De `tussen`-slot is een tussengevoegd kind in een kolom. Het heeft geen eigen breedte-autoriteit — het deelt de kolom met het getal erboven en de tekst eronder, allemaal op dezelfde inline-start.

**Gevolg:** de strip wordt zo breed als de kaart min 2×18 px padding = ~420 px op een hero van ~460 px. Dat is genoeg voor de staven, maar de metric-pairs (gem. 4 wk, onder doel, netto) staan als een `inline-flex`-reeks in de `vergelijking`-slot — dezelfde regel als "Sales Pipeline, fase 1 t/m 3" op de kaart ernaast. Ze lezen als proza, niet als vakjes, want ze staan in een tekstregelslot.

### 2. De hero-breed CSS-grid zit op de verkeerde laag

v1.193 probeert de hero breed te maken met:

```css
.bs--d1 .bs__antwoord > .mc--hero {
  display: grid;
  grid-template-columns: auto minmax(280px, 1.2fr);
}
.bs--d1 .bs__antwoord > .mc--hero > .mc__tussen {
  grid-column: 2; grid-row: 1 / -1;
}
```

Dit overschrijft de `display: flex` van MetricCard en maakt van de kaart een 2-koloms grid: links getal+context, rechts de strip. Maar:

- De MetricCard kent zes kinderen (kop, waarde, waarde2, tussen, context, children). De grid-posities zijn hard-coded op `.mc__tussen` en de rest valt op `auto`, waardoor kop/waarde/context als losse rijen links onder elkaar komen — correct in theorie, maar de metric-pairs zitten **in** `.mc__context > .mc__vergelijking`, dus ze staan links onder het getal, niet bij de strip.
- De strip staat rechts maar is nog steeds 34/64 px plot hoog omgeven door de baan, waarderij, as en voetnoot. Die 94–125 px zijn een grafiek die eruitziet als een bijlage, niet als het primaire beeld.
- Er is geen visueel verband tussen de strip rechts en de metric-pairs links. Ze staan in twee verschillende grid-cellen met een 18 px gap ertussen.

### 3. Metric-pairs zijn vergelijkingstekst, geen vakjes

De metric-pairs zijn vandaag:

```html
<span class="d1-metrics">
  <span class="d1-metric"><span class="d1-metric__l">gem. 4 wk</span><span class="d1-metric__v">1,8</span></span>
  <span class="d1-metric"><span class="d1-metric__l">onder doel</span><span class="d1-metric__v">11 / 11 wk</span></span>
  <span class="d1-metric"><span class="d1-metric__l">netto</span><span class="d1-metric__v">-55</span></span>
</span>
```

Ze staan als `inline-flex` kinderen van `.mc__vergelijking` — een 12,5 px tekstslot. De `.d1-metric` elementen hebben geen border, geen padding, geen achtergrond. Ze zijn labels met waarden, maar ze **lezen als één doorlopende zin** omdat:

- `gap: 3px 12px` is te weinig scheiding om drie paren als drie eenheden te herkennen
- er geen visueel blok is (geen rand, geen achtergrondkleur, geen verhoogde witruimte)
- het label (10,5 px) en de waarde (12 px) te dicht bij elkaar staan in grootte
- ze in dezelfde kleur staan als de rest van de vergelijkingstekst

Het resultaat: `gem. 4 wk 1,8  onder doel 11/11 wk  netto -55` leest als telegram, precies wat de skill verbiedt (principes.md regel 21).

## Waarom patchen niet werkt

Het probleem is niet "verkeerde CSS-waarde" maar een architectuurkeuze: **de hero is een MetricCard-variant, en MetricCard is ontworpen voor een getal met context, niet voor een grafiek met cijfers**. Binnen die structuur kun je:

- de strip hoger maken (al gedaan: 64 px), maar hij blijft een tussengevoegd blok in een tekstkolom
- de metric-pairs stylen, maar ze blijven in `.mc__vergelijking` en erven het formaat van een beschrijvingsregel
- de kaart breed maken, maar de interne structuur (kop → getal → strip → context → children) was nooit ontworpen om in twee kolommen te werken

De incrementele patches v1.191 → v1.194 → v1.195 zijn allemaal varianten van "hetzelfde ding anders positioneren". Geen van hen verandert dat het ding zelf — een MetricCard — het verkeerde ding is voor een hero met een chart.

## De les

De MetricCard is een uitstekende contextkaart (kaart 2, 3, 4 op D1; alle kaarten op D9 en D10). Het getal is groot, de vergelijking staat eronder, de basis in klein grijs. Dat is precies wat een contextkaart doet.

Een hero die een grafiek draagt, is een ander ding. De grafiek is het primaire beeld, niet een illustratie bij het getal. De metric-pairs zijn secundair, naast of onder de grafiek, niet in een tekstslot van een kaartcomponent. En het getal staat niet boven de grafiek als kop van een kaart, maar naast de grafiek als deel van dezelfde leesregel.

Die scheiding — de hero als eigen component, MetricCard als contextkaart — is wat de drie opties hieronder elk op hun eigen manier voorstellen.
