import { useEffect, useMemo, useState, useRef } from 'react'
import { supabase } from '../../../../lib/supabase'
import { sanitizeHtml, escapeHtml, isInternalEmail } from '../../../../lib/autodraft'
import styles from './SenderTimeline.module.css'

// =============================================================================
// Type-classificatie — kleur-gecodeerde labels.
//
// V9.4: mail-invites (is_calendar_invite=true) worden NIET getoond in de
// tijdlijn — de accept/decline-status van een Outlook-invite is afval voor
// dit overzicht. Wel zichtbaar: echte calendar_events (type 'meeting',
// rechts uitgelijnd als chat-bubble om visueel onderscheid te maken).
// =============================================================================
const TYPES = {
  meeting:  { label: 'Meeting',       cls: 'typeMeeting',  icon: '🗓' },
  note:     { label: 'HubSpot-note',  cls: 'typeNote',     icon: '📝' },
  intern:   { label: 'Intern',        cls: 'typeIntern',   icon: '🏢' },
  twoway:   { label: 'Heen-en-weer',  cls: 'typeTwoway',   icon: '↔' },
  incoming: { label: 'Inkomend',      cls: 'typeIncoming', icon: '←' },
  outgoing: { label: 'Verzonden',     cls: 'typeOutgoing', icon: '→' },
}

function classifyThread(thread) {
  if (isInternalEmail(thread.latest_from_email)) return 'intern'
  if ((thread.incoming_count || 0) > 0 && (thread.outgoing_count || 0) > 0) return 'twoway'
  if ((thread.incoming_count || 0) === 0) return 'outgoing'
  return 'incoming'
}

/**
 * SenderTimeline — cross-conversation history per afzender.
 *
 * V9.3 (2026-05-18): + calendar events via get_sender_events. Filter-chips
 * (Alles / Mails / Meetings) en maand-collapsibility (laatste 3 maanden
 * default open, oudere maanden collapsed) tegen oneindige scroll.
 * V9.2: type-classificatie + agenda apart + maand-headers + legenda.
 * V9.1: RPC get_sender_history ipv prop-merging.
 */
