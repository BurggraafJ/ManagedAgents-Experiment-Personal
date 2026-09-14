import { useState } from 'react'
import { SettingsPage } from '../settings/SettingsLayout'
import { usePijplijn } from '../../../hooks/usePijplijn'
import { STAGES, stageCounts } from '../../../lib/pijplijn'
import PijplijnStepDetail from './PijplijnStepDetail'
import './pijplijn.css'

/**
 * PijplijnPage — Organisatie › Leren › Pijplijn (v1.183).
 *
 * Eén pagina met de zeven stappen van de RAG-keten:
 *   Sync → Chunk → Embed → Index → Retrieve → Consume → Quality
 *
 * Vervangt de Intelligence-hub (Pijplijn · Kwaliteit · Kosten) die Jelle op
 * 2026-09-14 uit Organisatie heeft gehaald: geen drie blikken meer, maar één
 * uitleg. Klik op een stap → wat hij doet, welke tabellen erbij horen, de
 * live cijfers van die stap en de recente runs (PijplijnStepDetail).
 *
 * De cijfers op de kaarten komen live uit v_intelligence_hub_summary,
 * sync_health_all() en context_bundles (usePijplijn); wat niet gemeten wordt
 * staat als streep, met de peildatum eronder. Tekent met .set-* (zoals
 * Platform), dus geen eigen kleuren.
 */
export default function PijplijnPage() {
  const { data, error, loading, refresh } = usePijplijn()
  const [selected, setSelected] = useState(null)
  const counts = stageCounts(data)

  return (
    <SettingsPage
      title="Pijplijn"
      intro="Hoe een mail, deal of meeting doorzoekbare context wordt — en hoe de keten zichzelf meet. Klik op een stap voor uitleg, tabellen en recente runs."
      right={
        <button type="button" className="set-btn set-btn--ghost set-btn--sm" onClick={refresh} disabled={loading}>
          {loading ? 'Laden…' : 'Vernieuwen'}
        </button>
      }
    >
      <div className="pl-app">
        {error && <div className="pl-err">⚠ Cijfers niet geladen: {error}</div>}

        <ol className="pl-flow" aria-label="Pijplijn in zeven stappen">
          {STAGES.map((stage, i) => {
            const active = selected === stage.id
            const count = counts[stage.id]
            return (
              <li key={stage.id} className="pl-flow__item">
                <button
                  type="button"
                  className={`pl-step ${active ? 'is-active' : ''}`}
                  aria-pressed={active}
                  onClick={() => setSelected(active ? null : stage.id)}
                >
                  <span className="pl-step__nr">{stage.nr}</span>
                  <span className="pl-step__label">{stage.label}</span>
                  <span className="pl-step__desc">{stage.desc}</span>
                  <span className={`pl-step__count ${count == null ? 'is-empty' : ''}`}>
                    {count == null ? (loading ? '…' : '—') : count}
                  </span>
                </button>
                {i < STAGES.length - 1 && <span className="pl-flow__arrow" aria-hidden>→</span>}
              </li>
            )
          })}
        </ol>

        <div className="pl-meta">
          {data
            ? <>Live cijfers · peildatum {data.checkedAt.toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                {data.healthError && <> · versheid per bron niet geladen ({data.healthError})</>}
              </>
            : loading ? 'Cijfers laden…' : 'Geen live cijfers — de kaarten tonen alleen de uitleg.'}
        </div>

        {selected
          ? <PijplijnStepDetail stageId={selected} data={data} onClose={() => setSelected(null)} />
          : <p className="pl-hint">Klik op een stap voor uitleg, tabellen en recente runs.</p>}
      </div>
    </SettingsPage>
  )
}
