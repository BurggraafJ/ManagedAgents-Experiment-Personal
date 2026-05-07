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

// ----- Awaiting / pseudo-pending detectie (gespiegeld uit AutoDraftView) -------
const INTERNAL_DOMAINS = ['legal-mind.nl']
const NOT_FOR_YOU_LOCAL_RE = /^(no-?reply|noreply|notifications?|bounce|do-?not-?reply|team|updates?|news|newsletter|marketing|welcome|onboarding|info|hello|help|support|security|privacy|feedback|digest|alerts?|automated|system)@/i
const NOT_FOR_YOU_DOMAINS = new Set([
  'uber.com', 'ubereats.com', 'ubereats.nl', 'spotify.com', 'github.com', 'gitlab.com',
  'slack.com', 'supabase.com', 'cursor.com', 'mail.cursor.com', 'email.openai.com',
  'noreply.openai.com', 'attiomail.com', 'mail.moonlit.ai', 'notifications.hubspot.com',
  'email.hubspot.com', 'azure-noreply.com', 'email.microsoftonline.com', 'mail.notion.so',
  'mail.figma.com', 'mail.atlassian.net', 'mail.databricks.com', 'mail.linear.app',
  'mailer.linkedin.com', 'mail.linkedin.com', 'noreply.github.com', 'noreply.medium.com',
])
const OOO_SUBJECT_RE = /\b(out of office|automatic reply|auto[-\s]?reply|automatisch antwoord|automatische reactie|afwezig(heidsmelding)?|on (annual )?leave|on holiday|holiday reply|otto|otho|ferien)\b/i
const OOO_BODY_RE = /\b(out of (the )?office|automatically generated|automatisch gegenereerd|automatisch antwoord|niet (op )?kantoor|currently away|will be back|return on|terug op|tijdelijk niet beschikbaar|with limited access)\b/i
const CANCEL_SUBJECT_RE = /^(canceled|cancelled|geannuleerd|annulering|annuleren):/i
const CLOSING_OPENERS_RE = /\b(top|prima|goed|akkoord|ok(é|e)?|dank|thanks|thx|geweldig|perfect|super|fijn|merci|duidelijk)\b[\s.!,]*/i
const CLOSING_TIME_RE = /\b(tot (zo|straks|morgen|vrijdag|maandag|dinsdag|woensdag|donderdag|vanmiddag|volgende week|over))\b/i
const CLOSING_DECISION_RE = /\b(no problem|geen probleem|prima dan|ga (ervoor|er voor)|kom maar door|laat (maar|t weten)|spreken we (af|mekaar))\b/i

function inferPseudoAudience(fromEmail) {
  if (!fromEmail) return 'not_for_you'
  const e = fromEmail.toLowerCase()
  if (NOT_FOR_YOU_LOCAL_RE.test(e)) return 'not_for_you'
  const domain = e.split('@')[1] || ''
  if (NOT_FOR_YOU_DOMAINS.has(domain)) return 'not_for_you'
  for (const d of NOT_FOR_YOU_DOMAINS) {
    if (domain.endsWith('.' + d)) return 'not_for_you'
  }
  return 'for_you'
}
function isInternalRecipient(emailOrJsonb) {
  if (!emailOrJsonb) return false
  const list = []
  if (typeof emailOrJsonb === 'string') list.push(emailOrJsonb)
  else if (Array.isArray(emailOrJsonb)) {
    for (const x of emailOrJsonb) {
      if (typeof x === 'string') list.push(x)
      else if (x?.email) list.push(x.email)
      else if (x?.address) list.push(x.address)
    }
  } else if (emailOrJsonb?.email) list.push(emailOrJsonb.email)
  if (list.length === 0) return false
  return list.every(e => INTERNAL_DOMAINS.some(d => e.toLowerCase().endsWith('@' + d)))
}
function isOutOfOffice(mail) {
  if (!mail) return false
  const subj = String(mail.subject || '')
  const preview = String(mail.body_preview || mail.body_text || '').slice(0, 600)
  return OOO_SUBJECT_RE.test(subj) || OOO_BODY_RE.test(preview)
}
function isCanceledInvite(mail) {
  if (!mail) return false
  return CANCEL_SUBJECT_RE.test(String(mail.subject || ''))
}
function isClosingMail(mail) {
  if (!mail) return false
  const text = String(mail.body_text || mail.body_preview || '').trim()
  if (!text) return false
  const stripped = text
    .replace(/\bMet vriendelijke groet[,.\s\S]*$/i, '')
    .replace(/\b(Vriendelijke|Hartelijke|Met)\s+groet[,.\s\S]*$/i, '')
    .replace(/\bGroet(en)?\b[,.\s\S]*$/i, '')
    .replace(/\bGr\b[,.\s\S]*$/i, '')
    .trim()
  if (!stripped) return false
  if (stripped.length < 240 && !/\?/.test(stripped)) {
    if (CLOSING_OPENERS_RE.test(stripped.slice(0, 60))) return true
    if (CLOSING_TIME_RE.test(stripped)) return true
    if (CLOSING_DECISION_RE.test(stripped)) return true
  }
  return false
}
function inferOutgoingLabel(toRecipients, allAutodraftMails) {
  const emails = []
  if (Array.isArray(toRecipients)) {
    for (const x of toRecipients) {
      if (typeof x === 'string') emails.push(x.toLowerCase())
      else if (x?.email) emails.push(String(x.email).toLowerCase())
    }
  }
  if (emails.length === 0) return ''
  for (const m of allAutodraftMails || []) {
    const e = (m.from_email || '').toLowerCase()
    if (e && emails.includes(e) && m.category_key) return m.category_key
  }
  return ''
}

