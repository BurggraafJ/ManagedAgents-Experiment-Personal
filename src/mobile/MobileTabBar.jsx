import MIcon from './MIcon'

// Bottom tab bar — 5 hoofd-modules. Home/Agenda/Postvak/Taken openen direct,
// "Meer" opent de slide-up drawer met alle modules. Geport uit
// app/mobile-shared.jsx (BottomTabBar). Badges komen uit de live nav-counts.
// Vragenbak (471302146): Home is de eerste tab; de Briefing (vh "Vandaag")
// verhuisde naar de Meer-drawer en is per 2026-09-12 weg.
// v1.176: Home (/, view-id 'zoeken') is het Dashboard met de stuurkaarten,
// zoals op desktop — daarom het dashboard-icoon. De vragenbak staat op /zoeken
// en telt als onderdeel van Home (vraag-pil), net als de drie borden erachter.
// v1.204 (Jelle 2026-09-15): Agenda staat op plek 2 in de tabbar, Administratie
// (view-id 'hubspot') zakt naar de Meer-drawer. Agenda stond daarvóór in de
// Meer-modules en staat daar nu níét meer — geen dubbele ingang.
// Alleen mobiel: de desktop-sidebar (NAV_GROUPS in viewRegistry) is ongemoeid,
// dus daar houdt Administratie zijn plek onder Operations.
const TABS = [
  { id: 'home',   view: 'zoeken',    icon: 'dashboard', label: 'Home' },
  { id: 'agenda', view: 'agenda',    icon: 'cal',    label: 'Agenda' },
  { id: 'inbox',  view: 'autodraft', icon: 'inbox',  label: 'Postvak' },
  { id: 'task',   view: 'taken',     icon: 'task',   label: 'Taken' },
  { id: 'more',   view: null,        icon: 'more',   label: 'Meer' },
]

// agenda_rules (/agenda/spelregels) hoort visueel bij de Agenda-tab.
// Administratie (hubspot + hubspot_future), Instellingen, Long running tasks
// en het owner-portaal (/admin/*, view-id 'admin') open je vanuit de
// Meer-sheet → "Meer" blijft actief zodat je weet waar je bent en hoe je
// terugkomt (v1.126/v1.127/v1.128, uitgebreid met Administratie in v1.204).
const VIEW_TO_TAB = {
  zoeken: 'home', vragenbak: 'home', pipeline: 'home', datakwaliteit: 'home', klantverlies: 'home',
  agenda: 'agenda', agenda_rules: 'agenda',
  autodraft: 'inbox', taken: 'task',
  hubspot: 'more', hubspot_future: 'more',
  settings: 'more', long_running: 'more', admin: 'more',
}

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
