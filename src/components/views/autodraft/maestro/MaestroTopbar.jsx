import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

// MaestroTopbar — extract uit AutoDraftMaestroView (sessie MCM-V4, 2026-05-10).
//
// Toont mockup-topbar boven .mcm-card: crumbs (Werkruimte / Postvak / <active-tab>),
// sync-pill met live-klok, Instellingen-knop en Nieuwe-mail-knop.
//
// HARD-RULE: oude code is leidend. Dit is een Maestro-only component dat alleen
// wordt gebruikt door AutoDraftMaestroView. Geen impact op /postvak route.

export default function MaestroTopbar({ activeTabLabel = 'Voor jou' }) {
  const navigate = useNavigate()
  const [clock, setClock] = useState(() => formatClock(new Date()))
  useEffect(() => {
    const id = setInterval(() => setClock(formatClock(new Date())), 30000)
    return () => clearInterval(id)
  }, [])

  return (
    <header className="mcm-topbar">
      <div className="mcm-crumbs">
        <span>Werkruimte</span>
        <span className="mcm-crumbs__sep">/</span>
        <span className="mcm-crumbs__current">Postvak</span>
        <span className="mcm-crumbs__sep">/</span>
        <span>{activeTabLabel}</span>
      </div>
      <div className="mcm-topbar__actions">
        <span className="mcm-sync-pill" title="Live-verbinding actief">
          <span className="mcm-sync-dot" />
          <span>Live</span>
          <span className="mcm-sync-meta">{clock}</span>
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

function formatClock(d) {
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}
