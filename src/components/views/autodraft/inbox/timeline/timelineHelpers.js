// Pure helpers + TYPES-mapping voor SenderTimeline / CompanyTimeline. Geen
// React, alleen string/date-formatting en classifier-logica.

import { isInternalEmail } from '../../../../../lib/autodraft'

export const TYPES = {
  meeting:  { label: 'Meeting',       cls: 'typeMeeting',  icon: '🗓' },
  note:     { label: 'HubSpot-note',  cls: 'typeNote',     icon: '📝' },
  intern:   { label: 'Intern',        cls: 'typeIntern',   icon: '🏢' },
  twoway:   { label: 'Heen-en-weer',  cls: 'typeTwoway',   icon: '↔' },
  incoming: { label: 'Inkomend',      cls: 'typeIncoming', icon: '←' },
  outgoing: { label: 'Verzonden',     cls: 'typeOutgoing', icon: '→' },
}

export function classifyThread(thread) {
  if (isInternalEmail(thread.latest_from_email)) return 'intern'
  if ((thread.incoming_count || 0) > 0 && (thread.outgoing_count || 0) > 0) return 'twoway'
  if ((thread.incoming_count || 0) === 0) return 'outgoing'
  return 'incoming'
}

export function stripHtml(s) {
  if (!s) return ''
  return s.replace(/<\/?(p|div|br|span|strong|em|b|i|u)[^>]*>/gi, ' ')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
          .replace(/\s+/g, ' ').trim()
}

export function formatDayShort(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('nl-NL', { weekday: 'short', day: '2-digit', month: 'short' })
}

export function formatEventTime(start, end, isAllDay) {
  if (!start) return ''
  if (isAllDay) return 'Hele dag'
  const fmt = (d) => d.toLocaleString('nl-NL', { hour: '2-digit', minute: '2-digit' })
  if (!end) return fmt(new Date(start))
  return `${fmt(new Date(start))} – ${fmt(new Date(end))}`
}

export function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1).trim() + '…' : s
}
