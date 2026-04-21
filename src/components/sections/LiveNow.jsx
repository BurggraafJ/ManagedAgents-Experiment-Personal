export default function LiveNow({ runningSchedules, orchestratorAgeMin, orchestratorRun, orchestratorSchedule }) {
  return (
    <section id="nu">
      <div className="section__head">
        <h2 className="section__title">Live nu</h2>
      </div>

      <div className="live live--2">
        <div className="live__panel">
          <span className="live__label">Draait nu</span>
          {runningSchedules.length > 0 ? (
            <>
              <div className="live__value">
                <span className="dot dot--pulse s-running" />
                {runningSchedules[0].display_name || runningSchedules[0].agent_name}
              </div>
              <div className="live__sub">
                {runningSchedules[0].run_lock_acquired_at
                  ? `gestart ${formatAgo(runningSchedules[0].run_lock_acquired_at)}`
                  : 'lock actief'}
                {runningSchedules.length > 1 && <> · +{runningSchedules.length - 1} meer</>}
              </div>
            </>
          ) : orchestratorSchedule?.next_run_at ? (
            <>
              <div className="live__value">
                <span className="dot s-success" />
                <span>Volgende poll {formatIn(orchestratorSchedule.next_run_at)}</span>
              </div>
              <div className="live__sub">
                Orchestrator checkt dan welke agents aan de beurt zijn
                {orchestratorSchedule.cron_expression && (
                  <> · <span className="mono" style={{ color: 'var(--text-faint)' }}>{orchestratorSchedule.cron_expression}</span></>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="live__value">
                <span className="dot s-idle" />
                <span className="dim">rust</span>
              </div>
              <div className="live__sub">geen agent actief, orchestrator pollt straks</div>
            </>
          )}
        </div>

        <div className="live__panel">
          <span className="live__label">Orchestrator</span>
          <div className="live__value">
            <HeartbeatIcon ageMin={orchestratorAgeMin} />
            <span>{orchestratorAgeMin !== null && orchestratorAgeMin !== undefined ? formatAgeLong(orchestratorAgeMin) : 'geen data'}</span>
          </div>
          <div className="live__sub">
            {orchestratorRun
              ? <>laatste poll: {orchestratorRun.status} · {orchestratorRun.summary?.slice(0, 60) || '—'}</>
              : 'orchestrator heeft nog niet gedraaid'}
          </div>
        </div>
      </div>
    </section>
  )
}

function HeartbeatIcon({ ageMin }) {
  let tone = 's-idle', pulse = false
  if (ageMin !== null && ageMin !== undefined) {
    if (ageMin < 20)      { tone = 's-success'; pulse = true }
    else if (ageMin < 60) { tone = 's-warning' }
    else                  { tone = 's-error' }
  }
  return <span className={tone}><span className={`dot ${pulse ? 'dot--pulse' : ''}`} /></span>
}

function formatAgeLong(min) {
  if (min < 1) return 'zojuist'
  if (min < 60) return `${min} min geleden`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} uur geleden`
  return `${Math.round(h / 24)} dagen geleden`
}

function formatAgo(iso) {
  if (!iso) return '—'
  const min = Math.round((new Date() - new Date(iso)) / 60000)
  if (min < 1) return 'zojuist'
  if (min < 60) return `${min}m geleden`
  return `${Math.round(min / 60)}u geleden`
}

function formatIn(iso) {
  if (!iso) return '—'
  const diffMin = Math.round((new Date(iso) - new Date()) / 60000)
  if (diffMin <= 0) return 'nu'
  if (diffMin < 60) return `over ${diffMin}m`
  const h = Math.floor(diffMin / 60)
  const m = diffMin % 60
  if (h < 24) return `over ${h}u${m > 0 ? ` ${m}m` : ''}`
  return `over ${Math.round(diffMin / (24 * 60))}d`
}
