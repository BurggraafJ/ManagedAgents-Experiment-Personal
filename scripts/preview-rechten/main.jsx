import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import AppShell from '../../src/components/shell/AppShell'
import OrganisatieView from '../../src/components/views/organisatie/OrganisatieView'
import { VIEWS, NAV_GROUPS } from '../../src/routes/viewRegistry'

// Preview-harnas Rechten + Usage (v1.191, multi-user Design B).
//
//   ?view=rechten          de matrix, rechten als rijen (de vorm van het artboord)
//   ?view=rechten-gedraaid dezelfde matrix met de assen om
//   ?view=usage            verbruik per persoon
//   ?view=gebruikers       de Gebruikers-lijst, voor de nav-rijen ernaast
//
// De data komt uit mock-supabase.js (fixture) en preview-users/mock-hooks.js
// (dezelfde zeven personen als de Gebruikers-shots). De échte cijfers staan in
// UI-B-USAGE-NOTES.md; dit harnas is voor de layout.
const q = new URLSearchParams(location.search)
const view = q.get('view') || 'rechten'
const profile = { display_name: 'Jelle Burggraaf', role: 'owner' }

// Headless: ná de eerste render één knop indrukken, zodat één URL één scène is.
function clickLater(selector) {
  if (!selector) return
  let tries = 0
  const tick = () => {
    const el = document.querySelector(selector)
    if (el) { el.click(); return }
    if (tries++ < 60) setTimeout(tick, 50)
  }
  setTimeout(tick, 120)
}
if (view === 'rechten-gedraaid') clickLater('.admin-page-head__actions .admin-btn')

const ROUTE = {
  rechten: '/organisatie/rechten',
  'rechten-gedraaid': '/organisatie/rechten',
  usage: '/organisatie/usage',
  gebruikers: '/organisatie/gebruikers',
}

createRoot(document.getElementById('root')).render(
  <MemoryRouter initialEntries={[ROUTE[view] || ROUTE.rechten]}>
    <div className="theme-maestro" style={{ height: '100vh' }}>
      <AppShell
        views={VIEWS} groups={NAV_GROUPS} activeView="admin" onSelect={() => {}}
        title="Organisatie" crumb={null} profile={profile} onLogout={() => {}}
      >
        <Routes>
          <Route path="/organisatie/*" element={<OrganisatieView isOwner isLoadingRole={false} profile={profile} />} />
        </Routes>
      </AppShell>
    </div>
  </MemoryRouter>,
)
