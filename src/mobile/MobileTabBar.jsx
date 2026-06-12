import MIcon from './MIcon'

// Bottom tab bar — 5 hoofd-modules. Home/Postvak/Taken/Admin openen direct,
// "Meer" opent de slide-up drawer met alle modules. Geport uit
// app/mobile-shared.jsx (BottomTabBar). Badges komen uit de live nav-counts.
// Vragenbak (471302146): Home (vragenbak) is de eerste tab; de Briefing
// (vh "Vandaag"/Dashboard) verhuist naar de Meer-drawer.
const TABS = [
  { id: 'home',  view: 'zoeken',    icon: 'search', label: 'Home' },
  { id: 'inbox', view: 'autodraft', icon: 'inbox',  label: 'Postvak' },
  { id: 'task',  view: 'taken',     icon: 'task',   label: 'Taken' },
  { id: 'admin', view: 'hubspot',   icon: 'admin',  label: 'Admin' },
  { id: 'more',  view: null,        icon: 'more',   label: 'Meer' },
]

// hubspot_future hoort visueel ook bij de Admin-tab.
const VIEW_TO_TAB = { zoeken: 'home', autodraft: 'inbox', taken: 'task', hubspot: 'admin', hubspot_future: 'admin' }

export default function MobileTabBar({ activeView, onSelect, onOpenMore, counts = {} }) {
  const activeTab = VIEW_TO_TAB[activeView] || ''
  return (
    <nav className="m-tabbar">
      {TABS.map(t => {
        const isActive = t.id === activeTab
        const cnt = counts[t.id] || 0
        return (
          <button
            key={t.id}
            type="button"
            className={`m-tab ${isActive ? 'is-active' : ''}`}
            onClick={() => (t.id === 'more' ? onOpenMore() : onSelect(t.view))}
            aria-current={isActive ? 'page' : undefined}
          >
            <span className="m-tab__ico">
              <MIcon name={t.icon} size={22} stroke={isActive ? 2 : 1.7} />
              {cnt > 0 && <span className="m-tab__badge">{cnt > 99 ? '99+' : cnt}</span>}
            </span>
            <span className="m-tab__lbl">{t.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
