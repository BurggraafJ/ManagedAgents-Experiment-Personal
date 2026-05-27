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
  inferOutgoingLabel,
  buildAwaitingReplyIndex,
  awaitingHasReply,
} from '../../../lib/autodraft'
import InboxPanel from './inbox/InboxPanel'
import MaestroTopbar from './maestro/MaestroTopbar'
import TabsSidebar, { MAESTRO_TABS } from './maestro/TabsSidebar'
import RagHealthModal from './maestro/RagHealthModal'
import { MaestroContext } from './maestro/MaestroContext'
import './autodraft-maestro.css'

// AutoDraftView — Postvak.
//
// Single definitieve view sinds 2026-05-14. Het pad /postvak rendert deze.
// Voor de oudere implementatie ('plain'-stijl, één-kolom met direct in-line
// thread + variant-pijltjes) zie de git-historie tot commit 2284458 — Jelle
// heeft de Maestro-shell goedgekeurd als de enige variant, dus de v1-render
// is verwijderd op 2026-05-14.
//
// Layout (root grid):
//   .theme-maestro.mc-maestro-app  (grid: 264px+1fr × 52px+1fr)
//     ├── MaestroTopbar  (grid-column: 1 / 3, grid-row: 1)  ← volle breedte
//     ├── TabsSidebar    (grid-column: 1, grid-row: 2)      ← onder topbar
//     └── main.mcm-main  (grid-column: 2, grid-row: 2)
//           └── .mcm-card  (flex:1, list + detail)
//
// Folder-organisatie:
//   views/autodraft/
//   ├── AutoDraftView.jsx           ← deze file (definitieve Postvak-shell)
//   ├── AutoDraftSettingsView.jsx   ← /postvak/instellingen-route
//   ├── MailingSettings.jsx         ← tabs-component voor instellingen
//   ├── autodraft.module.css        ← oude module (legacy hashed classes)
//   ├── autodraft-maestro.css       ← scoped CSS-overlay (plain CSS)
//   ├── inbox/                      ← mail-list + detail + draft + chain
//   ├── modals/                     ← preference / improver / spelcheck
//   ├── settings/                   ← settings-tabs
//   └── maestro/                    ← shell-componenten (topbar, sidebar,
//                                      sync-queue, mentions, folder-tree)

