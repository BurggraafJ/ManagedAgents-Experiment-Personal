import { useCallback, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { dbPrioToMockup, mockupPrioToDb, fmtDeadlineLabel, dateUrgencyKind } from './v2-helpers'
import V2PrioPop from './V2PrioPop'
import V2DatePop from './V2DatePop'
import V2ConfirmModal from './V2ConfirmModal'
import styles from './taken-v2.module.css'

/**
 * Eén task-row. Optimistic-state komt uit de parent (applyOptimistic prop)
 * zodat filter/groep-bucketing meteen mee-reageert — geen flicker tussen
 * row-state en parent-state.
 */
export default function V2TaskRow({ task, actions, hideDelete, draggable = false, applyOptimistic }) {
  const [prioPopAnchor, setPrioPopAnchor] = useState(null)
  const [datePopAnchor, setDatePopAnchor] = useState(null)
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)

  const t = task  // task is al merged in parent (useOptimisticTasks)
  const prio = dbPrioToMockup(t.priority)
  const kind = t.deadline_kind || 'day'
  const urgency = dateUrgencyKind(t.deadline, kind)  // overdue | today | tomorrow | future | null
  const done = t.status === 'done'
  const inBacklog = !!t.in_backlog
  const prioCls = 'prio' + prio.charAt(0).toUpperCase() + prio.slice(1)

  // Centrale mutate-helper: optimistic → supabase update
  const mutate = useCallback(async (patch) => {
    if (applyOptimistic) applyOptimistic(task.id, patch)
    await supabase.from('tasks').update(patch).eq('id', task.id)
  }, [task.id, applyOptimistic])

  const toggleDone = useCallback(async (e) => {
    e?.stopPropagation?.()
    const nextStatus = done ? 'open' : 'done'
    const completed_at = nextStatus === 'done' ? new Date().toISOString() : null
    await mutate({ status: nextStatus, completed_at })
  }, [done, mutate])

  const askRemove = useCallback((e) => {
    e?.stopPropagation?.()
    setConfirmDel(true)
  }, [])
  const confirmRemove = useCallback(async () => {
    setConfirmDel(false)
    await mutate({ status: 'dropped' })
  }, [mutate])

  const toggleBacklog = useCallback(async (e) => {
    e?.stopPropagation?.()
    await mutate({ in_backlog: !inBacklog })
  }, [inBacklog, mutate])

  const updatePrio = useCallback(async (mockupPrio) => {
    await mutate({ priority: mockupPrioToDb(mockupPrio) })
  }, [mutate])

  const updateDeadline = useCallback(async (newDate, newKind = 'day') => {
    await mutate({ deadline: newDate || null, deadline_kind: newDate ? newKind : 'day' })
  }, [mutate])

  const startEdit = useCallback(() => {
    setDraftTitle(t.title || '')
    setEditing(true)
  }, [t.title])
  const saveEdit = useCallback(async () => {
    const newTitle = draftTitle.trim()
    setEditing(false)
    if (!newTitle || newTitle === t.title) return
    await mutate({ title: newTitle })
  }, [draftTitle, t.title, mutate])
  const cancelEdit = useCallback(() => {
    setEditing(false)
    setDraftTitle('')
  }, [])

  const handleDragStart = (e) => {
    if (!draggable) return
    e.dataTransfer.setData('text/plain', task.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div
      className={`${styles.taskRow} ${styles[prioCls]} ${done ? styles.done : ''}`}
      draggable={draggable}
      onDragStart={handleDragStart}
      data-task-id={task.id}
    >
      {draggable && <span className={styles.dragHandle} title="Versleep">⠿</span>}
      <div
        className={`${styles.taskCb} ${done ? styles.checked : ''}`}
        onClick={toggleDone}
        title={done ? 'Vink uit' : 'Vink af'}
      />
      {editing ? (
        <input
          type="text"
          className={styles.taskTitleInput}
          value={draftTitle}
          autoFocus
          onChange={e => setDraftTitle(e.target.value)}
          onBlur={saveEdit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); saveEdit() }
            if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
          }}
          onClick={e => e.stopPropagation()}
        />
      ) : (
        <div
          className={`${styles.taskTitle} ${done ? styles.done : ''}`}
          onDoubleClick={startEdit}
          title="Dubbelklik om naam te bewerken"
        >{t.title}</div>
      )}
      <span
        className={`${styles.prioPill} ${styles[prio]}`}
        onClick={(e) => { e.stopPropagation(); setPrioPopAnchor(e.currentTarget) }}
        title="Klik om prioriteit te wijzigen"
      >{prio}</span>
      <span
        className={[
          styles.taskDeadline,
          t.deadline && styles.set,
          urgency && styles[urgency],
        ].filter(Boolean).join(' ')}
        onClick={(e) => { e.stopPropagation(); setDatePopAnchor(e.currentTarget) }}
        title={t.deadline ? 'Wijzig deadline' : 'Stel deadline in'}
      >{t.deadline ? fmtDeadlineLabel(t.deadline, kind) : '+ datum'}</span>
      {actions}
      {!actions && !hideDelete && (
        <>
          <button
            className={styles.taskBacklogBtn}
            onClick={toggleBacklog}
            title={inBacklog ? 'Terug uit backlog' : 'Naar backlog'}
          >{inBacklog ? '↑' : '↓'}</button>
          <button className={styles.taskDel} onClick={askRemove} title="Verwijder">×</button>
        </>
      )}

      <V2ConfirmModal
        open={confirmDel}
        title="Taak verwijderen?"
        body={
          <>
            <p style={{ margin: '0 0 8px' }}>
              <strong>{t.title}</strong>
            </p>
            <p style={{ margin: 0, color: 'var(--tv2-neutral-500)' }}>
              Je kunt 'm 14 dagen lang terughalen vanuit de tab <strong>Verwijderd</strong>. Daarna gaat hij definitief weg.
            </p>
          </>
        }
        confirmLabel="Verwijderen"
        confirmTone="danger"
        onConfirm={confirmRemove}
        onCancel={() => setConfirmDel(false)}
      />

      {prioPopAnchor && (
        <V2PrioPop
          anchor={prioPopAnchor}
          current={prio}
          onPick={updatePrio}
          onClose={() => setPrioPopAnchor(null)}
        />
      )}
      {datePopAnchor && (
        <V2DatePop
          anchor={datePopAnchor}
          current={t.deadline || ''}
          currentKind={kind}
          onPick={updateDeadline}
          onClose={() => setDatePopAnchor(null)}
        />
      )}
    </div>
  )
}
