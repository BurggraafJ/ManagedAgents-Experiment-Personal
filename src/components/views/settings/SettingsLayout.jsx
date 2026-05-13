import './settings.css'

/**
 * SettingsLayout — shell + nav-pane + content-pane.
 *
 * Maestro-design met eigen `.set-*` class-prefix en lokale tokens binnen
 * `.set-app` (geen :root pollutie, geen .theme-maestro afhankelijkheid).
 *
 * Props:
 *   groups       — array van { id, label, items: [{ id, label, icon, meta, metaTone }] }
 *   activePage   — id van actieve pagina
 *   onSelectPage — (id) => void
 *   children     — content van de actieve page
 */
export default function SettingsLayout({ groups, activePage, onSelectPage, children }) {
  return (
    <div className="set-app">
      <aside className="set-nav" aria-label="Instellingen-navigatie">
        <div className="set-nav__title">Instellingen</div>

        {groups.map(group => (
          <div key={group.id} className="set-nav__group">
            <div className="set-nav__group-label">{group.label}</div>
            {group.items.map(item => {
              const isActive = activePage === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`set-nav__item ${isActive ? 'is-active' : ''}`}
                  onClick={() => onSelectPage(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {item.icon && (
                    <span className="set-nav__item-icon" aria-hidden>{item.icon}</span>
                  )}
                  <span className="set-nav__item-label">{item.label}</span>
                  {item.meta && (
                    <span className={`set-nav__item-meta ${item.metaTone === 'warn' ? 'is-warn' : ''}`}>
                      {item.meta}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </aside>

      <div className="set-content">
        <div className="set-content__inner">
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * SettingsPage — page-head pattern (titel + intro + right-slot).
 * Compact wrapper voor de body content per page.
 */
export function SettingsPage({ title, intro, right, children }) {
  return (
    <div className="set-page">
      <header className="set-ph">
        <div>
          <h2 className="set-ph__title">{title}</h2>
          {intro && <p className="set-ph__intro">{intro}</p>}
        </div>
        {right && <div className="set-ph__right">{right}</div>}
      </header>
      {children}
    </div>
  )
}

/**
 * SettingsStub — placeholder voor pages die nog gebouwd worden.
 * Vermijdt witte schermen tijdens incrementele build.
 */
export function SettingsStub({ title, hint }) {
  return (
    <div className="set-stub">
      <div className="set-stub__title">{title}</div>
      <div className="set-stub__hint">{hint}</div>
    </div>
  )
}
