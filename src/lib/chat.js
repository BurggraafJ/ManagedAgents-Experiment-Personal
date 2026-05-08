// Pure helpers voor chat-data — sessie-grouping en date-separators.
// Geen React; geen Supabase.

export const LEGACY_SESSION_ID = '00000000-0000-0000-0000-000000000001'
export const LS_SESSION_KEY = 'lm_chat_session_v3'

export const CATEGORIES = [
  { id: 'chat',           label: 'Algemeen',    hint: 'gewone vraag of opmerking' },
  { id: 'question',       label: 'Vraag',       hint: 'waarom deed agent X iets?' },
  { id: 'action_request', label: 'Actie',       hint: '"ga kantoor X toevoegen"' },
  { id: 'improvement',    label: 'Verbetering', hint: 'feature- of workflow-voorstel' },
]

export const AGENT_TARGETS = [
  { id: '',                     label: 'Geen specifieke agent', emoji: '💬' },
  { id: 'daily-admin',          label: 'Administratie',         emoji: '📋' },
  { id: 'auto-draft',           label: 'Mailing',               emoji: '✉️' },
  { id: 'sales-on-road',        label: 'Road Notes',            emoji: '🛣️' },
  { id: 'sales-todos',          label: 'Daily Tasks',           emoji: '✅' },
  { id: 'linkedin-connect',     label: 'LinkedIn',              emoji: '🔗' },
  { id: 'kilometerregistratie', label: 'Kilometers',            emoji: '🚗' },
  { id: 'agent-manager',        label: 'Agent Manager',         emoji: '🧠' },
]

export const QUICK_PROMPTS = [
  { label: 'Status van vandaag',    text: 'Geef me een korte status van wat er vandaag gebeurd is.' },
  { label: 'Wat staat er te doen?', text: 'Wat zijn de belangrijkste open taken voor mij?' },
  { label: 'Verbetervoorstel',      text: '', category: 'improvement' },
]

export function labelForAgent(id) {
  return AGENT_TARGETS.find(a => a.id === id)?.label || id
}

export function emojiForAgent(id) {
  return AGENT_TARGETS.find(a => a.id === id)?.emoji || '🤖'
}

/**
 * RFC4122-v4 UUID via crypto API met fallback voor oudere browsers.
 */
export function newSessionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function loadCurrentSession() {
  try { return localStorage.getItem(LS_SESSION_KEY) || null } catch { return null }
}

export function saveCurrentSession(sid) {
  try {
    if (sid) localStorage.setItem(LS_SESSION_KEY, sid)
    else localStorage.removeItem(LS_SESSION_KEY)
  } catch {}
}

/**
 * Groepeer berichten per session_id (legacy session-id voor berichten zonder).
 * Returnt sessions gesorteerd: meest recente boven, legacy altijd onderaan.
 */
export function groupSessions(all) {
  const nonImp = all.filter(m => m.category !== 'improvement')
  const map = new Map()
  for (const m of nonImp) {
    const sid = m.session_id || LEGACY_SESSION_ID
    if (!map.has(sid)) map.set(sid, [])
    map.get(sid).push(m)
  }
  const sessions = []
  for (const [sid, msgs] of map.entries()) {
    msgs.sort((a, b) => new Date(a.sent_at) - new Date(b.sent_at))
    const first    = msgs[0]
    const last     = msgs[msgs.length - 1]
    const archived = msgs.every(m => m.archived === true)
    const titleMsg = msgs.find(m => m.session_title) || first
    sessions.push({
      id: sid,
      messages: msgs,
      firstAt: first?.sent_at,
      lastAt:  last?.sent_at,
      title:   titleMsg.session_title || (first?.user_message || '(zonder onderwerp)').slice(0, 80),
      count:   msgs.length,
      archived,
      pendingCount: msgs.filter(m => m.author === 'user' && m.status === 'pending').length,
      latestTarget: last?.target_skill,
      isLegacy: sid === LEGACY_SESSION_ID,
    })
  }
  sessions.sort((a, b) => {
    if (a.isLegacy && !b.isLegacy) return 1
    if (!a.isLegacy && b.isLegacy) return -1
    return new Date(b.lastAt || 0) - new Date(a.lastAt || 0)
  })
  return sessions
}

/**
 * Voeg date-separators toe tussen berichten van verschillende dagen.
 * Output: stream van { type: 'separator', label } | { type: 'msg', m }.
 */
export function withDateSeparators(messages) {
  const out = []
  let lastDay = null
  for (const m of messages) {
    const d = new Date(m.sent_at); d.setHours(0, 0, 0, 0)
    const key = d.toISOString().slice(0, 10)
    if (key !== lastDay) {
      out.push({ type: 'separator', iso: m.sent_at })
      lastDay = key
    }
    out.push({ type: 'msg', m })
  }
  return out
}

/**
 * Tone-class voor een chat-event in de improvements-feed of activity-log.
 */
export function chatEventTone(eventType) {
  if (eventType === 'sent' || eventType === 'accepted' || eventType === 'run_end') return 's-success'
  if (eventType === 'failed' || eventType === 'rate_limit' || eventType === 'login_required') return 's-error'
  if (eventType === 'queued' || eventType === 'discovered') return 's-idle'
  if (eventType === 'strategy_edit') return 's-warning'
  return ''
}
