import { useEffect, useMemo, useState } from 'react'
import { useSupabaseQuery } from '../../hooks/useSupabaseQuery'
import { futureTime, relativeTime } from '../../lib/dateFormat'
import {
  RUNNER_ORDER, RUNNERS, durationLabel, isBadDuration, isLongRun, lateShort,
  lateTone, overdueMs, runnerOf, sortForReview, summarizeLongRunning,
} from '../../lib/longRunning'
import MIcon from '../MIcon'
import { MSetHead } from './MobileSettingsBits'
import '../mobile-settings.css'
import '../mobile-admin.css'

// Long running tasks op mobiel (v1.139) — zelfde bron en zelfde uitvoerder-
// indeling als de desktop-view (v_agent_runs_summary + lib/longRunning), als
// lijst met kleur-dot per status. Hergebruikt de m-ap-* rij-styling uit
// mobile-admin.css zodat er geen tweede lijst-design bijkomt.
export default function MobileLongRunning() {
  const [filter, setFilter] = useState('claude')
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
  const present = useMemo(
    () => RUNNER_ORDER.filter(id => (rows || []).some(r => runnerOf(r) === id)),
    [rows],
  )
  const list = useMemo(() => {
    if (!rows) return []
    const l = filter === 'all' ? rows : rows.filter(r => runnerOf(r) === filter)
    return sortForReview(l, now)
  }, [rows, filter, now])

  return (
    <div className="m-dash m-set m-ap">
      <MSetHead
        eyebrow="Meer"
        title="Long running tasks"
        sub="Waar draait elke geplande taak, en hoe lang doet hij erover."
        meta={summary && (
          <>
            <b>{summary.byRunner.claude}</b> buiten de app
            {' · '}{summary.byRunner.app} in de app
            {summary.overdue > 0 && <> · <span className="is-warn">{summary.overdue} loopt achter</span></>}
            {summary.stalled > 0 && <> · {summary.stalled} &gt; 2u stil</>}
          </>
        )}
        titleRight={(
          <button type="button" className="m-ap-refresh" onClick={refresh} disabled={loading} aria-label="Ververs">
            <MIcon name="refresh" size={17} />
          </button>
        )}
      />
      <div className="m-set__body">
        {error && <div className="m-set__errline">⚠ Kon v_agent_runs_summary niet laden: {error}</div>}
        {!error && !rows && <div className="m-set__empty">Laden…</div>}

        {rows && (
          <div className="m-ap-chips">
            <Chip on={filter === 'all'} onClick={() => setFilter('all')}>Alle {rows.length}</Chip>
            {present.map(id => (
              <Chip key={id} on={filter === id} onClick={() => setFilter(id)}>
                {RUNNERS[id].label} {summary?.byRunner[id]}
              </Chip>
            ))}
          </div>
        )}

        {rows && (
          <div className="m-inset">
            {list.length === 0 && <div className="m-set__empty">Geen taken in deze filter.</div>}
            {list.map(r => <TaskRow key={r.agent_name} row={r} now={now} />)}
          </div>
        )}

        <p className="m-set__note">
          <MIcon name="activity" size={18} />
          <span>
            Uitvoerder afgeleid uit stats.triggered_by van de laatste run. Taken onder
            “Claude Cloud” draaien in één externe Claude-routine — die bestaat één keer
            voor de hele organisatie en schaalt niet mee per gebruiker. De app-kant is
            niet compleet: pg_cron-jobs zonder agent_schedules-rij (chunker, syncs,
            reconciles) staan hier niet.
          </span>
        </p>
      </div>
    </div>
  )
}

function Chip({ on, onClick, children }) {
  return <button type="button" className={`m-ap-chip ${on ? 'is-active' : ''}`} onClick={onClick}>{children}</button>
}

function TaskRow({ row: r, now }) {
  const late = overdueMs(r, now)
  const tone = lateTone(late)
    || (r.last_status === 'error' ? 'error'
      : r.last_status === 'warning' ? 'warning'
      : r.last_status === 'success' ? 'success'
      : 'idle')

  return (
    <div className={`m-inset__row m-ap-row m-ap-row--${tone}`}>
      <span className={`m-ap-dot m-ap-dot--${tone}`} aria-hidden />
      <span className="m-ap-row__main">
        <span className="m-ap-row__title">
          {r.display_name || r.agent_name}
          {r.is_running && <span className="m-ap-pill">draait</span>}
          {isLongRun(r) && <span className="m-ap-pill">lange run</span>}
          {r.enabled === false && <span className="m-ap-pill">uit</span>}
        </span>
        <span className="m-ap-row__sub">
          {r.cron_expression || 'geen ritme'}
          {' · '}{relativeTime(r.last_run_at) || 'nooit gedraaid'}
          {' · '}{isBadDuration(r) ? 'duur onbetrouwbaar' : durationLabel(r)}
        </span>
      </span>
      <span className={`m-ap-pct m-ap-pct--${tone}`}>
        {late > 0 ? lateShort(late)
          : r.enabled === false ? '—'
          : r.is_running ? 'draait'
          : futureTime(r.next_run_at)}
      </span>
    </div>
  )
}