export default function SenderTimeline({ mail, hubspotContactId = null }) {
  const [mode, setMode] = useState('cards')
  const [filter, setFilter] = useState('all') // 'all' | 'mails' | 'events'
  const [showNotes, setShowNotes] = useState(false) // V9.6: opt-in HubSpot notes
  const [openIds, setOpenIds] = useState(() => new Set())
  const [bodies, setBodies] = useState({})

  // Data
  const [threads, setThreads] = useState([])
  const [events, setEvents] = useState([])
  const [notes, setNotes] = useState([])
  const [loadingMails, setLoadingMails] = useState(false)
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [loadingNotes, setLoadingNotes] = useState(false)
  const [error, setError] = useState(null)

  // Maand-collapse state — auto-init in useEffect verderop
  const [expandedMonths, setExpandedMonths] = useState(() => new Set())
  const initRef = useRef(false)

  // ===== Fetch mail-threads =====
  useEffect(() => {
    if (!mail.from_email) { setThreads([]); return }
    let cancelled = false
    setLoadingMails(true)
    supabase
      .rpc('get_sender_history', {
        p_from_email: mail.from_email,
        p_exclude_conversation_id: mail.conversation_id || null,
      })
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) setError(prev => prev || (e.message || 'RPC mails failed'))
        else setThreads(Array.isArray(data) ? data : [])
        setLoadingMails(false)
      })
    return () => { cancelled = true }
  }, [mail.from_email, mail.conversation_id])

  // ===== Fetch calendar-events =====
  useEffect(() => {
    if (!mail.from_email) { setEvents([]); return }
    let cancelled = false
    setLoadingEvents(true)
    supabase
      .rpc('get_sender_events', { p_from_email: mail.from_email, p_lookback_days: 730 })
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) setError(prev => prev || (e.message || 'RPC events failed'))
        else setEvents(Array.isArray(data) ? data : [])
        setLoadingEvents(false)
      })
    return () => { cancelled = true }
  }, [mail.from_email])

  // ===== Fetch HubSpot-notes (alleen als toggle aan + contact-id beschikbaar) =====
  useEffect(() => {
    if (!showNotes || !hubspotContactId) { setNotes([]); return }
    let cancelled = false
    setLoadingNotes(true)
    supabase
      .rpc('get_contact_notes', { p_hubspot_contact_id: hubspotContactId, p_lookback_days: 730 })
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) setError(prev => prev || (e.message || 'RPC notes failed'))
        else setNotes(Array.isArray(data) ? data : [])
        setLoadingNotes(false)
      })
    return () => { cancelled = true }
  }, [showNotes, hubspotContactId])

  const loading = loadingMails || loadingEvents || loadingNotes

  // ===== Items mergen + filteren =====
  // V9.4: mail-invites (latest_is_calendar_invite=true) worden uitgefilterd.
  // Een mail die alleen een Outlook-uitnodiging is bevat geen relevante context
  // voor de tijdlijn — het echte event verschijnt al via get_sender_events.
  const visibleThreads = useMemo(
    () => threads.filter(t => !t.latest_is_calendar_invite),
    [threads]
  )
  const items = useMemo(() => {
    const showMails = filter === 'all' || filter === 'mails'
    const showEvents = filter === 'all' || filter === 'events'
    const showNoteItems = (filter === 'all' || filter === 'notes') && showNotes
    const mailItems = showMails ? visibleThreads.map(t => ({
      kind: 'mail', sort_date: t.latest_received_at, _key: 'm-' + t.conversation_id, ...t,
    })) : []
    const eventItems = showEvents ? events.map(e => ({
      kind: 'event', sort_date: e.start_time, _key: 'e-' + e.event_id, ...e,
    })) : []
    const noteItems = showNoteItems ? notes.map(n => ({
      kind: 'note', sort_date: n.hs_timestamp, _key: 'n-' + n.engagement_id, ...n,
    })) : []
    return [...mailItems, ...eventItems, ...noteItems]
      .filter(x => x.sort_date)
      .sort((a, b) => new Date(b.sort_date) - new Date(a.sort_date))
  }, [visibleThreads, events, notes, filter, showNotes])

  // ===== Groepering: virtuele "Komende meetings" + maand-groepen =====
  // V9.5: toekomstige events worden uit de maand-flow gesplitst en bovenaan
  // gezet als virtuele "Komende meetings"-sectie. Default ingeklapt zodat het
  // verleden de eye-catcher blijft — komende meetings zijn wel relevant maar
  // niet de hoofdvraag bij "wat had ik met deze persoon".
  const grouped = useMemo(() => {
    const now = new Date()
    const upcoming = []
    const monthMap = new Map()
    for (const item of items) {
      const d = new Date(item.sort_date)
      if (item.kind === 'event' && d > now) {
        upcoming.push(item)
        continue
      }
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!monthMap.has(key)) {
        const label = d.toLocaleString('nl-NL', { month: 'long', year: 'numeric' })
        monthMap.set(key, {
          key,
          label: label.charAt(0).toUpperCase() + label.slice(1),
          items: [],
          mailCount: 0,
          eventCount: 0,
          isUpcoming: false,
        })
      }
      const g = monthMap.get(key)
      g.items.push(item)
      if (item.kind === 'event') g.eventCount++
      else if (item.kind === 'note') g.noteCount = (g.noteCount || 0) + 1
      else g.mailCount++
    }
    const months = Array.from(monthMap.values())
    if (upcoming.length === 0) return months
    return [{
      key: '__upcoming__',
      label: 'Komende meetings',
      items: upcoming.sort((a, b) => new Date(a.sort_date) - new Date(b.sort_date)),
      mailCount: 0,
      eventCount: upcoming.length,
      isUpcoming: true,
    }, ...months]
  }, [items])

  // ===== Auto-expand: alleen huidige maand bij eerste data-load =====
  // Komende meetings blijven dicht (te veel ruimte voor "later"). Oudere
  // maanden blijven dicht (je klapt zelf open als je verder terug wil).
  useEffect(() => {
    if (initRef.current || grouped.length === 0) return
    const now = new Date()
    const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const months = grouped.filter(g => !g.isUpcoming)
    const next = new Set()
    if (months.some(g => g.key === currentKey)) next.add(currentKey)
    else if (months[0]) next.add(months[0].key) // fallback: meest-recente maand
    setExpandedMonths(next)
    initRef.current = true
  }, [grouped])

  function toggleMonth(key) {
    setExpandedMonths(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleOpen(id) {
    setOpenIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Lazy body-fetch alleen voor mail-items (events hebben body_preview al uit RPC)
  useEffect(() => {
    const toFetch = Array.from(openIds).filter(id => !bodies[id] && !id.startsWith('e-'))
    if (toFetch.length === 0) return
    let cancelled = false
    async function run() {
      for (const id of toFetch) {
        try {
          const { data } = await supabase
            .from('mail_messages')
            .select('body_html, body_text, body_preview, body_truncated')
            .eq('id', id).maybeSingle()
          if (cancelled) return
          setBodies(prev => ({ ...prev, [id]: data || { _empty: true } }))
        } catch {
          if (!cancelled) setBodies(prev => ({ ...prev, [id]: { _error: true } }))
        }
      }
    }
    run()
    return () => { cancelled = true }
  }, [openIds, bodies])

  // ===== Totalen voor header =====
  const totalThreads = visibleThreads.length
  const totalEvents = events.length
  const totalNotes = notes.length
  const totalMailMessages = useMemo(
    () => visibleThreads.reduce((sum, t) => sum + (t.thread_count || 1), 0), [visibleThreads]
  )

  // ===== Render-takken =====
  if (loading && threads.length === 0 && events.length === 0) {
    return (
      <div className={styles.empty}>
        <LoadingGraphic />
        <div className={styles.emptyTitle}>Tijdlijn ophalen…</div>
        <div className={styles.emptySub}>Mails én meetings voor deze afzender.</div>
      </div>
    )
  }
  if (error && threads.length === 0 && events.length === 0) {
    return (
      <div className={styles.empty}>
        <ErrorGraphic />
        <div className={styles.emptyTitle}>Kon de tijdlijn niet ophalen</div>
        <code className={styles.emptyError}>{error}</code>
      </div>
    )
  }
  if (totalThreads === 0 && totalEvents === 0) {
    return (
      <div className={styles.empty}>
        <EmptyGraphic />
        <div className={styles.emptyTitle}>Nog geen eerdere contact-historie</div>
        <div className={styles.emptySub}>
          Met <strong>{mail.from_name || mail.from_email}</strong> is dit (buiten de
          huidige conversatie) de eerste keer dat we contact zien — geen mails én
          geen meetings.
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div className={styles.headInfo}>
          <span className={styles.headName}>{mail.from_name || mail.from_email}</span>
          {mail.from_name && mail.from_email && (
            <span className={styles.headEmail}>{mail.from_email}</span>
          )}
          <span className={styles.headStats}>
            {totalThreads} {totalThreads === 1 ? 'conversatie' : 'conversaties'} · {totalMailMessages} mails
            {totalEvents > 0 && <> · {totalEvents} {totalEvents === 1 ? 'meeting' : 'meetings'}</>}
            {' · huidige thread niet meegerekend'}
          </span>
        </div>
        <StyleToggle mode={mode} setMode={setMode} />
      </div>

      <FilterChips
        filter={filter} setFilter={setFilter}
        mailCount={totalThreads} eventCount={totalEvents}
        noteCount={totalNotes} notesEnabled={showNotes}
      />

      {hubspotContactId && (
        <NotesToggle
          enabled={showNotes}
          setEnabled={setShowNotes}
          count={totalNotes}
          loading={loadingNotes}
        />
      )}

      {grouped.map(group => (
        <GroupSection
          key={group.key}
          group={group}
          mode={mode}
          expanded={expandedMonths.has(group.key)}
          onToggle={() => toggleMonth(group.key)}
          openIds={openIds}
          bodies={bodies}
          toggleOpen={toggleOpen}
        />
      ))}

      <Legend />
    </div>
  )
}

// =============================================================================
// Subcomponents
// =============================================================================

function FilterChips({ filter, setFilter, mailCount, eventCount, noteCount, notesEnabled }) {
  const baseOptions = [
    { value: 'all',    label: 'Alles',     count: mailCount + eventCount + (notesEnabled ? noteCount : 0) },
    { value: 'mails',  label: 'Mails',     count: mailCount },
    { value: 'events', label: 'Meetings',  count: eventCount },
  ]
  // Notes-chip alleen tonen als notes-toggle aan staat (anders verwarrend)
  const options = notesEnabled
    ? [...baseOptions, { value: 'notes', label: 'Notes', count: noteCount }]
    : baseOptions
  return (
    <div className={styles.filterRow}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          className={`${styles.filterChip} ${filter === o.value ? styles.filterChipActive : ''}`}
          onClick={() => setFilter(o.value)}
          disabled={o.count === 0 && o.value !== 'all'}
        >
          {o.label}
          <span className={styles.filterChipCount}>{o.count}</span>
        </button>
      ))}
    </div>
  )
}

