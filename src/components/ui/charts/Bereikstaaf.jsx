import './bereikstaaf.css'

/**
 * C5 · Bereikstaaf — `balk-bereik` (skill dashboarding v0.9.1, chart-catalogus §C5).
 *
 * Eén balk met twee gemeten grenzen: donker tot de bodem (minimumafname ×
 * prijs), licht tot het plafond (contractomvang × prijs). Nooit één
 * "pipeline-waarde", nooit een midden of gemiddelde — dat zou een verwachting
 * suggereren die niet bestaat (Methodiek 2).
 *
 * Wat de component níet doet (G5): hij telt en schaalt niets zelf. `max` is
 * het gedeelde maximum van het blok waarin hij staat (G2) en komt van de
 * aanroeper, die het over exact dezelfde rijen bepaalt die hij tekent — en die
 * het in de voetnoot van het blok noemt.
 *
 * Twee regels uit de oude `.d1-mbar` die blijven:
 *  • **Geen waarde → geen balk.** Een balk van nul is een verzonnen verwachting.
 *    De component rendert dan een leeg vak, zodat de kolom in de rij blijft.
 *  • **Minimaal 2 px vulling zodra een grens > 0 is**, anders is € 405 naast
 *    € 24.325 onzichtbaar.
 *
 * Props:
 *   bodem, plafond  getallen uit dezelfde view-rij als het bedrag ernaast
 *   max             gedeelde schaal van het blok (> 0)
 *   punt            optioneel derde gemeten punt ín het bereik (bijv.
 *                   gefactureerd, D4) — een streep van 2 px, geen derde vlak
 *   titel           tooltip met de exacte bedragen ("één afronding op het bord,
 *                   exact in de tooltip")
 *
 * Maat: 8 px hoog, radius 4 (maatcontract C4 · C5 · C6 · C7). Mobiel: de balk
 * blijft en komt onder de naam — dat regelt de rij-layout, niet de balk.
 * Chart-lokale control € ↔ licenties is toegestaan maar hoort bij de
 * aanroeper (hij wisselt de kolommen, de balk blijft dezelfde).
 */
export default function Bereikstaaf({ bodem, plafond, max, punt = null, titel = undefined }) {
  const b = Number(bodem) || 0
  const p = Number(plafond) || 0
  const m = Math.max(Number(max) || 0, p, 1)
  const heeftWaarde = p > 0 || b > 0

  if (!heeftWaarde) {
    return <span className="c5 c5--leeg" aria-hidden />
  }

  // Percentages van de gedeelde schaal; de minimale 2 px zit in de CSS
  // (`min-width`), zodat de verhouding op elke kolombreedte klopt.
  const pctBodem = Math.round((b / m) * 1000) / 10
  const pctRest = Math.round((Math.max(0, p - b) / m) * 1000) / 10
  const pctPunt = punt === null || punt === undefined ? null : Math.round((Number(punt) / m) * 1000) / 10

  return (
    <span className="c5" role="img" aria-label={titel} title={titel}>
      <span className="c5__baan">
        {b > 0 && <span className="c5__diep" style={{ width: `${pctBodem}%` }} />}
        {p > b && <span className="c5__licht" style={{ width: `${pctRest}%` }} />}
        {pctPunt !== null && <span className="c5__punt" style={{ left: `${pctPunt}%` }} />}
      </span>
    </span>
  )
}
