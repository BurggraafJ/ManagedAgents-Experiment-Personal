// =============================================================================
// TimelineParts — gedeelde subcomponenten en helpers voor SenderTimeline
// (single contact, V9.6) en CompanyTimeline (company-aggregatie, V9.8).
//
// Beide views fetchen verschillende RPC's en hebben een eigen header, maar
// de presentation-laag is identiek: type-classify, kleur-badges, kaartjes
// vs rail-mode, body-render, maand-grouping etc.
//
// Door alles wat NIET context-specifiek is hier te extraheren, valt
// ~70% van de duplicatie weg. Card/RailItem hier delen omdat ze via
// AttributionBadge generiek geschikt zijn voor beide contexts (badge
// rendert zichzelf alleen als thread.latest_via_email bestaat = company-
// context). Same voor EventCard/Rail + NoteCard/Rail (via_company-flag).
//
// V9.9 (2026-05-18).
// =============================================================================
import { sanitizeHtml, escapeHtml, isInternalEmail } from '../../../../lib/autodraft'
import styles from './SenderTimeline.module.css'

// =============================================================================
// Type-classificatie + TYPES const (gedeelde kleur-mapping)
// =============================================================================
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

// =============================================================================
// Primitieve UI-elementen
// =============================================================================
export function TypeBadge({ type }) {
  const cfg = TYPES[type] || TYPES.incoming
  return (
    <span className={`${styles.badge} ${styles.typeBadge} ${styles[cfg.cls]}`}>
      <span className={styles.typeBadgeIcon}>{cfg.icon}</span>{cfg.label}
    </span>
  )
}

export function Chev({ open, className }) {
  return (
    <svg className={`${styles.chev} ${open ? styles.chevOpen : ''} ${className || ''}`}
      viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  )
}

// AttributionBadge — toont alleen iets als het thread/event echt attribution-
// data heeft (= alleen in CompanyTimeline-context). In SenderTimeline-context
// returns null en kost dus niets.
export function AttributionBadge({ thread, event }) {
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

// =============================================================================
// Top-bar componenten (toggle, filter, notes, expand-all)
// =============================================================================
export function StyleToggle({ mode, setMode }) {
  return (
    <div className={styles.toggleGroup} role="tablist" aria-label="Tijdlijn-stijl">
      <button type="button" role="tab" aria-selected={mode === 'cards'}
        className={`${styles.toggleBtn} ${mode === 'cards' ? styles.toggleBtnActive : ''}`}
        onClick={() => setMode('cards')}
        title="Maandkopjes met kaartjes per thread">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="5" rx="1"/><rect x="3" y="11" width="18" height="5" rx="1"/><rect x="3" y="18" width="18" height="3" rx="1"/>
        </svg>
        Kaartjes
      </button>
      <button type="button" role="tab" aria-selected={mode === 'rail'}
        className={`${styles.toggleBtn} ${mode === 'rail' ? styles.toggleBtnActive : ''}`}
        onClick={() => setMode('rail')}
        title="Verticale tijdlijn met dots">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <line x1="6" y1="3" x2="6" y2="21"/>
          <circle cx="6" cy="7" r="2" fill="currentColor"/><circle cx="6" cy="13" r="2" fill="currentColor"/><circle cx="6" cy="19" r="2" fill="currentColor"/>
          <line x1="10" y1="7" x2="20" y2="7"/><line x1="10" y1="13" x2="20" y2="13"/><line x1="10" y1="19" x2="20" y2="19"/>
        </svg>
        Tijdlijn
      </button>
    </div>
  )
}

export function FilterChips({ filter, setFilter, mailCount, eventCount, noteCount, notesEnabled }) {
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
          onClick={() => setFilter(o.value)}
          disabled={o.count === 0 && o.value !== 'all'}>
          {o.label}<span className={styles.filterChipCount}>{o.count}</span>
        </button>
      ))}
    </div>
  )
}

