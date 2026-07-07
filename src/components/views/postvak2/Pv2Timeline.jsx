import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import Ic from './pv2Icons'
import { Pv2Avatar } from './Pv2Row'
import { msgTime, recipientEmails } from './pv2lib'

/* Pv2Timeline — tweezijdige tijdlijn-modal (design: .tl2): mails/threads
 * links, agenda & afspraken rechts. Data uit dezelfde RPC's als variant 1:
 * get_sender_history (threads van de afzender) + get_sender_events
 * (Outlook-agenda-events waar de afzender bij zat). */

function monthKey(iso) {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthLabel(iso) {
  const s = new Date(iso).toLocaleString('nl-NL', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}
function timeOf(iso) {
  return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
}

export default function Pv2Timeline({ mail, catAccent, onClose }) {
  const [threads, setThreads] = useState(null)
  const [events, setEvents] = useState(null)
  const [open, setOpen] = useState({})
  const [err, setErr] = useState(null)

  // Bij awaiting-rijen (eigen verzonden mail) is from_email het ontvanger-
  // label — de tijdlijn hoort dan over de geadresseerde te gaan.
  const personEmail = mail?.__awaiting
    ? (recipientEmails(mail.to_recipients)[0]?.email || '')
    : (mail?.from_email || '')

  useEffect(() => {
    if (!personEmail) { setThreads([]); setEvents([]); return undefined }
    let cancel = false
    supabase.rpc('get_sender_history', {
      p_from_email: personEmail,
      p_exclude_conversation_id: mail.conversation_id || null,
    }).then(({ data, error }) => {
      if (cancel) return
      if (error) setErr(error.message)
      setThreads(Array.isArray(data) ? data.filter(t => !t.latest_is_calendar_invite) : [])
    })
    supabase.rpc('get_sender_events', { p_from_email: personEmail, p_lookback_days: 730 })
      .then(({ data, error }) => {
        if (cancel) return
        if (error) setErr(e => e || error.message)
        setEvents(Array.isArray(data) ? data : [])
      })
    return () => { cancel = true }
  }, [personEmail, mail?.conversation_id])

  const loading = threads === null || events === null

  const groups = useMemo(() => {
    const items = []
    for (const t of (threads || [])) {
      if (!t.latest_received_at) continue
      items.push({
        kind: t.thread_count > 1 ? 'thread' : 'mail', side: 'left',
        sort: t.latest_received_at, ev: catAccent || 'var(--c-overig)',
        title: t.latest_subject || '(geen onderwerp)',
        who: `${t.thread_count} ${t.thread_count > 1 ? 'berichten' : 'bericht'} · ${t.latest_from_name || t.latest_from_email || ''}`,
        snip: (t.latest_body_preview || '').slice(0, 160),
        time: timeOf(t.latest_received_at),
        key: 'm-' + t.conversation_id,
        expandable: !!t.latest_body_preview,
        preview: t.latest_body_preview || '',
        from: t.latest_from_name || t.latest_from_email,
        fromEmail: t.latest_from_email,
      })
    }
    const now = Date.now()
    for (const e of (events || [])) {
      if (!e.start_time) continue
      const future = new Date(e.start_time).getTime() > now
      items.push({
        kind: future ? 'afspraak' : 'agenda', side: 'right',
        sort: e.start_time, ev: future ? 'var(--c-partner)' : 'var(--c-plan)',
        title: e.subject || '(geen titel)',
        who: [e.is_all_day ? 'hele dag' : timeOf(e.start_time), e.location_text, e.online_meeting_url ? 'online' : null].filter(Boolean).join(' · '),
        snip: e.organizer_name ? `Organisator: ${e.organizer_name} · ${e.attendees_count || 0} deelnemers` : '',
        time: timeOf(e.start_time),
        key: 'e-' + e.event_id,
        expandable: false,
      })
    }
    items.sort((a, b) => new Date(b.sort) - new Date(a.sort))
    const map = new Map()
    for (const it of items) {
      const k = monthKey(it.sort)
      if (!map.has(k)) map.set(k, { key: k, label: monthLabel(it.sort), items: [] })
      map.get(k).items.push(it)
    }
    return Array.from(map.values())
  }, [threads, events, catAccent])

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-tl" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-ico"><Ic n="history" s={18}/></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="modal-title">Tijdlijn</div>
            <div className="modal-sub">{mail.__awaiting ? personEmail : (mail.from_name || mail.from_email)} · mails links, agenda &amp; afspraken rechts</div>
          </div>
          <button className="modal-close" onClick={onClose}><Ic n="x" s={15}/></button>
        </div>
        <div className="modal-body tl2-body">
          <div className="tl2-legend">
            <span className="tl2-leg"><span className="d" style={{ background: catAccent || 'var(--c-overig)' }}/>Mail / thread</span>
            <span className="tl2-leg"><span className="d" style={{ background: 'var(--c-plan)' }}/>Agenda</span>
            <span className="tl2-leg"><span className="d" style={{ background: 'var(--c-partner)' }}/>Komende afspraak</span>
          </div>
          {loading ? (
            <div className="rag-empty">Tijdlijn laden…</div>
          ) : err && groups.length === 0 ? (
            <div className="rag-empty">Tijdlijn laden mislukt: {err}</div>
          ) : groups.length === 0 ? (
            <div className="rag-empty">Geen eerdere mails of afspraken met {personEmail || 'deze persoon'}.</div>
          ) : (
            <div className="tl2">
              {groups.map(g => (
                <div key={g.key}>
                  <div className="tl2-day"><span>{g.label}</span></div>
                  {g.items.map(it => {
                    const isOpen = !!open[it.key]
                    return (
                      <div key={it.key} className={`tl2-item ${it.side}`} style={{ '--ev': it.ev }}>
                        <span className="tl2-dot"/>
                        <div className={`tl2-card ${it.expandable ? 'tl2-card--exp' : ''} ${isOpen ? 'is-open' : ''}`}
                             onClick={() => it.expandable && setOpen(o => ({ ...o, [it.key]: !o[it.key] }))}>
                          <div className="tl2-cardtop">
                            <span className="tl2-kind">{it.kind}</span>
                            <span className="tl2-when">{msgTime(it.sort)}</span>
                            {it.expandable && (
                              <span className="tl2-chev" style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }}>
                                <Ic n="chev" s={13}/>
                              </span>
                            )}
                          </div>
                          <div className="tl2-title">{it.title}</div>
                          {it.snip && !isOpen && <div className="tl2-snip">{it.snip}</div>}
                          <div className="tl2-who">{it.who}</div>
                          {it.expandable && isOpen && (
                            <div className="tl2-thread" onClick={e => e.stopPropagation()}>
                              <div className="tl2-msg">
                                <div className="tl2-msg-head">
                                  <Pv2Avatar name={it.from} email={it.fromEmail} size={20}/>
                                  <span className="tl2-msg-name">{it.from}</span>
                                  <span className="tl2-msg-time">{msgTime(it.sort)}</span>
                                </div>
                                <div className="tl2-msg-body"><p>{it.preview}</p></div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
