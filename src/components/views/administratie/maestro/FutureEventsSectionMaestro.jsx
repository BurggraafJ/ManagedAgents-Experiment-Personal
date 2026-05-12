import { useState } from 'react'
import { supabase } from '../../../../lib/supabase'
import { formatDateTime } from '../../hubspot-common'
import { FUTURE_AGENT, FUTURE_WINDOW_DAYS } from '../../../../lib/hubspotInbox'
import KennismakingsTableMaestro from './KennismakingsTableMaestro'

// FutureEventsSectionMaestro — Maestro v2 (rebuild 2026-05-12).
// Section "Aankomende externe afspraken" — paper-2 card met:
//   • Header: titel + count-pill links, sub-text eronder, rechts laatste-scan
//     timestamp + oranje "Scan toekomst nu"-knop (met busy-state spinner).
//   • Run-message slot (success/error) onder de header.
//   • Body: KennismakingsTableMaestro met Eerste kennismakingen (primair)
//     + collapsible Andere externe afspraken.
//   • Empty state met icoon + uitleg als geen events binnen window.

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
    setBusy(true)
    setRunMsg(null)
    try {
      const { error } = await supabase
        .from('agent_schedules')
        .update({ manual_run_requested_at: new Date().toISOString() })
        .eq('agent_name', FUTURE_AGENT)
      if (error) throw error
      setRunMsg({ tone: 'info', text: 'Scan ingepland — orchestrator pakt deze op in z\'n eerstvolgende poll (max 15 min).' })
      onRefresh && onRefresh()
    } catch (e) {
      setRunMsg({ tone: 'error', text: `⚠ ${e.message || 'kon scan niet inplannen'}` })
    } finally {
      setBusy(false)
    }
  }

  const hasEvents = eventsWithExt.length > 0

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
            <span className="fut-section__last" title="Laatste run van daily-admin-future">
              laatste scan: {formatDateTime(futureSchedule.last_run_at)}
            </span>
          )}
          <button
            type="button"
            className={`fut-scan-btn ${busy ? 'is-busy' : ''}`}
            onClick={triggerScan}
            disabled={busy || !futureSchedule}
            title={futureSchedule ? 'Plan een handmatige scan in (max 15 min wachten)' : 'Skill nog niet geregistreerd in agent_schedules'}
          >
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="fut-scan-btn__icon" aria-hidden>
              {busy ? (
                <path d="M21 12a9 9 0 11-6.219-8.56" />
              ) : (
                <>
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                </>
              )}
            </svg>
            {busy ? 'Bezig…' : 'Scan toekomst nu'}
          </button>
        </div>
      </header>

      {runMsg && (
        <div className={`fut-section__msg fut-section__msg--${runMsg.tone}`} role="status">
          {runMsg.text}
        </div>
      )}

      {!hasEvents ? (
        <div className="km-empty km-empty--big">
          <div className="km-empty__icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M3 10h18M8 2v4M16 2v4" />
            </svg>
          </div>
          <div className="km-empty__title">Geen aankomende externe afspraken</div>
          <div className="km-empty__hint">
            Voorwaarde: agenda-event met minimaal één deelnemer buiten <code>@legal-mind.nl</code>, binnen {FUTURE_WINDOW_DAYS} dagen vanaf nu.
          </div>
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
