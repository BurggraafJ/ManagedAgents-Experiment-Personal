import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

// Truth of Sources — Outlook, HubSpot, Jira als drie pijlers waarop de agents
// draaien. Compacte kaartjes (laatste run + status), klik "Details →" voor de
// volledige breakdown in een popup. Auto-refresh per 30s.

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

// Pak de meest recente van twee timestamps (delta wint typisch van full).
function tsMax(a, b) {
  if (!a) return b || null
  if (!b) return a
  return new Date(a) > new Date(b) ? a : b
}

function healthFor(lastSyncIso, lastError, expectedFreshnessMin) {
  if (lastError) return { tag: 's-error', label: 'error' }
  if (!lastSyncIso) return { tag: 's-warning', label: 'nooit' }
  const ageMin = (Date.now() - new Date(lastSyncIso).getTime()) / 60_000
  if (ageMin < expectedFreshnessMin) return { tag: 's-success', label: 'live' }
  if (ageMin < expectedFreshnessMin * 5) return { tag: 's-warning', label: 'verlaat' }
  return { tag: 's-error', label: 'stale' }
}

function fmtNum(n) {
  if (n === null || n === undefined) return '–'
  return n.toLocaleString('nl-NL')
}

function pct(part, total) {
  if (!total) return null
  return Math.round((part / total) * 1000) / 10
}

function VectorBar({ embedded, total }) {
  const p = pct(embedded, total)
  if (p === null) return <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>–</div>
  const tone = p >= 99 ? 's-success' : p >= 80 ? 's-warning' : 's-error'
  const color = p >= 99 ? 'var(--success, #16a34a)' : p >= 80 ? 'var(--warning, #d97706)' : 'var(--error, #d9534f)'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
        <span style={{ color: 'var(--text-muted)' }}>{fmtNum(embedded)} / {fmtNum(total)}</span>
        <span className={`status-pill ${tone}`} style={{ padding: '1px 8px', fontSize: 11 }}>{p}%</span>
      </div>
      <div style={{ height: 4, background: 'var(--bg-2)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${p}%`, height: '100%', background: color, transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

function StatRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)' }}>{value}</span>
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <div className="kpi__label" style={{ fontSize: 11, marginTop: 'var(--s-3)', marginBottom: 4, paddingBottom: 4, borderBottom: '1px solid var(--border)' }}>
      {children}
    </div>
  )
}

// ============================================================
// Compacte kaart — toont alleen het essentiële (status + laatste run)
// ============================================================
function SourceCardCompact({ title, total, totalLabel, health, lastSyncIso, runAgent, runStatus, errorMsg, onOpen }) {
  return (
    <div
      className="card"
      style={{
        display: 'flex', flexDirection: 'column', gap: 'var(--s-3)',
        padding: 'var(--s-5)', cursor: 'pointer', transition: 'border-color 0.15s, transform 0.15s',
      }}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
      role="button"
      tabIndex={0}
    >
      {/* Header: titel + health */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{title}</span>
        {health && (
          <span className={`status-pill ${health.tag}`} title={health.title}>
            {health.label}
          </span>
        )}
      </div>

      {/* Big number + label */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontSize: 24, fontWeight: 600 }}>{fmtNum(total)}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{totalLabel}</div>
      </div>

      {/* Laatste run-regel */}
      <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div>
          Laatste sync: <span style={{ color: 'var(--text)' }}>{relTime(lastSyncIso)}</span>
        </div>
        {runAgent && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
            via {runAgent}
            {runStatus && <span style={{ marginLeft: 6, color: runStatus === 'error' ? 'var(--error)' : runStatus === 'warning' ? 'var(--warning)' : 'var(--success)' }}>· {runStatus}</span>}
          </div>
        )}
      </div>

      {/* Inline error pas tonen als kort, anders alleen indicator */}
      {errorMsg && (
        <div style={{ fontSize: 11, color: 'var(--error)', padding: 6, background: 'var(--error-bg, #fef2f2)', borderRadius: 4 }}>
          {errorMsg.length > 80 ? errorMsg.slice(0, 80) + '…' : errorMsg}
        </div>
      )}

      {/* Show-more knop */}
      <button
        type="button"
        className="btn btn--ghost"
        onClick={(e) => { e.stopPropagation(); onOpen() }}
        style={{ marginTop: 'auto', alignSelf: 'flex-start', padding: '4px 0', fontSize: 12 }}
      >
        Details →
      </button>
    </div>
  )
}

