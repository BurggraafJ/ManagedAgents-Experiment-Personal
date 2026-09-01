import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import { dbPrioToMockup, mockupPrioToDb, passesDateFilter, sortByUrgency, ymd } from './v2-helpers'
import V2TaskRow from './V2TaskRow'
import styles from './taken-v2.module.css'

/* ============ Mijn taken — 3 prio-groepen + 1 gedeelde backlog ============ */
export default function MijnTab({ tasks, dateFilter, filterSource, typeFilter, applyOptimistic, onOpenDetail }) {
  // Pending inserts: nieuwe taken die nog niet via useTasks zijn terug-gesynct
  const [pendingInserts, setPendingInserts] = useState([])
  useEffect(() => {
    if (pendingInserts.length === 0) return
    const realIds = new Set(tasks.map(t => t.id))
    setPendingInserts(prev => prev.filter(p => !realIds.has(p.id)))
  }, [tasks])

  const allTasks = useMemo(() => {
    const ids = new Set(tasks.map(t => t.id))
    return [...pendingInserts.filter(p => !ids.has(p.id)), ...tasks]
  }, [pendingInserts, tasks])
  const filtered = allTasks.filter(t =>
    passesDateFilter(t, dateFilter, filterSource) &&
    (typeFilter === 'all' || t.task_type === typeFilter)
  )
  const liveByPrio = {
    hoog:   sortByUrgency(filtered.filter(t => !t.in_backlog && dbPrioToMockup(t.priority) === 'hoog')),
    middel: sortByUrgency(filtered.filter(t => !t.in_backlog && dbPrioToMockup(t.priority) === 'middel')),
    laag:   sortByUrgency(filtered.filter(t => !t.in_backlog && dbPrioToMockup(t.priority) === 'laag')),
  }
  const backlogAll = sortByUrgency(filtered.filter(t => t.in_backlog))
  const completionCandidates = allTasks.filter(t => t.completion_candidate && t.status === 'open')

  const handleDrop = useCallback(async (taskId, toMockupPrio, toBacklog) => {
    const patch = {}
    if (toMockupPrio) patch.priority = mockupPrioToDb(toMockupPrio)
    if (toBacklog !== undefined) patch.in_backlog = !!toBacklog
    if (Object.keys(patch).length === 0) return
    applyOptimistic(taskId, patch)
    await supabase.from('tasks').update(patch).eq('id', taskId)
  }, [applyOptimistic])

  // Insert — meteen lokaal + async supabase. Actief dag-filter (Vandaag/Morgen
  // op deadline-bron) en categorie-filter worden automatisch overgenomen.
  const handleInsert = useCallback(async (mockupPrio, title, toBacklog = false) => {
    const trimmed = title.trim()
    if (!trimmed) return
    let autoDeadline = null
    if (filterSource === 'deadline') {
      if (dateFilter === 'today') autoDeadline = ymd(new Date())
      else if (dateFilter === 'tomorrow') { const d = new Date(); d.setDate(d.getDate() + 1); autoDeadline = ymd(d) }
    }
    const autoType = typeFilter !== 'all' ? typeFilter : null
    const tempId = 'tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
    const dbPrio = mockupPrioToDb(mockupPrio)
    setPendingInserts(prev => [...prev, {
      id: tempId, title: trimmed, priority: dbPrio, status: 'open', source: 'manual', in_backlog: toBacklog,
      deadline: autoDeadline, deadline_kind: 'day', task_type: autoType, task_type_suggested: false,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), tags: [],
    }])
    const insertPayload = { title: trimmed, priority: dbPrio, in_backlog: toBacklog, source: 'manual', ai_processed: false }
    if (autoDeadline) { insertPayload.deadline = autoDeadline; insertPayload.deadline_kind = 'day' }
    if (autoType) { insertPayload.task_type = autoType; insertPayload.task_type_suggested = false }
    const { data, error } = await supabase.from('tasks').insert(insertPayload).select().single()
    if (error) { setPendingInserts(prev => prev.filter(p => p.id !== tempId)); return }
    if (data) setPendingInserts(prev => prev.map(p => p.id === tempId ? { ...data } : p))
  }, [dateFilter, filterSource, typeFilter])

  const groupProps = { onDrop: handleDrop, onInsert: handleInsert, applyOptimistic, onOpenDetail }
  return (
    <>
      <PrioGroup id="hoog"   label="Hoog"   live={liveByPrio.hoog}   {...groupProps} />
      <PrioGroup id="middel" label="Middel" live={liveByPrio.middel} {...groupProps} />
      <PrioGroup id="laag"   label="Laag"   live={liveByPrio.laag}   {...groupProps} />
      {completionCandidates.length > 0 && <CompletionCandidatesSection tasks={completionCandidates} applyOptimistic={applyOptimistic} />}
      <BacklogSection tasks={backlogAll} {...groupProps} />
    </>
  )
}

