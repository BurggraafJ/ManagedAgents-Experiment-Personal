import { useLocation } from 'react-router-dom'
import { useTheme } from './hooks/useTheme'
import { useSupabaseAuth } from './hooks/useSupabaseAuth'
import { useUserRole } from './hooks/useUserRole'
import { useMfaGate } from './hooks/useMfaGate'
import { useMediaQuery } from './hooks/useMediaQuery'
import { ModalProvider, ModalRoot } from './components/ui/ModalProvider'
import { isAdminPathname } from './routes/viewRegistry'

import Login      from './components/Login'
import MfaGate    from './components/MfaGate'
import Dashboard  from './components/shell/Dashboard'
// Organisatie-views, owner-only (Intelligence, JelleMind, Legal AI, Health, Security,
// Gebruikers, Infrastructuur) leven binnen de AdminShell op /admin/* — desktop.
// Op de telefoon rendert Dashboard het mobiele Organisatie-hub (v1.128, design A).
import AdminShell from './components/views/admin/AdminShell'
import './mobile/mobile.css'

// App (v1.128): auth-gate + shell-keuze. De view-registry staat in
// routes/viewRegistry.js, de operationele shell in components/shell/Dashboard.jsx.
export default function App() {
  const sbAuth = useSupabaseAuth()
  // useUserRole pas zinvol als signed-in. Voor checking/login geeft de hook
  // role=null terug en dan komen we toch niet in de Dashboard-tak.
  const userRole = useUserRole(sbAuth.user?.id)
  // Tweede factor (e-mail-OTP ná login, security review 2026-09-02). Deze hook
  // hoort maar één keer in de tree te staan — vandaar hier, net als useUserRole.
  const mfaGate = useMfaGate(sbAuth.status === 'signed-in' ? sbAuth.user?.id : null)
  const location = useLocation()
  // Theme moet op App-niveau leven — Dashboard en AdminShell mounten/unmounten
  // bij elke /admin-switch en daarmee zou Dashboard's useTheme z'n DOM-effect
  // verliezen (zichtbaar als 'soms terug naar dark'). Hier blijft de class
  // op <html> altijd actief.
  const themeCtl = useTheme()
  // Eén media-query voor de hele tree; Dashboard krijgt 'm als prop.
  const isMobile = useMediaQuery('(max-width: 768px)')

  if (sbAuth.status === 'checking') {
    return <div style={{ minHeight: '100vh', background: 'var(--bg)' }} />
  }

  if (sbAuth.isRecovery) {
    return <Login />
  }

  if (sbAuth.status !== 'signed-in') {
    return <Login />
  }

  // Ingelogd, maar de sessie heeft de verificatiecode nog niet gehaald. De
  // datalaag geeft dan toch al niets terug (is_admin_or_higher → session_mfa_ok),
  // dus dit scherm voorkomt vooral een leeg dashboard zonder uitleg.
  if (mfaGate.state === 'checking') {
    return <div style={{ minHeight: '100vh', background: 'var(--bg)' }} />
  }
  if (mfaGate.state === 'needs-otp') {
    return (
      <MfaGate
        email={sbAuth.user?.email}
        gate={mfaGate}
        onSignOut={sbAuth.signOut}
      />
    )
  }

  const authIface = {
    profile: {
      display_name: sbAuth.user?.user_metadata?.full_name ||
                    sbAuth.user?.email?.split('@')[0] ||
                    'Gebruiker',
      name: sbAuth.user?.email || 'gebruiker',
      role: userRole.role,
    },
    logout: sbAuth.signOut,
  }

  // /admin/* op desktop → AdminShell met eigen sidebar, losgekoppeld van het
  // hoofd-Dashboard (bereikbaar via het profile-menu, owner-only). Op de
  // telefoon blijft de Dashboard-shell staan (tabbar + Meer) en rendert die
  // het Organisatie-hub met drill-in — nooit de geplette two-pane (v1.128).
  const useAdminShell = isAdminPathname(location.pathname) && !isMobile

  return (
    <ModalProvider>
      {useAdminShell ? (
        <AdminShell auth={authIface} isOwner={userRole.isOwner} isLoadingRole={userRole.isLoadingRole} theme={themeCtl} />
      ) : (
        <Dashboard auth={authIface} isOwner={userRole.isOwner} isLoadingRole={userRole.isLoadingRole} theme={themeCtl} isMobile={isMobile} />
      )}
      <ModalRoot />
    </ModalProvider>
  )
}
