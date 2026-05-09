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
import styles from './tasks.module.css'
import TaskEditor from './TaskEditor'

const TASKROW_COLS         = '24px minmax(0, 1fr) 160px 110px 80px 100px 90px'
const TASKROW_COLS_COMPACT = '22px minmax(0, 1fr) 130px 90px  72px 88px  76px'

export default function TaskList({ tasks, projects, compact }) {
  if (!tasks.length) {
    return (
      <div className={`empty ${styles.listEmpty}`}>
        Niets hier.
      </div>
    )
  }
  const cols = compact ? TASKROW_COLS_COMPACT : TASKROW_COLS
  return (
    <div className={`card ${styles.listCard}`} style={{ marginTop: compact ? 0 : 8 }}>
      <div className={styles.listHeader} style={{ gridTemplateColumns: cols }}>
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
        className={styles.rowGrid}
        style={{
          gridTemplateColumns: cols,
          background: open ? 'rgba(124,138,255,0.04)' : 'transparent',
        }}
        onClick={() => setOpen(o => !o)}
      >
        <input
          type="checkbox"
          checked={t.status === 'done'}
          onChange={toggleDone}
          onClick={e => e.stopPropagation()}
          className={styles.checkboxZero}
        />

        <div className={styles.cellMin}>
          <div
            className={styles.taskTitle}
            style={{
              color: t.status === 'done' ? 'var(--text-faint)' : 'var(--text)',
              textDecoration: t.status === 'done' ? 'line-through' : 'none',
            }}
          >
            {t.title}
            {t.category === 'klant' && (
              <span className={`pill ${styles.klantPill}`}>klant</span>
            )}
          </div>
          {t.notes && !open && (
            <div className={`muted ${styles.notesPreview}`}>{t.notes}</div>
          )}
        </div>

        <div className={styles.cellMin}>
          {project ? (
            <span
              className={`pill ${styles.projectPill}`}
              style={{ background: (project.color || '#7c8aff') + '22' }}
              title={project.name}
            >
              {project.icon && <span>{project.icon}</span>}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{project.name}</span>
            </span>
          ) : (
            <span className={`muted ${styles.noProject}`}>—</span>
          )}
        </div>

        <div className={styles.tagsCell}>
          {(t.tags || []).slice(0, 3).map(tag => (
            <span key={tag} className={styles.tagItem}>#{tag}</span>
          ))}
          {(!t.tags || t.tags.length === 0) && <span className="muted">—</span>}
        </div>

        <div>
          {t.priority && t.priority !== 'normal' ? (
            <span className={`pill ${PRIORITY_PILL[t.priority] || ''} ${styles.pillSm}`}>
              {PRIORITY_LABEL[t.priority]}
            </span>
          ) : (
            <span className={`muted ${styles.pillSm}`}>—</span>
          )}
        </div>

        <div>
          {dateCell ? (
            <span className={`pill ${dateCell.cls} ${styles.pillSm}`}>
              {dateCell.label}
            </span>
          ) : (
            <span className={`muted ${styles.pillSm}`}>—</span>
          )}
        </div>

        <div className={styles.rowActions}>
          <button
            type="button"
            className={`btn btn--ghost ${styles.backlogBtn}`}
            onClick={toggleBacklog}
            title={t.in_backlog ? 'Terug uit backlog' : 'Naar backlog'}
          >
            {t.in_backlog ? '↑' : '↓'}
          </button>
          {t.source !== 'manual' ? (
            <span className={styles.sourceLabel} title={t.source_url || t.source_ref || ''}>
              {SOURCE_LABEL[t.source] || t.source}
            </span>
          ) : (
            <span className={`muted ${styles.mutedDot}`}>·</span>
          )}
        </div>
      </div>

      {open && (
        <div className={styles.rowExpandBg}>
          <TaskEditor task={t} projects={projects} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}
