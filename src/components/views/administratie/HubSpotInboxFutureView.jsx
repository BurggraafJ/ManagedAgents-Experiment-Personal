import { useMemo } from 'react'
import { useAdmin } from '../../../hooks/useAdmin'
import {
  PipelineLookupContext,
  HubSpotUsersContext,
  buildPipelineLookup,
} from '../hubspot-common'
import { groupProposals } from '../hubspot-shared.jsx'
import {
  FUTURE_AGENT,
  FUTURE_WINDOW_DAYS,
  isExternalAttendee,
  buildAttendeesByEvent,
} from '../../../lib/hubspotInbox'
import { useHubspotFutureIndex } from '../../../hooks/useHubspotFutureIndex'
import FutureEventsSection from './FutureEventsSection'
import RecruitmentSection from './RecruitmentSection'
import styles from './HubSpotInboxFutureView.module.css'

/**
 * HubSpotInboxFutureView — Daily Admin · Toekomst-tabblad.
 * Refactor 11 (2026-05-09): file-split + lib-extract + CSS-module.
 *
 * Twee secties:
 *  1. FutureEventsSection — externe afspraken 90d vooruit, geclassificeerd
 *     via Jira-REC + HubSpot-mirror + partner_domains.
 *  2. RecruitmentSection — eigen tabel sinds skill v1.16, los van sales/leads.
 *
 * Voorstellen-sectie is per v1.10 verwijderd — daily-admin-future-voorstellen
 * komen nu in de Admin-tab onder de groep "Nieuw" (zie hubspot-shared.jsx).
 */
export default function HubSpotInboxFutureView({ onRefresh }) {
  const {
    proposals: adminProposals,
    pipelines,
    hubspotUsers: adminHubspotUsers,
    calendarEvents,
    calendarAttendees,
    schedules,
  } = useAdmin()
  const pipelineLookup = useMemo(() => buildPipelineLookup(pipelines || []), [pipelines])
  const hubspotUsers = adminHubspotUsers || []

  // Future-events: window NU → NU+90d, niet cancelled. Geen keyword-filter
  // meer — externe attendees zijn het sterke signaal.
  const events = useMemo(() => {
    const now = Date.now()
    const horizon = now + FUTURE_WINDOW_DAYS * 86400000
    return (calendarEvents || [])
      .filter(e => !e.is_cancelled)
      .filter(e => {
        const t = new Date(e.start_time).getTime()
        return t >= now && t <= horizon
      })
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
  }, [calendarEvents])

  const attendeesByEvent = useMemo(
    () => buildAttendeesByEvent(calendarAttendees),
    [calendarAttendees],
  )

  // Voor elk event: externe attendees (= prospect-side).
  const eventsWithExt = useMemo(() => {
    return events.map(e => {
      const all = attendeesByEvent.get(e.id) || []
      const externals = all.filter(isExternalAttendee)
      return { ...e, _externals: externals, _allAttendees: all }
    }).filter(e => e._externals.length > 0)
  }, [events, attendeesByEvent])

  // Hook: recruitment_meetings + dismissedSet + hsIndex (Jira-REC + HubSpot
  // mirror + partner_domains). Refactor 11 — voorheen drie inline useEffects.
  const {
    recruitmentMeetings,
    dismissedSet,
    dismissEvent,
    undoDismissEvent,
    hsIndex,
  } = useHubspotFutureIndex({ eventsWithExt })

  // Future-proposals filter
  const futureProposals = useMemo(
    () => (adminProposals || []).filter(p => p.agent_name === FUTURE_AGENT),
    [adminProposals],
  )

  // Set van calendar_event_ids waar momenteel een open future-voorstel voor
  // bestaat. Tabel-cel "Bron-match" toont dan "Voorstel in Admin" zodat Jelle
  // ziet dat er al iets voor klaar staat (in plaats van "geen match").
  const eventsWithProposal = useMemo(() => {
    const s = new Set()
    for (const p of futureProposals) {
      if (p.status !== 'pending' && p.status !== 'amended') continue
      const eid = p.context?.calendar_event_id
      if (eid) s.add(eid)
    }
    return s
  }, [futureProposals])
  const buckets = useMemo(() => groupProposals(futureProposals), [futureProposals])
  const inboxList = useMemo(() => [...buckets.to_review, ...buckets.need_input], [buckets])

  const futureSchedule = useMemo(
    () => (schedules || []).find(s => s.agent_name === FUTURE_AGENT),
    [schedules],
  )

  const handleDismiss = async (event) => {
    const res = await dismissEvent(event)
    if (res.ok) onRefresh && onRefresh()
  }
  const handleUndoDismiss = async (event) => {
    const res = await undoDismissEvent(event)
    if (res.ok) onRefresh && onRefresh()
  }

  return (
    <PipelineLookupContext.Provider value={pipelineLookup}>
    <HubSpotUsersContext.Provider value={hubspotUsers}>
    <div className={`stack ${styles.outerStack}`}>

      <FutureEventsSection
        eventsWithExt={eventsWithExt}
        hsIndex={hsIndex}
        pipelineLookup={pipelineLookup}
        dismissedSet={dismissedSet}
        eventsWithProposal={eventsWithProposal}
        futureSchedule={futureSchedule}
        onDismiss={handleDismiss}
        onUndoDismiss={handleUndoDismiss}
        onRefresh={onRefresh}
      />

      <RecruitmentSection meetings={recruitmentMeetings} onRefresh={onRefresh} />

      {/* Voorstellen-sectie verwijderd in v1.10 — daily-admin-future-voorstellen
          komen nu in de Admin-tab onder "Nieuw" (zie hubspot-shared.jsx). */}
      {inboxList.length > 0 && (
        <div className={`muted ${styles.adminHint}`}>
          {inboxList.length} {inboxList.length === 1 ? 'voorstel staat' : 'voorstellen staan'} klaar in de <strong>Admin</strong>-tab onder <strong>Nieuw</strong>.
        </div>
      )}

    </div>
    </HubSpotUsersContext.Provider>
    </PipelineLookupContext.Provider>
  )
}
