import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { supabase } from '../../../lib/supabase'
import { useTasks } from '../../../hooks/useTasks'
import { useOptimisticTasks } from '../../../hooks/useOptimisticTasks'
import { isMijnTask, isShownTask, isOpenTask, dueOf, deriveProjects } from '../../../lib/taskViews'
import { mockupPrioToDb, passesDateFilter } from './v2-helpers'
import { TASK_TYPES } from './V2TypePop'
import V2TaskDetail from './V2TaskDetail'
import MijnTab from './MijnTab'
import ProjectenTab from './ProjectenTab'
import { AfgerondTab, VerwijderdTab } from './ArchiveTabs'
import styles from './taken-v2.module.css'

// TakenV2View (v1.125, design "A2") — iOS-segment Mijn taken | Projecten.
// Mijn taken: prio-groepen Hoog/Middel/Laag in hairline-kaarten, datum rechts.
// Projecten: projectlijst links + 3 fase-kolommen Te doen / Bezig / Testen.
// Afgeronde taken / Verwijderd zitten achter het ⋯-menu. Jira / Sales / Nieuw
// gevonden bestaan niet meer in de UI (product-cut 2026-09-01); de filters
// (datum / bron / categorie) blijven, ingeklapt achter de Filter-knop.
const SEGS = [{ id: 'mijn', label: 'Mijn taken' }, { id: 'projecten', label: 'Projecten' }]
const ARCHIVE = { afgerond: 'Afgeronde taken', verwijderd: 'Verwijderd' }
const TYPE_FILTERS = [{ id: 'all', label: 'Alle' }, ...TASK_TYPES.map(t => ({ id: t.id, label: t.label, icon: t.icon }))]
const DATE_FILTERS = [
  { id: 'all', label: 'Alle' }, { id: 'overdue', label: 'Verlopen' }, { id: 'today', label: 'Vandaag' },
  { id: 'tomorrow', label: 'Morgen' }, { id: 'week', label: 'Deze week' }, { id: 'month', label: 'Deze maand' }, { id: 'none', label: 'Geen datum' },
]
const FILTER_SOURCES = [{ id: 'deadline', label: 'Deadline' }, { id: 'created', label: 'Aangemaakt' }, { id: 'backlog', label: 'Op backlog' }]

/** Persistente filter-state — onthoud 10u in localStorage. */
const FILTERS_STORAGE_KEY = 'tv2_filters_v1'
const FILTERS_TTL_MS = 10 * 60 * 60 * 1000
const FILTERS_DEFAULTS = { dateFilter: 'all', filterSource: 'deadline', typeFilter: 'all' }
function loadFilters() {
  try {
    const raw = localStorage.getItem(FILTERS_STORAGE_KEY)
    if (!raw) return FILTERS_DEFAULTS
    const parsed = JSON.parse(raw)
    if (!parsed._ts || Date.now() - parsed._ts > FILTERS_TTL_MS) return FILTERS_DEFAULTS
    const { moreOpen, _ts, ...rest } = parsed
    return { ...FILTERS_DEFAULTS, ...rest }
  } catch { return FILTERS_DEFAULTS }
}
function saveFilters(state) {
  try { localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify({ ...state, _ts: Date.now() })) } catch {}
}

function useClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id) }, [])
  return String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0')
}

async function triggerRunNu() {
  await supabase.from('agent_schedules').update({ manual_run_requested_at: new Date().toISOString() }).eq('agent_name', 'taken')
}

function SkeletonGroups() {
  return ['hoog', 'middel', 'laag'].map((k, gi) => (
    <section key={k} className={styles.group}>
      <header className={`${styles.groupHead} ${styles['groupHead_' + k]}`}><i className={styles.groupMark} />{k}</header>
      {Array.from({ length: 3 - gi }).map((_, i) => (
        <div key={i} className={styles.skelRow}><div className={`${styles.skel} ${styles.skelCb}`} /><div className={`${styles.skel} ${styles.skelText}`} /><div className={`${styles.skel} ${styles.skelDate}`} /></div>
      ))}
    </section>
  ))
}

