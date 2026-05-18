import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, createRealtimeChannel } from '../lib/supabase'

/**
 * useNavBadges — sidebar-tellers via één view-read.
 *
 * Leest counts uit `v_nav_badges` (één rij met alle badge-totalen) + de
 * tasks-array en recente runs apart, omdat App.jsx daar de specifieke
 * velden voor urgency-bepaling en NotificationDrawer nodig heeft.
 *
 * Realtime listeners op de 8 source-tabellen triggeren een refetch.
 *
 * Returns:
 *  - adminPending          aantal pending/amended daily-admin proposals
 *  - salesNeedsReview      aantal sales_on_road_events met status='needs_review'
 *  - chatPending           aantal pending user-messages in agent_chat_messages
 *  - tasks                 array van open tasks (App.jsx bepaalt urgency)
 *  - autodraftPropsCount   som van pending category + lesson proposals
 *  - securityFindings      open critical/high findings (severity-filter client-side)
 *  - recentRuns            laatste 30 runs voor NotificationDrawer
 *  - refresh()
 */
const POLL_MS = 2 * 60 * 1000
const REALTIME_DEBOUNCE_MS = 1500

export function useNavBadges() {
  const [badges, setBadges] = useState(null)
  const [tasks, setTasks] = useState([])
  const [securityFindings, setSecurityFindings] = useState([])
  const [recentRuns, setRecentRuns] = useState([])
  const debounceRef = useRef(null)

  const fetchAll = useCallback(async () => {
    const safeQ = (q) => Promise.resolve(q).then(r => r).catch(e => ({ data: [], error: e }))
    try {
      const [badgesRes, tasksRes, secRes, runsRes] = await Promise.all([
        safeQ(supabase.from('v_nav_badges').select('*').maybeSingle()),
        safeQ(supabase.from('tasks')
          .select('id,status,deadline,do_date,is_newly_found,in_backlog')
          .in('status', ['open', 'snoozed', 'blocked'])
          .limit(500)),
        safeQ(supabase.from('security_findings')
          .select('id,severity,status')
          .eq('status', 'open')
          .in('severity', ['critical', 'high'])),
        safeQ(supabase.from('agent_runs').select('*').order('started_at', { ascending: false }).limit(30)),
      ])
      setBadges(badgesRes.data || null)
      setTasks(tasksRes.data || [])
      setSecurityFindings(secRes.data || [])
      setRecentRuns(runsRes.data || [])
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_chat_messages' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'autodraft_category_proposals' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'autodraft_lesson_proposals' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'security_findings' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_runs' }, scheduleRefetch)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [scheduleRefetch])

  return {
    adminPending: badges?.admin_pending || 0,
    salesNeedsReview: badges?.sales_needs_review || 0,
    chatPending: badges?.chat_pending || 0,
    tasks,
    autodraftPropsCount: (badges?.autodraft_category_pending || 0) + (badges?.autodraft_lesson_pending || 0),
    securityFindings,
    recentRuns,
    refresh: fetchAll,
  }
}
