import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { STATUS_LABEL, PRIORITY_LABEL, EFFORT_LABEL } from '../../../lib/tasks'
import styles from './tasks.module.css'

export default function TaskEditor({ task, projects, onClose }) {
  const [draft, setDraft] = useState({
    title:    task.title || '',
    notes:    task.notes || '',
    project_id: task.project_id || '',
    priority: task.priority || 'normal',
    effort:   task.effort || '',
    deadline: task.deadline || '',
    do_date:  task.do_date  || '',
    tags:     (task.tags || []).join(' '),
    status:   task.status || 'open',
    category: task.category || '',
    in_backlog: !!task.in_backlog,
  })
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      const patch = {
        title: draft.title.trim(),
        notes: draft.notes.trim() || null,
        project_id: draft.project_id || null,
        priority: draft.priority,
        effort: draft.effort || null,
        deadline: draft.deadline || null,
        do_date:  draft.do_date  || null,
        status:   draft.status,
        category: draft.category || null,
        in_backlog: !!draft.in_backlog,
        tags: draft.tags.trim()
          ? draft.tags.trim().split(/\s+/).map(s => s.replace(/^#/, '').toLowerCase()).filter(Boolean)
          : [],
        ai_processed: true,
      }
      await supabase.from('tasks').update(patch).eq('id', task.id)
      onClose?.()
    } finally {
      setBusy(false)
    }
  }

  const drop = async () => {
    if (!confirm('Taak weggooien?')) return
    await supabase.from('tasks').update({ status: 'dropped' }).eq('id', task.id)
    onClose?.()
  }

  const reopen = async () => {
    await supabase.from('tasks').update({ ai_processed: false }).eq('id', task.id)
  }

  return (
    <div className={styles.editorGrid}>
      <label className={`stack stack--xs ${styles.editorFullSpan}`}>
        <span className={`muted ${styles.labelSm}`}>Titel</span>
        <input className="input" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
      </label>
      <label className={`stack stack--xs ${styles.editorFullSpan}`}>
        <span className={`muted ${styles.labelSm}`}>Notities</span>
        <textarea
          className="input" rows={3}
          value={draft.notes}
          onChange={e => setDraft({ ...draft, notes: e.target.value })}
        />
      </label>
      <label className="stack stack--xs">
        <span className={`muted ${styles.labelSm}`}>Project</span>
        <select className="input" value={draft.project_id} onChange={e => setDraft({ ...draft, project_id: e.target.value })}>
          <option value="">— geen —</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
        </select>
      </label>
      <label className="stack stack--xs">
        <span className={`muted ${styles.labelSm}`}>Status</span>
        <select className="input" value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="stack stack--xs">
        <span className={`muted ${styles.labelSm}`}>Prioriteit</span>
        <select className="input" value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value })}>
          {Object.entries(PRIORITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="stack stack--xs">
        <span className={`muted ${styles.labelSm}`}>Categorie</span>
        <select className="input" value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })}>
          <option value="">— geen —</option>
          <option value="klant">🤝 klant</option>
        </select>
      </label>
      <label className="stack stack--xs">
        <span className={`muted ${styles.labelSm}`}>Effort</span>
        <select className="input" value={draft.effort} onChange={e => setDraft({ ...draft, effort: e.target.value })}>
          <option value="">—</option>
          {Object.entries(EFFORT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className={`stack stack--xs ${styles.checkboxLabel}`}>
        <input
          type="checkbox"
          checked={!!draft.in_backlog}
          onChange={e => setDraft({ ...draft, in_backlog: e.target.checked })}
        />
        <span className={`muted ${styles.labelSm}`}>Op backlog (ingeklapt onder bucket)</span>
      </label>
      <label className="stack stack--xs">
        <span className={`muted ${styles.labelSm}`}>Doe-datum</span>
        <input className="input" type="date" value={draft.do_date} onChange={e => setDraft({ ...draft, do_date: e.target.value })} />
      </label>
      <label className="stack stack--xs">
        <span className={`muted ${styles.labelSm}`}>Deadline</span>
        <input className="input" type="date" value={draft.deadline} onChange={e => setDraft({ ...draft, deadline: e.target.value })} />
      </label>
      <label className={`stack stack--xs ${styles.editorFullSpan}`}>
        <span className={`muted ${styles.labelSm}`}>Tags (spatie-gescheiden)</span>
        <input className="input" value={draft.tags} onChange={e => setDraft({ ...draft, tags: e.target.value })} placeholder="bv. opvolg klant-x" />
      </label>

      {task.ai_reasoning && (
        <div className={`muted ${styles.aiReasoning}`}>
          AI: {task.ai_reasoning}
        </div>
      )}
      {task.source_url && (
        <div className={styles.sourceRef}>
          <a href={task.source_url} target="_blank" rel="noreferrer" className="muted">↗ bron</a>
        </div>
      )}

      <div className={styles.editorActions}>
        <button className="btn btn--ghost" onClick={reopen} title="Markeer voor AI-herindeling">↻ AI opnieuw</button>
        <button className={`btn btn--ghost ${styles.btnDanger}`} onClick={drop}>weggooien</button>
        <button className="btn btn--ghost" onClick={onClose}>annuleer</button>
        <button className="btn btn--accent" onClick={save} disabled={busy}>{busy ? '…' : 'opslaan'}</button>
      </div>
    </div>
  )
}
