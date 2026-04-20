import AgentCard from '../AgentCard'

const AGENT = 'sales-on-road'

const STATUS_CLASS = {
  processed:      's-success',
  needs_review:   's-warning',
  pending:        's-idle',
  error:          's-error',
  skipped:        's-idle',
}

const STATUS_LABEL = {
  processed:    'verwerkt',
  needs_review: 'controle nodig',
  pending:      'bezig',
  error:        'fout',
  skipped:      'overgeslagen',
}

export default function SalesOnRoadView({ data }) {
  const schedule  = data.schedules.find(s => s.agent_name === AGENT)
  const latestRun = data.latestRuns[AGENT]
  const history   = data.history[AGENT] || []

  const events = data.salesEvents || []
  const total         = events.length
  const processed     = events.filter(e => e.status === 'processed').length
  const needsReview   = events.filter(e => e.status === 'needs_review').length
  const errored       = events.filter(e => e.status === 'error').length

  const WEEK_MS = 7 * 86400000
  const thisWeekEvents = events.filter(e => Date.now() - new Date(e.created_at).getTime() < WEEK_MS)

  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>

      <section>
        <div className="section__head">
          <h2 className="section__title">Status</h2>
          <span className="section__hint">luistert naar #sales-on-road</span>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)' }}>
          <AgentCard
            agent={AGENT}
            schedule={schedule}
            latestRun={latestRun}
            history={history}
            openQuestions={[]}
          />
        </div>
      </section>

      <section>
        <div className="section__head">
          <h2 className="section__title">Deze week</h2>
          <span className="section__hint">gesprekken via Slack verwerkt</span>
        </div>
        <div className="grid grid--kpi">
          <div className="kpi">
            <div className="kpi__value" style={{ fontVariantNumeric: 'tabular-nums' }}>{thisWeekEvents.length}</div>
            <div className="kpi__label">Gesprekken deze week</div>
          </div>
          <div className="kpi">
            <div className="kpi__value" style={{ fontVariantNumeric: 'tabular-nums' }}>{processed}</div>
            <div className="kpi__label">Totaal verwerkt</div>
          </div>
          <div className="kpi">
            <div className="kpi__value s-warning" style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--warning)' }}>{needsReview}</div>
            <div className="kpi__label">Controle nodig</div>
          </div>
          <div className="kpi">
            <div className="kpi__value" style={{ fontVariantNumeric: 'tabular-nums', color: errored > 0 ? 'var(--error)' : 'var(--accent)' }}>{errored}</div>
            <div className="kpi__label">Fouten</div>
          </div>
        </div>
      </section>

      <section>
        <div className="section__head">
          <h2 className="section__title">Gesprekken {total > 0 && <span className="section__count">{total}</span>}</h2>
          <span className="section__hint">nieuwste boven</span>
        </div>

        {events.length === 0 ? (
          <div className="empty">
            Nog geen gesprekken verwerkt. Post een bericht in <span className="mono">#sales-on-road</span> op Slack —
            de agent pakt het op bij de volgende orchestrator-poll.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Wanneer</th>
                  <th>Bedrijf</th>
                  <th>Stage</th>
                  <th>Acties</th>
                  <th>Draft</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {events.map(e => (
                  <tr key={e.id}>
                    <td>{formatShortDate(e.created_at)}</td>
                    <td style={{ color: 'var(--text)', fontWeight: 500 }}>
                      {e.company_name || <span className="muted">—</span>}
                    </td>
                    <td>
                      {e.stage_before && e.stage_after && e.stage_before !== e.stage_after
                        ? <><span className="muted">{e.stage_before}</span> <span style={{ margin: '0 4px' }}>→</span> <span style={{ color: 'var(--accent)' }}>{e.stage_after}</span></>
                        : e.stage_after
                          ? <span style={{ color: 'var(--accent)' }}>{e.stage_after}</span>
                          : <span className="muted">—</span>}
                    </td>
                    <td>
                      {Array.isArray(e.actions) && e.actions.length > 0
                        ? <span className="muted" style={{ fontSize: 12 }}>{e.actions.join(' · ')}</span>
                        : <span className="muted">—</span>}
                    </td>
                    <td>
                      {e.outlook_draft_created
                        ? <span className="s-success">✓</span>
                        : e.license_requested
                          ? <span className="s-warning" title="licentie nog handmatig">⚠ licentie</span>
                          : <span className="muted">—</span>}
                    </td>
                    <td>
                      <span className={`pill ${STATUS_CLASS[e.status] || 's-idle'}`}>
                        {STATUS_LABEL[e.status] || e.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Laatste rauwe berichten — collapsed per default */}
      {events.length > 0 && (
        <section>
          <div className="section__head">
            <h2 className="section__title">Laatste Slack-berichten</h2>
            <span className="section__hint">wat Jelle schreef</span>
          </div>
          <div className="stack stack--sm">
            {events.slice(0, 5).map(e => (
              <div key={`msg-${e.id}`} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, fontSize: 11 }}>
                  <span className="muted">{formatFullDate(e.created_at)}{e.company_name ? ` · ${e.company_name}` : ''}</span>
                  {e.slack_permalink && <a href={e.slack_permalink} target="_blank" rel="noopener">open in Slack →</a>}
                </div>
                <div style={{ whiteSpace: 'pre-wrap', color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.55 }}>
                  {e.raw_message}
                </div>
                {e.summary && (
                  <div className="inbox-item__default" style={{ marginTop: 10 }}>
                    <span className="muted">samenvatting: </span>{e.summary}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function formatShortDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function formatFullDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-NL', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
