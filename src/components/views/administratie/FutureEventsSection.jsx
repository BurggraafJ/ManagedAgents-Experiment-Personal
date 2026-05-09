import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { formatDateTime } from '../hubspot-common'
import { FUTURE_AGENT, FUTURE_WINDOW_DAYS } from '../../../lib/hubspotInbox'
import KennismakingsTable from './KennismakingsTable'
import styles from './HubSpotInboxFutureView.module.css'

/**
 * FutureEventsSection — sectie-1: "Aankomende externe afspraken".
 * Bevat de section-header (titel + count + scan-knop) plus de tabel of de
 * empty-state. De manual-run-trigger zit hier zodat de container puur
 * orchestrator blijft.
 */
export default function FutureEventsSection({
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
    <section className={`va-block ${styles.blockPad}`}>
      <header className={styles.sectionHeader}>
        <div>
          <h2 className={`va-block__title ${styles.sectionTitle}`}>
            Aankomende externe afspraken
            <span className={`va-block__count ${styles.sectionTitleCount}`}>{eventsWithExt.length}</span>
          </h2>
          <div className={`muted ${styles.sectionSubtitle}`}>
            Komende {FUTURE_WINDOW_DAYS} dagen uit Outlook · alle events met externe deelnemers · per rij geclassificeerd via Jira-REC + HubSpot-mirror + partner_domains
          </div>
        </div>
        <div className={styles.sectionHeaderActions}>
          {futureSchedule?.last_run_at && (
            <span className={`muted ${styles.sectionLastRun}`}>
              laatste scan: {formatDateTime(futureSchedule.last_run_at)}
            </span>
          )}
          <button
            type="button"
            className="btn btn--accent"
            onClick={triggerScan}
            disabled={busy || !futureSchedule}
            title={futureSchedule ? 'Plan een handmatige scan in (orchestrator pakt deze in eerstvolgende poll)' : 'Skill nog niet geregistreerd in agent_schedules'}
          >
            {busy ? 'Bezig…' : '⟳ Scan toekomst nu'}
          </button>
        </div>
      </header>
      {runMsg && <div className={`muted ${styles.runMsg}`}>{runMsg}</div>}

      {eventsWithExt.length === 0 ? (
        <div className={`empty empty--compact ${styles.emptyLarge}`}>
          Geen aankomende externe afspraken in de eerstkomende {FUTURE_WINDOW_DAYS} dagen.
          <br />
          <span className={`muted ${styles.emptyHint}`}>
            Voorwaarde: agenda-event met minimaal één deelnemer buiten <code>@legal-mind.nl</code>.
          </span>
        </div>
      ) : (
        <KennismakingsTable
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
