import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

/**
 * useNavBadges — minimale fetch voor de sidebar-tellers.
 *
 * Vervangt het sidebar-deel van de oude monoliet-`useDashboard` hook. Levert
 * alleen counts en filters die App.jsx's `nav`-useMemo nodig heeft. Per-view
 * data komt uit hun eigen feature-hooks (useAdmin, useAutoDraft, etc.).
 *
 * Het verschil met `useDashboard` is groot: één Promise.all met 7 lichte
 * queries (filtered/limit/select) ipv 38. Realtime alleen op de zes tabellen
 * waarvan een count-verandering een sidebar-update triggert.
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
  const [adminProposals, setAdminProposals] = useState([])
  const [salesEvents, setSalesEvents] = useState([])
  const [chatMessages, setChatMessages] = useState([])
  const [tasks, setTasks] = useState([])
  const [autodraftCategoryProposalsCount, setAutodraftCategoryProposalsCount] = useState(0)
  const [autodraftLessonProposalsCount, setAutodraftLessonProposalsCount] = useState(0)
  const [securityFindings, setSecurityFindings] = useState([])
  const [recentRuns, setRecentRuns] = useState([])
  const debounceRef = useRef(null)

  const fetchAll = useCallback(async () => {
    const safeQ = (q) => Promise.resolve(q).then(r => r).catch(e => ({ data: [], error: e }))
    try {
      const [
        proposalsRes, salesRes, chatRes, tasksRes, catPropsRes, lessonPropsRes, secRes, runsRes,
      ] = await Promise.all([
        safeQ(supabase.from('agent_proposals')
          .select('id,agent_name,status')
          .eq('agent_name', 'daily-admin')
          .in('status', ['pending', 'amended'])),
        safeQ(supabase.from('sales_on_road_events')
          .select('id,status')
          .eq('status', 'needs_review')),
        safeQ(supabase.from('agent_chat_messages')
          .select('id,status,author')
          .eq('status', 'pending')
          .eq('author', 'user')),
        safeQ(supabase.from('tasks')
          .select('id,status,deadline,do_date,is_newly_found,in_backlog')
          .in('status', ['open', 'snoozed', 'blocked'])
          .limit(500)),
        safeQ(supabase.from('autodraft_category_proposals').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
        safeQ(supabase.from('autodraft_lesson_proposals').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
        safeQ(supabase.from('security_findings')
          .select('id,severity,status')
          .eq('status', 'open')
          .in('severity', ['critical', 'high'])),
        safeQ(supabase.from('agent_runs').select('*').order('started_at', { ascending: false }).limit(30)),
      ])
      setAdminProposals(proposalsRes.data || [])
      setSalesEvents(salesRes.data || [])
      setChatMessages(chatRes.data || [])
      setTasks(tasksRes.data || [])
      setAutodraftCategoryProposalsCount(catPropsRes.count || 0)
      setAutodraftLessonProposalsCount(lessonPropsRes.count || 0)
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
    // Unieke channel-naam per mount voorkomt StrictMode-double-mount-conflict
    // (Supabase weigert callbacks toevoegen aan al-subscribed channel met
    // dezelfde naam — gebeurde in dev na sessie 12 toen NowView óók de hook
    // probeerde te gebruiken; nu via prop, maar dev-double-mount blijft).
    const channelName = `nav-badges-live-${Math.random().toString(36).slice(2, 9)}`
    const channel = supabase
      .channel(channelName)
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
    adminPending: adminProposals.length,
    salesNeedsReview: salesEvents.length,
    chatPending: chatMessages.length,
    tasks,
    autodraftPropsCount: autodraftCategoryProposalsCount + autodraftLessonProposalsCount,
    securityFindings,
    recentRuns,
    refresh: fetchAll,
  }
}
