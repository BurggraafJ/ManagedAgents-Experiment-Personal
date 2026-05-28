import styles from '../SenderTimeline.module.css'
import { TYPES, classifyThread, stripHtml, formatDayShort, formatEventTime, truncate } from './timelineHelpers'
import { TypeBadge, Chev, AttributionBadge, BodyBlock } from './TimelineBadges'

// Eén maand-section met klikbare header + lijst van items (mails/events/notes)
// in kaartjes- of rail-mode. Header toont mail-/meeting-/note-tellers.
export function GroupSection({ group, mode, expanded, onToggle, openIds, bodies, toggleOpen }) {
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

// =============================================================================
// Mail-thread items — AttributionBadge rendert zichzelf alleen bij company-
// context (waar thread.latest_via_email gevuld is); no-op in single-contact.
// =============================================================================
function Card({ thread, isOpen, body, onClick }) {
  const type = classifyThread(thread)
  const typeCfg = TYPES[type]
  return (
    <button type="button" onClick={onClick}
      className={`${styles.card} ${styles[typeCfg.cls]} ${isOpen ? styles.cardOpen : ''}`}
      aria-expanded={isOpen}>
      <div className={styles.cardTop}>
        <span className={styles.cardDate}>{formatDayShort(thread.latest_received_at)}</span>
        <TypeBadge type={type} />
        <AttributionBadge thread={thread} />
        {thread.thread_count > 1 && (
          <span className={styles.badge} title={`${thread.incoming_count} ontvangen · ${thread.outgoing_count} verzonden`}>
            {thread.thread_count} in thread
          </span>
        )}
        {thread.latest_flag_status === 'flagged' && <span className={`${styles.badge} ${styles.badgeFlagged}`}>★</span>}
        {thread.latest_has_attachments && <span className={styles.badge} title="Bevat bijlagen">📎</span>}
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
    <button type="button" onClick={onClick}
      className={`${styles.railItem} ${styles[typeCfg.cls]} ${isOpen ? styles.railItemOpen : ''}`}
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

// =============================================================================
// Event items
// =============================================================================
function EventCard({ event, isOpen, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className={`${styles.card} ${styles.typeMeeting} ${styles.cardEvent} ${isOpen ? styles.cardOpen : ''}`}
      aria-expanded={isOpen}>
      <div className={styles.cardTop}>
        <span className={styles.cardDate}>{formatDayShort(event.start_time)}</span>
        <TypeBadge type="meeting" />
        <AttributionBadge event={event} />
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
    <button type="button" onClick={onClick}
      className={`${styles.railItem} ${styles.typeMeeting} ${styles.railItemEvent} ${isOpen ? styles.railItemOpen : ''}`}
      aria-expanded={isOpen}>
      <div className={styles.railTop}>
        <span className={styles.cardDate}>{formatDayShort(event.start_time)}</span>
        <TypeBadge type="meeting" />
        <AttributionBadge event={event} />
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
      {event.online_meeting_url && <span className={styles.eventMetaItem}>💻 Online</span>}
      {event.was_organized_by_them && <span className={styles.eventMetaItem}>👤 Door hen gepland</span>}
    </div>
  )
}

function EventBody({ event }) {
  return (
    <div className={styles.body} onClick={(e) => e.stopPropagation()}>
      {event.body_preview
        ? <pre className={styles.bodyPre}>{event.body_preview}</pre>
        : <div className={styles.bodyEmpty}>Geen omschrijving in event.</div>}
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

function ResponseBadge({ event }) {
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

// =============================================================================
// Note items
// =============================================================================
function NoteCard({ note, isOpen, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className={`${styles.card} ${styles.typeNote} ${styles.cardNote} ${isOpen ? styles.cardOpen : ''}`}
      aria-expanded={isOpen}>
      <div className={styles.cardTop}>
        <span className={styles.cardDate}>{formatDayShort(note.hs_timestamp)}</span>
        <TypeBadge type="note" />
        {note.via_company && (
          <span className={`${styles.badge} ${styles.badgeViaCompany}`}
            title="Deze note is op company-niveau gemaakt, niet specifiek over dit contact">
            🏢 via company
          </span>
        )}
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
    <button type="button" onClick={onClick}
      className={`${styles.railItem} ${styles.typeNote} ${styles.railItemNote} ${isOpen ? styles.railItemOpen : ''}`}
      aria-expanded={isOpen}>
      <div className={styles.railTop}>
        <span className={styles.cardDate}>{formatDayShort(note.hs_timestamp)}</span>
        <TypeBadge type="note" />
        {note.via_company && (
          <span className={`${styles.badge} ${styles.badgeViaCompany}`} title="Via company">
            🏢 via company
          </span>
        )}
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
      {clean ? <pre className={styles.bodyPre}>{clean}</pre> : <div className={styles.bodyEmpty}>(geen tekst in note)</div>}
      {note.body_truncated && (
        <div className={styles.bodyTrunc}>⚠ Note ingekort — open HubSpot voor volledige tekst.</div>
      )}
    </div>
  )
}
