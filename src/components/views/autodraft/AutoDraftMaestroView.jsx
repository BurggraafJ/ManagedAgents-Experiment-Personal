import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAutoDraft } from '../../../hooks/useAutoDraft'
import { useSupabaseQuery } from '../../../hooks/useSupabaseQuery'
import { AGENT } from '../../../lib/autodraft'
import InboxPanel from './inbox/InboxPanel'
import './autodraft-maestro.css'

// AutoDraftMaestroView — Postvak Maestro v2 (mockup uit Downloads/Postvak (1).html, 2026-05-10).
//
// HARD-RULE: oude code is leidend. Mockup levert alleen nieuwe styling.
//
// Patroon analoog aan AgendaMaestroView (sessie AGM-V2):
//   - Zelfde hooks/state/sub-components als AutoDraftView (useAutoDraft, InboxPanel,
//     MailDetail, alle modals).
//   - Routes /postvak en /postvak-maestro draaien naast elkaar — oude blijft 100%
//     onaangeroerd, nieuwe URL krijgt Maestro shell + scoped CSS-overlay.
//   - VIEWS-entry voor `autodraft_maestro` is fullWidth=true → App.jsx rendert
//     geen view__header; deze wrapper neemt de topbar over (crumbs + sync-pill +
//     "Nieuw event"-button).
//
// Overlay-CSS scoped onder `.theme-maestro.mc-maestro-app` — wint van globals
// via specificity, raakt /postvak niet (geen theme-maestro daar).

const BUILD_TAG = 'mcm·v1·2026-05-10'

export default function AutoDraftMaestroView({ onNavigate }) {
  const navigate = useNavigate()
  const {
    mails,
    mailMessages,
    decisions,
    folders,
    lessons,
    ignoreRules,
    agentInstructions,
    awaitingDismissed: awaitingDismissedRows,
    hubspotCustomerEmails: customerEmailRows,
    categories: rawCategories,
  } = useAutoDraft()
  const { data: recentRuns } = useSupabaseQuery('agent_runs', {
    select: 'id,agent_name,status,started_at,completed_at,summary,stats',
    in: { agent_name: [AGENT, 'auto-draft-execute'] },
    orderBy: ['started_at', { ascending: false }],
    limit: 20,
  })

  const categories = useMemo(() =>
    (rawCategories || []).slice().sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100)),
    [rawCategories])

  const dismissedConvIds = useMemo(() =>
    new Set((awaitingDismissedRows || []).map(d => d.conversation_id)),
    [awaitingDismissedRows])
  const customerEmails = useMemo(() =>
    new Set((customerEmailRows || []).map(c => (c.email || '').toLowerCase())),
    [customerEmailRows])

  const reminderStyle = useMemo(() => {
    const cfg = (agentInstructions || []).find(c =>
      c.config_key === 'reminder_style' && c.agent_name === 'auto-draft')
    if (!cfg) return ''
    const v = cfg.config_value
    return typeof v === 'string' ? v : (v?.text || '')
  }, [agentInstructions])

  const threadCounts = useMemo(() => {
    const m = new Map()
    for (const x of (mails || [])) {
      if (!x.conversation_id) continue
      m.set(x.conversation_id, (m.get(x.conversation_id) || 0) + 1)
    }
    return m
  }, [mails])

  const latestScanRun = useMemo(() =>
    (recentRuns || []).find(r => r.agent_name === AGENT) || null,
    [recentRuns])

  const [clock, setClock] = useState(() => formatClock(new Date()))
  useEffect(() => {
    const id = setInterval(() => setClock(formatClock(new Date())), 30000)
    return () => clearInterval(id)
  }, [])

  // Pending count voor topbar-meta (alleen mails met status pending|amended)
  const pendingCount = useMemo(() =>
    (mails || []).filter(m => m.status === 'pending' || m.status === 'amended').length,
    [mails])

  // eslint-disable-next-line no-console
  console.log(`[AutoDraftMaestroView ${BUILD_TAG}] mounted — ${pendingCount} pending mails`)

  return (
    <div className="theme-maestro mc-maestro-app">
      {/* Mockup-topbar (crumbs + sync-pill + nieuwe-mail-knop) */}
      <header className="mcm-topbar">
        <div className="mcm-crumbs">
          <span>Werkruimte</span>
          <span className="mcm-crumbs__sep">/</span>
          <span className="mcm-crumbs__current">Postvak</span>
          <span className="mcm-crumbs__sep">/</span>
          <span>Voor jou</span>
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

      {/* Card-wrapper rond hele postvak (mockup .card met witte achtergrond + border-radius) */}
      <div className="mcm-card">
        <div className="mc-app">
          <InboxPanel
            mails={mails}
            mailMessages={mailMessages}
            categories={categories}
            folders={folders}
            lessons={lessons}
            decisions={decisions}
            ignoreRules={ignoreRules}
            dismissedConvIds={dismissedConvIds}
            customerEmails={customerEmails}
            reminderStyle={reminderStyle}
            threadCounts={threadCounts}
            latestScanRun={latestScanRun}
            onNavigate={onNavigate}
          />
        </div>
      </div>
    </div>
  )
}

function formatClock(d) {
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}
