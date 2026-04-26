import { useMemo, useState, useEffect, useRef } from 'react'
import MicButton from '../MicButton'
import { supabase } from '../../lib/supabase'

// ChatView v2 — messenger-stijl bubbles. Per chat-rij toont we:
//   - User-vraag rechts (accent-bubble)
//   - Status-balkje eronder ('wacht op antwoord' / 'opgepakt door X')
//   - Indien beantwoord: agent-reply links als tweede bubble met agent-naam +
//     tijdstempel.
// Improvements-tabel onderaan blijft, maar compacter en met response-bubble.

const CATEGORIES = [
  { id: 'chat',           label: 'Algemeen',    hint: 'gewone vraag of opmerking' },
  { id: 'question',       label: 'Vraag',       hint: 'waarom deed agent X iets?' },
  { id: 'action_request', label: 'Actie',       hint: '"ga kantoor X toevoegen"' },
  { id: 'improvement',    label: 'Verbetering', hint: 'feature- of workflow-voorstel' },
]

const AGENT_TARGETS = [
  { id: '',                     label: 'Geen specifieke agent' },
  { id: 'hubspot-daily-sync',   label: 'Administratie' },
  { id: 'auto-draft',           label: 'Mailing' },
  { id: 'sales-on-road',        label: 'Road Notes' },
  { id: 'sales-todos',          label: 'Daily Tasks' },
  { id: 'linkedin-connect',     label: 'LinkedIn' },
  { id: 'kilometerregistratie', label: 'Kilometers' },
  { id: 'agent-manager',        label: 'Agent Manager' },
]

function labelFor(id) {
  return AGENT_TARGETS.find(a => a.id === id)?.label || id
}

function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function formatRelative(iso) {
  if (!iso) return ''
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'zojuist'
  if (min < 60) return `${min}m geleden`
  if (min < 1440) return `${Math.round(min / 60)}u geleden`
  return `${Math.round(min / 1440)}d geleden`
}

