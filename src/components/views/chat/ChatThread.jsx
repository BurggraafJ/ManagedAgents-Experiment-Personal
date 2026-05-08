import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { CATEGORIES, AGENT_TARGETS, QUICK_PROMPTS, labelForAgent, emojiForAgent, withDateSeparators } from '../../../lib/chat'
import { formatDay, formatDateTime, relativeTime } from '../../../lib/dateFormat'
import MicButton from '../../MicButton'
import styles from './ChatView.module.css'

/**
 * ChatThread — actieve thread-paneel rechts in de chat-shell. Toont stream
 * (messages + date-separators) en de compose-zone. Verzendt nieuwe berichten
 * via RPC `send_chat_message`.
 */
export default function ChatThread({ sessionId, messages, onArchive, isLegacy }) {
  const [message, setMessage]   = useState('')
  const [target, setTarget]     = useState('')
  const [category, setCategory] = useState('chat')
  const [busy, setBusy]         = useState(false)
  const [err, setErr]           = useState(null)
  const scrollRef               = useRef(null)
  const inputRef                = useRef(null)

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
            <div className="chat-v3__empty-hint">Vraag een agent iets, of kies een snelle opener:</div>
            <div className="chat-v3__empty-prompts">
              {QUICK_PROMPTS.map(p => (
                <button key={p.label} className="chat-v3__quick" onClick={() => applyQuickPrompt(p)}>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        ) : stream.map((item, i) => {
          if (item.type === 'separator') return <DateSeparator key={`sep-${i}`} iso={item.iso} />
          return <ChatRow key={item.m.id} m={item.m} />
        })}
      </div>

      <ChatComposer
        ref={inputRef}
        message={message}
        target={target}
        category={category}
        busy={busy}
        err={err}
        isLegacy={isLegacy}
        onMessage={setMessage}
        onTarget={setTarget}
        onCategory={setCategory}
        onSend={send}
        onKey={onKey}
      />
    </div>
  )
}

function DateSeparator({ iso }) {
  return (
    <div className="chat-v3__date-sep">
      <span className="chat-v3__date-sep-line" />
      <span className="chat-v3__date-sep-label">{formatDay(iso)}</span>
      <span className="chat-v3__date-sep-line" />
    </div>
  )
}

function ChatRow({ m }) {
  const isUser = m.author === 'user'
  const targetLabel = m.target_skill ? labelForAgent(m.target_skill) : null

  if (!isUser) {
    return (
      <div className="chat-v3__row chat-v3__row--agent">
        <div className="chat-v3__avatar chat-v3__avatar--agent">
          {emojiForAgent(m.picked_up_by || m.target_skill)}
        </div>
        <div className="chat-v3__bubble-col">
          <div className="chat-v3__bubble chat-v3__bubble--agent">
            {m.agent_response || m.user_message}
          </div>
          <div className="chat-v3__meta">
            <span>{labelForAgent(m.picked_up_by || m.target_skill || 'agent')}</span>
            <span>·</span>
            <span title={formatDateTime(m.sent_at)}>{relativeTime(m.sent_at) || ''}</span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="chat-v3__exchange">
      <div className="chat-v3__row chat-v3__row--user">
        <div className="chat-v3__bubble-col chat-v3__bubble-col--user">
          <div className="chat-v3__bubble chat-v3__bubble--user">{m.user_message}</div>
          <div className="chat-v3__meta chat-v3__meta--user">
            {targetLabel && <span className="pill pill--skill">@ {targetLabel}</span>}
            {m.category && m.category !== 'chat' && <span className="pill">{m.category}</span>}
            <span title={formatDateTime(m.sent_at)}>{relativeTime(m.sent_at) || ''}</span>
          </div>
        </div>
        <div className="chat-v3__avatar chat-v3__avatar--user">J</div>
      </div>

      {m.status === 'pending' && (
        <div className="chat-v3__pending">
          <span className="dot dot--pulse" />
          {targetLabel ? `wacht op ${targetLabel} bij volgende run…` : 'wacht op een agent…'}
        </div>
      )}

      {m.status === 'picked_up' && (
        <div className="chat-v3__pending">
          <span className="dot s-running" />
          {labelForAgent(m.picked_up_by || m.target_skill || 'agent')} is bezig met antwoord…
        </div>
      )}

      {m.agent_response && (
        <div className={`chat-v3__row chat-v3__row--agent ${styles.replyRow}`}>
          <div className="chat-v3__avatar chat-v3__avatar--agent">
            {emojiForAgent(m.picked_up_by || m.target_skill)}
          </div>
          <div className="chat-v3__bubble-col">
            <div className="chat-v3__bubble chat-v3__bubble--agent">{m.agent_response}</div>
            <div className="chat-v3__meta">
              <span>{labelForAgent(m.picked_up_by || m.target_skill || 'agent')}</span>
              <span>·</span>
              <span title={formatDateTime(m.answered_at)}>{relativeTime(m.answered_at || m.sent_at) || ''}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const ChatComposer = forwardRef(function ChatComposer(
  { message, target, category, busy, err, isLegacy, onMessage, onTarget, onCategory, onSend, onKey },
  inputRef,
) {
  const cat = CATEGORIES.find(c => c.id === category)
  return (
    <div className="chat-v3__compose">
      <div className="chat-v3__compose-meta">
        <span className="chat-v3__compose-label">Aan</span>
        <select
          className="chat-v3__select"
          value={target}
          onChange={e => onTarget(e.target.value)}
          disabled={busy}
          aria-label="Aan welke agent?"
        >
          {AGENT_TARGETS.map(a => (
            <option key={a.id} value={a.id}>{a.emoji} {a.label}</option>
          ))}
        </select>
        <span className="chat-v3__compose-divider" />
        <span className="chat-v3__compose-label">Soort</span>
        <select
          className="chat-v3__select"
          value={category}
          onChange={e => onCategory(e.target.value)}
          disabled={busy}
          aria-label="Soort bericht"
        >
          {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <span className="chat-v3__compose-hint">{cat?.hint || ''}</span>
      </div>

      <div className="chat-v3__input-wrap">
        <textarea
          ref={inputRef}
          className="chat-v3__input"
          value={message}
          onChange={e => onMessage(e.target.value)}
          onKeyDown={onKey}
          placeholder={isLegacy
            ? 'Deze chat is een archief. Begin een nieuwe chat om te schrijven.'
            : 'Typ een bericht…  (Enter = verstuur · Shift+Enter = nieuwe regel)'}
          rows={3}
          disabled={busy || isLegacy}
        />
        <div className="chat-v3__input-actions">
          <span className="chat-v3__counter">{message.length > 0 ? `${message.length} tekens` : ''}</span>
          <MicButton onTranscript={t => onMessage(message ? `${message} ${t}`.trim() : t.trim())} />
          <button
            className="btn btn--accent chat-v3__send"
            onClick={onSend}
            disabled={busy || !message.trim() || isLegacy}
          >
            {busy ? 'Versturen…' : 'Versturen ▸'}
          </button>
        </div>
      </div>

      {err && <div className="chat-v3__err">⚠ {err}</div>}
    </div>
  )
})
