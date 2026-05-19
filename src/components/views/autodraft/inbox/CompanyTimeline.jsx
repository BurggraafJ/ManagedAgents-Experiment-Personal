import { useEffect, useMemo, useState, useRef } from 'react'
import { supabase } from '../../../../lib/supabase'
import { sanitizeHtml, escapeHtml, isInternalEmail } from '../../../../lib/autodraft'
import styles from './SenderTimeline.module.css'

// =============================================================================
// CompanyTimeline — variant van SenderTimeline maar voor een HubSpot-company.
//
// Data: get_company_mails, get_company_events, get_company_notes (V9.8 RPCs).
// Verschil met SenderTimeline:
//   - Input is hubspot_company_id ipv from_email
//   - Per item: attribution-badge "via <contact>" zodat duidelijk is wie van
//     de company betrokken was
//   - HubSpot-notes default zichtbaar (op company-niveau is dat de hoofdbron)
//
// Type-classificatie hergebruikt grotendeels SenderTimeline-stijl. Mail-items
// krijgen attribution_emails-array + latest_via_email die in de UI tot een
// "via Pieter S." badge worden gerendered.
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

export default function CompanyTimeline({ company }) {
  const companyId = company?.company_id || company?.hubspot_company_id
  const companyName = company?.name || '—'

  const [mode, setMode] = useState('cards')
  const [filter, setFilter] = useState('all')
  const [showNotes, setShowNotes] = useState(true) // default AAN op company-niveau (hoofdbron)
  const [openIds, setOpenIds] = useState(() => new Set())
  const [bodies, setBodies] = useState({})

  const [threads, setThreads] = useState([])
  const [events, setEvents] = useState([])
  const [notes, setNotes] = useState([])
  const [loadingMails, setLoadingMails] = useState(false)
  const [loadingEvents, setLoadingEvents] = useState(false)
  const [loadingNotes, setLoadingNotes] = useState(false)
  const [error, setError] = useState(null)

  const [expandedMonths, setExpandedMonths] = useState(() => new Set())
  const initRef = useRef(false)

  // ===== Fetch mails =====
  useEffect(() => {
    if (!companyId) { setThreads([]); return }
    let cancelled = false
    setLoadingMails(true)
    initRef.current = false // reset auto-expand bij wisselen company
    supabase
      .rpc('get_company_mails', { p_hubspot_company_id: companyId, p_exclude_conversation_id: null })
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) setError(prev => prev || (e.message || 'RPC company-mails failed'))
        else setThreads(Array.isArray(data) ? data : [])
        setLoadingMails(false)
      })
    return () => { cancelled = true }
  }, [companyId])

  // ===== Fetch events =====
  useEffect(() => {
    if (!companyId) { setEvents([]); return }
    let cancelled = false
    setLoadingEvents(true)
    supabase
      .rpc('get_company_events', { p_hubspot_company_id: companyId, p_lookback_days: 730 })
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) setError(prev => prev || (e.message || 'RPC company-events failed'))
        else setEvents(Array.isArray(data) ? data : [])
        setLoadingEvents(false)
      })
    return () => { cancelled = true }
  }, [companyId])

  // ===== Fetch notes (default aan!) =====
  useEffect(() => {
    if (!companyId || !showNotes) { setNotes([]); return }
    let cancelled = false
    setLoadingNotes(true)
    supabase
      .rpc('get_company_notes', { p_hubspot_company_id: companyId, p_lookback_days: 730 })
      .then(({ data, error: e }) => {
        if (cancelled) return
        if (e) setError(prev => prev || (e.message || 'RPC company-notes failed'))
        else setNotes(Array.isArray(data) ? data : [])
        setLoadingNotes(false)
      })
    return () => { cancelled = true }
  }, [companyId, showNotes])

  const loading = loadingMails || loadingEvents || loadingNotes

  // Filter mail-invites uit (V9.4: afval)
  const visibleThreads = useMemo(
    () => threads.filter(t => !t.latest_is_calendar_invite),
    [threads]
  )

  const items = useMemo(() => {
    const showMails = filter === 'all' || filter === 'mails'
    const showEventsF = filter === 'all' || filter === 'events'
    const showNotesF = (filter === 'all' || filter === 'notes') && showNotes
    const mailItems = showMails ? visibleThreads.map(t => ({
      kind: 'mail', sort_date: t.latest_received_at, _key: 'm-' + t.conversation_id, ...t,
    })) : []
    const eventItems = showEventsF ? events.map(e => ({
      kind: 'event', sort_date: e.start_time, _key: 'e-' + e.event_id, ...e,
    })) : []
    const noteItems = showNotesF ? notes.map(n => ({
      kind: 'note', sort_date: n.hs_timestamp, _key: 'n-' + n.engagement_id, ...n,
    })) : []
    return [...mailItems, ...eventItems, ...noteItems]
      .filter(x => x.sort_date)
      .sort((a, b) => new Date(b.sort_date) - new Date(a.sort_date))
  }, [visibleThreads, events, notes, filter, showNotes])

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
          key, label: label.charAt(0).toUpperCase() + label.slice(1),
          items: [], mailCount: 0, eventCount: 0, noteCount: 0, isUpcoming: false,
        })
      }
      const g = monthMap.get(key)
      g.items.push(item)
      if (item.kind === 'event') g.eventCount++
      else if (item.kind === 'note') g.noteCount++
      else g.mailCount++
    }
    const months = Array.from(monthMap.values())
    if (upcoming.length === 0) return months
    return [{
      key: '__upcoming__', label: 'Komende meetings',
      items: upcoming.sort((a, b) => new Date(a.sort_date) - new Date(b.sort_date)),
      mailCount: 0, eventCount: upcoming.length, noteCount: 0, isUpcoming: true,
    }, ...months]
  }, [items])

  useEffect(() => {
    if (initRef.current || grouped.length === 0) return
    const now = new Date()
    const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const months = grouped.filter(g => !g.isUpcoming)
    const next = new Set()
    if (months.some(g => g.key === currentKey)) next.add(currentKey)
    else if (months[0]) next.add(months[0].key)
    setExpandedMonths(next)
    initRef.current = true
  }, [grouped])

  function toggleMonth(key) {
    setExpandedMonths(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }
  function toggleOpen(id) {
    setOpenIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  useEffect(() => {
    const toFetch = Array.from(openIds).filter(id => !bodies[id] && !id.startsWith('e-') && !id.startsWith('n-'))
    if (toFetch.length === 0) return
    let cancelled = false
    async function run() {
      for (const id of toFetch) {
        try {
          const { data } = await supabase.from('mail_messages')
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

  // ===== Totalen =====
  const totalThreads = visibleThreads.length
  const totalEvents = events.length
  const totalNotes = notes.length
  const totalMailMessages = useMemo(
    () => visibleThreads.reduce((sum, t) => sum + (t.thread_count || 1), 0), [visibleThreads]
  )

  if (loading && threads.length === 0 && events.length === 0 && notes.length === 0) {
    return <LoadingState label="Company-tijdlijn ophalen…" />
  }
  if (error && threads.length === 0 && events.length === 0 && notes.length === 0) {
    return <ErrorState message={error} />
  }
  if (totalThreads === 0 && totalEvents === 0 && totalNotes === 0) {
    return (
      <div className={styles.empty}>
        <EmptyGraphic />
        <div className={styles.emptyTitle}>Nog geen contact-historie met {companyName}</div>
        <div className={styles.emptySub}>
          Geen mails, meetings of HubSpot-notes gevonden voor de contactpersonen
          van deze company. Mogelijk zijn er nog geen contacten gekoppeld in HubSpot.
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div className={styles.headInfo}>
          <span className={styles.headName}>🏢 {companyName}</span>
          {company?.domain && (
            <span className={styles.headEmail}>{company.domain}</span>
          )}
          <span className={styles.headStats}>
            {totalThreads} {totalThreads === 1 ? 'conversatie' : 'conversaties'} · {totalMailMessages} mails
            {totalEvents > 0 && <> · {totalEvents} {totalEvents === 1 ? 'meeting' : 'meetings'}</>}
            {totalNotes > 0 && <> · {totalNotes} {totalNotes === 1 ? 'note' : 'notes'}</>}
          </span>
        </div>
        <StyleToggle mode={mode} setMode={setMode} />
      </div>

      <div className={styles.filterChipRow}>
        <FilterChips
          filter={filter} setFilter={setFilter}
          mailCount={totalThreads} eventCount={totalEvents}
          noteCount={totalNotes} notesEnabled={showNotes}
        />
        <ExpandAllButton grouped={grouped} expandedMonths={expandedMonths} setExpandedMonths={setExpandedMonths} />
      </div>

      <NotesToggle
        enabled={showNotes} setEnabled={setShowNotes}
        count={totalNotes} loading={loadingNotes}
      />

      {grouped.map(group => (
        <GroupSection
          key={group.key} group={group} mode={mode}
          expanded={expandedMonths.has(group.key)}
          onToggle={() => toggleMonth(group.key)}
          openIds={openIds} bodies={bodies} toggleOpen={toggleOpen}
        />
      ))}

      <Legend />
    </div>
  )
}

// =============================================================================
// Subcomponents — grotendeels identiek aan SenderTimeline.jsx maar mail-cards
// hebben hier een AttributionBadge ipv direct type-badge.
// =============================================================================

function FilterChips({ filter, setFilter, mailCount, eventCount, noteCount, notesEnabled }) {
  const baseOptions = [
    { value: 'all', label: 'Alles', count: mailCount + eventCount + (notesEnabled ? noteCount : 0) },
    { value: 'mails', label: 'Mails', count: mailCount },
    { value: 'events', label: 'Meetings', count: eventCount },
  ]
  const options = notesEnabled
    ? [...baseOptions, { value: 'notes', label: 'Notes', count: noteCount }]
    : baseOptions
  return (
    <div className={styles.filterRow}>
      {options.map(o => (
        <button key={o.value} type="button"
          className={`${styles.filterChip} ${filter === o.value ? styles.filterChipActive : ''}`}
          onClick={() => setFilter(o.value)} disabled={o.count === 0 && o.value !== 'all'}>
          {o.label}<span className={styles.filterChipCount}>{o.count}</span>
        </button>
      ))}
    </div>
  )
}

function NotesToggle({ enabled, setEnabled, count, loading }) {
  return (
    <div className={styles.notesToggle}>
      <label className={styles.notesToggleLabel}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className={styles.notesToggleInput} />
        <span className={styles.notesToggleIcon}>📝</span>
        <span className={styles.notesToggleText}><strong>HubSpot-notes</strong> tonen in tijdlijn</span>
        {enabled && (
          <span className={styles.notesToggleStatus}>
            {loading ? 'laden…' : `${count} ${count === 1 ? 'note' : 'notes'}`}
          </span>
        )}
      </label>
      <span className={styles.notesToggleHint}>
        Op company-niveau is dit de hoofdbron voor context — staat default aan.
      </span>
    </div>
  )
}

function ExpandAllButton({ grouped, expandedMonths, setExpandedMonths }) {
  const monthGroups = grouped.filter(g => !g.isUpcoming)
  if (monthGroups.length <= 1) return null
  const allOpen = monthGroups.every(g => expandedMonths.has(g.key))
  function onClick() {
    if (allOpen) setExpandedMonths(new Set())
    else setExpandedMonths(new Set(monthGroups.map(g => g.key)))
  }
  return (
    <button type="button" onClick={onClick} className={styles.expandAllBtn}>
      {allOpen ? '▴ Alles inklappen' : '▾ Alles uitklappen'}
    </button>
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
      <button type="button" onClick={onToggle} className={headCls} aria-expanded={expanded}>
        <Chev open={expanded} className={styles.sectionChev} />
        {isUpcoming && <span className={styles.upcomingIcon}>⏭</span>}
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
              <ItemRenderer key={item._key} item={item} mode={mode}
                isOpen={openIds.has(itemId)}
                body={item.kind === 'mail' ? bodies[item.latest_mail_id] : null}
                onClick={() => toggleOpen(itemId)} />
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

function Card({ thread, isOpen, body, onClick }) {
  const type = classifyThread(thread)
  return (
    <button type="button" onClick={onClick}
      className={`${styles.card} ${styles[TYPES[type].cls]} ${isOpen ? styles.cardOpen : ''}`}
      aria-expanded={isOpen}>
      <div className={styles.cardTop}>
        <span className={styles.cardDate}>{formatDayShort(thread.latest_received_at)}</span>
        <TypeBadge type={type} />
        <AttributionBadge thread={thread} />
        {thread.thread_count > 1 && (
          <span className={styles.badge}>{thread.thread_count} in thread</span>
        )}
        {thread.latest_flag_status === 'flagged' && <span className={`${styles.badge} ${styles.badgeFlagged}`}>★</span>}
        {thread.latest_has_attachments && <span className={styles.badge}>📎</span>}
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
  return (
    <button type="button" onClick={onClick}
      className={`${styles.railItem} ${styles[TYPES[type].cls]} ${isOpen ? styles.railItemOpen : ''}`}
      aria-expanded={isOpen}>
      <div className={styles.railTop}>
        <span className={styles.cardDate}>{formatDayShort(thread.latest_received_at)}</span>
        <TypeBadge type={type} />
        <AttributionBadge thread={thread} />
        {thread.thread_count > 1 && <span className={styles.badge}>{thread.thread_count} in thread</span>}
        {thread.latest_flag_status === 'flagged' && <span className={`${styles.badge} ${styles.badgeFlagged}`}>★</span>}
        {thread.latest_has_attachments && <span className={styles.badge}>📎</span>}
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

// Attribution = "via [email of naam]" badge die toont welke company-contact
// in deze thread/event/note betrokken was. Uniek voor CompanyTimeline.
function AttributionBadge({ thread, event }) {
  const via = thread?.latest_via_email || event?.attribution_emails?.[0]
  const others = thread?.attribution_emails || event?.attribution_emails
  if (!via) return null
  const localPart = via.split('@')[0]
  const extra = others && others.length > 1 ? ` +${others.length - 1}` : ''
  return (
    <span className={`${styles.badge} ${styles.attributionBadge}`}
      title={others?.length > 1 ? `Betrokken: ${others.join(', ')}` : `Via ${via}`}>
      ↩ via {localPart}{extra}
    </span>
  )
}

function EventCard({ event, isOpen, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className={`${styles.card} ${styles.typeMeeting} ${styles.cardEvent} ${isOpen ? styles.cardOpen : ''}`}
      aria-expanded={isOpen}>
      <div className={styles.cardTop}>
        <span className={styles.cardDate}>{formatDayShort(event.start_time)}</span>
        <TypeBadge type="meeting" />
        <AttributionBadge event={event} />
        {event.has_fireflies && (
          <span className={`${styles.badge} ${styles.badgeFireflies}`}>🎙 Transcript</span>
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
    <button type="button" onClick={onClick}
      className={`${styles.railItem} ${styles.typeMeeting} ${styles.railItemEvent} ${isOpen ? styles.railItemOpen : ''}`}
      aria-expanded={isOpen}>
      <div className={styles.railTop}>
        <span className={styles.cardDate}>{formatDayShort(event.start_time)}</span>
        <TypeBadge type="meeting" />
        <AttributionBadge event={event} />
        {event.has_fireflies && <span className={`${styles.badge} ${styles.badgeFireflies}`}>🎙</span>}
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
        <span className={styles.eventMetaItem}>👥 {event.attendees_count}</span>
      )}
      {event.location_text && (
        <span className={styles.eventMetaItem} title={event.location_text}>📍 {truncate(event.location_text, 40)}</span>
      )}
      {event.online_meeting_url && <span className={styles.eventMetaItem}>💻 Online</span>}
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
    <button type="button" onClick={onClick}
      className={`${styles.card} ${styles.typeNote} ${styles.cardNote} ${isOpen ? styles.cardOpen : ''}`}
      aria-expanded={isOpen}>
      <div className={styles.cardTop}>
        <span className={styles.cardDate}>{formatDayShort(note.hs_timestamp)}</span>
        <TypeBadge type="note" />
        {note.associated_deal_ids?.length > 0 && (
          <span className={styles.badge}>💰 {note.associated_deal_ids.length}</span>
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
    <button type="button" onClick={onClick}
      className={`${styles.railItem} ${styles.typeNote} ${styles.railItemNote} ${isOpen ? styles.railItemOpen : ''}`}
      aria-expanded={isOpen}>
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
      {clean ? <pre className={styles.bodyPre}>{clean}</pre> : <div className={styles.bodyEmpty}>(geen tekst)</div>}
      {note.body_truncated && (
        <div className={styles.bodyTrunc}>⚠ Note ingekort — open HubSpot.</div>
      )}
    </div>
  )
}

function BodyBlock({ body, fallbackPreview }) {
  if (!body) return <div className={`${styles.body} ${styles.bodyLoading}`}>Body laden…</div>
  if (body._error) return <div className={`${styles.body} ${styles.bodyEmpty}`}>⚠ Kon body niet ophalen.</div>
  const hasHtml = !!body.body_html
  const hasText = !!body.body_text
  const preview = body.body_preview || fallbackPreview
  if (!hasHtml && !hasText && !preview) {
    return <div className={`${styles.body} ${styles.bodyEmpty}`}>(geen inhoud)</div>
  }
  return (
    <div className={styles.body} onClick={(e) => e.stopPropagation()}>
      {hasHtml
        ? <div className={styles.bodyHtml} dangerouslySetInnerHTML={{ __html: sanitizeHtml(body.body_html) }} />
        : hasText
          ? <pre className={styles.bodyPre} dangerouslySetInnerHTML={{ __html: escapeHtml(body.body_text) }} />
          : <pre className={styles.bodyPre}>{preview}</pre>}
      {body.body_truncated && <div className={styles.bodyTrunc}>⚠ Body ingekort.</div>}
    </div>
  )
}

function StyleToggle({ mode, setMode }) {
  return (
    <div className={styles.toggleGroup}>
      <button type="button" className={`${styles.toggleBtn} ${mode === 'cards' ? styles.toggleBtnActive : ''}`} onClick={() => setMode('cards')}>
        Kaartjes
      </button>
      <button type="button" className={`${styles.toggleBtn} ${mode === 'rail' ? styles.toggleBtnActive : ''}`} onClick={() => setMode('rail')}>
        Tijdlijn
      </button>
    </div>
  )
}

function TypeBadge({ type }) {
  const cfg = TYPES[type] || TYPES.incoming
  return (
    <span className={`${styles.badge} ${styles.typeBadge} ${styles[cfg.cls]}`}>
      <span className={styles.typeBadgeIcon}>{cfg.icon}</span>{cfg.label}
    </span>
  )
}

function Chev({ open, className }) {
  return (
    <svg className={`${styles.chev} ${open ? styles.chevOpen : ''} ${className || ''}`}
      viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
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

function LoadingState({ label }) {
  return (
    <div className={styles.empty}>
      <div className={styles.graphic}>⏳</div>
      <div className={styles.emptyTitle}>{label}</div>
    </div>
  )
}

function ErrorState({ message }) {
  return (
    <div className={styles.empty}>
      <div className={styles.graphic}>⚠</div>
      <div className={styles.emptyTitle}>Kon de tijdlijn niet ophalen</div>
      <code className={styles.emptyError}>{message}</code>
    </div>
  )
}

function EmptyGraphic() {
  return (
    <svg className={styles.graphic} width="120" height="120" viewBox="0 0 120 120" fill="none" aria-hidden="true">
      <rect x="20" y="30" width="80" height="60" rx="4" fill="var(--surface-2)" stroke="currentColor" strokeWidth="1.5" opacity="0.6"/>
      <line x1="35" y1="50" x2="75" y2="50" stroke="currentColor" strokeWidth="1.5" opacity="0.4"/>
      <line x1="35" y1="62" x2="65" y2="62" stroke="currentColor" strokeWidth="1.5" opacity="0.3"/>
      <line x1="35" y1="74" x2="55" y2="74" stroke="currentColor" strokeWidth="1.5" opacity="0.2"/>
    </svg>
  )
}

function stripHtml(s) {
  if (!s) return ''
  return s.replace(/<\/?(p|div|br|span|strong|em|b|i|u)[^>]*>/gi, ' ')
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
          .replace(/\s+/g, ' ').trim()
}

function formatDayShort(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('nl-NL', { weekday: 'short', day: '2-digit', month: 'short' })
}

function formatEventTime(start, end, isAllDay) {
  if (!start) return ''
  if (isAllDay) return 'Hele dag'
  const fmt = (d) => d.toLocaleString('nl-NL', { hour: '2-digit', minute: '2-digit' })
  if (!end) return fmt(new Date(start))
  return `${fmt(new Date(start))} – ${fmt(new Date(end))}`
}

function truncate(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1).trim() + '…' : s
}
