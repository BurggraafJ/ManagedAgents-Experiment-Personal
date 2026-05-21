import { useState, useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import s from './zoeken.module.css'
import { Ico } from './Icons'
import ChatMode from './ChatMode'
import ObjectsMode from './ObjectsMode'

// RagSearchView — parent + topbar + mode-switch + scrim/panel-state.
// Twee modes: chat / objects. Mode + entity-id deep-link via URL.
//   /zoeken                              → chat (default)
//   /zoeken?mode=objects&company_id=...  → objects mode op company
const MODES = ['chat', 'objects']
const MODE_LS_KEY = 'rag-mode'

export default function RagSearchView() {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlMode = searchParams.get('mode')
  const urlCompanyId = searchParams.get('company_id')

  const [mode, setMode] = useState(() => {
    if (urlMode && MODES.includes(urlMode)) return urlMode
    try { return localStorage.getItem(MODE_LS_KEY) || 'chat' } catch { return 'chat' }
  })

  const changeMode = useCallback((m) => {
    setMode(m)
    try { localStorage.setItem(MODE_LS_KEY, m) } catch { /* ignore */ }
  }, [])

  // Clean URL na bootstrap (deep-link verbruikt) zodat refresh niet steeds reset.
  useEffect(() => {
    if (urlMode || urlCompanyId) {
      const next = new URLSearchParams(searchParams)
      next.delete('mode')
      next.delete('company_id')
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [resetTick, setResetTick] = useState(0)
  const onNewChat = () => {
    if (mode !== 'chat') changeMode('chat')
    setResetTick(t => t + 1)
  }

  return (
    <div className={s.zkApp}>
      <Topbar mode={mode} onMode={changeMode} onNew={onNewChat} />
      <div className={s.body}>
        {mode === 'chat' && <ChatMode resetTick={resetTick} />}
        {mode === 'objects' && <ObjectsMode initialCompanyId={urlCompanyId} />}
      </div>
    </div>
  )
}

function Topbar({ mode, onMode, onNew }) {
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
