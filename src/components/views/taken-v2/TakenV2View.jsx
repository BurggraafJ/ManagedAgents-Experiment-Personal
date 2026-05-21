import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '../../../lib/supabase'
import { useTasks } from '../../../hooks/useTasks'
import {
  dbPrioToMockup,
  mockupPrioToDb,
  fmtDateOrMonth,
  passesDateFilter,
  dateUrgencyKind,
  ymd,
} from './v2-helpers'
import V2TaskRow from './V2TaskRow'
import styles from './taken-v2.module.css'

const TAB_DEFS = [
  { id: 'mijn',      label: 'Mijn taken' },
  { id: 'projecten', label: 'Projecten' },
  { id: 'nieuw',     label: 'Nieuw gevonden' },
  { id: 'sales',     label: 'Sales followups' },
  { id: 'jira',      label: 'Jira' },
  { id: 'afgerond',  label: 'Afgeronde taken' },
]
const TAB_SUBTITLE = {
  mijn:      'Open taken op prioriteit',
  projecten: 'Lopende projecten en sub-taken',
  nieuw:     'Door agent ontdekte actiepunten',
  sales:     'Follow-ups uit HubSpot',
  jira:      'Open Jira-tickets (urgent eerst)',
  afgerond:  'Log van afgeronde taken',
}
const DATE_FILTERS = [
  { id: 'all',     label: 'Alle' },
  { id: 'overdue', label: 'Verlopen' },
  { id: 'today',   label: 'Vandaag' },
  { id: 'week',    label: 'Deze week' },
  { id: 'month',   label: 'Deze maand' },
  { id: 'none',    label: 'Geen datum' },
]
const FILTER_SOURCES = [
  { id: 'deadline', label: 'Deadline' },
  { id: 'created',  label: 'Aangemaakt' },
  { id: 'backlog',  label: 'Op backlog' },
]
const FILTER_SOURCE_LABEL = { deadline: 'deadline', created: 'aangemaakt-datum', backlog: 'backlog-datum' }

function useClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(id)
  }, [])
  return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
}

async function triggerRunNu() {
  await supabase.from('agent_schedules')
    .update({ manual_run_requested_at: new Date().toISOString() })
    .eq('agent_name', 'taken')
}

function SkeletonRows({ count = 4 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={styles.skelRow}>
          <div className={`${styles.skel} ${styles.skelCb}`} />
          <div className={`${styles.skel} ${styles.skelText}`} />
          <div className={`${styles.skel} ${styles.skelPill}`} />
          <div className={`${styles.skel} ${styles.skelDate}`} />
        </div>
      ))}
    </div>
  )
}

/**
 * Centrale optimistic-store. Map van taskId → partial patch.
 * Bij elke mutation:
 *   1. applyOptimistic(id, patch)  → UI rendert meteen merged
 *   2. supabase.update              → async
 *   3. useTasks refresh             → useEffect clear's id ALS prop matched
 */
function useOptimisticTasks(tasks) {
  const [overrides, setOverrides] = useState(() => new Map())
  // Drop overrides die nu matchen met server-data
  useEffect(() => {
    if (overrides.size === 0) return
    const next = new Map(overrides)
    let changed = false
    for (const t of tasks) {
      const ov = next.get(t.id)
      if (!ov) continue
      const allMatch = Object.keys(ov).every(k => {
        const a = t[k]; const b = ov[k]
        if (a === b) return true
        if (a == null && b == null) return true
        return false
      })
      if (allMatch) { next.delete(t.id); changed = true }
    }
    if (changed) setOverrides(next)
  }, [tasks])

  const merged = useMemo(() => {
    if (overrides.size === 0) return tasks
    return tasks.map(t => overrides.has(t.id) ? { ...t, ...overrides.get(t.id) } : t)
  }, [tasks, overrides])

  const applyOptimistic = useCallback((id, patch) => {
    setOverrides(prev => {
      const next = new Map(prev)
      next.set(id, { ...(next.get(id) || {}), ...patch })
      return next
    })
  }, [])

  return { merged, applyOptimistic }
}

