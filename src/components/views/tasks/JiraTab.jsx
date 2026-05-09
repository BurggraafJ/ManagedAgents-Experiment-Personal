import { useState, useMemo } from 'react'
import { JIRA_BOARD_COLOR, formatDate } from '../../../lib/tasks'

// JiraTab — apart sub-tabblad met top-15 filter op datum + relevante status.
//
// Status-categorieën gemeten uit DB (2026-05-07):
//   In beweging (relevant): Actief, Verstuurd, In Gesprek, Aangenomen,
//                           Aanbod gedaan, Sales Meeting
//   Wacht/idee (verbergen tenzij deadline kort): Nog doen, Backlog,
//                                                 In overweging, On Hold,
//                                                 Ideeen, Potentiele kandidaten
//
// Sortering: overdue → due binnen 7 dagen → in beweging → rest. Cap 15.

const JIRA_ACTIVE_STATUSES = new Set([
  'Actief', 'Verstuurd', 'In Gesprek', 'Aangenomen',
  'Aanbod gedaan', 'Sales Meeting',
])

function isJiraInMotion(task) {
  return JIRA_ACTIVE_STATUSES.has(task.jira_status || '')
}

function jiraRelevanceScore(task) {
  // Lager = belangrijker.
  const today = new Date(); today.setHours(0,0,0,0)
  const todayIso = today.toISOString().slice(0, 10)
  if (task.deadline) {
    if (task.deadline < todayIso) return 0 // overdue
    const d = new Date(task.deadline); d.setHours(0,0,0,0)
    const diffDays = Math.round((d - today) / 86400000)
    if (diffDays <= 7) return 1
  }
  if (isJiraInMotion(task)) return 2
  return 3
}

function filterJiraTop15(tasks) {
  // Stap 1: pak alleen relevante items (in beweging + datum-relevante).
  const today = new Date(); today.setHours(0,0,0,0)
  const todayIso = today.toISOString().slice(0, 10)
  const filtered = tasks.filter(t => {
    if (isJiraInMotion(t)) return true
    if (!t.deadline) return false
    // Niet-actieve status: alleen door als deadline binnen 14 dagen of overdue.
    if (t.deadline < todayIso) return true
    const d = new Date(t.deadline); d.setHours(0,0,0,0)
    const diffDays = Math.round((d - today) / 86400000)
    return diffDays <= 14
  })

  // Stap 2: sorteer op relevantie + datum.
  const sorted = filtered.slice().sort((a, b) => {
    const sa = jiraRelevanceScore(a)
    const sb = jiraRelevanceScore(b)
    if (sa !== sb) return sa - sb
    // Binnen zelfde score: oudere deadline eerst, dan recentere updated_at.
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

  // Group per board (jira_board kan null zijn → 'Overig').
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
      <div style={{
        padding: '12px 14px',
        background: 'rgba(124,138,255,0.04)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        fontSize: 13,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>📋 Jira-overzicht — top 15 relevant</div>
        <div className="muted" style={{ fontSize: 12 }}>
          Filter: status in beweging (Actief, Verstuurd, In Gesprek, Aangenomen, Aanbod gedaan, Sales Meeting),
          plus alles met deadline binnen 14 dagen of overdue. "Nog doen", "Backlog" en "Ideeen"-kaarten
          worden verborgen tenzij ze een datum hebben.
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {overdueCount > 0 && (
            <span className="pill s-error" style={{ padding: '2px 8px', fontSize: 11 }}>
              ⚠ {overdueCount} overdue
            </span>
          )}
          <span className="pill" style={{
            padding: '2px 8px', fontSize: 11,
            background: 'rgba(34,197,94,0.12)', color: '#22c55e',
            borderColor: 'transparent',
          }}>
            🚀 {inMotionCount} in beweging
          </span>
          {hidden > 0 && (
            <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
              {hidden} verborgen ·
              <button
                type="button"
                onClick={() => setShowAll(s => !s)}
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--accent)', cursor: 'pointer',
                  marginLeft: 4, fontSize: 11, padding: 0,
                }}
              >{showAll ? 'top 15 tonen' : 'alles tonen'}</button>
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
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
        padding: '4px 10px', borderLeft: `3px solid ${color}`,
        fontWeight: 600, fontSize: 13,
      }}>
        <span>{board}</span>
        <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>{tasks.length}</span>
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
    <div className="card" style={{
      padding: '8px 12px', display: 'grid',
      gridTemplateColumns: '90px minmax(0, 1fr) auto auto auto auto',
      alignItems: 'center', gap: 10,
    }}>
      <span className="mono" style={{ fontSize: 11, color, fontWeight: 600 }}>
        {task.source_ref || '—'}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontWeight: 500, fontSize: 13,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{task.title}</div>
        {task.jira_status && (
          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
            {task.jira_issue_type && <span>{task.jira_issue_type} · </span>}
            <span>{task.jira_status}</span>
          </div>
        )}
      </div>
      {task.jira_in_backlog ? (
        <span className="pill" style={{
          padding: '2px 8px', fontSize: 11,
          background: 'rgba(245,158,11,0.15)', borderColor: 'transparent', color: 'var(--warning)',
        }}>op backlog</span>
      ) : (
        <span className="pill" style={{
          padding: '2px 8px', fontSize: 11,
          background: 'rgba(34,197,94,0.12)', borderColor: 'transparent', color: '#22c55e',
        }}>actief</span>
      )}
      {task.jira_priority && (
        <span className={`pill ${task.jira_priority === 'Highest' || task.jira_priority === 'High' ? 's-warning' : ''}`}
          style={{ padding: '2px 8px', fontSize: 11 }}>
          {task.jira_priority}
        </span>
      )}
      {task.deadline ? (
        <span className={`pill ${overdue ? 's-error' : dueToday ? 's-warning' : ''}`}
          style={{ padding: '2px 8px', fontSize: 11 }}>
          {overdue ? '⚠ ' : ''}{formatDate(task.deadline)}
        </span>
      ) : (
        <span className="muted" style={{ fontSize: 11 }}>geen deadline</span>
      )}
      {task.source_url ? (
        <a href={task.source_url} target="_blank" rel="noreferrer" className="muted" style={{ fontSize: 11 }}>↗</a>
      ) : (
        <span className="muted">·</span>
      )}
    </div>
  )
}
