import './settings.css'

/**
 * SettingsLayout — shell + nav-pane + content-pane.
 *
 * Maestro-design — eigen .sv2-* class-prefix (legacy van "settings v2"
 * rebuild op 2026-05-13, behouden voor stabiliteit). Tokens lokaal binnen
 * .sv2-app, geen :root pollutie.
 *
 * Props:
 *   groups       — array van { id, label, items: [{ id, label, icon, meta, metaTone }] }
 *   activePage   — id van actieve pagina
 *   onSelectPage — (id) => void
 *   children     — content van de actieve page
 */
export default function SettingsLayout({ groups, activePage, onSelectPage, children }) {
  return (
    <div className="sv2-app">
      <aside className="sv2-nav" aria-label="Instellingen-navigatie">
        <div className="sv2-nav__title">Instellingen</div>

        {groups.map(group => (
          <div key={group.id} className="sv2-nav__group">
            <div className="sv2-nav__group-label">{group.label}</div>
            {group.items.map(item => {
              const isActive = activePage === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`sv2-nav__item ${isActive ? 'is-active' : ''}`}
                  onClick={() => onSelectPage(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {item.icon && (
                    <span className="sv2-nav__item-icon" aria-hidden>{item.icon}</span>
                  )}
                  <span className="sv2-nav__item-label">{item.label}</span>
                  {item.meta && (
                    <span className={`sv2-nav__item-meta ${item.metaTone === 'warn' ? 'is-warn' : ''}`}>
                      {item.meta}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </aside>

      <div className="sv2-content">
        <div className="sv2-content__inner">
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
    <div className="sv2-page">
      <header className="sv2-ph">
        <div>
          <h2 className="sv2-ph__title">{title}</h2>
          {intro && <p className="sv2-ph__intro">{intro}</p>}
        </div>
        {right && <div className="sv2-ph__right">{right}</div>}
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
    <div className="sv2-stub">
      <div className="sv2-stub__title">{title}</div>
      <div className="sv2-stub__hint">{hint}</div>
    </div>
  )
}
