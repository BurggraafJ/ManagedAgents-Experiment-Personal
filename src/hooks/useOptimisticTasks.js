import { useState, useEffect, useMemo, useCallback } from 'react'

/**
 * useOptimisticTasks — centrale optimistic-store voor de Taken-view.
 * Map van taskId → partial patch. Bij elke mutation:
 *   1. applyOptimistic(id, patch)  → UI rendert meteen merged
 *   2. supabase.update              → async
 *   3. useTasks refresh             → override valt weg zodra de server-rij matcht
 */
export function useOptimisticTasks(tasks) {
  const [overrides, setOverrides] = useState(() => new Map())

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
        if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i])
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
