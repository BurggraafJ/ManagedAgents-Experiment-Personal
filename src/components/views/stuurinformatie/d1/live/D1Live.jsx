import KaartKennismakingen from './KaartKennismakingen'
import KaartTijdInFase from './KaartTijdInFase'
import KaartLandtHet from './KaartLandtHet'
import KaartWaarde from './KaartWaarde'
import KaartBeweging from './KaartBeweging'
import KaartKanaal from './KaartKanaal'
import KaartKantoorgrootte from './KaartKantoorgrootte'
import { eenheid as maakEenheid } from './labels'

/**
 * D1Live — het bord van Design ronde 5: twee rijen kaarten (Deals: 3 + 3,
 * Licenties: 4 + 3 met Waarde erbij) die samen de master vormen; de sink staat
 * rechts (D1Detail). Eén selectie-state voor het hele bord, één toggle voor de
 * eenheid — beide komen van D1View.
 *
 * De kaarten kiezen alleen; ze tellen niet. Elke som die je hier ziet komt uit
 * een `v_d1_*`-view, met drie benoemde uitzonderingen die exact over de
 * getoonde rijen lopen (kop Beweging, totaal Waarde, badge Kantoorgrootte).
 */
export default function D1Live({ data, modus, periode, gekozen, onKies }) {
  const eenheid = maakEenheid(modus)
  const kies = sel => onKies(gekozen && gekozen.soort === sel.soort && gekozen.sleutel === sel.sleutel ? null : sel)

  return (
    <div className={`dl-grid dl-grid--${modus}`} data-zone="master">
      <div className="dl-rij dl-rij--1">
        <KaartKennismakingen kop={data.aanvoerKop} aanvoer={data.aanvoer} gepland={data.gepland} meta={data.meta} eenheid={eenheid} gekozen={gekozen} onKies={kies} />
        <KaartTijdInFase aging={data.aging} eenheid={eenheid} gekozen={gekozen} onKies={kies} />
        <KaartLandtHet forecast={data.forecast} periode={periode} eenheid={eenheid} gekozen={gekozen} onKies={kies} />
        {eenheid.lic && <KaartWaarde perFase={data.perFase} gekozen={gekozen} onKies={kies} />}
      </div>
      <div className="dl-rij dl-rij--2">
        <KaartBeweging beweging={data.beweging} eenheid={eenheid} gekozen={gekozen} onKies={kies} />
        <KaartKanaal kanaal={data.kanaal} meta={data.meta} eenheid={eenheid} gekozen={gekozen} onKies={kies} />
        <KaartKantoorgrootte grootte={data.grootte} meta={data.meta} eenheid={eenheid} gekozen={gekozen} onKies={kies} />
      </div>
    </div>
  )
}