/* Quick-add row — persistent input, Enter = save, input clear, focus blijft */
export function QuickAddRow({ prioId, onInsert, placeholder }) {
  const [draft, setDraft] = useState('')
  const save = () => { const title = draft.trim(); if (!title) return; onInsert(prioId, title); setDraft('') }
  return (
    <div className={styles.quickAdd}>
      <span className={styles.quickAddIcon}>+</span>
      <input
        type="text" className={styles.quickAddInput} value={draft} placeholder={placeholder}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); save() }
          if (e.key === 'Escape') { e.preventDefault(); setDraft('') }
        }}
      />
      {draft.trim() && <span className={styles.quickAddHint}>↵ om toe te voegen</span>}
    </div>
  )
}

function useDropZone(onDropId) {
  const [dragOver, setDragOver] = useState(false)
  return {
    dragOver,
    handlers: {
      onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true) },
      onDragLeave: () => setDragOver(false),
      onDrop: (e) => { e.preventDefault(); setDragOver(false); const id = e.dataTransfer.getData('text/plain'); if (id) onDropId(id) },
    },
  }
}

/* Prio-groep — hele kaart is drop-target voor verplaatsing tussen prio's. */
function PrioGroup({ id, label, live, onDrop, onInsert, applyOptimistic, onOpenDetail }) {
  const { dragOver, handlers } = useDropZone((taskId) => onDrop(taskId, id, false))
  return (
    <section className={`${styles.group} ${dragOver ? styles.dragOver : ''}`} {...handlers}>
      <header className={`${styles.groupHead} ${styles['groupHead_' + id]}`}>
        <i className={styles.groupMark} />{label}<span>{live.length}</span>
      </header>
      {live.map(t => <V2TaskRow key={t.id} task={t} draggable applyOptimistic={applyOptimistic} onOpenDetail={onOpenDetail} />)}
      <QuickAddRow prioId={id} onInsert={onInsert} placeholder={`Nieuwe taak in ${label.toLowerCase()}…`} />
    </section>
  )
}

/* Eén gedeelde backlog onderaan — drop-target voor alle prio's. */
function BacklogSection({ tasks, onDrop, onInsert, applyOptimistic, onOpenDetail }) {
  const [open, setOpen] = useState(false)
  const { dragOver, handlers } = useDropZone((taskId) => onDrop(taskId, null, true))
  return (
    <div className={`${styles.backlog} ${dragOver ? styles.dragOver : ''}`} {...handlers}>
      <button type="button" className={styles.backlogToggle} onClick={() => setOpen(o => !o)} aria-expanded={open}>
        Backlog · {tasks.length} geparkeerd
        <em>{open ? '▴' : 'sleep een taak hierheen om te parkeren ▾'}</em>
      </button>
      {open && (
        <div className={styles.backlogList}>
          {tasks.map(t => <V2TaskRow key={t.id} task={t} draggable applyOptimistic={applyOptimistic} onOpenDetail={onOpenDetail} />)}
          <QuickAddRow prioId="middel" onInsert={(prio, title) => onInsert(prio, title, true)} placeholder="Nieuwe taak in backlog…" />
        </div>
      )}
    </div>
  )
}

/* Mogelijk voltooid — gedetecteerd door skill via mail-mirror match */
function CompletionCandidatesSection({ tasks, applyOptimistic }) {
  const [open, setOpen] = useState(true)
  const confirmDone = async (id) => {
    const patch = { status: 'done', completed_at: new Date().toISOString(), completion_candidate: false }
    applyOptimistic(id, patch)
    await supabase.from('tasks').update(patch).eq('id', id)
  }
  const reject = async (id) => {
    applyOptimistic(id, { completion_candidate: false })
    await supabase.from('tasks').update({ completion_candidate: false }).eq('id', id)
  }
  return (
    <div className={styles.completion}>
      <button type="button" className={styles.backlogToggle} onClick={() => setOpen(o => !o)}>
        Mogelijk voltooid · {tasks.length}<em>Skill detecteerde signaal — bevestig of wijs af {open ? '▴' : '▾'}</em>
      </button>
      {open && tasks.map(t => (
        <div key={t.id} className={styles.candidateRow}>
          <div className={styles.candidateBody}>
            <div className={styles.candidateTitle}>{t.title}</div>
            {t.completion_evidence && <div className={styles.candidateEvidence}><em>{t.completion_evidence}</em></div>}
          </div>
          <button type="button" className={styles.smallBtnPrimary} onClick={() => confirmDone(t.id)}>✓ Klaar</button>
          <button type="button" className={styles.smallBtnGhost} onClick={() => reject(t.id)}>Wijs af</button>
        </div>
      ))}
    </div>
  )
}
