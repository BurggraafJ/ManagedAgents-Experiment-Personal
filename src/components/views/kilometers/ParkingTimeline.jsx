import { useState } from 'react'
import { formatParkingDate, parkingOverall } from '../../../lib/kilometers'
import styles from './KilometersView.module.css'

const STEP_ICON = {
  success: '✓',
  warning: '⚠',
  error:   '✗',
  skipped: '–',
}

/**
 * ParkingTimeline — uitvouwbare timeline per kilometerregistratie-run die
 * EasyPark-stappen heeft (`stats.extra.parking_steps`). Geeft per run de
 * statussen weer met verbindingslijn ertussen, en op klik de losse stappen.
 */
export default function ParkingTimeline({ runs }) {
  const [expandedId, setExpandedId] = useState(null)

  // Filter op runs met parking-data; dedupe op id; max 6.
  const parkingRuns = []
  for (const r of runs) {
    if (!r?.stats?.extra?.parking_steps?.length) continue
    if (parkingRuns.find(x => x.id === r.id)) continue
    parkingRuns.push(r)
    if (parkingRuns.length >= 6) break
  }

  if (parkingRuns.length === 0) return null

  return (
    <section>
      <div className="section__head">
        <h2 className="section__title">Parkeerkosten check</h2>
        <span className="section__hint">EasyPark — stappen per run</span>
      </div>
      <div className="card" style={{ padding: 0 }}>
        {parkingRuns.map((run, runIdx) => (
          <ParkingRunBlock
            key={run.id}
            run={run}
            isLast={runIdx === parkingRuns.length - 1}
            isOpen={expandedId === run.id}
            onToggle={() => setExpandedId(prev => prev === run.id ? null : run.id)}
          />
        ))}
      </div>
    </section>
  )
}

function ParkingRunBlock({ run, isLast, isOpen, onToggle }) {
  const steps = run.stats.extra.parking_steps
  const totaal = run.stats?.extra?.parking_totaal
  const transacties = run.stats?.extra?.parking_transacties
  const overall = parkingOverall(steps)

  return (
    <div style={{ borderBottom: isLast ? 'none' : '1px solid var(--border)' }}>
      <button type="button" onClick={onToggle} className={styles.parkingHead}>
        <span className={styles.parkingDate}>{formatParkingDate(run.started_at)}</span>
        <span className={styles.parkingTitle}>
          {transacties != null && `${transacties} transacties`}
          {totaal != null && (
            <span className={styles.parkingTotal}>· EUR {Number(totaal).toFixed(2)}</span>
          )}
          {transacties == null && totaal == null && run.stats?.extra?.maand && (
            <span className="muted">{run.stats.extra.maand}</span>
          )}
        </span>
        <span className={`pill s-${overall} ${styles.parkingPill}`}>
          {overall === 'success' ? 'gelukt' : overall === 'warning' ? 'waarschuwing' : 'fout'}
        </span>
        <span className={styles.parkingCaret}>{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div className={styles.parkingBlock}>
          {steps.map((step, idx) => (
            <div key={idx} className={styles.stepRow}>
              {idx < steps.length - 1 && <div className={styles.stepConnector} />}
              <span className={styles.stepIcon} data-status={step.status}>
                {STEP_ICON[step.status] || '·'}
              </span>
              <div>
                <span className={styles.stepLabel}>{step.label || step.stap}</span>
                {step.bericht && <span className={styles.stepMessage}>{step.bericht}</span>}
              </div>
              {step.tijdstip && (
                <span className={styles.stepTime}>
                  {new Date(step.tijdstip).toLocaleTimeString('nl-NL', {
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                  })}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
