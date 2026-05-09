import styles from '../autodraft.module.css'

// F.4.c — AgendaCheckBadge: toont groen/rood/grijs vinkje voor drafts met datums.
// Leest autodraft_mails.agenda_check_result (gevuld door auto-draft v9 stap 7b).
export default function AgendaCheckBadge({ result }) {
  if (!result || typeof result !== 'object') return null
  const verdict = result.verdict
  const slotsCount = Array.isArray(result.slots_in_draft) ? result.slots_in_draft.length : 0
  if (verdict === 'not_checked' || slotsCount === 0) return null

  const conflicts = Array.isArray(result.conflicts) ? result.conflicts : []
  const isOk = verdict === 'ok'
  const isConflict = verdict === 'conflict'

  const color = isOk ? '#10b981' : isConflict ? '#ef4444' : 'var(--text-muted)'
  const bg = isOk
    ? 'color-mix(in srgb, #10b981 8%, var(--bg))'
    : isConflict
      ? 'color-mix(in srgb, #ef4444 10%, var(--bg))'
      : 'var(--surface-1)'
  const icon = isOk ? '🟢' : isConflict ? '🔴' : '⚪'
  const label = isOk
    ? `Agenda gecheckt — past (${slotsCount} ${slotsCount === 1 ? 'slot' : 'slots'})`
    : isConflict
      ? `Agenda — ${conflicts.length} conflict${conflicts.length === 1 ? '' : 'en'}`
      : 'Agenda — niet gecheckt'

  const conflictDetails = isConflict ? conflicts.slice(0, 4).map((c, i) => {
    const slot = (result.slots_in_draft || [])[c.slot_index]
    const slotLabel = slot
      ? new Date(slot.start).toLocaleDateString('nl-NL', { weekday: 'short', day: '2-digit', month: 'short' })
        + ' ' + new Date(slot.start).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
      : `slot ${c.slot_index + 1}`
    const reasonLabel = {
      calendar_overlap: 'overlap met bestaande afspraak',
      reservation_overlap: 'al voorgesteld aan iemand anders',
      planner_rule_violation: c.detail || 'planner-regel overtreding',
      invalid_timestamp: 'ongeldig tijdstip',
    }[c.reason] || c.reason
    return (
      <li key={i} className={styles.badgeSlotItem}>
        <strong>{slotLabel}</strong> — {reasonLabel}
      </li>
    )
  }) : null

  return (
    <div
      className={styles.badgeDetailBlock}
      style={{
        margin: '8px 16px',
        border: `1px solid ${color}`,
        background: bg,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span className={styles.badgeIcon}>{icon}</span>
        <strong style={{ color }}>{label}</strong>
      </div>
      {isConflict && conflictDetails && conflictDetails.length > 0 && (
        <ul className={styles.badgeSlotList}>
          {conflictDetails}
          {conflicts.length > 4 && (
            <li style={{ color: 'var(--text-muted)' }}>+ {conflicts.length - 4} andere</li>
          )}
        </ul>
      )}
      {isOk && slotsCount > 0 && (
        <div className={styles.badgeMeta} style={{ marginTop: 2, marginLeft: 0 }}>
          {(result.slots_in_draft || []).slice(0, 3).map((s, i) => (
            <span key={i}>
              {i > 0 && ' · '}
              {new Date(s.start).toLocaleDateString('nl-NL', { weekday: 'short', day: '2-digit', month: 'short' })}
              {' '}
              {new Date(s.start).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
