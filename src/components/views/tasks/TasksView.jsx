import { useState, useMemo, useCallback } from 'react'
import { useTasks } from '../../../hooks/useTasks'
import { useAutoDraft } from '../../../hooks/useAutoDraft'
import {
  bucketOf,
  looksLikeForJelle,
  sortTasks,
} from '../../../lib/tasks'
import './tasks-maestro.css'
import styles from './tasks.module.css'
import TopActionBar from './TopActionBar'
import PriorityLane from './PriorityLane'
import NewlyFoundSection from './NewlyFoundSection'
import SalesFollowUps from './SalesFollowUps'
import QuickCapture from './QuickCapture'
import ProjectsTab from './ProjectsTab'
import JiraTab from './JiraTab'
import AfgerondTab from './AfgerondTab'

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
  projecten: 'Taken gegroepeerd per project',
  nieuw:     'Door de agent gevonden, nog te bevestigen',
  sales:     'HubSpot-deals die actie vragen',
  jira:      'Open Jira-tickets',
  afgerond:  'Recent voltooid — herstel mogelijk',
}

export default function TasksView() {
  const { tasks, projects: rawProjects } = useTasks()
  const { mails: autodraftMails } = useAutoDraft()

  const projects = useMemo(
    () => (rawProjects || []).slice().sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100)),
    [rawProjects]
  )

  const [search, setSearch] = useState('')
  const [subTab, setSubTab] = useState('mijn')

  const klantMailsPending = useMemo(
    () => autodraftMails.filter(m =>
      (m.category_key || '').startsWith('klant_') &&
      m.status !== 'done' &&
      m.status !== 'dismissed'
    ),
    [autodraftMails]
  )

  const matchesSearch = useCallback((t) => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return (t.title || '').toLowerCase().includes(q)
        || (t.notes || '').toLowerCase().includes(q)
        || (t.tags || []).some(tag => tag.toLowerCase().includes(q))
  }, [search])

  const buckets = useMemo(() => {
    const out = {
      high: { live: [], backlog: [] },
      mid:  { live: [], backlog: [] },
      low:  { live: [], backlog: [] },
    }
    for (const t of tasks) {
      if (!matchesSearch(t)) continue
      if (t.status === 'done' || t.status === 'dropped') continue
      if (t.is_newly_found) continue
      if (t.source === 'jira') continue

      const lane = bucketOf(t)
      if (t.in_backlog) out[lane].backlog.push(t)
      else out[lane].live.push(t)
    }
    for (const lane of Object.keys(out)) {
      out[lane].live    = sortTasks(out[lane].live)
      out[lane].backlog = sortTasks(out[lane].backlog)
    }
    return out
  }, [tasks, matchesSearch])

  const newlyFoundAll = useMemo(() => {
    return tasks.filter(t =>
      t.is_newly_found &&
      t.status !== 'dropped' &&
      t.source !== 'jira' &&
      matchesSearch(t)
    )
  }, [tasks, matchesSearch])

  const newlyFoundPassing = useMemo(() => {
    return newlyFoundAll.filter(t => {
      if (t.dedup_signal) return false
      if (!looksLikeForJelle(t)) return false
      const title = (t.title || '').toLowerCase()
      const notes = (t.notes || '').toLowerCase()
      const haystack = title + ' ' + notes
      const matchesPendingMail = klantMailsPending.some(m => {
        const subj = (m.subject || '').toLowerCase()
        if (!subj || subj.length < 8) return false
        const words = subj.split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 4)
        if (words.length === 0) return false
        const hits = words.filter(w => haystack.includes(w)).length
        return hits / words.length >= 0.6
      })
      return !matchesPendingMail
    })
  }, [newlyFoundAll, klantMailsPending])

  const newlyFoundSuppressed = useMemo(
    () => newlyFoundAll.filter(t => !newlyFoundPassing.includes(t)),
    [newlyFoundAll, newlyFoundPassing]
  )

  const jiraTasks = useMemo(
    () => tasks.filter(t =>
      t.source === 'jira' && t.jira_board !== 'Sales' &&
      t.status !== 'done' && t.status !== 'dropped'
    ),
    [tasks]
  )

  const salesActive = useMemo(
    () => tasks.filter(t =>
      t.source === 'sales_followup' &&
      t.status !== 'done' && t.status !== 'dropped'
    ),
    [tasks]
  )

  const doneCount = useMemo(
    () => tasks.filter(t => t.status === 'done').length,
    [tasks]
  )

  const projectsWithOpenCount = useMemo(() => {
    const ids = new Set()
    for (const t of tasks) {
      if (t.status === 'done' || t.status === 'dropped') continue
      if (t.is_newly_found) continue
      if (t.project_id) ids.add(t.project_id)
    }
    return ids.size
  }, [tasks])

  const totalLive = buckets.high.live.length + buckets.mid.live.length + buckets.low.live.length

  const counts = {
    mijn: totalLive,
    projecten: projectsWithOpenCount,
    nieuw: newlyFoundPassing.length,
    sales: salesActive.length,
    jira: jiraTasks.length,
    afgerond: doneCount,
  }

  const activeBadge = counts[subTab] || 0

  return (
    <div className="theme-maestro tk-maestro-app">
      <div className="et-header">
        <div className="et-header__top">
          <div className="et-header__title-grp">
            <h1 className="et-header__title">Taken</h1>
            {activeBadge > 0 && <span className="et-header__count">{activeBadge}</span>}
            <span className="et-header__sub">{TAB_SUBTITLE[subTab]}</span>
          </div>
          <div className="et-header__spacer" />
        </div>

        <div className="et-tabs">
          {TAB_DEFS.map(t => (
            <button
              key={t.id}
              type="button"
              className={`et-tab ${subTab === t.id ? 'active' : ''}`}
              onClick={() => setSubTab(t.id)}
            >
              {t.label}
              {counts[t.id] > 0 && <span className="et-tab-count">{counts[t.id]}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="et-screen__body">

        {subTab === 'mijn' && (
          <div className="et-tab-body">
            <TopActionBar search={search} onSearch={setSearch} totalLive={totalLive} />

            <div className={styles.twoColGrid}>
              <div className="et-prio-group lane-high">
                <PriorityLane
                  id="high" title="Hoog" icon="🔥" accent="#d14848"
                  live={buckets.high.live} backlog={buckets.high.backlog}
                  projects={projects} defaultOpen
                />
              </div>
              <div className="et-prio-group lane-mid">
                <PriorityLane
                  id="mid" title="Midden" icon="⚙" accent="#d97706"
                  live={buckets.mid.live} backlog={buckets.mid.backlog}
                  projects={projects} defaultOpen
                />
              </div>
            </div>

            <div className="et-prio-group lane-low">
              <PriorityLane
                id="low" title="Laag" icon="○" accent="#1e6fdb"
                live={buckets.low.live} backlog={buckets.low.backlog}
                projects={projects} defaultOpen wide
              />
            </div>

            <QuickCapture projects={projects} />
          </div>
        )}

        {subTab === 'projecten' && (
          <div className="et-tab-body">
            <ProjectsTab projects={projects} tasks={tasks} />
          </div>
        )}

        {subTab === 'nieuw' && (
          <div className="et-tab-body">
            {(newlyFoundPassing.length > 0 || newlyFoundSuppressed.length > 0) ? (
              <NewlyFoundSection
                passing={newlyFoundPassing}
                suppressed={newlyFoundSuppressed}
              />
            ) : (
              <div className="empty">Niets nieuws gevonden door de agent.</div>
            )}
          </div>
        )}

        {subTab === 'sales' && (
          <div className="et-tab-body">
            {salesActive.length > 0
              ? <SalesFollowUps tasks={salesActive} />
              : <div className="empty">Geen open sales follow-ups.</div>}
          </div>
        )}

        {subTab === 'jira' && (
          <div className="et-tab-body">
            <JiraTab tasks={jiraTasks} />
          </div>
        )}

        {subTab === 'afgerond' && (
          <div className="et-tab-body">
            <AfgerondTab tasks={tasks} />
          </div>
        )}

      </div>
    </div>
  )
}
