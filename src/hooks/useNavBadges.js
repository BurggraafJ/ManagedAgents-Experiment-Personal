import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, createRealtimeChannel } from '../lib/supabase'

/**
 * useNavBadges — sidebar-tellers via één view-read.
 *
 * Leest counts uit `v_nav_badges` (één rij met alle badge-totalen) + de
 * tasks-array apart, omdat App.jsx daar de specifieke velden voor
 * urgency-bepaling nodig heeft.
 *
 * Realtime listeners op de source-tabellen triggeren een refetch.
 *
 * Returns:
 *  - adminPending          aantal pending/amended daily-admin proposals
 *  - salesNeedsReview      aantal sales_on_road_events met status='needs_review'
 *  - tasks                 array van open tasks (App.jsx bepaalt urgency)
 *  - autodraftPropsCount   som van pending category + lesson proposals
 *  - securityFindings      open critical/high findings (severity-filter client-side)
 *  - refresh()
 */
const POLL_MS = 2 * 60 * 1000
const REALTIME_DEBOUNCE_MS = 1500

export function useNavBadges() {
  const [badges, setBadges] = useState(null)
  const [tasks, setTasks] = useState([])
  const [securityFindings, setSecurityFindings] = useState([])
  const debounceRef = useRef(null)

  const fetchAll = useCallback(async () => {
    const safeQ = (q) => Promise.resolve(q).then(r => r).catch(e => ({ data: [], error: e }))
    try {
      const [badgesRes, tasksRes, secRes] = await Promise.all([
        safeQ(supabase.from('v_nav_badges').select('*').maybeSingle()),
        safeQ(supabase.from('tasks')
          .select('id,status,deadline,do_date,is_newly_found,in_backlog,source')
          .in('status', ['open', 'snoozed', 'blocked'])
          .limit(500)),
        safeQ(supabase.from('security_findings')
          .select('id,severity,status')
          .eq('status', 'open')
          .in('severity', ['critical', 'high'])),
      ])
      setBadges(badgesRes.data || null)
      setTasks(tasksRes.data || [])
      setSecurityFindings(secRes.data || [])
    } catch {
      // safeQ vangt al af; deze try/catch is alleen een vangnet
    }
  }, [])

  const scheduleRefetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(fetchAll, REALTIME_DEBOUNCE_MS)
  }, [fetchAll])

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, POLL_MS)
    return () => clearInterval(id)
  }, [fetchAll])

  useEffect(() => {
    const channel = createRealtimeChannel('nav-badges-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_proposals' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_on_road_events' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'autodraft_category_proposals' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'autodraft_lesson_proposals' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'security_findings' }, scheduleRefetch)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [scheduleRefetch])

  return {
    adminPending: badges?.admin_pending || 0,
    salesNeedsReview: badges?.sales_needs_review || 0,
    tasks,
    autodraftPropsCount: (badges?.autodraft_category_pending || 0) + (badges?.autodraft_lesson_pending || 0),
    securityFindings,
    refresh: fetchAll,
  }
}
