import { useState, useMemo, useCallback } from 'react'
import { useTasks } from '../../../hooks/useTasks'
import { useSales } from '../../../hooks/useSales'
import { useAutoDraft } from '../../../hooks/useAutoDraft'
import {
  bucketOf,
  looksLikeForJelle,
  sortTasks,
} from '../../../lib/tasks'
import SubTabBar from './SubTabBar'
import TopActionBar from './TopActionBar'
import PriorityLane from './PriorityLane'
import NewlyFoundSection from './NewlyFoundSection'
import SalesFollowUps from './SalesFollowUps'
import CompletionCandidates from './CompletionCandidates'
import QuickCapture from './QuickCapture'
import ProjectsAdmin from './ProjectsAdmin'
import JiraTab from './JiraTab'

// =====================================================================
// TasksView — Unified Taken (v2)
// =====================================================================
// Eén pagina voor alles wat Jelle moet doen. Voorheen verspreid over
// /taken (task-organizer) en /daily-tasks (sales-followups).
//
// Hoofd-layout (van boven naar beneden):
//   [Quick capture]                       [✨ AI herindelen]
//   [zoeken …]
//   🆕 Nieuw gevonden (alleen voor Jelle, met Houden / Backlog / Negeren)
//   🤝 Klant — live + ▸ Backlog
//   🔥 Hoog — live + ▸ Backlog
//   ⚙ Midden — live + ▸ Backlog
//   ⚪ Laag — live + ▸ Backlog
//   📞 Sales follow-ups (sales_todos, los read-only blok)
//   📋 Jira-overzicht (collapsed)
//   ✨ Mogelijk al klaar (collapsed)
//   📁 Projecten (collapsed)
//
// Mutaties: direct via supabase met optimistic update bij Houden/Backlog/×.
// =====================================================================

export default function TasksView() {
  // Refactor 06 — hook-migratie via scoped destructure (geen data-shim).
  const { tasks, projects: rawProjects } = useTasks()
  const { todos: salesTodos } = useSales()
  const { mails: autodraftMails } = useAutoDraft()

  const projects = useMemo(
    () => (rawProjects || []).slice().sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100)),
    [rawProjects]
  )

  const [search, setSearch] = useState('')
  const [subTab, setSubTab] = useState('taken')

  // Klant-mails die nu in Postvak op actie wachten — bron-of-truth voor dedup.
  const klantMailsPending = useMemo(
    () => autodraftMails.filter(m =>
      (m.category_key || '').startsWith('klant_') &&
      m.status !== 'done' &&
      m.status !== 'dismissed'
    ),
    [autodraftMails]
  )

  // Filter taken op zoekterm — werkt op alle secties tegelijk.
  const matchesSearch = useCallback((t) => {
    if (!search.trim()) return true
    const q = search.trim().toLowerCase()
    return (t.title || '').toLowerCase().includes(q)
        || (t.notes || '').toLowerCase().includes(q)
        || (t.tags || []).some(tag => tag.toLowerCase().includes(q))
  }, [search])

  // -- Bucketing in drie prio-buckets -----------------------------------
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
      // Alle Jira-items hebben hun eigen sectie onderaan — niet ook hier laten zien.
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

  // -- Newly-found met streng "voor Jelle"-filter + Postvak-dedup -------
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
      // Postvak-dedup: open klant-mail met >=60% woordoverlap → verbergen.
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

  // -- Andere secties ---------------------------------------------------
  const candidates = useMemo(
    () => tasks.filter(t =>
      t.completion_candidate && !t.completion_rejected &&
      t.status !== 'done' && t.status !== 'dropped'
    ),
    [tasks]
  )

  // Jira behalve Sales (Sales-jira gaat naar Klant-lane).
  const jiraTasks = useMemo(
    () => tasks.filter(t =>
      t.source === 'jira' && t.jira_board !== 'Sales' &&
      t.status !== 'done' && t.status !== 'dropped'
    ),
    [tasks]
  )

  // Sales-todos in eigen sectie.
  const salesActive = useMemo(
    () => salesTodos.filter(t => t.status !== 'completed' && t.status !== 'dismissed'),
    [salesTodos]
  )

  const totalLive = buckets.high.live.length + buckets.mid.live.length + buckets.low.live.length

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <SubTabBar
        active={subTab}
        onSelect={setSubTab}
        counts={{ taken: totalLive, jira: jiraTasks.length }}
      />

      {subTab === 'taken' ? (
        <>
          <TopActionBar search={search} onSearch={setSearch} totalLive={totalLive} />

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 'var(--s-4)',
            alignItems: 'flex-start',
          }}>
            <PriorityLane
              id="high" title="Hoog" icon="🔥" accent="#ef4444"
              live={buckets.high.live} backlog={buckets.high.backlog}
              projects={projects} defaultOpen
            />
            <PriorityLane
              id="mid" title="Midden" icon="⚙" accent="#f59e0b"
              live={buckets.mid.live} backlog={buckets.mid.backlog}
              projects={projects} defaultOpen
            />
          </div>

          <PriorityLane
            id="low" title="Laag" icon="○" accent="#94a3b8"
            live={buckets.low.live} backlog={buckets.low.backlog}
            projects={projects} defaultOpen wide
          />

          {(newlyFoundPassing.length > 0 || newlyFoundSuppressed.length > 0) && (
            <NewlyFoundSection
              passing={newlyFoundPassing}
              suppressed={newlyFoundSuppressed}
            />
          )}

          {salesActive.length > 0 && <SalesFollowUps todos={salesActive} />}

          {candidates.length > 0 && <CompletionCandidates tasks={candidates} />}

          <QuickCapture projects={projects} />

          <ProjectsAdmin projects={projects} tasks={tasks} />
        </>
      ) : (
        <JiraTab tasks={jiraTasks} />
      )}
    </div>
  )
}