function NotesToggle({ enabled, setEnabled, count, loading }) {
  return (
    <div className={styles.notesToggle}>
      <label className={styles.notesToggleLabel}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className={styles.notesToggleInput}
        />
        <span className={styles.notesToggleIcon}>📝</span>
        <span className={styles.notesToggleText}>
          <strong>HubSpot-notes</strong> tonen in tijdlijn
        </span>
        {enabled && (
          <span className={styles.notesToggleStatus}>
            {loading ? 'laden…' : `${count} ${count === 1 ? 'note' : 'notes'}`}
          </span>
        )}
      </label>
      <span className={styles.notesToggleHint}>
        Standaard uit zodat de tijdlijn niet overspoeld wordt — zet aan voor extra context.
      </span>
    </div>
  )
}

function GroupSection({ group, mode, expanded, onToggle, openIds, bodies, toggleOpen }) {
  const isUpcoming = group.isUpcoming
  const sectionCls = [
    mode === 'rail' ? styles.railSection : styles.section,
    isUpcoming ? styles.sectionUpcoming : '',
  ].filter(Boolean).join(' ')
  const headCls = [
    mode === 'rail' ? styles.railSectionHead : styles.sectionHead,
    isUpcoming ? styles.sectionHeadUpcoming : '',
  ].filter(Boolean).join(' ')
  return (
    <section className={sectionCls}>
      <button
        type="button"
        onClick={onToggle}
        className={headCls}
        aria-expanded={expanded}
      >
        <Chev open={expanded} className={styles.sectionChev} />
        {isUpcoming && <span className={styles.upcomingIcon} aria-hidden="true">⏭</span>}
        <h3 className={styles.sectionTitle}>{group.label}</h3>
        <span className={styles.sectionRule} aria-hidden="true" />
        <span className={styles.sectionCount}>
          {isUpcoming ? (
            <>{group.eventCount} {group.eventCount === 1 ? 'meeting gepland' : 'meetings gepland'}</>
          ) : (
            <>
              {group.mailCount > 0 && <>{group.mailCount} mail{group.mailCount === 1 ? '' : 's'}</>}
              {group.mailCount > 0 && group.eventCount > 0 && ' · '}
              {group.eventCount > 0 && <>{group.eventCount} meeting{group.eventCount === 1 ? '' : 's'}</>}
              {(group.noteCount || 0) > 0 && (
                <>{(group.mailCount > 0 || group.eventCount > 0) && ' · '}{group.noteCount} note{group.noteCount === 1 ? '' : 's'}</>
              )}
            </>
          )}
        </span>
      </button>
      {expanded && (
        <div className={mode === 'rail' ? styles.rail : styles.cardList}>
          {group.items.map(item => {
            const itemId = item.kind === 'mail' ? item.latest_mail_id : item._key
            return (
              <ItemRenderer
                key={item._key}
                item={item}
                mode={mode}
                isOpen={openIds.has(itemId)}
                body={item.kind === 'mail' ? bodies[item.latest_mail_id] : null}
                onClick={() => toggleOpen(itemId)}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}

function ItemRenderer({ item, mode, isOpen, body, onClick }) {
  if (item.kind === 'event') {
    return mode === 'rail'
      ? <EventRail event={item} isOpen={isOpen} onClick={onClick} />
      : <EventCard event={item} isOpen={isOpen} onClick={onClick} />
  }
  if (item.kind === 'note') {
    return mode === 'rail'
      ? <NoteRail note={item} isOpen={isOpen} onClick={onClick} />
      : <NoteCard note={item} isOpen={isOpen} onClick={onClick} />
  }
  return mode === 'rail'
    ? <RailItem thread={item} isOpen={isOpen} body={body} onClick={onClick} />
    : <Card thread={item} isOpen={isOpen} body={body} onClick={onClick} />
}

// ===== Mail-thread items =====

function Card({ thread, isOpen, body, onClick }) {
  const type = classifyThread(thread)
  const typeCfg = TYPES[type]
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.card} ${styles[typeCfg.cls]} ${isOpen ? styles.cardOpen : ''}`}
      aria-expanded={isOpen}
    >
      <div className={styles.cardTop}>
        <span className={styles.cardDate}>{formatDayShort(thread.latest_received_at)}</span>
        <TypeBadge type={type} />
        {thread.thread_count > 1 && (
          <span className={styles.badge} title={`${thread.incoming_count} ontvangen · ${thread.outgoing_count} verzonden`}>
            {thread.thread_count} in thread
          </span>
        )}
        {thread.latest_flag_status === 'flagged' && (
          <span className={`${styles.badge} ${styles.badgeFlagged}`}>★</span>
        )}
        {thread.latest_has_attachments && (
          <span className={styles.badge} title="Bevat bijlagen">📎</span>
        )}
        <Chev open={isOpen} />
      </div>
      <div className={styles.cardSubject}>{thread.latest_subject || '(geen onderwerp)'}</div>
      {thread.latest_body_preview && !isOpen && (
        <div className={styles.cardPreview}>{thread.latest_body_preview}</div>
      )}
      {isOpen && <BodyBlock body={body} fallbackPreview={thread.latest_body_preview} />}
    </button>
  )
}

function RailItem({ thread, isOpen, body, onClick }) {
  const type = classifyThread(thread)
  const typeCfg = TYPES[type]
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.railItem} ${styles[typeCfg.cls]} ${isOpen ? styles.railItemOpen : ''}`}
      aria-expanded={isOpen}
    >
      <div className={styles.railTop}>
        <span className={styles.cardDate}>{formatDayShort(thread.latest_received_at)}</span>
        <TypeBadge type={type} />
        {thread.thread_count > 1 && (
          <span className={styles.badge}>{thread.thread_count} in thread</span>
        )}
        {thread.latest_flag_status === 'flagged' && (
          <span className={`${styles.badge} ${styles.badgeFlagged}`}>★</span>
        )}
        {thread.latest_has_attachments && (
          <span className={styles.badge}>📎</span>
        )}
        <Chev open={isOpen} />
      </div>
      <div className={styles.railSubject}>{thread.latest_subject || '(geen onderwerp)'}</div>
      {thread.latest_body_preview && !isOpen && (
        <div className={styles.railPreview}>{thread.latest_body_preview}</div>
      )}
      {isOpen && <BodyBlock body={body} fallbackPreview={thread.latest_body_preview} />}
    </button>
  )
}

// ===== Event items =====

function EventCard({ event, isOpen, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.card} ${styles.typeMeeting} ${styles.cardEvent} ${isOpen ? styles.cardOpen : ''}`}
      aria-expanded={isOpen}
    >
      <div className={styles.cardTop}>
        <span className={styles.cardDate}>{formatDayShort(event.start_time)}</span>
        <TypeBadge type="meeting" />
        <ResponseBadge event={event} />
        {event.has_fireflies && (
          <span className={`${styles.badge} ${styles.badgeFireflies}`} title="Fireflies-transcript beschikbaar">
            🎙 Transcript
          </span>
        )}
        <Chev open={isOpen} />
      </div>
      <div className={styles.cardSubject}>{event.subject || '(geen onderwerp)'}</div>
      <EventMeta event={event} />
      {isOpen && <EventBody event={event} />}
    </button>
  )
}

function EventRail({ event, isOpen, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.railItem} ${styles.typeMeeting} ${styles.railItemEvent} ${isOpen ? styles.railItemOpen : ''}`}
      aria-expanded={isOpen}
    >
      <div className={styles.railTop}>
        <span className={styles.cardDate}>{formatDayShort(event.start_time)}</span>
        <TypeBadge type="meeting" />
        <ResponseBadge event={event} />
        {event.has_fireflies && (
          <span className={`${styles.badge} ${styles.badgeFireflies}`}>🎙</span>
        )}
        <Chev open={isOpen} />
      </div>
      <div className={styles.railSubject}>{event.subject || '(geen onderwerp)'}</div>
      <EventMeta event={event} />
      {isOpen && <EventBody event={event} />}
    </button>
  )
}

function EventMeta({ event }) {
  const startStr = formatEventTime(event.start_time, event.end_time, event.is_all_day)
  return (
    <div className={styles.eventMeta}>
      <span className={styles.eventMetaItem}>🕐 {startStr}</span>
      {event.attendees_count > 0 && (
        <span className={styles.eventMetaItem}>
          👥 {event.attendees_count} {event.attendees_count === 1 ? 'deelnemer' : 'deelnemers'}
        </span>
      )}
      {event.location_text && (
        <span className={styles.eventMetaItem} title={event.location_text}>
          📍 {truncate(event.location_text, 40)}
        </span>
      )}
      {event.online_meeting_url && (
        <span className={styles.eventMetaItem}>💻 Online</span>
      )}
      {event.was_organized_by_them && (
        <span className={styles.eventMetaItem}>👤 Door hen gepland</span>
      )}
    </div>
  )
}

function EventBody({ event }) {
  return (
    <div className={styles.body} onClick={(e) => e.stopPropagation()}>
      {event.body_preview ? (
        <pre className={styles.bodyPre}>{event.body_preview}</pre>
      ) : (
        <div className={styles.bodyEmpty}>Geen omschrijving in event.</div>
      )}
      {event.online_meeting_url && (
        <div className={styles.eventLinkRow}>
          <a href={event.online_meeting_url} target="_blank" rel="noreferrer"
             onClick={(e) => e.stopPropagation()} className={styles.eventLink}>
            Open Teams/Online link ↗
          </a>
        </div>
      )}
    </div>
  )
}

function NoteCard({ note, isOpen, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.card} ${styles.typeNote} ${styles.cardNote} ${isOpen ? styles.cardOpen : ''}`}
      aria-expanded={isOpen}
    >
      <div className={styles.cardTop}>
        <span className={styles.cardDate}>{formatDayShort(note.hs_timestamp)}</span>
        <TypeBadge type="note" />
        {note.associated_deal_ids?.length > 0 && (
          <span className={styles.badge} title={`Gekoppeld aan ${note.associated_deal_ids.length} deal(s)`}>
            💰 {note.associated_deal_ids.length}
          </span>
        )}
        <Chev open={isOpen} />
      </div>
      <div className={styles.cardSubject}>{note.subject || '(geen onderwerp)'}</div>
      {note.body_text && !isOpen && (
        <div className={styles.cardPreview}>{stripHtml(note.body_text)}</div>
      )}
      {isOpen && <NoteBody note={note} />}
    </button>
  )
}

function NoteRail({ note, isOpen, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${styles.railItem} ${styles.typeNote} ${styles.railItemNote} ${isOpen ? styles.railItemOpen : ''}`}
      aria-expanded={isOpen}
    >
      <div className={styles.railTop}>
        <span className={styles.cardDate}>{formatDayShort(note.hs_timestamp)}</span>
        <TypeBadge type="note" />
        {note.associated_deal_ids?.length > 0 && (
          <span className={styles.badge}>💰 {note.associated_deal_ids.length}</span>
        )}
        <Chev open={isOpen} />
      </div>
      <div className={styles.railSubject}>{note.subject || '(geen onderwerp)'}</div>
      {note.body_text && !isOpen && (
        <div className={styles.railPreview}>{stripHtml(note.body_text)}</div>
      )}
      {isOpen && <NoteBody note={note} />}
    </button>
  )
}

