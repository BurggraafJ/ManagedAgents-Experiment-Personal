import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { SOURCE_LABEL, shortTitle, formatDate } from '../../../lib/tasks'

// Newly-found — strikte filter + Houden / Backlog / Negeren met optimistic UI
export default function NewlyFoundSection({ passing, suppressed }) {
  const [open, setOpen] = useState(true)
  const [showAll, setShowAll] = useState(false)
  // Lokaal verwijderde IDs voor optimistic update.
  const [hidden, setHidden] = useState(() => new Set())

  const passingVisible    = passing.filter(t => !hidden.has(t.id))
  const suppressedVisible = suppressed.filter(t => !hidden.has(t.id))

  if (passingVisible.length === 0 && suppressedVisible.length === 0) return null

  const hideOne = (id) => setHidden(prev => { const next = new Set(prev); next.add(id); return next })

  const mutate = (patch) => async (id) => {
    hideOne(id)
    await supabase.from('tasks').update(patch).eq('id', id)
  }
  const keepOne    = mutate({ is_newly_found: false })
  const backlogOne = mutate({ is_newly_found: false, in_backlog: true })
  const dropOne    = mutate({ is_newly_found: false, status: 'dropped' })

  const dropAllSuppressed = async () => {
    if (suppressedVisible.length === 0) return
    if (!confirm(`${suppressedVisible.length} verborgen items in één keer weggooien?`)) return
    const ids = suppressedVisible.map(t => t.id)
    setHidden(prev => { const next = new Set(prev); ids.forEach(i => next.add(i)); return next })
    await supabase.from('tasks').update({ is_newly_found: false, status: 'dropped' }).in('id', ids)
  }

  const keepAllPassing = async () => {
    if (passingVisible.length === 0) return
    const ids = passingVisible.map(t => t.id)
    setHidden(prev => { const next = new Set(prev); ids.forEach(i => next.add(i)); return next })
    await supabase.from('tasks').update({ is_newly_found: false }).in('id', ids)
  }

  return (
    <section style={{
      border: '1px solid var(--accent)',
      borderRadius: 8,
      background: 'rgba(124,138,255,0.06)',
    }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', background: 'transparent', border: 'none',
          cursor: 'pointer', textAlign: 'left', color: 'var(--text)',
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--text-faint)', width: 12 }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontWeight: 600 }}>🆕 Nieuw gevonden</span>
        <span style={{
          padding: '2px 8px', borderRadius: 10,
          fontSize: 11, fontWeight: 600,
          background: 'var(--accent)', color: '#fff',
        }}>{passingVisible.length}</span>
        {suppressedVisible.length > 0 && (
          <span className="muted" style={{ fontSize: 11 }}>
            + {suppressedVisible.length} verborgen
          </span>
        )}
        <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>
          alleen taken die duidelijk voor Jelle zijn
        </span>
      </button>

      {open && (
        <div style={{ padding: '4px 14px 14px 14px' }}>
          {passingVisible.length > 0 ? (
            <>
              <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                Items met een duidelijk Jelle-signaal (eerstepersoons, naam, of korte actie-titel).
                Per stuk: behouden / naar backlog / weggooien.
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginBottom: 10 }}>
                <button className="btn btn--accent" onClick={keepAllPassing}>✓ alles behouden</button>
              </div>

              <div className="stack stack--sm" style={{ gap: 6 }}>
                {passingVisible.map(t => (
                  <NewlyFoundRow
                    key={t.id}
                    task={t}
                    onKeep={() => keepOne(t.id)}
                    onBacklog={() => backlogOne(t.id)}
                    onDrop={() => dropOne(t.id)}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="muted" style={{ fontSize: 12, padding: '6px 0' }}>
              Niets nieuws met duidelijk Jelle-signaal.
            </div>
          )}

          {suppressedVisible.length > 0 && (
            <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px dashed var(--border)' }}>
              <button
                type="button"
                onClick={() => setShowAll(s => !s)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'transparent', border: 'none',
                  cursor: 'pointer', color: 'var(--text-faint)', fontSize: 12,
                  padding: 0,
                }}
              >
                <span>{showAll ? '▾' : '▸'}</span>
                <span>{showAll ? 'Verborgen items inklappen' : `${suppressedVisible.length} verborgen items tonen`}</span>
                <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
                  (geen Jelle-signaal of dubbel met Postvak)
                </span>
              </button>

              {showAll && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, margin: '10px 0' }}>
                    <button className="btn btn--ghost" onClick={dropAllSuppressed}>× allemaal weggooien</button>
                  </div>
                  <div className="stack stack--sm" style={{ gap: 6 }}>
                    {suppressedVisible.map(t => (
                      <NewlyFoundRow
                        key={t.id}
                        task={t}
                        suppressed
                        onKeep={() => keepOne(t.id)}
                        onBacklog={() => backlogOne(t.id)}
                        onDrop={() => dropOne(t.id)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function NewlyFoundRow({ task, onKeep, onBacklog, onDrop, suppressed }) {
  const [busy, setBusy] = useState(false)
  const click = (fn) => async () => {
    if (busy) return
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }
  return (
    <div className="card" style={{
      padding: '8px 12px',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      opacity: suppressed ? 0.65 : 1,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          title={task.title}
          style={{
            fontWeight: 500, fontSize: 13,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {shortTitle(task.title, 70)}
        </div>
        <div className="muted" style={{ fontSize: 11, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ color: 'var(--accent)' }}>
            {task.source === 'fireflies' ? '🎙️ Fireflies' : SOURCE_LABEL[task.source] || task.source}
          </span>
          {task.discovered_at && <span style={{ marginLeft: 6 }}>· {formatDate(task.discovered_at.slice(0, 10))}</span>}
        </div>
      </div>
      {task.source_url && (
        <a href={task.source_url} target="_blank" rel="noreferrer" className="muted" style={{ fontSize: 11, flexShrink: 0 }}>
          ↗
        </a>
      )}
      <button className="btn btn--ghost" onClick={click(onDrop)} disabled={busy} title="Weggooien" style={{ padding: '4px 10px', fontSize: 11 }}>×</button>
      <button className="btn btn--ghost" onClick={click(onBacklog)} disabled={busy} title="Naar backlog" style={{ padding: '4px 10px', fontSize: 11 }}>↓</button>
      <button className="btn btn--accent" onClick={click(onKeep)} disabled={busy} title="Behouden als live" style={{ padding: '4px 12px', fontSize: 11 }}>✓ houden</button>
    </div>
  )
}
