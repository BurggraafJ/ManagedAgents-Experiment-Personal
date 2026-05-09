import { useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import styles from './HubSpotInboxFutureView.module.css'

/**
 * Recruitment-sectie — eigen tabel sinds skill v1.16 (2026-05-06).
 *
 * Daarvoor liep dit via agent_proposals, maar dat plaatste kandidaten in
 * dezelfde "Goedkeuren"-rij als sales/leads. Recruitment-flow is qua actie
 * heel anders (REC-card op Recruitment Kanban) en hoort dus visueel los te
 * staan.
 *
 * Bron: tabel `recruitment_meetings` (gevuld door daily-admin-future).
 * Toont upcoming + recent past (laatste 7 dagen). Dismiss → status='dismissed'.
 */
export default function RecruitmentSection({ meetings, onRefresh }) {
  const [dismissingId, setDismissingId] = useState(null)
  const upcoming = useMemo(
    () => (meetings || []).filter(m => new Date(m.start_time).getTime() >= Date.now()),
    [meetings],
  )
  const recent = useMemo(
    () => (meetings || []).filter(m => new Date(m.start_time).getTime() < Date.now()),
    [meetings],
  )

  const handleDismiss = async (meeting) => {
    setDismissingId(meeting.id)
    try {
      await supabase
        .from('recruitment_meetings')
        .update({ status: 'dismissed', dismissed_at: new Date().toISOString(), dismissed_reason: 'manual_dismiss' })
        .eq('id', meeting.id)
      onRefresh && onRefresh()
    } finally {
      setDismissingId(null)
    }
  }

  return (
    <section className={`va-block ${styles.blockPad}`}>
      <header className={styles.sectionHeader}>
        <div>
          <h2 className={`va-block__title ${styles.sectionTitle}`}>
            Recruitment-kennismakingen
            <span className={`va-block__count ${styles.sectionTitleCount}`}>{upcoming.length}</span>
          </h2>
          <div className={`muted ${styles.sectionSubtitle}`}>
            agenda-events gematcht op een open Jira-REC-issue · kandidaat-flow loopt via Recruitment Kanban, los van sales/leads
          </div>
        </div>
      </header>
      {upcoming.length === 0 && recent.length === 0 ? (
        <div className={`empty empty--compact ${styles.emptyMid}`}>
          Geen aankomende of recente recruitment-kennismakingen.
          <br />
          <span className={`muted ${styles.emptyHint}`}>
            Vereist: agenda-event met externe attendee én open issue in Jira-project <code>REC</code>.
          </span>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <div className={`table-wrap ${recent.length > 0 ? styles.othersBetween : ''}`}>
              <table className="table">
                <thead>
                  <tr>
                    <th className={styles.colWhen}>Wanneer</th>
                    <th className={styles.colRecIssue}>REC-issue</th>
                    <th>Kandidaat</th>
                    <th className={styles.colExternals}>Externe deelnemers</th>
                    <th className={styles.colLocation}>Locatie</th>
                    <th className={styles.colActions}></th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map(m => (
                    <RecruitmentRow
                      key={m.id}
                      meeting={m}
                      onDismiss={handleDismiss}
                      busy={dismissingId === m.id}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {recent.length > 0 && (
            <details>
              <summary className={`muted ${styles.recentSummary}`}>
                {recent.length} recent geweest (laatste 7 dagen)
              </summary>
              <div className={`table-wrap ${styles.othersBody}`}>
                <table className="table">
                  <thead>
                    <tr>
                      <th className={styles.colWhen}>Wanneer</th>
                      <th className={styles.colRecIssue}>REC-issue</th>
                      <th>Kandidaat</th>
                      <th className={styles.colExternals}>Externe deelnemers</th>
                      <th className={styles.colLocation}>Locatie</th>
                      <th className={styles.colActionsLeft}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map(m => (
                      <RecruitmentRow
                        key={m.id}
                        meeting={m}
                        onDismiss={handleDismiss}
                        busy={dismissingId === m.id}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}
    </section>
  )
}

function RecruitmentRow({ meeting, onDismiss, busy }) {
  const when = new Date(meeting.start_time)
  const dateLabel = when.toLocaleDateString('nl-NL', { weekday: 'short', day: '2-digit', month: 'short' })
  const timeLabel = when.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
  const subjectShort = (meeting.subject || '(zonder titel)').slice(0, 80)
  const locShort = meeting.online_meeting_url ? 'Teams' : (meeting.location_text || '—')
  const externals = (meeting.attendee_names && meeting.attendee_names.length > 0)
    ? meeting.attendee_names
    : (meeting.attendee_emails || [])

  return (
    <tr>
      <td className={`mono ${styles.cellMono}`}>
        <div>{dateLabel}</div>
        <div className={`muted ${styles.cellSubMuted}`}>{timeLabel}</div>
      </td>
      <td className={`mono ${styles.cellMono}`}>
        <div>{meeting.jira_issue_key}</div>
        {meeting.jira_status && (
          <div className={`muted ${styles.cellSubTinyMuted}`}>{meeting.jira_status}</div>
        )}
      </td>
      <td className={styles.cellSmall} title={meeting.jira_summary || ''}>
        <div>{(meeting.jira_summary || '—').slice(0, 60)}</div>
        <div className={`muted ${styles.cellSubTinyMuted}`} title={meeting.subject || ''}>{subjectShort}</div>
      </td>
      <td className={styles.cellSmall}>
        {externals.slice(0, 4).map((n, i) => <div key={i}>{n}</div>)}
        {externals.length > 4 && <div className={`muted ${styles.cellSubTinyMuted}`}>+{externals.length - 4}</div>}
      </td>
      <td className={styles.cellSmall} title={meeting.location_text || ''}>{locShort}</td>
      <td className={styles.cellActionRight}>
        <button
          type="button"
          onClick={() => !busy && onDismiss?.(meeting)}
          disabled={busy}
          title="Niet meer tonen — verbergt dit event uit de Recruitment-sectie"
          className={styles.iconBtn}
        >
          🗑
        </button>
      </td>
    </tr>
  )
}