function NoteBody({ note }) {
  const clean = stripHtml(note.body_text)
  return (
    <div className={styles.body} onClick={(e) => e.stopPropagation()}>
      {clean ? (
        <pre className={styles.bodyPre}>{clean}</pre>
      ) : (
        <div className={styles.bodyEmpty}>(geen tekst in note)</div>
      )}
      {note.body_truncated && (
        <div className={styles.bodyTrunc}>⚠ Note ingekort — open HubSpot voor volledige tekst.</div>
      )}
    </div>
  )
}

function stripHtml(s) {
  if (!s) return ''
  // HubSpot notes komen vaak met <p>, <br>, <div> wrappers — strip die voor leesbaarheid.
  return s.replace(/<\/?(p|div|br|span|strong|em|b|i|u)[^>]*>/gi, ' ')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/\s+/g, ' ')
          .trim()
}

function ResponseBadge({ event }) {
  // response_status: accepted | tentativelyAccepted | declined | notResponded
  if (event.was_organized_by_them === false && event.is_organizer === true) {
    return <span className={`${styles.badge} ${styles.badgeSent}`}>Door jou gepland</span>
  }
  const r = event.response_status
  if (r === 'accepted') return <span className={`${styles.badge} ${styles.badgeSent}`}>✓ Geaccepteerd</span>
  if (r === 'tentativelyAccepted') return <span className={`${styles.badge} ${styles.badgePending}`}>? Misschien</span>
  if (r === 'declined') return <span className={`${styles.badge} ${styles.badgeFlagged}`}>✗ Afgewezen</span>
  if (r === 'organizer') return <span className={`${styles.badge} ${styles.badgeSent}`}>Door jou gepland</span>
  return null
}

