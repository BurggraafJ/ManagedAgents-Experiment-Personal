import { MemoryRouter } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/mobile/mobile.css'
import MobileHome from '../../src/mobile/screens/MobileHome'
import MobileAgenda from '../../src/mobile/screens/MobileAgenda'
import MobileTabBar from '../../src/mobile/MobileTabBar'
import MobileMoreDrawer from '../../src/mobile/MobileMoreDrawer'
import { VIEWS } from '../../src/routes/viewRegistry'

// Preview-harnas mobiele navigatie (v1.204). Eén onderwerp: de onderbalk en de
// Meer-drawer. De schermen erachter zijn de échte MobileHome en MobileAgenda
// (op de fixtures van de Home- en Agenda-harnassen), zodat de tabbar in zijn
// normale context staat en niet op een lege achtergrond.
//
// Standen:
//   home       tabbar met Home actief — de volgorde Home · Agenda · Postvak ·
//              Taken · Meer
//   agenda     Agenda actief, met het échte agendascherm erachter
//   meer       de Meer-drawer open, met Administratie als eerste module
//
// Waarom een eigen harnas en niet preview-home uitbreiden: die shots voeden de
// D1-metingen (npm run meet) en een extra balk onderin verschuift daar de
// hoogtebudgetten.
const view = new URLSearchParams(location.search).get('view') || 'home'
document.documentElement.classList.add('theme-light')
// Headless screenshots kunnen midden in m-rise (translateY 100%→0) vallen.
const _st = document.createElement('style')
_st.textContent = '.m-drawer,.m-scrim{animation:none!important;transform:none!important}'
document.head.appendChild(_st)

const profile = { display_name: 'Jelle Burggraaf', role: 'owner' }

// De drawer toont een badge uit `nav[].count`. In productie vult Dashboard.jsx
// dat voor 'hubspot' met badges.adminPending — dezelfde teller die vóór v1.204
// op de Admin-tab stond. Hier vast op 3 zodat de shot bewijst dat de badge
// mee verhuist en niet stilletjes wegvalt.
const nav = VIEWS.map(v => (v.id === 'hubspot' ? { ...v, count: 3 } : { ...v, count: 0 }))
const COUNTS = { more: 3, task: 2 }

// Zelfde boom als Dashboard.jsx: main · tabbar · drawer als broers onder
// .shell--m. De drawer hóórt buiten <main> — binnen een scroll-container met
// backdrop-filter valt een position:fixed-element terug op die container.
function Screen({ activeView, children, overlay = null }) {
  return (
    <div className="shell shell--m theme-maestro" style={{ height: '100vh', background: '#f5f4f0' }}>
      <main className="m-main" style={{ display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        {children}
      </main>
      <MobileTabBar activeView={activeView} onSelect={() => {}} onOpenMore={() => {}} counts={COUNTS} />
      {overlay}
    </div>
  )
}

const views = {
  home: (
    <Screen activeView="zoeken"><MobileHome profile={profile} isOwner /></Screen>
  ),
  agenda: (
    <Screen activeView="agenda"><MobileAgenda /></Screen>
  ),
  meer: (
    <Screen
      activeView="hubspot"
      overlay={(
        <MobileMoreDrawer
          open onClose={() => {}} nav={nav} activeView="hubspot" onSelect={() => {}}
          isOwner profile={profile} onLogout={() => {}} adminBadge={2}
        />
      )}
    >
      <MobileHome profile={profile} isOwner />
    </Screen>
  ),
}

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/']}>
    {views[view] || views.home}
  </MemoryRouter>
)
