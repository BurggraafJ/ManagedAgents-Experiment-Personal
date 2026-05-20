import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { formatDate, SOURCE_LABEL } from '../../../lib/tasks'
import styles from './tasks.module.css'

/**
 * Tab "Afgeronde taken" — log van tasks met status='done', laatste 50.
 * Per rij: titel doorgekrast + bron + voltooid-datum + herstel-knop.
 */
export default function AfgerondTab({ tasks }) {
  const done = tasks
    .filter(t => t.status === 'done')
    .sort((a, b) => new Date(b.completed_at || b.updated_at) - new Date(a.completed_at || a.updated_at))
    .slice(0, 50)

  if (done.length === 0) {
    return <div className="empty">Nog geen afgeronde taken.</div>
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      {done.map(t => <DoneRow key={t.id} task={t} />)}
    </div>
  )
}

function DoneRow({ task }) {
  const [busy, setBusy] = useState(false)
  const restore = async () => {
    if (busy) return
    setBusy(true)
    try {
      await supabase.from('tasks')
        .update({ status: 'open', completed_at: null })
        .eq('id', task.id)
    } finally { setBusy(false) }
  }
  const when = task.completed_at || task.updated_at
  return (
    <div className={`card ${styles.doneRow}`}>
      <span className={styles.doneTitle}>{task.title}</span>
      <span className={`muted ${styles.doneSource}`}>
        {SOURCE_LABEL[task.source] || task.source}
      </span>
      <span className={`muted ${styles.doneDate}`}>{when ? formatDate(when.slice(0, 10)) : ''}</span>
      <button
        className={`btn btn--ghost ${styles.doneRestore}`}
        onClick={restore}
        disabled={busy}
        title="Heropen taak"
      >↺ herstel</button>
    </div>
  )
}
