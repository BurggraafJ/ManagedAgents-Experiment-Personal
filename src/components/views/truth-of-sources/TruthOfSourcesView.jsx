import { useState } from 'react'
import { useTruthOfSources } from '../../../hooks/useTruthOfSources'
import {
  fmtNum,
  relTime,
  tsMax,
  healthFor,
} from '../../../lib/truthOfSources'
import SourceCard from './SourceCard'
import SourceDetailModal from './SourceDetailModal'
import styles from './TruthOfSourcesView.module.css'

/**
 * TruthOfSourcesView — Outlook, HubSpot, Jira, Fireflies, Agenda,
 * Contactpersonen en JelleMind als pijlers waarop de agents draaien.
 * Compacte kaartjes (laatste run + status), klik "Details →" voor de
 * volledige breakdown in een popup. Auto-refresh per 30s via hook.
 *
 * Refactor 27 (2026-05-09): file-split + lib-extract + CSS-module.
 *  - data-fetching → hooks/useTruthOfSources
 *  - pure helpers + constanten → lib/truthOfSources
 *  - sub-components in deze folder
 *  - inline-styles → TruthOfSourcesView.module.css
 *
 * Wordt embedded in NowView (geen eigen route).
 */
const BUILD_TAG = 'r27·2026-05-09'

