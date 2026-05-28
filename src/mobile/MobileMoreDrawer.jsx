import MIcon from './MIcon'
import { APP_VERSION } from '../version'

// "Meer"-drawer — slide-up sheet met alle modules. Geport uit
// app/mobile-menu.jsx (MobileMenuDrawer). De lijst wordt opgebouwd uit
// DEZELFDE nav + NAV_GROUPS als de desktop-Sidebar, zodat de modules nooit
// kunnen divergeren. adminOnly-filtering is al in `nav` toegepast (App.jsx).

// View-id → mobiel icoon. Houdt de drawer-iconografie consistent met de tab bar.
const VIEW_ICON = {
  nu: 'dashboard', zoeken: 'search', hubspot: 'admin', hubspot_future: 'admin',
  autodraft: 'inbox', agenda: 'cal', taken: 'task', klantverlies: 'user',
  kennisbank: 'mind', sales: 'pin', linkedin: 'link', kilometers: 'car',
  settings: 'settings',
}
const GROUP_LABELS = { operations: 'Operations', 'customer-success': 'Customer Success', hoofdagents: 'Personal Ops' }
// Op mobiel verbergen we deze groepen — alleen relevant op desktop.
const MOBILE_HIDDEN_GROUPS = new Set(['customer-success', 'hoofdagents'])

function initialsOf(name) {
  return (name || 'Gebruiker').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

function NavRow({ v, active, onClick }) {
  return (
    <button type="button" className={`m-navrow ${active ? 'is-active' : ''}`} onClick={onClick}>
      <span className="m-navrow__ico"><MIcon name={VIEW_ICON[v.id] || 'spark'} size={18} /></span>
      <span className="m-navrow__lbl">{v.label}</span>
      {v.count > 0 && (
        <span className={`m-navrow__badge ${v.urgent ? 'm-navrow__badge--urgent' : ''}`}>{v.count}</span>
      )}
      <span className="m-navrow__chev"><MIcon name="chevron" size={14} /></span>
    </button>
  )
}

export default function MobileMoreDrawer({
  open, onClose, nav = [], groups = [], activeView, onSelect,
  profile, onLogout, theme, onToggleTheme,
}) {
  if (!open) return null

  const byId = Object.fromEntries(nav.map(v => [v.id, v]))
  const topItems = groups.filter(g => g.kind === 'item' && g.id !== 'nu').map(g => g.id)
  const sections = groups.filter(g => g.kind === 'group' && !MOBILE_HIDDEN_GROUPS.has(g.id))

  return (
    <>
      <div className="m-scrim" onClick={onClose} />
      <div className="m-drawer" role="dialog" aria-modal="true" aria-label="Alle modules">
        <div className="m-drawer__grab" />
        <div className="m-drawer__head">
          <span className="m-drawer__title">Alle modules</span>
          <button type="button" className="m-drawer__close" onClick={onClose} aria-label="Sluiten">
            <MIcon name="close" size={16} />
          </button>
        </div>

        <div className="m-drawer__list">
          {topItems.map(id => byId[id] && (
            <NavRow key={id} v={byId[id]} active={activeView === id} onClick={() => onSelect(id)} />
          ))}

          {sections.map(sec => (
            <div key={sec.id}>
              <div className="m-grouplbl">{GROUP_LABELS[sec.id] || sec.label}</div>
              {sec.children.map(id => byId[id] && (
                <NavRow key={id} v={byId[id]} active={activeView === id} onClick={() => onSelect(id)} />
              ))}
            </div>
          ))}

          <div className="m-grouplbl">Account</div>
          {byId['settings'] && (
            <NavRow v={byId['settings']} active={activeView === 'settings'} onClick={() => onSelect('settings')} />
          )}
          <button type="button" className="m-navrow" onClick={onToggleTheme}>
            <span className="m-navrow__ico"><MIcon name={theme === 'light' ? 'moon' : 'sun'} size={18} /></span>
            <span className="m-navrow__lbl">{theme === 'light' ? 'Donker thema' : 'Licht thema'}</span>
          </button>
        </div>

        <div className="m-drawer__user">
          <div className="m-drawer__avatar">{initialsOf(profile?.display_name)}</div>
          <div className="m-drawer__userinfo">
            <div className="m-drawer__username">{profile?.display_name || 'Gebruiker'}</div>
            <div className="m-drawer__userrole">{profile?.role || 'member'} · maestro.app · v{APP_VERSION}</div>
          </div>
          {onLogout && (
            <button type="button" className="m-drawer__logout" onClick={onLogout}>Uitloggen</button>
          )}
        </div>
      </div>
    </>
  )
}
