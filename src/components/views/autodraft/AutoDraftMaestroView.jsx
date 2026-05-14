import { useState, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import { useAutoDraft } from '../../../hooks/useAutoDraft'
import { useSupabaseQuery } from '../../../hooks/useSupabaseQuery'
import {
  AGENT,
  isOutOfOffice,
  isCanceledInvite,
  isClosingMail,
  isInternalRecipient,
  isMailAlreadyHandled,
} from '../../../lib/autodraft'
import InboxPanel from './inbox/InboxPanel'
import MaestroTopbar from './maestro/MaestroTopbar'
import TabsSidebar, { MAESTRO_TABS } from './maestro/TabsSidebar'
import MaestroListHeader from './maestro/MaestroListHeader'
import RagHealthModal from './maestro/RagHealthModal'
import { MaestroContext } from './maestro/MaestroContext'
import './autodraft-maestro.css'

// AutoDraftMaestroView — Postvak Maestro entry-point.
//
// Sessie-stack:
//   - V1 (5dce00f, 2026-05-10): side-by-side route + basis CSS-overlay
//   - V2 (93729bd, 2026-05-10): deep CSS polish over alle kernblokken
//   - V3 (c7fb4ad, 2026-05-10): 264px tabs-sidebar + folder-tree + modal-restyle
//   - V4 (2026-05-10): extract sub-components naar maestro/ + MaestroListHeader
//   - V5-V6.5 (2026-05-10/11): polish-rondes (mail-cards, detail-top, scrollbar)
//   - V7 (deze, 2026-05-12): DOM-structuur 1-op-1 op mockup gelegd —
//     TabsSidebar uit .mcm-card gehaald naar root-grid (264px column);
//     MaestroTopbar uit root verplaatst naar binnen .mcm-main; .mcm-shell laag
//     verwijderd; MaestroFoldersTree gebruikt dezelfde folderTree-bron als
//     V1's MailDetail (folders + categories.default_target_folder).
//
// HARD-RULE: oude code is leidend. Mockup levert alleen nieuwe styling.
// Routes /postvak en /postvak-maestro draaien naast elkaar — oude blijft 100%
// onaangeroerd, nieuwe URL krijgt Maestro shell + scoped CSS-overlay.
//
// Folder-organisatie:
//   views/autodraft/
//   ├── AutoDraftView.jsx           ← oude entry (V1)
//   ├── AutoDraftMaestroView.jsx    ← deze file (Maestro entry, V2)
//   ├── MailingSettings.jsx
//   ├── autodraft.module.css        ← oude CSS-module (hashed classes)
//   ├── autodraft-maestro.css       ← Maestro-overlay (plain CSS, scoped)
//   ├── inbox/                      ← V1 sub-componenten (hergebruikt door V2)
//   ├── modals/                     ← V1 modals (hergebruikt door V2)
//   ├── settings/                   ← V1 settings-blokken
//   └── maestro/                    ← Maestro-only shell-componenten
//       ├── MaestroTopbar.jsx       (crumbs + sync-pill + acties)
//       ├── TabsSidebar.jsx         (264px audience-tabs + folders-toggle)
//       ├── MaestroFoldersTree.jsx  (folders-tree, zelfde data als V1 picker)
//       ├── FolderItem.jsx          (recursive folder-tree entry)
//       ├── MaestroListHeader.jsx   (list-pane titel-strook)
//       ├── AIPromptBar.jsx         (inline AI-rewrite chip+input)
//       └── MaestroContext.js       (provider voor genest-renderende children)

const BUILD_TAG = 'mcm·v8·2026-05-12'

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

  // MCM-V6: actions die via MaestroContext doorgegeven worden naar
  // genest-renderende componenten (zoals AIPromptBar in DraftEditor).
  // submitAmend triggert dezelfde server-side RPC als "Aanpassen"-knop in
  // MailDetail's toolbar — selectedMail komt uit InboxPanel-state, dus
  // we lezen de geselecteerde mail-id via window-event-bridge. Voor V6
  // simpel: we submitAmend op de MEEST-RECENTE pending mail (best-effort).
  // Volledige binding (selectedMail-id propagatie) komt in V7 wanneer we
  // selectedId ook via context lift.
  // V8.9 (2026-05-14): track welke mail nu wordt herschreven door Grok zodat
  // MailRow een "✨ Herschrijven…" badge kan tonen op die row.
  const [pendingRewriteMailId, setPendingRewriteMailId] = useState(null)

  const maestroActions = useMemo(() => ({
    submitAmend: async (prompt) => {
      const target = (mails || []).find(m => m.status === 'pending' || m.status === 'amended')
      if (!target) {
        // eslint-disable-next-line no-console
        console.warn('[MaestroActions] submitAmend: geen pending mail gevonden')
        return
      }
      try {
        const { error } = await supabase.rpc('submit_autodraft_decision', {
          p_mail_id: target.mail_id,
          p_action: 'amend',
          p_amend_text: prompt,
        })
        if (error) {
          console.error('[MaestroActions] submitAmend RPC error:', error)
        }
      } catch (e) {
        console.error('[MaestroActions] submitAmend exception:', e)
      }
    },
    // V8.9 (2026-05-13/14): synchrone schrijfassistent — geen heartbeat-wait.
    // Triggered pendingRewriteMailId zodat MailRow de "✨ Herschrijven…" badge
    // toont tijdens de wacht. Polling van ~60s (60 × 1000ms) op het response-
    // queue-record; bij timeout → fallback naar oude amend-flow.
    rewriteDraftSync: async (prompt) => {
      const target = (mails || []).find(m => m.status === 'pending' || m.status === 'amended')
      if (!target) return { ok: false, reason: 'geen pending mail' }
      setPendingRewriteMailId(target.mail_id)
      try {
        const { data: reqId, error: reqErr } = await supabase.rpc('autodraft_rewrite_request', {
          p_mail_id: target.mail_id,
          p_prompt: prompt,
        })
        if (reqErr) return { ok: false, reason: reqErr.message }
        // 60 polls × 1000ms = 60s max. Grok-4-0709 met thread-context kan
        // tot ~45s nemen; 60s geeft een buffer. Bij timeout: clean fallback.
        for (let i = 0; i < 60; i++) {
          await new Promise(r => setTimeout(r, 1000))
          const { data: poll, error: pollErr } = await supabase.rpc('autodraft_rewrite_poll', { p_request_id: reqId })
          if (pollErr) return { ok: false, reason: pollErr.message }
          if (poll?.status === 'done') {
            const body = poll.body
            if (poll.status_code >= 200 && poll.status_code < 300 && body?.ok) {
              return { ok: true, draft_subject: body.draft_subject, draft_body: body.draft_body, model: body.model, durationMs: body.duration_ms }
            }
            return { ok: false, reason: body?.error || body?.reason || `http_${poll.status_code}` }
          }
        }
        return { ok: false, reason: 'timeout (>60s) — Grok antwoordde niet op tijd' }
      } catch (e) {
        return { ok: false, reason: String(e.message || e) }
      } finally {
        setPendingRewriteMailId(null)
      }
    },
    // V8.9 (2026-05-13): drag-and-drop van MailRow naar FolderItem.
    // Submit action='ignore' + p_target_folder zodat daily-admin-execute
    // de mail in Outlook naar die map verplaatst — = "afgehandeld" voor Jelle.
    dropMailToFolder: async (mailId, folderId, folderLabel) => {
      if (!mailId || !folderId) return { ok: false, reason: 'missing-id' }
      try {
        const { data, error } = await supabase.rpc('submit_autodraft_decision', {
          p_mail_id: mailId,
          p_action: 'ignore',
          p_target_folder: folderId,
          p_decision_kind: 'move-via-drag',
        })
        if (error) {
          console.error('[MaestroActions] dropMailToFolder RPC error:', error)
          return { ok: false, reason: error.message }
        }
        if (data && data.ok === false) {
          return { ok: false, reason: data.reason || 'rejected' }
        }
        return { ok: true, folderLabel: folderLabel || null }
      } catch (e) {
        console.error('[MaestroActions] dropMailToFolder exception:', e)
        return { ok: false, reason: String(e.message || e) }
      }
    },
  }), [mails])

  const maestroContextValue = useMemo(() => ({
    enabled: true,
    actions: maestroActions,
    pendingRewriteMailId,
  }), [maestroActions, pendingRewriteMailId])

  // MCM-V3+: audience state hier opgehoest om aan tabs-sidebar te koppelen.
  // InboxPanel valt terug op interne state als audience-prop niet meegegeven
  // wordt (oude /postvak route). Hier passeren we het wel → controlled-mode.
  const [audience, setAudience] = useState('for_you')
  // V6.2 (2026-05-11): zelfde controlled-pattern voor query zodat de search
  // in TabsSidebar daadwerkelijk de mail-list filtert.
  const [searchQuery, setSearchQuery] = useState('')
  // V8.5 (2026-05-13): RAG-coverage in een aparte modal (was V8.4 inline
  // toggle). 3-dots → "RAG-gegevens" → opent RagHealthModal full-mode.
  const [ragHealthOpen, setRagHealthOpen] = useState(false)
  // V8.6 (2026-05-13): TabsSidebar collapse toggle. Default open; voorkeur
  // bewaard in localStorage 'mcm-tabs-collapsed' zodat de volgende sessie
  // dezelfde state heeft.
  const [tabsCollapsed, setTabsCollapsed] = useState(() => {
    try { return localStorage.getItem('mcm-tabs-collapsed') === '1' }
    catch { return false }
  })
  function toggleTabsCollapsed() {
    setTabsCollapsed(v => {
      const next = !v
      try { localStorage.setItem('mcm-tabs-collapsed', next ? '1' : '0') } catch {}
      return next
    })
  }

  // V8.2 (2026-05-13): volledige audience-counts met awaiting + priority +
  // sent_drafts erbij. Voorheen alleen for_you/not_for_you — TabsSidebar
  // miste counters op de andere tabs (Jelle feedback ronde 7).
  //
  // Logica gespiegeld uit InboxPanel:
  //   - for_you / not_for_you: mail.audience uit autodraft_mails (pending only)
  //   - priority: pending mails waar mail_messages.flag_status='flagged'
  //   - awaiting: from-me mails in mail_messages zonder reply 1-30d
  //   - sent_drafts: mail_messages in folder 'Drafts'
  const audienceCounts = useMemo(() => {
    const out = { for_you: 0, priority: 0, awaiting: 0, not_for_you: 0, sent_drafts: 0, logs: null }

    // for_you / not_for_you
    for (const m of (mails || [])) {
      if (m.status !== 'pending' && m.status !== 'amended') continue
      if (m.audience === 'for_you')     out.for_you++
      if (m.audience === 'not_for_you') out.not_for_you++
    }

    // priority — pending mails met flag_status='flagged' in mail_messages.
    // Match via mail_id (autodraft_mails.mail_id = mail_messages.id).
    const flaggedMsgIds = new Set()
    for (const x of (mailMessages || [])) {
      if (x?.flag_status === 'flagged' && x.id) flaggedMsgIds.add(x.id)
    }
    for (const m of (mails || [])) {
      if (m.status !== 'pending' && m.status !== 'amended') continue
      if (flaggedMsgIds.has(m.mail_id)) out.priority++
    }

    // awaiting — gespiegelde logica uit InboxPanel.awaitingMails.
    // Mine mail + geen reply 1-30d + niet intern + niet OOO/cancellation/closing.
    if (mailMessages && mailMessages.length > 0) {
      const byConv = new Map()
      for (const x of mailMessages) {
        if (!x?.conversation_id) continue
        const slot = byConv.get(x.conversation_id) || { mine: null, reply: null }
        if (x.is_from_me) {
          if (!slot.mine || new Date(x.received_at) > new Date(slot.mine.received_at)) slot.mine = x
        } else {
          if (isOutOfOffice(x)) continue
          if (!slot.reply || new Date(x.received_at) > new Date(slot.reply.received_at)) slot.reply = x
        }
        byConv.set(x.conversation_id, slot)
      }
      const now = Date.now()
      for (const { mine, reply } of byConv.values()) {
        if (!mine) continue
        if (mine.is_calendar_invite) continue
        if (isCanceledInvite(mine)) continue
        if (isClosingMail(mine)) continue
        if (isInternalRecipient(mine.to_recipients)) continue
        if (dismissedConvIds.has(mine.conversation_id)) continue
        if (reply && new Date(reply.received_at) >= new Date(mine.received_at)) continue
        const ageDays = (now - new Date(mine.received_at).getTime()) / (1000 * 60 * 60 * 24)
        if (ageDays < 1 || ageDays > 30) continue
        out.awaiting++
      }
    }

    // sent_drafts — mail_messages in folder Drafts (case-insensitive contains).
    for (const x of (mailMessages || [])) {
      const folder = (x?.folder_path || x?.folder || '').toString().toLowerCase()
      if (folder.includes('draft')) out.sent_drafts++
    }

    return out
  }, [mails, mailMessages, dismissedConvIds])
  // isMailAlreadyHandled is geïmporteerd voor toekomstig gebruik bij refinement
  // van priority-tellingen (al-verwerkt-detectie). Eslint-suppression
  // voorkomt unused-import warning.
  // eslint-disable-next-line no-unused-vars
  const _isMailAlreadyHandled = isMailAlreadyHandled

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

  // MCM-V8 (2026-05-12): root-grid 52px + 1fr rij × 264px + 1fr kolom.
  // MaestroTopbar spant nu ALLE kolommen (volle breedte boven TabsSidebar +
  // card). Reden: Jelle feedback ronde 5 — "linkerpanel moet aansluiten op
  // topbar". V7 had topbar BINNEN .mcm-main (alleen kolom 2), waardoor de
  // TabsSidebar links optisch te ver omhoog kwam (tot tegen scherm-top,
  // naast de "Postvak / Voor jou" crumb-rij).
  //
  // Structuur:
  //   .theme-maestro.mc-maestro-app  (grid: 264px+1fr × 52px+1fr)
  //     ├── MaestroTopbar  (grid-column: 1 / 3, grid-row: 1)  ← volle breedte
  //     ├── TabsSidebar    (grid-column: 1, grid-row: 2)      ← onder topbar
  //     └── main.mcm-main  (grid-column: 2, grid-row: 2)
  //           └── .mcm-card  (flex:1, list + detail)
  return (
    <MaestroContext.Provider value={maestroContextValue}>
    <div className={`theme-maestro mc-maestro-app ${tabsCollapsed ? 'mcm-tabs-collapsed' : ''}`}>
      <MaestroTopbar
        activeTabLabel={activeTabLabel}
        latestScanRun={latestScanRun}
        audience={audience}
        setAudience={setAudience}
        audienceCounts={audienceCounts}
        tabsCollapsed={tabsCollapsed}
        onToggleTabs={toggleTabsCollapsed}
        decisions={decisions}
        mails={mails}
        folders={folders}
      />

      {!tabsCollapsed && (
        <TabsSidebar
          audience={audience}
          setAudience={setAudience}
          audienceCounts={audienceCounts}
          folders={folders}
          categories={categories}
          query={searchQuery}
          setQuery={setSearchQuery}
        />
      )}

      <main className="mcm-main">
        <div className="mcm-card mc-app">
          <MaestroListHeader
            audience={audience}
            pendingTotal={pendingCount}
            audienceCount={headerCount}
            onOpenRagHealth={() => setRagHealthOpen(true)}
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
            query={searchQuery}
            setQuery={setSearchQuery}
            showRagHealth={false}
          />
          <RagHealthModal
            open={ragHealthOpen}
            onClose={() => setRagHealthOpen(false)}
          />
        </div>
      </main>
    </div>
    </MaestroContext.Provider>
  )
}
