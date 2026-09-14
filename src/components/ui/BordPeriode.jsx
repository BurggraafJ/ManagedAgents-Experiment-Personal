import { BordFilter } from './BordShell'

/**
 * BordPeriode — het paginafilter **periode**, één contract voor elk bord.
 *
 * D10 had het filter als eerste (v1.187); D1 en D9 kregen het in v1.191 níét,
 * en dat is de reden dat dit bestand bestaat: het contract staat hier zodat de
 * vraag "waarom heeft dit bord geen periode?" één antwoord heeft dat je kunt
 * nalopen, en zodat een bord dat er later wél een krijgt dezelfde knoppen,
 * dezelfde volgorde en dezelfde tooltipregel gebruikt als D10.
 *
 * **Het contract (Jelle, 14-09-2026: "periode als die technisch iets doet").**
 * Elke stand is een venster dat de view al kent — een kolom (`deze_maand`,
 * `laatste_13_maanden` in v_d10_kop) of een selectie op een datumkolom die de
 * records dragen (`verliesmaand`). De UI kiest tussen bestaande getallen; ze
 * telt niets zelf (G5). Een stand die de view niet kan leveren staat zichtbaar
 * uit met de reden in de tooltip (F7) — maar een hele as die het bord niet kan
 * waarmaken staat er niet. Een uitgeschakeld filter is geen filter maar
 * theater, en verbergt precies dát het bord er niet op kan snijden.
 *
 * Wat het filter doet, doet het voor het hele bord (F1): zone 2, de master en
 * het detail lezen dezelfde stand. Een lijst die "de stand van vandaag" is en
 * geen verliezen (de CS-lijsten op D10) valt er buiten, en dat zegt de scope-
 * tekst of de tooltip — niet een stille uitzondering.
 *
 * Waarom D1 en D9 er geen hebben (v1.191):
 *   D1  De aanvoerstrip is twaalf weken (v_d1_aanvoer, generate_series 0–11),
 *       de forecast vier maandbuckets (v_d1_forecast_per_maand), de trechter
 *       en de waarde zijn de open deals van nú. Elke kaart in zone 2 heeft zijn
 *       eigen vaste venster en géén tweede kolom om naar te wisselen. Een
 *       periodefilter zou dus alleen de maandregels in "Landt het?" kunnen
 *       snijden (op `binnen_kwartaal`), en zone 2 niet — dat faalt F1 en leest
 *       als een filter dat niets doet. De tijdas van D1 ís de strip en de
 *       maandregels; wie een ander venster wil, wil een andere view.
 *   D9  De checks zijn de stand van nu; de trendcel (v_d9_trend) is acht vaste
 *       weekstanden. Er is geen kolom per periode en geen record met een
 *       periodedatum. Niets om op te snijden.
 * Krijgt een van beide ooit een view met een periodekolom, dan komt het filter
 * hier binnen met dezelfde `opties`-vorm als D10 — en niet als eigen knopje.
 *
 * Props:
 *   opties   [{ id, label, kort?, kolom?, uit?, titel? }]
 *            id      de stand, ook de sleutel van de state op het bord
 *            label   de knoptekst ("13 maanden", "deze maand")
 *            kort    de telegramvorm voor kaarten en kernzin ("in 13 maanden")
 *            kolom   de kolom van de kopview die deze stand levert
 *            uit     true → zichtbaar uitgeschakeld (F7), met `titel` als reden
 *   actief   id van de gekozen stand
 *   onKies   (id) => void — het bord zet de state én ruimt een snede op die
 *            de nieuwe stand niet kan waarmaken
 *   scope    korte tekst achter de knoppen: waarop de stand wél en niet werkt
 */
export default function BordPeriode({ opties, actief, onKies, scope = null }) {
  return (
    <BordFilter
      label="periode"
      opties={opties}
      actief={actief}
      onKies={onKies}
      scope={scope}
    />
  )
}

/** De gekozen stand, of de eerste als de state iets onbekends draagt. */
export function periodeOptie(opties, actief) {
  return opties.find(o => o.id === actief) || opties[0]
}
