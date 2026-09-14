import { MemoryRouter } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/mobile/mobile.css'
import '../../src/mobile/mobile-home.css'
import HomeView from '../../src/components/views/home/HomeView'
import MobileHome from '../../src/mobile/screens/MobileHome'
import MobileMoreDrawer from '../../src/mobile/MobileMoreDrawer'
import Sidebar from '../../src/components/shell/Sidebar'
import AppShell from '../../src/components/shell/AppShell'
import { VIEWS, NAV_GROUPS } from '../../src/routes/viewRegistry'

// Preview-harnas Home v1.179: desktop tegels (Confluence D1–D10-set) door de
// échte AppShell (espresso-sidebar + topbalk, zoals prod), mobiele
// stuurkaarten + Soon-inset, losse sidebar-shot, Meer zonder board-modules.
const view = new URLSearchParams(location.search).get('view') || 'desktop'
document.documentElement.classList.add('theme-light')
// Headless screenshots kunnen midden in m-rise (translateY 100%→0) vallen.
const _st = document.createElement('style')
_st.textContent = '.m-drawer,.m-scrim{animation:none!important;transform:none!important}'
document.head.appendChild(_st)

const profile = { display_name: 'Jelle Burggraaf', role: 'owner' }
const nav = VIEWS.filter(v => !v.adminOnly || true) // owner ziet alles in registry; sidebar filtert via groups

function DesktopHome() {
  return (
    <div className="theme-maestro" style={{ height: '100vh' }}>
      <AppShell
        views={nav}
        groups={NAV_GROUPS}
        activeView="home"
        onSelect={() => {}}
        title="Dashboard"
        crumb={null}
        profile={profile}
        onLogout={() => {}}
      >
        <HomeView profile={profile} />
      </AppShell>
    </div>
  )
}

function DesktopSidebar() {
  return (
    <div className="theme-maestro" style={{ height: '100vh', display: 'flex' }}>
      <Sidebar
        views={nav}
        groups={NAV_GROUPS}
        activeView="zoeken"
        onSelect={() => {}}
        profile={profile}
        onLogout={() => {}}
        variant="espresso"
      />
      <div style={{ flex: 1, background: '#f5f4f0' }} />
    </div>
  )
}

function Mobile() {
  return (
    <div className="shell shell--m theme-maestro" style={{ height: '100vh', background: '#f5f4f0' }}>
      <main className="m-main" style={{ display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <MobileHome profile={profile} isOwner />
      </main>
    </div>
  )
}

function MobileMeer() {
  return (
    <div className="shell shell--m theme-maestro" style={{ height: '100vh', background: '#f5f4f0', position: 'relative' }}>
      <MobileMoreDrawer
        open
        onClose={() => {}}
        nav={nav}
        activeView="vragenbak"
        onSelect={() => {}}
        isOwner
        profile={profile}
        onLogout={() => {}}
      />
    </div>
  )
}

const views = {
  desktop: <DesktopHome />,
  sidebar: <DesktopSidebar />,
  mobile: <Mobile />,
  meer: <MobileMeer />,
}

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/']}>
    {views[view] || views.desktop}
  </MemoryRouter>
)
