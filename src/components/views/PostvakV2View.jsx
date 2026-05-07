import { useState, useMemo, useEffect, useRef, useCallback, Fragment } from 'react'
import { supabase } from '../../lib/supabase'
import { showToast } from '../Toast'
import RagBadge from '../RagBadge'

// ============================================================================
// Postvak V2 — Rebrand-pilot (HTML-mockup C:\Users\LM\Downloads\Postvak.html)
// ----------------------------------------------------------------------------
// Volledig zelfdragende shell (rail + tabs + content). Gebruikt CSS-prefix
// `pv2-` zodat niets botst met de bestaande app. Wordt aangeroepen vanuit
// App.jsx als shell-bypass route — de globale Sidebar/Main wrapper wordt
// onderdrukt zodat deze pagina edge-to-edge rendert.
// ============================================================================

// ----- Inline lucide-style iconen ------------------------------------------------
const Ic = ({ n, s = 16 }) => {
  const paths = {
    inbox: <><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/></>,
    star: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>,
    'star-fill': <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="currentColor"/>,
    hourglass: <><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></>,
    'eye-off': <><path d="m15 18-.722-3.25"/><path d="M2 8a10.645 10.645 0 0 0 20 0"/><path d="m20 15-1.726-2.05"/><path d="m4 15 1.726-2.05"/><path d="m9 18 .722-3.25"/></>,
    edit: <><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></>,
    folder: <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>,
    'archive-folder': <><path d="M2 7a2 2 0 0 1 2-2h7l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"/><path d="M2 11h20"/></>,
    history: <><path d="M3 12a9 9 0 1 0 9-9"/><path d="M3 4v5h5"/><path d="M12 7v5l4 2"/></>,
    search: <><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
    send: <><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>,
    chev: <polyline points="6 9 12 15 18 9"/>,
    'chev-l': <polyline points="15 18 9 12 15 6"/>,
    'chev-r': <polyline points="9 18 15 12 9 6"/>,
    sparkles: <><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></>,
    'check-square': <><path d="m9 12 2 2 4-4"/><rect width="18" height="18" x="3" y="3" rx="2"/></>,
    archive: <><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></>,
    spell: <><path d="m6 16 6-12 6 12"/><path d="M8 12h8"/><path d="m17 22 5-5"/><path d="m22 22-5-5"/></>,
    'shield-x': <><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9.5 9 5 5"/><path d="m14.5 9-5 5"/></>,
    zap: <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>,
    plus: <><path d="M5 12h14"/><path d="M12 5v14"/></>,
    pin: <><path d="m12 17 .01 5"/><path d="M9.59 4.59A2 2 0 1 1 11 8H7l-2 4h14l-2-4h-4"/><path d="M5 12h14l-1 5H6Z"/></>,
    list: <><path d="M3 5h18"/><path d="M3 12h18"/><path d="M3 19h18"/></>,
    speech: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>,
    refresh: <><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></>,
    info: <><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></>,
    more: <><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></>,
    log: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 8h7"/><path d="M9 12h7"/><path d="M9 16h4"/></>,
    x: <><path d="M18 6 6 18"/><path d="m6 6 12 12"/></>,
    reply: <><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></>,
    paperclip: <path d="M13.234 20.252 21 12.3a4.25 4.25 0 0 0-6.004-6.01L4.893 16.428a8.5 8.5 0 0 0 12.021 12.019"/>,
    trash: <><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></>,
    arrow: <><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></>,
  }
  const path = paths[n]
  return <svg className="pv2-svg" viewBox="0 0 24 24" width={s} height={s} aria-hidden="true">{path}</svg>
}

// Logo-mark zoals in HTML (8-puntige geometrische vorm)
const Logo = (
  <svg viewBox="0 0 36 38" fill="currentColor" aria-hidden="true">
    <path d="M 26.031 20.144 C 26.421 20.144 26.797 20.299 27.073 20.575 L 36 29.501 L 32.459 29.504 C 32.023 29.506 31.669 29.861 31.669 30.299 L 31.669 32.956 C 31.669 33.395 31.313 33.751 30.877 33.751 L 28.086 33.751 C 27.648 33.751 27.294 34.108 27.294 34.546 L 27.294 38 L 17.989 28.724 L 8.703 37.982 L 8.703 34.543 C 8.703 34.096 8.341 33.733 7.896 33.733 L 5.137 33.733 C 4.691 33.733 4.33 33.37 4.33 32.923 L 4.33 30.298 C 4.33 29.851 3.969 29.487 3.524 29.487 L 0 29.485 L 8.909 20.575 C 9.186 20.299 9.559 20.144 9.949 20.144 L 26.031 20.144 Z"/>
    <path d="M 17.991 5.908 L 26.117 0.027 L 26.117 11.268 C 26.117 11.646 25.942 12.007 25.64 12.25 L 18.856 17.703 C 18.361 18.102 17.641 18.102 17.145 17.705 L 10.363 12.25 C 10.059 12.007 9.883 11.645 9.883 11.265 L 9.883 0 L 17.991 5.908 Z"/>
  </svg>
)

// ----- Helpers ------------------------------------------------------------------
function getInitials(name) {
  if (!name) return '?'
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatRelative(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(+d)) return ''
  const now = new Date()
  const diffMs = now - d
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)
  if (diffMin < 1) return 'nu'
  if (diffMin < 60) return diffMin + 'm'
  if (diffHr < 24) return diffHr + 'u'
  if (diffDay < 7) {
    const days = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za']
    return days[d.getDay()]
  }
  const months = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']
  return String(d.getDate()).padStart(2, '0') + ' ' + months[d.getMonth()]
}

function formatFullDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(+d)) return ''
  const months = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']
  return String(d.getDate()).padStart(2, '0') + ' ' + months[d.getMonth()] + ', ' +
         String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

function bucketByDay(items) {
  const buckets = []
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1)
  const dayNames = ['Zondag', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag']
  const months = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']

  const map = new Map()
  for (const item of items) {
    if (!item.received_at) continue
    const d = new Date(item.received_at)
    if (isNaN(+d)) continue
    const day = new Date(d); day.setHours(0, 0, 0, 0)
    let label
    if (+day === +today) label = 'Vandaag'
    else if (+day === +yesterday) label = 'Gisteren'
    else {
      const diffDays = Math.floor((today - day) / (1000 * 60 * 60 * 24))
      if (diffDays > 0 && diffDays < 7) label = dayNames[day.getDay()]
      else label = String(day.getDate()) + ' ' + months[day.getMonth()]
    }
    if (!map.has(label)) map.set(label, [])
    map.get(label).push(item)
  }
  for (const [day, list] of map) buckets.push({ day, items: list })
  return buckets
}

// Awaiting / pseudo-pending logic leeft nu in src/hooks/usePostvakInbox.js.
// Categorie-mapping (dynamisch uit data) ----------------------------------
function categoryStyle(catKey, categories) {
  // Probeer eerst dynamisch uit categories-tabel (heeft color_hex)
  const c = (categories || []).find(x => x.category_key === catKey)
  if (c?.color_hex) {
    return { color: c.color_hex, label: c.label || catKey, key: catKey }
  }
  // Fallback static palette. 'partner' wordt alias voor 'aandeelhouder'
  // (rebrand-decision Jelle 2026-05-08).
  const fallback = {
    intern:        { color: '#2563eb', label: 'Intern · Legal Mind collega' },
    aandeelhouder: { color: '#dc2626', label: 'Aandeelhouder' },
    partner:       { color: '#dc2626', label: 'Aandeelhouder' },
    klant:         { color: '#059669', label: 'Klant / opdrachtgever' },
    overig:        { color: '#94a3b8', label: 'Overig' },
    plan:          { color: '#d97706', label: 'In te plannen afspraak' },
  }
  return fallback[catKey] || { color: '#94a3b8', label: catKey || '—', key: catKey }
}

// ----- Subcomponents ------------------------------------------------------------
function Avatar({ name, color = 'slate', size = 36 }) {
  const initials = getInitials(name)
  const cls = 'pv2-av pv2-av-' + color
  return (
    <span className={cls} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>
      {initials}
    </span>
  )
}

function ScoreRing({ score = 0 }) {
  const r = 18
  const C = 2 * Math.PI * r
  const dash = (Math.max(0, Math.min(100, score)) / 100) * C
  return (
    <div className="pv2-score-ring" title={'AI-confidence: ' + score + '%'}>
      <svg viewBox="0 0 44 44">
        <circle className="pv2-ring-bg" cx="22" cy="22" r={r}/>
        <circle className="pv2-ring-fg" cx="22" cy="22" r={r} strokeDasharray={`${dash} ${C}`}/>
      </svg>
      <span className="pv2-score-num">{score}</span>
    </div>
  )
}

// Rail / NavSidebar / FolderNode zijn naar de globale Sidebar verhuisd.
// Postvak-tabs en Mappen-tree worden nu door src/components/Sidebar.jsx
// gerenderd via de postvakBus uit App.jsx. Deze view is content-only.

