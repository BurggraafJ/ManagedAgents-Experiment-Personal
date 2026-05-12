import { useState, useEffect } from 'react'
import './settings-maestro.css'

// SettingsLayout — Claude-style admin: vaste linker nav-pane (geen icons,
// gegroepeerd in secties) + content-pane rechts met één onderwerp tegelijk.
// Sidebar zit IN de view (niet de globale sidebar) zodat het visueel duidelijk
// is dat je in instellingen bent — geen kleine ⋯-tab in een hoek.
//
// Maestro-design (2026-05-12): wrapper-classes `theme-maestro settings-app`
// activeren de scoped overlay in settings-maestro.css. JSX-structuur en
// data-flow blijven 100% gelijk (CLAUDE.md hard-rule: oude code is leidend).

export default function SettingsLayout({ groups, activePage, onSelectPage, children }) {
  // Persist active page across reloads — fijn als je een token plakt en
  // per ongeluk refresht.
  useEffect(() => {
    if (activePage) {
      try { sessionStorage.setItem('settings:active', activePage) } catch {}
    }
  }, [activePage])

  return (
    <div className="theme-maestro settings-app settings-shell">
      <aside className="settings-nav" aria-label="Instellingen-navigatie">
        {groups.map(group => (
          <div key={group.id} className="settings-nav__group">
            {group.label && (
              <div className="settings-nav__group-label">{group.label}</div>
            )}
            {group.items.map(item => (
              <button
                key={item.id}
                type="button"
                className={`settings-nav__link ${activePage === item.id ? 'is-active' : ''}`}
                onClick={() => onSelectPage(item.id)}
                aria-current={activePage === item.id ? 'page' : undefined}
              >
                <span className="settings-nav__link-label">{item.label}</span>
              </button>
            ))}
          </div>
        ))}
      </aside>

      <div className="settings-content">
        {children}
      </div>
    </div>
  )
}

// Per-page wrapper — geeft elke pagina dezelfde topbar (titel + intro) en
// genereeert ruimte voor sub-secties. Houdt content tegen content-max
// zodat lange tekstvakken comfortabel te lezen blijven.
export function SettingsPage({ title, intro, children, actions }) {
  return (
    <div className="settings-page">
      <header className="settings-page__head">
        <div>
          <h2 className="settings-page__title">{title}</h2>
          {intro && <p className="settings-page__intro">{intro}</p>}
        </div>
        {actions && <div className="settings-page__actions">{actions}</div>}
      </header>
      <div className="settings-page__body">
        {children}
      </div>
    </div>
  )
}

// Section binnen een page — voor sub-groepen met eigen kop. "Profile" /
// "Preferences" stijl in Claude-screenshot.
export function SettingsSection({ title, hint, children }) {
  return (
    <section className="settings-section">
      {(title || hint) && (
        <div className="settings-section__head">
          {title && <h3 className="settings-section__title">{title}</h3>}
          {hint && <p className="settings-section__hint">{hint}</p>}
        </div>
      )}
      <div className="settings-section__body">
        {children}
      </div>
    </section>
  )
}

// Row pattern uit screenshot: label + control op één regel met onderlijn.
// Voor controls die multi-line zijn (textarea, editor) gebruik je `wide`,
// dan gaat label boven en control onder.
export function SettingsRow({ label, hint, children, wide = false }) {
  return (
    <div className={`settings-row ${wide ? 'settings-row--wide' : ''}`}>
      <div className="settings-row__label">
        <div className="settings-row__label-main">{label}</div>
        {hint && <div className="settings-row__label-hint">{hint}</div>}
      </div>
      <div className="settings-row__control">
        {children}
      </div>
    </div>
  )
}

// Init-helper voor de SettingsView om de gewenste page uit sessionStorage
// te lezen, met fallback naar default.
export function readInitialPage(defaultPage) {
  try {
    const v = sessionStorage.getItem('settings:active')
    if (v) return v
  } catch {}
  return defaultPage
}
