import { useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useTasks } from '../../hooks/useTasks'
import MIcon from '../MIcon'
import MobileNewTask from './MobileNewTask'

// MobileTaken — touch-geoptimaliseerde takenlijst. Geport uit
// app/mobile-taken.jsx. Hergebruikt useTasks(); tab-categorisatie spiegelt de
// desktop-logica (Mijn/Sales/Nieuw/Projecten/Jira). Afvinken = status 'done'
// (optimistisch verborgen). FAB opent de MobileNewTask-sheet.
const OPEN_STATUSES = ['open', 'snoozed', 'blocked']

const TABS = [
  { key: 'mijn', label: 'Mijn taken' },
  { key: 'sales', label: 'Sales' },
  { key: 'nieuw', label: 'Nieuw' },
  { key: 'projecten', label: 'Projecten' },
  { key: 'jira', label: 'Jira' },
]
const DATE_FILTERS = [
  { key: 'alle', label: 'Alle' },
  { key: 'verlopen', label: 'Verlopen' },
  { key: 'vandaag', label: 'Vandaag' },
  { key: 'week', label: 'Deze week' },
]
const PRIO_GROUPS = [
  { key: 'hoog', label: 'Hoog' },
  { key: 'middel', label: 'Middel' },
  { key: 'laag', label: 'Laag' },
]

function prioKey(priority) {
  const p = String(priority || '').toLowerCase()
  if (['hoog', 'high', 'urgent', 'critical', '1'].includes(p)) return 'hoog'
  if (['middel', 'medium', 'normal', 'normaal', '2'].includes(p)) return 'middel'
  return 'laag'
}
function tabOf(t) {
  if (t.is_newly_found) return 'nieuw'
  if (t.source === 'jira') return 'jira'
  if (t.source === 'sales_followup') return 'sales'
  if (t.project_id) return 'projecten'
  return 'mijn'
}
function todayMidMs() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() }

const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']
function dueChip(t) {
  const when = t.deadline || t.do_date
  if (!when) return null
  const mid = todayMidMs()
  const d = new Date(when); d.setHours(0, 0, 0, 0)
  const diff = Math.round((d.getTime() - mid) / 86400000)
  if (diff < 0) return { label: 'verlopen', state: 'overdue' }
  if (diff === 0) return { label: 'vandaag', state: 'today' }
  if (diff === 1) return { label: 'morgen', state: '' }
  return { label: `${d.getDate()} ${MONTHS[d.getMonth()]}`, state: '' }
}

export default function MobileTaken() {
  const { tasks, projects, refresh } = useTasks()
  const [tab, setTab] = useState('mijn')
  const [dateF, setDateF] = useState('alle')
  const [newOpen, setNewOpen] = useState(false)
  const [justDone, setJustDone] = useState(() => new Set())

  const projName = (id) => projects.find(p => p.id === id)?.name || ''

  const complete = async (id) => {
    setJustDone(prev => new Set(prev).add(id))
    const { error } = await supabase.from('tasks').update({ status: 'done', completed_at: new Date().toISOString() }).eq('id', id)
    if (error) {
      setJustDone(prev => { const n = new Set(prev); n.delete(id); return n })
    } else {
      refresh()
    }
  }

  const tabCounts = useMemo(() => {
    const c = { mijn: 0, sales: 0, nieuw: 0, projecten: 0, jira: 0 }
    for (const t of tasks) {
      if (t.status === 'done' || t.status === 'dropped' || t.in_backlog) continue
      if (justDone.has(t.id)) continue
      c[tabOf(t)]++
    }
    return c
  }, [tasks, justDone])

  const visible = useMemo(() => {
    const mid = todayMidMs()
    const weekEnd = mid + 7 * 86400000
    return tasks.filter(t => {
      if (t.status === 'done' || t.status === 'dropped' || t.in_backlog) return false
      if (justDone.has(t.id)) return false
      if (tabOf(t) !== tab) return false
      if (dateF === 'alle') return true
      const when = t.deadline || t.do_date
      if (!when) return dateF === 'alle'
      const w = new Date(when).getTime()
      if (dateF === 'verlopen') return w < mid
      if (dateF === 'vandaag') return w >= mid && w < mid + 86400000
      if (dateF === 'week') return w >= mid && w < weekEnd
      return true
    })
  }, [tasks, tab, dateF, justDone])

  const overdue = visible.filter(t => { const w = t.deadline || t.do_date; return w && new Date(w).getTime() < todayMidMs() }).length
  const today = visible.filter(t => { const c = dueChip(t); return c?.state === 'today' }).length

  const groups = useMemo(() => {
    const g = { hoog: [], middel: [], laag: [] }
    for (const t of visible) g[prioKey(t.priority)].push(t)
    return g
  }, [visible])

  return (
    <div className="m-dash">
      <header className="m-tk__head">
        <div className="m-tk__head-top">
          <div className="m-tk__eyebrow">WERKRUIMTE<span>Taken</span></div>
        </div>
        <h1 className="m-greet m-tk__title">{visible.length} {visible.length === 1 ? 'open taak' : 'open taken'}</h1>
        <div className="m-greet-sub">{overdue} verlopen · {today} voor vandaag</div>

        <div className="m-tabpills">
          {TABS.map(t => (
            <button key={t.key} type="button" className={`m-tabpill ${tab === t.key ? 'is-active' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}<span className="m-tabpill__cnt">{tabCounts[t.key]}</span>
            </button>
          ))}
        </div>
      </header>

      <div className="m-datestrip">
        {DATE_FILTERS.map(d => (
          <button key={d.key} type="button" className={`m-datechip ${dateF === d.key ? 'is-active' : ''}`} onClick={() => setDateF(d.key)}>{d.label}</button>
        ))}
      </div>

      <div className="m-tk__body">
        {visible.length === 0 ? (
          <div className="m-tl__empty">Geen taken in deze weergave.</div>
        ) : (
          PRIO_GROUPS.map(pg => (
            <div key={pg.key} className="m-prio-group">
              <div className="m-prio-group__head">
                <span className={`m-prio-group__dot m-prio-group__dot--${pg.key}`} />
                <span className="m-prio-group__label">{pg.label}</span>
                <span className="m-prio-group__cnt">{groups[pg.key].length}</span>
              </div>
              {groups[pg.key].length === 0 ? (
                <div className="m-empty-zone">Geen taken</div>
              ) : (
                groups[pg.key].map(t => {
                  const due = dueChip(t)
                  const meta = [projName(t.project_id), t.source === 'sales_followup' ? 'Sales follow-up' : t.source === 'jira' ? 'Jira' : ''].filter(Boolean).join(' · ')
                  return (
                    <div key={t.id} className={`m-task m-task--${pg.key}`}>
                      <button type="button" className="m-task__check" onClick={() => complete(t.id)} aria-label="Afvinken" />
                      <div className="m-task__main">
                        <div className="m-task__title">{t.title || '(taak zonder titel)'}</div>
                        {meta && <div className="m-task__meta">{meta}</div>}
                        <div className="m-task__pills">
                          <span className={`m-priopill m-priopill--${pg.key}`}>{pg.label.toUpperCase()}</span>
                          {due && <span className={`m-duepill m-duepill--${due.state || 'none'}`}>{due.label}</span>}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          ))
        )}
      </div>

      <button type="button" className="m-fab" onClick={() => setNewOpen(true)} aria-label="Nieuwe taak">
        <MIcon name="plus" size={24} color="#fff" stroke={2.2} />
      </button>

      <MobileNewTask open={newOpen} onClose={() => setNewOpen(false)} projects={projects} onCreated={refresh} />
    </div>
  )
}
