import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useChat } from '../../../hooks/useChat'
import {
  LEGACY_SESSION_ID,
  groupSessions,
  loadCurrentSession,
  saveCurrentSession,
  newSessionId,
  labelForAgent,
} from '../../../lib/chat'
import { formatDateTime } from '../../../lib/dateFormat'
import ChatSidebar from './ChatSidebar'
import ChatThread from './ChatThread'
import styles from './ChatView.module.css'

/**
 * ChatView v3 — twee-paneel chat (history-zijbalk + actieve thread). Sessies
 * leven client-side in localStorage en server-side via session_id-kolom op
 * agent_chat_messages.
 *
 * Refactor 14 (Golf C): container <200 LOC. Sub-componenten Sidebar/Thread
 * in deze folder, helpers (groupSessions, withDateSeparators, etc.) in
 * lib/chat.js. useChat (Refactor 02) levert messages.
 */
export default function ChatView() {
  const { messages: all } = useChat()

  // Improvement-kanaal blijft een aparte database; rest gegroepeerd per sessie.
  const improvements = useMemo(() => all.filter(m => m.category === 'improvement'), [all])
  const sessions = useMemo(() => groupSessions(all), [all])

  const [activeSession, setActiveSession] = useState(() => loadCurrentSession())
  const [showArchived, setShowArchived] = useState(false)

  // Eerste keer of geen geldige sessie → kies meest recente niet-archived,
  // anders genereer een placeholder (wordt pas in DB aangemaakt bij send).
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

  const visibleSessions = useMemo(
    () => sessions.filter(s => showArchived ? s.archived : !s.archived),
    [sessions, showArchived],
  )

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

      <ImprovementsFeed items={improvements} />
    </div>
  )
}

function ImprovementsFeed({ items }) {
  return (
    <section>
      <div className="section__head">
        <h2 className="section__title">
          Verbetervoorstellen
          {items.length > 0 && <span className="section__count">{items.length}</span>}
        </h2>
        <span className={`section__hint ${styles.improvementHint}`}>
          alle berichten met categorie "Verbetering" — een database voor later
        </span>
      </div>
      {items.length === 0 ? (
        <div className="empty">Nog geen verbetervoorstellen. Typ er een boven met categorie "Verbetering".</div>
      ) : (
        <div className="stack stack--sm">
          {items.slice(0, 30).map(m => (
            <div key={m.id} className="chat-v2__improvement">
              <div className="chat-v2__improvement-head">
                {m.target_skill && <span className="pill pill--skill">@ {labelForAgent(m.target_skill)}</span>}
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
  )
}
