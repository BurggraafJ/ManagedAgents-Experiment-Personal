import { useCallback, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { dbPrioToMockup, mockupPrioToDb, playSuccessChime } from './v2-helpers'
import { dueOf } from '../../../lib/taskViews'
import V2PrioPop from './V2PrioPop'
import V2DatePop from './V2DatePop'
import V2TypePop, { TYPE_BY_ID } from './V2TypePop'
import V2ConfirmModal from './V2ConfirmModal'
import styles from './taken-v2.module.css'
import pops from './taken-v2-pops.module.css'

/**
 * Eén task-row (A2-look: hairline, ronde afvinkcirkel, datum rechts).
 * Optimistic-state komt uit de parent (applyOptimistic prop) zodat filter/
 * groep-bucketing meteen mee-reageert.
 *   variant 'mijn'  → taaktype als grijze subregel (klik = type wijzigen)
 *   variant 'board' → rood bolletje bij prio Hoog, geen subregel
 * Alle acties blijven: afvinken, dubbelklik-titel, type, prio, deadline,
 * backlog, verwijderen (met bevestiging), ⋯ detail, drag.
 */
export default function V2TaskRow({ task, hideDelete, draggable = false, variant = 'mijn', applyOptimistic, onOpenDetail }) {
  const [prioPopAnchor, setPrioPopAnchor] = useState(null)
  const [datePopAnchor, setDatePopAnchor] = useState(null)
  const [typePopAnchor, setTypePopAnchor] = useState(null)
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const [justDone, setJustDone] = useState(false)

  const t = task
  const prio = dbPrioToMockup(t.priority)
  const kind = t.deadline_kind || 'day'
  const due = dueOf(t)
  const done = t.status === 'done'
  const inBacklog = !!t.in_backlog
  const typeMeta = t.task_type ? TYPE_BY_ID[t.task_type] : null

  const mutate = useCallback(async (patch) => {
    if (applyOptimistic) applyOptimistic(task.id, patch)
    await supabase.from('tasks').update(patch).eq('id', task.id)
  }, [task.id, applyOptimistic])

  const toggleDone = useCallback(async (e) => {
    e?.stopPropagation?.()
    if (!done) {
      setJustDone(true)
      playSuccessChime()
      setTimeout(async () => { await mutate({ status: 'done', completed_at: new Date().toISOString() }) }, 480)
    } else {
      await mutate({ status: 'open', completed_at: null })
    }
  }, [done, mutate])

  const confirmRemove = useCallback(async () => { setConfirmDel(false); await mutate({ status: 'dropped' }) }, [mutate])
  const toggleBacklog = useCallback(async (e) => { e?.stopPropagation?.(); await mutate({ in_backlog: !inBacklog }) }, [inBacklog, mutate])
  const updatePrio = useCallback(async (p) => { await mutate({ priority: mockupPrioToDb(p) }) }, [mutate])
  const updateDeadline = useCallback(async (d, k = 'day') => { await mutate({ deadline: d || null, deadline_kind: d ? k : 'day' }) }, [mutate])
  const updateType = useCallback(async (nt) => { await mutate({ task_type: nt, task_type_suggested: false }) }, [mutate])

  const handleTypeClick = useCallback((e) => {
    e.stopPropagation()
    // AI-suggestie → één klik bevestigt; anders dropdown
    if (t.task_type && t.task_type_suggested) mutate({ task_type_suggested: false })
    else setTypePopAnchor(e.currentTarget)
  }, [t.task_type, t.task_type_suggested, mutate])

  const startEdit = useCallback(() => { setDraftTitle(t.title || ''); setEditing(true) }, [t.title])
  const saveEdit = useCallback(async () => {
    const nt = draftTitle.trim()
    setEditing(false)
    if (!nt || nt === t.title) return
    await mutate({ title: nt })
  }, [draftTitle, t.title, mutate])

  const handleDragStart = (e) => {
    if (!draggable) return
    e.dataTransfer.setData('text/plain', task.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  return (
    <div
      className={[styles.row, done && styles.rowDone, justDone && styles.justDone, inBacklog && styles.rowBacklog].filter(Boolean).join(' ')}
      draggable={draggable}
      onDragStart={handleDragStart}
      data-task-id={task.id}
    >
      <button
        type="button"
        className={`${styles.check} ${done ? styles.checked : ''}`}
        onClick={toggleDone}
        title={done ? 'Heropen' : 'Markeer als afgerond'}
        aria-label={done ? 'Heropen' : 'Afvinken'}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
      </button>

      <div className={styles.rowMain}>
        {editing ? (
          <input
            type="text"
            className={styles.titleInput}
            value={draftTitle}
            autoFocus
            onChange={e => setDraftTitle(e.target.value)}
            onBlur={saveEdit}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); saveEdit() }
              if (e.key === 'Escape') { e.preventDefault(); setEditing(false) }
            }}
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
          />
        ) : (
          <div
            className={`${styles.title} ${done ? styles.titleDone : ''}`}
            onMouseDown={e => { if (e.detail >= 2) e.preventDefault() }}
            onDoubleClick={e => { e.stopPropagation(); e.preventDefault(); startEdit() }}
            title="Dubbelklik om naam te bewerken"
          >
            {variant === 'board' && prio === 'hoog' && <span className={styles.prioDotInline} aria-label="Hoog" />}
            {t.title}
          </div>
        )}
        {variant === 'mijn' && (
          <button
            type="button"
            className={[styles.typeSub, t.task_type && t.task_type_suggested && styles.typeSuggested].filter(Boolean).join(' ')}
            onClick={handleTypeClick}
            onContextMenu={(e) => {
              if (t.task_type && t.task_type_suggested) { e.preventDefault(); e.stopPropagation(); setTypePopAnchor(e.currentTarget) }
            }}
            title={t.task_type && t.task_type_suggested ? 'AI-voorstel — klik om te bevestigen, rechts-klik om te wijzigen' : t.task_type ? 'Klik om type te wijzigen' : 'Stel type in'}
          >{typeMeta ? typeMeta.label : t.task_type || '+ type'}</button>
        )}
      </div>

      <div className={styles.rowActions} onClick={e => e.stopPropagation()}>
        <span className={`${pops.prioPill} ${pops[prio]}`} onClick={(e) => setPrioPopAnchor(e.currentTarget)} title="Klik om prioriteit te wijzigen">{prio}</span>
        {onOpenDetail && (
          <button type="button" className={styles.iconBtn} onClick={() => onOpenDetail(task.id)} title="Open details + notities">⋯</button>
        )}
        {!hideDelete && (
          <>
            <button type="button" className={styles.iconBtn} onClick={toggleBacklog} title={inBacklog ? 'Terug uit backlog' : 'Naar backlog'}>{inBacklog ? '↑' : '↓'}</button>
            <button type="button" className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => setConfirmDel(true)} title="Verwijder">×</button>
          </>
        )}
      </div>

      <button
        type="button"
        className={`${styles.due} ${styles['due_' + due.bucket] || ''} ${t.deadline ? '' : styles.dueNone}`}
        onClick={(e) => { e.stopPropagation(); setDatePopAnchor(e.currentTarget) }}
        title={t.deadline ? 'Wijzig deadline' : 'Stel deadline in'}
      >{due.bucket === 'none' ? '—' : due.label}</button>

      <V2ConfirmModal
        open={confirmDel}
        title="Taak verwijderen?"
        body={
          <>
            <p style={{ margin: '0 0 8px' }}><strong>{t.title}</strong></p>
            <p style={{ margin: 0, color: 'var(--tv2-neutral-500)' }}>
              Je kunt 'm 14 dagen lang terughalen via <strong>⋯ → Verwijderd</strong>. Daarna gaat hij definitief weg.
            </p>
          </>
        }
        confirmLabel="Verwijderen"
        confirmTone="danger"
        onConfirm={confirmRemove}
        onCancel={() => setConfirmDel(false)}
      />
      {prioPopAnchor && <V2PrioPop anchor={prioPopAnchor} current={prio} onPick={updatePrio} onClose={() => setPrioPopAnchor(null)} />}
      {datePopAnchor && <V2DatePop anchor={datePopAnchor} current={t.deadline || ''} currentKind={kind} onPick={updateDeadline} onClose={() => setDatePopAnchor(null)} />}
      {typePopAnchor && <V2TypePop anchor={typePopAnchor} current={t.task_type || null} onPick={updateType} onClose={() => setTypePopAnchor(null)} />}
    </div>
  )
}
