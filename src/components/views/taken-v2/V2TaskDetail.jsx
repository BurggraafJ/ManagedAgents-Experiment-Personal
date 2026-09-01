import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from '../../../lib/supabase'
import { dbPrioToMockup, mockupPrioToDb, fmtDeadlineLabel, dateUrgencyKind } from './v2-helpers'
import V2PrioPop from './V2PrioPop'
import V2DatePop from './V2DatePop'
import V2TypePop, { TYPE_BY_ID } from './V2TypePop'
import { SOURCE_LABEL } from '../../../lib/tasks'
import styles from './taken-v2-pops.module.css'

/**
 * Generiek side-panel detail voor een task (mini-Jira-style).
 * Slide-in vanuit rechts, met beschrijving, meta + tags.
 * Auto-save op blur voor title + notes.
 * `project` is optioneel — zonder project toont de header een bron-badge.
 */
export default function V2TaskDetail({ task, project, onClose, applyOptimistic }) {
  const [draftTitle, setDraftTitle] = useState(task.title || '')
  const [draftNotes, setDraftNotes] = useState(task.notes || '')
  const [tagsInput, setTagsInput] = useState((task.tags || []).join(' '))
  const [prioAnchor, setPrioAnchor] = useState(null)
  const [dateAnchor, setDateAnchor] = useState(null)
  const [typeAnchor, setTypeAnchor] = useState(null)

  useEffect(() => {
    setDraftTitle(task.title || '')
    setDraftNotes(task.notes || '')
    setTagsInput((task.tags || []).join(' '))
  }, [task.id])

  useEffect(() => {
    const onEsc = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [onClose])

  const mutate = useCallback(async (patch) => {
    if (applyOptimistic) applyOptimistic(task.id, patch)
    await supabase.from('tasks').update(patch).eq('id', task.id)
  }, [task.id, applyOptimistic])

  const saveTitle = () => {
    const t = draftTitle.trim()
    if (!t || t === task.title) return
    mutate({ title: t })
  }
  const saveNotes = () => {
    if (draftNotes === (task.notes || '')) return
    mutate({ notes: draftNotes || null })
  }
  const saveTags = () => {
    const arr = tagsInput.trim()
      ? tagsInput.trim().split(/\s+/).map(s => s.replace(/^#/, '').toLowerCase()).filter(Boolean)
      : []
    const current = task.tags || []
    if (arr.length === current.length && arr.every((v, i) => v === current[i])) return
    mutate({ tags: arr })
  }
  const toggleDone = () => {
    const next = task.status === 'done' ? 'open' : 'done'
    mutate({ status: next, completed_at: next === 'done' ? new Date().toISOString() : null })
  }
  const drop = async () => {
    if (!confirm('Taak weggooien?')) return
    await mutate({ status: 'dropped' })
    onClose()
  }

  const prio = dbPrioToMockup(task.priority)
  const kind = task.deadline_kind || 'day'
  const urgency = dateUrgencyKind(task.deadline, kind)
  const typeMeta = task.task_type ? TYPE_BY_ID[task.task_type] : null

  return createPortal(
    <div className={styles.detailBackdrop} onClick={onClose}>
      <aside className={styles.detailPanel} onClick={e => e.stopPropagation()}>
        <header className={styles.detailHeader}>
          <div className={styles.detailProject}>
            {project ? (
              <span style={{ background: (project.color || '#7c8aff') + '22', borderColor: (project.color || '#7c8aff') + '55', color: 'var(--tv2-ink)' }}>
                {project.icon} {project.name}
              </span>
            ) : (
              <span style={{ background: 'var(--tv2-paper-2)', borderColor: 'var(--tv2-border)', color: 'var(--tv2-neutral-700)' }}>
                {task.source && task.source !== 'manual'
                  ? (SOURCE_LABEL[task.source] || task.source)
                  : 'Taak'}
              </span>
            )}
          </div>
          <button className={styles.detailClose} onClick={onClose} title="Sluit (Esc)">×</button>
        </header>

        {/* Hoofd-card: titel + meta */}
        <div className={styles.detailSection}>
          <input
            className={styles.detailTitle}
            value={draftTitle}
            onChange={e => setDraftTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
            placeholder="Taak-titel…"
          />

          <div className={styles.detailMetaRow}>
            <span
              className={`${styles.prioPill} ${styles[prio]}`}
              onClick={(e) => setPrioAnchor(e.currentTarget)}
              title="Klik om prio te wijzigen"
            >{prio}</span>

            <span
              className={[
                styles.taskDeadline,
                task.deadline && styles.set,
                urgency && styles[urgency],
              ].filter(Boolean).join(' ')}
              onClick={(e) => setDateAnchor(e.currentTarget)}
              title={task.deadline ? 'Wijzig deadline' : 'Stel deadline in'}
            >{task.deadline ? fmtDeadlineLabel(task.deadline, kind) : '+ deadline'}</span>

            <span
              className={[
                styles.typePill,
                task.task_type && styles.typePillSet,
                task.task_type && task.task_type_suggested && styles.typePillSuggested,
              ].filter(Boolean).join(' ')}
              onClick={(e) => {
                if (task.task_type && task.task_type_suggested) {
                  mutate({ task_type_suggested: false })
                } else {
                  setTypeAnchor(e.currentTarget)
                }
              }}
              onContextMenu={(e) => {
                if (task.task_type && task.task_type_suggested) {
                  e.preventDefault()
                  setTypeAnchor(e.currentTarget)
                }
              }}
              title={task.task_type ? 'Klik om categorie te wijzigen' : 'Stel categorie in'}
            >
              {typeMeta
                ? <>{typeMeta.icon} {typeMeta.label}</>
                : <>+ categorie</>}
            </span>

            <span style={{ flex: 1 }} />

            <button className={styles.detailActionBtn} onClick={toggleDone}>
              {task.status === 'done' ? '↺ Heropen' : '✓ Afgerond'}
            </button>
          </div>
        </div>

        {/* Beschrijving-card */}
        <div className={styles.detailSection}>
          <label className={styles.detailLabel}>Beschrijving</label>
          <textarea
            className={styles.detailNotes}
            value={draftNotes}
            onChange={e => setDraftNotes(e.target.value)}
            onBlur={saveNotes}
            placeholder="Beschrijving van de taak — wat moet er gebeuren, context, links, etc."
            rows={8}
          />
        </div>

        {/* Tags-card */}
        <div className={styles.detailSection}>
          <label className={styles.detailLabel}>Tags <span className={styles.detailHint}>(spatie-gescheiden)</span></label>
          <input
            className={styles.detailTagsInput}
            value={tagsInput}
            onChange={e => setTagsInput(e.target.value)}
            onBlur={saveTags}
            placeholder="bv. urgent klant-x onboarding"
          />
        </div>

        {task.ai_reasoning && (
          <div className={styles.detailAiReasoning}>
            <strong>AI-notitie:</strong> {task.ai_reasoning}
          </div>
        )}

        <div className={styles.detailFooter}>
          <button className={styles.detailDangerBtn} onClick={drop}>Weggooien</button>
        </div>

        {prioAnchor && (
          <V2PrioPop anchor={prioAnchor} current={prio}
            onPick={(p) => mutate({ priority: mockupPrioToDb(p) })}
            onClose={() => setPrioAnchor(null)} />
        )}
        {dateAnchor && (
          <V2DatePop anchor={dateAnchor} current={task.deadline || ''} currentKind={kind}
            onPick={(d, k) => mutate({ deadline: d || null, deadline_kind: d ? k : 'day' })}
            onClose={() => setDateAnchor(null)} />
        )}
        {typeAnchor && (
          <V2TypePop anchor={typeAnchor} current={task.task_type}
            onPick={(t) => mutate({ task_type: t, task_type_suggested: false })}
            onClose={() => setTypeAnchor(null)} />
        )}
      </aside>
    </div>,
    document.body
  )
}
