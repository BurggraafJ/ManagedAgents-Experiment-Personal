import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import MicButton from '../MicButton'
import { supabase } from '../../lib/supabase'
import { useChat } from '../../hooks/useChat'
import styles from './ChatView.module.css'

// ChatView v3 — twee-paneel chat (history-zijbalk + actieve thread).
// Sessions worden client-side aangemaakt (uuid in localStorage) en in de DB
// gegroepeerd via agent_chat_messages.session_id. "Nieuwe chat" start een
// verse sessie; oude blijven zichtbaar als kaarten links.

const LEGACY_SESSION_ID = '00000000-0000-0000-0000-000000000001'
const LS_KEY = 'lm_chat_session_v3'

const CATEGORIES = [
  { id: 'chat',           label: 'Algemeen',    hint: 'gewone vraag of opmerking' },
  { id: 'question',       label: 'Vraag',       hint: 'waarom deed agent X iets?' },
  { id: 'action_request', label: 'Actie',       hint: '"ga kantoor X toevoegen"' },
  { id: 'improvement',    label: 'Verbetering', hint: 'feature- of workflow-voorstel' },
]

const AGENT_TARGETS = [
  { id: '',                     label: 'Geen specifieke agent', emoji: '💬' },
  { id: 'daily-admin',          label: 'Administratie',         emoji: '📋' },
  { id: 'auto-draft',           label: 'Mailing',               emoji: '✉️' },
  { id: 'sales-on-road',        label: 'Road Notes',            emoji: '🛣️' },
  { id: 'sales-todos',          label: 'Daily Tasks',           emoji: '✅' },
  { id: 'linkedin-connect',     label: 'LinkedIn',              emoji: '🔗' },
  { id: 'kilometerregistratie', label: 'Kilometers',            emoji: '🚗' },
  { id: 'agent-manager',        label: 'Agent Manager',         emoji: '🧠' },
]

const QUICK_PROMPTS = [
  { label: 'Status van vandaag',     text: 'Geef me een korte status van wat er vandaag gebeurd is.' },
  { label: 'Wat staat er te doen?',  text: 'Wat zijn de belangrijkste open taken voor mij?' },
  { label: 'Verbetervoorstel',       text: '', category: 'improvement' },
]

function newSessionId() {
  // RFC4122-v4 via crypto (overal beschikbaar in moderne browsers)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function loadCurrentSession() {
  try { return localStorage.getItem(LS_KEY) || null } catch { return null }
}
function saveCurrentSession(sid) {
  try { sid ? localStorage.setItem(LS_KEY, sid) : localStorage.removeItem(LS_KEY) } catch {}
}

function labelFor(id) {
  return AGENT_TARGETS.find(a => a.id === id)?.label || id
}
function emojiFor(id) {
  return AGENT_TARGETS.find(a => a.id === id)?.emoji || '🤖'
}

function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
function formatDay(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const today = new Date(); today.setHours(0,0,0,0)
  const day = new Date(d); day.setHours(0,0,0,0)
  const diff = (today - day) / 86400000
  if (diff === 0) return 'Vandaag'
  if (diff === 1) return 'Gisteren'
  if (diff < 7)  return d.toLocaleDateString('nl-NL', { weekday: 'long' })
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' })
}
function formatRelative(iso) {
  if (!iso) return ''
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1)    return 'zojuist'
  if (min < 60)   return `${min}m`
  if (min < 1440) return `${Math.round(min / 60)}u`
  return `${Math.round(min / 1440)}d`
}

