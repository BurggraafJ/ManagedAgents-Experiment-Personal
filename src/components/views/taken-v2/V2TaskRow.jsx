import { useCallback, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { dbPrioToMockup, mockupPrioToDb, fmtDate, isOverdueIso } from './v2-helpers'
import V2PrioPop from './V2PrioPop'
import V2DatePop from './V2DatePop'
import styles from './taken-v2.module.css'

/**
 * Eén task-row in v2-stijl. Interacties:
 *  - checkbox        → toggle done / open
 *  - prio-pill klik  → dropdown om Hoog/Middel/Laag te kiezen
 *  - deadline klik   → datepicker popover
 *  - drag handle ⠿   → versleep naar andere prio-zone
 *  - × verwijder     → status='dropped'
 */
export default function V2TaskRow({ task, actions, hideDelete, draggable = false, onDragStart, onDragEnd }) {
  const [prioPopAnchor, setPrioPopAnchor] = useState(null)
  const [datePopAnchor, setDatePopAnchor] = useState(null)

  const prio = dbPrioToMockup(task.priority)
  const overdue = isOverdueIso(task.deadline)
  const done = task.status === 'done'
  const prioCls = 'prio' + prio.charAt(0).toUpperCase() + prio.slice(1)

  const toggleDone = useCallback(async (e) => {
    e?.stopPropagation?.()
    const next = done ? 'open' : 'done'
    const completed_at = next === 'done' ? new Date().toISOString() : null
    await supabase.from('tasks').update({ status: next, completed_at }).eq('id', task.id)
  }, [task.id, done])

  const remove = useCallback(async (e) => {
    e?.stopPropagation?.()
    if (!confirm('Taak weggooien?')) return
    await supabase.from('tasks').update({ status: 'dropped' }).eq('id', task.id)
  }, [task.id])

  const updatePrio = useCallback(async (mockupPrio) => {
    const newDb = mockupPrioToDb(mockupPrio)
    await supabase.from('tasks').update({ priority: newDb }).eq('id', task.id)
  }, [task.id])

  const updateDeadline = useCallback(async (newDate) => {
    await supabase.from('tasks').update({ deadline: newDate || null }).eq('id', task.id)
  }, [task.id])

  const handleDragStart = (e) => {
    if (!draggable) return
    e.dataTransfer.setData('text/plain', task.id)
    e.dataTransfer.effectAllowed = 'move'
    if (onDragStart) onDragStart(task.id)
  }
  const handleDragEnd = () => { if (onDragEnd) onDragEnd() }

  return (
    <div
      className={`${styles.taskRow} ${styles[prioCls]} ${done ? styles.done : ''}`}
      draggable={draggable}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      data-task-id={task.id}
    >
      {draggable && <span className={styles.dragHandle} title="Versleep">⠿</span>}
      <div
        className={`${styles.taskCb} ${done ? styles.checked : ''}`}
        onClick={toggleDone}
        title={done ? 'Vink uit' : 'Vink af'}
      />
      <div className={`${styles.taskTitle} ${done ? styles.done : ''}`}>{task.title}</div>
      <span
        className={`${styles.prioPill} ${styles[prio]}`}
        onClick={(e) => { e.stopPropagation(); setPrioPopAnchor(e.currentTarget) }}
        title="Klik om prioriteit te wijzigen"
      >{prio}</span>
      <span
        className={`${styles.taskDeadline} ${task.deadline ? styles.set : ''} ${overdue ? styles.overdue : ''}`}
        onClick={(e) => { e.stopPropagation(); setDatePopAnchor(e.currentTarget) }}
        title={task.deadline ? 'Wijzig deadline' : 'Stel deadline in'}
      >{task.deadline ? fmtDate(task.deadline) : '+ datum'}</span>
      {actions}
      {!hideDelete && !actions && (
        <button className={styles.taskDel} onClick={remove} title="Verwijder">×</button>
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
          current={task.deadline || ''}
          onPick={updateDeadline}
          onClose={() => setDatePopAnchor(null)}
        />
      )}
    </div>
  )
}
