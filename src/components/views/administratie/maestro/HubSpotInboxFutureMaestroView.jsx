import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAdmin } from '../../../../hooks/useAdmin'
import { useHubspotFutureIndex } from '../../../../hooks/useHubspotFutureIndex'
import {
  PipelineLookupContext,
  HubSpotUsersContext,
  buildPipelineLookup,
} from '../../hubspot-common'
import { groupProposals } from '../../hubspot-shared.jsx'
import {
  FUTURE_AGENT,
  FUTURE_WINDOW_DAYS,
  isExternalAttendee,
  buildAttendeesByEvent,
} from '../../../../lib/hubspotInbox'
import AdminPeriodToggle from '../../AdminPeriodToggle'
import FutureEventsSectionMaestro from './FutureEventsSectionMaestro'
import RecruitmentSectionMaestro from './RecruitmentSectionMaestro'
import './administratie-maestro.css'

// Daily Admin · Toekomst Maestro orchestrator (sessie ADM-V2 step 1).
// Mirrors HubSpotInboxFutureView qua rol — verzamelt events + classifies +
// orchestreert FutureEventsSectionMaestro + RecruitmentSectionMaestro.
// Mockup-classes voor topbar + page-header.

export default function HubSpotInboxFutureMaestroView({ onRefresh }) {
  const navigate = useNavigate()
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

  const eventsWithExt = useMemo(() => {
    return events.map(e => {
      const all = attendeesByEvent.get(e.id) || []
      const externals = all.filter(isExternalAttendee)
      return { ...e, _externals: externals, _allAttendees: all }
    }).filter(e => e._externals.length > 0)
  }, [events, attendeesByEvent])

  const {
    recruitmentMeetings,
    dismissedSet,
    dismissEvent,
    undoDismissEvent,
    hsIndex,
  } = useHubspotFutureIndex({ eventsWithExt })

  const futureProposals = useMemo(
    () => (adminProposals || []).filter(p => p.agent_name === FUTURE_AGENT),
    [adminProposals],
  )

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
      <header className="adm-topbar">
        <div className="adm-crumbs">
          <span>Werkruimte</span>
          <span className="adm-crumbs__sep">/</span>
          <span>Administratie</span>
          <span className="adm-crumbs__sep">/</span>
          <span className="adm-crumbs__current">Toekomst</span>
        </div>
        <div className="adm-topbar__actions">
          <button
            type="button"
            className="adm-topbar__btn adm-topbar__btn--ghost"
            onClick={() => navigate('/instellingen/administratie')}
            title="Beheer note-templates en tone-of-voice voor Daily Admin"
          >
            <svg className="lc" viewBox="0 0 24 24" width="13" height="13" aria-hidden>
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            Instructies
          </button>
        </div>
      </header>

      <div className="adm-card">
        <header className="adm-ph">
          <div className="adm-ph__text">
            <h2 className="adm-ph__title">Administratie · <span>Toekomst</span></h2>
            <p className="adm-ph__intro">
              Tabel-overzicht van aankomende externe afspraken ({FUTURE_WINDOW_DAYS}d vooruit). Voorstellen voor nieuwe records komen vanzelf in de Admin-tab onder "Nieuw".
            </p>
          </div>
          <AdminPeriodToggle />
        </header>
        <div className="adm-card__inner">
          <div className="fut-stack">
            <FutureEventsSectionMaestro
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

            <RecruitmentSectionMaestro meetings={recruitmentMeetings} onRefresh={onRefresh} />

            {inboxList.length > 0 && (
              <div className="fut-admin-hint">
                {inboxList.length} {inboxList.length === 1 ? 'voorstel staat' : 'voorstellen staan'} klaar in de <strong>Admin</strong>-tab onder <strong>Nieuw</strong>.
              </div>
            )}
          </div>
        </div>
      </div>
    </HubSpotUsersContext.Provider>
    </PipelineLookupContext.Provider>
  )
}
