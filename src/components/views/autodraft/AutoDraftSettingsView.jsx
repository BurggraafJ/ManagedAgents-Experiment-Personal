import { useMemo } from 'react'
import { useAutoDraft } from '../../../hooks/useAutoDraft'
import { useSupabaseQuery } from '../../../hooks/useSupabaseQuery'
import { AGENT } from '../../../lib/autodraft'
import MailingSettings from './MailingSettings'

// AutoDraftSettingsView — instellingen-pagina voor het postvak.
//
// Hosted op /postvak/instellingen. Voorheen was dit de subPage='settings' tak
// van AutoDraftView; sinds 2026-05-14 (de Maestro-view is definitief geworden)
// staat de settings-flow als eigen view zodat AutoDraftView puur de postvak-
// shell is.
//
// Renders het MailingSettings-blok dat tabs heeft voor: voorstellen, categorieën,
// logboek, regels, systeem-instructies. Data komt via useAutoDraft + agent_runs.

export default function AutoDraftSettingsView({ onNavigate }) {
  const {
    mails,
    decisions,
    folders,
    lessons,
    agentInstructions,
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