// ============================================================
// Popup — alle detail-info per bron
// ============================================================
function SourceDetailPopup({ source, data, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const d = data
  let body = null
  let headerTitle = ''
  let headerSubtitle = ''

  if (source === 'mail') {
    headerTitle = 'Outlook'
    headerSubtitle = 'mail-sync (delta elke 5 min) + mail-backfill (12 mnd terug)'
    body = (
      <>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: 28, fontWeight: 600 }}>{fmtNum(d.mail.total)}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>messages</div>
        </div>

        <SectionLabel>Sync</SectionLabel>
        <StatRow label="Laatste delta" value={relTime(d.mail.lastDelta)} />
        <StatRow label="Folders tracked" value={fmtNum(d.mail.foldersTracked)} />
        <StatRow label="Backfill voortgang" value={`${d.mail.backfill.percent}% (${fmtNum(d.mail.backfill.completedBuckets)}/${fmtNum(d.mail.backfill.totalBuckets)} buckets)`} />
        {d.mail.backfill.byStatus.in_progress > 0 && (
          <StatRow label="Backfill nu actief" value={fmtNum(d.mail.backfill.byStatus.in_progress)} />
        )}
        {d.mail.backfill.byStatus.error > 0 && (
          <StatRow label="Backfill errors" value={fmtNum(d.mail.backfill.byStatus.error)} />
        )}

        <SectionLabel>Vectorisatie</SectionLabel>
        <VectorBar embedded={d.mail.embedded} total={d.mail.total} />
        <StatRow label="Model" value={d.embed.model} />
        <StatRow label="Laatste embed-run" value={d.embed.lastRun ? relTime(d.embed.lastRun.started_at) : 'nooit'} />
        <StatRow label="Embed-runs (7d)" value={fmtNum(d.embed.runs7d)} />
        <StatRow label="Tokens (7d)" value={`${fmtNum(d.embed.tokens7d)} (≈ $${(d.embed.tokens7d / 1_000_000 * 0.02).toFixed(4)})`} />
      </>
    )
  } else if (source === 'hubspot') {
    headerTitle = 'HubSpot'
    headerSubtitle = 'hubspot-sync (CRM, elke 30 min) + hubspot-engagements-sync (calls/mails/notes, elk uur)'
    body = (
      <>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: 28, fontWeight: 600 }}>
            {fmtNum((d.hubspot.deals || 0) + (d.hubspot.companies || 0) + (d.hubspot.contacts || 0) + (d.hubspot.engagements.total || 0))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>records totaal</div>
        </div>

        <SectionLabel>CRM-objecten</SectionLabel>
        <StatRow label="Deals" value={fmtNum(d.hubspot.deals)} />
        <StatRow label="Companies" value={fmtNum(d.hubspot.companies)} />
        <StatRow label="Contacts" value={fmtNum(d.hubspot.contacts)} />
        <StatRow label="Owners" value={fmtNum(d.hubspot.state?.total_owners)} />
        <StatRow label="Pipelines" value={fmtNum(d.hubspot.state?.total_pipelines)} />
        <StatRow label="Laatste delta sync" value={d.hubspot.state?.last_delta_sync ? relTime(d.hubspot.state.last_delta_sync) : '–'} />
        <StatRow label="Laatste full sync" value={d.hubspot.state?.last_full_sync ? relTime(d.hubspot.state.last_full_sync) : '–'} />

        <SectionLabel>Engagements</SectionLabel>
        <StatRow label="Totaal" value={fmtNum(d.hubspot.engagements.total)} />
        <StatRow label="Calls" value={fmtNum(d.hubspot.engagements.byType.call || 0)} />
        <StatRow label="Emails" value={fmtNum(d.hubspot.engagements.byType.email || 0)} />
        <StatRow label="Meetings" value={fmtNum(d.hubspot.engagements.byType.meeting || 0)} />
        <StatRow label="Notes" value={fmtNum(d.hubspot.engagements.byType.note || 0)} />
        <StatRow label="Tasks" value={fmtNum(d.hubspot.engagements.byType.task || 0)} />
        <StatRow label="Laatste eng-sync" value={relTime(d.hubspot.engagements.lastSync)} />

        <SectionLabel>Vectorisatie — engagements</SectionLabel>
        <VectorBar embedded={d.hubspot.engagements.embedded} total={d.hubspot.engagements.total} />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontStyle: 'italic' }}>
          Deals/companies/contacts nog niet geïndexeerd — wel op roadmap.
        </div>
      </>
    )
  } else if (source === 'jira') {
    headerTitle = 'Jira'
    headerSubtitle = 'jira-sync (full elke 24u, delta elk uur) — Sales/Management/Recruitment/Partnerships'
    body = (
      <>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: 28, fontWeight: 600 }}>{fmtNum(d.jira.issues)}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>issues over {fmtNum(d.jira.projects)} projecten</div>
        </div>

        <SectionLabel>Sync</SectionLabel>
        <StatRow label="Laatste delta sync" value={d.jira.state?.last_delta_sync ? relTime(d.jira.state.last_delta_sync) : '–'} />
        <StatRow label="Laatste full sync" value={d.jira.state?.last_full_sync ? relTime(d.jira.state.last_full_sync) : '–'} />

        <SectionLabel>Vectorisatie</SectionLabel>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0' }}>
          <span className="status-pill s-idle" style={{ padding: '1px 8px', fontSize: 11 }}>nog niet</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Issues/comments krijgen straks ook embeddings — staat op roadmap.
          </span>
        </div>
      </>
    )
  }

  return (
    <div
      className="agent-settings-popup__overlay"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, zIndex: 1000,
      }}
    >
      <div
        className="card"
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 560, padding: 0, maxHeight: '90vh', overflow: 'auto' }}
      >
        <header style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{headerTitle}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{headerSubtitle}</div>
          </div>
          <button className="btn btn--ghost" onClick={onClose} aria-label="Sluiten" style={{ fontSize: 18 }}>×</button>
        </header>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}>
          {body}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Hoofdcomponent
