import { useState } from 'react'
import SettingsLayout, { readInitialPage } from './settings/SettingsLayout'
import InstructiesPage       from './settings/InstructiesPage'
import TemplatesPage         from './settings/TemplatesPage'
import TerminologiePage      from './settings/TerminologiePage'
import ApiKeysPage           from './settings/ApiKeysPage'
import SkillCredentialsPage  from './settings/SkillCredentialsPage'
import ConfiguratiePage      from './settings/ConfiguratiePage'
import EdgeFunctionsPage     from './settings/EdgeFunctionsPage'
import DeploymentsPage       from './settings/DeploymentsPage'

// SettingsView — Claude-style admin: links een vaste nav-pane (gegroepeerd
// in secties), rechts de content van één pagina tegelijk. Vervangt het oude
// 3-tab model (Instructies/Systeem/Infra) met te volle pagina's.
//
// Schedules + cadence per agent zitten HIER NIET — die regel je via het
// ⋯-menu op de agent-card op het Dashboard. Zie agent_schedules.

const NAV = [
  {
    id: 'algemeen', label: 'Algemeen',
    items: [
      { id: 'instructies',  label: 'Instructies',  hint: 'System messages per agent' },
      { id: 'templates',    label: 'Templates',    hint: 'Notitie-templates per context' },
      { id: 'terminologie', label: 'Terminologie', hint: 'Voice-naar-tekst correcties' },
    ],
  },
  {
    id: 'tokens', label: 'Tokens & secrets',
    items: [
      { id: 'api-keys',         label: 'API Keys',         hint: 'Externe service-keys + rotation' },
      { id: 'skill-credentials', label: 'Skill Credentials', hint: 'Per-skill tokens in Vault' },
    ],
  },
  {
    id: 'infra', label: 'Infrastructuur',
    items: [
      { id: 'configuratie',  label: 'Configuratie',  hint: 'Project-info en runtime' },
      { id: 'edge-functions', label: 'Edge Functions', hint: 'Run-status per functie' },
      { id: 'deployments',   label: 'Deployments',   hint: 'Vercel deploy-controles' },
    ],
  },
]

const DEFAULT_PAGE = 'instructies'

export default function SettingsView({ data }) {
  const [page, setPage] = useState(() => readInitialPage(DEFAULT_PAGE))

  return (
    <SettingsLayout
      groups={NAV}
      activePage={page}
      onSelectPage={setPage}
    >
      {page === 'instructies'  && <InstructiesPage  schedules={data.schedules} agentInstructions={data.agentInstructions} />}
      {page === 'templates'    && <TemplatesPage    templates={data.noteTemplates} />}
      {page === 'terminologie' && <TerminologiePage rows={data.terminology} />}
      {page === 'api-keys'         && <ApiKeysPage         secretsInventory={data.secretsInventory} />}
      {page === 'skill-credentials' && <SkillCredentialsPage skillSecrets={data.skillSecrets} secretsInventory={data.secretsInventory} />}
      {page === 'configuratie'  && <ConfiguratiePage />}
      {page === 'edge-functions' && <EdgeFunctionsPage />}
      {page === 'deployments'   && <DeploymentsPage />}
    </SettingsLayout>
  )
}