// ===== Shared =====

function StyleToggle({ mode, setMode }) {
  return (
    <div className={styles.toggleGroup} role="tablist">
      <button type="button" role="tab" aria-selected={mode === 'cards'}
        className={`${styles.toggleBtn} ${mode === 'cards' ? styles.toggleBtnActive : ''}`}
        onClick={() => setMode('cards')}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="5" rx="1"/><rect x="3" y="11" width="18" height="5" rx="1"/><rect x="3" y="18" width="18" height="3" rx="1"/>
        </svg>
        Kaartjes
      </button>
      <button type="button" role="tab" aria-selected={mode === 'rail'}
        className={`${styles.toggleBtn} ${mode === 'rail' ? styles.toggleBtnActive : ''}`}
        onClick={() => setMode('rail')}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <line x1="6" y1="3" x2="6" y2="21"/><circle cx="6" cy="7" r="2" fill="currentColor"/><circle cx="6" cy="13" r="2" fill="currentColor"/><circle cx="6" cy="19" r="2" fill="currentColor"/>
          <line x1="10" y1="7" x2="20" y2="7"/><line x1="10" y1="13" x2="20" y2="13"/><line x1="10" y1="19" x2="20" y2="19"/>
        </svg>
        Tijdlijn
      </button>
    </div>
  )
}