export default function TakenV2View() {
  const { tasks: rawTasks, projects, loading } = useTasks()
  const { merged: tasks, applyOptimistic } = useOptimisticTasks(rawTasks)

  const [tab, setTab] = useState('mijn')
  const [dateFilter, setDateFilter] = useState('all')
  const [filterSource, setFilterSource] = useState('deadline')
  const [addOpen, setAddOpen] = useState(false)
  const clock = useClock()

  const openTasks = useMemo(
    () => tasks.filter(t => t.status !== 'done' && t.status !== 'dropped'),
    [tasks]
  )
  const mijnTasks = useMemo(
    () => openTasks.filter(t => !t.is_newly_found && t.source !== 'jira' && t.source !== 'sales_followup'),
    [openTasks]
  )
  const newlyFound = useMemo(
    () => openTasks.filter(t => t.is_newly_found && t.source !== 'jira'),
    [openTasks]
  )
  const salesTasks = useMemo(
    () => openTasks.filter(t => t.source === 'sales_followup'),
    [openTasks]
  )
  const jiraTasks = useMemo(
    () => openTasks.filter(t => t.source === 'jira' && t.jira_board !== 'Sales'),
    [openTasks]
  )
  const doneTasks = useMemo(
    () => tasks.filter(t => t.status === 'done')
      .sort((a, b) => new Date(b.completed_at || b.updated_at) - new Date(a.completed_at || a.updated_at)),
    [tasks]
  )

  const counts = {
    mijn: mijnTasks.filter(t => !t.in_backlog && passesDateFilter(t, dateFilter, filterSource)).length,
    projecten: new Set(openTasks.filter(t => t.project_id).map(t => t.project_id)).size,
    nieuw: newlyFound.length,
    sales: salesTasks.length,
    jira: jiraTasks.filter(t => passesDateFilter(t, dateFilter, 'deadline')).length,
    afgerond: doneTasks.length,
  }
  const activeBadge = counts[tab] || 0
  const showDateFilter = tab === 'mijn' || tab === 'jira'

  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <div className={styles.crumb}>
          <span className={styles.crumbLbl}>Werkruimte</span>
          <span className={styles.crumbSep}>/</span>
          <span className={styles.crumbCur}>Taken</span>
        </div>
        <div className={styles.topbarRight}>
          <div className={styles.syncPill}>
            <span className={styles.syncDot} />
            <span>Live</span>
            <span className={styles.syncMeta}>{clock}</span>
          </div>
          <button className={styles.runBtn} onClick={triggerRunNu} title="Trigger handmatige run van de Taken-skill">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
              <path d="M21 3v5h-5"/>
            </svg>
            Run nu
          </button>
        </div>
      </header>

      <div className={styles.screen}>
        <header className={styles.header}>
          <div className={styles.headerTop}>
            <div className={styles.titleGrp}>
              <h1 className={styles.title}>Taken</h1>
              {activeBadge > 0 && <span className={styles.headerCount}>{activeBadge}</span>}
              <span className={styles.sub}>{TAB_SUBTITLE[tab]}</span>
            </div>
            <div className={styles.spacer} />
            {tab === 'mijn' && (
              <button className={styles.btnPrimary} onClick={() => setAddOpen(o => !o)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 4v16M4 12h16"/></svg>
                Nieuwe taak
              </button>
            )}
          </div>
          <div className={styles.tabs}>
            {TAB_DEFS.map(t => (
              <button
                key={t.id}
                type="button"
                className={`${styles.tab} ${tab === t.id ? styles.active : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {counts[t.id] > 0 && <span className={styles.tabCount}>{counts[t.id]}</span>}
              </button>
            ))}
          </div>
        </header>

        {showDateFilter && (
          <div className={styles.dateFilter}>
            <span className={styles.dateFilterLabel}>
              Filter op {tab === 'jira' ? 'deadline' : FILTER_SOURCE_LABEL[filterSource]}:
            </span>
            {DATE_FILTERS.map(f => (
              <button
                key={f.id}
                type="button"
                className={`${styles.dfChip} ${dateFilter === f.id ? styles.active : ''}`}
                onClick={() => setDateFilter(f.id)}
              >{f.label}</button>
            ))}
            {tab === 'mijn' && (
              <>
                <span style={{ flex: 1 }} />
                <span className={styles.dateFilterLabel}>Bron:</span>
                {FILTER_SOURCES.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    className={`${styles.dfChip} ${filterSource === s.id ? styles.active : ''}`}
                    onClick={() => setFilterSource(s.id)}
                  >{s.label}</button>
                ))}
              </>
            )}
          </div>
        )}

        {tab === 'mijn' && addOpen && (
          <AddTaskForm onClose={() => setAddOpen(false)} />
        )}

        <div className={styles.body}>
          {loading && rawTasks.length === 0 ? (
            <>
              <div className={styles.prioGroup}>
                <div className={styles.prioHead}>
                  <span className={`${styles.prioDot} ${styles.prioDotHoog}`} />
                  <span className={styles.prioLabel}>Hoog</span>
                </div>
                <SkeletonRows count={3} />
              </div>
              <div className={styles.prioGroup}>
                <div className={styles.prioHead}>
                  <span className={`${styles.prioDot} ${styles.prioDotMiddel}`} />
                  <span className={styles.prioLabel}>Middel</span>
                </div>
                <SkeletonRows count={2} />
              </div>
              <div className={styles.prioGroup}>
                <div className={styles.prioHead}>
                  <span className={`${styles.prioDot} ${styles.prioDotLaag}`} />
                  <span className={styles.prioLabel}>Laag</span>
                </div>
                <SkeletonRows count={2} />
              </div>
            </>
          ) : (
            <>
              {tab === 'mijn'      && <MijnTab tasks={mijnTasks} dateFilter={dateFilter} filterSource={filterSource} applyOptimistic={applyOptimistic} />}
              {tab === 'projecten' && <ProjectenTab tasks={openTasks} projects={projects} applyOptimistic={applyOptimistic} />}
              {tab === 'nieuw'     && <NieuwTab tasks={newlyFound} applyOptimistic={applyOptimistic} />}
              {tab === 'sales'     && <SalesTab tasks={salesTasks} applyOptimistic={applyOptimistic} />}
              {tab === 'jira'      && <JiraTab tasks={jiraTasks} dateFilter={dateFilter} />}
              {tab === 'afgerond'  && <AfgerondTab tasks={doneTasks} applyOptimistic={applyOptimistic} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ============ Mijn taken — 3 prio-groups + 1 gedeelde backlog ============ */
function MijnTab({ tasks, dateFilter, filterSource, applyOptimistic }) {
  // Pending inserts: nieuwe taken die nog niet via useTasks zijn terug-gesynct
  const [pendingInserts, setPendingInserts] = useState([])

  // Drop pending zodra echte rij in tasks zit
  useEffect(() => {
    if (pendingInserts.length === 0) return
    const realIds = new Set(tasks.map(t => t.id))
    setPendingInserts(prev => prev.filter(p => !realIds.has(p.id)))
  }, [tasks])

  // Merge: pending komt bovenaan binnen z'n prio-bucket
  const allTasks = useMemo(() => [...pendingInserts, ...tasks], [pendingInserts, tasks])
  const filtered = allTasks.filter(t => passesDateFilter(t, dateFilter, filterSource))
  const liveByPrio = {
    hoog:   filtered.filter(t => !t.in_backlog && dbPrioToMockup(t.priority) === 'hoog'),
    middel: filtered.filter(t => !t.in_backlog && dbPrioToMockup(t.priority) === 'middel'),
    laag:   filtered.filter(t => !t.in_backlog && dbPrioToMockup(t.priority) === 'laag'),
  }
  const backlogAll = filtered.filter(t => t.in_backlog)

  const handleDrop = useCallback(async (taskId, toMockupPrio, toBacklog) => {
    const newPrio = toMockupPrio ? mockupPrioToDb(toMockupPrio) : undefined
    const patch = {}
    if (newPrio !== undefined) patch.priority = newPrio
    if (toBacklog !== undefined) patch.in_backlog = !!toBacklog
    if (Object.keys(patch).length === 0) return
    applyOptimistic(taskId, patch)
    await supabase.from('tasks').update(patch).eq('id', taskId)
  }, [applyOptimistic])

  // Insert handler — meteen lokaal toevoegen + async supabase
  const handleInsert = useCallback(async (mockupPrio, title, toBacklog = false) => {
    const trimmed = title.trim()
    if (!trimmed) return
    const tempId = 'tmp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)
    const dbPrio = mockupPrioToDb(mockupPrio)
    const newRow = {
      id: tempId,
      title: trimmed,
      priority: dbPrio,
      status: 'open',
      source: 'manual',
      in_backlog: toBacklog,
      deadline: null,
      deadline_kind: 'day',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      tags: [],
    }
    setPendingInserts(prev => [...prev, newRow])
    const { data, error } = await supabase.from('tasks').insert({
      title: trimmed,
      priority: dbPrio,
      in_backlog: toBacklog,
      source: 'manual',
      ai_processed: false,
    }).select().single()
    if (error) {
      // Revert
      setPendingInserts(prev => prev.filter(p => p.id !== tempId))
      return
    }
    // Vervang temp met echte ID — useEffect zal 'm cleanen zodra useTasks ververst
    if (data) {
      setPendingInserts(prev => prev.map(p => p.id === tempId ? { ...data } : p))
    }
  }, [])

  return (
    <>
      <PrioGroup id="hoog"   label="Hoog"   dotClass={styles.prioDotHoog}   live={liveByPrio.hoog}   onDrop={handleDrop} onInsert={handleInsert} applyOptimistic={applyOptimistic} />
      <PrioGroup id="middel" label="Middel" dotClass={styles.prioDotMiddel} live={liveByPrio.middel} onDrop={handleDrop} onInsert={handleInsert} applyOptimistic={applyOptimistic} />
      <PrioGroup id="laag"   label="Laag"   dotClass={styles.prioDotLaag}   live={liveByPrio.laag}   onDrop={handleDrop} onInsert={handleInsert} applyOptimistic={applyOptimistic} />
      <BacklogSection tasks={backlogAll} onDrop={handleDrop} onInsert={handleInsert} applyOptimistic={applyOptimistic} />
    </>
  )
}

/* Quick-add row — persistent input, type + Enter = save, input clear, focus blijft */
function QuickAddRow({ prioId, onInsert, placeholder }) {
  const [draft, setDraft] = useState('')
  const save = () => {
    const title = draft.trim()
    if (!title) return
    onInsert(prioId, title)
    setDraft('')
  }
  return (
    <div className={styles.quickAddRow}>
      <span className={styles.quickAddIcon}>+</span>
      <input
        type="text"
        className={styles.quickAddInput}
        value={draft}
        placeholder={placeholder}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); save() }
          if (e.key === 'Escape') { e.preventDefault(); setDraft('') }
        }}
      />
      {draft.trim() && (
        <span className={styles.quickAddHint}>↵ om toe te voegen</span>
      )}
    </div>
  )
}

/* Prio-group — hele card is drop-target voor verplaatsing tussen prio's. */
function PrioGroup({ id, label, dotClass, live, onDrop, onInsert, applyOptimistic }) {
  const [dragOver, setDragOver] = useState(false)
  const onDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true) }
  const onDragLeave = () => setDragOver(false)
  const onDropZone = (e) => {
    e.preventDefault()
    setDragOver(false)
    const taskId = e.dataTransfer.getData('text/plain')
    if (taskId) onDrop(taskId, id, false)
  }
  return (
    <div
      className={`${styles.prioGroup} ${dragOver ? styles.dragOverGroup : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDropZone}
    >
      <div className={styles.prioHead}>
        <span className={`${styles.prioDot} ${dotClass}`} />
        <span className={styles.prioLabel}>{label}</span>
        <span className={styles.prioCnt}>{live.length}</span>
      </div>
      <div className={styles.dropZone}>
        {live.map(t => <V2TaskRow key={t.id} task={t} draggable applyOptimistic={applyOptimistic} />)}
        <QuickAddRow
          prioId={id}
          onInsert={onInsert}
          placeholder={`Nieuwe taak in ${label}…`}
        />
      </div>
    </div>
  )
}

/* Eén gedeelde backlog onderaan — drop-target voor alle prio's. */
function BacklogSection({ tasks, onDrop, onInsert, applyOptimistic }) {
  const [open, setOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const onDragOver = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true) }
  const onDragLeave = () => setDragOver(false)
  const onDropZone = (e) => {
    e.preventDefault()
    setDragOver(false)
    const taskId = e.dataTransfer.getData('text/plain')
    if (taskId) onDrop(taskId, null, true)  // null prio = behoud huidige, alleen in_backlog flippen
  }
  return (
    <div
      className={`${styles.backlogSection} ${dragOver ? styles.dragOverGroup : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDropZone}
    >
      <button
        type="button"
        className={styles.backlogToggle}
        onClick={() => setOpen(o => !o)}
      >
        <span className={styles.backlogChevron}>{open ? '▾' : '▸'}</span>
        <span>Backlog</span>
        <span className={styles.backlogBadge}>{tasks.length}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--tv2-neutral-400)' }}>
          {open ? '' : 'klik om uit te klappen — sleep taak hierheen om te parkeren'}
        </span>
      </button>
      {open && (
        <div className={styles.backlogList}>
          {tasks.map(t => <V2TaskRow key={t.id} task={t} draggable applyOptimistic={applyOptimistic} />)}
          <QuickAddRow
            prioId="middel"
            onInsert={(prio, title) => onInsert(prio, title, true)}
            placeholder="Nieuwe taak in backlog…"
          />
        </div>
      )}
    </div>
  )
}

/* ============ Add task form ============ */
function AddTaskForm({ onClose }) {
  const [title, setTitle] = useState('')
  const [prio, setPrio] = useState('hoog')
  const [deadline, setDeadline] = useState('')
  const [busy, setBusy] = useState(false)

  const save = useCallback(async () => {
    const t = title.trim()
    if (!t || busy) return
    setBusy(true)
    try {
      await supabase.from('tasks').insert({
        title: t,
        priority: mockupPrioToDb(prio),
        deadline: deadline || null,
        source: 'manual',
        ai_processed: false,
      })
      setTitle(''); setDeadline(''); setPrio('hoog')
      onClose()
    } finally { setBusy(false) }
  }, [title, prio, deadline, busy, onClose])

  return (
    <div className={styles.addForm}>
      <input
        type="text" className={styles.addInput}
        placeholder="Omschrijving van de taak…"
        value={title} autoFocus
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onClose() }}
      />
      <div className={styles.addRow}>
        <span style={{ fontSize: 12, color: 'var(--tv2-neutral-500)' }}>Prioriteit:</span>
        {['hoog', 'middel', 'laag'].map(p => (
          <button
            key={p}
            className={`${styles.prioBtn} ${prio === p ? styles['sel' + p.charAt(0).toUpperCase() + p.slice(1)] : ''}`}
            onClick={() => setPrio(p)}
          >{p.charAt(0).toUpperCase() + p.slice(1)}</button>
        ))}
        <span style={{ fontSize: 12, color: 'var(--tv2-neutral-500)', marginLeft: 8 }}>Deadline:</span>
        <input
          type="date" className={styles.deadlineInput}
          value={deadline} onChange={e => setDeadline(e.target.value)}
        />
        <div style={{ flex: 1 }} />
        <button className={`${styles.btnSm} ${styles.btnSmPrimary}`} onClick={save} disabled={!title.trim() || busy}>
          {busy ? '…' : 'Voeg toe'}
        </button>
        <button className={styles.btnGhost} onClick={onClose}>Annuleer</button>
      </div>
    </div>
  )
}

/* ============ Projecten ============ */
function ProjectenTab({ tasks, projects, applyOptimistic }) {
  const byProj = {}
  for (const t of tasks) {
    if (!t.project_id) continue
    if (!byProj[t.project_id]) byProj[t.project_id] = []
    byProj[t.project_id].push(t)
  }
  const projWithTasks = projects.filter(p => (byProj[p.id] || []).length > 0)
  if (projWithTasks.length === 0) {
    return <div className={styles.empty}>Geen taken aan een project gekoppeld.</div>
  }
  return (
    <>
      {projWithTasks.map(p => (
        <div key={p.id} className={styles.projectGroup}>
          <div className={styles.projectHead}>
            <span className={styles.prioDot} style={{ background: p.color || '#4d2d6b' }} />
            <span className={styles.projectName}>{p.icon ? p.icon + ' ' : ''}{p.name}</span>
            <span className={styles.prioCnt}>{byProj[p.id].length}</span>
          </div>
          <div className={styles.dropZone}>
            {byProj[p.id].map(t => <V2TaskRow key={t.id} task={t} applyOptimistic={applyOptimistic} />)}
          </div>
        </div>
      ))}
    </>
  )
}

/* ============ Nieuw gevonden ============ */
function NieuwTab({ tasks, applyOptimistic }) {
  if (tasks.length === 0) {
    return <div className={styles.empty}>Niets nieuws gevonden door de agent.</div>
  }
  const confirm = async (id) => {
    applyOptimistic(id, { is_newly_found: false })
    await supabase.from('tasks').update({ is_newly_found: false }).eq('id', id)
  }
  const reject = async (id) => {
    applyOptimistic(id, { is_newly_found: false, status: 'dropped' })
    await supabase.from('tasks').update({ is_newly_found: false, status: 'dropped' }).eq('id', id)
  }
  return (
    <>
      <div className={styles.hint}>
        Automatisch gevonden actiepunten door de agent — nog niet bevestigd.
      </div>
      <div className={styles.dropZone}>
        {tasks.map(t => (
          <V2TaskRow
            key={t.id}
            task={t}
            applyOptimistic={applyOptimistic}
            actions={
              <div className={styles.nieuwActions}>
                <button className={styles.confirmBtn} onClick={() => confirm(t.id)}>Bevestig</button>
                <button className={styles.rejectBtn} onClick={() => reject(t.id)}>Wijs af</button>
              </div>
            }
          />
        ))}
      </div>
    </>
  )
}

/* ============ Sales followups ============ */
function SalesTab({ tasks, applyOptimistic }) {
  if (tasks.length === 0) {
    return <div className={styles.empty}>Geen open sales follow-ups.</div>
  }
  const today = new Date(); today.setHours(0,0,0,0)
  const inOneWeek = new Date(today); inOneWeek.setDate(today.getDate() + 7)
  const isThisWeek = (t) => t.deadline && new Date(t.deadline) <= inOneWeek
  const thisWeek = tasks.filter(isThisWeek)
  const next     = tasks.filter(t => !isThisWeek(t))
  return (
    <>
      {thisWeek.length > 0 && (
        <div className={styles.salesSection}>
          <div className={styles.salesSectionHead}>
            <span className={styles.prioDot} />
            <span className={styles.salesSectionLabel}>Actief — deze week</span>
            <span className={styles.prioCnt}>{thisWeek.length}</span>
          </div>
          <div className={styles.dropZone}>
            {thisWeek.map(t => <V2TaskRow key={t.id} task={t} applyOptimistic={applyOptimistic} />)}
          </div>
        </div>
      )}
      {next.length > 0 && (
        <div className={styles.salesSection}>
          <div className={`${styles.salesSectionHead} ${styles.next}`}>
            <span className={styles.prioDot} />
            <span className={styles.salesSectionLabel}>Volgende week & later</span>
            <span className={styles.prioCnt}>{next.length}</span>
          </div>
          <div className={styles.dropZone}>
            {next.map(t => <V2TaskRow key={t.id} task={t} applyOptimistic={applyOptimistic} />)}
          </div>
        </div>
      )}
    </>
  )
}

/* ============ Jira ============ */
function JiraTab({ tasks, dateFilter }) {
  const todayStr = ymd(new Date())
  const sorted = tasks.filter(t => passesDateFilter(t, dateFilter, 'deadline')).slice().sort((a, b) => {
    const aOver = a.deadline && a.deadline < todayStr
    const bOver = b.deadline && b.deadline < todayStr
    if (aOver !== bOver) return aOver ? -1 : 1
    const aD = a.deadline || '9999-99-99'
    const bD = b.deadline || '9999-99-99'
    if (aD !== bD) return aD.localeCompare(bD)
    const order = { urgent: 0, high: 1, normal: 2, low: 3 }
    return (order[a.priority] ?? 2) - (order[b.priority] ?? 2)
  })

  const open    = sorted.filter(t => t.jira_status_category === 'in_progress' || t.jira_status_category === 'to_do').length
  const review  = sorted.filter(t => (t.jira_status || '').toLowerCase().includes('review')).length
  const done    = tasks.filter(t => t.jira_status_category === 'done').length

  return (
    <div className={styles.jiraWrap}>
      <div className={styles.jiraBar}>
        <span className={styles.jiraBarTitle}>Jira — open tickets voor Jelle</span>
        <span className={styles.jiraBarPill}>In progress</span>
        <span className={styles.jiraBarMeta}>
          <strong>{open}</strong> open · <strong>{review}</strong> in review · <strong>{done}</strong> done
        </span>
      </div>
      {sorted.length === 0 ? (
        <div className={styles.jiraEmpty}>Geen Jira-tickets binnen dit filter.</div>
      ) : (
        <table className={styles.jiraTable}>
          <thead><tr><th>Key</th><th>Titel</th><th>Status</th><th>Prio</th><th>Deadline</th></tr></thead>
          <tbody>
            {sorted.map(t => {
              const kind = t.deadline_kind || 'day'
              const urgency = dateUrgencyKind(t.deadline, kind)
              const statusCls = t.jira_status_category === 'done' ? styles.statusDone
                : t.jira_status_category === 'in_progress' ? styles.statusProgress
                : (t.jira_status || '').toLowerCase().includes('review') ? styles.statusReview
                : styles.statusTodo
              const prio = dbPrioToMockup(t.priority)
              return (
                <tr key={t.id}>
                  <td><span className={styles.jiraKey} onClick={() => t.source_url && window.open(t.source_url, '_blank')}>{t.source_ref || '—'}</span></td>
                  <td>{t.title}</td>
                  <td><span className={`${styles.jiraStatus} ${statusCls}`}>{t.jira_status || 'open'}</span></td>
                  <td><span className={`${styles.prioPill} ${styles[prio]}`}>{prio}</span></td>
                  <td><span className={`${styles.jiraDate} ${urgency ? styles[urgency] : ''}`}>{t.deadline ? fmtDateOrMonth(t.deadline, kind) : '—'}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

/* ============ Afgerond ============ */
function AfgerondTab({ tasks, applyOptimistic }) {
  if (tasks.length === 0) {
    return <div className={styles.empty}>Nog geen afgeronde taken. Vink een taak af om hem hier in het log te zien.</div>
  }
  const restore = async (id) => {
    applyOptimistic(id, { status: 'open', completed_at: null })
    await supabase.from('tasks').update({ status: 'open', completed_at: null }).eq('id', id)
  }
  return (
    <>
      <div className={styles.hint}>Log van afgeronde taken — meest recent eerst.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {tasks.slice(0, 50).map(t => {
          const prio = dbPrioToMockup(t.priority)
          const when = t.completed_at || t.updated_at
          const kind = t.deadline_kind || 'day'
          return (
            <div key={t.id} className={styles.logRow}>
              <div className={`${styles.taskCb} ${styles.checked}`} />
              <span className={styles.taskTitle}>{t.title}</span>
              <div className={styles.logMeta}>
                <span className={`${styles.prioPill} ${styles[prio]}`}>{prio}</span>
                {when && <span>{fmtDateOrMonth(when.slice(0, 10), kind)}</span>}
                <button className={styles.logRestore} onClick={() => restore(t.id)}>Heropen</button>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
