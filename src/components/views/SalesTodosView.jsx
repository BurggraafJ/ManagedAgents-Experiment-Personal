import AgentCard from '../AgentCard'

const AGENT = 'sales-todos'

const STATUS_CLASS = {
  pending:     's-idle',
  draft_ready: 's-success',
  completed:   's-idle',
  dismissed:   's-idle',
  error:       's-error',
}

const STATUS_LABEL = {
  pending:     'bezig',
  draft_ready: 'draft klaar',
  completed:   'verzonden',
  dismissed:   'gedismissed',
  error:       'fout',
}

const TYPE_LABEL = {
  offerte_reminder:    'offerte herinnering',
  trial_ending:        'trial loopt af',
  checkin:             'check-in',
  onboarding_followup: 'onboarding',
  other:               'overig',
}

const PRIORITY_CLASS = {
  low:    's-idle',
  normal: '',
  high:   's-warning',
  urgent: 's-error',
}

export default function SalesTodosView({ data }) {
  const schedule  = data.schedules.find(s => s.agent_name === AGENT)
  const latestRun = data.latestRuns[AGENT]
  const history   = data.history[AGENT] || []

  const todos = data.salesTodos || []
  const pending     = todos.filter(t => t.status === 'pending')
  const draftReady  = todos.filter(t => t.status === 'draft_ready')
  const completed   = todos.filter(t => t.status === 'completed')
  const errored     = todos.filter(t => t.status === 'error')

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const completedToday = completed.filter(t => t.completed_at && new Date(t.completed_at) >= today).length

  // Detecteer Chrome/Outlook-blocker in de laatste runs: de skill logt dit via
  // stats.note / summary als het draft-pad niet werkt in de orchestrator-sessie.
  const blocker = detectChromeBlocker(latestRun, todos)

  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>

      {blocker && (
        <div className="blocker-banner">
          <div className="blocker-banner__icon">⚠</div>
          <div className="blocker-banner__body">
            <div className="blocker-banner__title">Draft-pad niet beschikbaar</div>
            <div className="blocker-banner__text">
              De agent scande {blocker.dealsScanned ?? 'de'} open deals maar kon geen Outlook-concepten aanmaken —
              Chrome-MCP is niet bereikbaar in de orchestrator-sessie. Dit is een infrastructuur-issue,
              geen bug. Oplossingen: (1) handmatig triggeren via de ↻ run-nu knop op een machine waar Chrome
              + Outlook open staan, of (2) de <code>sales-todos</code> skill uitbreiden met een fallback
              die alleen TODO-rijen in Supabase maakt (zonder Outlook-draft) — dan zie je ze hier wel staan
              en kun je ze zelf afhandelen.
            </div>
          </div>
        </div>
      )}

      <section>
        <div className="section__head">
          <h2 className="section__title">Status</h2>
          <span className="section__hint">scant HubSpot op deals die actie vragen</span>
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
          <h2 className="section__title">Openstaand</h2>
          <span className="section__hint">draft-mails wachten in Outlook-map "Sales Agent"</span>
        </div>
        <div className="grid grid--kpi">
          <KpiCell value={draftReady.length} label="Draft klaar" accent />
          <KpiCell value={pending.length}    label="In behandeling" />
          <KpiCell value={completedToday}    label="Vandaag voltooid" />
          <KpiCell value={errored.length}    label="Fouten" tone={errored.length > 0 ? 'error' : null} />
        </div>
      </section>

      <section>
        <div className="section__head">
          <h2 className="section__title">TODO's {todos.length > 0 && <span className="section__count">{todos.length}</span>}</h2>
          <span className="section__hint">nieuwste boven</span>
        </div>

        {todos.length === 0 ? (
          <div className="empty">
            Nog geen TODO's — de agent scant HubSpot bij elke orchestrator-poll.
            Zodra een deal een reminder of check-in nodig heeft verschijnt hij hier.
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Wanneer</th>
                  <th>Bedrijf</th>
                  <th>Type</th>
                  <th>Reden</th>
                  <th>Draft</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {todos.slice(0, 50).map(t => (
                  <tr key={t.id}>
                    <td>{formatShortDate(t.created_at)}</td>
                    <td style={{ color: 'var(--text)', fontWeight: 500 }}>
                      {t.company_name || <span className="muted">—</span>}
                      {t.priority && t.priority !== 'normal' && (
                        <span className={`pill ${PRIORITY_CLASS[t.priority] || ''}`} style={{ marginLeft: 8 }}>
                          {t.priority}
                        </span>
                      )}
                    </td>
                    <td>
                      <span style={{ color: 'var(--accent)', fontSize: 12 }}>
                        {TYPE_LABEL[t.type] || t.type}
                      </span>
                    </td>
                    <td>
                      <span className="muted" style={{ fontSize: 12 }} title={t.reason}>
                        {truncate(t.reason || '', 60)}
                      </span>
                    </td>
                    <td>
                      {t.outlook_draft_created ? (
                        <span className="s-success" title={t.outlook_draft_subject || ''}>✓ Sales Agent</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <span className={`pill ${STATUS_CLASS[t.status] || 's-idle'}`}>
                        {STATUS_LABEL[t.status] || t.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {draftReady.length > 0 && (
        <section>
          <div className="section__head">
            <h2 className="section__title">Klaar om te versturen</h2>
            <span className="section__hint">in Outlook concepten → map "Sales Agent"</span>
          </div>
          <div className="stack stack--sm">
            {draftReady.slice(0, 5).map(t => (
              <div key={`draft-${t.id}`} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6, fontSize: 11 }}>
                  <span>
                    <span className="inbox-item__agent">{TYPE_LABEL[t.type] || t.type}</span>
                    <span className="muted" style={{ marginLeft: 8 }}>{t.company_name}</span>
                    {t.contact_email && <span className="muted mono" style={{ marginLeft: 8 }}>{t.contact_email}</span>}
                  </span>
                  <span className="muted">{formatShortDate(t.created_at)}</span>
                </div>
                {t.outlook_draft_subject && (
                  <div style={{ color: 'var(--text)', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>
                    {t.outlook_draft_subject}
                  </div>
                )}
                <div className="muted" style={{ fontSize: 12 }}>
                  {t.reason}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function detectChromeBlocker(latestRun, todos) {
  if (!latestRun) return null
  const s = latestRun.stats || {}
  const haystack = [latestRun.summary, s.note, s.blocker, s.error]
    .filter(Boolean).join(' ').toLowerCase()
  const hasChromeIssue = /chrome|outlook|tab group|mcp|headless/.test(haystack)
  // Als er WEL todos zijn aangemaakt hoeft de banner niet — dan ging het prima.
  const noTodosCreated = s.todos_created === 0 || s.drafts_prepared === 0 || todos.length === 0
  if (!hasChromeIssue || !noTodosCreated) return null
  return {
    dealsScanned: s.deals_scanned || null,
    when: latestRun.started_at,
  }
}

function KpiCell({ value, label, accent, tone }) {
  const color = accent ? 'var(--accent)' : tone === 'error' ? 'var(--error)' : 'var(--text)'
  return (
    <div className="kpi">
      <div className="kpi__value" style={{ fontVariantNumeric: 'tabular-nums', color }}>{value}</div>
      <div className="kpi__label">{label}</div>
    </div>
  )
}

function formatShortDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
