import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

const DAY = 86400000
const POLL_MS = 2 * 60 * 1000
const REALTIME_DEBOUNCE_MS = 1500

export function useDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [online, setOnline] = useState(true)
  const debounceRef = useRef(null)

  const fetchAll = useCallback(async () => {
    const now = new Date()
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0)
    const weekStart = new Date(now)
    weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7))
    weekStart.setHours(0, 0, 0, 0)
    const lastWeekStart = new Date(weekStart.getTime() - 7 * DAY)

    try {
      // Legacy AutoDraft v3-tabellen (draft_events, draft_templates, draft_feedback)
      // zijn uitgefaseerd per v5.3 — vervangen door autodraft_mails / autodraft_decisions /
      // autodraft_categories / autodraft_lesson_proposals. Niet meer ophalen.
      const [runs, questions, feedback, schedules, runHistory, linkedin, salesEvents, salesTodos, proposals, filtered, chat, noteTemplates, pipelines, terminology, agentInstructions, hubspotUsers, skillSecrets, linkedinTargets, linkedinStrategy, linkedinActivity, autodraftMails, autodraftCategories, autodraftCategoryProposals, autodraftDecisions, autodraftFolders, autodraftLessons, autodraftLessonProposals, tasks, taskProjects, mailMessages] = await Promise.all([
        supabase.from('agent_runs').select('*').order('started_at', { ascending: false }).limit(500),
        supabase.from('open_questions').select('*').order('expires_at', { ascending: true, nullsFirst: false }),
        supabase.from('agent_feedback').select('*').order('created_at', { ascending: false }).limit(50),
        supabase.from('agent_schedules').select('*').order('agent_name'),
        supabase.from('agent_runs').select('agent_name,status,started_at')
          .gte('started_at', new Date(now - 14 * DAY).toISOString())
          .order('started_at', { ascending: false }),
        supabase.from('linkedin_progress').select('*')
          .eq('year', now.getFullYear())
          .order('week_number', { ascending: false })
          .limit(30),
        supabase.from('sales_on_road_events').select('*').order('created_at', { ascending: false }).limit(50),
        supabase.from('sales_todos').select('*').order('created_at', { ascending: false }).limit(100),
        supabase.from('agent_proposals').select('*').order('created_at', { ascending: false }).limit(200),
        supabase.from('daily_admin_filtered_records').select('*').order('scanned_at', { ascending: false }).limit(100),
        supabase.from('agent_chat_messages').select('*').order('sent_at', { ascending: false }).limit(100),
        supabase.from('note_templates').select('*').order('sort_order'),
        supabase.from('hubspot_pipelines').select('*').order('sort_order'),
        supabase.from('terminology_corrections').select('*').order('incorrect'),
        supabase.from('agent_config')
          .select('agent_name,config_key,config_value,updated_at')
          .eq('config_key', 'custom_instructions'),
        supabase.from('hubspot_users')
          .select('hubspot_owner_id,email,first_name,last_name,full_name,active,is_primary')
          .eq('active', true)
          .order('is_primary', { ascending: false })
          .order('full_name'),
        supabase.from('skill_secrets_registry')
          .select('id,skill_name,secret_name,description,last_4,vault_secret_id,updated_at,updated_by')
          .order('skill_name'),
        supabase.from('linkedin_targets').select('*').order('created_at', { ascending: false }).limit(500),
        supabase.from('linkedin_strategy').select('*').eq('id', 1).maybeSingle(),
        supabase.from('linkedin_activity_log').select('*').order('created_at', { ascending: false }).limit(200),
        supabase.from('autodraft_mails').select('*').order('received_at', { ascending: false }).limit(300),
        supabase.from('autodraft_categories').select('*').order('sort_order'),
        supabase.from('autodraft_category_proposals').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(50),
        supabase.from('autodraft_decisions').select('*').order('decided_at', { ascending: false }).limit(300),
        supabase.from('autodraft_folders').select('*').order('full_path'),
        supabase.from('autodraft_style_lessons').select('*').eq('active', true).order('created_at', { ascending: false }).limit(100),
        supabase.from('autodraft_lesson_proposals').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(50),
        supabase.from('tasks').select('*').order('created_at', { ascending: false }).limit(500),
        supabase.from('task_projects').select('*').order('sort_order'),
        // mail-DB (gevuld door mail-sync skill, truth-of-source voor mail-context)
        // Lichte select: lijst-data + body_preview voor de inbox; volledige body
        // wordt on-demand gefetched via get_thread_messages of losse query.
        supabase.from('mail_messages')
          .select('id,conversation_id,received_at,from_email,from_name,to_recipients,cc_recipients,subject,body_preview,has_attachments,folder_id,folder_path,is_read,is_from_me,is_deleted,synced_at,body_truncated')
          .eq('is_deleted', false)
          .order('received_at', { ascending: false }).limit(500),
      ])

      // Nieuwe tabellen mogen ontbreken (pas recent aangemaakt)
      const salesEventsSafe   = salesEvents?.error ? { data: [] } : salesEvents
      const salesTodosSafe    = salesTodos?.error  ? { data: [] } : salesTodos
      const proposalsSafe     = proposals?.error   ? { data: [] } : proposals
      const filteredSafe      = filtered?.error    ? { data: [] } : filtered
      const chatSafe          = chat?.error        ? { data: [] } : chat
      const noteTemplatesSafe = noteTemplates?.error ? { data: [] } : noteTemplates
      const pipelinesSafe     = pipelines?.error     ? { data: [] } : pipelines
      const terminologySafe   = terminology?.error   ? { data: [] } : terminology
      const agentInstructionsSafe = agentInstructions?.error ? { data: [] } : agentInstructions
      const hubspotUsersSafe      = hubspotUsers?.error      ? { data: [] } : hubspotUsers
      const skillSecretsSafe      = skillSecrets?.error      ? { data: [] } : skillSecrets
      const linkedinTargetsSafe   = linkedinTargets?.error   ? { data: [] }   : linkedinTargets
      const linkedinStrategySafe  = linkedinStrategy?.error  ? { data: null } : linkedinStrategy
      const linkedinActivitySafe  = linkedinActivity?.error  ? { data: [] }   : linkedinActivity
      const autodraftMailsSafe              = autodraftMails?.error              ? { data: [] } : autodraftMails
      const autodraftCategoriesSafe         = autodraftCategories?.error         ? { data: [] } : autodraftCategories
      const autodraftCategoryProposalsSafe  = autodraftCategoryProposals?.error  ? { data: [] } : autodraftCategoryProposals
      const autodraftDecisionsSafe          = autodraftDecisions?.error          ? { data: [] } : autodraftDecisions
      const autodraftFoldersSafe            = autodraftFolders?.error            ? { data: [] } : autodraftFolders
      const autodraftLessonsSafe            = autodraftLessons?.error            ? { data: [] } : autodraftLessons
      const autodraftLessonProposalsSafe    = autodraftLessonProposals?.error    ? { data: [] } : autodraftLessonProposals
      const mailMessagesSafe                = mailMessages?.error                ? { data: [] } : mailMessages
      const tasksSafe         = tasks?.error         ? { data: [] } : tasks
      const taskProjectsSafe  = taskProjects?.error  ? { data: [] } : taskProjects
      const firstError = [runs, questions, feedback, schedules, runHistory, linkedin].find(r => r.error)
      if (firstError) throw firstError.error

      // Latest run per agent
      const latestRuns = {}
      runs.data.forEach(r => { if (!latestRuns[r.agent_name]) latestRuns[r.agent_name] = r })

      // 7-slot sparkline history per agent
      const history = {}
      runHistory.data.forEach(r => {
        if (!history[r.agent_name]) history[r.agent_name] = []
        if (history[r.agent_name].length < 7) history[r.agent_name].push(r.status)
      })
      Object.keys(history).forEach(a => {
        history[a].reverse()
        while (history[a].length < 7) history[a].unshift('empty')
      })

      // Today's runs (nog gebruikt elders) + deze-week runs voor de week-timeline
      const todayRuns = runs.data.filter(r => new Date(r.started_at) >= dayStart)
      const weekRuns  = runs.data.filter(r => new Date(r.started_at) >= weekStart)
      // Range-runs voor de KpiStrip range-selector (max 90d terug, voldoende voor
      // 7d/30d/90d-vergelijkingen incl. previous period). Limit op 500 records.
      const rangeRuns = runs.data.filter(r => new Date(r.started_at) >= new Date(now - 180 * DAY))
      // Recente runs (voor notification-history drawer) — laatste 30 ongeacht datum
      const recentRuns = runs.data.slice(0, 30)

      // Open questions + urgency
      const questionsWithUrgency = questions.data.map(q => {
        const asked = new Date(q.asked_at)
        const expires = q.expires_at ? new Date(q.expires_at) : null
        const daysOpen = Math.floor((now - asked) / DAY)
        let urgency = 'ok'
        if (expires && now > expires) urgency = 'expired'
        else if (expires && now > new Date(expires - DAY)) urgency = 'urgent'
        else if (daysOpen >= 3) urgency = 'warning'
        return { ...q, days_open: daysOpen, urgency }
      })

      // KPI: this week + last week for trend
      const weekStats = emptyStats()
      const lastWeekStats = emptyStats()
      runs.data.forEach(r => {
        // Orchestrator-polls tellen niet mee in werk-output-metrics
        if (r.agent_name === 'orchestrator') return
        const t = new Date(r.started_at)
        if (r.status !== 'success' && r.status !== 'warning') return
        if (t >= weekStart) addStats(weekStats, r)
        else if (t >= lastWeekStart && t < weekStart) addStats(lastWeekStats, r)
      })

      // Orchestrator heartbeat
      const orchRun = latestRuns['orchestrator']
      let orchestratorAgeMin = null
      if (orchRun) {
        orchestratorAgeMin = Math.round((now - new Date(orchRun.started_at)) / 60000)
      }

      // Overdue schedules: next_run_at in the past and still enabled, not is_running
      const overdueSchedules = (schedules.data || []).filter(s => {
        if (!s.enabled || s.is_running) return false
        if (!s.next_run_at) return false
        return new Date(s.next_run_at) < now
      })

      // Currently running
      const runningSchedules = (schedules.data || []).filter(s => s.is_running)

      // Next upcoming run
      const nextRun = (schedules.data || [])
        .filter(s => s.enabled && s.next_run_at && new Date(s.next_run_at) > now)
        .sort((a, b) => new Date(a.next_run_at) - new Date(b.next_run_at))[0] || null

      // Orchestrator eigen schedule row (voor "volgende poll over X")
      const orchestratorSchedule = (schedules.data || []).find(s => s.agent_name === 'orchestrator') || null

      setData({
        latestRuns,
        history,
        todayRuns,
        weekRuns,
        rangeRuns,
        recentRuns,
        weekStart,
        questions: questionsWithUrgency,
        feedback: feedback.data || [],
        schedules: schedules.data || [],
        linkedin: linkedin.data || [],
        salesEvents: salesEventsSafe.data || [],
        salesTodos:  salesTodosSafe.data  || [],
        proposals:   proposalsSafe.data   || [],
        filtered:    filteredSafe.data    || [],
        chat:        chatSafe.data        || [],
        noteTemplates: noteTemplatesSafe.data || [],
        pipelines:     pipelinesSafe.data     || [],
        terminology:   terminologySafe.data   || [],
        agentInstructions: agentInstructionsSafe.data || [],
        hubspotUsers:      hubspotUsersSafe.data      || [],
        skillSecrets:      skillSecretsSafe.data      || [],
        linkedinTargets:   linkedinTargetsSafe.data   || [],
        linkedinStrategy:  linkedinStrategySafe.data  || null,
        linkedinActivity:  linkedinActivitySafe.data  || [],
        autodraftMails:             autodraftMailsSafe.data             || [],
        autodraftCategories:        autodraftCategoriesSafe.data        || [],
        autodraftCategoryProposals: autodraftCategoryProposalsSafe.data || [],
        autodraftDecisions:         autodraftDecisionsSafe.data         || [],
        autodraftFolders:           autodraftFoldersSafe.data           || [],
        autodraftLessons:           autodraftLessonsSafe.data           || [],
        autodraftLessonProposals:   autodraftLessonProposalsSafe.data   || [],
        mailMessages:               mailMessagesSafe.data               || [],
        tasks:         tasksSafe.data         || [],
        taskProjects:  taskProjectsSafe.data  || [],
        weekStats,
        lastWeekStats,
        orchestratorAgeMin,
        orchestratorRun: orchRun || null,
        orchestratorSchedule,
        overdueSchedules,
        runningSchedules,
        nextRun,
      })
      setError(null)
      setOnline(true)
      setLastRefresh(new Date())
    } catch (e) {
      setError(e.message || String(e))
      setOnline(false)
    } finally {
      setLoading(false)
    }
  }, [])

  const scheduleRefetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(fetchAll, REALTIME_DEBOUNCE_MS)
  }, [fetchAll])

  // Initial load + polling fallback
  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, POLL_MS)
    return () => clearInterval(id)
  }, [fetchAll])

  // Realtime subscriptions (best-effort — if publication not set up, no harm)
  useEffect(() => {
    const channel = supabase
      .channel('dashboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_runs' },            scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'open_questions' },        scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_feedback' },        scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_schedules' },       scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_on_road_events' },  scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_todos' },           scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_proposals' },       scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_admin_filtered_records' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_chat_messages' },   scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'note_templates' },        scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hubspot_pipelines' },     scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'terminology_corrections' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_config' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hubspot_users' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'skill_secrets_registry' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'linkedin_targets' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'linkedin_strategy' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'linkedin_activity_log' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'autodraft_mails' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'autodraft_categories' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'autodraft_category_proposals' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'autodraft_decisions' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'autodraft_folders' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'autodraft_style_lessons' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mail_messages' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_projects' }, scheduleRefetch)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [scheduleRefetch])

  return { data, loading, error, online, lastRefresh, refresh: fetchAll }
}

function emptyStats() {
  return { runs: 0, drafts: 0, connects: 0, deals: 0 }
}

function addStats(acc, run) {
  acc.runs++
  const s = run.stats || {}
  if (s.drafts_created) acc.drafts   += Number(s.drafts_created) || 0
  if (s.connects_sent)  acc.connects += Number(s.connects_sent)  || 0
  if (s.deals_updated)  acc.deals    += Number(s.deals_updated)  || 0
}
