import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

// MaestroTopbar — extract uit AutoDraftMaestroView (sessie MCM-V4, 2026-05-10).
//
// V8.6 (2026-05-13): twee uitbreidingen
//   - Collapse-toggle (☰/✕) links van de crumbs om TabsSidebar in/uit te klappen
//   - "Voor jou" crumb is nu een dropdown-trigger; klik switcht audience zonder
//     de TabsSidebar te hoeven openen. Handig wanneer Jelle de mappen-kolom
//     dicht heeft.
//
// HARD-RULE: oude code is leidend. Dit is een Maestro-only component dat alleen
// wordt gebruikt door AutoDraftMaestroView. Geen impact op /postvak route.

// Audience-tabs lijst (gespiegeld van TabsSidebar TABS) — definieert label
// + audience-id zodat MaestroTopbar de switcher kan tonen zonder TabsSidebar
// te hoeven importeren (cyclic-import-risico).
const AUDIENCE_OPTIONS = [
  { id: 'for_you',     label: 'Voor jou' },
  { id: 'priority',    label: 'Star' },
  { id: 'awaiting',    label: 'In afwachting' },
  { id: 'not_for_you', label: 'Niet voor jou' },
  { id: 'sent_drafts', label: 'Concepten' },
  { id: 'logs',        label: 'Logs' },
]

export default function MaestroTopbar({
  activeTabLabel = 'Voor jou',
  latestScanRun = null,
  // V8.6: nieuwe props voor audience-switch en TabsSidebar collapse.
  audience = 'for_you',
  setAudience = null,
  audienceCounts = {},
  tabsCollapsed = false,
  onToggleTabs = null,
}) {
  const navigate = useNavigate()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  const sync = useMemo(() => deriveSync(latestScanRun, now), [latestScanRun, now])

  // Audience-dropdown state — open via klik op de "Voor jou"-crumb.
  const [audOpen, setAudOpen] = useState(false)
  const audWrapRef = useRef(null)
  useEffect(() => {
    if (!audOpen) return
    function onDocClick(e) {
      if (audWrapRef.current && !audWrapRef.current.contains(e.target)) setAudOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [audOpen])

  return (
    <header className="mcm-topbar">
      <div className="mcm-topbar__left">
        {/* V8.6: collapse-toggle. Wanneer collapsed → ☰ (open), anders ← (close). */}
        {onToggleTabs && (
          <button
            type="button"
            className="mcm-topbar__sidebar-toggle"
            onClick={onToggleTabs}
            aria-pressed={!tabsCollapsed}
            title={tabsCollapsed ? 'Toon mappen-paneel (links)' : 'Verberg mappen-paneel'}
            aria-label={tabsCollapsed ? 'Toon mappen-paneel' : 'Verberg mappen-paneel'}
          >
            {tabsCollapsed ? (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h18M3 12h18M3 18h18"/>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2"/>
                <path d="M9 4v16"/>
                <path d="M5.5 9h.01M5.5 12h.01M5.5 15h.01"/>
              </svg>
            )}
          </button>
        )}
        <div className="mcm-crumbs">
          <span className="mcm-crumbs__current">Postvak</span>
          <span className="mcm-crumbs__sep">/</span>
          {/* V8.6: actieve crumb is een dropdown-trigger voor audience-switch. */}
          <span ref={audWrapRef} className="mcm-crumbs__menu-wrap">
            <button
              type="button"
              className={`mcm-crumbs__active ${audOpen ? 'mcm-crumbs__active--open' : ''}`}
              onClick={() => setAudOpen(v => !v)}
              aria-haspopup="menu"
              aria-expanded={audOpen}
              title="Switch audience-categorie"
              disabled={!setAudience}
            >
              {activeTabLabel}
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ marginLeft: 4 }}>
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            {audOpen && setAudience && (
              <div className="mcm-crumbs__menu" role="menu">
                {AUDIENCE_OPTIONS.map(opt => {
                  const isActive = opt.id === audience
                  const count = audienceCounts[opt.id]
                  const showCount = count !== null && count !== undefined && count > 0
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={isActive}
                      className={`mcm-crumbs__menu-item ${isActive ? 'mcm-crumbs__menu-item--active' : ''}`}
                      onClick={() => { setAudience(opt.id); setAudOpen(false) }}
                    >
                      <span className="mcm-crumbs__menu-label">{opt.label}</span>
                      {showCount && <span className="mcm-crumbs__menu-count">{count}</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </span>
        </div>
      </div>
      <div className="mcm-topbar__actions">
        <span className={`mcm-sync-pill mcm-sync-pill--${sync.tone}`} title={sync.title}>
          <span className="mcm-sync-dot" />
          <span>{sync.label}</span>
          <span className="mcm-sync-meta">{sync.meta}</span>
        </span>
        <button
          type="button"
          className="mcm-btn mcm-btn--ghost"
          onClick={() => navigate('/postvak/instellingen')}
          title="Beheer voorstellen, categorieën en regels van auto-draft"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82 2 2 0 1 1-2.83 2.83 1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51 2 2 0 1 1-4 0 1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33 2 2 0 1 1-2.83-2.83 1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1 2 2 0 1 1 0-4 1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82 2 2 0 1 1 2.83-2.83 1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33 2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          Instellingen
        </button>
        <button
          type="button"
          className="mcm-btn mcm-btn--primary"
          title="Nieuwe mail (gaat naar Outlook compose)"
          onClick={() => window.open('https://outlook.office.com/mail/deeplink/compose', '_blank')}
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 4v16M4 12h16"/>
          </svg>
          Nieuwe mail
        </button>
      </div>
    </header>
  )
}

// deriveSync — berekent label/meta/tone uit latestScanRun-timestamp.
// Mockup-conform: pill toont "Sync wat oud · 3m" wanneer oud is, of
// "Live · just nu" wanneer recent. Tone bepaalt kleur van .mcm-sync-dot.
function deriveSync(latestScanRun, now) {
  if (!latestScanRun?.started_at) {
    return {
      label: 'Nog niet gesynct',
      meta: '',
      tone: 'idle',
      title: 'Geen scan-run gevonden — orchestrator draait nog niet',
    }
  }
  const ageMs = now - new Date(latestScanRun.started_at).getTime()
  const ageMin = Math.floor(ageMs / 60000)
  let label, meta, tone, title
  if (ageMin < 1) {
    label = 'Live'
    meta = 'net'
    tone = 'ok'
  } else if (ageMin < 5) {
    label = 'Live'
    meta = `${ageMin}m`
    tone = 'ok'
  } else if (ageMin < 30) {
    label = 'Sync wat oud'
    meta = `${ageMin}m`
    tone = 'warn'
  } else if (ageMin < 1440) {
    label = 'Niet gesynct'
    const h = Math.round(ageMin / 60)
    meta = `${h}u`
    tone = 'idle'
  } else {
    label = 'Niet gesynct'
    meta = `${Math.round(ageMin / 1440)}d`
    tone = 'idle'
  }
  title = `Laatste mail-sync: ${ageMin < 1 ? 'net' : `${ageMin} min geleden`}`
  return { label, meta, tone, title }
}
