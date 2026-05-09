import { useMemo } from 'react'
import { useAutoDraft } from '../../../hooks/useAutoDraft'
import { useSupabaseQuery } from '../../../hooks/useSupabaseQuery'
import { AGENT } from '../../../lib/autodraft'
import MailingSettings from './MailingSettings'
import InboxPanel from './inbox/InboxPanel'


// AutoDraftView v6 — Outlook-stijl postvak met sub-pagina-router.
//
// Sidebar-groep "Mailing" (App.jsx) heeft 5 children. Deze view dispatcht op
// `subPage` prop naar de juiste subview:
//   - postvak     → full-width Outlook-stijl: lijst + sticky draft + chain
//   - voorstellen → categorie- + lesson-voorstellen + systeem-instructies
//   - categories  → kleur, default-actie, doelmap, instructies per categorie
//   - logboek     → verwerkte mails + recente runs (debug)
//   - regels      → geleerde regels uit amendments
//
// Verschilpunten t.o.v. v5:
//   - Postvak heeft "al verwerkt"-filter (verplaatst uit Inbox of beantwoord
//     via mail_messages) — verbergt mails waar je in Outlook al actie op deed.
//   - Thread-historie staat altijd open in een Outlook-stijl chain, mijn mails
//     rechts uitgelijnd. Geen click-to-expand meer.
//   - Sticky draft-editor bovenaan met variant-pijltjes.

export default function AutoDraftView({ subPage = 'postvak', onNavigate }) {
  // Refactor 05 — hook-migratie: data-prop weggehaald, view leest direct uit
  // useAutoDraft (Refactor 02) + useSupabaseQuery (Refactor 04). Sub-components
  // krijgen scoped props (geen data-shim) — voorkomt de re-render-cascade die
  // de eerste sessie-1 attempt deed crashen.
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
    lessonProposals: lessonProps,
    categoryProposals: categoryProps,
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

  // Set van conversation_ids die Jelle als 'afgerond' heeft gemarkeerd —
  // worden verborgen uit de awaiting-tab.
  const dismissedConvIds = useMemo(() =>
    new Set((awaitingDismissedRows || []).map(d => d.conversation_id)),
    [awaitingDismissedRows])
  // Set van klant-emails uit HubSpot Customer Base — als afzender of recipient
  // hierin zit, default target_folder = 'Klanten/Customer Succes'.
  const customerEmails = useMemo(() =>
    new Set((customerEmailRows || []).map(c => (c.email || '').toLowerCase())),
    [customerEmailRows])

  // Reminder-stijl uit agent_config (key='reminder_style', agent='auto-draft').
  // Bewerkbaar in Mailing-instellingen. Wordt getoond bij follow-up als hint.
  const reminderStyle = useMemo(() => {
    const cfg = (agentInstructions || []).find(c =>
      c.config_key === 'reminder_style' && c.agent_name === 'auto-draft')
    if (!cfg) return ''
    const v = cfg.config_value
    return typeof v === 'string' ? v : (v?.text || '')
  }, [agentInstructions])

  // Telling per conversation_id voor thread-badges in lijst
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

  if (subPage === 'settings') {
    return (
      <div className="mc-app">
        <MailingSettings
          mails={mails}
          categories={categories}
          categoryProps={categoryProps}
          lessonProps={lessonProps}
          decisions={decisions}
          folders={folders}
          lessons={lessons}
          agentInstructions={agentInstructions}
          recentRuns={recentRuns}
          onNavigate={onNavigate}
        />
      </div>
    )
  }

  // Default: Postvak (full-width Outlook-stijl)
  return (
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
  )
}

