import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import RagChatView from './RagChatView'
import ManualSearchView from './ManualSearchView'

// Wrapper met tab-toggle tussen Chat (default) en handmatig zoeken.
const MODE_KEY = 'rag-view-mode'

export default function RagSearchView() {
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem(MODE_KEY) || 'chat' } catch { return 'chat' }
  })
  const setModeAndPersist = useCallback((m) => {
    setMode(m)
    try { localStorage.setItem(MODE_KEY, m) } catch { /* ignore */ }
  }, [])

  return (
    <div className="stack" style={{ gap: 'var(--s-4)' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <ModeButton active={mode === 'chat'}   onClick={() => setModeAndPersist('chat')}   icon="💬" label="Chat"            sub="Vraag stellen, AI antwoordt met bronnen" />
        <ModeButton active={mode === 'manual'} onClick={() => setModeAndPersist('manual')} icon="🔍" label="Handmatig zoeken" sub="Filter zelf op source, datum, entity" />
        <span style={{ flex: 1 }} />
        <Link to="/instellingen/chat" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Chat-instructies →
        </Link>
      </div>
      {mode === 'chat' ? <RagChatView /> : <ManualSearchView />}
    </div>
  )
}

function ModeButton({ active, onClick, icon, label, sub }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10,
        background: active ? 'rgba(124,58,237,0.10)' : 'transparent',
        border: `1px solid ${active ? '#7c3aed' : 'var(--border)'}`,
        borderRadius: 6, cursor: 'pointer', textAlign: 'left',
        color: 'inherit', font: 'inherit',
      }}
    >
      <span style={{ fontSize: 18 }}>{icon}</span>
      <span style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: active ? 'var(--text)' : 'var(--text-muted)' }}>{label}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</span>
      </span>
    </button>
  )
}
