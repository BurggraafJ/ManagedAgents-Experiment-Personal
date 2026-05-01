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
      //
      // CRUCIAAL: elke query individueel safe-gewrapt. Als 1 query rejected (netwerk-error,
      // RLS-issue, missende tabel), faalt anders ALLE Promise.all en blijft de UI op
      // stale data hangen. Met safeQ() blijft de rest doorgaan met lege fallback.
      const safeQ = (q) => Promise.resolve(q).then(r => r).catch(e => {
        // eslint-disable-next-line no-console
        console.warn('[useDashboard] query failed (continuing with empty fallback):', e?.message || e)
        return { data: [], error: e }
      })
      const [runs, questions, feedback, schedules, runHistory, linkedin, salesEvents, salesTodos, proposals, filtered, chat, noteTemplates, pipelines, terminology, agentInstructions, hubspotUsers, skillSecrets, linkedinTargets, linkedinStrategy, linkedinActivity, autodraftMails, autodraftCategories, autodraftCategoryProposals, autodraftDecisions, autodraftFolders, autodraftLessons, autodraftLessonProposals, tasks, taskProjects, mailMessages, autodraftIgnoreRules, awaitingDismissed, hubspotCustomerEmails, salesOnRoadInbox, kmTripsInbox, secretsInventory, calendarEvents, calendarAttendees, agendaPlannerRules, agendaPlannerSuggestions, citiesLookup, agendaLocationForecast, agendaVoiceNotes] = await Promise.all([
        safeQ(supabase.from('agent_runs').select('*').order('started_at', { ascending: false }).limit(500)),
        safeQ(supabase.from('open_questions').select('*').order('expires_at', { ascending: true, nullsFirst: false })),
        safeQ(supabase.from('agent_feedback').select('*').order('created_at', { ascending: false }).limit(50)),
        safeQ(supabase.from('agent_schedules').select('*').order('agent_name')),
        safeQ(supabase.from('agent_runs').select('agent_name,status,started_at')
          .gte('started_at', new Date(now - 14 * DAY).toISOString())
          .order('started_at', { ascending: false })),
        safeQ(supabase.from('linkedin_progress').select('*')
          .eq('year', now.getFullYear())
          .order('week_number', { ascending: false })
          .limit(30)),
        safeQ(supabase.from('sales_on_road_events').select('*').order('created_at', { ascending: false }).limit(50)),
        safeQ(supabase.from('sales_todos').select('*').order('created_at', { ascending: false }).limit(100)),
        safeQ(supabase.from('agent_proposals').select('*').order('created_at', { ascending: false }).limit(200)),
        safeQ(supabase.from('daily_admin_filtered_records').select('*').order('scanned_at', { ascending: false }).limit(100)),
        safeQ(supabase.from('agent_chat_messages').select('*').order('sent_at', { ascending: false }).limit(100)),
        safeQ(supabase.from('note_templates').select('*').order('sort_order')),
        safeQ(supabase.from('hubspot_pipelines').select('*').order('sort_order')),
        safeQ(supabase.from('terminology_corrections').select('*').order('incorrect')),
        safeQ(supabase.from('agent_config')
          .select('agent_name,config_key,config_value,updated_at')
          .in('config_key', ['custom_instructions', 'reminder_style'])),
        safeQ(supabase.from('hubspot_users')
          .select('hubspot_owner_id,email,first_name,last_name,full_name,active,is_primary')
          .eq('active', true)
          .order('is_primary', { ascending: false })
          .order('full_name')),
        safeQ(supabase.from('skill_secrets_registry')
          .select('id,skill_name,secret_name,description,last_4,vault_secret_id,updated_at,updated_by')
          .order('skill_name')),
        safeQ(supabase.from('linkedin_targets').select('*').order('created_at', { ascending: false }).limit(500)),
        safeQ(supabase.from('linkedin_strategy').select('*').eq('id', 1).maybeSingle()),
        safeQ(supabase.from('linkedin_activity_log').select('*').order('created_at', { ascending: false }).limit(200)),
        safeQ(supabase.from('autodraft_mails').select('*').order('received_at', { ascending: false }).limit(300)),
        safeQ(supabase.from('autodraft_categories').select('*').order('sort_order')),
        safeQ(supabase.from('autodraft_category_proposals').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(50)),
        safeQ(supabase.from('autodraft_decisions').select('*').order('decided_at', { ascending: false }).limit(300)),
        safeQ(supabase.from('autodraft_folders').select('*').order('full_path')),
        safeQ(supabase.from('autodraft_style_lessons').select('*').eq('active', true).order('created_at', { ascending: false }).limit(100)),
        safeQ(supabase.from('autodraft_lesson_proposals').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(50)),
        safeQ(supabase.from('tasks').select('*').order('created_at', { ascending: false }).limit(500)),
        safeQ(supabase.from('task_projects').select('*').order('sort_order')),
        // mail-DB (gevuld door mail-sync skill, truth-of-source voor mail-context)
        // Lichte select: lijst-data + body_preview voor de inbox; volledige body
        // wordt on-demand gefetched via get_thread_messages of losse query.
        safeQ(supabase.from('mail_messages')
          .select('id,conversation_id,received_at,from_email,from_name,to_recipients,cc_recipients,bcc_recipients,subject,body_preview,has_attachments,folder_id,folder_path,is_read,is_from_me,is_deleted,synced_at,body_truncated,flag_status,is_calendar_invite,flagged_as_spam')
          .eq('is_deleted', false)
          .order('received_at', { ascending: false }).limit(500)),
        // Mailing v11: ignore-rules + dismissed awaiting + customer-base set
        safeQ(supabase.from('autodraft_ignore_rules').select('*').eq('active', true).order('created_at', { ascending: false }).limit(200)),
        safeQ(supabase.from('awaiting_dismissed').select('conversation_id,dismissed_at')),
        safeQ(supabase.from('hubspot_customer_emails').select('email')),
        // Quick-capture inboxes — vervangen Slack-input voor sales-on-road + kilometerregistratie
        safeQ(supabase.from('sales_on_road_inbox').select('*').order('created_at', { ascending: false }).limit(50)),
        safeQ(supabase.from('km_trips_inbox').select('*').order('created_at', { ascending: false }).limit(50)),
        // Centraal secrets registry — rood/groen rotation-status (Fase 8, sessie 2026-04-27 #2)
        safeQ(supabase.from('secrets_inventory').select('*').order('status').order('key_name')),
        // AI Agenda Planner — calendar mirror window 14d terug t/m 90d vooruit
        // Schema-naam-mapping: kolommen heten start_time / end_time / location_text /
        // online_meeting_url / graph_id (geen start_at / location / outlook_event_id).
        // Attendees zitten in aparte tabel calendar_attendees (één-op-veel).
        safeQ(supabase.from('calendar_events')
          .select('id,graph_id,subject,body_preview,location_text,start_time,end_time,is_all_day,is_cancelled,is_recurring,response_status,organizer_email,organizer_name,categories,show_as,importance,fireflies_meeting_id,online_meeting_url')
          .gte('start_time', new Date(now - 14 * DAY).toISOString())
          .lte('start_time', new Date(now + 90 * DAY).toISOString())
          .order('start_time', { ascending: true })
          .limit(2000)),
        // Attendees voor hetzelfde window — in één keer ophalen, frontend groepeert per event_id.
        // Window aanvragen we via inner-join op calendar_events; PostgREST ondersteunt
        // !inner met filter op de gerelateerde tabel, dus we filteren op start_time.
        safeQ(supabase.from('calendar_attendees')
          .select('calendar_event_id,email,name,attendee_type,response_status,is_organizer,calendar_events!inner(start_time)')
          .gte('calendar_events.start_time', new Date(now - 14 * DAY).toISOString())
          .lte('calendar_events.start_time', new Date(now + 90 * DAY).toISOString())
          .limit(8000)),
        safeQ(supabase.from('agenda_planner_rules').select('*').eq('enabled', true).order('priority', { ascending: false })),
        safeQ(supabase.from('agenda_planner_suggestions').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(50)),
        safeQ(supabase.from('cities_lookup').select('*').order('city')),
        // F.10: Locatieprognose per dag — 7d terug t/m 28d vooruit
        safeQ(supabase.from('agenda_location_forecast')
          .select('*')
          .gte('forecast_date', new Date(now - 7 * DAY).toISOString().slice(0, 10))
          .lte('forecast_date', new Date(now + 28 * DAY).toISOString().slice(0, 10))
          .order('forecast_date')),
        // F.11: Voice-notes — laatste 20 voor location-forecaster
        safeQ(supabase.from('agenda_voice_notes')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(20)),
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
      const autodraftIgnoreRulesSafe        = autodraftIgnoreRules?.error        ? { data: [] } : autodraftIgnoreRules
      const awaitingDismissedSafe           = awaitingDismissed?.error           ? { data: [] } : awaitingDismissed
      const hubspotCustomerEmailsSafe       = hubspotCustomerEmails?.error       ? { data: [] } : hubspotCustomerEmails
      const tasksSafe         = tasks?.error         ? { data: [] } : tasks
      const taskProjectsSafe  = taskProjects?.error  ? { data: [] } : taskProjects
      const salesOnRoadInboxSafe = salesOnRoadInbox?.error ? { data: [] } : salesOnRoadInbox
      const kmTripsInboxSafe     = kmTripsInbox?.error     ? { data: [] } : kmTripsInbox
      const secretsInventorySafe = secretsInventory?.error ? { data: [] } : secretsInventory
      const calendarEventsSafe          = calendarEvents?.error          ? { data: [] } : calendarEvents
      // Diagnostiek: log calendar fetch result direct na ontvangst
      // eslint-disable-next-line no-console
      console.log('[useDashboard] calendar fetch:',
        'count=', (calendarEventsSafe.data || []).length,
        'error=', calendarEvents?.error?.message || 'none',
        'window=', new Date(now - 14 * DAY).toISOString().slice(0, 10),
        '→', new Date(now + 90 * DAY).toISOString().slice(0, 10),
        'first/last=', (calendarEventsSafe.data || [])[0]?.start_time?.slice(0, 10),
        '/', (calendarEventsSafe.data || []).slice(-1)[0]?.start_time?.slice(0, 10))
      const calendarAttendeesSafe       = calendarAttendees?.error       ? { data: [] } : calendarAttendees
      const agendaPlannerRulesSafe      = agendaPlannerRules?.error      ? { data: [] } : agendaPlannerRules
      const agendaPlannerSuggestionsSafe = agendaPlannerSuggestions?.error ? { data: [] } : agendaPlannerSuggestions
      const citiesLookupSafe            = citiesLookup?.error            ? { data: [] } : citiesLookup
      const agendaLocationForecastSafe  = agendaLocationForecast?.error  ? { data: [] } : agendaLocationForecast
      const agendaVoiceNotesSafe        = agendaVoiceNotes?.error        ? { data: [] } : agendaVoiceNotes
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
        autodraftIgnoreRules:       autodraftIgnoreRulesSafe.data        || [],
        awaitingDismissed:          awaitingDismissedSafe.data           || [],
        hubspotCustomerEmails:      hubspotCustomerEmailsSafe.data       || [],
        tasks:         tasksSafe.data         || [],
        taskProjects:  taskProjectsSafe.data  || [],
        salesOnRoadInbox: salesOnRoadInboxSafe.data || [],
        kmTripsInbox:     kmTripsInboxSafe.data     || [],
        secretsInventory: secretsInventorySafe.data || [],
        calendarEvents:           calendarEventsSafe.data           || [],
        calendarAttendees:        calendarAttendeesSafe.data        || [],
        agendaPlannerRules:       agendaPlannerRulesSafe.data       || [],
        agendaPlannerSuggestions: agendaPlannerSuggestionsSafe.data || [],
        citiesLookup:             citiesLookupSafe.data             || [],
        agendaLocationForecast:   agendaLocationForecastSafe.data   || [],
        agendaVoiceNotes:         agendaVoiceNotesSafe.data         || [],
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_on_road_inbox' },   scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'km_trips_inbox' },        scheduleRefetch)
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'autodraft_ignore_rules' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'awaiting_dismissed' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_projects' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'secrets_inventory' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_attendees' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agenda_planner_rules' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agenda_planner_suggestions' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cities_lookup' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agenda_location_forecast' }, scheduleRefetch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agenda_voice_notes' }, scheduleRefetch)
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
