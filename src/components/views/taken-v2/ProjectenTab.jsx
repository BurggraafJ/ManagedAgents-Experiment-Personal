import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import { STAGES, STAGE_LABEL, stageOf, tagsForStage, groupBy, sortByDue } from '../../../lib/taskViews'
import V2TaskRow from './V2TaskRow'
import { QuickAddRow } from './MijnTab'
import styles from './taken-v2.module.css'

/* ============ Projecten — projectlijst links + 3 fase-kolommen ============ */
export default function ProjectenTab({ tasks, projList, applyOptimistic, onOpenDetail }) {
  const [selectedProj, setSelectedProj] = useState(projList[0]?.id || null)
  const [pendingInserts, setPendingInserts] = useState([])

  useEffect(() => {
    if (pendingInserts.length === 0) return
    const realIds = new Set(tasks.map(t => t.id))
    setPendingInserts(prev => prev.filter(p => !realIds.has(p.id)))
  }, [tasks])

  // Auto-select eerste project zodra projects geladen (of als het gekozene wegvalt)
  useEffect(() => {
    if (projList.length > 0 && !projList.some(p => p.id === selectedProj)) setSelectedProj(projList[0].id)
  }, [projList, selectedProj])

  const proj = projList.find(p => p.id === selectedProj) || null
  const projectTasks = useMemo(
    () => {
      const open = proj?.open || []
      const ids = new Set(open.map(t => t.id))
      return sortByDue([...pendingInserts.filter(p => p.project_id === selectedProj && !ids.has(p.id)), ...open])
    },
    [pendingInserts, proj, selectedProj],
  )
  const by = useMemo(() => groupBy(projectTasks, stageOf), [projectTasks])

  const insertTask = useCallback(async (stage, title) => {
    if (!title.trim() || !selectedProj) return
    const tempId = 'tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
    const tags = tagsForStage([], stage)
    setPendingInserts(prev => [...prev, {
      id: tempId, title: title.trim(), project_id: selectedProj, priority: 'normal', status: 'open', source: 'manual',
      in_backlog: false, deadline: null, tags, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }])
    const { data, error } = await supabase.from('tasks')
      .insert({ title: title.trim(), project_id: selectedProj, priority: 'normal', source: 'manual', ai_processed: false, tags })
      .select().single()
    if (error) { setPendingInserts(prev => prev.filter(p => p.id !== tempId)); return }
    if (data) setPendingInserts(prev => prev.map(p => p.id === tempId ? data : p))
  }, [selectedProj])

  // Drag-drop tussen kolommen — zet de juiste fase-tag (exclusief)
  const moveToStage = useCallback(async (taskId, stage) => {
    const task = [...pendingInserts, ...tasks].find(t => t.id === taskId)
    if (!task || stageOf(task) === stage) return
    const next = tagsForStage(task.tags, stage)
    applyOptimistic(taskId, { tags: next })
    await supabase.from('tasks').update({ tags: next }).eq('id', taskId)
  }, [pendingInserts, tasks, applyOptimistic])

  if (projList.length === 0) {
    return <div className={styles.empty}>Nog geen projecten. Maak er eentje aan…</div>
  }

  return (
    <div className={styles.kb}>
      <aside className={styles.kbSide}>
        <div className={styles.kbSideHead}>Projecten<span>{projList.length}</span></div>
        {projList.map(p => <ProjectRow key={p.id} p={p} active={p.id === selectedProj} onOpen={() => setSelectedProj(p.id)} />)}
      </aside>
      <main className={styles.kbMain}>
        {proj && (
          <div className={styles.kbTitle}>
            <span className={styles.kbTitleIcon}>{proj.icon || '📁'}</span>
            <h2>{proj.name}</h2>
            <span className={styles.projProg}>{projectTasks.length} open · {proj.done.length} klaar</span>
          </div>
        )}
        <div className={styles.kbCols}>
          {STAGES.map(s => (
            <StageColumn
              key={s} stage={s} rows={by.get(s) || []}
              onDropTask={(id) => moveToStage(id, s)}
              onInsert={(title) => insertTask(s, title)}
              applyOptimistic={applyOptimistic} onOpenDetail={onOpenDetail}
            />
          ))}
        </div>
      </main>
    </div>
  )
}

/** Projectrij in het zijpaneel: icoon, naam, voortgang + balk, fase-tellers. */
function ProjectRow({ p, active, onOpen }) {
  const pct = p.total ? Math.round((p.done.length / p.total) * 100) : 0
  return (
    <button type="button" className={`${styles.projRow} ${active ? styles.projRowActive : ''}`} onClick={onOpen}>
      <span className={styles.projIcon}>{p.icon || '📁'}</span>
      <span className={styles.projMain}>
        <span className={styles.projTop}><span className={styles.projName}>{p.name}</span><span className={styles.projProg}>{p.done.length}/{p.total}</span></span>
        <span className={styles.bar}><span style={{ width: `${pct}%`, background: p.color || '#7c8aff' }} /></span>
        <span className={styles.stageDots}>
          {STAGES.map(s => <span key={s} className={`${styles.stageDot} ${styles['stageDot_' + s]}`}><i />{STAGE_LABEL[s]} <b>{p.stageCount[s]}</b></span>)}
        </span>
      </span>
    </button>
  )
}

function StageColumn({ stage, rows, onDropTask, onInsert, applyOptimistic, onOpenDetail }) {
  const [dragOver, setDragOver] = useState(false)
  return (
    <section
      className={`${styles.col} ${styles['col_' + stage]} ${dragOver ? styles.dragOver : ''}`}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); const id = e.dataTransfer.getData('text/plain'); if (id) onDropTask(id) }}
    >
      <header className={`${styles.groupHead} ${styles.stageHead} ${styles['stageHead_' + stage]}`}>
        <i className={styles.groupMark} />{STAGE_LABEL[stage]}<span>{rows.length}</span>
      </header>
      <div className={styles.colBody}>
        {rows.map(t => (
          <div key={t.id} className={styles.colCard} onClick={() => onOpenDetail(t.id)}>
            <V2TaskRow task={t} variant="board" applyOptimistic={applyOptimistic} hideDelete draggable />
          </div>
        ))}
        {rows.length === 0 && <div className={styles.colEmpty}>Sleep hier een taak naartoe</div>}
        <QuickAddRow prioId={stage} onInsert={(_, title) => onInsert(title)} placeholder={`Nieuwe taak in ${STAGE_LABEL[stage].toLowerCase()}…`} />
      </div>
    </section>
  )
}