function ListPane({ buckets, selectedId, setSelectedId, filter, setFilter, filters, title, ragHealth, onTogglePin }) {
  return (
    <section className="pv2-list">
      <div className="pv2-list-head">
        <div className="pv2-list-title-row">
          <div>
            <div className="pv2-list-title">{title}</div>
            <div className="pv2-list-stats" style={{ marginTop: 4 }}>
              <span><b>RAG-health</b> · Wk {ragHealth.week}</span>
              <span className="pv2-stat-sep">·</span>
              <span><b>{ragHealth.coverage}</b> coverage</span>
              <span className="pv2-stat-sep">·</span>
              <span>{ragHealth.fireflies} Fireflies</span>
              <span className="pv2-stat-sep">·</span>
              <span>P95 {ragHealth.p95}</span>
            </div>
          </div>
          <button className="pv2-btn pv2-btn-icon pv2-btn-ghost" title="Meer"><Ic n="more" s={16}/></button>
        </div>
        <div className="pv2-filters">
          {filters.map(f => (
            <button
              key={f.id}
              className={`pv2-chip ${filter === f.id ? 'pv2-active' : ''}`}
              onClick={() => setFilter(f.id)}
            >
              {f.dot && <span className="pv2-chip-dot" style={{ background: f.dot }}/>}
              {f.label}
              <span className="pv2-chip-count">{f.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="pv2-list-scroll">
        {buckets.length === 0 && (
          <div className="pv2-empty">
            <div className="pv2-empty-title">Niets te zien</div>
            <div className="pv2-empty-sub">Geen mails in dit tabblad.</div>
          </div>
        )}
        {buckets.map(group => (
          <Fragment key={group.day}>
            <div className="pv2-list-day">
              <span>{group.day}</span>
              <span className="pv2-list-day-count">{group.items.length}</span>
            </div>
            {group.items.map(it => (
              <Row
                key={it.mail_id}
                mail={it}
                selected={selectedId === it.mail_id}
                onClick={() => setSelectedId(it.mail_id)}
                onTogglePin={onTogglePin}
              />
            ))}
          </Fragment>
        ))}
      </div>
    </section>
  )
}

function Row({ mail, selected, onClick, onTogglePin }) {
  const cat = mail._category
  const isUnread = mail.is_read === false
  const isPinned = mail.flag_status === 'flagged'
  const subj = mail.subject || '(geen onderwerp)'
  const snippet = mail.body_preview || mail.suggested_reasoning || ''
  const time = formatRelative(mail.received_at)

  // Categorie-pill class. 'partner' wordt gerenderd als aandeelhouder.
  const effectiveKey = mail.category_key === 'partner' ? 'aandeelhouder' : mail.category_key
  const catClass = ({
    intern: 'pv2-pill-cat-intern',
    aandeelhouder: 'pv2-pill-cat-share',
    klant: 'pv2-pill-cat-klant',
    overig: 'pv2-pill-cat-overig',
    plan: 'pv2-pill-status-plan',
  })[effectiveKey] || 'pv2-pill-cat-overig'

  const onDragStart = (e) => {
    if (!mail.mail_id) return
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/x-mail-id', mail.mail_id)
    e.dataTransfer.setData('text/plain', subj)
  }

  const handlePin = (e) => {
    e.stopPropagation()
    if (onTogglePin && mail.mail_id) onTogglePin(mail.mail_id, !isPinned)
  }

  // Awaiting-rij krijgt 'aan {recipient}' label en dagen-teller
  const isAwaiting = !!mail.__awaiting
  const recipientLabel = isAwaiting
    ? (mail.from_name || mail.from_email || '—')
    : (mail.from_name || mail.from_email || 'Onbekend')

  return (
    <div
      className={`pv2-row ${selected ? 'pv2-selected' : ''} ${isUnread ? 'pv2-unread' : ''} ${isAwaiting ? 'pv2-row-awaiting' : ''}`}
      onClick={onClick}
      draggable
      onDragStart={onDragStart}
    >
      <div className="pv2-row-from">
        <span className="pv2-cat-dot" style={{ background: cat.color }}/>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {isAwaiting && <span className="pv2-row-aan">aan </span>}
          {recipientLabel}
        </span>
      </div>
      <div className="pv2-row-meta">
        <button
          type="button"
          className={`pv2-row-pin ${isPinned ? 'is-active' : ''}`}
          onClick={handlePin}
          title={isPinned ? 'Pin verwijderen' : 'Pinnen'}
          aria-label={isPinned ? 'Pin verwijderen' : 'Pinnen'}
        >
          <Ic n={isPinned ? 'pin' : 'pin'} s={13}/>
        </button>
        <span>{time}</span>
      </div>
      <div className="pv2-row-subject">{subj}</div>
      <div className="pv2-row-snippet">{snippet}</div>
      <div className="pv2-row-foot">
        <span className={`pv2-pill ${catClass}`}>
          <span className="pv2-pill-dot" style={{ background: cat.color }}/>
          {cat.label}
        </span>
        {isAwaiting && mail.days_waiting != null && (
          <span className="pv2-pill pv2-pill-waiting">
            <Ic n="hourglass" s={11}/> {mail.days_waiting}d wacht
          </span>
        )}
        {mail.suggested_action === 'send' && (
          <span className="pv2-pill pv2-pill-done"><Ic n="check-square" s={11}/>concept</span>
        )}
        {mail.has_attachments && (
          <span className="pv2-pill-meta"><Ic n="paperclip" s={11}/></span>
        )}
        {mail.mail_id && !mail.__awaiting && !mail.__sent_draft && (
          <span onClick={e => e.stopPropagation()}>
            <RagBadge recordType="autodraft_mail" recordId={mail.mail_id} compact />
          </span>
        )}
      </div>
    </div>
  )
}

function ComposeBody({ body, setBody }) {
  const ref = useRef(null)
  const last = useRef(body)
  useEffect(() => {
    if (ref.current && body !== last.current) {
      ref.current.innerText = body
      last.current = body
    }
  }, [body])
  useEffect(() => {
    if (ref.current && !ref.current.innerText) ref.current.innerText = body
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div
      ref={ref}
      className="pv2-compose-body"
      contentEditable
      suppressContentEditableWarning
      onInput={e => { last.current = e.currentTarget.innerText; setBody(e.currentTarget.innerText) }}
      data-placeholder="Typ je bericht…"
    />
  )
}

// Sanitiseer body_html basaal — verwijder script/style tags en inline event-handlers.
// Niet productie-grade DOMPurify (dat staat al elders in de app); dit is een
// snelle white-list voor de thread-render. Bij twijfel valt hij terug op text.
function basicSanitizeHtml(html) {
  if (!html || typeof html !== 'string') return ''
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/javascript:/gi, '')
}

function ThreadMessage({ msg, idx }) {
  const [expanded, setExpanded] = useState(idx === 0)
  const bodyHtml = msg.body_html ? basicSanitizeHtml(msg.body_html) : null
  const bodyText = msg.body_text || msg.body_preview || ''
  const truncated = msg.body_truncated
  const fromName = msg.from_name || msg.from_email || '?'
  const isFromMe = !!msg.is_from_me
  const recip = Array.isArray(msg.to_recipients)
    ? msg.to_recipients.map(r => typeof r === 'string' ? r : (r?.name || r?.email || '')).filter(Boolean).slice(0, 3).join(', ')
    : (typeof msg.to_recipients === 'string' ? msg.to_recipients : '')

  return (
    <div className="pv2-msg" data-expanded={expanded}>
      <div
        className="pv2-msg-head"
        onClick={() => setExpanded(e => !e)}
        style={{ cursor: 'pointer' }}
      >
        <div className="pv2-msg-from">
          <Avatar name={fromName} color={isFromMe ? 'dark' : (idx === 0 ? 'orange' : 'slate')} size={32}/>
          <div>
            <div className="pv2-msg-name">{fromName}</div>
            <div className="pv2-msg-email">
              {msg.from_email}
              {recip && <> → {recip}</>}
            </div>
          </div>
        </div>
        <span className="pv2-msg-time">
          {formatFullDate(msg.received_at)}
          <span className="pv2-msg-toggle">{expanded ? '▴' : '▾'}</span>
        </span>
      </div>
      {expanded && (
        <>
          {bodyHtml ? (
            <div className="pv2-msg-body pv2-msg-body-html" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
          ) : (
            <div className="pv2-msg-body">{bodyText || '(geen tekst)'}</div>
          )}
          {truncated && (
            <div className="pv2-msg-truncated">⚠ Body afgekapt door mail-sync — open in Outlook voor volledige inhoud.</div>
          )}
        </>
      )}
      {!expanded && bodyText && (
        <div className="pv2-msg-body pv2-msg-body-collapsed">{bodyText.slice(0, 200)}{bodyText.length > 200 ? '…' : ''}</div>
      )}
    </div>
  )
}

function DetailPane({ mail, threadMessages, categories, folders, onAction, busyAction }) {
  const variants = useMemo(() => {
    if (Array.isArray(mail?.draft_variants) && mail.draft_variants.length > 0) {
      return mail.draft_variants.map((v, i) => ({
        id: v.id || ('v' + i),
        label: v.label || ('Variant ' + (i + 1)),
        body: v.body || '',
        subject: v.subject || mail.draft_subject || '',
      }))
    }
    if (mail?.draft_body) {
      return [{ id: 'default', label: 'Skill-concept', body: mail.draft_body, subject: mail.draft_subject || '' }]
    }
    return []
  }, [mail])

  // ⚠ ALLE hooks moeten BOVEN de early-return staan (React #310 vermijden).
  const [variantIdx, setVariantIdx] = useState(0)
  const [body, setBody] = useState(variants[0]?.body || '')
  const [subject, setSubject] = useState(variants[0]?.subject || mail?.draft_subject || '')
  const [showCc, setShowCc] = useState(false)
  const [primary, setPrimary] = useState('plaats')
  const [categoryKey, setCategoryKey] = useState(mail?.category_key || '')
  const [targetFolder, setTargetFolder] = useState(mail?.target_folder || '')
  const [afhandelOpen, setAfhandelOpen] = useState(false)
  const [afhandelPos, setAfhandelPos] = useState({ top: 0, left: 0 })
  const afhandelRef = useRef(null)
  const afhandelBtnRef = useRef(null)
  const [amendOpen, setAmendOpen] = useState(false)
  const [amendText, setAmendText] = useState('')
  const [snelOpen, setSnelOpen] = useState(false)
  const [snelPos, setSnelPos] = useState({ top: 0, left: 0 })
  const snelRef = useRef(null)
  const snelBtnRef = useRef(null)
  const [reasonModal, setReasonModal] = useState(null)
  const [prefModalOpen, setPrefModalOpen] = useState(false)

  useEffect(() => {
    setVariantIdx(0)
    setBody(variants[0]?.body || '')
    setSubject(variants[0]?.subject || mail?.draft_subject || '')
    setCategoryKey(mail?.category_key || '')
    setTargetFolder(mail?.target_folder || '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mail?.mail_id])

  useEffect(() => {
    const v = variants[variantIdx]
    if (v) {
      setBody(v.body || '')
      setSubject(v.subject || mail?.draft_subject || '')
      // Persist variant-keuze in DB (best-effort, niet blokkerend).
      // Supabase rpc() is een PostgrestFilterBuilder — wel awaitable, géén
      // ouderwets Promise met .catch(). Daarom async-IIFE met try/catch.
      if (mail?.mail_id) {
        ;(async () => {
          try {
            await supabase.rpc('set_autodraft_variant', {
              p_mail_id: mail.mail_id,
              p_variant_index: variantIdx,
            })
          } catch {
            // best-effort, UI is al bijgewerkt
          }
        })()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantIdx])

  // Close popup on outside click — let de toggle-knop NIET opnieuw triggeren.
  useEffect(() => {
    if (!afhandelOpen) return
    function handle(e) {
      const inMenu = afhandelRef.current && afhandelRef.current.contains(e.target)
      const inButton = afhandelBtnRef.current && afhandelBtnRef.current.contains(e.target)
      if (!inMenu && !inButton) setAfhandelOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [afhandelOpen])

  useEffect(() => {
    if (!snelOpen) return
    function handle(e) {
      const inMenu = snelRef.current && snelRef.current.contains(e.target)
      const inButton = snelBtnRef.current && snelBtnRef.current.contains(e.target)
      if (!inMenu && !inButton) setSnelOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [snelOpen])

  // Reset amend-state per mail
  useEffect(() => {
    setAmendOpen(false)
    setAmendText('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mail?.mail_id])

  // Snel-mappen voor het afhandel-popover (top 8 paden)
  const quickFolders = useMemo(() => {
    if (folders.length > 0) {
      return folders
        .filter(f => f.full_path && f.full_path.startsWith('Inbox'))
        .map(f => f.full_path)
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 10)
    }
    return ['Inbox/General Storage', 'Inbox/Archief', 'Inbox/Archief/Nieuwsbrieven', 'Inbox/Archief/Notificaties']
  }, [folders])

  if (!mail) {
    return (
      <section className="pv2-detail">
        <div className="pv2-empty pv2-detail-empty">
          <div className="pv2-empty-title">Selecteer een mail</div>
          <div className="pv2-empty-sub">Klik links op een conversatie om de skill-context te zien.</div>
        </div>
      </section>
    )
  }

  const cat = categories.find(c => c.category_key === categoryKey) || categoryStyle(categoryKey, categories)
  const score = Math.round((mail.confidence || 0) * 100)

  const send = () => onAction('send', { subject, body, target_folder: targetFolder, variantIdx })
  const ignoreToFolder = (folder) => {
    setAfhandelOpen(false)
    onAction('ignore', { target_folder: folder || targetFolder || null })
  }
  const markProcessed = () => {
    setAfhandelOpen(false)
    onAction('processed')
  }
  const spam = () => {
    setAfhandelOpen(false)
    onAction('spam')
  }
  const toggleAmend = () => {
    setAmendOpen(o => !o)
  }
  const submitAmend = () => {
    if (!amendText.trim()) return
    onAction('amend', { amend: amendText.trim() })
    setAmendOpen(false)
    setAmendText('')
  }
  const cancelAmend = () => {
    setAmendOpen(false)
    setAmendText('')
  }
  const forwardMail = () => {
    setSnelOpen(false)
    onAction('forward')
  }
  const replyAll = () => {
    setSnelOpen(false)
    onAction('reply_all')
  }

  const recipients = Array.isArray(mail.to_recipients) ? mail.to_recipients : []
  const fromName = mail.from_name || mail.from_email || 'Onbekend'

  return (
    <section className="pv2-detail">
      {/* sticky head */}
      <div className="pv2-det-head">
        <div className="pv2-det-meta-row">
          <div className="pv2-det-from">
            <Avatar name={fromName} color="orange" size={40}/>
            <div>
              <div className="pv2-det-name">{fromName}</div>
              <div className="pv2-det-recipients" style={{ marginTop: 2 }}>
                {mail.from_email && <span className="pv2-det-email">{mail.from_email}</span>}
                {recipients.length > 0 && (
                  <>
                    <span className="pv2-stat-sep">·</span>
                    <span>aan <b>{recipients.slice(0, 2).map(r => r.name || r.email || r).join(', ')}</b>
                      {recipients.length > 2 && <> +{recipients.length - 2}</>}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="pv2-det-tools">
            <span className="pv2-det-time">{formatFullDate(mail.received_at)}</span>
            {mail.mail_id && (
              <RagBadge recordType="autodraft_mail" recordId={mail.mail_id} />
            )}
            <ScoreRing score={score}/>
            <button className="pv2-btn pv2-btn-icon pv2-btn-ghost" title="Meer"><Ic n="more" s={16}/></button>
          </div>
        </div>

        <h1 className="pv2-det-subject">{mail.subject || '(geen onderwerp)'}</h1>
      </div>

      <div className="pv2-compose-scroll pv2-scrollbar">
        {/* Skill insight */}
        {mail.suggested_reasoning && (
          <div className="pv2-insight">
            <span className="pv2-insight-icon"><Ic n="sparkles" s={18}/></span>
            <div>
              <b>Skill denkt:</b> {mail.suggested_reasoning}
              {variants.length > 0 && (
                <div className="pv2-insight-meta" style={{ marginTop: 4 }}>
                  {variants.length} concept{variants.length === 1 ? '' : 'varianten'} gegenereerd · gebaseerd op skill-instellingen.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Action toolbar */}
        <div className="pv2-toolbar">
          <button
            className={`pv2-tool ${primary === 'plaats' ? 'pv2-primary' : ''}`}
            onClick={() => { setPrimary('plaats'); send() }}
            disabled={busyAction === 'send' || variants.length === 0}
          >
            <Ic n="edit" s={14}/> {busyAction === 'send' ? 'Plaatsen…' : 'Plaats concept'}
          </button>
          <button
            ref={afhandelBtnRef}
            className="pv2-tool"
            onClick={() => {
              if (afhandelBtnRef.current) {
                const r = afhandelBtnRef.current.getBoundingClientRect()
                setAfhandelPos({ top: r.bottom + 6, left: r.left })
              }
              setAfhandelOpen(o => !o)
            }}
            disabled={busyAction === 'ignore' || busyAction === 'spam' || busyAction === 'processed'}
          >
            <Ic n="archive" s={14}/> {busyAction === 'ignore' || busyAction === 'spam' || busyAction === 'processed' ? 'Bezig…' : 'Afhandelen'} <Ic n="chev" s={12}/>
          </button>
          {afhandelOpen && (
            <div
              ref={afhandelRef}
              className="pv2-popover"
              role="menu"
              style={{ position: 'fixed', top: afhandelPos.top, left: afhandelPos.left, minWidth: 360 }}
            >
              <div className="pv2-popover-section">
                <button
                  className="pv2-popover-item"
                  onClick={() => ignoreToFolder(null)}
                  role="menuitem"
                >
                  <Ic n="archive" s={14}/>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="pv2-popover-item-label" style={{ fontWeight: 600 }}>Afhandelen</div>
                    <div className="pv2-popover-item-sub">Verplaats naar gekozen map — geen leerregel.</div>
                  </div>
                </button>
                <button
                  className="pv2-popover-item"
                  onClick={() => {
                    setAfhandelOpen(false)
                    setReasonModal({
                      pattern_type: 'subject_keyword',
                      pattern_value: '',
                      reason_kind: 'unwanted',
                      prompt: 'Wat zit er in deze mails dat je voortaan wil overslaan? (deel van onderwerp of inhoud, bv. "teams meeting" of "uitnodiging")',
                      askPattern: true,
                    })
                  }}
                  role="menuitem"
                >
                  <Ic n="edit" s={14}/>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="pv2-popover-item-label" style={{ fontWeight: 600 }}>Afhandelen + eigen leerregel</div>
                    <div className="pv2-popover-item-sub">Typ wat in dit type mail zit — skill leert dit te skippen.</div>
                  </div>
                </button>
                <button
                  className="pv2-popover-item"
                  onClick={() => {
                    setAfhandelOpen(false)
                    setReasonModal({
                      pattern_type: 'sender',
                      pattern_value: mail.from_email || '',
                      reason_kind: 'handled_by_colleague',
                      prompt: 'Welke collega heeft hem opgepakt? (optioneel — wordt alleen gelogd)',
                      skipPattern: true,
                    })
                  }}
                  role="menuitem"
                >
                  <Ic n="reply" s={14}/>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="pv2-popover-item-label" style={{ fontWeight: 600 }}>Afgehandeld door collega</div>
                    <div className="pv2-popover-item-sub">Logt alleen — geen leerregel.</div>
                  </div>
                </button>
              </div>
            </div>
          )}
          <button
            className={`pv2-tool ${amendOpen ? 'pv2-tool-active' : ''}`}
            onClick={toggleAmend}
            disabled={busyAction === 'amend'}
          >
            <Ic n="sparkles" s={14}/> Aanpassen
          </button>
          <button
            ref={snelBtnRef}
            className="pv2-tool"
            onClick={() => {
              if (snelBtnRef.current) {
                const r = snelBtnRef.current.getBoundingClientRect()
                setSnelPos({ top: r.bottom + 6, left: r.left })
              }
              setSnelOpen(o => !o)
            }}
            disabled={!!busyAction}
          >
            <Ic n="zap" s={14}/> Snel <Ic n="chev" s={12}/>
          </button>
          {snelOpen && (
            <div
              ref={snelRef}
              className="pv2-popover"
              role="menu"
              style={{ position: 'fixed', top: snelPos.top, left: snelPos.left, minWidth: 320 }}
            >
              <div className="pv2-popover-section">
                <button
                  className="pv2-popover-item"
                  onClick={() => {
                    setSnelOpen(false)
                    setPrefModalOpen(true)
                  }}
                >
                  <span style={{ fontSize: 16, marginTop: 1 }} aria-hidden>💡</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="pv2-popover-item-label" style={{ fontWeight: 600 }}>Voorkeur toevoegen</div>
                    <div className="pv2-popover-item-sub">Geen actie op deze mail — voorkeur wordt opgeslagen voor de categorie.</div>
                  </div>
                </button>
                <div className="pv2-popover-divider"/>
                <button
                  className="pv2-popover-item"
                  onClick={() => {
                    setSnelOpen(false)
                    showToast({ kind: 'info', message: 'Forward — kies ontvanger in Outlook (compose-knop)' })
                  }}
                >
                  <Ic n="arrow" s={14}/>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="pv2-popover-item-label">Doorsturen aan…</div>
                    <div className="pv2-popover-item-sub">Open compose voor forward.</div>
                  </div>
                </button>
                <button
                  className="pv2-popover-item"
                  onClick={() => {
                    setSnelOpen(false)
                    showToast({ kind: 'info', message: 'Allen beantwoorden — voeg recipients toe' })
                  }}
                >
                  <Ic n="reply" s={14}/>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="pv2-popover-item-label">Allen beantwoorden</div>
                    <div className="pv2-popover-item-sub">Reply-all met huidige draft.</div>
                  </div>
                </button>
              </div>
            </div>
          )}
          <span className="pv2-tool-sep"/>
          <div className="pv2-meta-pickers pv2-tool-spread" style={{ justifyContent: 'flex-end', display: 'flex' }}>
            <select
              className="pv2-picker"
              value={categoryKey}
              onChange={e => setCategoryKey(e.target.value)}
              title="Categorie"
            >
              <option value="">— categorie —</option>
              {categories.map(c => (
                <option key={c.category_key} value={c.category_key}>{c.label || c.category_key}</option>
              ))}
            </select>
            <select
              className="pv2-picker"
              value={targetFolder}
              onChange={e => setTargetFolder(e.target.value)}
              title="Map"
            >
              <option value="">— map —</option>
              {folders.map(f => (
                <option key={f.full_path || f.id} value={f.full_path || f.label}>
                  {f.full_path || f.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Amend-box — inline expandable textarea, geen window.prompt meer */}
        {amendOpen && (
          <div className="pv2-amend">
            <label className="pv2-amend-label">
              Wat moet anders? Skill schrijft het concept opnieuw met jouw correctie.
            </label>
            <textarea
              className="pv2-amend-input"
              value={amendText}
              onChange={e => setAmendText(e.target.value)}
              rows={3}
              autoFocus
              placeholder='bv. "Korter en informeler", "Stel concrete datum voor", "Niet over prijs beginnen"…'
              disabled={busyAction === 'amend'}
            />
            <div className="pv2-amend-actions">
              <button
                className="pv2-btn pv2-btn-primary"
                onClick={submitAmend}
                disabled={!amendText.trim() || busyAction === 'amend'}
              >
                <Ic n="sparkles" s={13}/> {busyAction === 'amend' ? 'Indienen…' : 'Stuur naar skill'}
              </button>
              <button className="pv2-btn" onClick={cancelAmend} disabled={busyAction === 'amend'}>
                Annuleer
              </button>
            </div>
          </div>
        )}

        {/* Variant switcher */}
        {variants.length > 1 && (
          <div className="pv2-variant-bar">
            <button
              className="pv2-variant-arrow"
              disabled={variantIdx === 0}
              onClick={() => setVariantIdx(v => Math.max(0, v - 1))}
            >
              <Ic n="chev-l" s={14}/>
            </button>
            <div className="pv2-variant">
              <Ic n="sparkles" s={13}/>
              <span>{variants[variantIdx].label}</span>
              <span className="pv2-variant-num">{variantIdx + 1}/{variants.length}</span>
            </div>
            <button
              className="pv2-variant-arrow"
              disabled={variantIdx === variants.length - 1}
              onClick={() => setVariantIdx(v => Math.min(variants.length - 1, v + 1))}
            >
              <Ic n="chev-r" s={14}/>
            </button>
          </div>
        )}

        {/* Composer */}
        {variants.length > 0 && (
          <div className="pv2-compose" style={{ marginTop: 16 }}>
            <div className="pv2-compose-row">
              <span className="pv2-compose-label">Aan</span>
              {mail.from_email && (
                <span className="pv2-recipient-chip">
                  {mail.from_email}
                  <button title="Verwijder" type="button"><Ic n="x" s={11}/></button>
                </span>
              )}
              <input className="pv2-compose-input" style={{ minWidth: 60, flex: 1 }} placeholder="Voeg ontvanger toe…"/>
              {!showCc && <button className="pv2-compose-cc" type="button" onClick={() => setShowCc(true)}>+ Cc / Bcc</button>}
            </div>
            {showCc && (
              <div className="pv2-compose-row">
                <span className="pv2-compose-label">Cc</span>
                <input className="pv2-compose-input" placeholder="Cc-ontvangers"/>
                <button className="pv2-compose-cc" type="button" onClick={() => setShowCc(false)}>verberg</button>
              </div>
            )}
            <div className="pv2-compose-row">
              <span className="pv2-compose-label">Onderwerp</span>
              <input
                className="pv2-compose-input pv2-compose-subject"
                value={subject}
                onChange={e => setSubject(e.target.value)}
              />
              <span className="pv2-draft-tag"><span className="pv2-draft-tag-dot"/>Concept</span>
            </div>
            <div className="pv2-compose-format">
              <button className="pv2-fmt-select" title="Lettertype">Aptos <Ic n="chev" s={11}/></button>
              <button className="pv2-fmt-select" style={{ minWidth: 48 }} title="Grootte">11 <Ic n="chev" s={11}/></button>
              <span className="pv2-fmt-sep"/>
              <div className="pv2-fmt-group">
                <button className="pv2-fmt-btn" title="Vet" style={{ fontWeight: 700 }}>B</button>
                <button className="pv2-fmt-btn" title="Cursief" style={{ fontStyle: 'italic' }}>I</button>
                <button className="pv2-fmt-btn" title="Onderstrepen" style={{ textDecoration: 'underline' }}>U</button>
                <button className="pv2-fmt-btn" title="Doorhalen" style={{ textDecoration: 'line-through' }}>S</button>
              </div>
              <span className="pv2-fmt-sep"/>
              <div className="pv2-fmt-group">
                <button className="pv2-fmt-btn" title="Tekstkleur">
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                    <span style={{ fontWeight: 700, fontSize: 11, lineHeight: 1 }}>A</span>
                    <span className="pv2-fmt-color-swatch" style={{ background: '#dc6f3f' }}/>
                  </span>
                </button>
                <button className="pv2-fmt-btn" title="Markeer">
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                    <span style={{ fontSize: 11, lineHeight: 1 }}>✎</span>
                    <span className="pv2-fmt-color-swatch" style={{ background: '#fde047' }}/>
                  </span>
                </button>
              </div>
              <span className="pv2-fmt-sep"/>
              <div className="pv2-fmt-group">
                <button className="pv2-fmt-btn" title="Opsomming"><Ic n="list" s={14}/></button>
                <button className="pv2-fmt-btn" title="Genummerd">1.</button>
                <button className="pv2-fmt-btn" title="Inspringen links">←</button>
                <button className="pv2-fmt-btn" title="Inspringen rechts">→</button>
              </div>
              <span className="pv2-fmt-sep"/>
              <div className="pv2-fmt-group">
                <button className="pv2-fmt-btn" title="Link">⧉</button>
                <button className="pv2-fmt-btn" title="Bijlage"><Ic n="paperclip" s={14}/></button>
                <button className="pv2-fmt-btn" title="Citaat">”</button>
              </div>
              <span className="pv2-fmt-sep"/>
              <button
                className="pv2-fmt-btn"
                style={{ width: 'auto', padding: '0 8px', gap: 4, color: 'var(--pv2-orange-deep)', fontWeight: 600 }}
                title="Aanpassen met AI"
                onClick={toggleAmend}
              >
                <Ic n="sparkles" s={13}/> AI
              </button>
              <div style={{ flex: 1 }}/>
              <button className="pv2-fmt-btn" title="Meer"><Ic n="more" s={14}/></button>
            </div>
            <div className="pv2-compose-body-wrap">
              <ComposeBody body={body} setBody={setBody}/>
              <div className="pv2-sig-divider">
                <span>Handtekening</span>
                <span style={{ flex: 1, height: 1, background: 'var(--pv2-border-soft)' }}/>
              </div>
              <div style={{ padding: '8px 22px 18px', fontFamily: '"Aptos","Calibri","Segoe UI",sans-serif', fontSize: 14, lineHeight: 1.55, color: '#252525' }}>
                <div style={{ fontWeight: 600 }}>Jelle Burggraaf</div>
                <div style={{ color: '#595959', fontSize: 13 }}>Founder · Legal Mind</div>
                <div style={{ color: '#595959', fontSize: 13 }}>jelle@legal-mind.nl</div>
              </div>
            </div>
            <div className="pv2-compose-foot">
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <button className="pv2-btn pv2-btn-icon pv2-btn-ghost" title="Bijlage"><Ic n="paperclip" s={15}/></button>
                <button className="pv2-btn pv2-btn-icon pv2-btn-ghost" title="Verwijder concept" onClick={() => ignoreToFolder(null)}><Ic n="trash" s={15}/></button>
                <span style={{ fontSize: 11.5, color: 'var(--pv2-neutral-500)', fontFamily: 'var(--pv2-font-mono)', marginLeft: 6 }}>Skill-concept</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="pv2-btn" onClick={() => ignoreToFolder(null)} disabled={busyAction === 'ignore'}>Negeren</button>
                <button className="pv2-btn pv2-btn-primary" onClick={send} disabled={busyAction === 'send'}>
                  <Ic n="send" s={14}/> {busyAction === 'send' ? 'Bezig…' : 'Plaats concept'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Thread — full chain met body_text/body_html via get_thread_messages */}
        {threadMessages && threadMessages.length > 0 && (
          <>
            <div className="pv2-thread-head">
              <span>{threadMessages.length} berich{threadMessages.length === 1 ? 't' : 'ten'} in conversatie</span>
            </div>
            {threadMessages.map((m, idx) => (
              <ThreadMessage key={m.id || idx} msg={m} idx={idx} />
            ))}
          </>
        )}
      </div>

      {/* Reason-modal voor 'Afhandelen + leerregel' / 'Door collega' */}
      {reasonModal && (
        <ReasonModal
          opts={reasonModal}
          onCancel={() => setReasonModal(null)}
          onConfirm={(extra) => {
            const opts = {
              pattern_type: reasonModal.pattern_type,
              pattern_value: reasonModal.skipPattern ? null : (extra.pattern || reasonModal.pattern_value),
              reason_kind: reasonModal.reason_kind,
              reason: extra.text,
            }
            setReasonModal(null)
            onAction('ignore_with_rule', opts)
          }}
        />
      )}
    </section>
  )
}

// =============================================================================
// ReasonModal — voor Afhandelen + leerregel / Door collega
// =============================================================================
function ReasonModal({ opts, onCancel, onConfirm }) {
  const [text, setText] = useState('')
  const [pattern, setPattern] = useState('')
  const askPattern = !!opts.askPattern
  const canSubmit = askPattern ? pattern.trim().length >= 2 : true
  const title = opts.skipPattern
    ? '👥 Afgehandeld door collega'
    : askPattern ? '✏ Eigen leerregel' : '🚫 Leerregel toevoegen'

  return (
    <div className="pv2-modal-backdrop" onClick={onCancel}>
      <div className="pv2-modal-card" onClick={e => e.stopPropagation()}>
        <div className="pv2-modal-title">{title}</div>
        <div className="pv2-modal-prompt">{opts.prompt}</div>

        {askPattern && (
          <>
            <label className="pv2-modal-label">Sleutelwoord in onderwerp / inhoud</label>
            <input
              className="pv2-modal-input"
              type="text"
              value={pattern}
              onChange={e => setPattern(e.target.value)}
              autoFocus
              placeholder='bv. teams meeting, uitnodiging, factuur'
            />
          </>
        )}

        <label className="pv2-modal-label">Toelichting {askPattern ? '(optioneel)' : ''}</label>
        <textarea
          className="pv2-modal-input"
          value={text}
          onChange={e => setText(e.target.value)}
          rows={3}
          autoFocus={!askPattern}
          placeholder={
            opts.skipPattern
              ? 'bv. "Mark heeft hem opgepakt"'
              : askPattern
                ? 'bv. "is een teams meeting, wil ik niet meer hebben"'
                : 'Korte uitleg waarom (wordt later getoond bij Regels)…'
          }
        />

        <div className="pv2-modal-actions">
          <button className="pv2-btn" onClick={onCancel}>Annuleer</button>
          <button
            className="pv2-btn pv2-btn-primary"
            onClick={() => onConfirm({ text, pattern: pattern.trim() })}
            disabled={!canSubmit}
          >
            {opts.skipPattern ? 'Afhandelen' : 'Afhandelen + onthoud'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Main view
// ============================================================================
export default function PostvakV2View({ data, onNavigate, bus }) {
  // Bus is verplicht — App.jsx levert {activeTab, setActiveTab, counts,
  // folderTree, actionedIds, setActionedIds, inbox}. Deze view is content-only:
  // sidebar + tabs leven globaal in de app-Sidebar.
  if (!bus) {
    return <div style={{ padding: 24 }}>PostvakV2View vereist een bus-prop.</div>
  }
  const { activeTab, setActiveTab, actionedIds, setActionedIds, inbox } = bus
  const { pending, awaiting, pinPool, sentDrafts, decidedIds } = inbox

  const [filter, setFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  const [busyAction, setBusyAction] = useState(null)

  const mails        = data?.autodraftMails       || []
  const categories   = data?.autodraftCategories  || []
  const folders      = data?.autodraftFolders     || []
  const mailMessages = data?.mailMessages         || []

  // Verrijk een pool met categorie-styling
  function enrich(arr) {
    return arr.map(m => ({ ...m, _category: categoryStyle(m.category_key, categories) }))
  }

  // ===== Tab-filter — kies de juiste pool =====
  const tabFiltered = useMemo(() => {
    let pool
    switch (activeTab) {
      case 'voor-jou':   pool = pending.filter(m => m.audience === 'for_you'); break
      case 'pin':        pool = pinPool; break
      case 'wachten':    pool = awaiting; break
      case 'niet-jou':   pool = pending.filter(m => m.audience === 'not_for_you'); break
      case 'logs':       pool = mails.filter(m => decidedIds.has(m.mail_id)); break
      default:           pool = pending
    }
    pool = pool.filter(m => !actionedIds.has(m.mail_id))
    return enrich(pool)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, pending, pinPool, awaiting, sentDrafts, mails, decidedIds, actionedIds, categories])

  // Filter chips — categorie-counts (Aandeelhouder vervangt Partner)
  const filters = useMemo(() => {
    const groups = { all: 0, intern: 0, aandeelhouder: 0, klant: 0, overig: 0 }
    for (const m of tabFiltered) {
      groups.all += 1
      const k = m.category_key === 'partner' ? 'aandeelhouder' : (m.category_key || 'overig')
      if (groups[k] !== undefined) groups[k] += 1
      else groups.overig += 1
    }
    return [
      { id: 'all',           label: 'Alles',          count: groups.all,           dot: null },
      { id: 'intern',        label: 'Intern',         count: groups.intern,        dot: '#2563eb' },
      { id: 'klant',         label: 'Klant',          count: groups.klant,         dot: '#059669' },
      { id: 'aandeelhouder', label: 'Aandeelhouder',  count: groups.aandeelhouder, dot: '#dc2626' },
      { id: 'overig',        label: 'Overig',         count: groups.overig,        dot: '#94a3b8' },
    ].filter(f => f.count > 0 || f.id === 'all')
  }, [tabFiltered])

  const filtered = useMemo(() => {
    if (filter === 'all') return tabFiltered
    return tabFiltered.filter(m => {
      const k = m.category_key === 'partner' ? 'aandeelhouder' : (m.category_key || 'overig')
      return k === filter
    })
  }, [tabFiltered, filter])

  const buckets = useMemo(() => bucketByDay(filtered), [filtered])

  // Auto-select eerste mail
  useEffect(() => {
    if (!selectedId && filtered.length > 0) {
      setSelectedId(filtered[0].mail_id)
    } else if (selectedId && !filtered.find(m => m.mail_id === selectedId)) {
      setSelectedId(filtered[0]?.mail_id || null)
    }
  }, [filtered, selectedId])

  // Selectie kan in elke tab-pool zitten — ALL-pool zoeken
  const allMailsForSelect = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const m of [...pending, ...awaiting, ...sentDrafts, ...mails]) {
      if (!m.mail_id || seen.has(m.mail_id)) continue
      seen.add(m.mail_id)
      out.push({ ...m, _category: categoryStyle(m.category_key, categories) })
    }
    return out
  }, [pending, awaiting, sentDrafts, mails, categories])

  const selected = useMemo(
    () => allMailsForSelect.find(m => m.mail_id === selectedId),
    [allMailsForSelect, selectedId]
  )

  // Thread via get_thread_messages RPC
  const [threadFull, setThreadFull] = useState(null)
  useEffect(() => {
    const cid = selected?.conversation_id
    if (!cid) { setThreadFull(null); return }
    let cancelled = false
    setThreadFull(null)
    ;(async () => {
      try {
        const { data } = await supabase.rpc('get_thread_messages', { p_conversation_id: cid })
        if (!cancelled) setThreadFull(Array.isArray(data) ? data : [])
      } catch { /* best-effort */ }
    })()
    return () => { cancelled = true }
  }, [selected?.conversation_id])

  const threadMessages = useMemo(() => {
    if (!selected?.conversation_id) return []
    if (threadFull && threadFull.length > 0) {
      return [...threadFull].sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
    }
    return mailMessages
      .filter(m => m.conversation_id === selected.conversation_id)
      .sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
  }, [selected, threadFull, mailMessages])

  // RAG-health: gewicht uit data.ragOutcomes deze week, anders '—'
  const ragHealth = useMemo(() => {
    const ragOut = data?.ragOutcomes || []
    if (!Array.isArray(ragOut) || ragOut.length === 0) {
      return { week: getWeekNumber(new Date()), coverage: '—', fireflies: '—', p95: '—' }
    }
    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const recent = ragOut.filter(r => new Date(r.created_at || r.outcome_at) >= weekAgo)
    if (recent.length === 0) {
      return { week: getWeekNumber(now), coverage: '—', fireflies: '—', p95: '—' }
    }
    const withCtx = recent.filter(r => r.has_context).length
    const coverage = recent.length > 0 ? Math.round((withCtx / recent.length) * 100) + '%' : '—'
    const fireflies = recent.filter(r => (r.fact_types || []).includes && (r.fact_types || []).includes('fireflies')).length
    return { week: getWeekNumber(now), coverage, fireflies: fireflies + '×', p95: '—' }
  }, [data?.ragOutcomes])

  // Pin-toggle vanuit de lijst
  const handleTogglePin = useCallback(async (mailId, newVal) => {
    try {
      await supabase.rpc('set_mail_flag', { p_mail_id: mailId, p_flag: newVal })
    } catch { /* best-effort */ }
  }, [])

  // ---- Action handler — submit_autodraft_decision + mark_mail_processed ----
  const handleAction = useCallback(async (action, opts = {}) => {
    if (!selected || busyAction) return
    setBusyAction(action)
    const hideActions = ['send', 'ignore', 'spam', 'processed']
    if (hideActions.includes(action)) {
      setActionedIds(prev => new Set(prev).add(selected.mail_id))
    }
    try {
      let rpcRes, error

      if (action === 'processed') {
        const res = await supabase.rpc('mark_mail_processed', {
          p_mail_id: selected.mail_id,
          p_reason: 'Al verwerkt in Outlook',
        })
        rpcRes = res.data; error = res.error
      } else if (action === 'ignore_with_rule') {
        const res = await supabase.rpc('submit_autodraft_decision_with_rule', {
          p_mail_id: selected.mail_id,
          p_pattern_type: opts.pattern_type,
          p_pattern_value: opts.pattern_value,
          p_reason_kind: opts.reason_kind,
          p_reason: opts.reason,
          p_target_folder: opts.target_folder || null,
        })
        rpcRes = res.data; error = res.error
      } else {
        const variants = Array.isArray(selected.draft_variants) ? selected.draft_variants : []
        const trackVariant = ['send', 'amend'].includes(action) && variants.length > 0
        const chosenIdx = trackVariant ? Math.max(0, Math.min(opts.variantIdx ?? 0, variants.length - 1)) : null
        const chosenLabel = trackVariant ? (variants[chosenIdx]?.label ?? null) : null
        const res = await supabase.rpc('submit_autodraft_decision', {
          p_mail_id: selected.mail_id,
          p_action: action,
          p_amend: action === 'amend' ? (opts.amend || null) : null,
          p_final_subject: action === 'send' ? (opts.subject || selected.draft_subject || null) : null,
          p_final_body:    action === 'send' ? (opts.body    || selected.draft_body    || null) : null,
          p_target_folder: opts.target_folder || null,
          p_decision_kind: opts.decision_kind || 'reply',
          p_final_to:      opts.final_to || null,
          p_chosen_variant_index: chosenIdx,
          p_chosen_variant_label: chosenLabel,
        })
        rpcRes = res.data; error = res.error
      }

      if (error) {
        showToast({ kind: 'error', message: 'Actie mislukt', detail: error.message })
        if (hideActions.includes(action)) {
          setActionedIds(prev => { const n = new Set(prev); n.delete(selected.mail_id); return n })
        }
      } else if (rpcRes && rpcRes.ok === false) {
        showToast({ kind: 'error', message: 'Actie geweigerd', detail: rpcRes.reason || 'mislukt' })
        if (hideActions.includes(action)) {
          setActionedIds(prev => { const n = new Set(prev); n.delete(selected.mail_id); return n })
        }
      } else {
        if (action === 'send') {
          showToast({ message: 'Concept onderweg naar Outlook', detail: 'Skill maakt de Outlook-draft binnen enkele seconden.' })
        } else if (action === 'ignore') {
          showToast({ kind: 'info', message: opts.target_folder ? `Verplaatst naar ${opts.target_folder}` : 'Mail genegeerd' })
        } else if (action === 'ignore_with_rule') {
          showToast({ message: 'Afgehandeld + regel onthouden' })
        } else if (action === 'spam') {
          showToast({ kind: 'info', message: 'Gemarkeerd als spam' })
        } else if (action === 'processed') {
          showToast({ kind: 'info', message: 'Al verwerkt in Outlook', detail: 'Verborgen uit Postvak.' })
        } else if (action === 'amend') {
          showToast({ kind: 'info', message: 'Amend ingediend', detail: 'Skill schrijft nieuwe varianten.' })
        }
      }
    } catch (e) {
      showToast({ kind: 'error', message: 'Netwerkfout', detail: e.message })
      if (hideActions.includes(action)) {
        setActionedIds(prev => { const n = new Set(prev); n.delete(selected.mail_id); return n })
      }
    }
    setBusyAction(null)
  }, [selected, busyAction, setActionedIds])

  const tabTitle = ({
    'voor-jou': 'Voor jou',
    'pin': 'Pin',
    'wachten': 'In afwachting',
    'niet-jou': 'Niet voor jou',
    'logs': 'Logs',
  })[activeTab] || 'Postvak'

  return (
    <>
      <PostvakV2Styles/>
      <div className="pv2-content">
        <div className="pv2-card">
          <ListPane
            buckets={buckets}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            filter={filter}
            setFilter={setFilter}
            filters={filters}
            title={tabTitle}
            ragHealth={ragHealth}
            onTogglePin={handleTogglePin}
          />
          <DetailPane
            mail={selected}
            threadMessages={threadMessages}
            categories={categories}
            folders={folders}
            onAction={handleAction}
            busyAction={busyAction}
          />
        </div>
      </div>
    </>
  )
}

function getWeekNumber(d) {
  const date = new Date(d.getTime())
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7)
  const week1 = new Date(date.getFullYear(), 0, 4)
  return 1 + Math.round(((date - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7)
}

// ============================================================================
// Inline scoped styles — pv2- prefix matcht nergens met de rest van de app
// ============================================================================
function PostvakV2Styles() {
  return (
    <style>{`
/* Fonts worden globaal geladen via index.html (Instrument Sans + Geist).
   Host Grotesk wordt niet meer gebruikt; Instrument Sans neemt het over. */

.pv2-content {
  --pv2-slate-100:#f1f5f9; --pv2-slate-700:#334155;
  --pv2-neutral-400:#a6a6a6; --pv2-neutral-500:#737373; --pv2-neutral-700:#404040;
  --pv2-orange:#dc6f3f; --pv2-orange-subtle:#f9e5dd; --pv2-orange-deep:#8b4628;
  --pv2-ink:#121212; --pv2-paper:#ffffff; --pv2-paper-2:#fafaf8; --pv2-paper-3:#f5f4f0;
  --pv2-error:#dc2626; --pv2-success:#16a34a; --pv2-warning:#d97706; --pv2-info:#2563eb;
  --pv2-border:#e7e5df; --pv2-border-soft:#efece5; --pv2-border-strong:#cbc7bb;
  --pv2-font-sans:"Instrument Sans", system-ui, -apple-system, sans-serif;
  --pv2-font-mono:"Geist", ui-monospace, Menlo, monospace;
  --pv2-font-accent:var(--pv2-font-sans);
  --pv2-shadow-sm:0 1px 2px rgba(15,15,15,.04), 0 1px 1px rgba(15,15,15,.03);
  --pv2-shadow-pop:0 2px 4px -2px rgba(15,15,15,.10), 0 12px 28px -8px rgba(15,15,15,.18);

  font-family:var(--pv2-font-sans);
  color:var(--pv2-ink);
  background:var(--pv2-paper-3);
  font-size:14px; line-height:1.5;
  -webkit-font-smoothing:antialiased;
  text-rendering:optimizeLegibility;

  /* Content-only — globale Sidebar staat ernaast in App.jsx-shell */
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  height: 100vh;
  width: 100%;
  padding: 10px;
  overflow: hidden;
}
.pv2-content *, .pv2-content *::before, .pv2-content *::after { box-sizing:border-box; }
.pv2-content button { font-family:inherit; color:inherit; }
.pv2-svg { stroke:currentColor; fill:none; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; }
.pv2-stat-sep { color:var(--pv2-border-strong); }

/* Mail-rij in drag */
.pv2-row[draggable="true"]:active { cursor:grabbing; }

.pv2-btn {
  display:inline-flex; align-items:center; gap:7px;
  height:32px; padding:0 13px;
  border-radius:8px; border:1px solid var(--pv2-border);
  background:#fff; color:var(--pv2-ink);
  font:500 13px var(--pv2-font-sans); cursor:pointer;
  transition:background .12s, border-color .12s, color .12s;
}
.pv2-btn:hover { background:var(--pv2-paper-2); border-color:var(--pv2-border-strong); }
.pv2-btn:disabled { opacity:.55; cursor:not-allowed; }
.pv2-btn-primary { background:var(--pv2-ink); color:#fff; border-color:var(--pv2-ink); padding:0 14px; }
.pv2-btn-primary:hover { background:#000; border-color:#000; }
.pv2-btn-ghost { border-color:transparent; background:transparent; }
.pv2-btn-ghost:hover { background:rgba(0,0,0,.05); }
.pv2-btn-icon { width:32px; height:32px; padding:0; justify-content:center; }

/* ====== Content card ====== */
.pv2-card {
  background:#fff;
  border:1px solid var(--pv2-border);
  border-radius:14px;
  overflow:hidden;
  display:grid;
  grid-template-columns: 380px minmax(0, 1fr);
  min-height:0;
  height: 100%;
  box-shadow:var(--pv2-shadow-sm);
}

/* ====== List pane ====== */
.pv2-list {
  border-right:1px solid var(--pv2-border-soft);
  display:grid; grid-template-rows: auto 1fr;
  min-height:0;
}
.pv2-list-head {
  padding:14px 18px 10px;
  border-bottom:1px solid var(--pv2-border-soft);
  display:flex; flex-direction:column; gap:10px;
  background:#fff;
}
.pv2-list-title-row { display:flex; align-items:center; justify-content:space-between; }
.pv2-list-title { font-size:18px; font-weight:600; letter-spacing:-.012em; color:var(--pv2-ink); }
.pv2-list-stats {
  display:flex; align-items:center; gap:14px;
  font-size:11.5px; color:var(--pv2-neutral-500);
  font-family:var(--pv2-font-mono);
  flex-wrap:wrap;
}
.pv2-list-stats b { color:var(--pv2-ink); font-weight:600; }

.pv2-filters { display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
.pv2-chip {
  display:inline-flex; align-items:center; gap:6px;
  height:26px; padding:0 10px;
  border-radius:9999px;
  background:transparent; color:var(--pv2-neutral-700);
  border:1px solid transparent;
  font:500 12px var(--pv2-font-sans); cursor:pointer;
  transition:all .12s;
}
.pv2-chip:hover { background:var(--pv2-paper-2); }
.pv2-chip.pv2-active { background:var(--pv2-ink); color:#fff; }
.pv2-chip-dot { width:7px; height:7px; border-radius:9999px; }
.pv2-chip-count { font-family:var(--pv2-font-mono); font-size:11px; opacity:.75; margin-left:2px; }

.pv2-list-scroll { overflow-y:auto; min-height:0; }
.pv2-list-day {
  display:flex; align-items:center; justify-content:space-between;
  padding:14px 18px 6px;
  font-size:10.5px; font-weight:600; letter-spacing:.08em;
  text-transform:uppercase; color:var(--pv2-neutral-400);
  background:#fff; position:sticky; top:0; z-index:1;
}
.pv2-list-day-count { font-family:var(--pv2-font-mono); color:var(--pv2-neutral-400); }

.pv2-row {
  position:relative;
  padding:11px 18px 12px 18px;
  border-bottom:1px solid var(--pv2-border-soft);
  cursor:pointer;
  display:grid;
  grid-template-columns: 1fr auto;
  gap:6px 10px;
  transition:background .12s;
}
.pv2-row::before {
  content:""; position:absolute; left:0; top:0; bottom:0; width:3px;
  background:transparent; transition:background .12s;
}
.pv2-row:hover { background:#fcfbf8; }
.pv2-row.pv2-selected { background:#fbf6f1; }
.pv2-row.pv2-selected::before { background:var(--pv2-orange); }
.pv2-row.pv2-unread .pv2-row-from, .pv2-row.pv2-unread .pv2-row-subject { font-weight:600; }
.pv2-row-from {
  font-size:13.5px; color:var(--pv2-ink); font-weight:500;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  display:flex; align-items:center; gap:6px;
}
.pv2-cat-dot { width:7px; height:7px; border-radius:9999px; flex-shrink:0; }
.pv2-row-meta {
  display:flex; align-items:center; gap:8px;
  font-size:11.5px; color:var(--pv2-neutral-500);
  font-family:var(--pv2-font-mono);
}
.pv2-row-subject {
  grid-column:1 / -1;
  font-size:13.5px; color:var(--pv2-ink);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  letter-spacing:-.005em;
}
.pv2-row-snippet {
  grid-column:1 / -1;
  font-size:12.5px; color:var(--pv2-neutral-500);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
}
.pv2-row-foot { grid-column:1 / -1; display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-top:2px; }

.pv2-pill {
  display:inline-flex; align-items:center; gap:5px;
  height:20px; padding:0 8px;
  border-radius:9999px;
  font:500 11px var(--pv2-font-sans);
  background:var(--pv2-paper-2); color:var(--pv2-neutral-700);
  border:1px solid var(--pv2-border-soft);
}
.pv2-pill-dot { width:6px; height:6px; border-radius:9999px; }
.pv2-pill-cat-intern { background:#eef3fb; color:#1e3a73; border-color:#dde8f6; }
.pv2-pill-cat-share { background:#fdecec; color:#7c1f1f; border-color:#f7d8d8; }
.pv2-pill-cat-partner { background:#f3ecfb; color:#5a2b8a; border-color:#e7d8f5; }
.pv2-pill-cat-klant { background:#e8f5ec; color:#1a5236; border-color:#cfe7d6; }
.pv2-pill-cat-overig { background:#f3f1ec; color:#5a4d36; border-color:#e6e0d2; }
.pv2-pill-status-plan { background:#fff5e6; color:#8a4d0c; border-color:#fde6c4; }
.pv2-pill-meta {
  display:inline-flex; align-items:center; gap:4px;
  height:20px; padding:0 8px;
  border-radius:9999px;
  font:500 11px var(--pv2-font-mono);
  color:var(--pv2-neutral-500); background:transparent;
}
.pv2-pill-meta svg { width:11px; height:11px; }
.pv2-pill-done { background:#eaf5ee; color:#1d6b3a; border-color:#d6ecdf; }

/* ====== Detail pane ====== */
.pv2-detail {
  display:grid; grid-template-rows: auto 1fr;
  min-height:0;
  background:var(--pv2-paper-2);
}
.pv2-detail-empty { padding:60px 28px; }
.pv2-empty { padding:40px 24px; text-align:center; color:var(--pv2-neutral-500); }
.pv2-empty-title { font-size:15px; font-weight:600; color:var(--pv2-ink); margin-bottom:4px; }
.pv2-empty-sub { font-size:13px; }

.pv2-det-head {
  padding:18px 28px 14px;
  background:#fff;
  border-bottom:1px solid var(--pv2-border-soft);
  display:flex; flex-direction:column; gap:10px;
}
.pv2-det-meta-row { display:flex; align-items:flex-start; gap:14px; justify-content:space-between; }
.pv2-det-from { display:flex; align-items:center; gap:12px; min-width:0; }
.pv2-av {
  border-radius:9999px; flex-shrink:0;
  display:flex; align-items:center; justify-content:center;
  font-family:var(--pv2-font-accent); font-weight:500;
}
.pv2-av-orange { background:var(--pv2-orange-subtle); color:var(--pv2-orange-deep); }
.pv2-av-dark { background:var(--pv2-ink); color:#fff; }
.pv2-av-slate { background:var(--pv2-slate-100); color:var(--pv2-slate-700); }
.pv2-det-name { font-size:15px; font-weight:600; color:var(--pv2-ink); letter-spacing:-.005em; }
.pv2-det-email { font-size:12px; color:var(--pv2-neutral-500); font-family:var(--pv2-font-mono); }
.pv2-det-recipients { font-size:12px; color:var(--pv2-neutral-500); display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.pv2-det-recipients b { color:var(--pv2-neutral-700); font-weight:500; }
.pv2-det-time { font-family:var(--pv2-font-mono); font-size:11.5px; color:var(--pv2-neutral-500); flex-shrink:0; white-space:nowrap; }
.pv2-det-subject {
  font-size:24px; font-weight:600; letter-spacing:-.018em; line-height:1.2;
  color:var(--pv2-ink); margin:2px 0 0;
}
.pv2-det-tools { display:flex; align-items:center; gap:6px; flex-shrink:0; }
.pv2-score-ring { width:42px; height:42px; position:relative; flex-shrink:0; }
.pv2-score-ring svg { transform:rotate(-90deg); width:100%; height:100%; }
.pv2-score-ring .pv2-ring-bg { stroke:var(--pv2-border); fill:none; stroke-width:3.5; }
.pv2-score-ring .pv2-ring-fg { stroke:var(--pv2-success); fill:none; stroke-width:3.5; stroke-linecap:round; }
.pv2-score-num {
  position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  font:600 11px var(--pv2-font-mono); color:var(--pv2-success);
}

/* Skill insight */
.pv2-insight {
  margin:0 28px;
  padding:12px 14px;
  background:linear-gradient(180deg, #fbf3ee, #fff);
  border:1px solid #f1dfd0;
  border-radius:10px;
  display:flex; gap:10px; align-items:flex-start;
  font-size:13px; line-height:1.45;
  color:var(--pv2-ink);
}
.pv2-insight-icon { width:20px; height:20px; flex-shrink:0; color:var(--pv2-orange); margin-top:1px; }
.pv2-insight b { color:var(--pv2-orange-deep); font-weight:600; }
.pv2-insight-meta { color:var(--pv2-neutral-500); font-size:12px; }

/* AI action toolbar */
.pv2-toolbar {
  margin:14px 28px 0;
  padding:6px;
  display:flex; align-items:center; gap:4px;
  background:#fff;
  border:1px solid var(--pv2-border);
  border-radius:11px;
  box-shadow:var(--pv2-shadow-sm);
  overflow-x:auto;
}
.pv2-tool {
  display:inline-flex; align-items:center; gap:7px;
  height:34px; padding:0 12px;
  border:0; background:transparent; border-radius:7px;
  font:500 13px var(--pv2-font-sans); color:var(--pv2-neutral-700);
  cursor:pointer; white-space:nowrap;
  transition:background .12s, color .12s;
}
.pv2-tool:hover:not(:disabled) { background:var(--pv2-paper-2); color:var(--pv2-ink); }
.pv2-tool:disabled { opacity:.45; cursor:not-allowed; }
.pv2-tool.pv2-primary { background:var(--pv2-ink); color:#fff; padding:0 14px; }
.pv2-tool.pv2-primary:hover:not(:disabled) { background:#000; }
.pv2-tool.pv2-danger { color:var(--pv2-error); }
.pv2-tool.pv2-danger:hover:not(:disabled) { background:#fdecec; }
.pv2-tool svg { width:15px; height:15px; flex-shrink:0; }
.pv2-tool-sep { width:1px; height:18px; background:var(--pv2-border-soft); margin:0 2px; flex-shrink:0; }
.pv2-tool-spread { flex:1; }

.pv2-meta-pickers { display:flex; align-items:center; gap:6px; padding-right:4px; }
.pv2-picker {
  display:inline-flex; align-items:center; gap:6px;
  height:30px; padding:0 10px;
  border:1px solid var(--pv2-border);
  background:#fff;
  border-radius:7px;
  font:500 12px var(--pv2-font-sans); color:var(--pv2-neutral-700);
  cursor:pointer;
  max-width:230px;
  appearance:none;
  -webkit-appearance:none;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>");
  background-repeat:no-repeat;
  background-position:right 8px center;
  background-size:11px 11px;
  padding-right:26px;
}
.pv2-picker:hover { border-color:var(--pv2-border-strong); }

/* Amend-box (inline textarea ipv window.prompt) */
.pv2-amend {
  margin:14px 28px 0;
  padding:14px 16px;
  background:linear-gradient(180deg, #fbf3ee, #fff);
  border:1px solid #f1dfd0;
  border-radius:11px;
  box-shadow:var(--pv2-shadow-sm);
  display:flex; flex-direction:column; gap:8px;
}
.pv2-amend-label {
  font:600 11px var(--pv2-font-mono); letter-spacing:.04em; text-transform:uppercase;
  color:var(--pv2-orange-deep);
}
.pv2-amend-input {
  width:100%; padding:10px 12px;
  border:1px solid var(--pv2-border);
  border-radius:7px;
  background:#fff; color:var(--pv2-ink);
  font:400 13.5px var(--pv2-font-sans); line-height:1.5;
  resize:vertical; min-height:64px;
  outline:none;
  transition:border-color .12s;
}
.pv2-amend-input:focus { border-color:var(--pv2-orange); }
.pv2-amend-actions { display:flex; gap:8px; }

.pv2-tool-active { background:var(--pv2-orange-subtle); color:var(--pv2-orange-deep); }

/* Thread-message uitklap + body-html */
.pv2-msg[data-expanded="true"] .pv2-msg-toggle { color: var(--pv2-ink); }
.pv2-msg-toggle {
  margin-left: 6px; color: var(--pv2-neutral-400);
  font-size: 10px;
}
.pv2-msg-body-html {
  font-family: "Aptos","Calibri","Segoe UI",sans-serif;
  font-size: 14px; line-height: 1.6;
  color: #252525;
  word-wrap: break-word;
  overflow-x: auto;
}
.pv2-msg-body-html img { max-width: 100%; height: auto; }
.pv2-msg-body-html a { color: #2563eb; text-decoration: underline; }
.pv2-msg-body-html blockquote {
  border-left: 3px solid var(--pv2-border);
  margin: 8px 0; padding: 4px 0 4px 12px;
  color: var(--pv2-neutral-700);
}
.pv2-msg-body-html pre { background: var(--pv2-paper-2); padding: 8px; border-radius: 6px; overflow-x: auto; }
.pv2-msg-body-html table { border-collapse: collapse; }
.pv2-msg-body-html td, .pv2-msg-body-html th { border: 1px solid var(--pv2-border); padding: 4px 8px; }
.pv2-msg-body-collapsed {
  font-size: 12.5px; color: var(--pv2-neutral-500);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  margin-top: 4px;
}
.pv2-msg-truncated {
  font-size: 11px; color: var(--pv2-warning);
  font-family: var(--pv2-font-mono);
  margin-top: 8px;
  padding: 6px 10px;
  background: #fff7e6;
  border-radius: 6px;
}

/* Pin-knop op mail-rij — toonbaarder dan compact star */
.pv2-row-pin {
  width:22px; height:22px;
  border:0; background:transparent;
  border-radius:5px;
  display:inline-flex; align-items:center; justify-content:center;
  cursor:pointer;
  color:var(--pv2-neutral-400);
  transition: color .12s, background .12s;
}
.pv2-row-pin:hover { background:rgba(0,0,0,.06); color:var(--pv2-ink); }
.pv2-row-pin.is-active { color:var(--pv2-orange); }
.pv2-row-aan {
  color:var(--pv2-neutral-500);
  font-weight: 400;
  margin-right: 2px;
}
.pv2-row-awaiting .pv2-row-from { color: var(--pv2-neutral-700); }
.pv2-pill-waiting {
  background:#fff7e6; color:#8a4d0c; border-color:#fde6c4;
}
.pv2-popover-item-sub {
  font-size: 11.5px;
  color: var(--pv2-neutral-500);
  margin-top: 2px;
  line-height: 1.4;
  white-space: normal;
}

/* Modal-overlay voor ReasonModal */
.pv2-modal-backdrop {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(0,0,0,0.35);
  display: flex; align-items: center; justify-content: center;
}
.pv2-modal-card {
  background: #fff;
  border: 1px solid var(--pv2-border);
  border-radius: 12px;
  padding: 22px 24px;
  width: 480px; max-width: 90vw;
  box-shadow: var(--pv2-shadow-pop);
  font-family: var(--pv2-font-sans);
}
.pv2-modal-title {
  font-size: 15px; font-weight: 600; margin-bottom: 6px;
  color: var(--pv2-ink);
}
.pv2-modal-prompt {
  font-size: 13px; color: var(--pv2-neutral-700);
  line-height: 1.5; margin-bottom: 14px;
}
.pv2-modal-label {
  display: block;
  font-size: 11px; font-weight: 600;
  color: var(--pv2-neutral-500);
  letter-spacing: .04em; text-transform: uppercase;
  margin-bottom: 4px; margin-top: 8px;
}
.pv2-modal-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--pv2-border);
  border-radius: 7px;
  background: #fff;
  color: var(--pv2-ink);
  font-family: inherit;
  font-size: 13px;
  outline: none;
  resize: vertical;
  transition: border-color .12s;
}
.pv2-modal-input:focus { border-color: var(--pv2-orange); }
.pv2-modal-actions {
  display: flex; justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

/* Popover (Afhandelen-menu) */
.pv2-popover {
  position:absolute; top:calc(100% + 6px); left:0;
  min-width:280px; max-width:340px;
  background:#fff;
  border:1px solid var(--pv2-border);
  border-radius:10px;
  box-shadow:var(--pv2-shadow-pop);
  padding:6px;
  z-index:100;
  animation:pv2-popover-in .12s cubic-bezier(0.16,1,0.3,1);
}
@keyframes pv2-popover-in {
  from { opacity:0; transform:translateY(-4px); }
  to   { opacity:1; transform:translateY(0); }
}
.pv2-popover-section { display:flex; flex-direction:column; gap:1px; }
.pv2-popover-label {
  font-size:10.5px; font-weight:600; letter-spacing:.06em; text-transform:uppercase;
  color:var(--pv2-neutral-500);
  padding:6px 10px 4px;
}
.pv2-popover-item {
  display:flex; align-items:center; gap:10px;
  padding:8px 10px;
  border:0; background:transparent; border-radius:7px;
  cursor:pointer; color:var(--pv2-ink);
  font:500 13px var(--pv2-font-sans); text-align:left;
  width:100%;
  transition:background .12s;
}
.pv2-popover-item:hover { background:var(--pv2-paper-2); }
.pv2-popover-item svg { flex-shrink:0; color:var(--pv2-neutral-500); }
.pv2-popover-item-label { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pv2-popover-divider { height:1px; background:var(--pv2-border-soft); margin:6px 4px; }
.pv2-popover-danger { color:var(--pv2-error); }
.pv2-popover-danger svg { color:var(--pv2-error); }
.pv2-popover-danger:hover { background:#fdecec; }

/* Variant switcher */
.pv2-variant-bar {
  display:flex; align-items:center; justify-content:center; gap:10px;
  margin:14px 28px 0;
}
.pv2-variant {
  display:inline-flex; align-items:center; gap:8px;
  height:32px; padding:0 14px;
  background:#fff; border:1px solid var(--pv2-border);
  border-radius:9999px;
  font:500 12.5px var(--pv2-font-sans); color:var(--pv2-ink);
  box-shadow:var(--pv2-shadow-sm);
}
.pv2-variant-num {
  font-family:var(--pv2-font-mono); font-size:11px;
  color:var(--pv2-neutral-500); border-left:1px solid var(--pv2-border);
  padding-left:8px; margin-left:2px;
}
.pv2-variant-arrow {
  width:30px; height:30px; border-radius:9999px;
  border:1px solid var(--pv2-border); background:#fff;
  display:flex; align-items:center; justify-content:center;
  cursor:pointer; color:var(--pv2-neutral-700);
}
.pv2-variant-arrow:hover:not(:disabled) { background:var(--pv2-paper-2); }
.pv2-variant-arrow:disabled { opacity:.4; cursor:not-allowed; }

/* Compose */
.pv2-compose-scroll {
  overflow-y:auto; min-height:0;
  padding:18px 28px 32px;
  display:flex; flex-direction:column; gap:0;
}
.pv2-compose {
  background:#fff; border:1px solid var(--pv2-border);
  border-radius:12px;
  overflow:hidden;
  box-shadow:var(--pv2-shadow-sm);
}
.pv2-compose-row {
  display:flex; align-items:center; gap:10px;
  padding:11px 16px;
  border-bottom:1px solid var(--pv2-border-soft);
}
.pv2-compose-row:last-of-type { border-bottom:0; }
.pv2-compose-label {
  width:64px; flex-shrink:0;
  font-size:12px; color:var(--pv2-neutral-500);
  letter-spacing:.02em;
}
.pv2-compose-input {
  flex:1; min-width:0;
  border:0; outline:0; background:transparent;
  font:400 14px var(--pv2-font-sans); color:var(--pv2-ink);
}
.pv2-recipient-chip {
  display:inline-flex; align-items:center; gap:6px;
  height:24px; padding:0 4px 0 10px;
  background:var(--pv2-paper-2); border:1px solid var(--pv2-border-soft);
  border-radius:9999px;
  font:500 12px var(--pv2-font-sans); color:var(--pv2-ink);
}
.pv2-recipient-chip button {
  width:18px; height:18px; border:0; background:transparent; cursor:pointer; color:var(--pv2-neutral-500);
  border-radius:9999px; display:flex; align-items:center; justify-content:center;
}
.pv2-recipient-chip button:hover { background:rgba(0,0,0,.06); color:var(--pv2-ink); }
.pv2-compose-cc {
  font-size:12px; color:var(--pv2-neutral-500); cursor:pointer;
  border:0; background:transparent; padding:0;
}
.pv2-compose-cc:hover { color:var(--pv2-ink); text-decoration:underline; }
.pv2-compose-subject { font-weight:500; font-size:14.5px; }
.pv2-compose-format {
  display:flex; align-items:center; gap:2px; flex-wrap:wrap;
  padding:6px 10px;
  border-bottom:1px solid var(--pv2-border-soft);
  background:#fbfaf7;
}
.pv2-fmt-group { display:flex; align-items:center; gap:1px; }
.pv2-fmt-sep { width:1px; height:18px; background:var(--pv2-border); margin:0 4px; }
.pv2-fmt-btn {
  width:28px; height:28px; border:0; background:transparent; border-radius:5px;
  cursor:pointer; color:var(--pv2-neutral-700);
  display:flex; align-items:center; justify-content:center;
  font-size:12px; font-weight:500;
  transition:background .12s;
}
.pv2-fmt-btn:hover { background:rgba(0,0,0,.06); color:var(--pv2-ink); }
.pv2-fmt-select {
  display:inline-flex; align-items:center; gap:4px;
  height:28px; padding:0 7px;
  border:1px solid transparent; border-radius:5px;
  background:transparent; cursor:pointer;
  font:500 12px var(--pv2-font-sans); color:var(--pv2-neutral-700);
  min-width:78px;
}
.pv2-fmt-select:hover { background:rgba(0,0,0,.06); color:var(--pv2-ink); }
.pv2-fmt-color-swatch { width:14px; height:3px; background:var(--pv2-ink); border-radius:1px; }

.pv2-compose-body-wrap { padding:0; background:#fff; }
.pv2-compose-body {
  width:100%; border:0; outline:0; resize:none;
  min-height:240px;
  padding:18px 22px 22px;
  font-family: "Aptos", "Calibri", "Segoe UI", var(--pv2-font-sans);
  font-size:15px; line-height:1.55;
  color:#252525;
  background:transparent;
  white-space:pre-wrap;
}
.pv2-compose-body:focus { outline:0; }
.pv2-compose-body[contenteditable]:empty::before {
  content:attr(data-placeholder); color:var(--pv2-neutral-400);
}
.pv2-sig-divider {
  display:flex; align-items:center; gap:10px;
  margin:14px 22px 0; padding-top:10px;
  border-top:1px dashed var(--pv2-border);
  font:500 10.5px var(--pv2-font-mono); letter-spacing:.06em; text-transform:uppercase;
  color:var(--pv2-neutral-400);
}
.pv2-compose-foot {
  display:flex; justify-content:space-between; align-items:center;
  padding:10px 14px 12px;
  border-top:1px solid var(--pv2-border-soft);
  background:#fbfaf7;
  gap:10px;
}
.pv2-draft-tag {
  display:inline-flex; align-items:center; gap:6px;
  height:22px; padding:0 9px;
  background:var(--pv2-paper-3); color:var(--pv2-neutral-500);
  border:1px solid var(--pv2-border-soft);
  border-radius:9999px;
  font:500 11px var(--pv2-font-mono); letter-spacing:.02em;
}
.pv2-draft-tag-dot { width:6px; height:6px; border-radius:9999px; background:var(--pv2-orange); animation:pv2-pulse 2s cubic-bezier(0.16,1,0.3,1) infinite; }
@keyframes pv2-pulse { 0%,100%{opacity:1;} 50%{opacity:.4;} }

/* Thread */
.pv2-thread-head {
  margin:28px 0 12px;
  display:flex; align-items:center; gap:10px;
  font:600 11px var(--pv2-font-sans); letter-spacing:.08em; text-transform:uppercase;
  color:var(--pv2-neutral-500);
}
.pv2-thread-head::after { content:""; flex:1; height:1px; background:var(--pv2-border-soft); }
.pv2-msg {
  background:#fff; border:1px solid var(--pv2-border-soft);
  border-radius:11px; padding:18px 20px;
  margin-bottom:10px;
}
.pv2-msg-head {
  display:flex; align-items:center; justify-content:space-between; gap:12px;
  margin-bottom:10px;
}
.pv2-msg-from { display:flex; align-items:center; gap:10px; }
.pv2-msg-name { font-size:13.5px; font-weight:600; color:var(--pv2-ink); }
.pv2-msg-email { font-size:11.5px; color:var(--pv2-neutral-500); font-family:var(--pv2-font-mono); }
.pv2-msg-time { font-size:11.5px; color:var(--pv2-neutral-500); font-family:var(--pv2-font-mono); }
.pv2-msg-body { font:400 14.5px/1.6 var(--pv2-font-sans); color:var(--pv2-ink); white-space:pre-wrap; }
.pv2-msg-body p { margin:0 0 10px; }
.pv2-msg-body p:last-child { margin-bottom:0; }
.pv2-msg-body ul { margin:6px 0 12px; padding-left:22px; }
.pv2-msg-body li { margin:2px 0; }

/* Scrollbars */
.pv2-scrollbar::-webkit-scrollbar, .pv2-list-scroll::-webkit-scrollbar, .pv2-compose-scroll::-webkit-scrollbar { width:10px; height:10px; }
.pv2-scrollbar::-webkit-scrollbar-thumb, .pv2-list-scroll::-webkit-scrollbar-thumb, .pv2-compose-scroll::-webkit-scrollbar-thumb { background:#dcdcd6; border-radius:9999px; border:2px solid transparent; background-clip:content-box; }
.pv2-scrollbar::-webkit-scrollbar-thumb:hover, .pv2-list-scroll::-webkit-scrollbar-thumb:hover, .pv2-compose-scroll::-webkit-scrollbar-thumb:hover { background:#c9c8be; background-clip:content-box; border:2px solid transparent; }

/* responsive guard */
@media (max-width: 1180px) {
  .pv2-card { grid-template-columns: 340px 1fr; }
  .pv2-insight, .pv2-toolbar, .pv2-compose-scroll, .pv2-variant-bar { margin-left:18px; margin-right:18px; }
  .pv2-det-head { padding-left:18px; padding-right:18px; }
}
@media (max-width: 900px) {
  .pv2-app { grid-template-columns: 56px 1fr; }
  .pv2-nav { display:none; }
  .pv2-card { grid-template-columns: 1fr; }
  .pv2-detail { display:none; }
}
    `}</style>
  )
}
