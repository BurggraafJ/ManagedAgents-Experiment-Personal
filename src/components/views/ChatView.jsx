import { useMemo, useState } from 'react'
import MicButton from '../MicButton'
import { supabase } from '../../lib/supabase'

// ChatView — algemeen communicatie-kanaal met agents.
// Jelle typt een bericht (optioneel voor een specifieke skill), agents
// lezen pending messages bij hun volgende run en schrijven terug.
// Verbetervoorstellen-tabel onderaan: alles met category='improvement'
// om snel overzicht te hebben van open suggesties.

const CATEGORIES = [
  { id: 'chat',           label: 'Algemeen',      hint: 'gewone vraag of opmerking' },
  { id: 'question',       label: 'Vraag',         hint: 'waarom deed agent X iets?' },
  { id: 'action_request', label: 'Actie',         hint: '"ga kantoor X toevoegen"' },
  { id: 'improvement',    label: 'Verbetering',   hint: 'feature- of workflow-voorstel' },
]

const AGENT_TARGETS = [
  { id: '',                     label: 'Geen specifieke agent' },
  { id: 'hubspot-daily-sync',   label: 'Daily Admin' },
  { id: 'auto-draft',           label: 'Auto-Draft' },
  { id: 'sales-on-road',        label: 'Road Notes' },
  { id: 'sales-todos',          label: 'Daily Tasks' },
  { id: 'linkedin-connect',     label: 'LinkedIn Connect' },
  { id: 'kilometerregistratie', label: 'Kilometerregistratie' },
  { id: 'agent-manager',        label: 'Agent Manager' },
]

export default function ChatView({ data }) {
  const [message, setMessage] = useState('')
  const [target, setTarget]   = useState('')
  const [category, setCategory] = useState('chat')
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState(null)

  const all = data.chat || []
  // Improvement-kanaal apart: database met feature-voorstellen
  const improvements = useMemo(
    () => all.filter(m => m.category === 'improvement').slice(0, 30),
    [all]
  )
  // Conversatie-flow: berichten in chronologische volgorde (oudste boven)
  const conversation = useMemo(
    () => [...all].filter(m => m.category !== 'improvement').reverse().slice(-50),
    [all]
  )

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
            typ een vraag, verzoek of verbetervoorstel — de agent pakt 'm bij de volgende run op en schrijft terug hieronder. Ctrl/⌘+Enter om te versturen.
          </span>
        </div>

        <div className="chat">
          <div className="chat__messages">
            {conversation.length === 0 ? (
              <div className="empty">Nog geen berichten.</div>
            ) : conversation.map(m => <ChatMessage key={m.id} m={m} />)}
          </div>

          <div className="chat__compose">
            <div className="chat__compose-row">
              <select
                className="chat__select"
                value={target}
                onChange={e => setTarget(e.target.value)}
                disabled={busy}
              >
                {AGENT_TARGETS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
              <select
                className="chat__select"
                value={category}
                onChange={e => setCategory(e.target.value)}
                disabled={busy}
              >
                {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <span className="muted" style={{ fontSize: 11 }}>{CATEGORIES.find(c => c.id === category)?.hint || ''}</span>
            </div>
            <div className="textarea-wrap">
              <textarea
                className="chat__input"
                value={message}
                onChange={e => setMessage(e.target.value)}
                onKeyDown={onKey}
                placeholder="Typ een bericht… (of klik op 🎙 om in te spreken)"
                rows={3}
                disabled={busy}
              />
              <MicButton onTranscript={t => setMessage(prev => (prev ? `${prev} ${t}` : t).trim())} />
            </div>
            <div className="chat__btns">
              <button className="btn btn--accent" onClick={send} disabled={busy || !message.trim()}>
                {busy ? 'Versturen…' : 'Versturen'}
              </button>
              {err && <span className="record-row__msg">⚠ {err}</span>}
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="section__head">
          <h2 className="section__title">
            Verbetervoorstellen {improvements.length > 0 && <span className="section__count">{improvements.length}</span>}
          </h2>
          <span className="section__hint">
            alle berichten met categorie "Verbetering" — een database van features/workflow-ideeën voor later.
          </span>
        </div>
        {improvements.length === 0 ? (
          <div className="empty">Nog geen verbetervoorstellen. Typ er een boven met categorie "Verbetering".</div>
        ) : (
          <div className="stack stack--sm">
            {improvements.map(m => (
              <div key={m.id} className="improvement">
                <div className="improvement__head">
                  {m.target_skill && (
                    <span className="pill pill--skill">{AGENT_TARGETS.find(a => a.id === m.target_skill)?.label || m.target_skill}</span>
                  )}
                  <span className={`improvement__status improvement__status--${m.status}`}>{m.status}</span>
                  <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>{formatDateTime(m.sent_at)}</span>
                </div>
                <div className="improvement__text">{m.user_message}</div>
                {m.agent_response && (
                  <div className="improvement__response">
                    <span className="muted">antwoord: </span>{m.agent_response}
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

function ChatMessage({ m }) {
  const isUser = m.author === 'user'
  return (
    <div className={`chat-msg chat-msg--${m.author}`}>
      <div className="chat-msg__head">
        <span className="chat-msg__author">{isUser ? 'Jij' : (m.picked_up_by || m.author)}</span>
        {m.target_skill && isUser && <span className="pill pill--skill">@ {m.target_skill}</span>}
        {m.category && m.category !== 'chat' && <span className="pill">{m.category}</span>}
        {m.status === 'pending' && isUser && <span className="pill pill--waiting">wacht op antwoord</span>}
        <span className="muted" style={{ fontSize: 10, marginLeft: 'auto' }}>{formatDateTime(m.sent_at)}</span>
      </div>
      <div className="chat-msg__body">
        {isUser ? m.user_message : m.agent_response}
      </div>
    </div>
  )
}

function formatDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