export function NotesToggle({ enabled, setEnabled, count, loading, disabled, hint }) {
  const defaultHint = disabled
    ? 'Deze afzender heeft (nog) geen HubSpot-koppeling — geen notes om te tonen.'
    : 'Standaard uit zodat de tijdlijn niet overspoeld wordt — zet aan voor extra context.'
  return (
    <div className={`${styles.notesToggle} ${disabled ? styles.notesToggleDisabled : ''}`}>
      <label className={styles.notesToggleLabel}>
        <input type="checkbox" checked={enabled && !disabled}
          onChange={(e) => setEnabled(e.target.checked)} disabled={disabled}
          className={styles.notesToggleInput} />
        <span className={styles.notesToggleIcon}>📝</span>
        <span className={styles.notesToggleText}><strong>HubSpot-notes</strong> tonen in tijdlijn</span>
        {enabled && !disabled && (
          <span className={styles.notesToggleStatus}>
            {loading ? 'laden…' : `${count} ${count === 1 ? 'note' : 'notes'}`}
          </span>
        )}
      </label>
      <span className={styles.notesToggleHint}>{hint || defaultHint}</span>
    </div>
  )
}

export function ExpandAllButton({ grouped, expandedMonths, setExpandedMonths }) {
  const monthGroups = grouped.filter(g => !g.isUpcoming)
  if (monthGroups.length <= 1) return null
  const allOpen = monthGroups.every(g => expandedMonths.has(g.key))
  function onClick() {
    if (allOpen) setExpandedMonths(new Set())
    else setExpandedMonths(new Set(monthGroups.map(g => g.key)))
  }
  return (
    <button type="button" onClick={onClick} className={styles.expandAllBtn}
      title={allOpen ? 'Alle maanden weer inklappen' : 'Alle verleden-maanden uitklappen (komende meetings blijven dicht)'}>
      {allOpen ? '▴ Alles inklappen' : '▾ Alles uitklappen'}
    </button>
  )
}

export function Legend() {
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

// =============================================================================
// GroupSection + ItemRenderer (generic — itemRenderer is een prop)
// =============================================================================
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
// context (waar thread.latest_via_email is gevuld); is no-op in single-contact
// context. Geen aparte Cards per view nodig.
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

// =============================================================================
// Body-block voor mail-rendering (HTML sanitized of plain text)
// =============================================================================
export function BodyBlock({ body, fallbackPreview }) {
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
      {hasHtml
        ? <div className={styles.bodyHtml} dangerouslySetInnerHTML={{ __html: sanitizeHtml(body.body_html) }} />
        : hasText
          ? <pre className={styles.bodyPre} dangerouslySetInnerHTML={{ __html: escapeHtml(body.body_text) }} />
          : <pre className={styles.bodyPre}>{preview}</pre>}
      {body.body_truncated && (
        <div className={styles.bodyTrunc}>⚠ Body ingekort tot 200KB — open Outlook voor de volledige mail.</div>
      )}
    </div>
  )
}

// =============================================================================
// State-graphics
// =============================================================================
export function EmptyGraphic() {
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

export function LoadingGraphic() {
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

export function ErrorGraphic() {
  return (
    <svg className={styles.graphic} width="120" height="120" viewBox="0 0 120 120" fill="none" aria-hidden="true">
      <path d="M60 20 L105 95 L15 95 Z" fill="var(--surface-2, #f5f4f0)"
        stroke="var(--accent, #dc6f3f)" strokeWidth="2.5" strokeLinejoin="round"/>
      <line x1="60" y1="48" x2="60" y2="75" stroke="var(--accent, #dc6f3f)" strokeWidth="3" strokeLinecap="round"/>
      <circle cx="60" cy="85" r="2.5" fill="var(--accent, #dc6f3f)"/>
    </svg>
  )
}

// =============================================================================
// Helpers
// =============================================================================
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
