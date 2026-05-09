import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../lib/supabase'
import { BUCKET_TO_PRIORITY } from '../../../lib/tasks'
import styles from './tasks.module.css'
import NarrowTaskList from './NarrowTaskList'

export default function PriorityLane({ id, title, icon, accent, live, backlog, projects, defaultOpen = false, wide = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const [showBacklog, setShowBacklog] = useState(false)
  const [addingMode, setAddingMode] = useState(null)
  const [newTitle, setNewTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const newInputRef = useRef(null)

  useEffect(() => {
    if (addingMode) setTimeout(() => newInputRef.current?.focus(), 30)
  }, [addingMode])

  const submitNew = async (e) => {
    e?.preventDefault?.()
    const title = newTitle.trim()
    if (!title || busy) return
    setBusy(true)
    try {
      await supabase.from('tasks').insert({
        title,
        priority: BUCKET_TO_PRIORITY[id],
        in_backlog: addingMode === 'backlog',
        source: 'manual',
        ai_processed: false,
      })
      setNewTitle('')
      setAddingMode(null)
    } finally { setBusy(false) }
  }

  return (
    <section className={styles.laneSection} style={{ borderTop: `3px solid ${accent}` }}>
      <div
        className={styles.laneHeader}
        style={{ borderBottom: open ? '1px solid var(--border)' : 'none' }}
      >
        <button type="button" onClick={() => setOpen(o => !o)} className={styles.laneTitleBtn}>
          <span className={styles.laneChevron}>{open ? '▾' : '▸'}</span>
          <span className={styles.laneIcon}>{icon}</span>
          <span className={styles.laneTitle}>{title}</span>
          <span
            className={styles.laneBadge}
            style={{ background: `${accent}22`, color: accent }}
          >{live.length}</span>
        </button>
        <button
          type="button"
          onClick={() => setAddingMode(addingMode === 'live' ? null : 'live')}
          title="Nieuw item in deze prio"
          className={styles.laneAddBtn}
          style={{
            background: addingMode === 'live' ? accent : 'transparent',
            color: addingMode === 'live' ? '#fff' : accent,
            border: `1px solid ${accent}`,
          }}
        >+ taak</button>
        <button
          type="button"
          onClick={() => setAddingMode(addingMode === 'backlog' ? null : 'backlog')}
          title="Nieuw item rechtstreeks naar backlog"
          className={styles.laneAddBacklogBtn}
          style={{
            background: addingMode === 'backlog' ? 'var(--text-faint)' : 'transparent',
            color: addingMode === 'backlog' ? '#fff' : 'var(--text-faint)',
          }}
        >+ backlog</button>
      </div>

      {addingMode && (
        <form onSubmit={submitNew} className={styles.laneAddForm}>
          <input
            ref={newInputRef}
            className={`input ${styles.laneInput}`}
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder={addingMode === 'backlog'
              ? `Nieuw ${title.toLowerCase()}-backlog item…`
              : `Nieuw ${title.toLowerCase()} item…`}
            onKeyDown={e => { if (e.key === 'Escape') setAddingMode(null) }}
          />
          <button type="submit" className={`btn btn--accent ${styles.laneSubmitBtn}`} disabled={!newTitle.trim() || busy}>
            ↵ vangen
          </button>
        </form>
      )}

      {open && (
        <div className={styles.laneContent}>
          {live.length === 0 ? (
            <div className={`muted ${styles.laneEmpty}`}>
              Niets live in deze bucket.
            </div>
          ) : (
            <NarrowTaskList tasks={live} projects={projects} currentBucket={id} wide={wide} />
          )}

          {backlog.length > 0 && (
            <div className={styles.backlogSection}>
              <button
                type="button"
                onClick={() => setShowBacklog(s => !s)}
                className={styles.backlogToggleBtn}
              >
                <span>{showBacklog ? '▾' : '▸'}</span>
                <span>Backlog</span>
                <span className={styles.backlogBadge}>{backlog.length}</span>
              </button>
              {showBacklog && (
                <div className={styles.backlogList}>
                  <NarrowTaskList tasks={backlog} projects={projects} currentBucket={id} wide={wide} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
