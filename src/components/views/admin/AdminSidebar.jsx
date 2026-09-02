import { Link, useLocation } from 'react-router-dom'
import { APP_VERSION } from '../../../version'

// AdminSidebar — eigen navigatie binnen de Organisatie-shell (desktop).
// Apart van de hoofd-Dashboard sidebar; alleen zichtbaar binnen /admin/*.
// Klik op "← Dashboard" om het portaal te verlaten.
//
// v1.134: de kop heet "Organisatie" (was "Admin").
//
// v1.128 (Admin A): gehergroepeerd per taak — Toegang / Bewaking / Leren /
// Intelligence / Infrastructuur — met tellers in de nav-meta (useAdminCounts
// in AdminShell). Geen Admin home meer (/admin → Health).
// v1.129: voet = versie + "Wat is nieuw"; Legal AI alleen via /admin/legalai.

const I = (paths) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths}</svg>
)
const ICONS = {
  users:    I(<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>),
  health:   I(<path d="M22 12h-4l-3 9L9 3l-3 9H2" />),
  security: I(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />),
  jellemind: I(<><path d="M12 2a4 4 0 0 0-4 4v1a4 4 0 0 0-2 7.5V17a3 3 0 0 0 3 3h.5" /><path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1 2 7.5V17a3 3 0 0 1-3 3h-.5" /><path d="M12 6v14" /></>),
  pipeline: I(<><circle cx="12" cy="12" r="3" /><path d="M12 1v6M12 17v6M4.2 4.2l4.3 4.3M15.5 15.5l4.3 4.3M1 12h6M17 12h6M4.2 19.8l4.3-4.3M15.5 8.5l4.3-4.3" /></>),
  quality:  I(<path d="m4 13 5 5L20 7" />),
  cost:     I(<><path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-6" /></>),
  sliders:  I(<><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" /><path d="M1 14h6M9 8h6M17 16h6" /></>),
  zap:      I(<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />),
  rocket:   I(<><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" /><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" /><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" /><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" /></>),
  db:       I(<><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v6a9 3 0 0 0 18 0V5" /><path d="M3 11v6a9 3 0 0 0 18 0v-6" /></>),
  key:      I(<><circle cx="7.5" cy="15.5" r="5.5" /><path d="m21 2-9.6 9.6" /><path d="m15.5 7.5 3 3L22 7l-3-3" /></>),
  book:     I(<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>),
  laptop:   I(<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M2 20h20" /></>),
}

// `meta` = sleutel in counts (useAdminCounts); `metaTone` kleurt de teller.
//
// v1.134: de groepen die geen telefoon-tegenhanger hebben staan onderaan onder
// één kop "Alleen op desktop" (`desktopOnly: true`), zodat de indeling hier
// hetzelfde verhaal vertelt als het mobiele portaal. De telefoon houdt
// Gebruikers · Health · Security; al het overige is desktop.
export const NAV_GROUPS = [
  { group: 'Toegang', items: [
    { id: 'gebruikers', label: 'Gebruikers', path: '/admin/gebruikers', icon: ICONS.users, meta: 'users' },
  ] },
  { group: 'Bewaking', items: [
    { id: 'health',   label: 'Health',   path: '/admin/health',   icon: ICONS.health,   meta: 'healthAttention', metaTone: 'warn' },
    { id: 'security', label: 'Security', path: '/admin/security', icon: ICONS.security, meta: 'securityOpen',    metaTone: 'err' },
  ] },
  { group: 'Kennis', items: [
    { id: 'skills', label: 'Skills', path: '/admin/skills', icon: ICONS.book },
  ] },
  { group: 'Alleen op desktop', desktopOnly: true, items: [
    { id: 'jellemind', label: 'JelleMind', path: '/admin/jellemind', icon: ICONS.jellemind, meta: 'jellemindPending' },
    { id: 'intelligence-pijplijn',  label: 'Pijplijn',  path: '/admin/intelligence',           icon: ICONS.pipeline, exact: true },
    { id: 'intelligence-kwaliteit', label: 'Kwaliteit', path: '/admin/intelligence/kwaliteit', icon: ICONS.quality },
    { id: 'intelligence-kosten',    label: 'Kosten',    path: '/admin/intelligence/kosten',    icon: ICONS.cost },
    { id: 'configuratie',   label: 'Configuratie',   path: '/admin/configuratie',   icon: ICONS.sliders },
    { id: 'edge-functions', label: 'Edge Functions', path: '/admin/edge-functions', icon: ICONS.zap },
    { id: 'deployments',    label: 'Deployments',    path: '/admin/deployments',    icon: ICONS.rocket },
    { id: 'database',       label: 'Database',       path: '/admin/database',       icon: ICONS.db },
    { id: 'api-keys',       label: 'API Keys',       path: '/admin/api-keys',       icon: ICONS.key },
  ] },
]

export default function AdminSidebar({ onExit, counts = {}, profile }) {
  const location = useLocation()

  function isActive(item) {
    if (item.exact) return location.pathname === item.path
    return location.pathname === item.path || location.pathname.startsWith(item.path + '/')
  }

  function metaFor(item) {
    if (!item.meta) return null
    const n = counts[item.meta]
    if (n == null || n === 0) return null
    // Security kleurt alleen rood bij open critical/high; anders neutraal.
    const tone = item.meta === 'securityOpen' ? (counts.securityUrgent > 0 ? 'err' : '') : (item.metaTone || '')
    return <span className={`admin-sidebar__meta ${tone ? `admin-sidebar__meta--${tone}` : ''}`}>{n}</span>
  }

  return (
    <aside className="admin-sidebar">
      <div className="admin-sidebar__head">
        <button type="button" onClick={onExit} className="admin-sidebar__back" aria-label="Terug naar dashboard">
          <span aria-hidden>←</span> Dashboard
        </button>
        <Link to="/admin/health" className="admin-sidebar__title">
          Organisatie
          <span className="admin-sidebar__title-badge">owner</span>
        </Link>
      </div>

      <nav className="admin-sidebar__nav" aria-label="Organisatie navigatie">
        {NAV_GROUPS.map(group => (
          <div key={group.group} className={group.desktopOnly ? 'admin-sidebar__group--desktop' : undefined}>
            <div className="admin-sidebar__group-label">
              {group.group}
              {group.desktopOnly && (
                <span className="admin-sidebar__group-tag" title="Deze pagina's hebben geen telefoon-versie">
                  {ICONS.laptop}
                </span>
              )}
            </div>
            {group.items.map(item => (
              <Link
                key={item.id}
                to={item.path}
                className={`admin-sidebar__link ${isActive(item) ? 'is-active' : ''}`}
              >
                {item.icon}
                <span>{item.label}</span>
                {metaFor(item)}
              </Link>
            ))}
          </div>
        ))}
      </nav>

      {/* v1.129 (Chrome A): rustige voet — versie + één link. Legal AI blijft
          bereikbaar via /admin/legalai (route staat), niet meer als voetlink. */}
      <div className="admin-sidebar__foot">
        <div className="admin-sidebar__foot-ver">v{APP_VERSION}{profile?.display_name ? ` · ${profile.display_name}` : ''}</div>
        <Link to="/admin/updates" className="admin-sidebar__foot-link">Wat is nieuw</Link>
      </div>
    </aside>
  )
}
