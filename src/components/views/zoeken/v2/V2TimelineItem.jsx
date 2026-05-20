import { useEffect, useState } from 'react'
import s from './zoeken-v2.module.css'
import { SOURCE_ICONS } from './V2Icons'
import { supabase } from '../../../../lib/supabase'
import { fmtDate, cleanText } from '../../../../lib/rag'

// Timeline-item met uitklap. Per kind anders gerenderd:
//   mail   → bij expand wordt body uit mail_messages gefetcht (lazy)
//   note   → body_text zit al in meta (uit RPC)
//   event/meeting/agenda → body_preview + location + attendees uit meta
//   jira   → titel + status (niet in huidige RPC's, maar voorbereid)
export default function V2TimelineItem({ item, expanded, onToggle }) {
  const cls = TL_ITEM_CLASS[item.kind] || s.tlItemNote
  const icoCls = TL_ICO_CLASS[item.kind] || s.icoEvent
  const isMeeting = item.kind === 'meeting' || item.kind === 'agenda' || item.kind === 'event'
  const side = isMeeting ? 'right' : 'left'

  return (
    <div
      className={`${s.tlItem} ${cls} ${expanded ? s.tlItemOpen : ''}`}
      data-side={side}
      onClick={() => onToggle(item.key)}
    >
      <div className={s.tlRow}>
        <div className={`${s.tlIco} ${icoCls}`}>{SOURCE_ICONS[item.kind] || SOURCE_ICONS.event}</div>
        <div className={s.tlMain}>
          <div className={s.tlTop}>
            <span className={s.tlType}>
              {KIND_LABELS[item.kind] || item.kind}{item.direction ? ` · ${item.direction}` : ''}
            </span>
            <span className={s.tlWhen}>{item.ts ? fmtDate(item.ts) : ''}</span>
          </div>
          <div className={s.tlTitle}>{item.title || '(geen titel)'}</div>
          {!expanded && item.snip && (
            <div className={s.tlSnip}>
              {item.kind === 'note' ? cleanText(item.snip) : item.snip}
            </div>
          )}
          {item.who && <div className={s.tlBy}>{item.who}</div>}
          {expanded && <ExpandedBody item={item} />}
        </div>
        <span className={s.tlCaret} aria-hidden>{expanded ? '▾' : '▸'}</span>
      </div>
    </div>
  )
}

function ExpandedBody({ item }) {
  if (item.kind === 'mail') return <MailBody item={item} />
  if (item.kind === 'note') return <NoteBody item={item} />
  return <EventBody item={item} />
}

function MailBody({ item }) {
  const messageId = item.meta?.latest_message_id
  const [body, setBody] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!messageId) return
    let cancelled = false
    setLoading(true); setError(null)
    supabase.from('mail_messages')
      .select('body_text, body_preview, body_html')
      .eq('id', messageId)
      .maybeSingle()
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) setError(e.message || 'kon body niet ophalen')
        else setBody(data || { _empty: true })
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [messageId])

  if (loading) return <div className={s.tlExpandLoading}>Body laden…</div>
  if (error) return <div className={s.tlExpandError}>{error}</div>
  const text = body?.body_text || cleanText(body?.body_html || '') || body?.body_preview || item.snip || '(geen body opgeslagen)'
  return (
    <div className={s.tlExpand}>
      <div className={s.tlExpandLbl}>Bericht-tekst</div>
      <pre className={s.tlExpandPre}>{text}</pre>
      {item.meta?.thread_count > 1 && (
        <div className={s.tlExpandFoot}>Onderdeel van thread van {item.meta.thread_count} berichten</div>
      )}
    </div>
  )
}

function NoteBody({ item }) {
  // body_text bevat HubSpot-HTML (p, br, div). cleanText() strip naar tekst.
  const raw = item.meta?.body_text || item.snip || ''
  const body = cleanText(raw) || '(lege notitie)'
  return (
    <div className={s.tlExpand}>
      <div className={s.tlExpandLbl}>HubSpot-notitie</div>
      <pre className={s.tlExpandPre}>{body}</pre>
      {item.meta?.body_truncated && (
        <div className={s.tlExpandFoot}>Body is afgekapt — open in HubSpot voor volledige tekst</div>
      )}
    </div>
  )
}

function EventBody({ item }) {
  const m = item.meta || {}
  return (
    <div className={s.tlExpand}>
      {m.location && (
        <div className={s.tlExpandRow}><span className={s.tlExpandLbl}>Locatie</span><span>{m.location}</span></div>
      )}
      {m.end_time && (
        <div className={s.tlExpandRow}>
          <span className={s.tlExpandLbl}>Tot</span>
          <span>{fmtDate(m.end_time)}</span>
        </div>
      )}
      {m.attendees && m.attendees.length > 0 && (
        <div className={s.tlExpandRow}>
          <span className={s.tlExpandLbl}>Deelnemers ({m.attendees.length})</span>
          <span>{m.attendees.join(', ')}</span>
        </div>
      )}
      {m.body_preview && (
        <>
          <div className={s.tlExpandLbl} style={{ marginTop: 10 }}>Beschrijving</div>
          <pre className={s.tlExpandPre}>{m.body_preview}</pre>
        </>
      )}
    </div>
  )
}

const TL_ITEM_CLASS = {
  mail: s.tlItemMail,
  engagement: s.tlItemMail,
  deal: s.tlItemDeal,
  agenda: s.tlItemAgenda,
  event: s.tlItemAgenda,
  meeting: s.tlItemMeeting,
  jira: s.tlItemJira,
  note: s.tlItemNote,
}

const TL_ICO_CLASS = {
  mail: s.icoMail,
  engagement: s.icoEngagement,
  deal: s.icoDeal,
  agenda: s.icoAgenda,
  event: s.icoEvent,
  meeting: s.icoMeeting,
  jira: s.icoJira,
  note: s.icoEvent,
}

const KIND_LABELS = {
  mail: 'Mail',
  engagement: 'Engagement',
  deal: 'Deal',
  agenda: 'Agenda',
  event: 'Event',
  meeting: 'Meeting',
  jira: 'Jira',
  note: 'Notitie',
}

// Legenda — alle 4 hoofd-types met kleur-blok + count uit timeline.
export function V2TimelineLegend({ counts }) {
  const items = [
    { kind: 'mail',    label: 'Mail',    dotCls: s.legendMail,    count: counts.mail },
    { kind: 'meeting', label: 'Meeting (uitgelijnd rechts)', dotCls: s.legendMeeting, count: counts.meeting },
    { kind: 'agenda',  label: 'Agenda (komende)', dotCls: s.legendAgenda,  count: counts.event },
    { kind: 'note',    label: 'Notitie', dotCls: s.legendNote,    count: counts.note },
  ].filter(i => i.count > 0)
  if (items.length === 0) return null
  return (
    <div className={s.tlLegend}>
      <span className={s.tlLegendLbl}>Legenda</span>
      {items.map(i => (
        <span key={i.kind} className={s.tlLegendChip}>
          <span className={`${s.tlLegendDot} ${i.dotCls}`} />
          {i.label} <span className={s.tlLegendCount}>{i.count}</span>
        </span>
      ))}
    </div>
  )
}