// Migratie 2026-05-08: leest niet meer uit `data`-prop maar uit eigen
// useChat-hook. Onderdeel van Refactor 02.
export default function ChatView() {
  const { messages: all } = useChat()

  // Improvement-kanaal blijft een aparte database
  const improvements = useMemo(
    () => all.filter(m => m.category === 'improvement'),
    [all]
  )

  // Niet-improvement berichten gegroepeerd per sessie
  const sessions = useMemo(() => groupSessions(all), [all])

  // Welke sessie is actief? localStorage > eerste niet-archived > nieuwe
  const [activeSession, setActiveSession] = useState(() => {
    return loadCurrentSession()
  })
  const [showArchived, setShowArchived] = useState(false)

  // Eerste keer of geen geldige sessie → kies meest recente niet-archived,
  // of genereer een nieuwe placeholder (wordt pas in DB aangemaakt bij send)
  useEffect(() => {
    if (activeSession) return
    const firstActive = sessions.find(s => !s.archived)
    if (firstActive) {
      setActiveSession(firstActive.id)
      saveCurrentSession(firstActive.id)
    } else {
      const fresh = newSessionId()
      setActiveSession(fresh)
      saveCurrentSession(fresh)
    }
  }, [activeSession, sessions])

  const visibleSessions = useMemo(() => {
    return sessions.filter(s => showArchived ? s.archived : !s.archived)
  }, [sessions, showArchived])

  const currentMessages = useMemo(() => {
    if (!activeSession) return []
    const session = sessions.find(s => s.id === activeSession)
    return session ? session.messages : []
  }, [sessions, activeSession])

  function startNewChat() {
    const sid = newSessionId()
    setActiveSession(sid)
    saveCurrentSession(sid)
  }

  function selectSession(sid) {
    setActiveSession(sid)
    saveCurrentSession(sid)
  }

  async function archiveSession(sid) {
    await supabase.rpc('archive_chat_session', { p_session_id: sid })
    if (sid === activeSession) startNewChat()
  }

  async function unarchiveSession(sid) {
    await supabase.rpc('unarchive_chat_session', { p_session_id: sid })
  }

  return (
    <div className="stack stack--gap-5">

      <div className="chat-v3">
        <ChatSidebar
          sessions={visibleSessions}
          activeId={activeSession}
          showArchived={showArchived}
          onSelect={selectSession}
          onNew={startNewChat}
          onArchive={archiveSession}
          onUnarchive={unarchiveSession}
          onToggleArchived={() => setShowArchived(v => !v)}
        />

        <ChatThread
          sessionId={activeSession}
          messages={currentMessages}
          onArchive={() => activeSession && archiveSession(activeSession)}
          isLegacy={activeSession === LEGACY_SESSION_ID}
        />
      </div>

      <section>
        <div className="section__head">
          <h2 className="section__title">
            Verbetervoorstellen
            {improvements.length > 0 && <span className="section__count">{improvements.length}</span>}
          </h2>
          <span className="section__hint">
            alle berichten met categorie "Verbetering" — een database voor later
          </span>
        </div>
        {improvements.length === 0 ? (
          <div className="empty">Nog geen verbetervoorstellen. Typ er een boven met categorie "Verbetering".</div>
        ) : (
          <div className="stack stack--sm">
            {improvements.slice(0, 30).map(m => (
              <div key={m.id} className="chat-v2__improvement">
                <div className="chat-v2__improvement-head">
                  {m.target_skill && <span className="pill pill--skill">@ {labelFor(m.target_skill)}</span>}
                  <span className={`chat-v2__pill chat-v2__pill--${m.status}`}>{m.status}</span>
                  <span className="chat-v2__improvement-time">{formatDateTime(m.sent_at)}</span>
                </div>
                <div className="chat-v2__improvement-text">{m.user_message}</div>
                {m.agent_response && (
                  <div className="chat-v2__improvement-reply">
                    <span className="chat-v2__improvement-reply-label">Antwoord</span>
                    {m.agent_response}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

// — Sessie-grouping —————————————————————————————————————————————————————

function groupSessions(all) {
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
  // Meest recente boven; legacy altijd onderaan
  sessions.sort((a, b) => {
    if (a.isLegacy && !b.isLegacy) return 1
    if (!a.isLegacy && b.isLegacy) return -1
    return new Date(b.lastAt || 0) - new Date(a.lastAt || 0)
  })
  return sessions
}

// — Sidebar —————————————————————————————————————————————————————————————

function ChatSidebar({ sessions, activeId, showArchived, onSelect, onNew, onArchive, onUnarchive, onToggleArchived }) {
  return (
    <aside className="chat-v3__sidebar">
      <div className="chat-v3__sidebar-head">
        <button className="btn btn--accent chat-v3__new-btn" onClick={onNew} title="Begin een nieuwe chat">
          <span className="chat-v3__new-btn-icon">＋</span>
          Nieuwe chat
        </button>
      </div>
      <div className="chat-v3__sidebar-tabs">
        <button
          className={`chat-v3__sidebar-tab ${!showArchived ? 'is-active' : ''}`}
          onClick={() => showArchived && onToggleArchived()}
        >
          Recent
        </button>
        <button
          className={`chat-v3__sidebar-tab ${showArchived ? 'is-active' : ''}`}
          onClick={() => !showArchived && onToggleArchived()}
        >
          Archief
        </button>
      </div>

      <div className="chat-v3__sidebar-list">
        {sessions.length === 0 ? (
          <div className="chat-v3__sidebar-empty">
            {showArchived
              ? 'Nog geen gearchiveerde chats.'
              : 'Nog geen chats. Begin links boven met "Nieuwe chat".'}
          </div>
        ) : sessions.map(s => (
          <SessionCard
            key={s.id}
            session={s}
            active={s.id === activeId}
            onSelect={() => onSelect(s.id)}
            onArchive={() => onArchive(s.id)}
            onUnarchive={() => onUnarchive(s.id)}
            archivedView={showArchived}
          />
        ))}
      </div>
    </aside>
  )
}

function SessionCard({ session, active, onSelect, onArchive, onUnarchive, archivedView }) {
  const lastUser = [...session.messages].reverse().find(m => m.author === 'user')
  const preview = (lastUser?.user_message || session.title || '').slice(0, 90)

  return (
    <button
      type="button"
      className={`chat-v3__session ${active ? 'is-active' : ''}`}
      onClick={onSelect}
    >
      <div className="chat-v3__session-row">
        <span className="chat-v3__session-title" title={session.title}>{session.title}</span>
        <span className="chat-v3__session-time">{formatRelative(session.lastAt)}</span>
      </div>
      <div className="chat-v3__session-preview">{preview}</div>
      <div className="chat-v3__session-meta">
        <span className="chat-v3__session-count">{session.count} {session.count === 1 ? 'bericht' : 'berichten'}</span>
        {session.pendingCount > 0 && (
          <span className="chat-v3__session-pending">
            <span className="dot dot--pulse" /> {session.pendingCount} wachtend
          </span>
        )}
        {session.latestTarget && (
          <span className="chat-v3__session-target">@ {labelFor(session.latestTarget)}</span>
        )}
        <span
          role="button"
          tabIndex={0}
          className="chat-v3__session-action"
          onClick={(e) => { e.stopPropagation(); archivedView ? onUnarchive() : onArchive() }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); archivedView ? onUnarchive() : onArchive() }}}
          title={archivedView ? 'Terugzetten' : 'Archiveer deze chat'}
        >
          {archivedView ? '↺ herstel' : '✕ archief'}
        </span>
      </div>
    </button>
  )
}

// — Thread + Compose ————————————————————————————————————————————————————

function ChatThread({ sessionId, messages, onArchive, isLegacy }) {
  const [message, setMessage]   = useState('')
  const [target, setTarget]     = useState('')
  const [category, setCategory] = useState('chat')
  const [busy, setBusy]         = useState(false)
  const [err, setErr]           = useState(null)
  const scrollRef               = useRef(null)
  const inputRef                = useRef(null)

  // Auto-scroll naar onderkant bij nieuwe berichten / sessiewissel
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length, sessionId])

  const send = useCallback(async () => {
    if (!message.trim() || !sessionId) return
    setBusy(true); setErr(null)
    try {
      const { data: res, error } = await supabase.rpc('send_chat_message', {
        message:    message.trim(),
        target:     target || null,
        category,
        session_id: sessionId,
      })
      if (error)                        setErr(error.message)
      else if (res && res.ok === false) setErr(res.reason || 'mislukt')
      else                              setMessage('')
    } catch (e) { setErr(e.message || 'netwerkfout') }
    setBusy(false)
  }, [message, sessionId, target, category])

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      send()
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      send()
    }
  }

  function applyQuickPrompt(p) {
    if (p.text) setMessage(p.text)
    if (p.category) setCategory(p.category)
    inputRef.current?.focus()
  }

  // Datum-separators inbouwen tussen berichten van verschillende dagen
  const stream = useMemo(() => withDateSeparators(messages), [messages])

  return (
    <div className="chat-v3__thread">
      <header className="chat-v3__thread-head">
        <div className="chat-v3__thread-head-info">
          <h3 className="chat-v3__thread-title">
            {isLegacy ? 'Eerdere chat' : (messages[0]?.session_title || messages[0]?.user_message?.slice(0, 60) || 'Nieuwe chat')}
          </h3>
          <span className="chat-v3__thread-sub">
            {messages.length === 0
              ? 'Nog geen berichten in deze chat'
              : `${messages.length} ${messages.length === 1 ? 'bericht' : 'berichten'} · gestart ${formatDay(messages[0]?.sent_at)}`}
          </span>
        </div>
        {messages.length > 0 && !isLegacy && (
          <button className="chat-v3__thread-action" onClick={onArchive} title="Verberg uit huidige lijst">
            Archiveren
          </button>
        )}
      </header>

      <div className="chat-v3__stream" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="chat-v3__empty">
            <div className="chat-v3__empty-icon">💬</div>
            <div className="chat-v3__empty-title">Begin het gesprek</div>
            <div className="chat-v3__empty-hint">
              Vraag een agent iets, of kies een snelle opener:
            </div>
            <div className="chat-v3__empty-prompts">
              {QUICK_PROMPTS.map(p => (
                <button key={p.label} className="chat-v3__quick" onClick={() => applyQuickPrompt(p)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        ) : stream.map((item, i) => {
          if (item.type === 'separator') {
            return <DateSeparator key={`sep-${i}`} label={item.label} />
          }
          return <ChatRow key={item.m.id} m={item.m} />
        })}
      </div>

      <div className="chat-v3__compose">
        <div className="chat-v3__compose-meta">
          <span className="chat-v3__compose-label">Aan</span>
          <select
            className="chat-v3__select"
            value={target}
            onChange={e => setTarget(e.target.value)}
            disabled={busy}
            aria-label="Aan welke agent?"
          >
            {AGENT_TARGETS.map(a => (
              <option key={a.id} value={a.id}>
                {a.emoji} {a.label}
              </option>
            ))}
          </select>
          <span className="chat-v3__compose-divider" />
          <span className="chat-v3__compose-label">Soort</span>
          <select
            className="chat-v3__select"
            value={category}
            onChange={e => setCategory(e.target.value)}
            disabled={busy}
            aria-label="Soort bericht"
          >
            {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <span className="chat-v3__compose-hint">
            {CATEGORIES.find(c => c.id === category)?.hint || ''}
          </span>
        </div>

        <div className="chat-v3__input-wrap">
          <textarea
            ref={inputRef}
            className="chat-v3__input"
            value={message}
            onChange={e => setMessage(e.target.value)}
            onKeyDown={onKey}
            placeholder={isLegacy
              ? 'Deze chat is een archief. Begin een nieuwe chat om te schrijven.'
              : 'Typ een bericht…  (Enter = verstuur · Shift+Enter = nieuwe regel)'}
            rows={3}
            disabled={busy || isLegacy}
          />
          <div className="chat-v3__input-actions">
            <span className="chat-v3__counter">{message.length > 0 ? `${message.length} tekens` : ''}</span>
            <MicButton onTranscript={t => setMessage(prev => (prev ? `${prev} ${t}` : t).trim())} />
            <button
              className="btn btn--accent chat-v3__send"
              onClick={send}
              disabled={busy || !message.trim() || isLegacy}
            >
              {busy ? 'Versturen…' : 'Versturen ▸'}
            </button>
          </div>
        </div>

        {err && <div className="chat-v3__err">⚠ {err}</div>}
      </div>
    </div>
  )
}

// — Helpers ———————————————————————————————————————————————————————————————

function withDateSeparators(messages) {
  const out = []
  let lastDay = null
  for (const m of messages) {
    const d = new Date(m.sent_at); d.setHours(0, 0, 0, 0)
    const key = d.toISOString().slice(0, 10)
    if (key !== lastDay) {
      out.push({ type: 'separator', label: formatDay(m.sent_at) })
      lastDay = key
    }
    out.push({ type: 'msg', m })
  }
  return out
}

function DateSeparator({ label }) {
  return (
    <div className="chat-v3__date-sep">
      <span className="chat-v3__date-sep-line" />
      <span className="chat-v3__date-sep-label">{label}</span>
      <span className="chat-v3__date-sep-line" />
    </div>
  )
}

function ChatRow({ m }) {
  const isUser = m.author === 'user'
  const targetLabel = m.target_skill ? labelFor(m.target_skill) : null

  if (!isUser) {
    return (
      <div className="chat-v3__row chat-v3__row--agent">
        <div className="chat-v3__avatar chat-v3__avatar--agent">
          {emojiFor(m.picked_up_by || m.target_skill)}
        </div>
        <div className="chat-v3__bubble-col">
          <div className="chat-v3__bubble chat-v3__bubble--agent">
            {m.agent_response || m.user_message}
          </div>
          <div className="chat-v3__meta">
            <span>{labelFor(m.picked_up_by || m.target_skill || 'agent')}</span>
            <span>·</span>
            <span title={formatDateTime(m.sent_at)}>{formatRelative(m.sent_at)}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-v3__exchange">
      <div className="chat-v3__row chat-v3__row--user">
        <div className="chat-v3__bubble-col chat-v3__bubble-col--user">
          <div className="chat-v3__bubble chat-v3__bubble--user">
            {m.user_message}
          </div>
          <div className="chat-v3__meta chat-v3__meta--user">
            {targetLabel && <span className="pill pill--skill">@ {targetLabel}</span>}
            {m.category && m.category !== 'chat' && (
              <span className="pill">{m.category}</span>
            )}
            <span title={formatDateTime(m.sent_at)}>{formatRelative(m.sent_at)}</span>
          </div>
        </div>
        <div className="chat-v3__avatar chat-v3__avatar--user">J</div>
      </div>

      {m.status === 'pending' && (
        <div className="chat-v3__pending">
          <span className="dot dot--pulse" />
          {targetLabel
            ? `wacht op ${targetLabel} bij volgende run…`
            : 'wacht op een agent…'}
        </div>
      )}

      {m.status === 'picked_up' && (
        <div className="chat-v3__pending">
          <span className="dot s-running" />
          {labelFor(m.picked_up_by || m.target_skill || 'agent')} is bezig met antwoord…
        </div>
      )}

      {m.agent_response && (
        <div className={`chat-v3__row chat-v3__row--agent ${styles.replyRow}`}>
          <div className="chat-v3__avatar chat-v3__avatar--agent">
            {emojiFor(m.picked_up_by || m.target_skill)}
          </div>
          <div className="chat-v3__bubble-col">
            <div className="chat-v3__bubble chat-v3__bubble--agent">
              {m.agent_response}
            </div>
            <div className="chat-v3__meta">
              <span>{labelFor(m.picked_up_by || m.target_skill || 'agent')}</span>
              <span>·</span>
              <span title={formatDateTime(m.answered_at)}>{formatRelative(m.answered_at || m.sent_at)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