export default function AutoDraftView({ onNavigate }) {
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
    awaitingReplyIndex: awaitingReplyRows,
    manualCategoryOverrides: manualCatRows,
    categories: rawCategories,
    loading: autoDraftLoading,
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
  // 2026-05-27 — persisted handmatige categorie per mail_id (mail_messages.id).
  const manualCatMap = useMemo(() => {
    const m = new Map()
    for (const r of (manualCatRows || [])) if (r?.mail_id) m.set(r.mail_id, r.category_key || '')
    return m
  }, [manualCatRows])

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

  // Maestro-actions die genest-renderende componenten kunnen aanroepen via
  // context (DraftEditor → AIPromptBar, MailRow → drop-target, etc.).
  const [pendingRewriteMailId, setPendingRewriteMailId] = useState(null)

  const maestroActions = useMemo(() => ({
    // submitAmend — heartbeat-gebaseerde fallback. Schrijft een queued_amend
    // decision; auto-draft heartbeat pakt op binnen enkele minuten. Wordt
    // door AIPromptBar gebruikt als rewriteDraftSync mislukt.
    submitAmend: async (prompt) => {
      const target = (mails || []).find(m => m.status === 'pending' || m.status === 'amended')
      if (!target) {
        console.warn('[AutoDraftView] submitAmend: geen pending mail gevonden')
        return
      }
      try {
        const { error } = await supabase.rpc('submit_autodraft_decision', {
          p_mail_id: target.mail_id,
          p_action: 'amend',
          p_amend_text: prompt,
        })
        if (error) console.error('[AutoDraftView] submitAmend RPC error:', error)
      } catch (e) {
        console.error('[AutoDraftView] submitAmend exception:', e)
      }
    },
    // rewriteDraftSync — synchrone Grok-rewrite via proxy-RPCs
    // (autodraft_rewrite_request + _poll). Polled max 60s. Toont tijdens
    // het wachten een "✨ Herschrijven…" badge op de juiste MailRow via
    // pendingRewriteMailId state.
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
    // dropMailToFolder — drag-and-drop endpoint. MailRow drop op FolderItem
    // submit een ignore-decision met target_folder = die map. daily-admin-
    // execute pakt op binnen 15 min (Outlook-move).
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
          console.error('[AutoDraftView] dropMailToFolder RPC error:', error)
          return { ok: false, reason: error.message }
        }
        if (data && data.ok === false) return { ok: false, reason: data.reason || 'rejected' }
        return { ok: true, folderLabel: folderLabel || null }
      } catch (e) {
        console.error('[AutoDraftView] dropMailToFolder exception:', e)
        return { ok: false, reason: String(e.message || e) }
      }
    },
  }), [mails])

  const maestroContextValue = useMemo(() => ({
    enabled: true,
    actions: maestroActions,
    pendingRewriteMailId,
  }), [maestroActions, pendingRewriteMailId])

  // Audience-state — bestuurt welke tab actief is in TabsSidebar (Voor jou /
  // Star / In afwachting / Niet voor jou / Concepten / Logs). InboxPanel
  // valt nog terug op interne state als deze props niet komen — dat pad is
  // niet meer in gebruik sinds /postvak naar deze view wijst.
  const [audience, setAudience] = useState('for_you')
  const [searchQuery, setSearchQuery] = useState('')
  const [ragHealthOpen, setRagHealthOpen] = useState(false)

  // TabsSidebar collapse-toggle — voorkeur in localStorage.
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

  // Audience-counts gespiegeld uit InboxPanel-logica zodat de TabsSidebar
  // tellers per tab kan tonen zonder InboxPanel zelf te raadplegen.
  const audienceCounts = useMemo(() => {
    const out = { for_you: 0, priority: 0, awaiting: 0, awaiting_klant: 0, awaiting_algemeen: 0, not_for_you: 0, sent_drafts: 0, logs: null }
    for (const m of (mails || [])) {
      if (m.status !== 'pending' && m.status !== 'amended') continue
      if (m.audience === 'for_you')     out.for_you++
      if (m.audience === 'not_for_you') out.not_for_you++
    }
    const flaggedMsgIds = new Set()
    for (const x of (mailMessages || [])) {
      if (x?.flag_status === 'flagged' && x.id) flaggedMsgIds.add(x.id)
    }
    for (const m of (mails || [])) {
      if (m.status !== 'pending' && m.status !== 'amended') continue
      if (flaggedMsgIds.has(m.mail_id)) out.priority++
    }
    if (mailMessages && mailMessages.length > 0) {
      const replyIndex = buildAwaitingReplyIndex(awaitingReplyRows)
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
        if ((reply && new Date(reply.received_at) >= new Date(mine.received_at)) || awaitingHasReply(mine, replyIndex)) continue
        const ageDays = (now - new Date(mine.received_at).getTime()) / (1000 * 60 * 60 * 24)
        if (ageDays < 1 || ageDays > 30) continue
        out.awaiting++
        // 2026-05-27 — splits awaiting naar klant/algemeen. Categorie leidend
        // (klant_* -> klant), anders afzender-in-HubSpot als fallback. Zelfde
        // regel als InboxPanel.awaitingBucketOf zodat tellers + lijst matchen.
        const awCat = (manualCatMap.get(mine.id) ?? inferOutgoingLabel(mine.to_recipients, mails)) || ''
        let awKlant
        if (awCat.startsWith('klant_')) awKlant = true
        else if (awCat) awKlant = false
        else {
          const toArr = Array.isArray(mine.to_recipients)
            ? mine.to_recipients
            : (mine.to_recipients ? [mine.to_recipients] : [])
          awKlant = false
          for (const x of toArr) {
            const e = typeof x === 'string' ? x : (x?.email || x?.address || '')
            if (e && customerEmails.has(e.toLowerCase())) { awKlant = true; break }
          }
        }
        if (awKlant) out.awaiting_klant++
        else out.awaiting_algemeen++
      }
    }
    for (const x of (mailMessages || [])) {
      const folder = (x?.folder_path || x?.folder || '').toString().toLowerCase()
      if (folder.includes('draft')) out.sent_drafts++
    }
    return out
  }, [mails, mailMessages, dismissedConvIds, customerEmails, awaitingReplyRows, manualCatMap])

  // eslint-disable-next-line no-unused-vars
  const _isMailAlreadyHandled = isMailAlreadyHandled

  const pendingCount = useMemo(() =>
    (mails || []).filter(m => m.status === 'pending' || m.status === 'amended').length,
    [mails])

  const activeTabLabel = useMemo(() =>
    MAESTRO_TABS.find(t => t.id === audience)?.label || 'Voor jou',
    [audience])

  const headerCount = audienceCounts[audience] !== null && audienceCounts[audience] !== undefined
    ? audienceCounts[audience]
    : null

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
        onOpenRagHealth={() => setRagHealthOpen(true)}
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
          {/* V12 (2026-05-21): MaestroListHeader verwijderd. Jelle: 'die DIV
              mag weg want dat is veel ruimte en eigenlijk alleen maar ruis'.
              Count is zichtbaar in TabsSidebar per audience-tab. 3-dots menu
              verhuisd naar MaestroTopbar (hoogste navigatiebalk). */}
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
            awaitingReplyIndex={awaitingReplyRows}
            manualCategoryOverrides={manualCatMap}
            reminderStyle={reminderStyle}
            threadCounts={threadCounts}
            latestScanRun={latestScanRun}
            onNavigate={onNavigate}
            audience={audience}
            setAudience={setAudience}
            query={searchQuery}
            setQuery={setSearchQuery}
            showRagHealth={false}
            loading={autoDraftLoading}
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
