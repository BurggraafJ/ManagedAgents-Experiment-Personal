import { useState, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import {
  PRIORITY_LABEL,
  PRIORITY_PILL,
  SOURCE_LABEL,
  isOverdue,
  isDueToday,
  formatDate,
} from '../../../lib/tasks'
import TaskEditor from './TaskEditor'

const TASKROW_COLS         = '24px minmax(0, 1fr) 160px 110px 80px 100px 90px'
const TASKROW_COLS_COMPACT = '22px minmax(0, 1fr) 130px 90px  72px 88px  76px'

export default function TaskList({ tasks, projects, compact }) {
  if (!tasks.length) {
    return (
      <div className="empty" style={{ padding: '8px 4px', fontSize: 12 }}>
        Niets hier.
      </div>
    )
  }
  const cols = compact ? TASKROW_COLS_COMPACT : TASKROW_COLS
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginTop: compact ? 0 : 8 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: cols,
          gap: 10,
          padding: '6px 12px',
          fontSize: 10,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.6,
          color: 'var(--text-faint)',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(124,138,255,0.03)',
        }}
      >
        <span></span>
        <span>Taak</span>
        <span>Project</span>
        <span>Tags</span>
        <span>Prio</span>
        <span>Datum</span>
        <span>Bron / acties</span>
      </div>

      <div>
        {tasks.map((t, i) => (
          <TaskRow
            key={t.id}
            task={t}
            projects={projects}
            isLast={i === tasks.length - 1}
            cols={cols}
          />
        ))}
      </div>
    </div>
  )
}

function TaskRow({ task, projects, isLast, cols }) {
  const [open, setOpen] = useState(false)
  const [optimistic, setOptimistic] = useState(null)
  const t = optimistic ? { ...task, ...optimistic } : task

  const project = projects.find(p => p.id === t.project_id) || null
  const overdue = isOverdue(t)
  const dueToday = isDueToday(t)

  const toggleDone = useCallback(async (e) => {
    e?.stopPropagation?.()
    const next = t.status === 'done' ? 'open' : 'done'
    setOptimistic({ status: next })
    try {
      await supabase.from('tasks').update({ status: next }).eq('id', t.id)
    } catch {
      setOptimistic(null)
    }
  }, [t.id, t.status])

  const toggleBacklog = useCallback(async (e) => {
    e?.stopPropagation?.()
    const next = !t.in_backlog
    setOptimistic({ in_backlog: next })
    try {
      await supabase.from('tasks').update({ in_backlog: next }).eq('id', t.id)
    } catch {
      setOptimistic(null)
    }
  }, [t.id, t.in_backlog])

  const dateCell = t.deadline
    ? { label: (overdue ? '⚠ ' : '') + formatDate(t.deadline),
        cls: overdue ? 's-error' : dueToday ? 's-warning' : '' }
    : t.do_date
      ? { label: '▶ ' + formatDate(t.do_date), cls: dueToday ? 's-warning' : '' }
      : null

  return (
    <div style={{ borderBottom: isLast ? 'none' : '1px solid var(--border)' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: cols,
          gap: 10,
          alignItems: 'center',
          padding: '8px 12px',
          cursor: 'pointer',
          background: open ? 'rgba(124,138,255,0.04)' : 'transparent',
        }}
        onClick={() => setOpen(o => !o)}
      >
        <input
          type="checkbox"
          checked={t.status === 'done'}
          onChange={toggleDone}
          onClick={e => e.stopPropagation()}
          style={{ margin: 0 }}
        />

        <div style={{ minWidth: 0 }}>
          <div style={{
            color: t.status === 'done' ? 'var(--text-faint)' : 'var(--text)',
            textDecoration: t.status === 'done' ? 'line-through' : 'none',
            fontWeight: 500,
            fontSize: 13,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {t.title}
            {t.category === 'klant' && (
              <span className="pill" style={{
                marginLeft: 6, padding: '1px 6px', fontSize: 10,
                background: 'rgba(124,138,255,0.15)', borderColor: 'transparent', color: 'var(--accent)',
              }}>klant</span>
            )}
          </div>
          {t.notes && !open && (
            <div className="muted" style={{
              fontSize: 11, marginTop: 2,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{t.notes}</div>
          )}
        </div>

        <div style={{ minWidth: 0 }}>
          {project ? (
            <span
              className="pill"
              style={{
                padding: '2px 8px', fontSize: 11,
                background: (project.color || '#7c8aff') + '22',
                borderColor: 'transparent',
                display: 'inline-flex', alignItems: 'center', gap: 4,
                maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
              title={project.name}
            >
              {project.icon && <span>{project.icon}</span>}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{project.name}</span>
            </span>
          ) : (
            <span className="muted" style={{ fontSize: 11, fontStyle: 'italic' }}>—</span>
          )}
        </div>

        <div style={{
          minWidth: 0, fontSize: 11, color: 'var(--accent)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {(t.tags || []).slice(0, 3).map(tag => (
            <span key={tag} style={{ marginRight: 6 }}>#{tag}</span>
          ))}
          {(!t.tags || t.tags.length === 0) && <span className="muted">—</span>}
        </div>

        <div>
          {t.priority && t.priority !== 'normal' ? (
            <span className={`pill ${PRIORITY_PILL[t.priority] || ''}`} style={{ padding: '2px 8px', fontSize: 11 }}>
              {PRIORITY_LABEL[t.priority]}
            </span>
          ) : (
            <span className="muted" style={{ fontSize: 11 }}>—</span>
          )}
        </div>

        <div>
          {dateCell ? (
            <span className={`pill ${dateCell.cls}`} style={{ padding: '2px 8px', fontSize: 11 }}>
              {dateCell.label}
            </span>
          ) : (
            <span className="muted" style={{ fontSize: 11 }}>—</span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={toggleBacklog}
            title={t.in_backlog ? 'Terug uit backlog' : 'Naar backlog'}
            style={{ padding: '2px 6px', fontSize: 10 }}
          >
            {t.in_backlog ? '↑' : '↓'}
          </button>
          {t.source !== 'manual' ? (
            <span style={{ fontSize: 10, color: 'var(--text-faint)' }} title={t.source_url || t.source_ref || ''}>
              {SOURCE_LABEL[t.source] || t.source}
            </span>
          ) : (
            <span className="muted" style={{ fontSize: 10 }}>·</span>
          )}
        </div>
      </div>

      {open && (
        <div style={{ padding: '4px 12px 12px 12px', background: 'rgba(124,138,255,0.04)' }}>
          <TaskEditor task={t} projects={projects} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}
