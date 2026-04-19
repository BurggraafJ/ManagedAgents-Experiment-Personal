import AgentCard from '../AgentCard'

const AGENTS = [
  { name: 'auto-draft',          displayName: 'Auto-Draft',           slackChannel: 'drafts',             metricLabel: 'drafts',   statKey: 'drafts_created' },
  { name: 'hubspot-daily-sync',  displayName: 'HubSpot Daily Sync',   slackChannel: 'hubspot-sync',       metricLabel: 'deals',    statKey: 'deals_updated' },
  { name: 'linkedin-connect',    displayName: 'LinkedIn Connect',     slackChannel: 'linkedin-connect',   metricLabel: 'connects', statKey: 'connects_sent' },
  { name: 'kilometerregistratie',displayName: 'Kilometerregistratie', slackChannel: 'kilometerregistratie', metricLabel: 'maand',  statKey: null },
]

function statValue(run, key) {
  if (!run || !run.stats || !key) return undefined
  return run.stats[key]
}

const WEEK_CELL = { background: '#2B2B2B', padding: '20px 22px', borderRadius: 6, border: '1px solid #383838', textAlign: 'center' }

export default function DashboardTab({ data }) {
  const { latestRuns, history, questions, weekStats, linkedin } = data

  const questionsByAgent = {}
  questions.filter(q => q.status === 'open').forEach(q => {
    if (!questionsByAgent[q.agent_name]) questionsByAgent[q.agent_name] = []
    questionsByAgent[q.agent_name].push(q)
  })

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {AGENTS.map(a => (
          <AgentCard
            key={a.name}
            name={a.name}
            displayName={a.displayName}
            slackChannel={a.slackChannel}
            latestRun={latestRuns[a.name]}
            history={history[a.name] || []}
            metricLabel={a.metricLabel}
            metricValue={statValue(latestRuns[a.name], a.statKey)}
            openQuestions={questionsByAgent[a.name] || []}
          />
        ))}
      </div>

      <h2 style={sectionTitle}>Deze week</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
        <div style={WEEK_CELL}>
          <div style={statNumber}>{weekStats.runs}</div>
          <div style={statLabel}>runs</div>
        </div>
        <div style={WEEK_CELL}>
          <div style={statNumber}>{weekStats.drafts}</div>
          <div style={statLabel}>drafts geschreven</div>
        </div>
        <div style={WEEK_CELL}>
          <div style={statNumber}>{weekStats.connects}</div>
          <div style={statLabel}>connects verstuurd</div>
        </div>
        <div style={WEEK_CELL}>
          <div style={statNumber}>{weekStats.deals}</div>
          <div style={statLabel}>HubSpot deal-updates</div>
        </div>
      </div>

      {linkedin && linkedin.length > 0 && (
        <>
          <h2 style={sectionTitle}>LinkedIn voortgang</h2>
          <div style={{ background: '#2B2B2B', border: '1px solid #383838', borderRadius: 6, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#1E1E1E', color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  <th style={th}>Week</th>
                  <th style={th}>Kantoor</th>
                  <th style={th}>Fase</th>
                  <th style={{ ...th, textAlign: 'right' }}>Verstuurd</th>
                  <th style={{ ...th, textAlign: 'right' }}>Pending</th>
                  <th style={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {linkedin.slice(0, 15).map(r => (
                  <tr key={`${r.year}-${r.week_number}-${r.company_name}`} style={{ borderTop: '1px solid #383838' }}>
                    <td style={td}>{r.week_number}</td>
                    <td style={{ ...td, color: '#E0E0E0' }}>{r.company_name}</td>
                    <td style={td}>{r.pipeline_stage}</td>
                    <td style={{ ...td, textAlign: 'right', color: '#E86832' }}>{r.connects_sent}</td>
                    <td style={{ ...td, textAlign: 'right' }}>{r.connects_pending ?? 0}</td>
                    <td style={td}>{r.batch_completed ? '✓ afgerond' : 'lopend'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 style={sectionTitle}>Roadmap</h2>
      <div style={{ background: '#2B2B2B', border: '1px solid #383838', borderRadius: 6, padding: '18px 22px' }}>
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#bbb', lineHeight: 2 }}>
          <li>Agents draaiend + Slack-integratie — <span style={{ color: '#4caf50' }}>afgerond</span></li>
          <li>Supabase centrale state + run-logging — <span style={{ color: '#4caf50' }}>afgerond</span></li>
          <li>Agent-manager + feedback-loop — <span style={{ color: '#4caf50' }}>afgerond</span></li>
          <li>Dashboard (HTML on-demand) — <span style={{ color: '#4caf50' }}>afgerond</span></li>
          <li>Dashboard live op Vercel (React + auto-deploy) — <span style={{ color: '#E86832' }}>nu</span></li>
        </ol>
      </div>
    </div>
  )
}

const sectionTitle = { color: '#E0E0E0', fontWeight: 400, fontSize: 15, letterSpacing: '0.3px', margin: '32px 0 14px', textTransform: 'uppercase' }
const statNumber = { fontSize: 34, fontWeight: 300, color: '#E86832', lineHeight: 1 }
const statLabel = { fontSize: 12, color: '#888', marginTop: 8 }
const th = { textAlign: 'left', padding: '10px 14px', fontWeight: 500 }
const td = { padding: '10px 14px', color: '#bbb' }
