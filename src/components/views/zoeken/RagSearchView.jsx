import { useState, useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import s from './zoeken.module.css'
import { Ico } from './Icons'
import ChatMode from './ChatMode'
import ObjectsMode from './ObjectsMode'
import HistoryPanel from './HistoryPanel'
import { useRagChat } from '../../../hooks/useRagChat'

// RagSearchView — parent + topbar + mode-switch + sessions-state.
// useRagChat hook hier zodat zowel ChatMode als topbar-knop (Geschiedenis)
// dezelfde sessies + currentMessages zien.
//
// URL-state:
//   /zoeken                              → nieuw chat (default)
//   /zoeken?session=<uuid>               → laad bestaande chat (bookmarkable)
//   /zoeken?mode=objects&company_id=...  → objects mode op company
const MODES = ['chat', 'objects']
const MODE_LS_KEY = 'rag-mode'

export default function RagSearchView() {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlMode = searchParams.get('mode')
  const urlCompanyId = searchParams.get('company_id')
  const urlSessionId = searchParams.get('session')

  const [mode, setMode] = useState(() => {
    if (urlMode && MODES.includes(urlMode)) return urlMode
    try { return localStorage.getItem(MODE_LS_KEY) || 'chat' } catch { return 'chat' }
  })

  const changeMode = useCallback((m) => {
    setMode(m)
    try { localStorage.setItem(MODE_LS_KEY, m) } catch { /* ignore */ }
  }, [])

  // Clean URL na bootstrap voor mode/company (deep-link verbruikt).
  // session-id blijft echter in de URL zodat bookmarks blijven werken.
  useEffect(() => {
    if (urlMode || urlCompanyId) {
      const next = new URLSearchParams(searchParams)
      next.delete('mode')
      next.delete('company_id')
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Chat-state inclusief sessions — gehoist zodat topbar erbij kan.
  const chat = useRagChat()
  const [historyOpen, setHistoryOpen] = useState(false)

  // Sync URL → sessionId bij mount (en bij URL-wissel via bookmark).
  // Laad alleen als URL-sessionId verschilt van huidige + niet leeg.
  useEffect(() => {
    if (urlSessionId && urlSessionId !== chat.sessionId) {
      chat.loadSession(urlSessionId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSessionId])

  // Sync sessionId → URL zodat bookmarks werken. Replace ipv push zodat
  // back-knop niet door elke sessie-wissel schiet.
  useEffect(() => {
    const current = searchParams.get('session')
    if (chat.sessionId && chat.sessionId !== current) {
      const next = new URLSearchParams(searchParams)
      next.set('session', chat.sessionId)
      setSearchParams(next, { replace: true })
    } else if (!chat.sessionId && current) {
      const next = new URLSearchParams(searchParams)
      next.delete('session')
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.sessionId])

  const onNewChat = () => {
    if (mode !== 'chat') changeMode('chat')
    chat.newSession()
  }

  return (
    <div className={s.zkApp}>
      <Topbar
        mode={mode}
        onMode={changeMode}
        onNew={onNewChat}
        onOpenHistory={() => setHistoryOpen(true)}
      />
      <div className={s.body}>
        {mode === 'chat' && <ChatMode chat={chat} />}
        {mode === 'objects' && <ObjectsMode initialCompanyId={urlCompanyId} />}
      </div>

      <HistoryPanel
        open={historyOpen}
        sessions={chat.sessions}
        currentSessionId={chat.sessionId}
        loading={chat.sessionsLoading}
        onClose={() => setHistoryOpen(false)}
        onPick={(id) => { chat.loadSession(id); setHistoryOpen(false); if (mode !== 'chat') changeMode('chat') }}
        onDelete={chat.deleteSession}
        onNew={() => { chat.newSession(); setHistoryOpen(false); if (mode !== 'chat') changeMode('chat') }}
      />
    </div>
  )
}

function Topbar({ mode, onMode, onNew, onOpenHistory }) {
  return (
    <header className={s.top}>
      <div className={s.crumb}>
        <span>Werkruimte</span>
        <span className={s.sep}>/</span>
        <strong>Zoeken</strong>
      </div>
      <div className={s.modeSwitch} role="tablist">
        <ModeBtn active={mode === 'chat'}    onClick={() => onMode('chat')}    icon={Ico.chat}    label="Vraag & antwoord" />
        <ModeBtn active={mode === 'objects'} onClick={() => onMode('objects')} icon={Ico.objects} label="Doorbladeren" />
      </div>
      <div className={s.topSpacer} />
      <button className={`${s.topBtn} ${s.topBtnGhost}`} onClick={onNew} title="Nieuw gesprek">
        {Ico.plus}
        Nieuw
      </button>
      <button className={s.topBtn} onClick={onOpenHistory} title="Eerdere gesprekken">
        {Ico.list}
        Geschiedenis
      </button>
      <a className={s.topBtn} href="/intelligence/quality" title="Bronnen-kwaliteit (Intelligence)">
        {Ico.info}
        Bronnen
      </a>
    </header>
  )
}

function ModeBtn({ active, onClick, icon, label }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`${s.modeBtn} ${active ? s.modeBtnActive : ''}`}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  )
}
