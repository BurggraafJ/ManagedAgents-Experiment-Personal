import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { clamp, truncate, eventTone } from '../../../lib/now'

// Full-width agenda-strook 08:00 → 20:00 met events + voorstellen + spelregels.
// Drie data-bronnen: calendar_events (active), agenda_appointment_proposals
// (pending|sent), agenda_planner_rules (enabled traffic_window /
// no_meetings_window / travel_buffer / time_block).
export default function NowAgendaStrip() {
  const [events, setEvents] = useState([])
  const [proposals, setProposals] = useState([])
  const [rules, setRules] = useState([])
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    const start = new Date(); start.setHours(0, 0, 0, 0)
    const end = new Date(); end.setHours(23, 59, 59, 999)

    Promise.all([
      supabase.from('calendar_events')
        .select('id, subject, start_time, end_time, is_all_day, is_cancelled, location_text, categories, online_meeting_url')
        .eq('is_cancelled', false)
        .eq('is_deleted', false)
        .gte('start_time', start.toISOString())
        .lte('start_time', end.toISOString())
        .order('start_time'),
      supabase.from('agenda_appointment_proposals')
        .select('id, subject, proposed_start, proposed_end, status')
        .in('status', ['pending', 'sent'])
        .gte('proposed_start', start.toISOString())
        .lte('proposed_start', end.toISOString()),
      supabase.from('agenda_planner_rules').select('*').eq('enabled', true),
    ]).then(([evRes, propRes, ruleRes]) => {
      if (cancelled) return
      setEvents(evRes.data || [])
      setProposals(propRes.data || [])
      setRules(ruleRes.data || [])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const dayStart = useMemo(() => { const d = new Date(); d.setHours(8, 0, 0, 0); return d.getTime() }, [])
  const dayEnd   = useMemo(() => { const d = new Date(); d.setHours(20, 0, 0, 0); return d.getTime() }, [])
  const span = dayEnd - dayStart
  const hours = Array.from({ length: 13 }, (_, i) => 8 + i)

  const positionedEvents = events
    .filter(ev => !ev.is_all_day)
    .map(ev => {
      const t = new Date(ev.start_time).getTime()
      const tEnd = ev.end_time ? new Date(ev.end_time).getTime() : t + 30 * 60000
      const left = ((t - dayStart) / span) * 100
      const width = Math.max(((tEnd - t) / span) * 100, 3)
      const tone = eventTone(ev)
      const hm = new Date(ev.start_time).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
      return { ev, left, width, tone, hm }
    })
    .filter(x => x.left >= -5 && x.left <= 105)

  const positionedProposals = proposals.map(p => {
    const t = new Date(p.proposed_start).getTime()
    const tEnd = p.proposed_end ? new Date(p.proposed_end).getTime() : t + 30 * 60000
    const left = ((t - dayStart) / span) * 100
    const width = Math.max(((tEnd - t) / span) * 100, 3)
    const hm = new Date(p.proposed_start).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
    return { p, left, width, hm }
  }).filter(x => x.left >= -5 && x.left <= 105)

  const positionedRules = useMemo(() => {
    const out = []
    rules.forEach(r => {
      const type = r.rule_type || r.type
      if (!['traffic_window', 'no_meetings_window', 'travel_buffer', 'time_block'].includes(type)) return
      const startHour = r.start_hour ?? r.applies_from_hour
      const endHour = r.end_hour ?? r.applies_to_hour
      if (startHour == null || endHour == null) return
      const t = new Date(); t.setHours(startHour, 0, 0, 0)
      const tEnd = new Date(); tEnd.setHours(endHour, 0, 0, 0)
      const left = ((t.getTime() - dayStart) / span) * 100
      const width = Math.max(((tEnd.getTime() - t.getTime()) / span) * 100, 2)
      out.push({ r, left, width, type })
    })
    return out.filter(x => x.left >= -5 && x.left <= 105)
  }, [rules, dayStart, span])

  const nowPct = ((now.getTime() - dayStart) / span) * 100
  const nowVisible = nowPct >= 0 && nowPct <= 100
  const totalCount = events.length + proposals.length

  return (
    <div className="now-agenda">
      <div className="now-agenda__head">
        <h3>Vandaag · 08:00 → 20:00</h3>
        <div className="now-agenda__meta">
          <span className="now-pill now-pill--info">{events.length} event{events.length === 1 ? '' : 's'}</span>
          {proposals.length > 0 && (
            <span className="now-pill now-pill--accent">{proposals.length} voorstel{proposals.length === 1 ? '' : 'len'}</span>
          )}
          {totalCount === 0 && <span className="now-pill">geen agenda-items</span>}
        </div>
      </div>
      <div className="now-agenda__rail">
        {hours.map((h, i) => (
          <span key={h} className="now-agenda__hour" style={{ left: ((i / 12) * 100) + '%' }}>
            {String(h).padStart(2, '0')}
          </span>
        ))}
        {positionedRules.map((x, i) => (
          <div
            key={'r' + i}
            className={`now-agenda__shadow now-agenda__shadow--${x.type}`}
            style={{ left: clamp(x.left, 0, 98) + '%', width: clamp(x.width, 2, 100 - x.left) + '%' }}
            title={x.r.label || x.type}
          />
        ))}
        {positionedEvents.map(({ ev, left, width, tone, hm }) => (
          <div
            key={ev.id}
            className={`now-agenda__ev now-agenda__ev--${tone}`}
            style={{ left: clamp(left, 0, 97) + '%', width: clamp(width, 3, 100 - left) + '%' }}
            title={`${ev.subject || '(geen titel)'} · ${hm}${ev.location_text ? ' · ' + ev.location_text : ''}`}
          >
            <span className="now-agenda__ev-title">{truncate(ev.subject || '(geen titel)', 38)}</span>
            <small>{hm}</small>
          </div>
        ))}
        {positionedProposals.map(({ p, left, width, hm }) => (
          <div
            key={'p' + p.id}
            className="now-agenda__proposal"
            style={{ left: clamp(left, 0, 97) + '%', width: clamp(width, 3, 100 - left) + '%' }}
            title={`Voorstel: ${p.subject || '(zonder onderwerp)'} · ${hm}`}
          >
            <span className="now-agenda__ev-title">⊕ {truncate(p.subject || 'Voorstel', 32)}</span>
            <small>{hm}</small>
          </div>
        ))}
        {nowVisible && <div className="now-agenda__now" style={{ left: nowPct + '%' }} />}
        {totalCount === 0 && positionedRules.length === 0 && (
          <div className="now-agenda__empty">geen events, voorstellen of spelregels vandaag</div>
        )}
      </div>
    </div>
  )
}
