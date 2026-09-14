import { MemoryRouter } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/mobile/mobile.css'
import AgendaView from '../../src/components/views/agenda/AgendaView'
import MobileAgenda from '../../src/mobile/screens/MobileAgenda'
import AppShell from '../../src/components/shell/AppShell'
import { VIEWS, NAV_GROUPS } from '../../src/routes/viewRegistry'

// Preview-harnas Agenda (v1.183): desktop-week in de echte AppShell en de
// mobiele dag-grid, beide op de fixture uit mock-hooks.js (vijf gelijktijdige
// events rond 10:00 = de banen-situatie).
const view = new URLSearchParams(location.search).get('view') || 'desktop'
const profile = { display_name: 'Jelle Burggraaf', role: 'owner' }

function Desktop() {
  return (
    <div className="theme-maestro" style={{ height: '100vh' }}>
      <AppShell
        views={VIEWS} groups={NAV_GROUPS} activeView="agenda" onSelect={() => {}}
        title="Agenda" crumb="Operations / Agenda" profile={profile} onLogout={() => {}}
      >
        <AgendaView onNavigate={() => {}} />
      </AppShell>
    </div>
  )
}

function Mobile() {
  return (
    <div className="shell shell--m theme-maestro" style={{ height: '100vh', background: '#f5f4f0' }}>
      <main className="m-main" style={{ display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        <MobileAgenda />
      </main>
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={['/agenda']}>
    {view === 'mobile' ? <Mobile /> : <Desktop />}
  </MemoryRouter>
)
