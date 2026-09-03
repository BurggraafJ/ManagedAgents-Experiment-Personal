import { useEffect, useState, useMemo } from 'react'
import { useSupabaseQuery } from '../../../hooks/useSupabaseQuery'
import { useModal } from '../../../hooks/useModal'
import Modal from '../../ui/Modal'
import { summarize, sortBySeverity } from '../../../lib/agentHealth'
import HealthSummary from './HealthSummary'
import HealthFilterBar from './HealthFilterBar'
import HealthTable from './HealthTable'
import SecurityEventsSection from './SecurityEventsSection'
import styles from './HealthView.module.css'

/**
 * HealthView — fundament-pagina voor agent-observability.
 * Leest agent_runs_health_7d (view live sinds Project — Agent Logging & Observability F.2).
 *
 * Kleur-drempels op success_pct (zie lib/agentHealth.js → tone()):
 *   ≥95% groen / 80–95% geel / <80% rood / geen runs grijs
 *
 * Refactor 19 (Golf D): hoofd-container, < 200 LOC. Sub-views in deze folder.
 */
export default function HealthView() {
  const [tierFilter, setTierFilter] = useState('all')
  const modal = useModal()

  // initialData: null → !rows-checks blijven werken voor "nog niet geladen".
  const { data: rows, loading: refreshing, error, refresh } = useSupabaseQuery(
    'agent_runs_health_7d',
    { initialData: null }
  )

  // Auto-refresh elke 60s — lichte view.
  useEffect(() => {
    const id = setInterval(refresh, 60_000)
    return () => clearInterval(id)
  }, [refresh])

  const summary = useMemo(() => rows ? summarize(rows) : null, [rows])

  const filtered = useMemo(() => {
    if (!rows) return []
    const list = tierFilter === 'all' ? rows : rows.filter(r => r.tier === tierFilter)
    return sortBySeverity(list)
  }, [rows, tierFilter])

  const showThresholdHelp = () => {
    const id = modal.open(
      <Modal open onClose={() => modal.close(id)} title="Drempels uitgelegd" size="sm">
        <div className="stack text-md">
          <p>De agent-status komt rechtstreeks uit <code>agent_runs_health_7d</code> over de afgelopen 7 dagen:</p>
          <ul className="stack stack--sm">
            <li><strong className="text-success">≥ 95% gezond</strong> — agent gezond</li>
            <li><strong className="text-warning">80–95%</strong> — let op, terugkerende fouten</li>
            <li><strong className="text-error">&lt; 80%</strong> — echte issue, kijken</li>
            <li><strong className="text-muted">geen runs</strong> — idle of disabled</li>
          </ul>
          <p className="text-muted">
            Het percentage is <code>health_pct</code> = <strong>voltooide</strong> runs
            (<code>success</code> + <code>warning</code>) gedeeld door het totaal. Een run met
            status <code>warning</code> is afgerond werk met een aantekening, geen mislukking —
            die aantekeningen staan in de ⚠-kolom. Alleen <code>error</code> drukt het
            percentage. De strikte success-ratio blijft als <code>success_pct</code> in de view.
          </p>
          <p className="text-muted">View ververst automatisch elke 60 seconden; klik <em>Ververs</em> om nu te triggeren.</p>
        </div>
      </Modal>
    )
  }

  if (error) {
    return (
      <div className={`card ${styles.errorBanner}`}>
        Kon agent_runs_health_7d niet laden: {error}
      </div>
    )
  }

  if (!rows) {
    return (
      <div className="stack stack--gap-5">
        <div className="skeleton" style={{ height: 80 }} />
        <div className="skeleton" style={{ height: 320 }} />
      </div>
    )
  }

  return (
    <div className="stack stack--gap-7">
      <HealthSummary
        summary={summary}
        refreshing={refreshing}
        onRefresh={refresh}
        onShowHelp={showThresholdHelp}
      />

      <HealthFilterBar
        rows={rows}
        tierFilter={tierFilter}
        onChange={setTierFilter}
      />

      <HealthTable rows={filtered} />

      <SecurityEventsSection />

      <div className={`card admin-footnote ${styles.footer}`}>
        Bron: <code>agent_runs_health_7d</code> (view, 7d window), percentage = <code>health_pct</code>
        (voltooide runs). Ververst automatisch elke 60 seconden.
        Output-state en decision-trail-aggregatie komen in F.4.b — nu zie je alleen run-logs.
      </div>
    </div>
  )
}
