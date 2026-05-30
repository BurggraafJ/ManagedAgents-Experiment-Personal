import { useState } from 'react'
import { SettingsPage } from '../../SettingsLayout'
import Overview from './autodraft/Overview'
import PillarUnderstand from './autodraft/PillarUnderstand'
import PillarContext from './autodraft/PillarContext'
import PillarAct from './autodraft/PillarAct'
import Coherence from './autodraft/Coherence'

/**
 * AutoDraftPage — uitleg-pagina onder Instellingen → Uitleg.
 *
 * Herschreven 2026-05-30: van één lange scroll naar een navigeerbaar geheel.
 * De AutoDraft-keten is opgedeeld in drie fundamenten (begrijpen / context /
 * handelen) plus een samenhang-sectie. UX: segmented-nav bovenaan; het
 * Overzicht toont de drie fundamenten als klikbare kaarten (inzoomen), en
 * "Samenhang" vertelt het geheel. Inhoud gevoed door de twee koffie-pagina's.
 *
 * Secties leven in ./autodraft/* (400-LOC-cap per file). Hergebruikt de
 * bestaande set-ex-* styling + de set-ex-tabs/-pillar classes uit settings.css.
 */

const TABS = [
  { id: 'overzicht', label: 'Overzicht' },
  { id: 'begrijpen', label: '1 · Begrijpen' },
  { id: 'context',   label: '2 · Context' },
  { id: 'handelen',  label: '3 · Handelen' },
  { id: 'samenhang', label: 'Samenhang' },
]

export default function AutoDraftPage() {
  const [tab, setTab] = useState('overzicht')

  return (
    <SettingsPage
      title="AutoDraft"
      intro="Hoe je postvak elke mail begrijpt, afweegt en er een actie bij klaarzet — in drie fundamenten."
    >
      <div className="set-ex">
        <nav className="set-ex-tabs" role="tablist" aria-label="AutoDraft-uitleg">
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`set-ex-tab ${tab === t.id ? 'is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {tab === 'overzicht' && <Overview onOpen={setTab} />}
        {tab === 'begrijpen' && <PillarUnderstand />}
        {tab === 'context'   && <PillarContext />}
        {tab === 'handelen'  && <PillarAct />}
        {tab === 'samenhang' && <Coherence />}
      </div>
    </SettingsPage>
  )
}
