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
              {item.kind === 'mail' && item.meta?.thread_count > 1 && (
                <span className={s.tlThreadBadge}>
                  thread · {item.meta.thread_count} berichten
                </span>
              )}
            </span>
            <span className={s.tlWhen}>{mailRangeLabel(item) || (item.ts ? fmtDate(item.ts) : '')}</span>
          </div>
          <div className={s.tlTitle}>
            {item.kind === 'note' ? cleanText(item.title) || '(geen titel)' : (item.title || '(geen titel)')}
          </div>
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
  const conversationId = item.meta?.conversation_id
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!conversationId) return
    let cancelled = false
    setLoading(true); setError(null)
    supabase.from('mail_messages')
      .select('id, subject, from_name, from_email, received_at, sent_at, body_text, body_preview, body_html, is_outbound, to_recipients')
      .eq('conversation_id', conversationId)
      .order('received_at', { ascending: true })
      .limit(50)
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) setError(e.message || 'kon thread niet ophalen')
        else setMessages(Array.isArray(data) ? data : [])
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [conversationId])

  if (loading) return <div className={s.tlExpandLoading}>Thread laden…</div>
  if (error) return <div className={s.tlExpandError}>{error}</div>
  if (messages.length === 0) {
    return <div className={s.tlExpand}><div className={s.tlExpandFoot}>Geen berichten gevonden in deze conversation.</div></div>
  }

  return (
    <div className={s.tlExpand}>
      <div className={s.tlExpandLbl}>
        Thread · {messages.length} bericht{messages.length === 1 ? '' : 'en'}
        {messages.length >= 2 && (
          <span style={{ fontWeight: 400, color: 'var(--neutral-500)', marginLeft: 6 }}>
            ({fmtRange(messages[0].received_at, messages[messages.length - 1].received_at)})
          </span>
        )}
      </div>
      <div className={s.threadMsgs}>
        {messages.map((msg, i) => (
          <ThreadMessage key={msg.id} msg={msg} index={i + 1} total={messages.length} />
        ))}
      </div>
    </div>
  )
}

function ThreadMessage({ msg, index, total }) {
  const text = msg.body_text || cleanText(msg.body_html || '') || msg.body_preview || '(geen body)'
  const outbound = !!msg.is_outbound
  const ts = msg.received_at || msg.sent_at
  return (
    <div className={`${s.threadMsg} ${outbound ? s.threadMsgOut : s.threadMsgIn}`}>
      <div className={s.threadMsgHead}>
        <span className={s.threadMsgIdx}>#{index}/{total}</span>
        <span className={s.threadMsgFrom}>
          {outbound ? '→' : '←'}{' '}
          <strong>{msg.from_name || msg.from_email || '?'}</strong>
        </span>
        <span className={s.threadMsgWhen}>{ts ? fmtDate(ts) : ''}</span>
      </div>
      {msg.subject && index === 1 && (
        <div className={s.threadMsgSubj}>{msg.subject}</div>
      )}
      <pre className={s.threadMsgBody}>{text}</pre>
    </div>
  )
}

function fmtRange(first, last) {
  if (!first || !last) return ''
  const a = fmtDate(first)
  const b = fmtDate(last)
  if (a === b) return a
  return `${a} → ${b}`
}

// Range-label voor mail-thread in collapsed view (eerste → laatste contact).
function mailRangeLabel(item) {
  if (item.kind !== 'mail') return null
  const first = item.meta?.thread_first_at
  const last = item.meta?.thread_latest_at
  if (!first || !last || first === last) return null
  const a = fmtDate(first); const b = fmtDate(last)
  return a === b ? a : `${a} → ${b}`
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
