import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

// Live-overzicht van alle "truth of sources" — Mail / HubSpot / Jira mirrors.
// Toont per bron: total records, laatste sync, health-status, errors.
// Auto-refresh elke 30s.

const REFRESH_MS = 30_000

function relTime(iso) {
  if (!iso) return 'nooit'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min geleden`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}u geleden`
  const day = Math.floor(hr / 24)
  return `${day}d geleden`
}

function healthFor(lastSyncIso, lastError, expectedFreshnessMin) {
  if (lastError) return { tag: 's-error', label: 'error', dot: '🔴' }
  if (!lastSyncIso) return { tag: 's-warning', label: 'nooit', dot: '🟡' }
  const ageMin = (Date.now() - new Date(lastSyncIso).getTime()) / 60_000
  if (ageMin < expectedFreshnessMin) return { tag: 's-success', label: 'live', dot: '🟢' }
  if (ageMin < expectedFreshnessMin * 5) return { tag: 's-warning', label: 'verlaat', dot: '🟡' }
  return { tag: 's-error', label: 'stale', dot: '🔴' }
}

function fmtNum(n) {
  if (n === null || n === undefined) return '–'
  return n.toLocaleString('nl-NL')
}

function SourceCard({ title, subtitle, total, lastSync, syncMode, freshnessMin, error, breakdown, lastRunSummary }) {
  const health = healthFor(lastSync, error, freshnessMin)
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div className="kpi__label" style={{ fontSize: 11 }}>{title}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>
        </div>
        <span className={`status-pill ${health.tag}`} title={`Last sync: ${relTime(lastSync)}`}>
          {health.dot} {health.label}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div className="kpi__value" style={{ fontSize: 28, fontWeight: 600 }}>{fmtNum(total)}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>records</div>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        Last sync: <span style={{ color: 'var(--text)' }}>{relTime(lastSync)}</span>
        {syncMode && <> · {syncMode}</>}
      </div>

      {breakdown && breakdown.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
          {breakdown.map((b, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: 'var(--text-muted)' }}>{b.label}</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtNum(b.value)}</span>
            </div>
          ))}
        </div>
      )}

      {lastRunSummary && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', borderLeft: '2px solid var(--border)', paddingLeft: 8 }}>
          {lastRunSummary}
        </div>
      )}

      {error && (
        <div style={{ fontSize: 11, color: 'var(--error)', padding: 8, background: 'var(--error-bg, #fef2f2)', borderRadius: 6 }}>
          {error.length > 200 ? error.slice(0, 200) + '…' : error}
        </div>
      )}
    </div>
  )
}

