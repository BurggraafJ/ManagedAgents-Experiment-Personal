import { useState } from 'react'
import SettingsLayout, { readInitialPage } from './settings/SettingsLayout'
import InstructiesPage       from './settings/InstructiesPage'
import TemplatesPage         from './settings/TemplatesPage'
import TerminologiePage      from './settings/TerminologiePage'
import ApiKeysPage           from './settings/ApiKeysPage'
import ConfiguratiePage      from './settings/ConfiguratiePage'
import EdgeFunctionsPage     from './settings/EdgeFunctionsPage'
import DeploymentsPage       from './settings/DeploymentsPage'

// SettingsView — Claude-style admin: links een vaste nav-pane (gegroepeerd
// in secties), rechts de content van één pagina tegelijk.
//
// Schedules + cadence per agent zitten HIER NIET — die regel je via het
// ⋯-menu op de agent-card op het Dashboard. Zie agent_schedules.

const NAV = [
  {
    id: 'algemeen', label: 'Algemeen',
    items: [
      { id: 'instructies',  label: 'Agent Instructies' },
      { id: 'templates',    label: 'Administratie Instructies' },
      { id: 'terminologie', label: 'Terminologie' },
    ],
  },
  {
    id: 'tokens', label: 'Tokens',
    items: [
      { id: 'api-keys', label: 'API Keys' },
    ],
  },
  {
    id: 'infra', label: 'Infrastructuur',
    items: [
      { id: 'configuratie',   label: 'Configuratie' },
      { id: 'edge-functions', label: 'Edge Functions' },
      { id: 'deployments',    label: 'Deployments' },
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
      {page === 'instructies'   && <InstructiesPage  schedules={data.schedules} agentInstructions={data.agentInstructions} />}
      {page === 'templates'     && <TemplatesPage    templates={data.noteTemplates} />}
      {page === 'terminologie'  && <TerminologiePage rows={data.terminology} />}
      {page === 'api-keys'      && <ApiKeysPage      secretsInventory={data.secretsInventory} skillSecrets={data.skillSecrets} />}
      {page === 'configuratie'  && <ConfiguratiePage />}
      {page === 'edge-functions' && <EdgeFunctionsPage />}
      {page === 'deployments'   && <DeploymentsPage />}
    </SettingsLayout>
  )
}
