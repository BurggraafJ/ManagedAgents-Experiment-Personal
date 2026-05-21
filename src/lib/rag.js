// Shared helpers + constants voor RagSearchView / RagChatView.

export const SOURCE_LABEL = {
  mail:       'Mails',
  engagement: 'Engagements',
  jira:       'Jira issues',
  deal:       'Deals',
  company:    'Bedrijven',
  contact:    'Contacten',
  meeting:    'Meetings',
  event:      'Events',
  lesson:     'Lessons',
}

export const SOURCE_ICONS = {
  mail: '✉', engagement: '◆', jira: '◑',
  deal: '★', company: '⌂', contact: '☻',
  meeting: '◐', event: '◇', lesson: '✦',
}

export const DATE_PRESETS = [
  { id: 'all',  label: 'Alles',  months: null },
  { id: '12m',  label: '12 mnd', months: 12 },
  { id: '6m',   label: '6 mnd',  months: 6 },
  { id: '3m',   label: '3 mnd',  months: 3 },
  { id: '1m',   label: '1 mnd',  months: 1 },
]

export const ALL_SOURCES = ['mail', 'engagement', 'jira', 'deal', 'company', 'contact', 'meeting', 'event']

export const ENTITY_TYPES = [
  { id: 'none',    label: 'Geen filter' },
  { id: 'company', label: 'Bedrijf' },
  { id: 'contact', label: 'Contact' },
  { id: 'deal',    label: 'Deal' },
]

// Audience-filter — werkt alleen op mail/engagement (waar from_email beschikbaar is).
export const AUDIENCE_FILTERS = [
  { id: 'all',      label: 'Alle',                 desc: 'Intern + extern' },
  { id: 'internal', label: 'Intern (Legal Mind)',  desc: 'Alleen @legal-mind.nl' },
  { id: 'external', label: 'Extern (klanten)',     desc: 'Alleen externe afzenders' },
]
export const INTERNAL_DOMAIN = 'legal-mind.nl'

export const JELLEMIND_SCOPE_META = {
  jelle:     { label: 'Jelle',      accent: '#8b5cf6' },
  legalmind: { label: 'Legal Mind', accent: '#06b6d4' },
  skill:     { label: 'Skills',     accent: '#10b981' },
}

export const CHAT_SUGGESTIONS = [
  'Wat besprak ik recent met Wintertaling?',
  'Welke openstaande offertes zijn er deze maand?',
  'Welke klanten zitten momenteel in proefperiode?',
  'Wat moet ik nog opvolgen voor de SLA bij Kneppelhout?',
]

export function relTime(iso) {
  if (!iso) return '–'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}u`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d`
  const mo = Math.floor(day / 30)
  if (mo < 12) return `${mo}mnd`
  return `${Math.floor(mo / 12)}j`
}

export function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fmtPct(v) {
  if (v == null) return '–'
  return (Number(v) * 100).toFixed(1) + '%'
}

export function fmtScore(v) {
  if (v == null) return '–'
  return Number(v).toFixed(3)
}

// Mail-sync slaat vaak de body 2× op: eerst HTML-naar-tekst met \r\n behouden,
// daarna een plain-text variant waar alle whitespace platgeslagen is.
export function dropFlattenedDuplicate(s) {
  if (!s) return s
  const lines = s.split('\n')
  if (lines.length < 3) return s
  let maxIdx = -1, maxLen = 0
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > maxLen) { maxLen = lines[i].length; maxIdx = i }
  }
  if (maxLen < 250) return s
  const earlier = lines.slice(0, maxIdx).join(' ').replace(/\s+/g, ' ').trim().toLowerCase()
  if (earlier.length < 80) return s
  const probe = earlier.slice(20, 80)
  const flatLower = lines[maxIdx].toLowerCase()
  if (flatLower.includes(probe)) {
    return lines.filter((_, i) => i !== maxIdx).join('\n').trim()
  }
  return s
}

export function formatReplyQuotes(s) {
  if (!s) return s
  return s
    .replace(/(\S)[ \t]+(From:\s+\S)/g, '$1\n\n$2')
    .replace(/(From:\s[^\n]{1,180}?)[ \t]{2,}(Sent:\s)/gi, '$1\n$2')
    .replace(/(Sent:\s[^\n]{1,120}?)[ \t]{2,}(To:\s)/gi, '$1\n$2')
    .replace(/(To:\s[^\n]{1,200}?)[ \t]{2,}(Cc:\s)/gi, '$1\n$2')
    .replace(/(Cc:\s[^\n]{1,200}?)[ \t]{2,}(Subject:\s)/gi, '$1\n$2')
    .replace(/(Subject:\s[^\n]{1,180}?)[ \t]{2,}(Ha |Dag |Beste |Geachte |Hi |Hallo |Goeden|Goedendag)/g, '$1\n\n$2')
}

// Splits body in top-reply en quoted thread-historie.
export function splitTopAndQuoted(body) {
  if (!body) return { top: '', quoted: null }
  const re = /(?:^|\n)\s*(Van:\s+\S|From:\s+\S|-----\s*Original Message\s*-----|Op\s+\S.{0,80}schreef\s+)/i
  const m = body.match(re)
  if (!m) return { top: body, quoted: null }
  const cutAt = m.index === 0 ? 0 : m.index + 1
  const top = body.slice(0, cutAt).trimEnd()
  const quoted = body.slice(cutAt).trim()
  if (top.length < 20 || quoted.length < 40) return { top: body, quoted: null }
  return { top, quoted }
}

