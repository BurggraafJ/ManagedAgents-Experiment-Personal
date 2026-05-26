import { useCallback, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { dbPrioToMockup, mockupPrioToDb, fmtDeadlineLabel, dateUrgencyKind, playSuccessChime } from './v2-helpers'
import V2PrioPop from './V2PrioPop'
import V2DatePop from './V2DatePop'
import V2TypePop, { TYPE_BY_ID } from './V2TypePop'
import V2ConfirmModal from './V2ConfirmModal'
import styles from './taken-v2.module.css'

/**
 * Eén task-row. Optimistic-state komt uit de parent (applyOptimistic prop)
 * zodat filter/groep-bucketing meteen mee-reageert — geen flicker tussen
 * row-state en parent-state.
 */
export default function V2TaskRow({ task, actions, hideDelete, draggable = false, applyOptimistic }) {
  const [prioPopAnchor, setPrioPopAnchor] = useState(null)
  const [datePopAnchor, setDatePopAnchor] = useState(null)
  const [typePopAnchor, setTypePopAnchor] = useState(null)
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [confirmDel, setConfirmDel] = useState(false)
  const [justDone, setJustDone] = useState(false)

  const t = task  // task is al merged in parent (useOptimisticTasks)
  const prio = dbPrioToMockup(t.priority)
  const kind = t.deadline_kind || 'day'
  const urgency = dateUrgencyKind(t.deadline, kind)  // overdue | today | tomorrow | future | null
  const done = t.status === 'done'
  const inBacklog = !!t.in_backlog
  const prioCls = 'prio' + prio.charAt(0).toUpperCase() + prio.slice(1)

  // Centrale mutate-helper: optimistic → supabase update
  const mutate = useCallback(async (patch) => {
    if (applyOptimistic) applyOptimistic(task.id, patch)
    await supabase.from('tasks').update(patch).eq('id', task.id)
  }, [task.id, applyOptimistic])

  const toggleDone = useCallback(async (e) => {
    e?.stopPropagation?.()
    if (!done) {
      // Markeren als afgerond → fade-out animatie + success chime,
      // pas dan supabase update (anders zou de row direct uit de lijst verdwijnen)
      setJustDone(true)
      playSuccessChime()
      setTimeout(async () => {
        await mutate({ status: 'done', completed_at: new Date().toISOString() })
      }, 480)
    } else {
      // Heropenen: meteen, geen animatie
      await mutate({ status: 'open', completed_at: null })
    }
  }, [done, mutate])

  const askRemove = useCallback((e) => {
    e?.stopPropagation?.()
    setConfirmDel(true)
  }, [])
  const confirmRemove = useCallback(async () => {
    setConfirmDel(false)
    await mutate({ status: 'dropped' })
  }, [mutate])

  const toggleBacklog = useCallback(async (e) => {
    e?.stopPropagation?.()
    await mutate({ in_backlog: !inBacklog })
  }, [inBacklog, mutate])

  const updatePrio = useCallback(async (mockupPrio) => {
    await mutate({ priority: mockupPrioToDb(mockupPrio) })
  }, [mutate])

  const updateDeadline = useCallback(async (newDate, newKind = 'day') => {
    await mutate({ deadline: newDate || null, deadline_kind: newDate ? newKind : 'day' })
  }, [mutate])

  const updateType = useCallback(async (newType) => {
    // Bij handmatige pick: type + suggested=false (= definitief)
    await mutate({ task_type: newType, task_type_suggested: false })
  }, [mutate])

  const confirmType = useCallback(async () => {
    // Eén klik op AI-suggestie = bevestigen zonder dropdown
    await mutate({ task_type_suggested: false })
  }, [mutate])

  const handleTypePillClick = useCallback((e) => {
    e.stopPropagation()
    if (t.task_type && t.task_type_suggested) {
      // AI-suggestie → één klik bevestigt 'm
      confirmType()
    } else {
      // Geen type of al bevestigd → dropdown openen
      setTypePopAnchor(e.currentTarget)
    }
  }, [t.task_type, t.task_type_suggested, confirmType])

  const startEdit = useCallback(() => {
    setDraftTitle(t.title || '')
    setEditing(true)
  }, [t.title])
  const saveEdit = useCallback(async () => {
    const newTitle = draftTitle.trim()
    setEditing(false)
    if (!newTitle || newTitle === t.title) return
    await mutate({ title: newTitle })
  }, [draftTitle, t.title, mutate])
  const cancelEdit = useCallback(() => {
    setEditing(false)
    setDraftTitle('')
  }, [])

  const handleDragStart = (e) => {
    if (!draggable) return
    e.dataTransfer.setData('text/plain', task.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  const urgencyRowCls = urgency ? styles['row' + urgency.charAt(0).toUpperCase() + urgency.slice(1)] : ''

  return (
    <div
      className={`${styles.taskRow} ${styles[prioCls]} ${urgencyRowCls} ${done ? styles.done : ''} ${justDone ? styles.justDone : ''}`}
      draggable={draggable}
      onDragStart={handleDragStart}
      data-task-id={task.id}
    >
      {draggable && <span className={styles.dragHandle} title="Versleep">⠿</span>}
      <div
        className={`${styles.taskCb} ${done ? styles.checked : ''}`}
        onClick={toggleDone}
        title={done ? 'Vink uit' : 'Vink af'}
      />
      {editing ? (
        <input
          type="text"
          className={styles.taskTitleInput}
          value={draftTitle}
          autoFocus
          onChange={e => setDraftTitle(e.target.value)}
          onBlur={saveEdit}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); saveEdit() }
            if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
          }}
          onClick={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
        />
      ) : (
        <div
          className={`${styles.taskTitle} ${done ? styles.done : ''}`}
          onMouseDown={e => {
            // Voorkom dat outer-row een drag start tijdens een dubbelklik
            if (e.detail >= 2) e.preventDefault()
          }}
          onDoubleClick={e => {
            e.stopPropagation()
            e.preventDefault()
            startEdit()
          }}
          title="Dubbelklik om naam te bewerken"
        >{t.title}</div>
      )}
      <span
        className={[
          styles.typePill,
          t.task_type && styles.typePillSet,
          t.task_type && t.task_type_suggested && styles.typePillSuggested,
        ].filter(Boolean).join(' ')}
        onClick={handleTypePillClick}
        onContextMenu={(e) => {
          // Right-click op een AI-suggestie = dropdown om te wijzigen
          if (t.task_type && t.task_type_suggested) {
            e.preventDefault()
            e.stopPropagation()
            setTypePopAnchor(e.currentTarget)
          }
        }}
        title={
          t.task_type && t.task_type_suggested
            ? 'AI-voorstel — klik om te bevestigen, rechts-klik om te wijzigen'
            : t.task_type
              ? 'Klik om type te wijzigen'
              : 'Stel type in'
        }
      >
        {t.task_type
          ? <>{TYPE_BY_ID[t.task_type]?.icon || '•'} <span>{TYPE_BY_ID[t.task_type]?.label || t.task_type}</span></>
          : <>+ type</>}
      </span>
      <span
        className={`${styles.prioPill} ${styles[prio]}`}
        onClick={(e) => { e.stopPropagation(); setPrioPopAnchor(e.currentTarget) }}
        title="Klik om prioriteit te wijzigen"
      >{prio}</span>
      <span
        className={[
          styles.taskDeadline,
          t.deadline && styles.set,
          urgency && styles[urgency],
        ].filter(Boolean).join(' ')}
        onClick={(e) => { e.stopPropagation(); setDatePopAnchor(e.currentTarget) }}
        title={t.deadline ? 'Wijzig deadline' : 'Stel deadline in'}
      >{t.deadline ? fmtDeadlineLabel(t.deadline, kind) : '+ datum'}</span>
      {actions}
      {!actions && !hideDelete && (
        <>
          <button
            className={`${styles.taskDoneBtn} ${done ? styles.checked : ''}`}
            onClick={toggleDone}
            title={done ? 'Heropen' : 'Markeer als afgerond'}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </button>
          <button
            className={styles.taskBacklogBtn}
            onClick={toggleBacklog}
            title={inBacklog ? 'Terug uit backlog' : 'Naar backlog'}
          >{inBacklog ? '↑' : '↓'}</button>
          <button className={styles.taskDel} onClick={askRemove} title="Verwijder">×</button>
        </>
      )}

      <V2ConfirmModal
        open={confirmDel}
        title="Taak verwijderen?"
        body={
          <>
            <p style={{ margin: '0 0 8px' }}>
              <strong>{t.title}</strong>
            </p>
            <p style={{ margin: 0, color: 'var(--tv2-neutral-500)' }}>
              Je kunt 'm 14 dagen lang terughalen vanuit de tab <strong>Verwijderd</strong>. Daarna gaat hij definitief weg.
            </p>
          </>
        }
        confirmLabel="Verwijderen"
        confirmTone="danger"
        onConfirm={confirmRemove}
        onCancel={() => setConfirmDel(false)}
      />

      {prioPopAnchor && (
        <V2PrioPop
          anchor={prioPopAnchor}
          current={prio}
          onPick={updatePrio}
          onClose={() => setPrioPopAnchor(null)}
        />
      )}
      {datePopAnchor && (
        <V2DatePop
          anchor={datePopAnchor}
          current={t.deadline || ''}
          currentKind={kind}
          onPick={updateDeadline}
          onClose={() => setDatePopAnchor(null)}
        />
      )}
      {typePopAnchor && (
        <V2TypePop
          anchor={typePopAnchor}
          current={t.task_type || null}
          onPick={updateType}
          onClose={() => setTypePopAnchor(null)}
        />
      )}
    </div>
  )
}
