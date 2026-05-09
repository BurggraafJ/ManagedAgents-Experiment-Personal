import {
  HOUR_HEIGHT,
  HOURS,
  DAY_START,
  hhmmToMin,
  mergeShadowBlocks,
} from '../../../lib/agenda'

/**
 * AgendaRulesOverlay — shadow-laag voor één DayColumn.
 *
 * Verzamelt regels (geen-meetings-windows, verkeer, reistijd, post-meeting,
 * woensdag-intern) tot non-overlappende segmenten en rendert ze als
 * `<ShadowBlock>`'s. Ook de voorgestelde-slots (showProposals) horen bij
 * dezelfde ruimtelijke laag — vandaar dezelfde overlay.
 *
 * Inline-styles `top/height` zijn data-driven (minuten → pixels).
 */
export default function AgendaRulesOverlay({
  day,
  events,
  rules,
  showRules,
  showProposals,
  proposals = [],
  forecastLoc,
}) {
  const dowIdx     = (day.getDay() + 6) % 7
  const isWednesday = dowIdx === 2
  const isTuOrThu  = dowIdx === 1 || dowIdx === 3
  const isWeekday  = dowIdx <= 4

  // Verkeer alleen relevant als Jelle die dag NIET op een kantoor-locatie is.
  const onWorkLocation = !!(forecastLoc && /amsterdam|geldermalsen/i.test(forecastLoc.location))

  const timed = events.filter(({ ev }) => !ev.is_all_day)

  // Spelregel-lookups
  const travelBufferRule = rules.find(r => r.rule_key === 'physical_meeting_buffer_60min' && r.enabled)
  const trafficOldRule   = rules.find(r => r.rule_key === 'traffic_avoid_tue_thu_morning' && r.enabled)
  const trafficAllRule   = rules.find(r => r.rule_key === 'traffic_window_09_10_all_days' && r.enabled)
  const trafficEveRule   = rules.find(r => r.rule_key === 'traffic_window_18_19' && r.enabled)
  const beforeRule       = rules.find(r => r.rule_type === 'no_meetings_window' && r.params?.block_end && r.params?.block_start && r.enabled
                                    && r.params.block_start <= '08:00')
  const eveningRule      = rules.find(r => r.rule_type === 'no_meetings_window' && r.params?.block_start && r.enabled
                                    && r.params.block_start >= '18:00')
  const postBufferRule   = rules.find(r => r.rule_type === 'post_meeting_buffer' && r.enabled)
  const wednesdayRule    = rules.find(r => r.rule_key === 'no_clients_on_wednesday' && r.enabled)

  const showTrafficMorning = showRules && isWeekday && !onWorkLocation && (
    trafficAllRule || (trafficOldRule && isTuOrThu)
  )
  const showTrafficEvening = showRules && isWeekday && !onWorkLocation && trafficEveRule

  const shadowBlocks = []
  let _idx = 0
  if (showRules) {
    if (beforeRule) {
      shadowBlocks.push({
        startMin: 0, endMin: hhmmToMin(beforeRule.params.block_end),
        className: 'agenda-shadow--before9', label: 'Geen meetings',
        priority: beforeRule.priority || 0, idx: _idx++,
      })
    }
    if (showTrafficMorning) {
      shadowBlocks.push({
        startMin: (9 - DAY_START) * 60, endMin: (10 - DAY_START) * 60,
        className: 'agenda-shadow--traffic', label: 'Verkeer',
        priority: trafficAllRule?.priority || trafficOldRule?.priority || 50, idx: _idx++,
      })
    }
    if (showTrafficEvening) {
      shadowBlocks.push({
        startMin: hhmmToMin(trafficEveRule.params.block_start),
        endMin: hhmmToMin(trafficEveRule.params.block_end),
        className: 'agenda-shadow--traffic', label: 'Verkeer',
        priority: trafficEveRule.priority || 50, idx: _idx++,
      })
    }
    if (eveningRule) {
      shadowBlocks.push({
        startMin: hhmmToMin(eveningRule.params.block_start), endMin: HOURS * 60,
        className: 'agenda-shadow--evening', label: `Geen meetings na ${eveningRule.params.block_start}`,
        priority: eveningRule.priority || 50, idx: _idx++,
      })
    }
    if (travelBufferRule) {
      for (const { ev, classified } of timed) {
        if (!classified.is_physical) continue
        const evLoc = (ev.location_text || '').toLowerCase()
        const forecastLocLower = (forecastLoc?.location || '').toLowerCase()
        const sameLocation = forecastLocLower && evLoc.includes(forecastLocLower)
        if (sameLocation) continue
        const start = new Date(ev.start_time)
        const end   = new Date(ev.end_time)
        const startMin = (start.getHours() - DAY_START) * 60 + start.getMinutes()
        const endMin   = (end.getHours()   - DAY_START) * 60 + end.getMinutes()
        shadowBlocks.push({
          startMin: startMin - 60, endMin: startMin,
          className: 'agenda-shadow--travel', label: 'Reistijd',
          priority: travelBufferRule.priority || 100, idx: _idx++,
        })
        shadowBlocks.push({
          startMin: endMin, endMin: endMin + 60,
          className: 'agenda-shadow--travel', label: 'Reistijd',
          priority: travelBufferRule.priority || 100, idx: _idx++,
        })
      }
    }
    if (postBufferRule) {
      for (const { ev } of timed) {
        const start = new Date(ev.start_time)
        const end   = new Date(ev.end_time)
        const durationMin = (end - start) / 60000
        const minDuration = postBufferRule.params?.min_duration_minutes ?? 90
        if (durationMin < minDuration) continue
        const bufferMin = postBufferRule.params?.buffer_minutes ?? 15
        const endMin = (end.getHours() - DAY_START) * 60 + end.getMinutes()
        shadowBlocks.push({
          startMin: endMin, endMin: endMin + bufferMin,
          className: 'agenda-shadow--postbuffer', label: 'Speling',
          priority: postBufferRule.priority || 75, idx: _idx++,
        })
      }
    }
  }
  const mergedShadows = mergeShadowBlocks(shadowBlocks)

  return (
    <>
      {showRules && wednesdayRule && isWednesday && (
        <div
          className="agenda-shadow agenda-shadow--internal-day"
          style={{ top: 0, height: `${HOURS * HOUR_HEIGHT}px` }}
          title="Interne dag (woensdag): geen klantafspraken plannen"
        />
      )}
      {showRules && mergedShadows.map((b, i) => (
        <ShadowBlock
          key={`shadow-${i}`}
          startMin={b.startMin}
          endMin={b.endMin}
          className={b.className}
          label={b.label}
        />
      ))}

      {/* Voorgestelde slots — alleen als toggle aan + status='sent' */}
      {showProposals && proposals.map(({ slot, proposal }, i) => {
        const start = new Date(slot.start)
        const end   = new Date(slot.end)
        const startMin = (start.getHours() - DAY_START) * 60 + start.getMinutes()
        const endMin   = (end.getHours()   - DAY_START) * 60 + end.getMinutes()
        if (endMin <= 0 || startMin >= HOURS * 60) return null
        const top    = Math.max(0, (startMin / 60) * HOUR_HEIGHT)
        const height = Math.max(20, ((endMin - startMin) / 60) * HOUR_HEIGHT)
        return (
          <div
            key={`prop-${proposal.id}-${i}`}
            className="agenda-proposal-slot"
            style={{ top: `${top}px`, height: `${height}px` }}
            title={`Voorgesteld aan ${proposal.recipient_name || proposal.recipient_email || 'onbekend'} — ${proposal.subject_context || ''}`}
          >
            <span className="agenda-proposal-slot__label">
              ✉ {proposal.recipient_name || proposal.recipient_email || 'voorstel'}
            </span>
          </div>
        )
      })}
    </>
  )
}

function ShadowBlock({ startMin, endMin, className, label }) {
  const top    = (startMin / 60) * HOUR_HEIGHT
  const height = ((endMin - startMin) / 60) * HOUR_HEIGHT
  if (height <= 0) return null
  return (
    <div className={`agenda-shadow ${className}`} style={{ top: `${top}px`, height: `${height}px` }} title={label}>
      {height > 24 && <span className="agenda-shadow__label">{label}</span>}
    </div>
  )
}
