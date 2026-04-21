import AgentCard from '../AgentCard'

const AGENT = 'auto-draft'

const DAY = 86400000

const CHROME_MARKERS = [
  'chrome',
  'tab group',
  'mcp',
  'headless',
]

function isChromeIssue(run) {
  const s = run.stats || {}
  const hay = [s.error, s.blocker, s.skip_reason, s.note, s.action].filter(Boolean).join(' ').toLowerCase()
  if (!hay) return false
  return CHROME_MARKERS.some(m => hay.includes(m))
}

function statsNumber(s, key) {
  const v = s?.[key]
  if (typeof v === 'number') return v
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v)
  return 0
}

function aggregate(runs, since) {
  let total = 0, success = 0, warning = 0, error = 0, skipped = 0
  let mails = 0, drafts = 0, questions = 0, chrome = 0
  const reasons = new Map()

  for (const r of runs) {
    if (r.agent_name !== AGENT) continue
    if (since && new Date(r.started_at) < since) continue
    total++
    if (r.status === 'success') success++
    else if (r.status === 'warning') warning++
    else if (r.status === 'error') error++
    else if (r.status === 'skipped') skipped++
    mails    += statsNumber(r.stats, 'mails_scanned')
    drafts   += statsNumber(r.stats, 'drafts_created')
    questions+= statsNumber(r.stats, 'questions_posted')
    if (isChromeIssue(r)) chrome++
    const reason = r.stats?.skip_reason || r.stats?.blocker || r.stats?.action || r.stats?.reason
    if (reason && r.status !== 'success') {
      reasons.set(reason, (reasons.get(reason) || 0) + 1)
    }
  }

  const topReasons = [...reasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

  return { total, success, warning, error, skipped, mails, drafts, questions, chrome, topReasons }
}

function pct(n, d) {
  if (!d) return '—'
  return `${Math.round((n / d) * 100)}%`
}

export default function AutoDraftView({ data }) {
  const schedule  = data.schedules.find(s => s.agent_name === AGENT)
  const latestRun = data.latestRuns[AGENT]
  const history   = data.history[AGENT] || []

  const now = new Date()
  const today     = new Date(now); today.setHours(0, 0, 0, 0)
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  weekStart.setHours(0, 0, 0, 0)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const last7      = new Date(now - 7 * DAY)

  const agentRuns = (data.recentRuns || []).concat(
    Object.values(data.latestRuns || {}).filter(r => r.agent_name === AGENT)
  )
  // Dedupe op id
  const seen = new Set()
  const allRuns = []
  for (const r of (data.todayRuns || []).concat(data.weekRuns || []).concat(agentRuns)) {
    if (!r || r.agent_name !== AGENT) continue
    const key = r.id || `${r.started_at}-${r.agent_name}`
    if (seen.has(key)) continue
    seen.add(key)
    allRuns.push(r)
  }
  allRuns.sort((a, b) => new Date(b.started_at) - new Date(a.started_at))

  const stTotal = aggregate(allRuns)
  const stToday = aggregate(allRuns, today)
  const stWeek  = aggregate(allRuns, weekStart)
  const stMonth = aggregate(allRuns, monthStart)
  const st7d    = aggregate(allRuns, last7)

  // Verwachte runs op werkdagen: 7 slots/dag * 5 = 35 per week. Snelle coverage-schatting.
  const expectedThisWeek = expectedSlotsSince(weekStart, now)
  const coveragePct = expectedThisWeek > 0
    ? Math.min(100, Math.round((stWeek.total / expectedThisWeek) * 100))
    : null

  const healthyWeek = stWeek.success
  const healthyRate = stWeek.total > 0 ? pct(healthyWeek, stWeek.total) : '—'

  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>

      <section>
        <div className="section__head">
          <h2 className="section__title">Status</h2>
          <span className="section__hint">scant Outlook + maakt concepten via Chrome MCP</span>
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
          <h2 className="section__title">Consistentie</h2>
          <span className="section__hint">werkdag 08–20 elk uur = 13 runs/dag · 65 runs/werkweek</span>
        </div>
        <div className="grid grid--kpi">
          <KpiCell value={stWeek.total} label="Runs deze week" accent />
          <KpiCell value={expectedThisWeek} label="Verwacht deze week" />
          <KpiCell
            value={coveragePct === null ? '—' : `${coveragePct}%`}
            label="Coverage"
            tone={coveragePct !== null && coveragePct < 70 ? 'error' : coveragePct !== null && coveragePct < 90 ? 'warning' : null}
          />
          <KpiCell value={healthyRate} label="Succes-ratio deze week"
            tone={stWeek.total > 0 && healthyWeek / stWeek.total < 0.5 ? 'error' : null} />
        </div>
      </section>

      <section>
        <div className="section__head">
          <h2 className="section__title">Runs per periode</h2>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Periode</th>
                <th className="num">Runs</th>
                <th className="num">Succes</th>
                <th className="num">Warning</th>
                <th className="num">Error</th>
                <th className="num">Skipped</th>
                <th className="num">Chrome-issues</th>
              </tr>
            </thead>
            <tbody>
              <PeriodRow label="Vandaag"       s={stToday} />
              <PeriodRow label="Deze week"     s={stWeek} />
              <PeriodRow label="Laatste 7 dgn" s={st7d} />
              <PeriodRow label="Deze maand"    s={stMonth} />
              <PeriodRow label="Alle data"     s={stTotal} muted />
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <div className="section__head">
          <h2 className="section__title">Output</h2>
          <span className="section__hint">wat de agent gescand en gedraft heeft</span>
        </div>
        <div className="grid grid--kpi">
          <KpiCell value={stWeek.mails}     label="Mails gescand · week" />
          <KpiCell value={stWeek.drafts}    label="Drafts gemaakt · week" accent />
          <KpiCell value={stWeek.questions} label="Vragen gesteld · week" />
          <KpiCell value={stMonth.drafts}   label="Drafts · maand" />
        </div>
      </section>

      {stWeek.chrome > 0 && (
        <section>
          <div className="section__head">
            <h2 className="section__title">Chrome-problemen</h2>
            <span className="section__hint">runs waar Chrome MCP / tab group niet bereikbaar was</span>
          </div>
          <div className="grid grid--kpi">
            <KpiCell value={stWeek.chrome}  label="Deze week" tone="warning" />
            <KpiCell value={stMonth.chrome} label="Deze maand" />
            <KpiCell
              value={stWeek.total > 0 ? pct(stWeek.chrome, stWeek.total) : '—'}
              label="% runs met Chrome-issue · week"
              tone={stWeek.total > 0 && stWeek.chrome / stWeek.total > 0.3 ? 'error' : null}
            />
            <KpiCell value={stTotal.chrome} label="Totaal gelogd" muted />
          </div>
        </section>
      )}

      {stWeek.topReasons.length > 0 && (
        <section>
          <div className="section__head">
            <h2 className="section__title">Meest voorkomende redenen</h2>
            <span className="section__hint">warning / error / skipped · deze week</span>
          </div>
          <div className="stack stack--sm">
            {stWeek.topReasons.map(([reason, count]) => (
              <div key={reason} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px' }}>
                <span style={{ color: 'var(--text)', fontSize: 13 }}>{reason}</span>
                <span className="agent-card__metric">
                  {count}<span className="agent-card__metric-label">×</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <PerMailTable events={data.draftEvents || []} />

      <section>
        <div className="section__head">
          <h2 className="section__title">Laatste 20 runs</h2>
          <span className="section__hint">nieuwste boven</span>
        </div>
        {allRuns.length === 0 ? (
          <div className="empty">Nog geen runs beschikbaar.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Start</th>
                  <th>Status</th>
                  <th className="num">Gescand</th>
                  <th className="num">Drafts</th>
                  <th className="num">Vragen</th>
                  <th>Trigger</th>
                  <th>Opmerking</th>
                </tr>
              </thead>
              <tbody>
                {allRuns.slice(0, 20).map(r => {
                  const s = r.stats || {}
                  const note = s.error || s.blocker || s.skip_reason || s.action || s.note || ''
                  return (
                    <tr key={r.id || r.started_at}>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {new Date(r.started_at).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td>
                        <span className={`pill s-${r.status === 'empty' ? 'idle' : r.status}`}>{r.status}</span>
                      </td>
                      <td className="num">{statsNumber(s, 'mails_scanned') || ''}</td>
                      <td className="num">{statsNumber(s, 'drafts_created') || ''}</td>
                      <td className="num">{statsNumber(s, 'questions_posted') || ''}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{s.triggered_by || '—'}</td>
                      <td className="muted" style={{ fontSize: 12, maxWidth: 360 }} title={typeof note === 'string' ? note : JSON.stringify(note)}>
                        {typeof note === 'string' ? truncate(note, 70) : ''}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

const ACTION_LABEL = {
  drafted:       { label: 'draft gemaakt',   cls: 's-success' },
  draft_created: { label: 'draft gemaakt',   cls: 's-success' },
  skipped:       { label: 'overgeslagen',    cls: 's-idle' },
  skip:          { label: 'overgeslagen',    cls: 's-idle' },
  question:      { label: 'vraag gesteld',   cls: 's-warning' },
  question_posted:{ label: 'vraag gesteld',  cls: 's-warning' },
  error:         { label: 'fout',            cls: 's-error' },
  replied:       { label: 'al beantwoord',   cls: 's-idle' },
}

function labelAction(action) {
  return ACTION_LABEL[action] || { label: action || '—', cls: 's-idle' }
}

function PerMailTable({ events }) {
  // Groepeer skip-reasons voor snelle pattern-analyse
  const skipReasons = new Map()
  for (const e of events) {
    if (!e.skip_reason) continue
    skipReasons.set(e.skip_reason, (skipReasons.get(e.skip_reason) || 0) + 1)
  }
  const topSkipReasons = [...skipReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

  return (
    <section>
      <div className="section__head">
        <h2 className="section__title">
          Per mail {events.length > 0 && <span className="section__count">{events.length}</span>}
        </h2>
        <span className="section__hint">waarom heeft de agent wel of geen draft gemaakt — handig voor procesverbetering</span>
      </div>

      {events.length === 0 ? (
        <div className="empty">
          De agent schrijft per-mail events nog niet weg naar <code>draft_events</code>.
          Zodra de auto-draft skill na elke run een rij per mail inserts (mail_id · action · skip_reason · subject · sender),
          verschijnt hier een tabel met de laatste 200 beslissingen zodat je ziet waarom hij iets wel of niet heeft gedraft.
        </div>
      ) : (
        <>
          {topSkipReasons.length > 0 && (
            <div className="stack stack--sm" style={{ marginBottom: 'var(--s-4)' }}>
              <div className="muted" style={{ fontSize: 11 }}>Top skip-reasons:</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {topSkipReasons.map(([reason, count]) => (
                  <span key={reason} className="pill" style={{ background: 'var(--surface-3)' }}>
                    {reason} <span className="muted">×{count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Wanneer</th>
                  <th>Onderwerp</th>
                  <th>Afzender</th>
                  <th>Actie</th>
                  <th>Reden / preview</th>
                </tr>
              </thead>
              <tbody>
                {events.slice(0, 80).map(e => {
                  const a = labelAction(e.action)
                  const reason = e.skip_reason
                    || (e.draft_preview ? truncate(e.draft_preview, 90) : null)
                  return (
                    <tr key={e.id || `${e.mail_id}-${e.created_at}`}>
                      <td className="mono" style={{ fontSize: 12 }}>
                        {new Date(e.created_at).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td style={{ color: 'var(--text)', fontWeight: 500, maxWidth: 280 }} title={e.subject || ''}>
                        {truncate(e.subject || '—', 60)}
                      </td>
                      <td className="muted" style={{ fontSize: 12 }}>
                        {e.sender_domain || (e.sender ? (e.sender.split('@')[1] || e.sender) : '—')}
                      </td>
                      <td>
                        <span className={`pill ${a.cls}`}>{a.label}</span>
                      </td>
                      <td className="muted" style={{ fontSize: 12, maxWidth: 340 }} title={reason || ''}>
                        {reason ? truncate(reason, 80) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

function PeriodRow({ label, s, muted }) {
  return (
    <tr>
      <td style={muted ? { color: 'var(--text-muted)' } : {}}>{label}</td>
      <td className="num" style={{ fontWeight: 500 }}>{s.total}</td>
      <td className="num"><span className={s.success > 0 ? 's-success' : 'muted'}>{s.success}</span></td>
      <td className="num"><span className={s.warning > 0 ? 's-warning' : 'muted'}>{s.warning}</span></td>
      <td className="num"><span className={s.error   > 0 ? 's-error'   : 'muted'}>{s.error}</span></td>
      <td className="num muted">{s.skipped}</td>
      <td className="num"><span className={s.chrome  > 0 ? 's-warning' : 'muted'}>{s.chrome}</span></td>
    </tr>
  )
}

function KpiCell({ value, label, accent, tone, muted }) {
  const color = accent ? 'var(--accent)'
              : tone === 'error' ? 'var(--error)'
              : tone === 'warning' ? 'var(--warning)'
              : muted ? 'var(--text-muted)'
              : 'var(--text)'
  return (
    <div className="kpi">
      <div className="kpi__value" style={{ fontVariantNumeric: 'tabular-nums', color }}>{value}</div>
      <div className="kpi__label">{label}</div>
    </div>
  )
}

function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

// Tel de verwachte run-slots voor auto-draft tussen `from` en `to`.
// Werkdag slots: elk uur 08..20 = 13 per werkdag.
// Weekend slots: 11, 17 = 2 per weekenddag.
function expectedSlotsSince(from, to) {
  const WEEKDAY_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
  const WEEKEND_HOURS = [11, 17]
  let count = 0
  const cur = new Date(from)
  cur.setMinutes(0, 0, 0)
  while (cur <= to) {
    const isWeekend = cur.getDay() === 0 || cur.getDay() === 6
    const hours = isWeekend ? WEEKEND_HOURS : WEEKDAY_HOURS
    if (hours.includes(cur.getHours())) count++
    cur.setHours(cur.getHours() + 1)
  }
  return count
}
