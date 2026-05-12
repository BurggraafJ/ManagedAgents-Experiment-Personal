import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { REFRESH_MS } from '../lib/truthOfSources'

/**
 * useTruthOfSources — fetcht alle bron-statistieken voor de Database-sectie
 * van NowView (Outlook / HubSpot / Jira / Fireflies / Agenda / Contacten /
 * JelleMind). Refresht automatisch elke REFRESH_MS (30s).
 *
 * Refactor 27 (2026-05-09): voorheen inline `fetchAll` in TruthOfSourcesView.
 * Returnt `{ loading, error, data, refresh }`.
 *
 * `data` heeft de vorm:
 *   {
 *     mail, hubspot, jira, fireflies, agenda, contacten,
 *     embed, latestByAgent, recentRuns, fetchedAt
 *   }
 */
export function useTruthOfSources() {
  const [state, setState] = useState({ loading: true, error: null, data: null })

  const fetchAll = useCallback(async () => {
    try {
      const [
        mailMessages, mailMessagesEmbedded, mailSyncState, mailBackfillState,
        hsState, hsEngagementsState,
        hsDeals, hsCompanies, hsContacts, hsEngagements, hsEngagementsEmbedded, hsEngagementsByType,
        jiraState, jiraIssues, jiraProjects,
        ffMeetings, ffMeetingsEmbedded, ffActionItems, ffSyncState,
        calEvents, calEventsEmbedded, calEventsActive, calAttendees, calSyncState, calLinked,
        contactenTotal, contactenFirms, contactenUnlinked, contactenTypes, contactenSyncState,
        recentRuns, mailEmbedRun,
      ] = await Promise.all([
        supabase.from('mail_messages').select('*', { count: 'exact', head: true }),
        supabase.from('mail_messages').select('*', { count: 'exact', head: true }).not('embedding', 'is', null),
        supabase.from('mail_sync_state').select('folder_id,last_delta_at,last_full_scan_at,last_error,total_messages_synced'),
        supabase.from('mail_backfill_state').select('status,messages_fetched,last_run_at,last_error'),
        supabase.from('hubspot_sync_state').select('*').eq('id', 1).maybeSingle(),
        supabase.from('hubspot_engagements_sync_state').select('*'),
        supabase.from('hubspot_deals').select('*', { count: 'exact', head: true }),
        supabase.from('hubspot_companies').select('*', { count: 'exact', head: true }),
        supabase.from('hubspot_contacts').select('*', { count: 'exact', head: true }),
        supabase.from('hubspot_engagements').select('*', { count: 'exact', head: true }),
        supabase.from('hubspot_engagements').select('*', { count: 'exact', head: true }).not('embedding', 'is', null),
        supabase.from('hubspot_engagements').select('engagement_type'),
        supabase.from('jira_sync_state').select('*').eq('id', 1).maybeSingle(),
        supabase.from('jira_issues').select('*', { count: 'exact', head: true }),
        supabase.from('jira_projects').select('*', { count: 'exact', head: true }),
        supabase.from('fireflies_meetings').select('*', { count: 'exact', head: true }),
        supabase.from('fireflies_meetings').select('*', { count: 'exact', head: true }).not('embedding', 'is', null),
        supabase.from('fireflies_action_items').select('id,is_for_jelle,processed_at'),
        supabase.from('fireflies_sync_state').select('*').eq('id', 1).maybeSingle(),
        supabase.from('calendar_events').select('*', { count: 'exact', head: true }),
        supabase.from('calendar_events').select('*', { count: 'exact', head: true }).not('embedding', 'is', null),
        supabase.from('calendar_events').select('*', { count: 'exact', head: true }).eq('is_cancelled', false).eq('is_deleted', false),
        supabase.from('calendar_attendees').select('*', { count: 'exact', head: true }),
        supabase.from('calendar_sync_state').select('*').eq('id', 1).maybeSingle(),
        supabase.from('calendar_events').select('*', { count: 'exact', head: true }).not('fireflies_meeting_id', 'is', null),
        supabase.from('contactpersonen').select('*', { count: 'exact', head: true }).eq('is_deleted', false),
        supabase.from('firms').select('*', { count: 'exact', head: true }).eq('is_deleted', false),
        supabase.from('contactpersonen').select('*', { count: 'exact', head: true }).eq('is_deleted', false).is('firm_id', null),
        supabase.from('contactpersonen').select('contact_type').eq('is_deleted', false),
        supabase.from('contactpersonen_sync_state').select('source,last_delta_sync,total_synced,last_error'),
        supabase.from('agent_runs')
          .select('agent_name,status,summary,started_at,completed_at,errors,stats')
          .in('agent_name', ['mail-sync', 'mail-backfill', 'hubspot-sync', 'hubspot-engagements-sync', 'jira-sync', 'chunker', 'fireflies-sync', 'outlook-calendar-sync', 'contactpersonen-sync'])
          .order('started_at', { ascending: false })
          .limit(120),
        supabase.from('agent_runs')
          .select('started_at,status,summary,stats')
          .eq('agent_name', 'chunker')
          .gte('started_at', new Date(Date.now() - 7 * 86400_000).toISOString())
          .order('started_at', { ascending: false }),
      ])

      const engagementsByType = {}
      for (const row of (hsEngagementsByType.data || [])) {
        engagementsByType[row.engagement_type] = (engagementsByType[row.engagement_type] || 0) + 1
      }

      const backfillByStatus = { pending: 0, in_progress: 0, done: 0, empty: 0, error: 0 }
      const backfillRows = mailBackfillState.data || []
      for (const r of backfillRows) backfillByStatus[r.status] = (backfillByStatus[r.status] || 0) + 1
      const totalBuckets = backfillRows.length
      const completedBuckets = backfillByStatus.done + backfillByStatus.empty

      const latestByAgent = {}
      for (const r of (recentRuns.data || [])) {
        if (!latestByAgent[r.agent_name]) latestByAgent[r.agent_name] = r
      }
      const allRecentRuns = recentRuns.data || []

      const mailEmbedRuns = mailEmbedRun.data || []
      const embedTokens7d = mailEmbedRuns.reduce((sum, r) => sum + (Number(r.stats?.total_tokens) || 0), 0)
      const embedRuns7d = mailEmbedRuns.length
      const lastEmbed = mailEmbedRuns[0]

      const mailSyncRows = mailSyncState.data || []
      const newestDelta = mailSyncRows.reduce((acc, r) => {
        if (!r.last_delta_at) return acc
        return !acc || r.last_delta_at > acc ? r.last_delta_at : acc
      }, null)
      const mailSyncErrors = mailSyncRows.filter((r) => r.last_error).map((r) => r.last_error)

      const engStateRows = hsEngagementsState.data || []
      const newestEngSync = engStateRows.reduce((acc, r) => {
        const t = r.last_full_sync || r.last_delta_sync
        if (!t) return acc
        return !acc || t > acc ? t : acc
      }, null)
      const engErrors = engStateRows.filter((r) => r.last_error).map((r) => r.last_error)

      // Fireflies action-items breakdown
      const ffItems = ffActionItems.data || []
      const ffJelleOpen = ffItems.filter((r) => r.is_for_jelle && !r.processed_at).length
      const ffJelleTotal = ffItems.filter((r) => r.is_for_jelle).length

      const contactenByType = {}
      for (const r of (contactenTypes.data || [])) {
        contactenByType[r.contact_type] = (contactenByType[r.contact_type] || 0) + 1
      }
      const contactenSyncRows = contactenSyncState.data || []
      const newestContactenSync = contactenSyncRows.reduce((acc, r) => {
        if (!r.last_delta_sync) return acc
        return !acc || r.last_delta_sync > acc.last_delta_sync ? r : acc
      }, null)

      setState({
        loading: false, error: null,
        data: {
          mail: {
            total: mailMessages.count, embedded: mailMessagesEmbedded.count,
            lastDelta: newestDelta,
            errors: mailSyncErrors,
            foldersTracked: mailSyncRows.length,
            backfill: {
              byStatus: backfillByStatus, totalBuckets, completedBuckets,
              percent: totalBuckets > 0 ? Math.round((completedBuckets / totalBuckets) * 100) : 0,
            },
          },
          hubspot: {
            state: hsState.data,
            deals: hsDeals.count, companies: hsCompanies.count, contacts: hsContacts.count,
            engagements: { total: hsEngagements.count, embedded: hsEngagementsEmbedded.count, byType: engagementsByType, lastSync: newestEngSync, errors: engErrors },
          },
          jira: {
            state: jiraState.data, issues: jiraIssues.count, projects: jiraProjects.count,
          },
          fireflies: {
            total: ffMeetings.count,
            embedded: ffMeetingsEmbedded.count,
            state: ffSyncState.data,
            actionItems: { total: ffItems.length, jelleOpen: ffJelleOpen, jelleTotal: ffJelleTotal },
          },
          agenda: {
            total: calEvents.count,
            active: calEventsActive.count,
            embedded: calEventsEmbedded.count,
            attendees: calAttendees.count,
            linkedToFireflies: calLinked.count,
            state: calSyncState.data,
          },
          contacten: {
            total: contactenTotal.count,
            firms: contactenFirms.count,
            unlinked: contactenUnlinked.count,
            byType: contactenByType,
            lastSync: newestContactenSync?.last_delta_sync || null,
            lastError: newestContactenSync?.last_error || null,
          },
          embed: {
            tokens7d: embedTokens7d, runs7d: embedRuns7d, lastRun: lastEmbed,
            model: lastEmbed?.stats?.model || 'text-embedding-3-small',
          },
          latestByAgent,
          recentRuns: allRecentRuns,
          fetchedAt: new Date(),
        },
      })
    } catch (err) {
      setState({ loading: false, error: err.message, data: null })
    }
  }, [])

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, REFRESH_MS)
    return () => clearInterval(id)
  }, [fetchAll])

  return { ...state, refresh: fetchAll }
}
