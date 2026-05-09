import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { SOURCE_LABEL_DONE } from '../../../lib/tasks'
import styles from './tasks.module.css'

export default function CompletionCandidates({ tasks }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const acceptOne = async (id) => {
    await supabase.from('tasks').update({ status: 'done', completion_candidate: false }).eq('id', id)
  }
  const rejectOne = async (id) => {
    await supabase.from('tasks').update({ completion_candidate: false, completion_rejected: true }).eq('id', id)
  }
  const acceptAll = async () => {
    if (!confirm(`${tasks.length} taken op klaar zetten?`)) return
    setBusy(true)
    try {
      const ids = tasks.map(t => t.id)
      await supabase.from('tasks').update({ status: 'done', completion_candidate: false }).in('id', ids)
    } finally { setBusy(false) }
  }
  const rejectAll = async () => {
    if (!confirm(`${tasks.length} taken behouden?`)) return
    setBusy(true)
    try {
      const ids = tasks.map(t => t.id)
      await supabase.from('tasks').update({ completion_candidate: false, completion_rejected: true }).in('id', ids)
    } finally { setBusy(false) }
  }

  return (
    <section
      className={styles.captureSection}
      style={{ background: open ? 'rgba(124,138,255,0.04)' : 'transparent' }}
    >
      <button type="button" onClick={() => setOpen(o => !o)} className={styles.sectionHeaderBtn}>
        <span className={styles.sectionChevron}>{open ? '▾' : '▸'}</span>
        <span style={{ fontWeight: 500 }}>✨ Mogelijk al klaar</span>
        <span className={styles.salesBadge}>{tasks.length}</span>
      </button>

      {open && (
        <div className={styles.sectionBody}>
          <div className={`muted ${styles.sectionHint}`}>
            Signalen uit andere systemen suggereren dat deze al gedaan zijn.
          </div>
          <div className={styles.allActionsRow}>
            <button className="btn btn--ghost" onClick={rejectAll} disabled={busy}>× alles behouden</button>
            <button className="btn btn--accent" onClick={acceptAll} disabled={busy}>✓ alles klaar</button>
          </div>
          <div className="stack stack--sm" style={{ gap: 6 }}>
            {tasks.map(t => (
              <CompletionCandidateRow
                key={t.id} task={t}
                onAccept={() => acceptOne(t.id)}
                onReject={() => rejectOne(t.id)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function CompletionCandidateRow({ task, onAccept, onReject }) {
  const [busy, setBusy] = useState(false)
  const conf = task.completion_confidence != null
    ? Math.round(task.completion_confidence * 100) : null

  return (
    <div className={`card ${styles.newlyFoundRowCard}`}>
      <div className={styles.rowContent}>
        <div style={{ fontWeight: 500, fontSize: 13 }}>{task.title}</div>
        <div className={`muted ${styles.rowMeta}`}>
          <span className={styles.accentText}>
            {SOURCE_LABEL_DONE[task.completion_source] || task.completion_source || 'signaal'}
          </span>
          {conf != null && <span style={{ marginLeft: 6 }}>({conf}% zeker)</span>}
          {task.completion_evidence && <span style={{ marginLeft: 6 }}>· {task.completion_evidence}</span>}
        </div>
      </div>
      {task.completion_evidence_url && (
        <a href={task.completion_evidence_url} target="_blank" rel="noreferrer" className={`muted ${styles.sourceUrlLink}`}>↗ bron</a>
      )}
      <button className="btn btn--ghost"
        onClick={async () => { setBusy(true); try { await onReject() } finally { setBusy(false) } }}
        disabled={busy}>× nee</button>
      <button className="btn btn--accent"
        onClick={async () => { setBusy(true); try { await onAccept() } finally { setBusy(false) } }}
        disabled={busy}>✓ klaar</button>
    </div>
  )
}