// ----- Categorie-mapping (dynamisch uit data) ----------------------------------
function categoryStyle(catKey, categories) {
  // Probeer eerst dynamisch uit categories-tabel (heeft color_hex)
  const c = (categories || []).find(x => x.category_key === catKey)
  if (c?.color_hex) {
    return { color: c.color_hex, label: c.label || catKey, key: catKey }
  }
  // Fallback static palette voor bekende keys
  const fallback = {
    intern:        { color: '#2563eb', label: 'Intern · Legal Mind collega' },
    aandeelhouder: { color: '#dc2626', label: 'Aandeelhouder' },
    partner:       { color: '#7c3aed', label: 'Partner · samenwerking' },
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

function Rail({ onNavigate }) {
  return (
    <aside className="pv2-rail">
      <div className="pv2-rail-top">
        <button
          className="pv2-rail-logo"
          onClick={() => onNavigate && onNavigate('nu')}
          title="Terug naar dashboard"
          aria-label="Terug naar dashboard"
        >
          {Logo}
        </button>
        <button className="pv2-rail-btn pv2-active" title="Postvak"><Ic n="inbox" s={18}/></button>
        <button
          className="pv2-rail-btn"
          title="Zoeken"
          onClick={() => onNavigate && onNavigate('zoeken')}
        >
          <Ic n="search" s={18}/>
        </button>
        <button
          className="pv2-rail-btn"
          title="Agenda"
          onClick={() => onNavigate && onNavigate('agenda')}
        >
          <Ic n="history" s={18}/>
        </button>
        <button
          className="pv2-rail-btn"
          title="Mappen (klik op mail-rij om naar map te slepen)"
        >
          <Ic n="folder" s={18}/>
        </button>
      </div>
      <div className="pv2-rail-bottom">
        <button
          className="pv2-rail-btn"
          title="Instellingen Postvak"
          onClick={() => onNavigate && onNavigate('autodraft_settings')}
        >
          <Ic n="settings" s={18}/>
        </button>
        <span className="pv2-rail-avatar" title="Jelle Burggraaf">JB</span>
      </div>
    </aside>
  )
}

// Bouw een hiërarchische folder-tree uit autodraft_folders.full_path strings.
// Output: array nodes met { label, fullPath, depth, children }.
function buildFolderTree(folders) {
  if (!folders || folders.length === 0) return []
  // Filter actief en alleen Inbox-subboom (anders krijgen we ook 'Drafts',
  // 'Sent Items', 'Junk' enz. waar je niets in wil verplaatsen).
  const paths = folders
    .filter(f => f.full_path && (f.full_path === 'Inbox' || f.full_path.startsWith('Inbox/') || f.full_path.startsWith('Archive')))
    .map(f => f.full_path)
    .sort((a, b) => a.localeCompare(b))

  const root = { label: 'root', fullPath: '', children: new Map() }
  for (const p of paths) {
    const parts = p.split('/')
    let cur = root
    let acc = ''
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      acc = acc ? `${acc}/${part}` : part
      if (!cur.children.has(part)) {
        cur.children.set(part, { label: part, fullPath: acc, children: new Map() })
      }
      cur = cur.children.get(part)
    }
  }

  function flatten(node, depth, out) {
    for (const child of node.children.values()) {
      out.push({ label: child.label, fullPath: child.fullPath, depth, hasChildren: child.children.size > 0, children: child.children })
    }
    return out
  }
  // Render only top 2 levels by default, deeper levels lazy-expanded.
  return flatten(root, 0, [])
}

function FolderNode({ node, level, openSet, toggle, onDropMail, dragOverPath, setDragOverPath }) {
  const isOpen = openSet.has(node.fullPath)
  const hasChildren = node.hasChildren
  const childList = hasChildren ? Array.from(node.children.values()) : []

  const onDragOver = (e) => {
    if (e.dataTransfer.types.includes('text/x-mail-id')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDragOverPath(node.fullPath)
    }
  }
  const onDragLeave = () => {
    if (dragOverPath === node.fullPath) setDragOverPath(null)
  }
  const onDrop = (e) => {
    e.preventDefault()
    setDragOverPath(null)
    const mailId = e.dataTransfer.getData('text/x-mail-id')
    if (mailId && onDropMail) onDropMail(mailId, node.fullPath)
  }

  return (
    <>
      <div
        className={`pv2-nav-item pv2-folder-item ${dragOverPath === node.fullPath ? 'pv2-folder-dragover' : ''}`}
        style={{ paddingLeft: 10 + level * 14 }}
        onClick={() => hasChildren && toggle(node.fullPath)}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        title={node.fullPath}
        role="treeitem"
        aria-expanded={hasChildren ? isOpen : undefined}
      >
        <span className="pv2-nav-item-icon" style={{ color: 'var(--pv2-neutral-500)' }}>
          {hasChildren
            ? <span style={{ display: 'inline-flex', transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform .12s' }}>
                <Ic n="chev" s={11}/>
              </span>
            : <Ic n="archive-folder" s={14}/>}
        </span>
        <span className="pv2-nav-item-label">{node.label}</span>
      </div>
      {isOpen && hasChildren && (
        childList.map(child => (
          <FolderNode
            key={child.fullPath}
            node={{ ...child, hasChildren: child.children.size > 0 }}
            level={level + 1}
            openSet={openSet}
            toggle={toggle}
            onDropMail={onDropMail}
            dragOverPath={dragOverPath}
            setDragOverPath={setDragOverPath}
          />
        ))
      )}
    </>
  )
}

function NavSidebar({ activeTab, setActiveTab, counts, foldersOpen, setFoldersOpen, folderTree, onDropMailToFolder }) {
  const TABS = [
    { id: 'voor-jou',  label: 'Voor jou',       icon: 'inbox',     count: counts.forYou,       alert: true },
    { id: 'pin',       label: 'Pin',            icon: 'pin',       count: counts.pin },
    { id: 'wachten',   label: 'In afwachting',  icon: 'hourglass', count: counts.wachten },
    { id: 'niet-jou',  label: 'Niet voor jou',  icon: 'eye-off',   count: counts.nietVoorJou },
    { id: 'drafts',    label: 'Concepten',      icon: 'edit',      count: counts.drafts },
    { id: 'logs',      label: 'Logs',           icon: 'log',       count: null },
  ]
  // localStorage-persisted open-state per pad — alleen Inbox open by default.
  const STORAGE_KEY = 'pv2-folders-open'
  const [openSet, setOpenSet] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) return new Set(JSON.parse(raw))
    } catch {}
    return new Set(['Inbox'])
  })
  const toggle = (path) => {
    setOpenSet(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path); else next.add(path)
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])) } catch {}
      return next
    })
  }
  const [dragOverPath, setDragOverPath] = useState(null)

  return (
    <aside className="pv2-nav pv2-scrollbar">
      <div className="pv2-nav-search" tabIndex={0}>
        <Ic n="search" s={14}/>
        <input placeholder="Zoek in Postvak…" />
        <span className="pv2-nav-kbd">⌘K</span>
      </div>

      <div className="pv2-nav-section">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`pv2-nav-item ${activeTab === t.id ? 'pv2-active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            <span className="pv2-nav-item-icon"><Ic n={t.icon} s={15}/></span>
            <span className="pv2-nav-item-label">{t.label}</span>
            {t.count !== null && t.count !== undefined && (
              <span className={`pv2-nav-item-count ${t.alert ? 'pv2-alert' : ''}`}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      <div className="pv2-nav-divider"/>

      <div
        className={`pv2-nav-tree-toggle ${foldersOpen ? '' : 'pv2-collapsed'}`}
        onClick={() => setFoldersOpen(o => !o)}
      >
        <span className="pv2-chev"><Ic n="chev" s={11}/></span>
        <span>Mappen</span>
      </div>
      {foldersOpen && (
        <div className="pv2-nav-section pv2-folder-tree" role="tree">
          {folderTree.length === 0 && (
            <div style={{ padding: '8px 14px', fontSize: 12, color: 'var(--pv2-neutral-500)' }}>
              Geen mappen gesynced.
            </div>
          )}
          {folderTree.map(node => (
            <FolderNode
              key={node.fullPath}
              node={node}
              level={0}
              openSet={openSet}
              toggle={toggle}
              onDropMail={onDropMailToFolder}
              dragOverPath={dragOverPath}
              setDragOverPath={setDragOverPath}
            />
          ))}
        </div>
      )}

      <div style={{ flex: 1 }}/>
    </aside>
  )
}

function ListPane({ buckets, selectedId, setSelectedId, filter, setFilter, filters, title, ragHealth }) {
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
              />
            ))}
          </Fragment>
        ))}
      </div>
    </section>
  )
}

function Row({ mail, selected, onClick }) {
  const cat = mail._category
  const isUnread = mail.is_read === false
  const star = mail.flag_status === 'flagged'
  const subj = mail.subject || '(geen onderwerp)'
  const snippet = mail.body_preview || mail.suggested_reasoning || ''
  const time = formatRelative(mail.received_at)

  // Categorie-pill class
  const catClass = ({
    intern: 'pv2-pill-cat-intern',
    aandeelhouder: 'pv2-pill-cat-share',
    partner: 'pv2-pill-cat-partner',
    klant: 'pv2-pill-cat-klant',
    overig: 'pv2-pill-cat-overig',
    plan: 'pv2-pill-status-plan',
  })[mail.category_key] || 'pv2-pill-cat-overig'

  const onDragStart = (e) => {
    if (!mail.mail_id) return
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/x-mail-id', mail.mail_id)
    e.dataTransfer.setData('text/plain', subj)
  }

  return (
    <div
      className={`pv2-row ${selected ? 'pv2-selected' : ''} ${isUnread ? 'pv2-unread' : ''}`}
      onClick={onClick}
      draggable
      onDragStart={onDragStart}
    >
      <div className="pv2-row-from">
        <span className="pv2-cat-dot" style={{ background: cat.color }}/>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{mail.from_name || mail.from_email || 'Onbekend'}</span>
      </div>
      <div className="pv2-row-meta">
        {star && <Ic n="star-fill" s={13}/>}
        <span>{time}</span>
      </div>
      <div className="pv2-row-subject">{subj}</div>
      <div className="pv2-row-snippet">{snippet}</div>
      <div className="pv2-row-foot">
        <span className={`pv2-pill ${catClass}`}>
          <span className="pv2-pill-dot" style={{ background: cat.color }}/>
          {cat.label}
        </span>
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
              style={{ position: 'fixed', top: afhandelPos.top, left: afhandelPos.left }}
            >
              <div className="pv2-popover-section">
                <div className="pv2-popover-label">Verplaats naar map</div>
                {quickFolders.map(f => (
                  <button
                    key={f}
                    className="pv2-popover-item"
                    onClick={() => ignoreToFolder(f)}
                    role="menuitem"
                  >
                    <Ic n="archive-folder" s={14}/>
                    <span className="pv2-popover-item-label">{f}</span>
                  </button>
                ))}
              </div>
              <div className="pv2-popover-divider"/>
              <div className="pv2-popover-section">
                <button className="pv2-popover-item" onClick={() => ignoreToFolder(null)} role="menuitem">
                  <Ic n="archive" s={14}/>
                  <span className="pv2-popover-item-label">Negeren (zonder verplaatsen)</span>
                </button>
                <button className="pv2-popover-item" onClick={markProcessed} role="menuitem">
                  <Ic n="check-square" s={14}/>
                  <span className="pv2-popover-item-label">Al verwerkt in Outlook</span>
                </button>
                <button className="pv2-popover-item pv2-popover-danger" onClick={spam} role="menuitem">
                  <Ic n="shield-x" s={14}/>
                  <span className="pv2-popover-item-label">Markeer als spam</span>
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
              style={{ position: 'fixed', top: snelPos.top, left: snelPos.left, minWidth: 280 }}
            >
              <div className="pv2-popover-section">
                <div className="pv2-popover-label">Snel-acties</div>
                <button className="pv2-popover-item" onClick={forwardMail}>
                  <Ic n="arrow" s={14}/>
                  <span className="pv2-popover-item-label">Doorsturen aan…</span>
                </button>
                <button className="pv2-popover-item" onClick={replyAll}>
                  <Ic n="reply" s={14}/>
                  <span className="pv2-popover-item-label">Allen beantwoorden</span>
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
    </section>
  )
}

// ============================================================================
// Main view
// ============================================================================
export default function PostvakV2View({ data, onNavigate }) {
  const [activeTab, setActiveTab] = useState('voor-jou')
  const [filter, setFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  const [busyAction, setBusyAction] = useState(null)
  const [foldersOpen, setFoldersOpen] = useState(true)
  const [actionedIds, setActionedIds] = useState(() => new Set())

  const mails = data?.autodraftMails || []
  const decisions = data?.autodraftDecisions || []
  const categories = data?.autodraftCategories || []
  const folders = data?.autodraftFolders || []
  const mailMessages = data?.mailMessages || []
  const ignoreRules = data?.autodraftIgnoreRules || []
  const awaitingDismissed = data?.awaitingDismissed || []

  // Decisions-index: welke mail_ids hebben al een actie gehad?
  const decidedIds = useMemo(() => {
    const s = new Set()
    for (const d of decisions) {
      if (d.action === 'send' || d.action === 'ignore' || d.action === 'spam') {
        if (d.mail_id) s.add(d.mail_id)
      }
    }
    return s
  }, [decisions])

  // Mails die door Jelle al "afgerond" zijn in awaiting (dismissed)
  const dismissedConvIds = useMemo(
    () => new Set(awaitingDismissed.map(d => d.conversation_id)),
    [awaitingDismissed]
  )

  // Subject-keyword ignore-rules (voor awaiting-pool)
  const subjectIgnoreNeedles = useMemo(() => {
    return ignoreRules
      .filter(r => r.active !== false && r.pattern_type === 'subject_keyword' && r.pattern_value)
      .map(r => String(r.pattern_value).toLowerCase().trim())
      .filter(Boolean)
  }, [ignoreRules])
  function subjectMatchesIgnore(subject) {
    if (!subject || subjectIgnoreNeedles.length === 0) return false
    const s = String(subject).toLowerCase()
    return subjectIgnoreNeedles.some(n => s.includes(n))
  }

  // ===== Pool 1 — skill-pending (autodraft_mails met status='pending'/'amended') =====
  const skillPending = useMemo(() => {
    return mails.filter(m => m.status === 'pending' || m.status === 'amended')
  }, [mails])

  // ===== Pool 2 — pseudo-pending (mail_messages in Inbox die skill nog niet zag) =====
  const pseudoPending = useMemo(() => {
    if (!mailMessages || mailMessages.length === 0) return []
    const inAutodraft = new Set(mails.map(m => m.mail_id))
    const out = []
    for (const m of mailMessages) {
      if (m.is_from_me) continue
      if (m.is_deleted) continue
      if (!m.folder_path || m.folder_path !== 'Inbox') continue
      if (m.is_calendar_invite) continue
      if (inAutodraft.has(m.id)) continue
      const inferredAudience = inferPseudoAudience(m.from_email)
      const isNotForYou = inferredAudience === 'not_for_you'
      out.push({
        __no_draft_yet: true,
        mail_id: m.id,
        conversation_id: m.conversation_id,
        received_at: m.received_at,
        from_email: m.from_email,
        from_name: m.from_name,
        to_recipients: m.to_recipients,
        cc_recipients: m.cc_recipients,
        subject: m.subject,
        body_preview: m.body_preview,
        has_attachments: m.has_attachments,
        category_key: isNotForYou ? 'notificatie' : '',
        audience: inferredAudience,
        suggested_action: isNotForYou ? 'skip' : null,
        suggested_reasoning: isNotForYou
          ? 'Pre-classificatie: notification/newsletter — voorgesteld om te negeren.'
          : null,
        confidence: isNotForYou ? 0.7 : 0,
        status: 'pending',
        draft_body: '',
        draft_subject: m.subject ? `RE: ${m.subject}` : '',
        draft_variants: [],
        target_folder: null,
        flag_status: m.flag_status,
      })
    }
    return out
  }, [mailMessages, mails])

  // Gecombineerde pending pool — wat zichtbaar is in 'Voor jou' / 'Niet voor jou'
  const pending = useMemo(() => {
    return [...skillPending, ...pseudoPending]
      .sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
  }, [skillPending, pseudoPending])

  // ===== Pool 3 — awaiting (mijn verzonden mails zonder reply) =====
  const awaitingMails = useMemo(() => {
    if (!mailMessages || mailMessages.length === 0) return []
    const byConv = new Map()
    for (const m of mailMessages) {
      if (!m.conversation_id) continue
      const slot = byConv.get(m.conversation_id) || { mine: null, reply: null }
      if (m.is_from_me) {
        if (!slot.mine || new Date(m.received_at) > new Date(slot.mine.received_at)) slot.mine = m
      } else {
        if (isOutOfOffice(m)) continue
        if (!slot.reply || new Date(m.received_at) > new Date(slot.reply.received_at)) slot.reply = m
      }
      byConv.set(m.conversation_id, slot)
    }
    const now = Date.now()
    const out = []
    for (const { mine, reply } of byConv.values()) {
      if (!mine) continue
      if (mine.is_calendar_invite) continue
      if (subjectMatchesIgnore(mine.subject)) continue
      if (isCanceledInvite(mine)) continue
      if (isClosingMail(mine)) continue
      if (isInternalRecipient(mine.to_recipients)) continue
      if (dismissedConvIds.has(mine.conversation_id)) continue
      if (reply && new Date(reply.received_at) >= new Date(mine.received_at)) continue
      const ageDays = (now - new Date(mine.received_at).getTime()) / (1000 * 60 * 60 * 24)
      if (ageDays < 1 || ageDays > 30) continue
      let toLabel = ''
      if (Array.isArray(mine.to_recipients)) {
        toLabel = mine.to_recipients.map(x => typeof x === 'string' ? x : (x?.email || x?.name || '')).filter(Boolean).join(', ')
      } else if (typeof mine.to_recipients === 'string') {
        toLabel = mine.to_recipients
      }
      const inferredCategoryKey = inferOutgoingLabel(mine.to_recipients, mails)
      out.push({
        __awaiting: true,
        mail_id: mine.id,
        conversation_id: mine.conversation_id,
        received_at: mine.received_at,
        from_email: toLabel || '—',
        from_name: toLabel ? `aan ${toLabel}` : 'aan —',
        to_recipients: mine.to_recipients,
        cc_recipients: mine.cc_recipients,
        subject: mine.subject,
        body_preview: mine.body_preview,
        has_attachments: mine.has_attachments,
        category_key: inferredCategoryKey || '',
        audience: 'for_you',
        suggested_action: null,
        suggested_reasoning: `Wacht op antwoord — ${Math.floor(ageDays)} dagen verstuurd.`,
        confidence: 0,
        status: 'awaiting',
        draft_body: '',
        draft_subject: '',
        draft_variants: [],
        target_folder: null,
        days_waiting: Math.floor(ageDays),
        flag_status: mine.flag_status,
      })
    }
    return out.sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
  }, [mailMessages, mails, dismissedConvIds, subjectIgnoreNeedles])

  // ===== Pool 4 — drafts klaar (decisions met action='send', execution_status='done') =====
  const sentDraftsList = useMemo(() => {
    return decisions
      .filter(d => d.action === 'send' && d.execution_status === 'done' && d.mail_id)
      .map(d => {
        const m = mails.find(x => x.mail_id === d.mail_id)
        if (!m) return null
        return { ...m, __sent_draft: true, _decision: d }
      })
      .filter(Boolean)
  }, [decisions, mails])

  // ===== Pool 5 — flagged/pin (mail_messages met flag_status='flagged') =====
  const flaggedIds = useMemo(() => {
    const s = new Set()
    for (const m of mailMessages) {
      if (m.flag_status === 'flagged') s.add(m.id)
    }
    return s
  }, [mailMessages])

  const pinPool = useMemo(() => {
    return [...pending, ...awaitingMails].filter(m => flaggedIds.has(m.mail_id))
  }, [pending, awaitingMails, flaggedIds])

  // Verrijk een pool met categorie-styling
  function enrich(arr) {
    return arr.map(m => ({ ...m, _category: categoryStyle(m.category_key, categories) }))
  }

  // ===== Tab-counts (echte cijfers) =====
  const counts = useMemo(() => {
    const forYouCount = pending.filter(m => m.audience === 'for_you' && !actionedIds.has(m.mail_id)).length
    const nietJouCount = pending.filter(m => m.audience === 'not_for_you' && !actionedIds.has(m.mail_id)).length
    const wachtenCount = awaitingMails.filter(m => !actionedIds.has(m.mail_id)).length
    const pinCount = pinPool.filter(m => !actionedIds.has(m.mail_id)).length
    const draftsCount = sentDraftsList.filter(m => !actionedIds.has(m.mail_id)).length
    return { forYou: forYouCount, pin: pinCount, wachten: wachtenCount, nietVoorJou: nietJouCount, drafts: draftsCount }
  }, [pending, awaitingMails, pinPool, sentDraftsList, actionedIds])

  // ===== Tab-filter — kies de juiste pool =====
  const tabFiltered = useMemo(() => {
    let pool
    switch (activeTab) {
      case 'voor-jou':   pool = pending.filter(m => m.audience === 'for_you'); break
      case 'pin':        pool = pinPool; break
      case 'wachten':    pool = awaitingMails; break
      case 'niet-jou':   pool = pending.filter(m => m.audience === 'not_for_you'); break
      case 'drafts':     pool = sentDraftsList; break
      case 'logs':       pool = mails.filter(m => decidedIds.has(m.mail_id)); break
      default:           pool = pending
    }
    pool = pool.filter(m => !actionedIds.has(m.mail_id))
    return enrich(pool)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, pending, pinPool, awaitingMails, sentDraftsList, mails, decidedIds, actionedIds, categories])

  // Filter chips
  const filters = useMemo(() => {
    const groups = { all: 0, intern: 0, aandeelhouder: 0, partner: 0, klant: 0, overig: 0 }
    for (const m of tabFiltered) {
      groups.all += 1
      if (groups[m.category_key] !== undefined) groups[m.category_key] += 1
      else groups.overig += 1
    }
    return [
      { id: 'all',           label: 'Alles',          count: groups.all,           dot: null },
      { id: 'intern',        label: 'Intern',         count: groups.intern,        dot: '#2563eb' },
      { id: 'klant',         label: 'Klant',          count: groups.klant,         dot: '#059669' },
      { id: 'partner',       label: 'Partner',        count: groups.partner,       dot: '#7c3aed' },
      { id: 'aandeelhouder', label: 'Aandeelhouder',  count: groups.aandeelhouder, dot: '#dc2626' },
      { id: 'overig',        label: 'Overig',         count: groups.overig,        dot: '#94a3b8' },
    ].filter(f => f.count > 0 || f.id === 'all')
  }, [tabFiltered])

  // Filter-toepassing
  const filtered = useMemo(() => {
    if (filter === 'all') return tabFiltered
    return tabFiltered.filter(m => (m.category_key || 'overig') === filter)
  }, [tabFiltered, filter])

  // Buckets per dag
  const buckets = useMemo(() => bucketByDay(filtered), [filtered])

  // Auto-select eerste mail
  useEffect(() => {
    if (!selectedId && filtered.length > 0) {
      setSelectedId(filtered[0].mail_id)
    } else if (selectedId && !filtered.find(m => m.mail_id === selectedId)) {
      setSelectedId(filtered[0]?.mail_id || null)
    }
  }, [filtered, selectedId])

  // Selectie kan in elke tab-pool zitten (bijvoorbeeld awaitingMails staat
  // niet in `pending`). Daarom ALL-pool zoeken.
  const allMailsForSelect = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const m of [...pending, ...awaitingMails, ...sentDraftsList, ...mails]) {
      if (!m.mail_id || seen.has(m.mail_id)) continue
      seen.add(m.mail_id)
      out.push({ ...m, _category: categoryStyle(m.category_key, categories) })
    }
    return out
  }, [pending, awaitingMails, sentDraftsList, mails, categories])

  const selected = useMemo(
    () => allMailsForSelect.find(m => m.mail_id === selectedId),
    [allMailsForSelect, selectedId]
  )

  // Thread-context: get_thread_messages RPC voor full bodies, fallback op
  // mailMessages-lijst (alleen body_preview). Sorteert nieuwste-eerst.
  const [threadFull, setThreadFull] = useState(null)
  const [threadLoading, setThreadLoading] = useState(false)
  useEffect(() => {
    const cid = selected?.conversation_id
    if (!cid) { setThreadFull(null); return }
    let cancelled = false
    setThreadLoading(true)
    setThreadFull(null)
    ;(async () => {
      try {
        const { data } = await supabase.rpc('get_thread_messages', { p_conversation_id: cid })
        if (!cancelled) setThreadFull(Array.isArray(data) ? data : [])
      } catch {
        // best-effort, valt terug op mailMessages
      }
      if (!cancelled) setThreadLoading(false)
    })()
    return () => { cancelled = true }
  }, [selected?.conversation_id])

  const threadMessages = useMemo(() => {
    if (!selected?.conversation_id) return []
    if (threadFull && threadFull.length > 0) {
      return [...threadFull].sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
    }
    // Fallback op de gemeenschappelijke mailMessages-store (zonder full body)
    return mailMessages
      .filter(m => m.conversation_id === selected.conversation_id)
      .sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
  }, [selected, threadFull, mailMessages])

  // RAG-health placeholder (uit data of fallback)
  const ragHealth = {
    week: getWeekNumber(new Date()),
    coverage: '—',
    fireflies: '—',
    p95: '—',
  }

  // Folder-tree voor sidebar — hierarchisch uit autodraft_folders.full_path
  const folderTree = useMemo(() => buildFolderTree(folders), [folders])

  // Drop-handler voor drag-and-drop van mail-rij naar folder-node
  const handleDropMailToFolder = useCallback(async (mailId, fullPath) => {
    if (!mailId || !fullPath) return
    // Optimistic hide
    setActionedIds(prev => new Set(prev).add(mailId))
    try {
      const { data: rpcRes, error } = await supabase.rpc('submit_autodraft_decision', {
        p_mail_id: mailId,
        p_action: 'ignore',
        p_amend: null,
        p_final_subject: null,
        p_final_body: null,
        p_target_folder: fullPath,
        p_decision_kind: 'reply',
        p_final_to: null,
        p_chosen_variant_index: null,
        p_chosen_variant_label: null,
      })
      if (error) {
        showToast({ kind: 'error', message: 'Verplaatsen mislukt', detail: error.message })
        setActionedIds(prev => { const n = new Set(prev); n.delete(mailId); return n })
      } else if (rpcRes && rpcRes.ok === false) {
        showToast({ kind: 'error', message: 'Geweigerd', detail: rpcRes.reason || 'mislukt' })
        setActionedIds(prev => { const n = new Set(prev); n.delete(mailId); return n })
      } else {
        showToast({ message: `Verplaatst naar ${fullPath}` })
      }
    } catch (e) {
      showToast({ kind: 'error', message: 'Netwerkfout', detail: e.message })
      setActionedIds(prev => { const n = new Set(prev); n.delete(mailId); return n })
    }
  }, [])

  // Sync-pill (orchestrator-leeftijd)
  const syncMin = data?.orchestratorAgeMin
  const syncTone = syncMin == null ? 'idle' : syncMin < 20 ? 'live' : syncMin < 60 ? 'warn' : 'stale'
  const syncLabel = syncMin == null ? 'geen signaal'
    : syncMin < 1 ? 'live'
    : syncMin < 60 ? syncMin + 'm'
    : Math.round(syncMin / 60) + 'u'

  // ---- Action handler ----
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
        // Markeer als al-verwerkt-in-Outlook (geen Outlook-actie meer)
        const res = await supabase.rpc('mark_mail_processed', {
          p_mail_id: selected.mail_id,
          p_reason: 'Al verwerkt in Outlook',
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
  }, [selected, busyAction])

  const tabTitle = ({
    'voor-jou': 'Voor jou',
    'pin': 'Pin',
    'wachten': 'In afwachting',
    'niet-jou': 'Niet voor jou',
    'drafts': 'Concepten',
    'logs': 'Logs',
  })[activeTab] || 'Postvak'

  return (
    <>
      <PostvakV2Styles/>
      <div className="pv2-app">
        <Rail onNavigate={onNavigate} />
        <NavSidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          counts={counts}
          foldersOpen={foldersOpen}
          setFoldersOpen={setFoldersOpen}
          folderTree={folderTree}
          onDropMailToFolder={handleDropMailToFolder}
        />
        <main className="pv2-main">
          <header className="pv2-topbar">
            <div className="pv2-topbar-left">
              <div className="pv2-crumbs">
                <span className="pv2-crumb"><Ic n="inbox" s={14}/> Postvak</span>
                <Ic n="chev-r" s={12}/>
                <span className="pv2-crumb pv2-crumb-current">{tabTitle}</span>
              </div>
            </div>
            <div className="pv2-topbar-right">
              <span className={`pv2-sync-pill pv2-sync-${syncTone}`} title={'Sync ' + syncLabel}>
                <span className="pv2-sync-dot"/>
                <span>{syncTone === 'live' ? 'Sync live' : syncTone === 'warn' ? 'Sync wat oud' : syncTone === 'stale' ? 'Sync stale' : 'Sync onbekend'}</span>
                <span className="pv2-sync-meta">{syncLabel}</span>
              </span>
              <button
                className="pv2-btn"
                onClick={() => onNavigate && onNavigate('autodraft_settings')}
                title="Instellingen postvak"
              >
                <Ic n="settings" s={14}/> Instellingen
              </button>
              <button className="pv2-btn pv2-btn-primary" disabled>
                <Ic n="send" s={14}/> Verstuur mail
              </button>
            </div>
          </header>

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
        </main>
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

.pv2-app {
  --pv2-slate-50:#f8fafc; --pv2-slate-100:#f1f5f9; --pv2-slate-200:#e2e8f0; --pv2-slate-300:#cbd5e1;
  --pv2-slate-400:#94a3b8; --pv2-slate-500:#64748b; --pv2-slate-700:#334155; --pv2-slate-800:#1e293b;
  --pv2-neutral-50:#fafafa; --pv2-neutral-100:#f5f5f5; --pv2-neutral-200:#e5e5e5; --pv2-neutral-300:#d4d4d4;
  --pv2-neutral-400:#a6a6a6; --pv2-neutral-500:#737373; --pv2-neutral-700:#404040;
  --pv2-orange:#dc6f3f; --pv2-orange-subtle:#f9e5dd; --pv2-orange-deep:#8b4628; --pv2-orange-hover:#c25f33;
  --pv2-ink:#121212; --pv2-paper:#ffffff; --pv2-paper-2:#fafaf8; --pv2-paper-3:#f5f4f0;
  --pv2-error:#dc2626; --pv2-success:#16a34a; --pv2-warning:#d97706; --pv2-info:#2563eb;
  --pv2-border:#e7e5df; --pv2-border-soft:#efece5; --pv2-border-strong:#cbc7bb;
  --pv2-font-sans:"Instrument Sans", system-ui, -apple-system, sans-serif;
  --pv2-font-mono:"Geist", ui-monospace, Menlo, monospace;
  --pv2-font-accent:var(--pv2-font-sans);
  --pv2-shadow-sm:0 1px 2px rgba(15,15,15,.04), 0 1px 1px rgba(15,15,15,.03);
  --pv2-shadow-md:0 4px 6px -1px rgba(15,15,15,.06), 0 2px 4px -2px rgba(15,15,15,.04);
  --pv2-shadow-pop:0 2px 4px -2px rgba(15,15,15,.10), 0 12px 28px -8px rgba(15,15,15,.18);

  font-family:var(--pv2-font-sans);
  color:var(--pv2-ink);
  background:var(--pv2-paper-3);
  font-size:14px; line-height:1.5;
  -webkit-font-smoothing:antialiased;
  text-rendering:optimizeLegibility;

  display:grid;
  grid-template-columns: 56px 264px 1fr;
  grid-template-rows: 100vh;
  height:100vh; overflow:hidden;
  width: 100%;
}
.pv2-app *, .pv2-app *::before, .pv2-app *::after { box-sizing:border-box; }
.pv2-app button { font-family:inherit; color:inherit; }
.pv2-svg { stroke:currentColor; fill:none; stroke-width:1.6; stroke-linecap:round; stroke-linejoin:round; }

/* ====== Rail ====== */
.pv2-rail {
  background:var(--pv2-paper-3);
  display:flex; flex-direction:column; align-items:center;
  justify-content:space-between;
  padding:14px 0;
}
.pv2-rail-top, .pv2-rail-bottom { display:flex; flex-direction:column; align-items:center; gap:6px; }
.pv2-rail-logo {
  width:40px; height:40px; border-radius:10px;
  display:flex; align-items:center; justify-content:center;
  background:var(--pv2-ink); color:#fff;
  margin-bottom:6px; border:0; cursor:pointer;
  transition:transform .12s;
}
.pv2-rail-logo:hover { transform:scale(1.04); }
.pv2-rail-logo svg { width:24px; height:24px; }
.pv2-rail-btn {
  width:36px; height:36px; border:0; background:transparent; color:var(--pv2-neutral-700);
  border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center;
  transition:background .15s, color .15s;
}
.pv2-rail-btn:hover { background:rgba(0,0,0,.05); color:var(--pv2-ink); }
.pv2-rail-btn.pv2-active { background:#fff; color:var(--pv2-ink); box-shadow:var(--pv2-shadow-sm); }
.pv2-rail-avatar {
  width:32px; height:32px; border-radius:9999px; background:var(--pv2-orange); color:#fff;
  display:flex; align-items:center; justify-content:center;
  font-family:var(--pv2-font-accent); font-weight:500; font-size:13px;
  cursor:pointer; box-shadow:0 0 0 2px var(--pv2-paper-3), 0 0 0 3px var(--pv2-border);
}

/* ====== Tabs sidebar ====== */
.pv2-nav {
  background:var(--pv2-paper-3);
  display:flex; flex-direction:column;
  padding:14px 12px 12px 0;
  gap:14px;
  overflow:hidden;
}
.pv2-nav-search {
  margin:0 4px;
  display:flex; align-items:center; gap:8px;
  height:34px; padding:0 10px;
  background:#fff; border:1px solid var(--pv2-border);
  border-radius:9px; cursor:text; color:var(--pv2-neutral-500);
}
.pv2-nav-search input {
  flex:1; border:0; outline:0; background:transparent; font:inherit; color:var(--pv2-ink); font-size:13px;
}
.pv2-nav-kbd {
  font-family:var(--pv2-font-mono); font-size:11px; color:var(--pv2-neutral-400);
  border:1px solid var(--pv2-border); border-radius:4px; padding:1px 5px; background:var(--pv2-paper-2);
}
.pv2-nav-section { display:flex; flex-direction:column; gap:1px; }
.pv2-nav-item {
  display:flex; align-items:center; gap:10px;
  height:32px; padding:0 10px; margin:0 4px;
  border:0; background:transparent; border-radius:7px;
  cursor:pointer; color:var(--pv2-neutral-700); text-align:left; width:calc(100% - 8px);
  font-size:13.5px; font-weight:500;
  transition:background .12s, color .12s;
}
.pv2-nav-item:hover { background:rgba(0,0,0,.04); color:var(--pv2-ink); }
.pv2-nav-item.pv2-active { background:#fff; color:var(--pv2-ink); box-shadow:var(--pv2-shadow-sm); border:1px solid var(--pv2-border); }
.pv2-nav-item-icon { display:flex; width:18px; height:18px; align-items:center; justify-content:center; color:var(--pv2-neutral-500); }
.pv2-nav-item.pv2-active .pv2-nav-item-icon { color:var(--pv2-ink); }
.pv2-nav-item-label { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pv2-nav-item-count {
  font-size:12px; font-weight:500; color:var(--pv2-neutral-500);
  font-variant-numeric:tabular-nums;
}
.pv2-nav-item-count.pv2-alert { color:var(--pv2-ink); }
.pv2-nav-divider { height:1px; background:var(--pv2-border-soft); margin:6px 12px; }

/* Folder-tree (drag-target zones) */
.pv2-folder-tree { gap:0; }
.pv2-folder-item {
  display:flex; align-items:center; gap:8px;
  height:28px;
  cursor:pointer;
  font-size:13px;
  color:var(--pv2-neutral-700);
  border-radius:6px;
  margin:0 4px;
  user-select:none;
  position:relative;
  transition:background .12s, box-shadow .12s;
}
.pv2-folder-item:hover { background:rgba(0,0,0,.04); color:var(--pv2-ink); }
.pv2-folder-item .pv2-nav-item-label {
  font-size:13px;
  color:inherit;
  font-weight:500;
}
.pv2-folder-dragover {
  background:var(--pv2-orange-subtle) !important;
  color:var(--pv2-orange-deep) !important;
  box-shadow: inset 0 0 0 1px var(--pv2-orange);
}
.pv2-folder-dragover .pv2-nav-item-icon { color:var(--pv2-orange-deep) !important; }

/* Mail-rij in drag */
.pv2-row[draggable="true"]:active { cursor:grabbing; }
.pv2-nav-tree-toggle {
  display:flex; align-items:center; gap:6px;
  padding:0 10px; margin:0 4px;
  height:24px; cursor:pointer;
  font-size:11px; font-weight:600; letter-spacing:.04em;
  color:var(--pv2-neutral-500); text-transform:uppercase;
}
.pv2-nav-tree-toggle .pv2-chev { transition:transform .15s; display:inline-flex; }
.pv2-nav-tree-toggle.pv2-collapsed .pv2-chev { transform:rotate(-90deg); }

/* ====== Main column ====== */
.pv2-main {
  display:grid;
  grid-template-rows: 52px minmax(0, 1fr);
  min-height:0;
  height: 100vh;
  padding:10px 10px 10px 0;
  overflow: hidden;
}
.pv2-topbar {
  display:flex; align-items:center; justify-content:space-between;
  padding:0 16px;
  background:var(--pv2-paper-3);
}
.pv2-topbar-left { display:flex; align-items:center; gap:14px; min-width:0; }
.pv2-crumbs { display:flex; align-items:center; gap:8px; min-width:0; }
.pv2-crumb { display:inline-flex; align-items:center; gap:6px; font-size:13px; color:var(--pv2-neutral-500); }
.pv2-crumb-current { color:var(--pv2-ink); font-weight:500; }
.pv2-topbar-right { display:flex; align-items:center; gap:6px; }
.pv2-stat-sep { color:var(--pv2-border-strong); }

.pv2-sync-pill {
  display:inline-flex; align-items:center; gap:8px;
  height:30px; padding:0 12px;
  border-radius:9999px;
  background:#fff; border:1px solid var(--pv2-border);
  font-size:12.5px; font-weight:500; color:var(--pv2-neutral-700);
}
.pv2-sync-dot { width:6px; height:6px; border-radius:9999px; background:var(--pv2-warning); box-shadow:0 0 0 3px rgba(217,119,6,.16); }
.pv2-sync-live .pv2-sync-dot { background:var(--pv2-success); box-shadow:0 0 0 3px rgba(22,163,74,.16); }
.pv2-sync-stale .pv2-sync-dot { background:var(--pv2-error); box-shadow:0 0 0 3px rgba(220,38,38,.16); }
.pv2-sync-idle .pv2-sync-dot { background:var(--pv2-neutral-400); box-shadow:0 0 0 3px rgba(0,0,0,.04); }
.pv2-sync-meta { color:var(--pv2-neutral-500); font-family:var(--pv2-font-mono); font-size:11.5px; }

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
