import MIcon from './MIcon'
import { APP_VERSION } from '../version'
import { useUpdateStatus, reopenUpdatePrompt } from '../lib/updateStatus'

// "Meer"-sheet (v1.126, design A "iOS drill-in") — korte iOS-sheet met
// inset-groepen. Bevat alléén wat niet al in de tabbar zit: de extra modules,
// de groep Beheer (Instellingen · Admin · thema) en de accountkaart.
// Expliciete lijst i.p.v. NAV_GROUPS minus groepen, zodat er nooit tabbar-
// dubbelingen (Administratie/Postvak/Taken) of desktop-only flows (Review-
// queue, Customer Success) in sluipen. Een module verschijnt alleen als hij in
// `nav` zit (adminOnly-filtering blijft dus in Dashboard.jsx).
//
// v1.128 (Admin A): Instellingen en Admin staan als twee gelijkwaardige rijen
// onder Beheer. Admin (owner-only) opent het mobiele owner-portaal /admin met
// hub + drill-in (Gebruikers · Health · Security; JelleMind en de rest zijn
// desktop-only); de badge is het aantal open critical/high security-findings.
const MOBILE_MORE_ITEMS = [
  { id: 'nu',           label: 'Briefing',           icon: 'dashboard' },
  { id: 'agenda',       label: 'Agenda',             icon: 'cal' },
  { id: 'kennisbank',   label: 'Kennisbank',         icon: 'mind' },
  { id: 'long_running', label: 'Long running tasks', icon: 'clock' },
]

function initialsOf(name) {
  return (name || 'Gebruiker').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

export default function MobileMoreDrawer({
  open, onClose, nav = [], activeView, onSelect, isOwner = false,
  profile, onLogout, theme, onToggleTheme, adminBadge = 0,
}) {
  // Update-cue op de versie-regel — hook vóór de early-return (rules of hooks).
  const { waiting: updateWaiting } = useUpdateStatus()

  if (!open) return null

  const byId = Object.fromEntries(nav.map(v => [v.id, v]))
  const modules = MOBILE_MORE_ITEMS.filter(it => byId[it.id])
  const dark = theme !== 'light'

  return (
    <>
      <div className="m-scrim" onClick={onClose} />
      <div className="m-drawer m-more" role="dialog" aria-modal="true" aria-label="Meer">
        <div className="m-drawer__grab" />
        <div className="m-drawer__head">
          <span className="m-drawer__title">Meer</span>
          <button type="button" className="m-drawer__close" onClick={onClose} aria-label="Sluiten">
            <MIcon name="close" size={16} />
          </button>
        </div>

        <div className="m-drawer__list">
          {modules.length > 0 && (
            <>
              <div className="m-grouplbl">Modules</div>
              <div className="m-inset">
                {modules.map(it => {
                  const v = byId[it.id]
                  return (
                    <button
                      key={it.id}
                      type="button"
                      className={`m-inset__row ${activeView === it.id ? 'is-active' : ''}`}
                      onClick={() => onSelect(it.id)}
                    >
                      <span className="m-inset__ico"><MIcon name={it.icon} size={19} /></span>
                      <span className="m-inset__lbl">{it.label}</span>
                      {v.count > 0 && (
                        <span className={`m-navrow__badge ${v.urgent ? 'm-navrow__badge--urgent' : ''}`}>{v.count}</span>
                      )}
                      <span className="m-inset__chev"><MIcon name="chevron" size={16} /></span>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          <div className="m-grouplbl m-grouplbl--gap">Beheer</div>
          <div className="m-inset">
            {byId['settings'] && (
              <button
                type="button"
                className={`m-inset__row ${activeView === 'settings' ? 'is-active' : ''}`}
                onClick={() => onSelect('settings')}
              >
                <span className="m-inset__ico m-inset__ico--ink"><MIcon name="settings" size={19} /></span>
                <span className="m-inset__txt">
                  <span className="m-inset__lbl">Instellingen</span>
                  <span className="m-inset__sub">Agents · Terminologie · Uitleg</span>
                </span>
                <span className="m-inset__chev"><MIcon name="chevron" size={16} /></span>
              </button>
            )}
            {isOwner && (
              <button
                type="button"
                className={`m-inset__row ${activeView === 'admin' ? 'is-active' : ''}`}
                onClick={() => onSelect('admin')}
              >
                <span className="m-inset__ico m-inset__ico--ink"><MIcon name="shield" size={19} /></span>
                <span className="m-inset__txt">
                  <span className="m-inset__lbl">Admin</span>
                  <span className="m-inset__sub">Gebruikers · Health · Security</span>
                </span>
                {adminBadge > 0 && (
                  <span className="m-navrow__badge m-navrow__badge--urgent">{adminBadge}</span>
                )}
                <span className="m-inset__chev"><MIcon name="chevron" size={16} /></span>
              </button>
            )}
            <button
              type="button"
              className="m-inset__row"
              onClick={onToggleTheme}
              role="switch"
              aria-checked={dark}
            >
              <span className="m-inset__ico"><MIcon name="moon" size={19} /></span>
              <span className="m-inset__lbl">Donker thema</span>
              <span className={`m-switch ${dark ? 'is-on' : ''}`} aria-hidden><span className="m-switch__knob" /></span>
            </button>
          </div>

          <div className="m-inset m-inset--gap m-more__user">
            <div className="m-drawer__avatar">{initialsOf(profile?.display_name)}</div>
            <div className="m-drawer__userinfo">
              <div className="m-drawer__username">{profile?.display_name || 'Gebruiker'}</div>
              <div className="m-drawer__userrole">
                {profile?.role || 'member'} ·{' '}
                {updateWaiting ? (
                  <button
                    type="button"
                    className="m-drawer__ver-update"
                    onClick={() => { onClose(); reopenUpdatePrompt() }}
                    aria-label="Update klaar — open herlaad-melding"
                  >
                    <span className="m-drawer__ver-dot" aria-hidden />
                    v{APP_VERSION} · update klaar
                  </button>
                ) : (
                  <>v{APP_VERSION}</>
                )}
              </div>
            </div>
            {onLogout && (
              <button type="button" className="m-drawer__logout" onClick={onLogout}>Uitloggen</button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