// ============================================================
export default function TruthOfSourcesView() {
  const [state, setState] = useState({ loading: true, error: null, data: null })
  const [openPopup, setOpenPopup] = useState(null) // 'mail' | 'hubspot' | 'jira' | null

  const fetchAll = useCallback(async () => {
    try {
      const [
        mailMessages, mailMessagesEmbedded, mailSyncState, mailBackfillState,
        hsState, hsEngagementsState,
        hsDeals, hsCompanies, hsContacts, hsEngagements, hsEngagementsEmbedded, hsEngagementsByType,
        jiraState, jiraIssues, jiraProjects,
        recentRuns, mailEmbedRun,
      ] = await Promise.all([
        supabase.from('mail_messages').select('*', { count: 'exact', head: true }),
        supabase.from('mail_messages').select('*', { count: 'exact', head: true }).not('embedding', 'is', null),
        supabase.from('mail_sync_state').select('folder_id,last_delta_at,last_full_scan_at,last_error,total_messages_synced'),
        supabase.from('mail_backfill_state').select('status,messages_fetched,last_run_at,last_error'),
        supabase.from('hubspot_sync_state').select('*').eq('id', 1).maybeSingle(),
        supabase.from('hubspot_engagements_sync_state').select('*'),
        supabase.from('hubspot_deals').select('*', { count: 'exact', head: true }),
        supabase.from('hubspot_companies').select('*', { count: 'exact', head: true }),
        supabase.from('hubspot_contacts').select('*', { count: 'exact', head: true }),
        supabase.from('hubspot_engagements').select('*', { count: 'exact', head: true }),
        supabase.from('hubspot_engagements').select('*', { count: 'exact', head: true }).not('embedding', 'is', null),
        supabase.from('hubspot_engagements').select('engagement_type'),
        supabase.from('jira_sync_state').select('*').eq('id', 1).maybeSingle(),
        supabase.from('jira_issues').select('*', { count: 'exact', head: true }),
        supabase.from('jira_projects').select('*', { count: 'exact', head: true }),
        supabase.from('agent_runs')
          .select('agent_name,status,summary,started_at,completed_at,errors,stats')
          .in('agent_name', ['mail-sync', 'mail-backfill', 'hubspot-sync', 'hubspot-engagements-sync', 'jira-sync', 'mail-embed'])
          .order('started_at', { ascending: false })
          .limit(80),
        supabase.from('agent_runs')
          .select('started_at,status,summary,stats')
          .eq('agent_name', 'mail-embed')
          .gte('started_at', new Date(Date.now() - 7 * 86400_000).toISOString())
          .order('started_at', { ascending: false }),
      ])

      const engagementsByType = {}
      for (const row of (hsEngagementsByType.data || [])) {
        engagementsByType[row.engagement_type] = (engagementsByType[row.engagement_type] || 0) + 1
      }

      const backfillByStatus = { pending: 0, in_progress: 0, done: 0, empty: 0, error: 0 }
      const backfillRows = mailBackfillState.data || []
      for (const r of backfillRows) backfillByStatus[r.status] = (backfillByStatus[r.status] || 0) + 1
      const totalBuckets = backfillRows.length
      const completedBuckets = backfillByStatus.done + backfillByStatus.empty

      const latestByAgent = {}
      for (const r of (recentRuns.data || [])) {
        if (!latestByAgent[r.agent_name]) latestByAgent[r.agent_name] = r
      }

      const mailEmbedRuns = mailEmbedRun.data || []
      const embedTokens7d = mailEmbedRuns.reduce((sum, r) => sum + (Number(r.stats?.total_tokens) || 0), 0)
      const embedRuns7d = mailEmbedRuns.length
      const lastEmbed = mailEmbedRuns[0]

      const mailSyncRows = mailSyncState.data || []
      const newestDelta = mailSyncRows.reduce((acc, r) => {
        if (!r.last_delta_at) return acc
        return !acc || r.last_delta_at > acc ? r.last_delta_at : acc
      }, null)
      const mailSyncErrors = mailSyncRows.filter((r) => r.last_error).map((r) => r.last_error)

      const engStateRows = hsEngagementsState.data || []
      const newestEngSync = engStateRows.reduce((acc, r) => {
        const t = r.last_full_sync || r.last_delta_sync
        if (!t) return acc
        return !acc || t > acc ? t : acc
      }, null)
      const engErrors = engStateRows.filter((r) => r.last_error).map((r) => r.last_error)

      setState({
        loading: false, error: null,
        data: {
          mail: {
            total: mailMessages.count, embedded: mailMessagesEmbedded.count,
            lastDelta: newestDelta,
            errors: mailSyncErrors,
            foldersTracked: mailSyncRows.length,
            backfill: {
              byStatus: backfillByStatus, totalBuckets, completedBuckets,
              percent: totalBuckets > 0 ? Math.round((completedBuckets / totalBuckets) * 100) : 0,
            },
          },
          hubspot: {
            state: hsState.data,
            deals: hsDeals.count, companies: hsCompanies.count, contacts: hsContacts.count,
            engagements: { total: hsEngagements.count, embedded: hsEngagementsEmbedded.count, byType: engagementsByType, lastSync: newestEngSync, errors: engErrors },
          },
          jira: {
            state: jiraState.data, issues: jiraIssues.count, projects: jiraProjects.count,
          },
          embed: {
            tokens7d: embedTokens7d, runs7d: embedRuns7d, lastRun: lastEmbed,
            model: lastEmbed?.stats?.model || 'text-embedding-3-small',
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
    fetchAll()
    const id = setInterval(fetchAll, REFRESH_MS)
    return () => clearInterval(id)
  }, [fetchAll])

  if (state.loading && !state.data) return <div className="skeleton" style={{ height: 200 }} />
  if (state.error) return <div className="card">Fout bij laden: {state.error}</div>

  const d = state.data

  // Mail health: gebruikt mail_sync_state.last_delta_at (5min cadence)
  const mailHealth = healthFor(d.mail.lastDelta, d.mail.errors[0], 10)
  mailHealth.title = `Last delta: ${relTime(d.mail.lastDelta)}`
  const mailRun = d.latestByAgent['mail-sync']

  // HubSpot health: bug-fix — gebruik de meest recente van delta+full
  // (delta draait elke 30 min, full elke 24u). Eerder pakte de code full eerst,
  // wat altijd ~1 dag oud is en daardoor 'stale' toonde.
  const hsCoreLastSync = tsMax(d.hubspot.state?.last_delta_sync, d.hubspot.state?.last_full_sync)
  const hsHealth = healthFor(hsCoreLastSync, d.hubspot.state?.last_error, 45)
  hsHealth.title = `Last sync: ${relTime(hsCoreLastSync)}`
  const hsRun = d.latestByAgent['hubspot-sync']

  // Jira: zelfde fix — delta is recenter dan full
  const jiraLastSync = tsMax(d.jira.state?.last_delta_sync, d.jira.state?.last_full_sync)
  const jiraHealth = healthFor(jiraLastSync, d.jira.state?.last_error, 75)
  jiraHealth.title = `Last sync: ${relTime(jiraLastSync)}`
  const jiraRun = d.latestByAgent['jira-sync']

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <section>
        <div className="section__head">
          <h2 className="section__title">Drie sources of truth</h2>
          <span className="section__hint">
            Auto-refresh per 30s · Laatst: {d.fetchedAt.toLocaleTimeString('nl-NL')}
          </span>
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--s-4)' }}>
          <SourceCardCompact
            title="Outlook"
            total={d.mail.total}
            totalLabel="messages"
            health={mailHealth}
            lastSyncIso={d.mail.lastDelta}
            runAgent={mailRun?.agent_name || 'mail-sync'}
            runStatus={mailRun?.status}
            errorMsg={d.mail.errors[0]}
            onOpen={() => setOpenPopup('mail')}
          />

          <SourceCardCompact
            title="HubSpot"
            total={(d.hubspot.deals || 0) + (d.hubspot.companies || 0) + (d.hubspot.contacts || 0) + (d.hubspot.engagements.total || 0)}
            totalLabel="records"
            health={hsHealth}
            lastSyncIso={hsCoreLastSync}
            runAgent={hsRun?.agent_name || 'hubspot-sync'}
            runStatus={hsRun?.status}
            errorMsg={d.hubspot.state?.last_error || d.hubspot.engagements.errors[0]}
            onOpen={() => setOpenPopup('hubspot')}
          />

          <SourceCardCompact
            title="Jira"
            total={d.jira.issues}
            totalLabel={`issues / ${fmtNum(d.jira.projects)} projecten`}
            health={jiraHealth}
            lastSyncIso={jiraLastSync}
            runAgent={jiraRun?.agent_name || 'jira-sync'}
            runStatus={jiraRun?.status}
            errorMsg={d.jira.state?.last_error}
            onOpen={() => setOpenPopup('jira')}
          />
        </div>
      </section>

      {openPopup && (
        <SourceDetailPopup source={openPopup} data={d} onClose={() => setOpenPopup(null)} />
      )}
    </div>
  )
}
