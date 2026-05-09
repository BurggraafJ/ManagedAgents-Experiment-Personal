import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../lib/supabase'
import { BUCKET_TO_PRIORITY } from '../../../lib/tasks'
import NarrowTaskList from './NarrowTaskList'

// PriorityLane — één bucket (Klant/Hoog/Midden/Laag).
// Bevat live-rijen direct zichtbaar + ▸ Backlog ingeklapt.
export default function PriorityLane({ id, title, icon, accent, live, backlog, projects, defaultOpen = false, wide = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const [showBacklog, setShowBacklog] = useState(false)
  // Inline-add: 'live' of 'backlog' geeft aan welk + werd geklikt; null = dicht.
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

  const headerH = (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '10px 12px',
      borderBottom: open ? '1px solid var(--border)' : 'none',
    }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'transparent', border: 'none',
          cursor: 'pointer', color: 'var(--text)', padding: 0,
          flex: 1, textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontSize: 15 }}>{icon}</span>
        <span style={{ fontWeight: 600, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</span>
        <span style={{
          padding: '2px 8px', borderRadius: 10,
          fontSize: 11, fontWeight: 600,
          background: `${accent}22`, color: accent,
        }}>{live.length}</span>
      </button>
      <button
        type="button"
        onClick={() => setAddingMode(addingMode === 'live' ? null : 'live')}
        title="Nieuw item in deze prio"
        style={{
          background: addingMode === 'live' ? accent : 'transparent',
          color: addingMode === 'live' ? '#fff' : accent,
          border: `1px solid ${accent}`,
          borderRadius: 6,
          padding: '2px 8px',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >+ taak</button>
      <button
        type="button"
        onClick={() => setAddingMode(addingMode === 'backlog' ? null : 'backlog')}
        title="Nieuw item rechtstreeks naar backlog"
        style={{
          background: addingMode === 'backlog' ? 'var(--text-faint)' : 'transparent',
          color: addingMode === 'backlog' ? '#fff' : 'var(--text-faint)',
          border: '1px dashed var(--text-faint)',
          borderRadius: 6,
          padding: '2px 8px',
          fontSize: 11,
          cursor: 'pointer',
        }}
      >+ backlog</button>
    </div>
  )

  return (
    <section style={{
      border: '1px solid var(--border)',
      borderTop: `3px solid ${accent}`,
      borderRadius: 8,
      background: 'var(--card-bg, transparent)',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 60,
    }}>
      {headerH}

      {addingMode && (
        <form onSubmit={submitNew} style={{
          display: 'flex', gap: 6, padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(124,138,255,0.04)',
        }}>
          <input
            ref={newInputRef}
            className="input"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            placeholder={addingMode === 'backlog'
              ? `Nieuw ${title.toLowerCase()}-backlog item…`
              : `Nieuw ${title.toLowerCase()} item…`}
            style={{ flex: 1, fontSize: 13, padding: '6px 10px' }}
            onKeyDown={e => { if (e.key === 'Escape') setAddingMode(null) }}
          />
          <button type="submit" className="btn btn--accent" disabled={!newTitle.trim() || busy}
            style={{ padding: '6px 12px', fontSize: 12 }}>
            ↵ vangen
          </button>
        </form>
      )}

      {open && (
        <div style={{ padding: 10, flex: 1 }}>
          {live.length === 0 ? (
            <div className="muted" style={{ fontSize: 11, padding: '12px 4px', textAlign: 'center', fontStyle: 'italic' }}>
              Niets live in deze bucket.
            </div>
          ) : (
            <NarrowTaskList tasks={live} projects={projects} currentBucket={id} wide={wide} />
          )}

          {backlog.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                onClick={() => setShowBacklog(s => !s)}
                style={{
                  width: '100%',
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 10px',
                  background: 'transparent',
                  border: '1px dashed var(--border)',
                  borderRadius: 6,
                  cursor: 'pointer',
                  color: 'var(--text-faint)',
                  fontSize: 11,
                }}
              >
                <span>{showBacklog ? '▾' : '▸'}</span>
                <span>Backlog</span>
                <span style={{
                  padding: '0 6px', borderRadius: 8, fontSize: 10,
                  background: 'var(--border)', color: 'var(--text-faint)',
                }}>{backlog.length}</span>
              </button>
              {showBacklog && (
                <div style={{ marginTop: 6 }}>
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
