import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

// MaestroTopbar — extract uit AutoDraftMaestroView (sessie MCM-V4, 2026-05-10).
//
// Toont mockup-topbar boven .mcm-card: crumbs (Postvak / <active-tab>),
// sync-pill met last-sync-age (mockup-conform), Instellingen-knop en
// Nieuwe-mail-knop.
//
// HARD-RULE: oude code is leidend. Dit is een Maestro-only component dat alleen
// wordt gebruikt door AutoDraftMaestroView. Geen impact op /postvak route.
//
// V6.1 (2026-05-11): sync-pill toont last-sync-age (uit latestScanRun.started_at)
// in plaats van current klok — mockup-conform. Tone (success/warn/error)
// gebaseerd op leeftijd: <5m groen, <30m oranje, >30m grijs. Crumbs
// vereenvoudigd zonder "Werkruimte" prefix.

export default function MaestroTopbar({ activeTabLabel = 'Voor jou', latestScanRun = null }) {
  const navigate = useNavigate()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  const sync = useMemo(() => deriveSync(latestScanRun, now), [latestScanRun, now])

  return (
    <header className="mcm-topbar">
      <div className="mcm-crumbs">
        <span className="mcm-crumbs__current">Postvak</span>
        <span className="mcm-crumbs__sep">/</span>
        <span>{activeTabLabel}</span>
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
