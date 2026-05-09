import { useState, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import styles from './tasks.module.css'

export default function ProjectsAdmin({ projects, tasks }) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('')
  const [hint, setHint] = useState('')
  const [busy, setBusy] = useState(false)

  const add = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      await supabase.from('task_projects').insert({
        name: name.trim(),
        icon: icon.trim() || null,
        ai_match_hint: hint.trim() || null,
        sort_order: 100 + (projects.length || 0),
      })
      setName(''); setIcon(''); setHint(''); setAdding(false)
    } finally { setBusy(false) }
  }

  const counts = useMemo(() => {
    const c = {}
    for (const t of tasks) {
      if (t.status === 'done' || t.status === 'dropped') continue
      if (t.project_id) c[t.project_id] = (c[t.project_id] || 0) + 1
    }
    return c
  }, [tasks])

  return (
    <section
      className={styles.captureSection}
      style={{ background: open ? 'rgba(124,138,255,0.03)' : 'transparent' }}
    >
      <button type="button" onClick={() => setOpen(o => !o)} className={styles.sectionHeaderBtn}>
        <span className={styles.sectionChevron}>{open ? '▾' : '▸'}</span>
        <span style={{ fontWeight: 500 }}>📁 Projecten</span>
        <span className="muted" style={{ fontSize: 11 }}>{projects.length}</span>
        <span className={`muted ${styles.headerDesc}`}>
          {open ? '' : 'klik om te beheren'}
        </span>
      </button>

      {open && (
        <div className={styles.sectionBody}>
          <div className={styles.addRow}>
            <button className="btn btn--ghost" onClick={() => setAdding(a => !a)}>
              {adding ? '× annuleer' : '+ nieuw project'}
            </button>
          </div>

          {adding && (
            <div className="card" style={{ padding: 'var(--s-4)', marginBottom: 8 }}>
              <div className={styles.iconNameGrid}>
                <input className="input" placeholder="🌱" value={icon} onChange={e => setIcon(e.target.value)} />
                <input className="input" placeholder="Naam" value={name} onChange={e => setName(e.target.value)} />
              </div>
              <textarea
                className={`input ${styles.hintTextarea}`}
                rows={2}
                value={hint}
                onChange={e => setHint(e.target.value)}
                placeholder="AI match hint — wat hoort bij dit project?"
              />
              <div className={styles.saveRow}>
                <button className="btn btn--accent" onClick={add} disabled={!name.trim() || busy}>
                  {busy ? '…' : 'aanmaken'}
                </button>
              </div>
            </div>
          )}

          <div className="stack stack--sm">
            {projects.map(p => (
              <ProjectAdminRow key={p.id} project={p} count={counts[p.id] || 0} />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

function ProjectAdminRow({ project, count }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({
    name: project.name,
    icon: project.icon || '',
    color: project.color || '#7c8aff',
    ai_match_hint: project.ai_match_hint || '',
    description: project.description || '',
    deadline: project.deadline || '',
    status: project.status || 'active',
  })

  const save = async () => {
    await supabase.from('task_projects').update({
      name: draft.name.trim(),
      icon: draft.icon || null,
      color: draft.color || null,
      ai_match_hint: draft.ai_match_hint || null,
      description: draft.description || null,
      deadline: draft.deadline || null,
      status: draft.status,
    }).eq('id', project.id)
    setEditing(false)
  }

  if (!editing) {
    return (
      <div className={`card ${styles.projectRowCard}`}>
        <span className={styles.projectIcon}>{project.icon || '·'}</span>
        <div className={styles.projectNameCell}>
          <div style={{ fontWeight: 500 }}>{project.name}</div>
          {project.ai_match_hint && (
            <div className={`muted ${styles.projectHint}`}>{project.ai_match_hint}</div>
          )}
        </div>
        <span className="muted" style={{ fontSize: 12 }}>{count} open</span>
        {project.status === 'archived' && <span className="pill s-idle">archief</span>}
        <button className="btn btn--ghost" onClick={() => setEditing(true)}>bewerk</button>
      </div>
    )
  }

  return (
    <div className="card" style={{ padding: 12 }}>
      <div className={styles.editGrid}>
        <input className="input" value={draft.icon}  onChange={e => setDraft({ ...draft, icon: e.target.value })}  placeholder="emoji" />
        <input className="input" value={draft.color} onChange={e => setDraft({ ...draft, color: e.target.value })} placeholder="#7c8aff" />
        <input className="input" value={draft.name}  onChange={e => setDraft({ ...draft, name: e.target.value })} />
        <select className="input" value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}>
          <option value="active">actief</option>
          <option value="archived">archief</option>
        </select>
      </div>
      <textarea
        className={`input ${styles.editHintTextarea}`}
        rows={2}
        value={draft.ai_match_hint}
        onChange={e => setDraft({ ...draft, ai_match_hint: e.target.value })}
        placeholder="AI match hint"
      />
      <input
        className={`input ${styles.editDateInput}`}
        type="date" value={draft.deadline}
        onChange={e => setDraft({ ...draft, deadline: e.target.value })}
      />
      <div className={styles.editActions}>
        <button className="btn btn--ghost" onClick={() => setEditing(false)}>annuleer</button>
        <button className="btn btn--accent" onClick={save}>opslaan</button>
      </div>
    </div>
  )
}
