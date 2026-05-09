import { useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import styles from './zoeken.module.css'
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
      <div className={styles.modeBar}>
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
      className={`${styles.modeBtn} ${active ? styles.modeBtnActive : ''}`}
    >
      <span className={styles.modeBtnIcon}>{icon}</span>
      <span className={styles.modeBtnLabel}>
        <span className={styles.modeBtnName} style={{ color: active ? 'var(--text)' : 'var(--text-muted)' }}>{label}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sub}</span>
      </span>
    </button>
  )
}
