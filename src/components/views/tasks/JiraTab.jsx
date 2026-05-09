import { useState, useMemo } from 'react'
import { JIRA_BOARD_COLOR, formatDate } from '../../../lib/tasks'
import styles from './tasks.module.css'

const JIRA_ACTIVE_STATUSES = new Set([
  'Actief', 'Verstuurd', 'In Gesprek', 'Aangenomen',
  'Aanbod gedaan', 'Sales Meeting',
])

function isJiraInMotion(task) {
  return JIRA_ACTIVE_STATUSES.has(task.jira_status || '')
}

function jiraRelevanceScore(task) {
  const today = new Date(); today.setHours(0,0,0,0)
  const todayIso = today.toISOString().slice(0, 10)
  if (task.deadline) {
    if (task.deadline < todayIso) return 0
    const d = new Date(task.deadline); d.setHours(0,0,0,0)
    const diffDays = Math.round((d - today) / 86400000)
    if (diffDays <= 7) return 1
  }
  if (isJiraInMotion(task)) return 2
  return 3
}

function filterJiraTop15(tasks) {
  const today = new Date(); today.setHours(0,0,0,0)
  const todayIso = today.toISOString().slice(0, 10)
  const filtered = tasks.filter(t => {
    if (isJiraInMotion(t)) return true
    if (!t.deadline) return false
    if (t.deadline < todayIso) return true
    const d = new Date(t.deadline); d.setHours(0,0,0,0)
    const diffDays = Math.round((d - today) / 86400000)
    return diffDays <= 14
  })

  const sorted = filtered.slice().sort((a, b) => {
    const sa = jiraRelevanceScore(a)
    const sb = jiraRelevanceScore(b)
    if (sa !== sb) return sa - sb
    const aD = a.deadline || '9999-99-99'
    const bD = b.deadline || '9999-99-99'
    if (aD !== bD) return aD.localeCompare(bD)
    return new Date(b.jira_last_synced || b.created_at) - new Date(a.jira_last_synced || a.created_at)
  })

  return sorted.slice(0, 15)
}

export default function JiraTab({ tasks }) {
  const [showAll, setShowAll] = useState(false)
  const top15 = useMemo(() => filterJiraTop15(tasks), [tasks])
  const visible = showAll ? tasks : top15

  const byBoard = useMemo(() => {
    const g = {}
    for (const t of visible) {
      const key = t.jira_board || 'Overig'
      if (!g[key]) g[key] = []
      g[key].push(t)
    }
    return g
  }, [visible])

  const boardOrder = ['Sales', 'Management', 'Recruitment', 'Overig']
  const boards = boardOrder.filter(b => byBoard[b]?.length > 0)
    .concat(Object.keys(byBoard).filter(b => !boardOrder.includes(b)))

  const today = new Date().toISOString().slice(0, 10)
  const overdueCount = top15.filter(t => t.deadline && t.deadline < today).length
  const inMotionCount = top15.filter(isJiraInMotion).length
  const hidden = tasks.length - top15.length

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <div className={styles.jiraSummaryBox}>
        <div className={styles.jiraSummaryTitle}>📋 Jira-overzicht — top 15 relevant</div>
        <div className={`muted ${styles.jiraSummaryDesc}`}>
          Filter: status in beweging (Actief, Verstuurd, In Gesprek, Aangenomen, Aanbod gedaan, Sales Meeting),
          plus alles met deadline binnen 14 dagen of overdue. "Nog doen", "Backlog" en "Ideeen"-kaarten
          worden verborgen tenzij ze een datum hebben.
        </div>
        <div className={styles.jiraPillsRow}>
          {overdueCount > 0 && (
            <span className={`pill s-error ${styles.pillSm}`}>
              ⚠ {overdueCount} overdue
            </span>
          )}
          <span className={`pill ${styles.inMotionPill}`}>
            🚀 {inMotionCount} in beweging
          </span>
          {hidden > 0 && (
            <span className={`muted ${styles.hiddenCount}`}>
              {hidden} verborgen ·
              <button type="button" onClick={() => setShowAll(s => !s)} className={styles.inlineBtn}>
                {showAll ? 'top 15 tonen' : 'alles tonen'}
              </button>
            </span>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="empty">Geen relevante Jira-items.</div>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          {boards.map(board => (
            <JiraBoardGroup key={board} board={board} tasks={byBoard[board]} />
          ))}
        </div>
      )}
    </div>
  )
}

function JiraBoardGroup({ board, tasks }) {
  const color = JIRA_BOARD_COLOR[board] || '#7c8aff'
  return (
    <div>
      <div className={styles.boardHeader} style={{ borderLeft: `3px solid ${color}` }}>
        <span>{board}</span>
        <span className={`muted ${styles.boardCount}`}>{tasks.length}</span>
      </div>
      <div className="stack stack--sm" style={{ gap: 4, marginLeft: 10 }}>
        {tasks.map(t => <JiraTaskRow key={t.id} task={t} color={color} />)}
      </div>
    </div>
  )
}

function JiraTaskRow({ task, color }) {
  const today = new Date().toISOString().slice(0, 10)
  const overdue = task.deadline && task.deadline < today
  const dueToday = task.deadline === today

  return (
    <div className={`card ${styles.jiraRowCard}`}>
      <span className={`mono ${styles.jiraRef}`} style={{ color }}>
        {task.source_ref || '—'}
      </span>
      <div className={styles.cellMin}>
        <div className={styles.jiraTitle}>{task.title}</div>
        {task.jira_status && (
          <div className={`muted ${styles.jiraMeta}`}>
            {task.jira_issue_type && <span>{task.jira_issue_type} · </span>}
            <span>{task.jira_status}</span>
          </div>
        )}
      </div>
      {task.jira_in_backlog ? (
        <span className={`pill ${styles.pillSmNoColor}`} style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--warning)' }}>op backlog</span>
      ) : (
        <span className={`pill ${styles.pillSmNoColor}`} style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>actief</span>
      )}
      {task.jira_priority && (
        <span className={`pill ${task.jira_priority === 'Highest' || task.jira_priority === 'High' ? 's-warning' : ''} ${styles.pillSm}`}>
          {task.jira_priority}
        </span>
      )}
      {task.deadline ? (
        <span className={`pill ${overdue ? 's-error' : dueToday ? 's-warning' : ''} ${styles.pillSm}`}>
          {overdue ? '⚠ ' : ''}{formatDate(task.deadline)}
        </span>
      ) : (
        <span className={`muted ${styles.noDeadline}`}>geen deadline</span>
      )}
      {task.source_url ? (
        <a href={task.source_url} target="_blank" rel="noreferrer" className={`muted ${styles.sourceUrlLink}`}>↗</a>
      ) : (
        <span className="muted">·</span>
      )}
    </div>
  )
}
