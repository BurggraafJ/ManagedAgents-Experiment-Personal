import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { dbPrioToMockup, mockupPrioToDb, fmtDate, isOverdueIso } from './v2-helpers'
import V2PrioPop from './V2PrioPop'
import V2DatePop from './V2DatePop'
import styles from './taken-v2.module.css'

/**
 * Eén task-row in v2-stijl met OPTIMISTIC updates.
 * Bij elke mutatie wordt de UI meteen geüpdatet; lokale optimistic state
 * wordt opgeschoond zodra useTasks de nieuwe waarde uit Supabase laadt.
 */
export default function V2TaskRow({ task, actions, hideDelete, draggable = false, onDragStart, onDragEnd }) {
  const [prioPopAnchor, setPrioPopAnchor] = useState(null)
  const [datePopAnchor, setDatePopAnchor] = useState(null)
  const [optimistic, setOptimistic] = useState(null)

  // Merge optimistic op task — UI toont meteen de nieuwe waarde
  const t = optimistic ? { ...task, ...optimistic } : task

  // Clear optimistic zodra de prop matched (Supabase realtime sync klaar)
  useEffect(() => {
    if (!optimistic) return
    const allMatch = Object.keys(optimistic).every(k => {
      const a = task[k]; const b = optimistic[k]
      if (a === b) return true
      // null/undefined normaliseren
      if ((a == null) && (b == null)) return true
      return false
    })
    if (allMatch) setOptimistic(null)
  }, [task, optimistic])

  const prio = dbPrioToMockup(t.priority)
  const overdue = isOverdueIso(t.deadline)
  const done = t.status === 'done'
  const inBacklog = !!t.in_backlog
  const prioCls = 'prio' + prio.charAt(0).toUpperCase() + prio.slice(1)

  const mutate = useCallback(async (patch, optimisticPatch) => {
    setOptimistic(prev => ({ ...(prev || {}), ...(optimisticPatch || patch) }))
    const { error } = await supabase.from('tasks').update(patch).eq('id', task.id)
    if (error) setOptimistic(null)  // revert bij fail
  }, [task.id])

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
    const newDb = mockupPrioToDb(mockupPrio)
    await mutate({ priority: newDb })
  }, [mutate])

  const updateDeadline = useCallback(async (newDate) => {
    await mutate({ deadline: newDate || null })
  }, [mutate])

  const handleDragStart = (e) => {
    if (!draggable) return
    e.dataTransfer.setData('text/plain', task.id)
    e.dataTransfer.effectAllowed = 'move'
    if (onDragStart) onDragStart(task.id)
  }
  const handleDragEnd = () => { if (onDragEnd) onDragEnd() }

  return (
    <div
      className={`${styles.taskRow} ${styles[prioCls]} ${done ? styles.done : ''} ${optimistic ? styles.busy : ''}`}
      draggable={draggable}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      data-task-id={task.id}
    >
      {draggable && <span className={styles.dragHandle} title="Versleep naar andere prio">⠿</span>}
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
      >{t.deadline ? fmtDate(t.deadline) : '+ datum'}</span>
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
          onPick={updateDeadline}
          onClose={() => setDatePopAnchor(null)}
        />
      )}
    </div>
  )
}