export default function TruthOfSourcesView() {
  const [state, setState] = useState({ loading: true, error: null, data: null })

  const fetch = useCallback(async () => {
    try {
      const [
        mailMessages, mailSyncState, mailBackfillState,
        hsState, hsEngagementsState, hsDeals, hsCompanies, hsContacts, hsEngagements,
        jiraState, jiraIssues, jiraProjects,
        recentRuns,
      ] = await Promise.all([
        supabase.from('mail_messages').select('*', { count: 'exact', head: true }),
        supabase.from('mail_sync_state').select('folder_id,last_delta_at,last_full_scan_at,last_error,total_messages_synced'),
        supabase.from('mail_backfill_state').select('status,messages_fetched,last_run_at,last_error'),
        supabase.from('hubspot_sync_state').select('*').eq('id', 1).maybeSingle(),
        supabase.from('hubspot_engagements_sync_state').select('*'),
        supabase.from('hubspot_deals').select('*', { count: 'exact', head: true }),
        supabase.from('hubspot_companies').select('*', { count: 'exact', head: true }),
        supabase.from('hubspot_contacts').select('*', { count: 'exact', head: true }),
        supabase.from('hubspot_engagements').select('engagement_type', { count: 'exact' }),
        supabase.from('jira_sync_state').select('*').eq('id', 1).maybeSingle(),
        supabase.from('jira_issues').select('*', { count: 'exact', head: true }),
        supabase.from('jira_projects').select('*', { count: 'exact', head: true }),
        supabase.from('agent_runs')
          .select('agent_name,status,summary,started_at,completed_at,errors')
          .in('agent_name', ['mail-sync', 'mail-backfill', 'hubspot-sync', 'hubspot-engagements-sync', 'jira-sync'])
          .order('started_at', { ascending: false })
          .limit(50),
      ])

      // Engagements per type
      const engagementsByType = {}
      for (const row of (hsEngagements.data || [])) {
        engagementsByType[row.engagement_type] = (engagementsByType[row.engagement_type] || 0) + 1
      }

      // Mail backfill aggregates
      const backfillByStatus = { pending: 0, in_progress: 0, done: 0, empty: 0, error: 0 }
      const backfillRows = mailBackfillState.data || []
      for (const r of backfillRows) backfillByStatus[r.status] = (backfillByStatus[r.status] || 0) + 1
      const totalBuckets = backfillRows.length
      const completedBuckets = backfillByStatus.done + backfillByStatus.empty

      // Latest run per agent
      const latestByAgent = {}
      for (const r of (recentRuns.data || [])) {
        if (!latestByAgent[r.agent_name]) latestByAgent[r.agent_name] = r
      }

      // Mail sync state aggregate (live heartbeat)
      const mailSyncRows = mailSyncState.data || []
      const newestDelta = mailSyncRows.reduce((acc, r) => {
        if (!r.last_delta_at) return acc
        return !acc || r.last_delta_at > acc ? r.last_delta_at : acc
      }, null)
      const mailSyncErrors = mailSyncRows.filter((r) => r.last_error).map((r) => r.last_error)

      setState({
        loading: false,
        error: null,
        data: {
          mailTotal: mailMessages.count,
          mailSync: { lastDelta: newestDelta, errors: mailSyncErrors, foldersTracked: mailSyncRows.length },
          mailBackfill: {
            byStatus: backfillByStatus, totalBuckets, completedBuckets,
            done: completedBuckets, percent: totalBuckets > 0 ? Math.round((completedBuckets / totalBuckets) * 100) : 0,
          },
          hubspot: {
            state: hsState.data,
            deals: hsDeals.count, companies: hsCompanies.count, contacts: hsContacts.count,
          },
          hubspotEngagements: {
            stateRows: hsEngagementsState.data || [],
            total: hsEngagements.count, byType: engagementsByType,
          },
          jira: {
            state: jiraState.data,
            issues: jiraIssues.count, projects: jiraProjects.count,
          },
          latestByAgent,
          fetchedAt: new Date(),
        },
      })
    } catch (err) {
      setState({ loading: false, error: err.message, data: null })
    }
  }, [])

  useEffect(() => {
    fetch()
    const id = setInterval(fetch, REFRESH_MS)
    return () => clearInterval(id)
  }, [fetch])

  if (state.loading && !state.data) {
    return <div className="skeleton" style={{ height: 400 }} />
  }
  if (state.error) {
    return <div className="card">Fout bij laden: {state.error}</div>
  }

  const d = state.data
  const mailBackfillSummary = d.mailBackfill.totalBuckets > 0
    ? `Backfill ${d.mailBackfill.percent}% (${d.mailBackfill.done}/${d.mailBackfill.totalBuckets} buckets)`
    : null
  const mailLatestRun = d.latestByAgent['mail-sync'] || d.latestByAgent['mail-backfill']

  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>
      <section>
        <div className="section__head">
          <h2 className="section__title">Truth of Sources</h2>
          <span className="section__hint">
            Auto-refresh per 30s · Laatst: {d.fetchedAt.toLocaleTimeString('nl-NL')}
          </span>
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 'var(--s-5)' }}>

          {/* Mail */}
          <SourceCard
            title="📬 Mail (Outlook)"
            subtitle="mail_messages — live heartbeat + 12-mnd backfill"
            total={d.mailTotal}
            lastSync={d.mailSync.lastDelta}
            syncMode="live every 5min"
            freshnessMin={10}
            error={d.mailSync.errors.length > 0 ? d.mailSync.errors[0] : null}
            breakdown={[
              { label: 'Folders tracked', value: d.mailSync.foldersTracked },
              { label: 'Backfill done', value: d.mailBackfill.byStatus.done },
              { label: 'Backfill empty', value: d.mailBackfill.byStatus.empty },
              { label: 'Backfill pending', value: d.mailBackfill.byStatus.pending },
              { label: 'Backfill in progress', value: d.mailBackfill.byStatus.in_progress },
              ...(d.mailBackfill.byStatus.error > 0 ? [{ label: '⚠ Backfill errors', value: d.mailBackfill.byStatus.error }] : []),
            ]}
            lastRunSummary={mailBackfillSummary || mailLatestRun?.summary}
          />

          {/* HubSpot Core */}
          <SourceCard
            title="🏢 HubSpot Core"
            subtitle="deals + companies + contacts (hubspot-sync-etl)"
            total={(d.hubspot.deals || 0) + (d.hubspot.companies || 0) + (d.hubspot.contacts || 0)}
            lastSync={d.hubspot.state?.last_full_sync || d.hubspot.state?.last_delta_sync}
            syncMode={`full elke 24u, delta elke 30min`}
            freshnessMin={45}
            error={d.hubspot.state?.last_error}
            breakdown={[
              { label: 'Deals', value: d.hubspot.deals },
              { label: 'Companies', value: d.hubspot.companies },
              { label: 'Contacts', value: d.hubspot.contacts },
              { label: 'Owners', value: d.hubspot.state?.total_owners },
              { label: 'Pipelines', value: d.hubspot.state?.total_pipelines },
            ]}
            lastRunSummary={d.latestByAgent['hubspot-sync']?.summary}
          />

          {/* HubSpot Engagements */}
          <SourceCard
            title="💬 HubSpot Engagements"
            subtitle="calls / emails / meetings / notes / tasks"
            total={d.hubspotEngagements.total}
            lastSync={
              d.hubspotEngagements.stateRows.reduce((acc, r) => {
                const t = r.last_full_sync || r.last_delta_sync
                if (!t) return acc
                return !acc || t > acc ? t : acc
              }, null)
            }
            syncMode="elke uur"
            freshnessMin={75}
            error={
              d.hubspotEngagements.stateRows.find((r) => r.last_error)?.last_error
            }
            breakdown={[
              { label: 'Calls', value: d.hubspotEngagements.byType.call || 0 },
              { label: 'Emails', value: d.hubspotEngagements.byType.email || 0 },
              { label: 'Meetings', value: d.hubspotEngagements.byType.meeting || 0 },
              { label: 'Notes', value: d.hubspotEngagements.byType.note || 0 },
              { label: 'Tasks', value: d.hubspotEngagements.byType.task || 0 },
            ]}
            lastRunSummary={d.latestByAgent['hubspot-engagements-sync']?.summary}
          />

          {/* Jira */}
          <SourceCard
            title="🎫 Jira"
            subtitle={`${d.jira.projects} projecten — issues mirror`}
            total={d.jira.issues}
            lastSync={d.jira.state?.last_full_sync || d.jira.state?.last_delta_sync}
            syncMode="full elke 24u, delta elke uur"
            freshnessMin={75}
            error={d.jira.state?.last_error}
            breakdown={[
              { label: 'Total issues', value: d.jira.issues },
              { label: 'Projects', value: d.jira.projects },
              { label: 'Last full sync', value: d.jira.state?.last_full_sync ? relTime(d.jira.state.last_full_sync) : '–' },
            ]}
            lastRunSummary={d.latestByAgent['jira-sync']?.summary}
          />
        </div>
      </section>

      {/* Recente runs */}
      <section>
        <div className="section__head">
          <h2 className="section__title">Recente sync-runs</h2>
          <span className="section__hint">laatste per agent</span>
        </div>
        <div className="card" style={{ padding: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                <th style={{ padding: 12 }}>Agent</th>
                <th style={{ padding: 12 }}>Status</th>
                <th style={{ padding: 12 }}>Tijd</th>
                <th style={{ padding: 12 }}>Summary</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(d.latestByAgent).map(([agent, run]) => (
                <tr key={agent} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 12, fontWeight: 500 }}>{agent}</td>
                  <td style={{ padding: 12 }}>
                    <span className={`status-pill ${
                      run.status === 'success' ? 's-success' :
                      run.status === 'warning' ? 's-warning' :
                      run.status === 'error' ? 's-error' : 's-idle'
                    }`}>
                      {run.status}
                    </span>
                  </td>
                  <td style={{ padding: 12, color: 'var(--text-muted)' }}>{relTime(run.started_at)}</td>
                  <td style={{ padding: 12, color: 'var(--text-muted)', fontSize: 12 }}>
                    {run.summary || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
