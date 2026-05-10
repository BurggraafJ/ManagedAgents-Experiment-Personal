import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAutoDraft } from '../../../hooks/useAutoDraft'
import { useSupabaseQuery } from '../../../hooks/useSupabaseQuery'
import { AGENT } from '../../../lib/autodraft'
import InboxPanel from './inbox/InboxPanel'
import './autodraft-maestro.css'

// AutoDraftMaestroView — Postvak Maestro (mockup uit Downloads/Postvak (1).html, 2026-05-10).
//
// HARD-RULE: oude code is leidend. Mockup levert alleen nieuwe styling.
// Routes /postvak en /postvak-maestro draaien naast elkaar — oude blijft 100%
// onaangeroerd, nieuwe URL krijgt Maestro shell + scoped CSS-overlay.
//
// Sessie-stack:
//   - V1 (commit 5dce00f): side-by-side route + basis CSS-overlay
//   - V2 (commit 93729bd): deep polish over alle kernblokken
//   - V3 (deze): 264px tabs-sidebar + folder-tree (controlled audience-prop
//     naar InboxPanel) + modal-style hooks
//
// Patroon analoog aan AgendaMaestroView (sessie AGM-V2). Overlay-CSS scoped
// onder `.theme-maestro.mc-maestro-app` — wint via specificity, raakt /postvak niet.

const BUILD_TAG = 'mcm·v3·2026-05-10'

// 6 audience-tabs uit mockup. Sluit aan op InboxPanel's bestaande audience-state.
// Counts zijn rough approximations — exacte waarden komen alleen terecht in
// MinimalToolbar's tabs (die nu via CSS verborgen zijn in maestro-mode).
const TABS = [
  { id: 'for_you',     label: 'Voor jou',         icon: '📥', accentDot: false },
  { id: 'priority',    label: 'Pin',              icon: '⭐', accentDot: false },
  { id: 'awaiting',    label: 'In afwachting',    icon: '⏳', accentDot: false },
  { id: 'not_for_you', label: 'Niet voor jou',    icon: '👁', accentDot: false },
  { id: 'sent_drafts', label: 'Concepten',        icon: '✏️', accentDot: false },
  { id: 'logs',        label: 'Logs',             icon: '📜', accentDot: false },
]

// Vaste folder-tree die aansluit op Outlook-mappen-conventie. Voor MCM-V3
// voorlopig statisch; folder-data uit useAutoDraft kan later dynamisch
// worden gemapped (zie open vraag in Confluence sub-pagina).
const FOLDER_TREE = [
  { id: 'inbox',     label: 'Inbox' },
  { id: 'general',   label: 'General Storage' },
  { id: 'afdelingen', label: 'Afdelingen', children: [
    { id: 'sales', label: 'Sales' },
    { id: 'cs',    label: 'Customer Success' },
    { id: 'jur',   label: 'Juridisch' },
  ]},
  { id: 'archief',   label: 'Archief' },
  { id: 'spam',      label: 'Spam' },
]

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

  // MCM-V3: audience state hier opgehoest om aan tabs-sidebar te koppelen.
  // Wordt als optionele prop doorgegeven aan InboxPanel — die valt terug op
  // interne state als geen prop binnenkomt (oude /postvak route blijft 100%).
  const [audience, setAudience] = useState('for_you')
  const [folderQuery, setFolderQuery] = useState('')
  const [foldersOpen, setFoldersOpen] = useState(true)

  // Rough audience-counts uit mails-set. Pin/awaiting/sent_drafts vereisen
  // complete InboxPanel-derivations en blijven leeg in sidebar — counts
  // blijven zichtbaar in MinimalToolbar's audience-tabs (via CSS verborgen
  // in maestro-mode, maar bestaan nog en kunnen opnieuw zichtbaar gemaakt).
  const audienceCounts = useMemo(() => {
    const out = { for_you: 0, priority: 0, awaiting: 0, not_for_you: 0, sent_drafts: 0, logs: null }
    for (const m of (mails || [])) {
      if (m.status !== 'pending' && m.status !== 'amended') continue
      if (m.audience === 'for_you')     out.for_you++
      if (m.audience === 'not_for_you') out.not_for_you++
    }
    return out
  }, [mails])

  const [clock, setClock] = useState(() => formatClock(new Date()))
  useEffect(() => {
    const id = setInterval(() => setClock(formatClock(new Date())), 30000)
    return () => clearInterval(id)
  }, [])

  // Pending count voor topbar-meta + diagnostische log
  const pendingCount = useMemo(() =>
    (mails || []).filter(m => m.status === 'pending' || m.status === 'amended').length,
    [mails])

  // eslint-disable-next-line no-console
  console.log(`[AutoDraftMaestroView ${BUILD_TAG}] mounted — ${pendingCount} pending mails, audience=${audience}`)

  // Active tab-label voor crumbs
  const activeTabLabel = useMemo(() =>
    TABS.find(t => t.id === audience)?.label || 'Voor jou',
    [audience])

  return (
    <div className="theme-maestro mc-maestro-app">
      {/* Mockup-topbar (crumbs + sync-pill + nieuwe-mail-knop) */}
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

      {/* Card-wrapper rond hele postvak (mockup .card met witte achtergrond + border-radius) */}
      <div className="mcm-card">
        <div className="mcm-shell">
          {/* MCM-V3: 264px tabs-sidebar + folder-tree.
              Controlled-audience flow: setAudience prop → InboxPanel rerendert. */}
          <aside className="mcm-tabs">
            <div className="mcm-tabs__head">
              <div className="mcm-tabs__search">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7"/>
                  <path d="m21 21-4.3-4.3"/>
                </svg>
                <input
                  type="search"
                  placeholder="Zoek in Postvak…"
                  value={folderQuery}
                  onChange={e => setFolderQuery(e.target.value)}
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
                    <span className="mcm-tab__icon" aria-hidden>{t.icon}</span>
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
                <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </span>
              <span>Mappen</span>
            </button>
            {foldersOpen && (
              <div className="mcm-tabs__nav">
                {FOLDER_TREE.map(f => (
                  <FolderItem key={f.id} folder={f} />
                ))}
              </div>
            )}

            <div className="mcm-tabs__spacer" />
          </aside>

          <div className="mcm-inbox mc-app">
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
              audience={audience}
              setAudience={setAudience}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// FolderItem — recursive component voor folder-tree. Toont label + nested
// children met inspring. Klikken markeert hem als active (pure visueel,
// folder-filtering is niet gekoppeld in MCM-V3 — beslissing voor later
// wanneer Outlook-folder-binding compleet is).
function FolderItem({ folder, depth = 0 }) {
  return (
    <>
      <button
        type="button"
        className="mcm-tab mcm-tab--folder"
        style={{ paddingLeft: 10 + depth * 16 }}
        title={`Verplaats naar ${folder.label}`}
      >
        <span className="mcm-tab__icon" aria-hidden>📁</span>
        <span className="mcm-tab__label">{folder.label}</span>
      </button>
      {folder.children?.map(child => (
        <FolderItem key={child.id} folder={child} depth={depth + 1} />
      ))}
    </>
  )
}

function formatClock(d) {
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}
