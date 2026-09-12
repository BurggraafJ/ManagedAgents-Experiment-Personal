import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import '../../src/components/views/admin/admin.css'
import '../../src/mobile/mobile.css'
import '../../src/mobile/mobile-settings.css'
import '../../src/mobile/mobile-admin.css'
import UsersPage from '../../src/components/views/settings/pages/UsersPage'
import MobileAdminUsers from '../../src/mobile/screens/admin/MobileAdminUsers'
import InviteModal from '../../src/components/views/settings/pages/users/InviteModal'
import CreateUserModal from '../../src/components/views/settings/pages/users/CreateUserModal'
import EditUserModal from '../../src/components/views/settings/pages/users/EditUserModal'
import { PREVIEW_USERS, useHubspotOwnerMap } from './mock-hooks'

// Preview-harness voor docs/previews/member-ui-a-rust-*.png. Rendert de ECHTE
// componenten met mock-data (vite.preview.config.js aliast de data-hooks en de
// supabase-client), zodat een preview niet naast de code kan gaan staan.
//
// Draaien:  npm run preview:users   →  scripts/preview-users/capture.sh
const view = new URLSearchParams(location.search).get('view') || 'desktop'
// Overdag draait de app licht (useTheme volgt de klok, 07:00–19:00).
document.documentElement.classList.add('theme-light')

const ownerMap = useHubspotOwnerMap()

function Desktop() {
  return (
    <div className="theme-maestro admin-shell" style={{ gridTemplateColumns: '1fr' }}>
      <main className="admin-main">
        <div className="admin-frame"><UsersPage /></div>
      </main>
    </div>
  )
}

function Mobile({ children }) {
  return (
    <div className="shell shell--m">
      <main className="m-main"><MobileAdminUsers onBack={() => {}} />{children}</main>
    </div>
  )
}

const views = {
  desktop: <Desktop />,
  'mobile-list': <Mobile />,
  'mobile-invite': <Mobile><InviteModal open onClose={() => {}} onCreateFirst={() => {}} /></Mobile>,
  'mobile-create': <Mobile><CreateUserModal open onClose={() => {}} /></Mobile>,
  'mobile-edit': (
    <Mobile>
      <EditUserModal
        open
        user={PREVIEW_USERS[3]}
        currentUserId="owner-1"
        onClose={() => {}}
        ownerMap={ownerMap}
        canEditOwner
      />
    </Mobile>
  ),
}

createRoot(document.getElementById('root')).render(views[view] || views.desktop)
