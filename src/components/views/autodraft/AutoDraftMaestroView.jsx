import { useState, useMemo } from 'react'
import { useAutoDraft } from '../../../hooks/useAutoDraft'
import { useSupabaseQuery } from '../../../hooks/useSupabaseQuery'
import { AGENT } from '../../../lib/autodraft'
import InboxPanel from './inbox/InboxPanel'
import MaestroTopbar from './maestro/MaestroTopbar'
import TabsSidebar, { MAESTRO_TABS } from './maestro/TabsSidebar'
import MaestroListHeader from './maestro/MaestroListHeader'
import './autodraft-maestro.css'

// AutoDraftMaestroView — Postvak Maestro entry-point.
//
// Sessie-stack:
//   - V1 (commit 5dce00f, 2026-05-10): side-by-side route + basis CSS-overlay
//   - V2 (commit 93729bd, 2026-05-10): deep CSS polish over alle kernblokken
//   - V3 (commit c7fb4ad, 2026-05-10): 264px tabs-sidebar + folder-tree + modal-restyle
//   - V4 (deze, 2026-05-10): folder-reorganisatie + extract sub-components naar
//     maestro/ (analoog aan inbox/, modals/, settings/) + MaestroListHeader
//     boven mail-list voor active-audience titel-strook
//
// HARD-RULE: oude code is leidend. Mockup levert alleen nieuwe styling.
// Routes /postvak en /postvak-maestro draaien naast elkaar — oude blijft 100%
// onaangeroerd, nieuwe URL krijgt Maestro shell + scoped CSS-overlay.
//
// Folder-organisatie:
//   views/autodraft/
//   ├── AutoDraftView.jsx           ← oude entry
//   ├── AutoDraftMaestroView.jsx    ← deze file (Maestro entry)
//   ├── MailingSettings.jsx
//   ├── autodraft.module.css        ← oude CSS-module
//   ├── autodraft-maestro.css       ← Maestro-overlay (plain CSS)
//   ├── inbox/                      ← oude sub-componenten
//   ├── modals/                     ← oude modals
//   ├── settings/                   ← oude settings-blokken
//   └── maestro/                    ← Maestro-only sub-componenten
//       ├── MaestroTopbar.jsx
//       ├── TabsSidebar.jsx
//       ├── FolderItem.jsx
//       └── MaestroListHeader.jsx

const BUILD_TAG = 'mcm·v4·2026-05-10'

export default function AutoDraftMaestroView({ onNavigate }) {
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

  // MCM-V3+: audience state hier opgehoest om aan tabs-sidebar te koppelen.
  // InboxPanel valt terug op interne state als audience-prop niet meegegeven
  // wordt (oude /postvak route). Hier passeren we het wel → controlled-mode.
  const [audience, setAudience] = useState('for_you')

  // Rough audience-counts uit mails-set. Pin/Awaiting/Drafts vereisen
  // InboxPanel-derivations die we niet duplicaat optillen — die counts
  // blijven leeg in sidebar, exact-counts staan nog in MinimalToolbar.
  const audienceCounts = useMemo(() => {
    const out = { for_you: 0, priority: 0, awaiting: 0, not_for_you: 0, sent_drafts: 0, logs: null }
    for (const m of (mails || [])) {
      if (m.status !== 'pending' && m.status !== 'amended') continue
      if (m.audience === 'for_you')     out.for_you++
      if (m.audience === 'not_for_you') out.not_for_you++
    }
    return out
  }, [mails])

  // Pending count voor topbar-meta + diagnostische log
  const pendingCount = useMemo(() =>
    (mails || []).filter(m => m.status === 'pending' || m.status === 'amended').length,
    [mails])

  // eslint-disable-next-line no-console
  console.log(`[AutoDraftMaestroView ${BUILD_TAG}] mounted — ${pendingCount} pending mails, audience=${audience}`)

  // Active tab-label voor crumbs
  const activeTabLabel = useMemo(() =>
    MAESTRO_TABS.find(t => t.id === audience)?.label || 'Voor jou',
    [audience])

  // Audience-specifieke count voor MaestroListHeader
  const headerCount = audienceCounts[audience] !== null && audienceCounts[audience] !== undefined
    ? audienceCounts[audience]
    : null

  return (
    <div className="theme-maestro mc-maestro-app">
      <MaestroTopbar activeTabLabel={activeTabLabel} />

      <div className="mcm-card">
        <div className="mcm-shell">
          <TabsSidebar
            audience={audience}
            setAudience={setAudience}
            audienceCounts={audienceCounts}
          />

          <div className="mcm-inbox mc-app">
            <MaestroListHeader
              audience={audience}
              pendingTotal={pendingCount}
              audienceCount={headerCount}
            />
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