function TypeBadge({ type }) {
  const cfg = TYPES[type] || TYPES.incoming
  return (
    <span className={`${styles.badge} ${styles.typeBadge} ${styles[cfg.cls]}`}>
      <span className={styles.typeBadgeIcon}>{cfg.icon}</span>
      {cfg.label}
    </span>
  )
}

function BodyBlock({ body, fallbackPreview }) {
  if (!body) return <div className={`${styles.body} ${styles.bodyLoading}`}>Body laden…</div>
  if (body._error) return <div className={`${styles.body} ${styles.bodyEmpty}`}>⚠ Kon body niet ophalen.</div>
  const hasHtml = !!body.body_html
  const hasText = !!body.body_text
  const preview = body.body_preview || fallbackPreview
  if (!hasHtml && !hasText && !preview) {
    return <div className={`${styles.body} ${styles.bodyEmpty}`}>(geen inhoud opgeslagen — open Outlook voor volledige tekst)</div>
  }
  return (
    <div className={styles.body} onClick={(e) => e.stopPropagation()}>
      {hasHtml ? (
        <div className={styles.bodyHtml} dangerouslySetInnerHTML={{ __html: sanitizeHtml(body.body_html) }} />
      ) : hasText ? (
        <pre className={styles.bodyPre} dangerouslySetInnerHTML={{ __html: escapeHtml(body.body_text) }} />
      ) : (
        <pre className={styles.bodyPre}>{preview}</pre>
      )}
      {body.body_truncated && (
        <div className={styles.bodyTrunc}>⚠ Body ingekort tot 200KB — open Outlook voor de volledige mail.</div>
      )}
    </div>
  )
}