export default function ChatView({ data }) {
  const [message, setMessage]   = useState('')
  const [target, setTarget]     = useState('')
  const [category, setCategory] = useState('chat')
  const [busy, setBusy]         = useState(false)
  const [err, setErr]           = useState(null)
  const scrollRef               = useRef(null)

  const all = data.chat || []

  // Improvement-kanaal apart: database met feature-voorstellen
  const improvements = useMemo(
    () => all.filter(m => m.category === 'improvement'),
    [all]
  )

  // Conversatie: alle non-improvement berichten chronologisch (oudste boven).
  // Een rij is óf een user-bericht óf een losse agent-bericht. User-rij met
  // agent_response toont automatisch beide bubbles.
  const conversation = useMemo(
    () => [...all].filter(m => m.category !== 'improvement').reverse().slice(-80),
    [all]
  )

  // Auto-scroll naar onderkant bij nieuwe berichten
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [conversation.length])

  async function send() {
    if (!message.trim()) return
    setBusy(true); setErr(null)
    try {
      const { data: res, error } = await supabase.rpc('send_chat_message', {
        message: message.trim(),
        target:  target || null,
        category,
      })
      if (error)                        setErr(error.message)
      else if (res && res.ok === false) setErr(res.reason || 'mislukt')
      else                              setMessage('')
    } catch (e) { setErr(e.message || 'netwerkfout') }
    setBusy(false)
  }

  function onKey(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send()
  }

  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>

      <section>
        <div className="section__head">
          <h2 className="section__title">Gesprek</h2>
          <span className="section__hint">
            Stel een vraag of geef een opdracht — agents lezen 'm bij hun volgende run en plaatsen hier hun antwoord.
            <span style={{ marginLeft: 8 }}><kbd>Ctrl/⌘+Enter</kbd> = verzenden.</span>
          </span>
        </div>

        <div className="chat-v2">
          <div className="chat-v2__stream" ref={scrollRef}>
            {conversation.length === 0 ? (
              <div className="chat-v2__empty">
                <div style={{ fontSize: 32, marginBottom: 8 }}>💬</div>
                <div>Nog geen berichten. Stel hieronder een vraag aan een agent.</div>
              </div>
            ) : conversation.map(m => <ChatRow key={m.id} m={m} />)}
          </div>

          <div className="chat-v2__compose">
            <div className="chat-v2__compose-meta">
              <select
                className="chat-v2__select"
                value={target}
                onChange={e => setTarget(e.target.value)}
                disabled={busy}
                aria-label="Aan welke agent?"
              >
                {AGENT_TARGETS.map(a => <option key={a.id} value={a.id}>{a.id ? `→ ${a.label}` : a.label}</option>)}
              </select>
              <select
                className="chat-v2__select"
                value={category}
                onChange={e => setCategory(e.target.value)}
                disabled={busy}
                aria-label="Soort bericht"
              >
                {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <span className="chat-v2__hint">
                {CATEGORIES.find(c => c.id === category)?.hint || ''}
              </span>
            </div>

            <div className="chat-v2__input-wrap">
              <textarea
                className="chat-v2__input"
                value={message}
                onChange={e => setMessage(e.target.value)}
                onKeyDown={onKey}
                placeholder="Typ een bericht…"
                rows={3}
                disabled={busy}
              />
              <div className="chat-v2__input-actions">
                <MicButton onTranscript={t => setMessage(prev => (prev ? `${prev} ${t}` : t).trim())} />
                <button
                  className="btn btn--accent chat-v2__send"
                  onClick={send}
                  disabled={busy || !message.trim()}
                >
                  {busy ? 'Versturen…' : 'Versturen ▸'}
                </button>
              </div>
            </div>

            {err && <div className="chat-v2__err">⚠ {err}</div>}
          </div>
        </div>
      </section>

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

function ChatRow({ m }) {
  const isUser = m.author === 'user'
  const targetLabel = m.target_skill ? labelFor(m.target_skill) : null

  // Een 'user' rij kan een agent_response bevatten — dan toon we beide bubbles.
  // Een rij van author='agent' is een standalone bericht (zelden gebruikt).

  if (!isUser) {
    // Standalone agent-bericht
    return (
      <div className="chat-v2__row chat-v2__row--agent">
        <div className="chat-v2__avatar chat-v2__avatar--agent">
          {(m.picked_up_by || m.target_skill || 'A').charAt(0).toUpperCase()}
        </div>
        <div>
          <div className="chat-v2__bubble chat-v2__bubble--agent">
            {m.agent_response || m.user_message}
          </div>
          <div className="chat-v2__meta">
            <span>{labelFor(m.picked_up_by || m.target_skill || 'agent')}</span>
            <span>·</span>
            <span title={formatDateTime(m.sent_at)}>{formatRelative(m.sent_at)}</span>
          </div>
        </div>
      </div>
    )
  }

  // User-vraag (rechts) — eventueel met reply (links) eronder
  return (
    <div className="chat-v2__exchange">
      <div className="chat-v2__row chat-v2__row--user">
        <div>
          <div className="chat-v2__bubble chat-v2__bubble--user">
            {m.user_message}
          </div>
          <div className="chat-v2__meta chat-v2__meta--user">
            {targetLabel && <span className="pill pill--skill">@ {targetLabel}</span>}
            {m.category && m.category !== 'chat' && (
              <span className="pill">{m.category}</span>
            )}
            <span title={formatDateTime(m.sent_at)}>{formatRelative(m.sent_at)}</span>
          </div>
        </div>
        <div className="chat-v2__avatar chat-v2__avatar--user">J</div>
      </div>

      {m.status === 'pending' && (
        <div className="chat-v2__pending">
          <span className="dot dot--pulse" />
          {targetLabel
            ? `wacht op ${targetLabel} bij volgende run…`
            : 'wacht op een agent…'}
        </div>
      )}

      {m.status === 'picked_up' && (
        <div className="chat-v2__pending">
          <span className="dot s-running" />
          {labelFor(m.picked_up_by || m.target_skill || 'agent')} is bezig met antwoord…
        </div>
      )}

      {m.agent_response && (
        <div className="chat-v2__row chat-v2__row--agent" style={{ marginTop: 6 }}>
          <div className="chat-v2__avatar chat-v2__avatar--agent">
            {(m.picked_up_by || m.target_skill || 'A').charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="chat-v2__bubble chat-v2__bubble--agent">
              {m.agent_response}
            </div>
            <div className="chat-v2__meta">
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
