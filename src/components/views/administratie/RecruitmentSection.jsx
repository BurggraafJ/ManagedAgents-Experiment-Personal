import { useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'

// RecruitmentSection — Maestro v2 (rebuild 2026-05-12).
// Eigen sectie onder de "Aankomende externe afspraken" — paper-2 card met:
//   • Header: h3 "Recruitment-kennismakingen" + count-pill + sub-text.
//   • Tabel met upcoming meetings (mockup-conform .fut-tbl).
//   • Collapsible "recent geweest (7d)" voor afgelopen 7 dagen.
//   • Empty state met icon als beide buckets leeg zijn.

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
  </svg>
)

export default function RecruitmentSection({ meetings, onRefresh }) {
  const [dismissingId, setDismissingId] = useState(null)

  const { upcoming, recent } = useMemo(() => {
    const now = Date.now()
    const u = []
    const r = []
    for (const m of (meetings || [])) {
      const t = new Date(m.start_time).getTime()
      if (t >= now) u.push(m)
      else r.push(m)
    }
    return { upcoming: u, recent: r }
  }, [meetings])

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
      <header className="fut-section__head fut-section__head--simple">
        <div className="fut-section__head-text">
          <h3 className="fut-section__title">
            Recruitment-kennismakingen
            <span className="km-pill">{upcoming.length}</span>
          </h3>
          <div className="fut-section__sub">
            agenda-events gematcht op een open Jira-REC-issue · kandidaat-flow loopt via Recruitment Kanban, los van sales/leads
          </div>
        </div>
      </header>

      {upcoming.length === 0 && recent.length === 0 ? (
        <div className="km-empty km-empty--big">
          <div className="km-empty__icon" aria-hidden>
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div className="km-empty__title">Geen aankomende of recente recruitment-meetings</div>
          <div className="km-empty__hint">
            Vereist: agenda-event met externe attendee én open issue in Jira-project <code>REC</code>.
          </div>
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
                      isPast={false}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {recent.length > 0 && (
            <details className="km-recent">
              <summary className="km-recent__summary">
                <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="km-recent__caret" aria-hidden>
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                <span className="km-recent__title">{recent.length} recent geweest</span>
                <span className="km-recent__hint">laatste 7 dagen — voor referentie</span>
              </summary>
              <div className="km-recent__body">
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
                          isPast={true}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </details>
          )}
        </>
      )}
    </section>
  )
}

function RecruitmentRowMaestro({ meeting, onDismiss, busy, isPast }) {
  const when = new Date(meeting.start_time)
  const dateLabel = when.toLocaleDateString('nl-NL', { weekday: 'short', day: '2-digit', month: 'short' })
  const timeLabel = when.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
  const subjectFull = meeting.subject || '(zonder titel)'
  const subjectShort = subjectFull.length > 60 ? subjectFull.slice(0, 60) + '…' : subjectFull
  const locShort = meeting.online_meeting_url ? 'Teams' : (meeting.location_text || '—')
  const externals = (meeting.attendee_names && meeting.attendee_names.length > 0)
    ? meeting.attendee_names
    : (meeting.attendee_emails || [])

  return (
    <tr className={isPast ? 'is-past' : undefined}>
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
            {meeting.subject && <div className="cell-pop__sub">{meeting.subject}</div>}
            {meeting.jira_status && <div className="cell-pop__sub">Status: {meeting.jira_status}</div>}
          </div>
        )}
      </td>
      <td className="cell-hover">
        {externals.length === 0 ? (
          <span className="km-soft">—</span>
        ) : (
          <>
            <div className="compact-line cell-trunc">{externals[0]}</div>
            {externals.length > 1 && (
              <div className="compact-sub cell-trunc">
                {externals[1]}{externals.length > 2 ? ` · +${externals.length - 2}` : ''}
              </div>
            )}
            <div className="cell-pop">
              <div className="cell-pop__title">Externe deelnemers · {externals.length}</div>
              {externals.slice(0, 10).map((n, i) => (
                <div key={i} className="cell-pop__line">{n}</div>
              ))}
              {externals.length > 10 && (
                <div className="cell-pop__sub">+{externals.length - 10} meer…</div>
              )}
            </div>
          </>
        )}
      </td>
      <td>
        <span className={locShort === '—' ? 'km-soft' : undefined}>{locShort}</span>
      </td>
      <td className="km-action-cell">
        <button
          type="button"
          className="fut-trash"
          onClick={() => !busy && onDismiss?.(meeting)}
          disabled={busy}
          title="Niet meer tonen — verbergt dit event uit de Recruitment-sectie"
          aria-label="Verbergen"
        >
          <TrashIcon />
        </button>
      </td>
    </tr>
  )
}
