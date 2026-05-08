import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useSupabaseQuery } from '../../../hooks/useSupabaseQuery'
import { summarizeFindings } from '../../../lib/severity'
import SecuritySummary from './SecuritySummary'
import SecurityTabs from './SecurityTabs'
import FindingsList from './FindingsList'
import ScanLogsList from './ScanLogsList'
import styles from './SecurityView.module.css'

/**
 * SecurityView — open security-bevindingen + scan-logs van de security-monitor agent.
 *
 * Refactor 17 (Golf D): container <200 LOC. Sub-views in deze folder, severity-helpers
 * in lib/severity.js, datum-helpers in lib/dateFormat.js, tabel-styling in module.css.
 *
 * Auto-refresh elke 90s — security-views moeten redelijk fris zijn.
 */
export default function SecurityView() {
  const [tab, setTab] = useState('open')              // 'open' | 'all' | 'resolved' | 'logs'
  const [updatingId, setUpdatingId] = useState(null)
  const [overrides, setOverrides] = useState({})      // optimistic updates: id → patch

  const findingsQ = useSupabaseQuery('security_findings', {
    orderBy: ['found_at', { ascending: false }],
    limit: 300,
    initialData: null,
  })
  const scanLogsQ = useSupabaseQuery('agent_runs', {
    select: 'id,completed_at,started_at,status,summary,stats',
    filters: { agent_name: 'security-monitor' },
    orderBy: ['completed_at', { ascending: false }],
    limit: 30,
    initialData: null,
  })

  // Auto-refresh elke 90s — beide views.
  useEffect(() => {
    const id = setInterval(() => {
      findingsQ.refresh()
      scanLogsQ.refresh()
    }, 90_000)
    return () => clearInterval(id)
  }, [findingsQ.refresh, scanLogsQ.refresh])

  // Optimistic-update overlay zodat klikken snel reageert.
  const findings = useMemo(() => {
    if (!findingsQ.data) return null
    const has = Object.keys(overrides).length > 0
    return has
      ? findingsQ.data.map(f => overrides[f.id] ? { ...f, ...overrides[f.id] } : f)
      : findingsQ.data
  }, [findingsQ.data, overrides])

  async function updateStatus(id, newStatus) {
    setUpdatingId(id)
    const patch = { status: newStatus }
    if (newStatus === 'resolved') patch.resolved_at = new Date().toISOString()
    setOverrides(prev => ({ ...prev, [id]: patch }))
    const { error } = await supabase.from('security_findings').update(patch).eq('id', id)
    if (error) {
      // Rollback bij fout
      setOverrides(prev => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
    setUpdatingId(null)
  }

  if (findingsQ.error) {
    return <div className={`card ${styles.errorBanner}`}>Fout: {findingsQ.error}</div>
  }

  if (!findings) {
    return (
      <div className="stack" style={{ gap: 'var(--s-5)' }}>
        <div className="skeleton" style={{ height: 90 }} />
        <div className="skeleton" style={{ height: 48 }} />
        <div className="skeleton" style={{ height: 320 }} />
      </div>
    )
  }

  const summary = summarizeFindings(findings)
  const scanLogs = scanLogsQ.data || []
  const lastScan = scanLogs[0] || null
  const lastWeeklyScan = scanLogs.find(r => r.stats?.mode === 'weekly_scan') || null
  const openCount = summary.critical + summary.high + summary.medium + summary.low

  // Filter findings op tab — open | all | resolved
  let tabFindings = findings
  if (tab === 'open') tabFindings = findings.filter(f => f.status === 'open')
  else if (tab === 'resolved') tabFindings = findings.filter(f => f.status !== 'open')

  return (
    <div className="stack" style={{ gap: 'var(--s-6)' }}>
      <SecuritySummary
        summary={summary}
        lastScan={lastScan}
        lastWeeklyScan={lastWeeklyScan}
        refreshing={findingsQ.loading}
        onRefresh={() => { findingsQ.refresh(); scanLogsQ.refresh() }}
      />

      <SecurityTabs
        tab={tab}
        onChange={setTab}
        counts={{
          open:     openCount,
          total:    summary.total,
          resolved: summary.resolved + summary.accepted,
          logs:     scanLogs.length,
        }}
      />

      {tab !== 'logs' ? (
        <FindingsList
          findings={tabFindings}
          allFindings={findings}
          tab={tab}
          updatingId={updatingId}
          onUpdateStatus={updateStatus}
        />
      ) : (
        <ScanLogsList logs={scanLogs} />
      )}

      <div className={styles.footer}>
        Bron: <code>security_findings</code> + <code>agent_runs</code> (agent <code>security-monitor</code>).
        Schedule: ma–do 07:00 daily monitor · vrijdag 07:00 weekly deep scan. Auto-refresh 90s.
      </div>
    </div>
  )
}
