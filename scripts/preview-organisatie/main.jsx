import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/mobile/mobile.css'
import AppShell from '../../src/components/shell/AppShell'
import OrganisatieView from '../../src/components/views/organisatie/OrganisatieView'
import SettingsView from '../../src/components/views/settings/SettingsView'
import MobileAdminPortal from '../../src/mobile/screens/admin/MobileAdminPortal'
import MobileSettings from '../../src/mobile/screens/MobileSettings'
import { VIEWS, NAV_GROUPS } from '../../src/routes/viewRegistry'

// Preview-harnas voor de twee portalen die dezelfde shell delen (SettingsLayout):
// Organisatie en Instellingen.
//
//   ?view=platform&seg=config|edge|database   Organisatie › Platform
//   ?view=pijplijn                            Instellingen › Uitleg › Pijplijn
//   ?view=hub-mobiel                          mobiele Organisatie-hub
//   ?view=instellingen-mobiel                 mobiele Instellingen-hub
//   ?view=pijplijn-mobiel                     mobiele Pijplijn-drill-in
//
// v1.195 (P9): de Pijplijn-scène wijst niet meer naar Organisatie › Leren maar
// naar Instellingen › Uitleg; de losse "stap open"-scène is weg, want de keten
// toont alle zeven uitleggen tegelijk.
const q = new URLSearchParams(location.search)
const view = q.get('view') || 'platform'
const profile = { display_name: 'Jelle Burggraaf', role: 'owner' }

// Headless: ná de eerste render het gevraagde tabblad aanklikken, zodat één
// URL één scène is.
function clickLater(selector) {
  if (!selector) return
  let tries = 0
  const tick = () => {
    const el = document.querySelector(selector)
    if (el) { el.click(); return }
    if (tries++ < 40) setTimeout(tick, 50)
  }
  setTimeout(tick, 80)
}
const seg = q.get('seg')
if (seg) clickLater(`.pf-seg__btn:nth-child(${['config', 'edge', 'database'].indexOf(seg) + 1})`)

function Desktop({ title, children }) {
  return (
    <div className="theme-maestro" style={{ height: '100vh' }}>
      <AppShell views={VIEWS} groups={NAV_GROUPS} activeView="admin" onSelect={() => {}}
        title={title} crumb={null} profile={profile} onLogout={() => {}}>
        <Routes>{children}</Routes>
      </AppShell>
    </div>
  )
}

function MobileShell({ children }) {
  return (
    <div className="shell shell--m theme-maestro" style={{ height: '100vh', background: '#f5f4f0' }}>
      <main className="m-main" style={{ display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        {children}
      </main>
    </div>
  )
}

const settingsRoute = (
  <Route path="/instellingen/*" element={<SettingsView isOwner profile={profile} />} />
)

const scenes = {
  platform: {
    entry: '/organisatie/platform',
    el: <Desktop title="Organisatie">
      <Route path="/organisatie/*" element={<OrganisatieView isOwner isLoadingRole={false} profile={profile} />} />
    </Desktop>,
  },
  pijplijn: {
    entry: '/instellingen/uitleg/pijplijn',
    el: <Desktop title="Instellingen">{settingsRoute}</Desktop>,
  },
  'hub-mobiel': {
    entry: '/organisatie',
    el: <MobileShell><Routes><Route path="/organisatie/*" element={<MobileAdminPortal isOwner isLoadingRole={false} badges={{}} />} /></Routes></MobileShell>,
  },
  'instellingen-mobiel': {
    entry: '/instellingen',
    el: <MobileShell><Routes><Route path="/instellingen/*" element={<MobileSettings isOwner profile={profile} onLogout={() => {}} />} /></Routes></MobileShell>,
  },
  'pijplijn-mobiel': {
    entry: '/instellingen/uitleg/pijplijn',
    el: <MobileShell><Routes><Route path="/instellingen/*" element={<MobileSettings isOwner profile={profile} onLogout={() => {}} />} /></Routes></MobileShell>,
  },
}
const scene = scenes[view] || scenes.platform

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={[scene.entry]}>
    {scene.el}
  </MemoryRouter>
)
