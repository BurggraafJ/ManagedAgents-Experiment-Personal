import { useMemo } from 'react'
import NarrowTaskList from './NarrowTaskList'
import ProjectsAdmin from './ProjectsAdmin'
import { sortTasks } from '../../../lib/tasks'
import styles from './tasks.module.css'

/**
 * Tab "Projecten" — taken per project, met onderaan project-admin.
 * Project zonder open taken wordt overgeslagen tenzij in admin uitgeklapt.
 */
export default function ProjectsTab({ projects, tasks }) {
  const tasksByProject = useMemo(() => {
    const map = {}
    for (const t of tasks) {
      if (t.status === 'done' || t.status === 'dropped') continue
      if (t.is_newly_found) continue
      if (!t.project_id) continue
      if (!map[t.project_id]) map[t.project_id] = []
      map[t.project_id].push(t)
    }
    for (const id of Object.keys(map)) map[id] = sortTasks(map[id])
    return map
  }, [tasks])

  const activeProjects = projects.filter(p => (tasksByProject[p.id] || []).length > 0)

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      {activeProjects.length === 0 ? (
        <div className="empty">Geen taken aan een project gekoppeld.</div>
      ) : (
        activeProjects.map(p => (
          <section key={p.id} className={styles.projectGroup}>
            <div className={styles.projectGroupHead} style={{ borderLeftColor: p.color || '#7c8aff' }}>
              {p.icon && <span className={styles.projectGroupIcon}>{p.icon}</span>}
              <span className={styles.projectGroupName}>{p.name}</span>
              <span className={styles.projectGroupCount}>{tasksByProject[p.id].length}</span>
            </div>
            <NarrowTaskList tasks={tasksByProject[p.id]} projects={projects} currentBucket="mid" />
          </section>
        ))
      )}

      <ProjectsAdmin projects={projects} tasks={tasks} />
    </div>
  )
}
