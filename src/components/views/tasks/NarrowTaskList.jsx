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
import TaskEditor from './TaskEditor'

// Smalle stacked-row variant voor de prio-blokken. Eén card per taak.
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

  // Aanmaakdatum: dag + maand zonder jaar.
  const createdShort = t.created_at
    ? new Date(t.created_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })
    : null

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: open ? 'rgba(124,138,255,0.05)' : 'var(--card-bg, transparent)',
      transition: 'background 0.15s',
    }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: wide
            ? '20px minmax(0, 1fr) auto auto'
            : '20px minmax(0, 1fr) auto auto',
          gap: 8,
          padding: '10px 12px',
          cursor: 'pointer',
          alignItems: 'flex-start',
        }}
        onClick={() => setOpen(o => !o)}
        title={t.title}
      >
        <input
          type="checkbox"
          checked={t.status === 'done'}
          onChange={toggleDone}
          onClick={e => e.stopPropagation()}
          style={{ margin: '4px 0 0 0' }}
        />

        <div style={{ minWidth: 0 }}>
          <div
            style={{
              color: t.status === 'done' ? 'var(--text-faint)' : 'var(--text)',
              textDecoration: t.status === 'done' ? 'line-through' : 'none',
              fontWeight: 500,
              fontSize: 13.5,
              lineHeight: 1.35,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: wide ? 'normal' : 'nowrap',
              wordBreak: wide ? 'break-word' : 'normal',
            }}
          >
            {wide ? t.title : shortTitle(t.title, 80)}
          </div>
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 5,
            fontSize: 10.5, color: 'var(--text-faint)', alignItems: 'center',
          }}>
            {project && (
              <span style={{
                padding: '1px 6px', borderRadius: 4,
                background: (project.color || '#7c8aff') + '22',
                color: 'var(--text)', fontWeight: 500,
              }}>
                {project.icon || ''}{project.icon ? ' ' : ''}{project.name}
              </span>
            )}
            {t.category === 'klant' && (
              <span style={{
                padding: '1px 6px', borderRadius: 4,
                background: 'rgba(124,138,255,0.20)', color: 'var(--accent)',
                fontWeight: 600,
              }}>klant</span>
            )}
            {(t.tags || []).slice(0, 3).map(tag => (
              <span key={tag} style={{ color: 'var(--accent)' }}>#{tag}</span>
            ))}
            {t.source && t.source !== 'manual' && (
              <span style={{ fontStyle: 'italic' }}>
                · {SOURCE_LABEL[t.source] || t.source}
              </span>
            )}
          </div>
        </div>

        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
          gap: 3, fontSize: 10, flexShrink: 0,
        }}>
          {dateLabel && (
            <span className={`pill ${dateCls}`} style={{
              padding: '2px 8px', fontSize: 10.5, fontWeight: 600,
              whiteSpace: 'nowrap',
            }}>
              {overdue ? '⚠ ' : '📅 '}{dateLabel}
            </span>
          )}
          {createdShort && (
            <span style={{ color: 'var(--text-faint)', fontSize: 9.5, whiteSpace: 'nowrap' }}>
              aangemaakt {createdShort}
            </span>
          )}
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: 2,
          flexShrink: 0, position: 'relative',
        }} onClick={e => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => setMoveOpen(m => !m)}
            title="Verplaats naar andere prio"
            style={{
              padding: '2px 6px', fontSize: 11, border: '1px solid var(--border)',
              background: moveOpen ? 'var(--border)' : 'transparent',
              borderRadius: 4, cursor: 'pointer', color: 'var(--text-faint)',
            }}
          >↕</button>
          <button
            type="button"
            onClick={toggleBacklog}
            title={t.in_backlog ? 'Terug uit backlog' : 'Naar backlog'}
            style={{
              padding: '2px 6px', fontSize: 11, border: '1px solid var(--border)',
              background: 'transparent', borderRadius: 4, cursor: 'pointer',
              color: 'var(--text-faint)',
            }}
          >{t.in_backlog ? '↑' : '↓'}</button>
          {moveOpen && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 4,
              background: 'var(--card-bg, #fff)',
              border: '1px solid var(--border)', borderRadius: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
              zIndex: 10, minWidth: 110,
            }}>
              {['high', 'mid', 'low'].map(b => (
                <button
                  key={b}
                  type="button"
                  onClick={() => moveToBucket(b)}
                  disabled={b === currentBucket}
                  style={{
                    width: '100%', textAlign: 'left',
                    padding: '6px 10px', background: 'transparent',
                    border: 'none', cursor: b === currentBucket ? 'default' : 'pointer',
                    color: b === currentBucket ? 'var(--text-faint)' : 'var(--text)',
                    fontSize: 12, fontWeight: b === currentBucket ? 600 : 400,
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
        <div style={{ padding: '4px 12px 12px 12px', borderTop: '1px solid var(--border)' }}>
          <TaskEditor task={t} projects={projects} onClose={() => setOpen(false)} />
        </div>
      )}
    </div>
  )
}
