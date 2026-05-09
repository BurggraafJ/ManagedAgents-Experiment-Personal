import { useState, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import {
  BUCKET_TO_PRIORITY,
  BUCKET_LABEL,
  SOURCE_LABEL,
  shortTitle,
  isOverdue,
  isDueToday,
  formatDate,
} from '../../../lib/tasks'
import styles from './tasks.module.css'
import TaskEditor from './TaskEditor'

export default function NarrowTaskList({ tasks, projects, currentBucket, wide }) {
  if (!tasks.length) return null
  return (
    <div className="stack stack--xs" style={{ gap: 6 }}>
      {tasks.map(t => (
        <NarrowTaskRow
          key={t.id}
          task={t}
          projects={projects}
          currentBucket={currentBucket}
          wide={wide}
        />
      ))}
    </div>
  )
}

function NarrowTaskRow({ task, projects, currentBucket, wide }) {
  const [open, setOpen] = useState(false)
  const [optimistic, setOptimistic] = useState(null)
  const [moveOpen, setMoveOpen] = useState(false)
  const t = optimistic ? { ...task, ...optimistic } : task

  const project = projects.find(p => p.id === t.project_id) || null
  const overdue = isOverdue(t)
  const dueToday = isDueToday(t)

  const toggleDone = useCallback(async (e) => {
    e?.stopPropagation?.()
    const next = t.status === 'done' ? 'open' : 'done'
    setOptimistic({ status: next })
    try { await supabase.from('tasks').update({ status: next }).eq('id', t.id) }
    catch { setOptimistic(null) }
  }, [t.id, t.status])

  const toggleBacklog = useCallback(async (e) => {
    e?.stopPropagation?.()
    const next = !t.in_backlog
    setOptimistic({ in_backlog: next })
    try { await supabase.from('tasks').update({ in_backlog: next }).eq('id', t.id) }
    catch { setOptimistic(null) }
  }, [t.id, t.in_backlog])

  const moveToBucket = useCallback(async (toBucket) => {
    setMoveOpen(false)
    if (toBucket === currentBucket) return
    const newPrio = BUCKET_TO_PRIORITY[toBucket]
    setOptimistic({ priority: newPrio })
    try { await supabase.from('tasks').update({ priority: newPrio }).eq('id', t.id) }
    catch { setOptimistic(null) }
  }, [t.id, currentBucket])

  const dateLabel = t.deadline ? formatDate(t.deadline) : null
  const dateCls = overdue ? 's-error' : dueToday ? 's-warning' : ''

  const createdShort = t.created_at
    ? new Date(t.created_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
    : null

  return (
    <div
      className={styles.narrowRow}
      style={{ background: open ? 'rgba(124,138,255,0.05)' : 'var(--card-bg, transparent)' }}
    >
      <div
        className={styles.narrowRowGrid}
        onClick={() => setOpen(o => !o)}
        title={t.title}
      >
        <input
          type="checkbox"
          checked={t.status === 'done'}
          onChange={toggleDone}
          onClick={e => e.stopPropagation()}
          className={styles.checkboxTop}
        />

        <div className={styles.cellMin}>
          <div
            className={styles.narrowTitle}
            style={{
              color: t.status === 'done' ? 'var(--text-faint)' : 'var(--text)',
              textDecoration: t.status === 'done' ? 'line-through' : 'none',
              whiteSpace: wide ? 'normal' : 'nowrap',
              wordBreak: wide ? 'break-word' : 'normal',
            }}
          >
            {wide ? t.title : shortTitle(t.title, 80)}
          </div>
          <div className={styles.narrowMeta}>
            {project && (
              <span
                className={styles.projectBadge}
                style={{ background: (project.color || '#7c8aff') + '22' }}
              >
                {project.icon || ''}{project.icon ? ' ' : ''}{project.name}
              </span>
            )}
            {t.category === 'klant' && (
              <span className={styles.klantBadge}>klant</span>
            )}
            {(t.tags || []).slice(0, 3).map(tag => (
              <span key={tag} className={styles.tagText}>#{tag}</span>
            ))}
            {t.source && t.source !== 'manual' && (
              <span className={styles.sourceItalic}>
                · {SOURCE_LABEL[t.source] || t.source}
              </span>
            )}
          </div>
        </div>

        <div className={styles.narrowDateCol}>
          {dateLabel && (
            <span className={`pill ${dateCls} ${styles.narrowDatePill}`}>
              {overdue ? '⚠ ' : '📅 '}{dateLabel}
            </span>
          )}
          {createdShort && (
            <span className={styles.createdLabel}>
              aangemaakt {createdShort}
            </span>
          )}
        </div>

        <div className={styles.narrowActionsCol} onClick={e => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setMoveOpen(m => !m)}
            title="Verplaats naar andere prio"
            className={styles.narrowIconBtn}
            style={{ background: moveOpen ? 'var(--border)' : 'transparent' }}
          >↕</button>
          <button
            type="button"
            onClick={toggleBacklog}
            title={t.in_backlog ? 'Terug uit backlog' : 'Naar backlog'}
            className={styles.narrowIconBtn}
            style={{ background: 'transparent' }}
          >{t.in_backlog ? '↑' : '↓'}</button>
          {moveOpen && (
            <div className={styles.narrowDropdown}>
              {['high', 'mid', 'low'].map(b => (
                <button
                  key={b}
                  type="button"
                  onClick={() => moveToBucket(b)}
                  disabled={b === currentBucket}
                  className={styles.narrowDropdownBtn}
                  style={{
                    cursor: b === currentBucket ? 'default' : 'pointer',
                    color: b === currentBucket ? 'var(--text-faint)' : 'var(--text)',
                    fontWeight: b === currentBucket ? 600 : 400,
                  }}
                >
                  {b === currentBucket ? '✓ ' : '  '}{BUCKET_LABEL[b]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {open && (
        <div className={styles.narrowEditorWrap}>
          <TaskEditor task={t} projects={projects} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}
