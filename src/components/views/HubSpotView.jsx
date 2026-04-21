import { useState } from 'react'
import AgentCard     from '../AgentCard'
import QuestionCard  from '../QuestionCard'

const AGENT = 'hubspot-daily-sync'

// Statuses die Jelle nog iets moet doen — blijven zichtbaar tot hij ze afrondt.
// Zelfs als expires_at is verlopen blijft een pending-vraag onder "Open vragen"
// totdat de agent 'm als stale markeert (dan heeft hij default_action uitgevoerd).
const ACTION_STATUSES = new Set(['open', 'pending'])

// Statuses waar de agent al iets mee heeft gedaan zonder Jelle's input.
// 'stale' = default_action toegepast na expiry, 'skipped' = agent koos om over te slaan.
const AUTO_HANDLED_STATUSES = new Set(['stale', 'expired', 'skipped', 'auto_resolved'])

// Door Jelle beantwoord.
const ANSWERED_STATUSES = new Set(['answered', 'resolved', 'done'])

function summarizeContext(ctx) {
  if (!ctx || typeof ctx !== 'object') return null
  const entries = []
  if (ctx.company)        entries.push(['bedrijf', ctx.company])
  else if (ctx.bedrijf)   entries.push(['bedrijf', ctx.bedrijf])
  if (ctx.deal_name)      entries.push(['deal', ctx.deal_name])
  if (ctx.dealstage)      entries.push(['stage', ctx.dealstage])
  if (ctx.contact)        entries.push(['contact', ctx.contact])
  if (ctx.email)          entries.push(['email', ctx.email])
  if (Array.isArray(ctx.emails) && ctx.emails.length)
    entries.push(['emails', ctx.emails.join(', ')])
  if (ctx.meeting_time)   entries.push(['tijd', ctx.meeting_time])
  if (ctx.date)           entries.push(['datum', ctx.date])
  if (ctx.signed_by)      entries.push(['getekend door', ctx.signed_by])
  if (ctx.signed_on)      entries.push(['getekend op', ctx.signed_on])
  if (ctx.deal_id)        entries.push(['deal_id', ctx.deal_id])
  return entries.length > 0 ? entries : null
}

function formatDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function HubSpotView({ data }) {
  const [showAnswered, setShowAnswered] = useState(false)
  const [showAutoHandled, setShowAutoHandled] = useState(true)

  const schedule  = data.schedules.find(s => s.agent_name === AGENT)
  const latestRun = data.latestRuns[AGENT]
  const history   = data.history[AGENT] || []

  const allQs = data.questions.filter(q => q.agent_name === AGENT)

  // 3 buckets — exclusief: elke vraag hoort in precies één bucket op basis van status.
  const openQ        = allQs.filter(q => ACTION_STATUSES.has(q.status))
  const autoHandledQ = allQs.filter(q => AUTO_HANDLED_STATUSES.has(q.status))
  const answeredQ    = allQs.filter(q => ANSWERED_STATUSES.has(q.status))

  const openExpired = openQ.filter(q => q.urgency === 'expired').length
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

      {/* BUCKET 1 — Open vragen: wacht op Jelle, blijven zichtbaar tot beantwoord */}
      <section>
        <div className="section__head">
          <h2 className="section__title">
            Nog te doen {openQ.length > 0 && <span className="section__count">{openQ.length}</span>}
            {openExpired > 0 && (
              <span className="pill s-error" style={{ marginLeft: 10, fontSize: 10 }}>
                {openExpired} verlopen deadline
              </span>
            )}
          </h2>
          <span className="section__hint">
            vragen die jouw beslissing nodig hebben — blijven hier staan totdat je ze afrondt, ook als de deadline is gepasseerd
          </span>
        </div>
        {openQ.length === 0 ? (
          <div className="empty">Geen openstaande vragen — HubSpot-sync staat nergens op te wachten.</div>
        ) : (
          <div className="stack">
            {openQ.map(q => <QuestionCard key={q.id} question={q} />)}
          </div>
        )}
      </section>

      {/* BUCKET 2 — Auto-afgehandeld: agent heeft default_action toegepast */}
      {autoHandledQ.length > 0 && (
        <section>
          <div className="section__head">
            <h2 className="section__title">
              Automatisch opgepakt <span className="section__count">{autoHandledQ.length}</span>
            </h2>
            <button
              className="btn btn--ghost"
              onClick={() => setShowAutoHandled(v => !v)}
            >
              {showAutoHandled ? 'verberg' : 'toon'}
            </button>
          </div>
          <div className="section__sub">
            wat de agent zelf heeft opgelost zonder jouw input — vaak met de default-actie
            toegepast na afloop van de deadline. Per vraag zie je wat er is gebeurd.
          </div>
          {showAutoHandled && (
            <div className="stack stack--sm">
              {autoHandledQ.map(q => <AutoHandledCard key={q.id} q={q} />)}
            </div>
          )}
        </section>
      )}

      {/* BUCKET 3 — Door Jelle beantwoord */}
      {answeredQ.length > 0 && (
        <section>
          <div className="section__head">
            <h2 className="section__title">Door jou beantwoord</h2>
            <button
              className="btn btn--ghost"
              onClick={() => setShowAnswered(v => !v)}
            >
              {showAnswered ? `verberg (${answeredQ.length})` : `toon ${answeredQ.length}`}
            </button>
          </div>
          {showAnswered && (
            <div className="stack stack--sm">
              {answeredQ.map(q => (
                <div key={q.id} className="inbox-item inbox-item--done">
                  <div className="inbox-item__head">
                    <span>
                      <span className="inbox-item__agent">{q.agent_name}</span>
                      <span className="muted" style={{ marginLeft: 8 }}>
                        {q.status}{q.answered_at ? ` · ${formatDateTime(q.answered_at)}` : ''}
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
          <InfoCell label="Volgende run" value={formatDateTime(schedule?.next_run_at)} />
        </div>
      </section>
    </div>
  )
}

function AutoHandledCard({ q }) {
  const ctxEntries = summarizeContext(q.context)
  const handledAt = q.answered_at || q.expires_at
  return (
    <div className="inbox-item inbox-item--auto">
      <div className="inbox-item__head">
        <span>
          <span className={`pill ${q.status === 'stale' ? 's-warning' : 's-idle'}`} style={{ marginRight: 8 }}>
            {q.status === 'stale' ? 'auto-opgepakt' : q.status}
          </span>
          {ctxEntries && ctxEntries.find(([k]) => k === 'bedrijf') && (
            <span style={{ color: 'var(--text)', fontWeight: 500 }}>
              {ctxEntries.find(([k]) => k === 'bedrijf')[1]}
            </span>
          )}
        </span>
        <span className="muted" style={{ fontSize: 11 }}>
          {handledAt ? formatDateTime(handledAt) : '—'}
        </span>
      </div>
      <div className="inbox-item__body">{q.question}</div>
      {q.default_action && (
        <div className="inbox-item__default">
          <span className="muted">Wat de agent deed: </span>
          {q.default_action}
        </div>
      )}
      {q.answer && (
        <div className="inbox-item__default">
          <span className="muted">Uitkomst: </span>{q.answer}
        </div>
      )}
      {ctxEntries && ctxEntries.length > 0 && (
        <div className="inbox-item__ctx">
          {ctxEntries.filter(([k]) => k !== 'bedrijf').map(([k, v]) => (
            <span key={k} className="inbox-item__ctx-pill">
              <span className="muted">{k}:</span> {String(v)}
            </span>
          ))}
        </div>
      )}
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
