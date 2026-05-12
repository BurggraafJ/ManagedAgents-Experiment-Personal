import { useMemo, useState } from 'react'
import { supabase } from '../../../../lib/supabase'

// RecruitmentSectionMaestro — eigen tabel onder de eerste-kennismakingen.
// Mockup: section met paper-2 bg + radius 14 + .fut-tbl. Mirror van V1's
// RecruitmentSection, classes uit mockup.

export default function RecruitmentSectionMaestro({ meetings, onRefresh }) {
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
    <section className="fut-section">
      <header className="fut-section__head">
        <h3 className="fut-section__title">
          Recruitment-kennismakingen
          <span className="km-pill">{upcoming.length}</span>
        </h3>
        <div className="fut-section__sub">
          agenda-events gematcht op een open Jira-REC-issue · kandidaat-flow loopt via Recruitment Kanban, los van sales/leads
        </div>
      </header>

      {upcoming.length === 0 && recent.length === 0 ? (
        <div className="km-empty">
          Geen aankomende of recente recruitment-kennismakingen.
          <span className="km-empty__hint">Vereist: agenda-event met externe attendee én open issue in Jira-project <code>REC</code>.</span>
        </div>
      ) : (
        <>
          {upcoming.length > 0 && (
            <div className="fut-tbl-wrap">
              <table className="fut-tbl">
                <thead>
                  <tr>
                    <th style={{ width: 90 }}>Wanneer</th>
                    <th style={{ width: 130 }}>REC-issue</th>
                    <th>Kandidaat</th>
                    <th style={{ width: 200 }}>Externe deelnemers</th>
                    <th style={{ width: 170 }}>Locatie</th>
                    <th style={{ width: 34 }} aria-label="acties" />
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map(m => (
                    <RecruitmentRowMaestro
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
            <details className="km-recent">
              <summary className="km-recent__summary">{recent.length} recent geweest (laatste 7 dagen)</summary>
              <div className="fut-tbl-wrap">
                <table className="fut-tbl">
                  <thead>
                    <tr>
                      <th style={{ width: 90 }}>Wanneer</th>
                      <th style={{ width: 130 }}>REC-issue</th>
                      <th>Kandidaat</th>
                      <th style={{ width: 200 }}>Externe deelnemers</th>
                      <th style={{ width: 170 }}>Locatie</th>
                      <th style={{ width: 34 }} aria-label="acties" />
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map(m => (
                      <RecruitmentRowMaestro
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

function RecruitmentRowMaestro({ meeting, onDismiss, busy }) {
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
      <td>
        <div className="km-when-date">{dateLabel}</div>
        <div className="compact-sub">{timeLabel}</div>
      </td>
      <td>
        <div className="km-when-date">{meeting.jira_issue_key}</div>
        {meeting.jira_status && <div className="compact-sub">{meeting.jira_status}</div>}
      </td>
      <td className="cell-hover">
        <div className="compact-line cell-trunc">{(meeting.jira_summary || '—').slice(0, 60)}</div>
        <div className="compact-sub cell-trunc">{subjectShort}</div>
        {(meeting.jira_summary || meeting.subject) && (
          <div className="cell-pop">
            <div className="cell-pop__title">{meeting.jira_summary || '(geen jira-summary)'}</div>
            <div className="cell-pop__sub">{meeting.subject || ''}</div>
          </div>
        )}
      </td>
      <td className="cell-hover">
        {externals.slice(0, 2).map((n, i) => (
          <div key={i} className={i === 0 ? 'compact-line cell-trunc' : 'compact-sub cell-trunc'}>{n}</div>
        ))}
        {externals.length > 2 && <div className="compact-sub">+{externals.length - 2}</div>}
        {externals.length > 0 && (
          <div className="cell-pop">
            <div className="cell-pop__title">Externe deelnemers · {externals.length}</div>
            {externals.map((n, i) => <div key={i} className="cell-pop__line">{n}</div>)}
          </div>
        )}
      </td>
      <td><span className={meeting.location_text || meeting.online_meeting_url ? '' : 'km-soft'}>{locShort}</span></td>
      <td className="km-action-cell">
        <button
          type="button"
          className="fut-trash"
          onClick={() => !busy && onDismiss?.(meeting)}
          disabled={busy}
          title="Niet meer tonen — verbergt dit event uit de Recruitment-sectie"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
          </svg>
        </button>
      </td>
    </tr>
  )
}
