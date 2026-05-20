import { useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import { dbPrioToMockup, fmtDate, isOverdueIso } from './v2-helpers'
import styles from './taken-v2.module.css'

/**
 * Eén task-row in v2-stijl. Reusable in Mijn / Projecten / Nieuw / Sales tabs.
 * Optionele actions slot voor Nieuw-gevonden bevestig/wijs-af buttons.
 */
export default function V2TaskRow({ task, actions, hideDelete }) {
  const prio = dbPrioToMockup(task.priority)
  const overdue = isOverdueIso(task.deadline)
  const done = task.status === 'done'

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

  const cyclePrio = useCallback(async (e) => {
    e?.stopPropagation?.()
    const order = ['high', 'normal', 'low']
    const cur = (task.priority || 'normal').toLowerCase()
    const idx = order.indexOf(cur)
    const next = order[(idx + 1) % order.length]
    await supabase.from('tasks').update({ priority: next }).eq('id', task.id)
  }, [task.id, task.priority])

  return (
    <div className={`${styles.taskRow} ${styles['prio' + prio.charAt(0).toUpperCase() + prio.slice(1)]} ${done ? styles.done : ''}`}>
      <div
        className={`${styles.taskCb} ${done ? styles.checked : ''}`}
        onClick={toggleDone}
        title={done ? 'Vink uit' : 'Vink af'}
      />
      <div className={`${styles.taskTitle} ${done ? styles.done : ''}`}>{task.title}</div>
      <span
        className={`${styles.prioPill} ${styles[prio]}`}
        onClick={cyclePrio}
        title="Klik om prioriteit te wijzigen"
      >{prio}</span>
      {task.deadline && (
        <span
          className={`${styles.taskDeadline} ${styles.set} ${overdue ? styles.overdue : ''}`}
          title="Deadline"
        >{fmtDate(task.deadline)}</span>
      )}
      {actions}
      {!hideDelete && !actions && (
        <button className={styles.taskDel} onClick={remove} title="Verwijder">×</button>
      )}
    </div>
  )
}