export default function TakenV2View() {
  const { tasks: rawTasks, projects, loading } = useTasks()
  const { merged: tasks, applyOptimistic } = useOptimisticTasks(rawTasks)

  const [tab, setTab] = useState('mijn')
  const [filters, setFilters] = useState(loadFilters)
  const { dateFilter, filterSource, typeFilter } = filters
  const setF = (k) => (v) => setFilters(f => ({ ...f, [k]: v }))
  useEffect(() => { saveFilters(filters) }, [filters])
  const [filterOpen, setFilterOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [detailTaskId, setDetailTaskId] = useState(null)
  const clock = useClock()
  const menuRef = useRef(null)
  useEffect(() => {
    if (!menuOpen) return
    const close = (e) => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  const shown = useMemo(() => tasks.filter(isShownTask), [tasks])
  const mijnTasks = useMemo(() => shown.filter(isMijnTask), [shown])
  const projList = useMemo(() => deriveProjects(shown, projects), [shown, projects])
  const doneTasks = useMemo(
    () => shown.filter(t => t.status === 'done').sort((a, b) => new Date(b.completed_at || b.updated_at) - new Date(a.completed_at || a.updated_at)),
    [shown],
  )
  const trashedTasks = useMemo(() => {
    const cutoff = Date.now() - 14 * 86400 * 1000
    return shown.filter(t => t.status === 'dropped' && new Date(t.updated_at || t.created_at).getTime() >= cutoff)
      .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
  }, [shown])

  const mijnLive = mijnTasks.filter(t => !t.in_backlog && passesDateFilter(t, dateFilter, filterSource) && (typeFilter === 'all' || t.task_type === typeFilter))
  const overdue = mijnLive.filter(t => dueOf(t).bucket === 'overdue').length
  const today = mijnLive.filter(t => dueOf(t).bucket === 'today').length
  const projActive = projList.filter(p => p.open.length > 0).length
  const projOpen = projList.reduce((n, p) => n + p.open.length, 0)
  const counts = { mijn: mijnLive.length, projecten: projActive, afgerond: doneTasks.length, verwijderd: trashedTasks.length }
  const activeFilters = (dateFilter !== 'all') + (filterSource !== 'deadline') + (typeFilter !== 'all')
  const stats = tab === 'mijn' ? `${overdue} verlopen · ${today} voor vandaag`
    : tab === 'projecten' ? `${projOpen} open taken in ${projActive} ${projActive === 1 ? 'project' : 'projecten'}`
    : `${counts[tab]} ${tab === 'afgerond' ? 'afgerond' : 'in de prullenbak (14 dagen)'}`

  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <div className={styles.crumb}>
          <span className={styles.crumbLbl}>Werkruimte</span><span className={styles.crumbSep}>/</span><span className={styles.crumbCur}>Taken</span>
        </div>
        <div className={styles.topbarRight}>
          <div className={styles.syncPill}><span className={styles.syncDot} /><span>Live</span><span className={styles.syncMeta}>{clock}</span></div>
          <button type="button" className={styles.runBtn} onClick={triggerRunNu} title="Trigger handmatige run van de Taken-skill">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg>
            Run nu
          </button>
        </div>
      </header>

      <main className={`${styles.main} ${tab === 'projecten' ? styles.mainWide : ''}`}>
        <div className={styles.toolbar}>
          <div className={styles.seg} role="tablist">
            {SEGS.map(s => (
              <button key={s.id} type="button" role="tab" aria-selected={tab === s.id} className={`${styles.segBtn} ${tab === s.id ? styles.segActive : ''}`} onClick={() => setTab(s.id)}>
                {s.label}<span className={styles.segCnt}>{counts[s.id]}</span>
              </button>
            ))}
          </div>
          {ARCHIVE[tab] && (
            <button type="button" className={styles.archiveChip} onClick={() => setTab('mijn')} title="Terug naar Mijn taken">{ARCHIVE[tab]} ×</button>
          )}
          <span className={styles.stats}>{stats}</span>
          <span className={styles.spacer} />
          {tab === 'mijn' && (
            <button type="button" className={`${styles.ghostBtn} ${(filterOpen || activeFilters) ? styles.ghostActive : ''}`} onClick={() => setFilterOpen(o => !o)} title="Filters op datum, bron en categorie">
              Filter{activeFilters > 0 && <span className={styles.ghostBadge}>{activeFilters}</span>}
            </button>
          )}
          <div className={styles.menuWrap} ref={menuRef}>
            <button type="button" className={styles.ghostBtn} onClick={() => setMenuOpen(o => !o)} title="Meer" aria-haspopup="menu" aria-expanded={menuOpen}>⋯</button>
            {menuOpen && (
              <div className={styles.menu} role="menu">
                {Object.entries(ARCHIVE).map(([id, label]) => (
                  <button key={id} type="button" role="menuitem" className={styles.menuItem} onClick={() => { setTab(id); setMenuOpen(false) }}>
                    {label}<span>{counts[id]}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {tab === 'mijn' && (
            <button type="button" className={styles.btnPrimary} onClick={() => setAddOpen(o => !o)}>+ Nieuwe taak</button>
          )}
        </div>

        {tab === 'mijn' && filterOpen && (
          <div className={styles.filterPanel}>
            <div className={styles.filterRow}><span className={styles.filterLbl}>Datum</span>{DATE_FILTERS.map(f => <Chip key={f.id} on={dateFilter === f.id} onClick={() => setF('dateFilter')(f.id)}>{f.label}</Chip>)}</div>
            <div className={styles.filterRow}><span className={styles.filterLbl}>Bron</span>{FILTER_SOURCES.map(s => <Chip key={s.id} on={filterSource === s.id} onClick={() => setF('filterSource')(s.id)}>{s.label}</Chip>)}</div>
            <div className={styles.filterRow}><span className={styles.filterLbl}>Categorie</span>{TYPE_FILTERS.map(f => <Chip key={f.id} on={typeFilter === f.id} onClick={() => setF('typeFilter')(f.id)}>{f.icon ? f.icon + ' ' : ''}{f.label}</Chip>)}</div>
          </div>
        )}
        {tab === 'mijn' && addOpen && <AddTaskForm onClose={() => setAddOpen(false)} />}

        <div className={styles.body}>
          {loading && rawTasks.length === 0 ? <SkeletonGroups /> : (
            <>
              {tab === 'mijn'       && <MijnTab tasks={mijnTasks} dateFilter={dateFilter} filterSource={filterSource} typeFilter={typeFilter} applyOptimistic={applyOptimistic} onOpenDetail={setDetailTaskId} />}
              {tab === 'projecten'  && <ProjectenTab tasks={shown.filter(isOpenTask)} projList={projList} applyOptimistic={applyOptimistic} onOpenDetail={setDetailTaskId} />}
              {tab === 'afgerond'   && <AfgerondTab tasks={doneTasks} applyOptimistic={applyOptimistic} />}
              {tab === 'verwijderd' && <VerwijderdTab tasks={trashedTasks} applyOptimistic={applyOptimistic} />}
            </>
          )}
        </div>
      </main>

      {detailTaskId && (() => {
        const dt = tasks.find(t => t.id === detailTaskId)
        if (!dt) return null
        const proj = dt.project_id ? projects.find(p => p.id === dt.project_id) : null
        return <V2TaskDetail task={dt} project={proj} onClose={() => setDetailTaskId(null)} applyOptimistic={applyOptimistic} />
      })()}
    </div>
  )
}

function Chip({ on, onClick, children }) {
  return <button type="button" className={`${styles.chip} ${on ? styles.chipOn : ''}`} onClick={onClick}>{children}</button>
}

/* ============ Add task form (knop "+ Nieuwe taak") ============ */
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
      await supabase.from('tasks').insert({ title: t, priority: mockupPrioToDb(prio), deadline: deadline || null, source: 'manual', ai_processed: false })
      setTitle(''); setDeadline(''); setPrio('hoog')
      onClose()
    } finally { setBusy(false) }
  }, [title, prio, deadline, busy, onClose])
  return (
    <div className={styles.addForm}>
      <input type="text" className={styles.addInput} placeholder="Omschrijving van de taak…" value={title} autoFocus
        onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onClose() }} />
      <div className={styles.filterRow}>
        <span className={styles.filterLbl}>Prioriteit</span>
        {['hoog', 'middel', 'laag'].map(p => <Chip key={p} on={prio === p} onClick={() => setPrio(p)}>{p.charAt(0).toUpperCase() + p.slice(1)}</Chip>)}
        <span className={styles.filterLbl}>Deadline</span>
        <input type="date" className={styles.dateInput} value={deadline} onChange={e => setDeadline(e.target.value)} />
        <span className={styles.spacer} />
        <button type="button" className={styles.btnPrimary} onClick={save} disabled={!title.trim() || busy}>{busy ? '…' : 'Voeg toe'}</button>
        <button type="button" className={styles.ghostBtn} onClick={onClose}>Annuleer</button>
      </div>
    </div>
  )
}
