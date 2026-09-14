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
//
// `back` (v1.189, universeel sinds v1.191): vóór de titel staat de weg terug
// naar de ouder van de pagina — `◂ Dashboard` op een top-level pagina,
// `◂ Pipeline` op de kwartaaldiagnose, `◂ Klantverlies` op een dossier. Met de
// naam van de bestemming en niet "Terug". Dit is de énige plek in de desktop-
// chrome waar de terugweg staat: de borden droegen er tot v1.190 zelf ook een
// in hun kop, en twee dezelfde pijlen binnen veertig pixels is geen navigatie
// maar ruis (Jelle, 14-09-2026). Home heeft geen ouder en dus geen pijl; de
// regel die de ouder bepaalt staat in viewRegistry.parentFor.
export default function TopBar({
  title,
  crumb,
  back,
  actions,
  onSearch,
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
      {back && (
        <>
          <button
            type="button"
            className="dsk-top__back"
            onClick={back.onClick}
            title={`Terug naar ${back.label}`}
          >
            <span className="dsk-top__back-pijl" aria-hidden>◂</span>
            {back.label}
          </button>
          <span className="dsk-top__rule" aria-hidden />
        </>
      )}
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
