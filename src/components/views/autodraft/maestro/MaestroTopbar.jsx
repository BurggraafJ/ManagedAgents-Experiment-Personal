import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import SyncQueueDropdown from './SyncQueueDropdown'

// MaestroTopbar — bovenste balk van het Postvak.
//
// Bevat: collapse-toggle voor TabsSidebar, breadcrumbs (Postvak / <tab>),
// audience-dropdown achter de actieve tab, sync-pill met decisions-queue,
// en de Instellingen / Nieuwe-mail-knoppen rechts.
//
// Wordt alleen door AutoDraftView gebruikt; staat hier omdat de logica zelf
// onafhankelijk is van de InboxPanel-state en daarom als topbar leeft.

// Audience-tabs lijst (gespiegeld van TabsSidebar TABS) — definieert label +
// audience-id zodat MaestroTopbar de switcher kan tonen zonder TabsSidebar
// te hoeven importeren (cyclic-import-risico).
// 2026-05-21: Star-tab verwijderd. Gepinde mails verschijnen nu als
// 'Pinned'-sectie BOVENIN de Voor jou-lijst (Outlook-stijl).
const AUDIENCE_OPTIONS = [
  { id: 'for_you',     label: 'Voor jou' },
  // 2026-05-27 — 'In afwachting' gesplitst naar twee tabs (Klanten/Algemeen).
  { id: 'awaiting_klant',    label: 'In afwachting (klanten)' },
  { id: 'awaiting_algemeen', label: 'In afwachting (algemeen)' },
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
  // V8.9 (2026-05-13): sync-pill is nu klikbaar en opent een dropdown met
  // Jelle's beslissingen-queue (pending / success / failed) van laatste 24u.
  // decisions, mails, folders worden doorgegeven aan SyncQueueDropdown.
  decisions = [],
  mails = [],
  folders = [],
  // V12 (2026-05-21): 3-dots-menu verhuisd van MaestroListHeader hierheen
  // (= hoogste navigatiebalk). Jelle: ListHeader is ruis en kost ruimte.
  onOpenRagHealth = null,
  // 2026-05-31: "Postvak opnieuw scannen" — wist de huidige voorstellen +
  // nudget auto-draft zodat alles vers herbouwd wordt (test na skill-update).
  onRescanPostvak = null,
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

  // V8.9: sync-queue-dropdown state (klik op sync-pill).
  const [syncOpen, setSyncOpen] = useState(false)
  const syncWrapRef = useRef(null)
  useEffect(() => {
    if (!syncOpen) return
    function onDocClick(e) {
      if (syncWrapRef.current && !syncWrapRef.current.contains(e.target)) setSyncOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [syncOpen])

  // V12 (2026-05-21): 3-dots menu in topbar (rechts).
  const [moreOpen, setMoreOpen] = useState(false)
  const moreWrapRef = useRef(null)
  useEffect(() => {
    if (!moreOpen) return
    function onDocClick(e) {
      if (moreWrapRef.current && !moreWrapRef.current.contains(e.target)) setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [moreOpen])

  // Tellers voor de sync-pill badge — pending + failed van laatste 24u.
  const queueStats = useMemo(() => {
    const cutoff = Date.now() - 24 * 3600 * 1000
    let pending = 0, failed = 0
    for (const d of decisions || []) {
      if (!d?.decided_at) continue
      if (new Date(d.decided_at).getTime() < cutoff) continue
      const isFailed = d.execution_status === 'failed' || !!d.execution_error
      if (isFailed) failed++
      else if (!d.executed_at) pending++
    }
    return { pending, failed }
  }, [decisions])

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
        {/* V8.9 (2026-05-13): sync-pill is een button + dropdown met queue
            van Jelle's beslissingen (pending / failed / recent verwerkt). */}
        <span ref={syncWrapRef} className="mcm-sync-wrap">
          <button
            type="button"
            className={`mcm-sync-pill mcm-sync-pill--${sync.tone} ${syncOpen ? 'mcm-sync-pill--open' : ''}`}
            title={`${sync.title} — klik voor beslissingen-queue`}
            onClick={() => setSyncOpen(v => !v)}
            aria-haspopup="menu"
            aria-expanded={syncOpen}
          >
            <span className="mcm-sync-dot" />
            <span>{sync.label}</span>
            <span className="mcm-sync-meta">{sync.meta}</span>
            {(queueStats.pending > 0 || queueStats.failed > 0) && (
              <span className={`mcm-sync-badge ${queueStats.failed > 0 ? 'mcm-sync-badge--err' : ''}`} aria-hidden>
                {queueStats.failed > 0 ? `!${queueStats.failed}` : queueStats.pending}
              </span>
            )}
          </button>
          {syncOpen && (
            <SyncQueueDropdown
              decisions={decisions}
              mails={mails}
              folders={folders}
              onClose={() => setSyncOpen(false)}
            />
          )}
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
        {/* V12 (2026-05-21): 3-dots menu — verplaatst van MaestroListHeader */}
        <span ref={moreWrapRef} className="mcm-topbar__more-wrap">
          <button
            type="button"
            className="mcm-btn mcm-btn--ghost mcm-topbar__more-btn"
            title="Meer opties"
            aria-label="Meer opties"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(v => !v)}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="1"/>
              <circle cx="19" cy="12" r="1"/>
              <circle cx="5"  cy="12" r="1"/>
            </svg>
          </button>
          {moreOpen && (
            <div className="mcm-topbar__more-menu" role="menu">
              {onOpenRagHealth && (
                <button
                  type="button"
                  role="menuitem"
                  className="mcm-topbar__more-item"
                  onClick={() => { onOpenRagHealth(); setMoreOpen(false) }}
                  title="Open de wekelijkse RAG-coverage details in een popup"
                >
                  <span className="mcm-topbar__more-icon" aria-hidden>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 3v18h18"/>
                      <path d="M7 14l3-3 3 3 5-5"/>
                      <path d="M14 6h5v5"/>
                    </svg>
                  </span>
                  <span className="mcm-topbar__more-label">RAG-gegevens</span>
                </button>
              )}
              {onRescanPostvak && (
                <button
                  type="button"
                  role="menuitem"
                  className="mcm-topbar__more-item"
                  onClick={() => { onRescanPostvak(); setMoreOpen(false) }}
                  title="Wis de huidige voorstellen en laat auto-draft alles vers opnieuw scannen (test na een update). Verstuurt niets."
                >
                  <span className="mcm-topbar__more-icon" aria-hidden>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
                      <path d="M21 3v5h-5"/>
                      <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
                      <path d="M3 21v-5h5"/>
                    </svg>
                  </span>
                  <span className="mcm-topbar__more-label">Postvak opnieuw scannen</span>
                </button>
              )}
            </div>
          )}
        </span>
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
