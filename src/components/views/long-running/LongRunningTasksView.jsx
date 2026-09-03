import { useEffect, useMemo, useState } from 'react'
import { useSupabaseQuery } from '../../../hooks/useSupabaseQuery'
import { RUNNER_ORDER, RUNNERS, LONG_RUN_S, runnerOf, summarizeLongRunning } from '../../../lib/longRunning'
import LongRunningTable from './LongRunningTable'
import styles from './LongRunningTasks.module.css'

/**
 * LongRunningTasksView (v1.139) — overzicht van elke geplande taak met de
 * vraag die er nu toe doet: **waar draait hij**, en **hoe lang doet hij erover**.
 *
 * Bron: view `v_agent_runs_summary` (agent_schedules + laatste run, één rij per
 * taak). Groepering op uitvoerder (lib/longRunning.runnerOf) — afgeleid uit
 * `stats.triggered_by` van de laatste run, niet uit een aanname.
 *
 * Verschil met /briefing → Agents: die pagina toont per agent de laatste vijf
 * runs en verbergt bewust infra + source-tier (lib/agentFunctions.NEVER_SHOW).
 * Deze pagina verbergt niets — inclusief de orchestrator-poller zelf en de
 * uitgeschakelde rijen — omdat je juist die nodig hebt om te zien wat nog
 * buiten de app draait.
 *
 * Auto-refresh per minuut; `now` verspringt mee zodat "te laat" blijft lopen.
 */
export default function LongRunningTasksView() {
  const [onlyAttention, setOnlyAttention] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const { data: rows, loading, error, refresh } = useSupabaseQuery(
    'v_agent_runs_summary',
    { initialData: null },
  )

  useEffect(() => {
    const id = setInterval(() => { setNow(Date.now()); refresh() }, 60_000)
    return () => clearInterval(id)
  }, [refresh])

  const summary = useMemo(() => (rows ? summarizeLongRunning(rows, now) : null), [rows, now])

  const groups = useMemo(() => {
    if (!rows) return []
    const attention = (r) => r.is_running
      || r.last_status === 'error'
      || (r.error_14d ?? 0) > 0
      || (typeof r.last_duration_s === 'number' && r.last_duration_s >= LONG_RUN_S)
      || (r.next_run_at && now - new Date(r.next_run_at).getTime() > 15 * 60_000 && r.enabled)
    const list = onlyAttention ? rows.filter(attention) : rows
    return RUNNER_ORDER
      .map(runner => ({ runner, rows: list.filter(r => runnerOf(r) === runner) }))
      .filter(g => g.rows.length > 0)
  }, [rows, onlyAttention, now])

  return (
    <div className="stack stack--gap-5">
      {error && <div className="card"><span className="text-error">⚠ Kon v_agent_runs_summary niet laden: {error}</span></div>}
      {!error && !rows && <div className="card"><span className="text-muted">Laden…</span></div>}

      {rows && rows.length === 0 && (
        <div className="card">
          <div className="text-md">Geen geplande taken zichtbaar.</div>
          <div className="text-sm text-muted">
            <code>v_agent_runs_summary</code> is leeg of niet leesbaar met dit account —
            de tabellen erachter zijn alleen zichtbaar voor de owner-rol met actieve 2FA.
          </div>
        </div>
      )}

      {summary && (
        <div className={`card ${styles.summaryCard}`}>
          <div className={styles.summaryRow}>
            <Kpi tone={RUNNERS.claude.tone} value={summary.byRunner.claude} label="taken buiten de app (Claude Cloud)" />
            <Kpi tone={RUNNERS.app.tone}    value={summary.byRunner.app}    label="taken in de app (pg_cron → Edge)" />
            <Kpi tone="warning"             value={summary.overdue}         label="loopt achter op zijn ritme" />
            <Kpi tone="error"               value={summary.stalled}         label="meer dan 2 uur stil" />
            <Kpi tone="warning"             value={summary.long}            label="laatste run ≥ 10 min" />
            <div className={styles.summaryActions}>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setOnlyAttention(v => !v)}
              >
                {onlyAttention ? 'Toon alles' : 'Alleen aandacht'}
              </button>
              <button type="button" className="btn btn--ghost" onClick={refresh} disabled={loading}>
                {loading ? 'Verversen…' : 'Ververs'}
              </button>
            </div>
          </div>
        </div>
      )}

      {groups.map(g => <LongRunningTable key={g.runner} runner={g.runner} rows={g.rows} now={now} />)}

      {rows && groups.length === 0 && (
        <div className="card"><span className="text-muted">Niets dat aandacht vraagt.</span></div>
      )}

      {rows && (
        <div className="card">
          <p className={styles.note}>
            Bron <code>v_agent_runs_summary</code> · uitvoerder afgeleid uit{' '}
            <code>stats.triggered_by</code> van de laatste run · achterstallig = ingeschakeld
            en meer dan 15 min voorbij <code>next_run_at</code> · een negatieve duur betekent
            dat de taak zelf een <code>completed_at</code> vóór <code>started_at</code> heeft
            weggeschreven en staat daarom als “onbetrouwbaar”.
          </p>
          <p className={styles.note}>
            <strong>Deze lijst is niet compleet voor de app-kant.</strong> Alleen taken met een
            rij in <code>agent_schedules</code> staan hier. De pg_cron-jobs die rechtstreeks een
            Edge Function aanroepen (chunker, de sync- en reconcile-functies, mail-enricher, de
            kb-functies) hebben geen zo’n rij en missen dus — zij vormen het grootste deel van
            het werk dat al ín de app draait. Die kant staat onder Organisatie → Edge Functions.
          </p>
          <p className={styles.note}>
            Taken in de groep <strong>Claude Cloud</strong> worden uitgevoerd door één externe
            Claude-routine buiten deze app. Die routine bestaat precies één keer voor de hele
            organisatie en schaalt dus niet mee per gebruiker. Zolang er taken in deze groep
            staan, hangt dat deel van de planning aan één externe sessie.
          </p>
        </div>
      )}
    </div>
  )
}

function Kpi({ tone, value, label }) {
  return (
    <div className={styles.summaryKpi}>
      <span className={`pill s-${tone} ${styles.summaryPill}`}>{value}</span>
      <span className={styles.summaryLabel}>{label}</span>
    </div>
  )
}