function Legend() {
  return (
    <div className={styles.legend}>
      <span className={styles.legendTitle}>Legenda</span>
      {Object.entries(TYPES).map(([key, t]) => (
        <span key={key} className={styles.legendItem}>
          <span className={`${styles.legendDot} ${styles[t.cls]}`} />
          <span>{t.label}</span>
        </span>
      ))}
    </div>
  )
}

function Chev({ open, className }) {
  return (
    <svg
      className={`${styles.chev} ${open ? styles.chevOpen : ''} ${className || ''}`}
      viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  )
}

// ===== Format helpers =====

function formatDayShort(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('nl-NL', {
    weekday: 'short', day: '2-digit', month: 'short',
  })
}

function formatEventTime(start, end, isAllDay) {
  if (!start) return ''
  if (isAllDay) return 'Hele dag'
  const s = new Date(start)
  const fmt = (d) => d.toLocaleString('nl-NL', { hour: '2-digit', minute: '2-digit' })
  if (!end) return fmt(s)
  const e = new Date(end)
  return `${fmt(s)} – ${fmt(e)}`
}

function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1).trim() + '…' : s
}

// =============================================================================
// State-graphics
// =============================================================================

function EmptyGraphic() {
  return (
    <svg className={styles.graphic} width="140" height="140" viewBox="0 0 140 140" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="senderTimelineFadeOut" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor="currentColor" stopOpacity="0.7"/>
          <stop offset="100%" stopColor="currentColor" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <line x1="70" y1="20" x2="70" y2="110" stroke="url(#senderTimelineFadeOut)" strokeWidth="2" strokeDasharray="3 4" strokeLinecap="round" />
      <circle cx="70" cy="35" r="9" fill="var(--surface-1, #fff)" stroke="currentColor" strokeWidth="1.8" opacity="0.7"/>
      <circle cx="70" cy="65" r="9" fill="var(--surface-1, #fff)" stroke="currentColor" strokeWidth="1.8" opacity="0.5"/>
      <circle cx="70" cy="95" r="9" fill="var(--surface-1, #fff)" stroke="currentColor" strokeWidth="1.8" opacity="0.3"/>
      <g transform="translate(92, 90)" opacity="0.7">
        <rect x="0" y="0" width="32" height="22" rx="2.5" fill="var(--surface-2, #f5f4f0)" stroke="var(--accent, #dc6f3f)" strokeWidth="1.5"/>
        <path d="M0 3 L16 14 L32 3" fill="none" stroke="var(--accent, #dc6f3f)" strokeWidth="1.5" strokeLinejoin="round"/>
      </g>
    </svg>
  )
}

