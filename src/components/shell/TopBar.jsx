import { UI_ICONS } from './SidebarIcons'
import OrchestratorPill from './OrchestratorPill'

// TopBar — de vaste, rustige topbalk van de desktop-shell (v1.158, locked
// design "Inkt-layout / A-topbalk").
//
// Regels uit de design-lock:
//  • op élke desktop-pagina dezelfde balk;
//  • links de paginatitel + broodkruimel, dus de pagina zelf herhaalt de
//    titel niet;
//  • rechts alleen stille icoon-acties — géén gekleurde CTA in de balk.
//
// De per-view acties die vroeger in `view__header` zaten (Instructies,
// periode-toggle, …) komen hier binnen als `actions` en blijven dus bestaan;
// ze zijn alleen verplaatst, niet verwijderd.
export default function TopBar({
  title,
  crumb,
  actions,
  onSearch,
  theme,
  onToggleTheme,
  orchestratorAgeMin,
  updateWaiting,
  onUpdate,
  profile,
  accountOpen,
  onAccount,
}) {
  const initials = getInitials(profile?.display_name)
  return (
    <header className="dsk-top">
      <h1 className="dsk-top__title">{title}</h1>
      {crumb && <span className="dsk-top__crumb">{crumb}</span>}
      <span className="dsk-top__spacer" />

      {actions && <div className="dsk-top__actions">{actions}</div>}

      <button
        type="button"
        className="dsk-top__ghost"
        onClick={onSearch}
        title="Zoeken (⌘K)"
        aria-label="Zoeken"
      >
        {UI_ICONS.search}
      </button>

      {updateWaiting && (
        <button
          type="button"
          className="dsk-top__ghost"
          onClick={onUpdate}
          title="Nieuwe versie klaar — klik om te herladen"
          aria-label="Nieuwe versie klaar"
        >
          {UI_ICONS.bell}
          <span className="dsk-top__dot" aria-hidden />
        </button>
      )}

      <OrchestratorPill ageMin={orchestratorAgeMin} />

      <button
        type="button"
        className="dsk-top__ghost"
        onClick={onToggleTheme}
        title={theme === 'light' ? 'Donker thema' : 'Licht thema'}
        aria-label={theme === 'light' ? 'Donker thema' : 'Licht thema'}
      >
        {theme === 'light' ? UI_ICONS.moon : UI_ICONS.sun}
      </button>

      <span className="dsk-top__rule" aria-hidden />

      <button
        type="button"
        className={`dsk-top__avatar ${accountOpen ? 'is-open' : ''}`}
        onClick={onAccount}
        data-account-trigger
        title={profile?.display_name || 'Account'}
        aria-label={`Accountmenu voor ${profile?.display_name || 'account'}`}
        aria-expanded={!!accountOpen}
        aria-haspopup="menu"
      >
        {initials}
      </button>
    </header>
  )
}

function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
