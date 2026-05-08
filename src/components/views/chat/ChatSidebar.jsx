import { labelForAgent } from '../../../lib/chat'
import { relativeTime } from '../../../lib/dateFormat'

/**
 * ChatSidebar — sessions-lijst links in de chat-shell. Bevat new-button,
 * recent/archief tabs en SessionCards. Tonen + selecteren — geen state
 * (state leeft in de container).
 */
export default function ChatSidebar({ sessions, activeId, showArchived, onSelect, onNew, onArchive, onUnarchive, onToggleArchived }) {
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
        <span className="chat-v3__session-time">{relativeTime(session.lastAt) || ''}</span>
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
          <span className="chat-v3__session-target">@ {labelForAgent(session.latestTarget)}</span>
        )}
        <span
          role="button"
          tabIndex={0}
          className="chat-v3__session-action"
          onClick={(e) => { e.stopPropagation(); archivedView ? onUnarchive() : onArchive() }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); archivedView ? onUnarchive() : onArchive() } }}
          title={archivedView ? 'Terugzetten' : 'Archiveer deze chat'}
        >
          {archivedView ? '↺ herstel' : '✕ archief'}
        </span>
      </div>
    </button>
  )
}
