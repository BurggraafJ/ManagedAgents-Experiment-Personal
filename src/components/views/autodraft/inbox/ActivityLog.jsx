import { useMemo } from 'react'
import { formatRelative, formatDateTime } from '../../../../lib/autodraft'

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
    <div style={{
      margin: '12px 24px 20px',
      padding: '10px 14px',
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--surface-1)',
      fontSize: 12,
    }}>
      <div style={{
        textTransform: 'uppercase', letterSpacing: '0.06em',
        fontSize: 10.5, color: 'var(--text-muted)', fontWeight: 600,
        marginBottom: 8,
      }}>
        📜 Activiteit
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {skillContext.map((s, i) => (
          <div key={`skill-${i}`} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ width: 90, flexShrink: 0, color: 'var(--text-muted)', fontSize: 11 }}>
              {formatRelative(s.decided_at)}
            </span>
            <div style={{ flex: 1 }}>
              <strong>Skill: {actionLabel(s.action || 'voorstel')}</strong>
              {s.confidence != null && <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>· {Math.round(s.confidence * 100)}%</span>}
              {s.reasoning && <div style={{ color: 'var(--text-muted)', fontSize: 11.5, marginTop: 2 }}>{s.reasoning}</div>}
            </div>
          </div>
        ))}
        {events.map((e, i) => (
          <div key={`d-${i}`} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ width: 90, flexShrink: 0, color: 'var(--text-muted)', fontSize: 11 }}>
              {formatRelative(e.decided_at)}
            </span>
            <div style={{ flex: 1 }}>
              <strong>{actionLabel(e.action)}</strong>
              {e.target_folder && <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>→ {e.target_folder}</span>}
              {e.amend && <div style={{ color: 'var(--text-muted)', fontSize: 11.5, marginTop: 2, fontStyle: 'italic' }}>"{e.amend}"</div>}
              {e.execution_status === 'failed' && (
                <div style={{ color: 'var(--error)', fontSize: 11.5, marginTop: 2 }}>
                  ⚠ Faalde: {e.execution_error || 'onbekende fout'}
                </div>
              )}
              {e.execution_status === 'done' && e.executed_at && (
                <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2 }}>
                  Uitgevoerd om {formatDateTime(e.executed_at)}
                </div>
              )}
              <span style={{ color: 'var(--text-muted)', fontSize: 10.5, marginLeft: 0, marginTop: 2, display: 'inline-block' }}>
                door {e.decided_by || 'jou'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
