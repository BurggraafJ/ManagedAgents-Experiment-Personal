import KaartKennismakingen from './KaartKennismakingen'
import KaartTijdInFase from './KaartTijdInFase'
import KaartLandtHet from './KaartLandtHet'
import KaartWaarde from './KaartWaarde'
import KaartBeweging from './KaartBeweging'
import KaartKanaal from './KaartKanaal'
import KaartKantoorgrootte from './KaartKantoorgrootte'
import { KaartFocus } from './Kaart'
import { eenheid as maakEenheid, snedeKort } from './labels'

/**
 * D1Live — het bord van Design ronde 5: twee rijen kaarten (Deals: 3 + 3,
 * Licenties: 4 + 3 met Waarde erbij) die samen de master vormen en in idle de
 * hele breedte krijgen (v1.212: geen lege sink meer); de sink (D1Detail) komt
 * er rechts bij zodra er een selectie is. Eén selectie-state voor het hele
 * bord, één toggle voor de eenheid — beide komen van D1View.
 *
 * **Focus-split (v1.210, Jelle 2026-09-15: "zoals jij het voorstelde").** Is er
 * een snede gekozen, dan laat het bord de grid los: alleen de kaart waar die
 * snede op staat blijft over en krijgt de hele master (≈ 52 % van het werk),
 * de sink ernaast wordt breed (≈ 48 %). Terug via `◂ Overzicht` in de witte
 * standaardbalk of Esc — beide in D1View. Een klik op een ándere snede van
 * dezelfde kaart wisselt alleen de sink; een tweede klik op dezélfde snede doet
 * niets meer (v1.211, Jelle 15-09-2026: "geen tweede klik om te wissen" — een
 * klik die soms selecteert en soms wist is een klik die je niet durft).
 * Geen modal, geen overlay: de zes andere kaarten zijn er gewoon even niet.
 *
 * De kaarten kiezen alleen; ze tellen niet. Elke som die je hier ziet komt uit
 * een `v_d1_*`-view, met drie benoemde uitzonderingen die exact over de
 * getoonde rijen lopen (kop Beweging, totaal Waarde, badge Kantoorgrootte).
 */
const KAART_VAN_SOORT = { week: 'kenn', fase: 'aging', maand: 'landt', waarde: 'waarde', beweging: 'beweging', kanaal: 'kanaal', band: 'grootte' }

export default function D1Live({ data, modus, periode, gekozen, onKies }) {
  const eenheid = maakEenheid(modus)
  const kies = onKies
  const p = { eenheid, gekozen, onKies: kies }

  const kaarten = {
    kenn: <KaartKennismakingen kop={data.aanvoerKop} aanvoer={data.aanvoer} gepland={data.gepland} meta={data.meta} {...p} />,
    aging: <KaartTijdInFase aging={data.aging} {...p} />,
    landt: <KaartLandtHet forecast={data.forecast} periode={periode} {...p} />,
    waarde: eenheid.lic ? <KaartWaarde perFase={data.perFase} gekozen={gekozen} onKies={kies} /> : null,
    beweging: <KaartBeweging beweging={data.beweging} {...p} />,
    kanaal: <KaartKanaal kanaal={data.kanaal} meta={data.meta} {...p} />,
    grootte: <KaartKantoorgrootte grootte={data.grootte} meta={data.meta} {...p} />,
  }

  const focusKaart = gekozen ? KAART_VAN_SOORT[gekozen.soort] : null
  if (focusKaart && kaarten[focusKaart]) {
    return (
      <KaartFocus.Provider value={{ snede: snedeKort(gekozen), units: eenheid.naam }}>
        <div className="dl-focus" data-zone="master">
          {kaarten[focusKaart]}
        </div>
      </KaartFocus.Provider>
    )
  }

  return (
    <div className={`dl-grid dl-grid--${modus}`} data-zone="master">
      <div className="dl-rij dl-rij--1">
        {kaarten.kenn}
        {kaarten.aging}
        {kaarten.landt}
        {kaarten.waarde}
      </div>
      <div className="dl-rij dl-rij--2">
        {kaarten.beweging}
        {kaarten.kanaal}
        {kaarten.grootte}
      </div>
    </div>
  )
}
