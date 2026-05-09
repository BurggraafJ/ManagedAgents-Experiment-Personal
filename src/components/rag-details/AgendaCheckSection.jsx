import { fmtDate } from './chrome'

// AgendaCheckSection — toont per autodraft-mail of de agenda is geraadpleegd.
// Vier states: 🟢 ok / ⚠ conflict / 🟡 niet nodig / 🔴 niet uitgevoerd.
export default function AgendaCheckSection({ agendaInfo }) {
  const rel = agendaInfo.agenda_relevance || null
  const check = agendaInfo.agenda_check_result || null

  let state, icon, label, detail
  if (!rel && !check) {
    state = { bg: '#f3f4f6', fg: '#6b7280', border: '#e5e7eb' }
    icon = '⊘'
    label = 'Agenda niet beoordeeld'
    detail = 'Mail is verwerkt vóór de agenda-gate live ging, of is nog niet door auto-draft v10 gegaan.'
  } else if (rel && rel.relevant === false) {
    state = { bg: '#f3f4f6', fg: '#6b7280', border: '#e5e7eb' }
    icon = '🟡'
    label = 'Agenda niet relevant'
    detail = rel.reason || 'AI bepaalde dat een agenda-check niet nodig is voor deze mail.'
  } else if (rel && rel.relevant === true && check && check.verdict === 'ok') {
    state = { bg: '#dcfce7', fg: '#166534', border: '#86efac' }
    icon = '✓'
    label = 'Agenda geraadpleegd · ruimte gevonden'
    const slots = check.available_slots || check.slots_in_draft || []
    detail = slots.length > 0
      ? `${slots.length} slot${slots.length === 1 ? '' : 's'} beschikbaar in de gevraagde range.`
      : 'Geen conflicten gedetecteerd.'
  } else if (rel && rel.relevant === true && check && check.verdict === 'conflict') {
    state = { bg: '#fef3c7', fg: '#92400e', border: '#fcd34d' }
    icon = '⚠'
    label = 'Agenda geraadpleegd · conflict'
    detail = (check.conflicts && check.conflicts[0]?.detail) || 'Een of meer datums in de draft botsen met bestaande agenda.'
  } else if (rel && rel.relevant === true && (!check || check.verdict === 'no_slots')) {
    state = { bg: '#fee2e2', fg: '#991b1b', border: '#fca5a5' }
    icon = '🔴'
    label = 'Agenda raadplegen vereist · nog niet gelukt'
    detail = check?.reason
      ? `Reden: ${check.reason}.`
      : 'AI markeerde deze mail als agenda-relevant, maar de check is nog niet uitgevoerd of leverde geen slots.'
  } else if (check && check.verdict === 'not_checked') {
    state = { bg: '#f3f4f6', fg: '#6b7280', border: '#e5e7eb' }
    icon = '⊘'
    label = 'Geen datum-hints in draft'
    detail = check.reason === 'no_date_hints'
      ? 'De draft noemt geen concrete datums, dus geen agenda-check uitgevoerd.'
      : 'Geen datum-slots boven 0.7 confidence gedetecteerd.'
  } else {
    state = { bg: '#f3f4f6', fg: '#6b7280', border: '#e5e7eb' }
    icon = '⊘'
    label = 'Agenda-status onbekend'
    detail = 'Geen standaard verdict — zie de jsonb hieronder.'
  }

  const slots = (check?.available_slots || check?.slots_in_draft || [])
  const conflicts = check?.conflicts || []

  return (
    <div style={{ marginBottom: 16, padding: 12, borderRadius: 8, border: `1px solid ${state.border}`, background: state.bg }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <strong style={{ fontSize: 13, color: state.fg }}>{label}</strong>
      </div>
      <div style={{ fontSize: 12, color: state.fg, opacity: 0.9 }}>{detail}</div>

      {rel && rel.relevant === true && rel.confidence != null && (
        <div style={{ marginTop: 6, fontSize: 11, color: state.fg, opacity: 0.8 }}>
          Confidence relevantie: {Number(rel.confidence).toFixed(2)}
          {rel.request_type && rel.request_type !== 'none' && <> · type: {rel.request_type}</>}
        </div>
      )}

      {slots.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 11, color: state.fg, fontWeight: 600 }}>
            Bekijk {slots.length} slot{slots.length === 1 ? '' : 's'}
          </summary>
          <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: 11, color: state.fg }}>
            {slots.slice(0, 5).map((s, i) => (
              <li key={i} style={{ marginBottom: 2 }}>
                {s.label || s.verbatim || `${fmtDate(s.start)} — ${fmtDate(s.end)}`}
              </li>
            ))}
          </ul>
        </details>
      )}

      {conflicts.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: 'pointer', fontSize: 11, color: state.fg, fontWeight: 600 }}>
            Conflicten ({conflicts.length})
          </summary>
          <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: 11, color: state.fg }}>
            {conflicts.map((c, i) => (
              <li key={i} style={{ marginBottom: 2 }}>{c.reason}: {c.detail}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
