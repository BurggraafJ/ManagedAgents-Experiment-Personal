import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { SOURCE_LABEL, shortTitle, formatDate } from '../../../lib/tasks'
import styles from './tasks.module.css'

export default function NewlyFoundSection({ passing, suppressed }) {
  const [open, setOpen] = useState(true)
  const [showAll, setShowAll] = useState(false)
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
    <section className={styles.newlySection}>
      <button type="button" onClick={() => setOpen(o => !o)} className={styles.sectionHeaderBtn}>
        <span className={styles.sectionChevron}>{open ? '▾' : '▸'}</span>
        <span style={{ fontWeight: 600 }}>🆕 Nieuw gevonden</span>
        <span className={styles.newlyBadge}>{passingVisible.length}</span>
        {suppressedVisible.length > 0 && (
          <span className="muted" style={{ fontSize: 11 }}>
            + {suppressedVisible.length} verborgen
          </span>
        )}
        <span className={`muted ${styles.headerDesc}`}>
          alleen taken die duidelijk voor Jelle zijn
        </span>
      </button>

      {open && (
        <div className={styles.sectionBody}>
          {passingVisible.length > 0 ? (
            <>
              <div className={`muted ${styles.sectionHint}`}>
                Items met een duidelijk Jelle-signaal (eerstepersoons, naam, of korte actie-titel).
                Per stuk: behouden / naar backlog / weggooien.
              </div>

              <div className={styles.allActionsRow}>
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
            <div className={`muted ${styles.sectionHint}`} style={{ padding: '6px 0' }}>
              Niets nieuws met duidelijk Jelle-signaal.
            </div>
          )}

          {suppressedVisible.length > 0 && (
            <div className={styles.suppressedSection}>
              <button type="button" onClick={() => setShowAll(s => !s)} className={styles.suppressedToggleBtn}>
                <span>{showAll ? '▾' : '▸'}</span>
                <span>{showAll ? 'Verborgen items inklappen' : `${suppressedVisible.length} verborgen items tonen`}</span>
                <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
                  (geen Jelle-signaal of dubbel met Postvak)
                </span>
              </button>

              {showAll && (
                <>
                  <div className={styles.suppressedActionsRow}>
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
    <div className={`card ${styles.newlyFoundRowCard}`} style={{ opacity: suppressed ? 0.65 : 1 }}>
      <div className={styles.rowContent}>
        <div title={task.title} className={styles.rowTitle}>
          {shortTitle(task.title, 70)}
        </div>
        <div className={`muted ${styles.rowMeta}`}>
          <span className={styles.accentText}>
            {task.source === 'fireflies' ? '🎙️ Fireflies' : SOURCE_LABEL[task.source] || task.source}
          </span>
          {task.discovered_at && <span style={{ marginLeft: 6 }}>· {formatDate(task.discovered_at.slice(0, 10))}</span>}
        </div>
      </div>
      {task.source_url && (
        <a href={task.source_url} target="_blank" rel="noreferrer" className={`muted ${styles.sourceUrlLink}`}>↗</a>
      )}
      <button className={`btn btn--ghost ${styles.btnSm}`} onClick={click(onDrop)} disabled={busy} title="Weggooien">×</button>
      <button className={`btn btn--ghost ${styles.btnSm}`} onClick={click(onBacklog)} disabled={busy} title="Naar backlog">↓</button>
      <button className={`btn btn--accent ${styles.btnSm}`} style={{ padding: '4px 12px' }} onClick={click(onKeep)} disabled={busy} title="Behouden als live">✓ houden</button>
    </div>
  )
}
