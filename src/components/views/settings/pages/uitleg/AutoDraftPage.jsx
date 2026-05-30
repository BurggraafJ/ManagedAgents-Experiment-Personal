import { SettingsPage } from '../../SettingsLayout'
import Overview from './autodraft/Overview'
import PillarUnderstand from './autodraft/PillarUnderstand'
import PillarContext from './autodraft/PillarContext'
import PillarAct from './autodraft/PillarAct'
import Coherence from './autodraft/Coherence'

/**
 * AutoDraftPage — uitleg-pagina onder Instellingen → Uitleg.
 *
 * Herzien 2026-05-30: warme intro (je weet nog niks → eerst het hele plaatje
 * + de samenhang), daarna de drie fundamenten als UITKLAPBARE blokken
 * (<details>: "Lees meer" voor de diepte), en onderaan het samenhang-verhaal.
 * Koffie-toon, inhoud boven styling. Secties in ./autodraft/* (400-LOC-cap).
 */

const FUNDAMENTEN = [
  {
    num: '1',
    title: 'Begrijpen & indexeren',
    teaser: 'Wat ís deze mail — en wat weten we al? Elke mail langs vijf brillen, plus een doorzoekbaar geheugen.',
    Body: PillarUnderstand,
  },
  {
    num: '2',
    title: 'Context & afwegen',
    teaser: 'Wat is hier eerder gebeurd, en wat moet er gebeuren? Eerst de geschiedenis erbij, dan pas een keuze.',
    Body: PillarContext,
  },
  {
    num: '3',
    title: 'Handelen & klaarzetten',
    teaser: 'De juiste handeling klaarzetten of (deels) uitvoeren — in drie snelheden, met de hand aan de rem.',
    Body: PillarAct,
  },
]

export default function AutoDraftPage() {
  return (
    <SettingsPage
      title="AutoDraft"
      intro="Hoe je postvak elke mail begrijpt, afweegt en er een actie bij klaarzet — in drie fundamenten."
    >
      <div className="set-ex">
        <Overview />

        {FUNDAMENTEN.map(({ num, title, teaser, Body }) => (
          <details key={num} className="set-ex-fold">
            <summary>
              <span className="set-ex-fold__num">{num}</span>
              <span className="set-ex-fold__main">
                <span className="set-ex-fold__h">{title}</span>
                <span className="set-ex-fold__teaser">{teaser}</span>
              </span>
              <span className="set-ex-fold__cue">Lees meer <span className="set-ex-fold__chev" aria-hidden>⌄</span></span>
            </summary>
            <div className="set-ex-fold__body">
              <Body />
            </div>
          </details>
        ))}

        <Coherence />
      </div>
    </SettingsPage>
  )
}
