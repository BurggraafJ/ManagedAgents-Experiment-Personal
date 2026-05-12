import { useState } from 'react'
import { supabase } from '../../../../lib/supabase'
import { formatDateTime } from '../../hubspot-common'
import { FUTURE_AGENT, FUTURE_WINDOW_DAYS } from '../../../../lib/hubspotInbox'
import KennismakingsTableMaestro from './KennismakingsTableMaestro'

// FutureEventsSectionMaestro — Toekomst sectie A: "Aankomende externe
// afspraken". Mockup-native: section met paper-2 + radius 14, header rij
// met scan-knop rechts. Mirror van V1 FutureEventsSection.

export default function FutureEventsSectionMaestro({
  eventsWithExt,
  hsIndex,
  pipelineLookup,
  dismissedSet,
  eventsWithProposal,
  futureSchedule,
  onDismiss,
  onUndoDismiss,
  onRefresh,
}) {
  const [busy, setBusy] = useState(false)
  const [runMsg, setRunMsg] = useState(null)

  async function triggerScan() {
    setBusy(true); setRunMsg(null)
    try {
      const { error } = await supabase
        .from('agent_schedules')
        .update({ manual_run_requested_at: new Date().toISOString() })
        .eq('agent_name', FUTURE_AGENT)
      if (error) throw error
      setRunMsg('Scan ingepland — orchestrator pakt deze in de eerstvolgende poll op.')
      onRefresh && onRefresh()
    } catch (e) {
      setRunMsg(`⚠ ${e.message || 'kon scan niet inplannen'}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="fut-section">
      <header className="fut-section__head">
        <div className="fut-section__head-text">
          <h3 className="fut-section__title">
            Aankomende externe afspraken
            <span className="km-pill">{eventsWithExt.length}</span>
          </h3>
          <div className="fut-section__sub">
            Komende {FUTURE_WINDOW_DAYS} dagen uit Outlook · alle events met externe deelnemers · per rij geclassificeerd via Jira-REC + HubSpot-mirror + partner_domains
          </div>
        </div>
        <div className="fut-section__actions">
          {futureSchedule?.last_run_at && (
            <span className="fut-section__last">laatste scan: {formatDateTime(futureSchedule.last_run_at)}</span>
          )}
          <button
            type="button"
            className="fut-scan-btn"
            onClick={triggerScan}
            disabled={busy || !futureSchedule}
            title={futureSchedule ? 'Plan een handmatige scan in (orchestrator pakt deze in eerstvolgende poll)' : 'Skill nog niet geregistreerd in agent_schedules'}
          >
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <circle cx="12" cy="12" r="2" />
            </svg>
            {busy ? 'Bezig…' : 'Scan toekomst nu'}
          </button>
        </div>
      </header>

      {runMsg && <div className="fut-section__msg">{runMsg}</div>}

      {eventsWithExt.length === 0 ? (
        <div className="km-empty">
          Geen aankomende externe afspraken in de eerstkomende {FUTURE_WINDOW_DAYS} dagen.
          <span className="km-empty__hint">
            Voorwaarde: agenda-event met minimaal één deelnemer buiten <code>@legal-mind.nl</code>.
          </span>
        </div>
      ) : (
        <KennismakingsTableMaestro
          events={eventsWithExt}
          hsIndex={hsIndex}
          pipelineLookup={pipelineLookup}
          dismissedSet={dismissedSet}
          eventsWithProposal={eventsWithProposal}
          onDismiss={onDismiss}
          onUndoDismiss={onUndoDismiss}
        />
      )}
    </section>
  )
}
