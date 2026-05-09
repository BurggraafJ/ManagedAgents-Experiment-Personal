import { useMemo } from 'react'
import { formatRelative, formatDateTime } from '../../../../lib/autodraft'
import styles from '../autodraft.module.css'

// ActivityLog — chronologisch overzicht van alle decisions + auto-acties op
// een mail. Toont: timestamp, actie, reden, doelmap. Voor full traceability.
export default function ActivityLog({ mail, decisions, categories }) {
  const events = useMemo(() => {
    const out = []
    for (const d of (decisions || [])) {
      if (d.mail_id !== mail.mail_id) continue
      out.push({
        kind: 'decision',
        decided_at: d.decided_at,
        executed_at: d.executed_at,
        action: d.action,
        target_folder: d.target_folder,
        amend: d.amend_instructions,
        execution_status: d.execution_status,
        execution_error: d.execution_error,
        decided_by: d.decided_by,
      })
    }
    return out.sort((a, b) => new Date(a.decided_at) - new Date(b.decided_at))
  }, [decisions, mail.mail_id])

  // Skill-pre-classificatie altijd tonen als context
  const skillContext = []
  if (mail.suggested_action || mail.suggested_reasoning) {
    skillContext.push({
      kind: 'skill',
      decided_at: mail.scanned_at || mail.received_at,
      action: mail.suggested_action,
      reasoning: mail.suggested_reasoning,
      confidence: mail.confidence,
    })
  }

  if (events.length === 0 && skillContext.length === 0) return null

  function actionLabel(a) {
    return ({
      send: '✓ Concept geplaatst in Outlook',
      ignore: '📂 Afgehandeld (verplaatst)',
      amend: '✎ Aangepast door skill',
      spam: '⛔ Gemarkeerd als spam',
      flag: '★ Vlag aangezet',
      unflag: '☆ Vlag uit',
      draft: '✎ Voorgesteld als draft',
      skip: '🗂 Voorgesteld om te negeren',
      flag_suggested: '⚠ Voorgesteld om te flaggen',
    })[a] || a
  }

  return (
    <div className={styles.actLogBox}>
      <div className={styles.actLogHead}>
        📜 Activiteit
      </div>
      <div className={styles.actLogList}>
        {skillContext.map((s, i) => (
          <div key={`skill-${i}`} className={styles.actLogRow}>
            <span className={styles.actLogTimestamp}>
              {formatRelative(s.decided_at)}
            </span>
            <div className={styles.actLogBody}>
              <strong>Skill: {actionLabel(s.action || 'voorstel')}</strong>
              {s.confidence != null && <span className={styles.actLogMuted}>· {Math.round(s.confidence * 100)}%</span>}
              {s.reasoning && <div className={styles.actLogNote}>{s.reasoning}</div>}
            </div>
          </div>
        ))}
        {events.map((e, i) => (
          <div key={`d-${i}`} className={styles.actLogRow}>
            <span className={styles.actLogTimestamp}>
              {formatRelative(e.decided_at)}
            </span>
            <div className={styles.actLogBody}>
              <strong>{actionLabel(e.action)}</strong>
              {e.target_folder && <span className={styles.actLogMuted}>→ {e.target_folder}</span>}
              {e.amend && <div className={styles.actLogNoteItalic}>"{e.amend}"</div>}
              {e.execution_status === 'failed' && (
                <div className={styles.actLogNoteError}>
                  ⚠ Faalde: {e.execution_error || 'onbekende fout'}
                </div>
              )}
              {e.execution_status === 'done' && e.executed_at && (
                <div className={styles.actLogNoteDone}>
                  Uitgevoerd om {formatDateTime(e.executed_at)}
                </div>
              )}
              <span className={styles.actLogNoteBy}>
                door {e.decided_by || 'jou'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