function LoadingGraphic() {
  return (
    <svg className={styles.graphic} width="140" height="80" viewBox="0 0 140 80" fill="none" aria-hidden="true">
      <line x1="20" y1="40" x2="120" y2="40" stroke="currentColor" strokeWidth="2" strokeDasharray="3 4" strokeLinecap="round" opacity="0.4"/>
      <circle cx="40" cy="40" r="8" fill="currentColor" opacity="0.3">
        <animate attributeName="opacity" values="0.3;0.9;0.3" dur="1.2s" repeatCount="indefinite"/>
      </circle>
      <circle cx="70" cy="40" r="8" fill="currentColor" opacity="0.3">
        <animate attributeName="opacity" values="0.3;0.9;0.3" dur="1.2s" begin="0.2s" repeatCount="indefinite"/>
      </circle>
      <circle cx="100" cy="40" r="8" fill="currentColor" opacity="0.3">
        <animate attributeName="opacity" values="0.3;0.9;0.3" dur="1.2s" begin="0.4s" repeatCount="indefinite"/>
      </circle>
    </svg>
  )
}

function ErrorGraphic() {
  return (
    <svg className={styles.graphic} width="120" height="120" viewBox="0 0 120 120" fill="none" aria-hidden="true">
      <path d="M60 20 L105 95 L15 95 Z" fill="var(--surface-2, #f5f4f0)" stroke="var(--accent, #dc6f3f)" strokeWidth="2.5" strokeLinejoin="round"/>
      <line x1="60" y1="48" x2="60" y2="75" stroke="var(--accent, #dc6f3f)" strokeWidth="3" strokeLinecap="round"/>
      <circle cx="60" cy="85" r="2.5" fill="var(--accent, #dc6f3f)"/>
    </svg>
  )
}