export function paragraphifyQuoted(s) {
  if (!s) return s
  return s
    .replace(/([\.\?\!])\s+(Van:\s+\S)/gi, '$1\n\n$2')
    .replace(/([\.\?\!])\s+(From:\s+\S)/g, '$1\n\n$2')
    .replace(/([\.\?\!])\s+(Op\s+\S.{0,80}?schreef\s+)/gi, '$1\n\n$2')
    .replace(/(Van:\s[^\n]{1,200}?)\s+(Datum:\s)/gi, '$1\n$2')
    .replace(/(Datum:\s[^\n]{1,120}?)\s+(Aan:\s)/gi, '$1\n$2')
    .replace(/(Aan:\s[^\n]{1,200}?)\s+(Cc:\s)/gi, '$1\n$2')
    .replace(/(Cc:\s[^\n]{1,200}?)\s+(Onderwerp:\s)/gi, '$1\n$2')
    .replace(/(Aan:\s[^\n]{1,200}?)\s+(Onderwerp:\s)/gi, '$1\n$2')
    .replace(/(Onderwerp:\s[^\n]{1,180}?)\s+(Ha |Dag |Beste |Geachte |Hi |Hallo |Goeden|Goedendag)/g, '$1\n\n$2')
    .replace(/(From:\s[^\n]{1,200}?)\s+(Sent:\s)/gi, '$1\n$2')
    .replace(/(Sent:\s[^\n]{1,120}?)\s+(To:\s)/gi, '$1\n$2')
    .replace(/(To:\s[^\n]{1,200}?)\s+(Cc:\s)/gi, '$1\n$2')
    .replace(/(Cc:\s[^\n]{1,200}?)\s+(Subject:\s)/gi, '$1\n$2')
    .replace(/(To:\s[^\n]{1,200}?)\s+(Subject:\s)/gi, '$1\n$2')
    .replace(/(Subject:\s[^\n]{1,180}?)\s+(Ha |Dag |Beste |Geachte |Hi |Hallo |Goeden|Goedendag)/g, '$1\n\n$2')
    .replace(/([\.\?\!])\s+(Met vriendelijke groet|Hartelijke groet|Met hartelijke|Vriendelijke groet|Best regards|Kind regards)/gi, '$1\n\n$2')
}

export function cleanText(s) {
  if (!s) return ''
  let out = s.replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  out = dropFlattenedDuplicate(out)
  out = formatReplyQuotes(out)
  return out
}

// Splits content_with_context in (contextuele-samenvatting, body).
export function splitAugmented(contentWithContext, content) {
  if (!contentWithContext) return { prefix: null, body: content ?? '' }
  const sepIdx = contentWithContext.indexOf('\n\n')
  if (sepIdx > 0) {
    const prefix = contentWithContext.slice(0, sepIdx).trim()
    const body = contentWithContext.slice(sepIdx + 2)
    if (prefix.length > 0 && prefix.length < contentWithContext.length * 0.6) {
      return { prefix, body }
    }
  }
  return { prefix: null, body: content ?? contentWithContext }
}

export function deriveSubject(match) {
  const content = match.preview || ''
  const ctx = match.content_with_context || ''
  const subjMatch = content.match(/^Subject:\s*(.+?)$/im)
  if (subjMatch && subjMatch[1].trim()) return subjMatch[1].trim().slice(0, 140)
  const quoteMatch = ctx.match(/["„]([^"„]{3,140})["„]/)
  if (quoteMatch) return quoteMatch[1].trim()
  const lines = content.split('\n').map(l => l.trim()).filter(Boolean)
  for (const line of lines) {
    if (/^\[.+\]$/.test(line)) continue
    if (/^From:|^To:|^Cc:|^Date:/i.test(line)) continue
    return line.slice(0, 140)
  }
  return null
}

// Splitst mail-style content in {folder, headers, body}.
export function parseMailContent(content) {
  if (!content) return { folder: null, headers: [], body: '' }
  const lines = content.split('\n')
  let folder = null
  const headers = []
  let bodyStart = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (i === 0 && /^\[.+\]$/.test(line)) {
      folder = line.replace(/^\[|\]$/g, '')
      bodyStart = i + 1
      continue
    }
    const headerMatch = line.match(/^(From|To|Cc|Bcc|Date|Subject|Folder|Stage|Name|Conversation):\s*(.*)$/i)
    if (headerMatch) {
      headers.push({ key: headerMatch[1], value: headerMatch[2] })
      bodyStart = i + 1
    } else if (line.length === 0 && bodyStart === i) {
      bodyStart = i + 1
    } else {
      break
    }
  }
  const body = lines.slice(bodyStart).join('\n').trim()
  return { folder, headers, body }
}

// Render-helper: vervang [bron #N] door subtiel highlightje + click-to-scroll.
// Source-types matched het hele bekende set zodat ook Grok's vrije keuze
// (bv. "[note #6]" of "[meeting #3]") als klikbare bron werkt.
export function makeAnswerParts(text) {
  if (!text) return []
  const SRC = 'bron|mail|engagement|jira|deal|company|contact|meeting|event|note|action|agenda|lesson'
  const splitRe = new RegExp(`(\\[(?:${SRC})\\s*#\\d+\\])`, 'gi')
  const matchRe = new RegExp(`^\\[(?:${SRC})\\s*#(\\d+)\\]$`, 'i')
  return text.split(splitRe).map((p) => {
    const m = p.match(matchRe)
    if (m) return { type: 'cite', n: parseInt(m[1], 10), label: p }
    return { type: 'text', value: p }
  })
}
