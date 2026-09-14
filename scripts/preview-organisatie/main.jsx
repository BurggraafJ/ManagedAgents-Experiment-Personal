import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/mobile/mobile.css'
import AppShell from '../../src/components/shell/AppShell'
import OrganisatieView from '../../src/components/views/organisatie/OrganisatieView'
import MobileAdminPortal from '../../src/mobile/screens/admin/MobileAdminPortal'
import MobileSettings from '../../src/mobile/screens/MobileSettings'
import { VIEWS, NAV_GROUPS } from '../../src/routes/viewRegistry'

// Preview-harnas Organisatie (v1.183): Platform met de drie tabbladen
// (?view=platform&seg=config|edge|database), Pijplijn met een stap open
// (?view=pijplijn&step=chunk), de mobiele Organisatie-hub en de mobiele
// Instellingen-hub (zonder Donker-thema-rij).
const q = new URLSearchParams(location.search)
const view = q.get('view') || 'platform'
const profile = { display_name: 'Jelle Burggraaf', role: 'owner' }

// Headless: ná de eerste render het gevraagde tabblad / de gevraagde stap
// aanklikken, zodat één URL één scène is.
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
const step = q.get('step')
if (seg) clickLater(`.pf-seg__btn:nth-child(${['config', 'edge', 'database'].indexOf(seg) + 1})`)
if (step) clickLater(`.pl-flow__item:nth-child(${['sync', 'chunk', 'embed', 'index', 'retrieve', 'consume', 'quality'].indexOf(step) + 1}) .pl-step`)

function Desktop({ path }) {
  return (
    <div className="theme-maestro" style={{ height: '100vh' }}>
      <AppShell views={VIEWS} groups={NAV_GROUPS} activeView="admin" onSelect={() => {}}
        title="Organisatie" crumb={null} profile={profile} onLogout={() => {}}>
        <Routes>
          <Route path="/organisatie/*" element={<OrganisatieView isOwner isLoadingRole={false} profile={profile} />} />
        </Routes>
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

const scenes = {
  platform: { entry: '/organisatie/platform', el: <Desktop /> },
  pijplijn: { entry: '/organisatie/pijplijn', el: <Desktop /> },
  'hub-mobiel': {
    entry: '/organisatie',
    el: <MobileShell><Routes><Route path="/organisatie/*" element={<MobileAdminPortal isOwner isLoadingRole={false} badges={{}} />} /></Routes></MobileShell>,
  },
  'instellingen-mobiel': {
    entry: '/instellingen',
    el: <MobileShell><Routes><Route path="/instellingen/*" element={<MobileSettings isOwner profile={profile} onLogout={() => {}} />} /></Routes></MobileShell>,
  },
}
const scene = scenes[view] || scenes.platform

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={[scene.entry]}>
    {scene.el}
  </MemoryRouter>
)
