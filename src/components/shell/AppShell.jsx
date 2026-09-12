import { useCallback, useEffect, useState } from 'react'
import Sidebar from './Sidebar'
import TopBar from './TopBar'
import { useUpdateStatus, reopenUpdatePrompt } from '../../lib/updateStatus'
import './desktop-shell.css'
import './sidebar-espresso.css'

// AppShell — de desktop-chrome van het hoofddashboard (v1.158).
//
// Eén plek waar de Espresso-sidebar, de vaste topbalk en de content-outlet
// samenkomen, zodat élke desktop-route dezelfde chrome krijgt. Dashboard.jsx
// levert nav-data + routes aan; de mobiele shell (tabbar, Meer-sheet,
// MobileBar) loopt hier niet doorheen en is ongewijzigd.
//
// De AdminShell (/admin/* op desktop) staat hier bewust buiten: die heeft
// z'n eigen chrome sinds v1.129.
export default function AppShell({
  views, groups, activeView, onSelect,
  title, crumb, topActions,
  theme, onToggleTheme,
  profile, onLogout,
  orchestratorAgeMin,
  mainClassName = '',
  // Extra chrome boven de outlet — vandaag de 768–900px chip-bar (MobileBar),
  // die in die band de sidebar vervangt. Boven 900px is hij CSS-verborgen.
  chrome = null,
  children,
}) {
  // Account-popout wordt gedeeld: de voet-knop in de sidebar én de avatar in
  // de topbalk openen dezelfde popout (die in de sidebar-voet blijft staan).
  const [accountOpen, setAccountOpen] = useState(false)
  const { waiting: updateWaiting } = useUpdateStatus()

  const goSearch = useCallback(() => onSelect('vragenbak'), [onSelect])

  // ⌘K / Ctrl-K opent de vragenbak. Het zoekveld in de sidebar toont diezelfde
  // hint, dus die hint moet ook waar zijn.
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        goSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goSearch])

  return (
    <div className="shell dsk-shell">
      <Sidebar
        variant="espresso"
        views={views}
        groups={groups}
        activeView={activeView}
        onSelect={onSelect}
        onSearch={goSearch}
        theme={theme}
        onToggleTheme={onToggleTheme}
        profile={profile}
        onLogout={onLogout}
        menuOpen={accountOpen}
        onMenuOpenChange={setAccountOpen}
      />
      <div className="dsk-body">
        {chrome}
        <TopBar
          title={title}
          crumb={crumb}
          actions={topActions}
          onSearch={goSearch}
          theme={theme}
          onToggleTheme={onToggleTheme}
          orchestratorAgeMin={orchestratorAgeMin}
          updateWaiting={updateWaiting}
          onUpdate={reopenUpdatePrompt}
          profile={profile}
          accountOpen={accountOpen}
          onAccount={() => setAccountOpen(o => !o)}
        />
        <main className={`main ${mainClassName}`}>{children}</main>
      </div>
    </div>
  )
}