export default function TruthOfSourcesView() {
  const { loading, error, data: tos } = useTruthOfSources()
  const [openPopup, setOpenPopup] = useState(null) // 'mail' | 'hubspot' | ...

  if (loading && !tos) return <div className={`skeleton ${styles.loadingSkeleton}`} />
  if (error) return <div className="card">Fout bij laden: {error}</div>

  // Mail health: gebruikt mail_sync_state.last_delta_at (5min cadence)
  const mailHealth = healthFor(tos.mail.lastDelta, tos.mail.errors[0], 10)
  mailHealth.title = `Last delta: ${relTime(tos.mail.lastDelta)}`
  const mailRun = tos.latestByAgent['mail-sync']

  // HubSpot health: bug-fix — gebruik de meest recente van delta+full
  // (delta draait elke 30 min, full elke 24u). Eerder pakte de code full eerst,
  // wat altijd ~1 dag oud is en daardoor 'stale' toonde.
  const hsCoreLastSync = tsMax(tos.hubspot.state?.last_delta_sync, tos.hubspot.state?.last_full_sync)
  const hsHealth = healthFor(hsCoreLastSync, tos.hubspot.state?.last_error, 45)
  hsHealth.title = `Last sync: ${relTime(hsCoreLastSync)}`
  const hsRun = tos.latestByAgent['hubspot-sync']

  // Jira: zelfde fix — delta is recenter dan full
  const jiraLastSync = tsMax(tos.jira.state?.last_delta_sync, tos.jira.state?.last_full_sync)
  const jiraHealth = healthFor(jiraLastSync, tos.jira.state?.last_error, 30)
  jiraHealth.title = `Last sync: ${relTime(jiraLastSync)}`
  const jiraRun = tos.latestByAgent['jira-sync']

  // Fireflies: skill-driven, last_delta_sync_at uit fireflies_sync_state
  const ffLastSync = tos.fireflies.state?.last_delta_sync_at
  const ffHealth = healthFor(ffLastSync, tos.fireflies.state?.last_error, 30)
  ffHealth.title = ffLastSync
    ? `Last delta: ${relTime(ffLastSync)}`
    : 'nog geen sync — wacht op orchestrator-cyclus'
  const ffRun = tos.latestByAgent['fireflies-sync']

  // Agenda: edge-fn, neem meest recente van delta+full
  const calLastSync = tsMax(tos.agenda.state?.last_delta_sync_at, tos.agenda.state?.last_full_sync_at)
  const calHealth = healthFor(calLastSync, tos.agenda.state?.last_error, 30)
  calHealth.title = `Last sync: ${relTime(calLastSync)}`
  const calRun = tos.latestByAgent['outlook-calendar-sync']

  // Contactpersonen: nightly cadence (1 dag = 1440 min), tolerantie 36u (1800)
  const contactenHealth = healthFor(tos.contacten.lastSync, tos.contacten.lastError, 1800)
  contactenHealth.title = `Last sync: ${relTime(tos.contacten.lastSync)}`
  const contactenRun = tos.latestByAgent['contactpersonen-sync']

  return (
    <div className={`stack ${styles.outerStack}`}>
      <section>
        <div className="section__head">
          <h2 className="section__title">Database</h2>
          <span className="section__hint">
            Auto-refresh per 30s · Laatst: {tos.fetchedAt.toLocaleTimeString('nl-NL')} · {BUILD_TAG}
          </span>
        </div>

        <div className="tos-grid">
          <SourceCard
            source="mail"
            title="Outlook"
            total={tos.mail.total}
            totalLabel="berichten"
            health={mailHealth}
            lastSyncIso={tos.mail.lastDelta}
            runAgent={mailRun?.agent_name || 'mail-sync'}
            runStatus={mailRun?.status}
            errorMsg={tos.mail.errors[0]}
            onOpen={() => setOpenPopup('mail')}
          />

          <SourceCard
            source="hubspot"
            title="HubSpot"
            total={
              (tos.hubspot.deals || 0) +
              (tos.hubspot.companies || 0) +
              (tos.hubspot.contacts || 0) +
              (tos.hubspot.engagements.total || 0)
            }
            totalLabel="records"
            health={hsHealth}
            lastSyncIso={hsCoreLastSync}
            runAgent={hsRun?.agent_name || 'hubspot-sync'}
            runStatus={hsRun?.status}
            errorMsg={tos.hubspot.state?.last_error || tos.hubspot.engagements.errors[0]}
            onOpen={() => setOpenPopup('hubspot')}
          />

          <SourceCard
            source="jira"
            title="Jira"
            total={tos.jira.issues}
            totalLabel={`issues · ${fmtNum(tos.jira.projects)} projecten`}
            health={jiraHealth}
            lastSyncIso={jiraLastSync}
            runAgent={jiraRun?.agent_name || 'jira-sync'}
            runStatus={jiraRun?.status}
            errorMsg={tos.jira.state?.last_error}
            onOpen={() => setOpenPopup('jira')}
          />

          <SourceCard
            source="fireflies"
            title="Fireflies"
            total={tos.fireflies.total}
            totalLabel="meetings"
            health={ffHealth}
            lastSyncIso={ffLastSync}
            runAgent={ffRun?.agent_name || 'fireflies-sync'}
            runStatus={ffRun?.status}
            errorMsg={tos.fireflies.state?.last_error}
            onOpen={() => setOpenPopup('fireflies')}
          />

          <SourceCard
            source="agenda"
            title="Agenda"
            total={tos.agenda.total}
            totalLabel={`events · ${fmtNum(tos.agenda.active)} actief`}
            health={calHealth}
            lastSyncIso={calLastSync}
            runAgent={calRun?.agent_name || 'outlook-calendar-sync'}
            runStatus={calRun?.status}
            errorMsg={tos.agenda.state?.last_error}
            onOpen={() => setOpenPopup('agenda')}
          />

          <SourceCard
            source="contacten"
            title="Contactpersonen"
            total={tos.contacten.total}
            totalLabel={`personen · ${fmtNum(tos.contacten.firms)} firms`}
            health={contactenHealth}
            lastSyncIso={tos.contacten.lastSync}
            runAgent={contactenRun?.agent_name || 'contactpersonen-sync'}
            runStatus={contactenRun?.status}
            errorMsg={tos.contacten.lastError}
            onOpen={() => setOpenPopup('contacten')}
          />

          <SourceCard
            source="jellemind"
            title="JelleMind"
            total="—"
            totalLabel="in opbouw"
            health={{ tag: 's-warning', label: 'wordt gebouwd', title: 'Komt eraan' }}
            lastSyncIso={null}
            runAgent="—"
            onOpen={() => setOpenPopup('jellemind')}
          />
        </div>
      </section>

      {openPopup && (
        <SourceDetailModal
          source={openPopup}
          data={tos}
          onClose={() => setOpenPopup(null)}
        />
      )}
    </div>
  )
}
