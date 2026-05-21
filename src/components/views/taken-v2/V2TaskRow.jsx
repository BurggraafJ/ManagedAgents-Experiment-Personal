import { useCallback, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { dbPrioToMockup, mockupPrioToDb, fmtDateOrMonth, isOverdueIso } from './v2-helpers'
import V2PrioPop from './V2PrioPop'
import V2DatePop from './V2DatePop'
import styles from './taken-v2.module.css'

/**
 * Eén task-row. Optimistic-state komt uit de parent (applyOptimistic prop)
 * zodat filter/groep-bucketing meteen mee-reageert — geen flicker tussen
 * row-state en parent-state.
 */
export default function V2TaskRow({ task, actions, hideDelete, draggable = false, applyOptimistic }) {
  const [prioPopAnchor, setPrioPopAnchor] = useState(null)
  const [datePopAnchor, setDatePopAnchor] = useState(null)

  const t = task  // task is al merged in parent (useOptimisticTasks)
  const prio = dbPrioToMockup(t.priority)
  const kind = t.deadline_kind || 'day'
  const overdue = isOverdueIso(t.deadline, kind)
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

  const remove = useCallback(async (e) => {
    e?.stopPropagation?.()
    if (!confirm('Taak weggooien?')) return
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
      <div className={`${styles.taskTitle} ${done ? styles.done : ''}`}>{t.title}</div>
      <span
        className={`${styles.prioPill} ${styles[prio]}`}
        onClick={(e) => { e.stopPropagation(); setPrioPopAnchor(e.currentTarget) }}
        title="Klik om prioriteit te wijzigen"
      >{prio}</span>
      <span
        className={`${styles.taskDeadline} ${t.deadline ? styles.set : ''} ${overdue ? styles.overdue : ''}`}
        onClick={(e) => { e.stopPropagation(); setDatePopAnchor(e.currentTarget) }}
        title={t.deadline ? 'Wijzig deadline' : 'Stel deadline in'}
      >{t.deadline ? fmtDateOrMonth(t.deadline, kind) : '+ datum'}</span>
      {actions}
      {!actions && !hideDelete && (
        <>
          <button
            className={styles.taskBacklogBtn}
            onClick={toggleBacklog}
            title={inBacklog ? 'Terug uit backlog' : 'Naar backlog'}
          >{inBacklog ? '↑' : '↓'}</button>
          <button className={styles.taskDel} onClick={remove} title="Verwijder">×</button>
        </>
      )}

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
