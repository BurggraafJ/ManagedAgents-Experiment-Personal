import AgentCard     from '../AgentCard'
import QuestionCard  from '../QuestionCard'

const AGENT = 'hubspot-daily-sync'

export default function HubSpotView({ data }) {
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

      {/* Beantwoorde / verlopen vragen historie */}
      {recentQ.length > 0 && (
        <section>
          <div className="section__head">
            <h2 className="section__title">Beantwoord of verlopen</h2>
            <span className="section__hint">laatste {recentQ.length}</span>
          </div>
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
        </section>
      )}

      {/* Deze week — mini KPI */}
      <section>
        <div className="section__head">
          <h2 className="section__title">Deze week</h2>
          <span className="section__hint">HubSpot-sync specifiek</span>
        </div>
        <div className="grid grid--kpi">
          <div className="kpi">
            <div className="kpi__value" style={{ fontVariantNumeric: 'tabular-nums' }}>{dealsThisWeek}</div>
            <div className="kpi__label">Deal-updates</div>
            <div className={`kpi__trend ${dealsDelta > 0 ? 'kpi__trend--up' : dealsDelta < 0 ? 'kpi__trend--down' : 'kpi__trend--flat'}`}>
              {dealsDelta > 0 ? `▲ +${dealsDelta}` : dealsDelta < 0 ? `▼ ${dealsDelta}` : '±0'}{' '}
              <span className="muted">vorige week {dealsLastWeek}</span>
            </div>
          </div>
          <div className="kpi">
            <div className="kpi__value" style={{ fontVariantNumeric: 'tabular-nums' }}>{latestRun?.stats?.contacts_added ?? '—'}</div>
            <div className="kpi__label">Contacten toegevoegd (laatste run)</div>
          </div>
          <div className="kpi">
            <div className="kpi__value" style={{ fontVariantNumeric: 'tabular-nums' }}>{latestRun?.stats?.notes_created ?? '—'}</div>
            <div className="kpi__label">Notes (laatste run)</div>
          </div>
          <div className="kpi">
            <div className="kpi__value" style={{ fontVariantNumeric: 'tabular-nums' }}>{latestRun?.stats?.tasks_created ?? '—'}</div>
            <div className="kpi__label">Tasks (laatste run)</div>
          </div>
        </div>
      </section>

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
