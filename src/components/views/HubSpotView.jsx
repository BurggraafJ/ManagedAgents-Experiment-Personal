import { useState } from 'react'
import AgentCard     from '../AgentCard'
import QuestionCard  from '../QuestionCard'

const AGENT = 'hubspot-daily-sync'

export default function HubSpotView({ data }) {
  const [showAnswered, setShowAnswered] = useState(false)

  const schedule  = data.schedules.find(s => s.agent_name === AGENT)
  const latestRun = data.latestRuns[AGENT]
  const history   = data.history[AGENT] || []

  const openQ   = data.questions.filter(q => q.status === 'open' && q.agent_name === AGENT)
  const recentQ = data.questions
    .filter(q => q.agent_name === AGENT && q.status !== 'open')
    .slice(0, 10)

  const runs14 = data.todayRuns
    .filter(r => r.agent_name === AGENT)
    .concat([]) // todayRuns is al today-only
  const weekRuns = data.weekStats?.runs
  const dealsThisWeek   = data.weekStats?.deals      ?? 0
  const dealsLastWeek   = data.lastWeekStats?.deals  ?? 0
  const dealsDelta      = dealsThisWeek - dealsLastWeek

  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>

      {/* Agent status card — hergebruikt bestaande AgentCard */}
      <section>
        <div className="section__head">
          <h2 className="section__title">Status</h2>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
          <AgentCard
            agent={AGENT}
            schedule={schedule}
            latestRun={latestRun}
            history={history}
            openQuestions={openQ}
          />
        </div>
      </section>

      {/* Open vragen */}
      <section>
        <div className="section__head">
          <h2 className="section__title">
            Open vragen {openQ.length > 0 && <span className="section__count">{openQ.length}</span>}
          </h2>
          <span className="section__hint">onbeantwoorde vragen uit de daily-sync</span>
        </div>
        {openQ.length === 0 ? (
          <div className="empty">Geen openstaande vragen — HubSpot-sync staat nergens op te wachten.</div>
        ) : (
          <div className="stack">
            {openQ.map(q => <QuestionCard key={q.id} question={q} />)}
          </div>
        )}
      </section>

      {/* Beantwoorde / verlopen vragen historie — default collapsed */}
      {recentQ.length > 0 && (
        <section>
          <div className="section__head">
            <h2 className="section__title">Beantwoord of verlopen</h2>
            <button
              className="btn btn--ghost"
              onClick={() => setShowAnswered(v => !v)}
            >
              {showAnswered ? `verberg (${recentQ.length})` : `toon ${recentQ.length}`}
            </button>
          </div>
          {showAnswered && (
            <div className="stack stack--sm">
              {recentQ.map(q => (
                <div key={q.id} className="inbox-item inbox-item--done">
                  <div className="inbox-item__head">
                    <span>
                      <span className="inbox-item__agent">{q.agent_name}</span>
                      <span className="muted" style={{ marginLeft: 8 }}>
                        {q.status}{q.answered_at ? ` · ${new Date(q.answered_at).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}
                      </span>
                    </span>
                  </div>
                  <div className="inbox-item__body">{q.question}</div>
                  {q.answer && (
                    <div className="inbox-item__default">
                      <span className="muted">antwoord: </span>{q.answer}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Deze week — alleen KPI's met data */}
      <WeekKpis
        dealsThisWeek={dealsThisWeek}
        dealsLastWeek={dealsLastWeek}
        dealsDelta={dealsDelta}
        latestStats={latestRun?.stats || {}}
      />

      {/* Config card met kanaal info */}
      <section>
        <div className="section__head">
          <h2 className="section__title">Configuratie</h2>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          <InfoCell label="Cron" value={schedule?.cron_expression || '—'} mono />
          <InfoCell label="Timeout" value={schedule?.timeout_minutes ? `${schedule.timeout_minutes} min` : '—'} />
          <InfoCell label="Slack rapportage" value="#daily-hubspot-update" />
          <InfoCell label="Slack context" value="#sales-on-road" />
          <InfoCell label="Aan" value={schedule?.enabled ? 'ja' : 'uit'} />
          <InfoCell label="Volgende run" value={schedule?.next_run_at ? new Date(schedule.next_run_at).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'} />
        </div>
      </section>
    </div>
  )
}

function InfoCell({ label, value, mono }) {
  return (
    <div className="card">
      <div className="kpi__label" style={{ marginBottom: 6 }}>{label}</div>
      <div className={mono ? 'mono' : ''} style={{ color: 'var(--text)' }}>{value}</div>
    </div>
  )
}

function WeekKpis({ dealsThisWeek, dealsLastWeek, dealsDelta, latestStats }) {
  // Alleen KPI's tonen die een numerieke waarde hebben (niet null/undefined, niet 0 als
  // ook vorige was 0).
  const cells = []

  if (dealsThisWeek > 0 || dealsLastWeek > 0) {
    cells.push({
      key: 'deals',
      value: dealsThisWeek,
      label: 'Deal-updates',
      trend: dealsDelta,
      prev: dealsLastWeek,
    })
  }

  const SIMPLE = [
    { key: 'contacts_added', label: 'Contacten (laatste run)' },
    { key: 'notes_created',  label: 'Notes (laatste run)' },
    { key: 'tasks_created',  label: 'Tasks (laatste run)' },
    { key: 'questions_posted', label: 'Vragen gesteld (laatste run)' },
  ]

  for (const s of SIMPLE) {
    const v = latestStats[s.key]
    if (typeof v === 'number' && v > 0) {
      cells.push({ key: s.key, value: v, label: s.label })
    }
  }

  if (cells.length === 0) {
    return (
      <section>
        <div className="section__head">
          <h2 className="section__title">Deze week</h2>
        </div>
        <div className="empty">Nog geen resultaten deze week — hubspot-sync draait werkdag 17:00.</div>
      </section>
    )
  }

  return (
    <section>
      <div className="section__head">
        <h2 className="section__title">Deze week</h2>
        <span className="section__hint">HubSpot-sync specifiek</span>
      </div>
      <div className="grid grid--kpi">
        {cells.map(c => (
          <div key={c.key} className="kpi">
            <div className="kpi__value" style={{ fontVariantNumeric: 'tabular-nums' }}>{c.value}</div>
            <div className="kpi__label">{c.label}</div>
            {c.trend !== undefined && (
              <div className={`kpi__trend ${c.trend > 0 ? 'kpi__trend--up' : c.trend < 0 ? 'kpi__trend--down' : 'kpi__trend--flat'}`}>
                {c.trend > 0 ? `▲ +${c.trend}` : c.trend < 0 ? `▼ ${c.trend}` : '±0'}{' '}
                <span className="muted">vorige week {c.prev}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
