import { useState, useEffect } from 'react'
import MaestroFoldersTree from './MaestroFoldersTree'

// TabsSidebar — 264px verticale tabs-sidebar van het Postvak.
//
// Toont zes audience-tabs (Voor jou / Star / In afwachting / Niet voor jou /
// Concepten / Logs) gesynchroniseerd met InboxPanel-state via audience/
// setAudience props. Folder-tree onderaan toont Outlook-mappen uit
// autodraft_folders + categorieën hun default_target_folder.
//
// De tab-id 'priority' (label 'Star') komt uit een eerdere iteratie waar
// het label 'Pin' was — id behouden voor backwards-compat met InboxPanel
// flaggedMailIds wiring.
const TABS = [
  { id: 'for_you',     label: 'Voor jou',         icon: 'inbox' },
  { id: 'priority',    label: 'Star',             icon: 'star' },
  { id: 'awaiting',    label: 'In afwachting',    icon: 'hourglass' },
  { id: 'not_for_you', label: 'Niet voor jou',    icon: 'eye-off' },
  { id: 'sent_drafts', label: 'Concepten',        icon: 'edit' },
  { id: 'logs',        label: 'Logs',             icon: 'log' },
]

// FOLDER_TREE wordt niet meer hier gebruikt — MaestroFoldersTree bouwt
// een dynamische tree uit de folders-prop, met fallback in eigen file.

// Lucide-style icons inline (zonder externe lib-dependency)
function TabIcon({ name }) {
  const paths = {
    inbox:     <><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/></>,
    star:      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>,
    hourglass: <><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></>,
    'eye-off': <><path d="m15 18-.722-3.25"/><path d="M2 8a10.645 10.645 0 0 0 20 0"/><path d="m20 15-1.726-2.05"/><path d="m4 15 1.726-2.05"/><path d="m9 18 .722-3.25"/></>,
    edit:      <><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></>,
    log:       <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 8h7"/><path d="M9 12h7"/><path d="M9 16h4"/></>,
    search:    <><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></>,
    chev:      <polyline points="6 9 12 15 18 9"/>,
  }
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  )
}

// V8.5 (2026-05-13): TabsSidebar breedte is nu drag-resizable. Publiceert
// listWidth-style een CSS-var `--mcm-tabs-width` op document-root, die door
// .theme-maestro.mc-maestro-app grid-template-columns wordt gelezen.
// Range 200-360px, persist in localStorage.
const TABS_WIDTH_DEFAULT = 264
const TABS_WIDTH_MIN     = 200
const TABS_WIDTH_MAX     = 360

export default function TabsSidebar({
  audience, setAudience, audienceCounts = {}, folders = [], categories = [],
  // V6.2 (2026-05-11): query + setQuery laat de search functioneel zijn
  // door door te geven aan InboxPanel (controlled mode).
  query = '', setQuery,
}) {
  const [foldersOpen, setFoldersOpen] = useState(true)
  // Lokale buffer zodat typen direct in input zichtbaar is, met debounce
  // naar parent setQuery zodat re-renders niet bij elke toetsaanslag vuren.
  const [localQuery, setLocalQuery] = useState(query)
  useEffect(() => { setLocalQuery(query) }, [query])
  useEffect(() => {
    if (!setQuery) return
    const t = setTimeout(() => {
      if (localQuery !== query) setQuery(localQuery)
    }, 180)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localQuery])

  // V8.5: drag-resize state + publiceren als CSS-var
  const [tabsWidth, setTabsWidth] = useState(() => {
    try {
      const saved = localStorage.getItem('mcm-tabs-width')
      const n = saved ? Number(saved) : TABS_WIDTH_DEFAULT
      return Number.isFinite(n) ? Math.max(TABS_WIDTH_MIN, Math.min(TABS_WIDTH_MAX, n)) : TABS_WIDTH_DEFAULT
    } catch { return TABS_WIDTH_DEFAULT }
  })
  useEffect(() => {
    try { localStorage.setItem('mcm-tabs-width', String(tabsWidth)) } catch {}
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--mcm-tabs-width', `${tabsWidth}px`)
    }
  }, [tabsWidth])
  const startTabsDrag = (e) => {
    e.preventDefault()
    const startX = e.clientX
    let startW = 0
    setTabsWidth(w => { startW = w; return w })
    function onMove(ev) {
      const dx = ev.clientX - startX
      const next = Math.max(TABS_WIDTH_MIN, Math.min(TABS_WIDTH_MAX, startW + dx))
      setTabsWidth(next)
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <aside className="mcm-tabs">
      <div className="mcm-tabs__head">
        <div className="mcm-tabs__search">
          <TabIcon name="search" />
          <input
            type="search"
            placeholder="Zoek in Postvak…"
            value={localQuery}
            onChange={e => setLocalQuery(e.target.value)}
            aria-label="Zoek in postvak"
          />
          <span className="mcm-tabs__kbd" aria-hidden>⌘K</span>
        </div>
      </div>

      <nav className="mcm-tabs__nav" aria-label="Postvak tabs">
        {TABS.map(t => {
          const on = audience === t.id
          const count = audienceCounts[t.id]
          const showCount = count !== null && count !== undefined && count > 0
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setAudience(t.id)}
              className={`mcm-tab ${on ? 'mcm-tab--active' : ''}`}
              aria-pressed={on}
            >
              <span className="mcm-tab__icon" aria-hidden>
                <TabIcon name={t.icon} />
              </span>
              <span className="mcm-tab__label">{t.label}</span>
              {showCount && (
                <span className={`mcm-tab__count ${t.id === 'for_you' && count > 0 ? 'mcm-tab__count--alert' : ''}`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      <div className="mcm-tabs__divider" />

      <button
        type="button"
        className={`mcm-tabs__folders-head ${foldersOpen ? '' : 'mcm-tabs__folders-head--collapsed'}`}
        onClick={() => setFoldersOpen(v => !v)}
        aria-expanded={foldersOpen}
      >
        <span className="mcm-tabs__chev" aria-hidden>
          <TabIcon name="chev" />
        </span>
        <span>Mappen</span>
      </button>
      {foldersOpen && <MaestroFoldersTree folders={folders} categories={categories} />}

      <div className="mcm-tabs__spacer" />

      {/* V8.5: resize-handle op de rechter-edge van de TabsSidebar.
          Sleep om mappen-kolom breedte te wijzigen (200-360px). */}
      <div
        className="mcm-tabs__resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Sleep om TabsSidebar te resizen"
        onMouseDown={startTabsDrag}
        title="Sleep om de mappen-kolom breder/smaller te maken"
      />
    </aside>
  )
}

// Export TABS lijst zodat AutoDraftView de active label kan ophalen voor de
// crumbs in MaestroTopbar.
export { TABS as MAESTRO_TABS }
