import { useTheme } from './hooks/useTheme'
import { useSupabaseAuth } from './hooks/useSupabaseAuth'
import { useUserRole } from './hooks/useUserRole'
import { useMfaGate } from './hooks/useMfaGate'
import { useMediaQuery } from './hooks/useMediaQuery'
import { ModalProvider, ModalRoot } from './components/ui/ModalProvider'

import Login      from './components/Login'
import MfaGate    from './components/MfaGate'
import Dashboard  from './components/shell/Dashboard'
// Organisatie (owner-only) leeft sinds v1.172 als overlay binnen Dashboard op
// /organisatie/* — zelfde patroon als Instellingen, geen eigen shell meer.
// Op de telefoon rendert Dashboard het mobiele Organisatie-hub (v1.128, design A).
import './mobile/mobile.css'

// App (v1.128): auth-gate + shell-keuze. De view-registry staat in
// routes/viewRegistry.js, de operationele shell in components/shell/Dashboard.jsx.
export default function App() {
  // Deze hook hoort één keer in de tree te staan (CLAUDE.md pre-flight 4).
  // Login kreeg 'm tot v1.150 zelf ook — dat gaf een tweede
  // onAuthStateChange-subscription en een tweede idle-timer.
  const sbAuth = useSupabaseAuth()
  // useUserRole pas zinvol als signed-in. Voor checking/login geeft de hook
  // role=null terug en dan komen we toch niet in de Dashboard-tak.
  const userRole = useUserRole(sbAuth.user?.id)
  // Tweede factor (e-mail-OTP ná login, security review 2026-09-02). Deze hook
  // hoort maar één keer in de tree te staan — vandaar hier, net als useUserRole.
  const mfaGate = useMfaGate(sbAuth.status === 'signed-in' ? sbAuth.user?.id : null)
  // Theme blijft op App-niveau: Dashboard mount/unmount niet meer per route,
  // maar de hook hoort hier één keer te staan (pre-flight-regel 4) zodat de
  // class op <html> altijd actief blijft.
  const themeCtl = useTheme()
  // Eén media-query voor de hele tree; Dashboard krijgt 'm als prop.
  const isMobile = useMediaQuery('(max-width: 768px)')

  if (sbAuth.status === 'checking') {
    return <div style={{ minHeight: '100vh', background: 'var(--bg)' }} />
  }

  if (sbAuth.isRecovery) {
    return <Login auth={sbAuth} />
  }

  if (sbAuth.status !== 'signed-in') {
    return <Login auth={sbAuth} />
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

  // Eén shell voor alles. Organisatie opende tot v1.171 als aparte AdminShell
  // (eigen sidebar, "← Dashboard", hoofdnavigatie weg); sinds spoor 20 is het
  // een overlay-pane binnen Dashboard, net als Instellingen.
  return (
    <ModalProvider>
      <Dashboard auth={authIface} isOwner={userRole.isOwner} isLoadingRole={userRole.isLoadingRole} theme={themeCtl} isMobile={isMobile} />
      <ModalRoot />
    </ModalProvider>
  )
}
