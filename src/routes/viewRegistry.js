// View-registry (v1.128: uit App.jsx gelicht om de 400-LOC cap te halen).
// Bevat de view-definities, de sidebar-volgorde en de view-id ↔ URL-mapping.
// Pure data + helpers; geen React.
//
// v1.158 (desktop shell "Espresso") — twee toevoegingen, niets verwijderd:
//  • `status` per view voedt de Soon/Const-pill in de desktop-sidebar.
//    Afgesproken 2026-09-12: er bestaat géén Prod-status. Een afgeronde
//    pagina draagt gewoon geen pill.
//  • view-id `vragenbak` (/zoeken) is de RAG-chat ("Analyse") als eigen route.
//    Op desktop is `/` het tegels-Dashboard; Analyse zit onder Dashboard in
//    de nav én via het zoekveld / topbalk-icoon / ⌘K. Mobiel sinds v1.176
//    hetzelfde: `/` = MobileHome (stuurkaarten), `/zoeken` = MobileZoeken.

// Product-removal 2026-09-12 (Maestro-lock, sporen 12 + 13): de view-ids
// 'nu' (label "Briefing", route /briefing) en 'jellemind' (/admin/jellemind)
// zijn hier weg. De cockpit-componenten (views/now/**, NowView.jsx) staan
// nog op schijf — geparkeerd voor design-v3 "Home = dashboard" (spoor 09),
// niet verwijderd. /briefing en /jellemind redirecten in Dashboard.jsx.
export const VIEWS = [
  { id: 'legalai',   label: 'Legal AI',        title: 'Legal AI Thought Leadership', subtitle: 'Dagelijks dossier over de Legal AI-markt — twee tracks (advocatuur + bedrijfsleven). Onderzoek + dagartikel. Voice-feedback evolueert je visie zonder tunnel-visie.', adminOnly: true },
  { id: 'hubspot',         label: 'Administratie', title: 'Administratie · Admin',    subtitle: '', fullWidth: true },
  { id: 'hubspot_future',  label: 'Toekomst',      title: 'Administratie · Toekomst', subtitle: '', fullWidth: true },
  { id: 'autodraft',          label: 'Postvak',     title: 'Postvak',              subtitle: '1:1 je Outlook-inbox met een Maestro-voorstel per mail (Postvak v2-design).', fullWidth: true },
  { id: 'autodraft_settings', label: 'Instellingen', title: 'Mailing · Instellingen', subtitle: 'Voorstellen, categorieën, logboek en geleerde regels — alle skill-configuratie van auto-draft op één plek met tabs.' },
  { id: 'agenda',             label: 'Agenda',      title: 'Agenda',               subtitle: 'Outlook-agenda met week- en dag-view. Toggle \"Toon spelregels\" rendert reistijd-buffers, verkeer-windows en interne dagen als shadow-laag. Outlook blijft bron-van-waarheid.', fullWidth: true },
  { id: 'agenda_rules',       label: 'Spelregels',  title: 'Agenda · Spelregels',  subtitle: 'Beheer alle spelregels van je agenda — verkeer-windows, reistijd-buffers, interne dagen, locatieregels en meer. Wijzigingen werken direct door op de agenda-view.', fullWidth: true },
  { id: 'taken',         label: 'Taken',         title: 'Taken',         subtitle: '', fullWidth: true },
  { id: 'long_running',  label: 'Long running tasks', title: 'Long running tasks', subtitle: 'Elke geplande taak met de vraag die er nu toe doet: waar draait hij — in de app of nog in een externe Claude-routine — en hoe lang doet hij erover.' },
  // Dashboard-only borden (v1.178) — D1 / D9 / D10. View-defs + pathMap blijven
  // staan zodat Home-tegels, deep links en de titelchrome werken. Ze staan
  // bewust NIET in NAV_GROUPS of Mobile More: alleen bereikbaar vanaf Home.
  // adminOnly op D1/D9 omdat de HubSpot-mirror dat is (is_admin_or_higher +
  // session_mfa_ok). D10 (klantverlies) is live sinds v1.175 — geen Const-pill.
  { id: 'pipeline',        label: 'Pipeline',         title: 'Pipeline & forecast',     subtitle: '', fullWidth: true, adminOnly: true },
  { id: 'datakwaliteit',   label: 'Datakwaliteit',    title: 'Datakwaliteit & hygiëne', subtitle: '', fullWidth: true, adminOnly: true },
  // Kwartaaldiagnose (v1.181) — het diagnosebord naast D1. Bereikbaar vanaf de
  // vertrouwensregel van /pipeline, niet vanuit de nav: je opent het per
  // kwartaal, niet per week.
  { id: 'pipeline_kwartaal', label: 'Kwartaaldiagnose', title: 'Pipeline · kwartaaldiagnose', subtitle: '', fullWidth: true, adminOnly: true },
  { id: 'klantverlies',    label: 'Klantverlies',     title: 'Klantverlies · maandritme', subtitle: '', fullWidth: true },
  { id: 'klantbase',       label: 'Klantbase',        title: 'Klantbase',        subtitle: '', fullWidth: true, status: 'const' },
  { id: 'kennisbank',      label: 'Kennisbank',       title: 'Kennisbank',       subtitle: '', fullWidth: true, status: 'soon' },
  { id: 'kennisbank_review', label: 'Review-queue',   title: 'Review-queue',     subtitle: '', fullWidth: true, status: 'soon' },
  { id: 'zoeken',        label: 'Dashboard',     title: 'Dashboard',     subtitle: '', fullWidth: true },
  // Analyse = chat/vragenbak (v1.158 polish). Nav-item onder Dashboard; ook
  // bereikbaar via sidebar-zoekveld / topbalk-icoon / ⌘K.
  { id: 'vragenbak',     label: 'Analyse',       title: 'Analyse',       subtitle: '', fullWidth: true },
  // Intelligence (hub · kwaliteit · kosten) is per 2026-09-14 uit het product
  // (PRODUCT-PURGE, v1.183). De opvolger Pijplijn is in v1.195 uitleg geworden
  // onder /instellingen/uitleg/pijplijn (P9) en heeft dus geen eigen view-id:
  // die pane tekent z'n eigen kop.
  { id: 'health',        label: 'Health & Issues', title: 'Health & Issues', subtitle: 'In één blik welke agents echte aandacht vragen. Run-success per 7 dagen, fouten en stille agents. Bron: agent_runs_health_7d view; auto-refresh per minuut.', adminOnly: true },
  { id: 'security',      label: 'Security',        title: 'Security Monitor', subtitle: 'Open bevindingen van de dagelijkse security-scan. Kritieke issues bovenaan. Klik op een bevinding voor detail; markeer als opgelost of geaccepteerd risico.', adminOnly: true },
  // Instellingen is operationeel: members krijgen Instructies + Algemeen,
  // owner ziet daarnaast Tokens (API Keys) en Infrastructuur (binnen view).
  { id: 'settings',  label: 'Instellingen',    title: 'Instellingen',     subtitle: '', fullWidth: true },
  // Organisatie (v1.172) — owner-portaal als overlay-pane, net als
  // Instellingen. Staat bewust niet in NAV_GROUPS: je opent het via het
  // profile-menu. De pane tekent z'n eigen paginakop, dus geen subtitle hier.
  { id: 'admin',     label: 'Organisatie',     title: 'Organisatie',      subtitle: '', fullWidth: true, adminOnly: true },
  // 'Wat is nieuw' — vol-automatische changelog van platform-updates. Voor
  // iedereen zichtbaar via profile-menu. Owner kan daarnaast op /admin/updates
  // beide areas zien (platform + admin/beheer).
  { id: 'updates',   label: 'Wat is nieuw',    title: 'Wat is nieuw',     subtitle: 'Per dag samengevat wat er aan het platform veranderd is. Kleine wijzigingen staan ingeklapt onderaan elke dag.', fullWidth: true },
]

// Sidebar-volgorde — hoofd-dashboard (operationeel). Admin-functies leven
// in een eigen shell onder /admin/* en zijn bereikbaar via het profile-menu
// (owner-only). Geen verspreide admin-items meer in deze sidebar.
export const NAV_GROUPS = [
  { kind: 'item',  id: 'zoeken' },
  { kind: 'item',  id: 'vragenbak' },
  { kind: 'group', id: 'operations',       label: 'Operations',        children: ['hubspot', 'autodraft', 'agenda', 'taken', 'long_running'] },
  { kind: 'group', id: 'kennis',           label: 'Kennis',            children: ['kennisbank', 'kennisbank_review'] },
  // v1.178: Stuurinformatie-navgroep weg. D1/D9/D10 zijn dashboards vanaf Home,
  // geen sidebar-modules. Customer Success houdt alleen Klantbase (nog Const).
  { kind: 'group', id: 'customer-success', label: 'Customer Success',  children: ['klantbase'] },
]

// View-id ↔ URL-pad. Elke view heeft een eigen route — diepe links werken,
// browser-back werkt, copy-paste van URL werkt. Sub-pagina's gebruiken
// nested paths (bv. /postvak/instellingen, /agenda/spelregels).
export const VIEW_PATHS = {
  // Dashboard-tegels op /; Analyse (vragenbak) op /zoeken.
  // Briefing (/briefing) en JelleMind zijn per 2026-09-12 weg (PR #75) —
  // redirects staan in Dashboard.jsx.
  hubspot:        '/administratie',
  hubspot_future: '/administratie/toekomst',
  autodraft:          '/postvak',
  autodraft_settings: '/postvak/instellingen',
  agenda:             '/agenda',
  agenda_rules:       '/agenda/spelregels',
  zoeken:             '/',
  vragenbak:          '/zoeken',
  taken:              '/taken',
  long_running:       '/long-running-tasks',
  // Dashboard-only paden (v1.178). D9 hangt onder /pipeline omdat het de
  // datastatus-regel van D1 uitlegt. Sortering in viewFromPathname is
  // langste-match-wint, dus /pipeline/hygiene blijft D9. /klantverlies = D10.
  pipeline:           '/pipeline',
  datakwaliteit:      '/pipeline/hygiene',
  pipeline_kwartaal:  '/pipeline/kwartaal',
  klantverlies:       '/klantverlies',
  klantbase:          '/klantbase',
  kennisbank:         '/kennisbank',
  kennisbank_review:  '/kennisbank/review',
  settings:           '/instellingen',
  updates:            '/updates',
  // Organisatie-views leven onder /organisatie/* — overlay-pane naast de
  // Espresso-sidebar (desktop, v1.172) of het mobiele hub met drill-in
  // (v1.128, design A). /admin/* redirect mee in Dashboard.jsx.
  admin:                      '/organisatie',
  admin_users:                '/organisatie/gebruikers',
  legalai:                    '/organisatie/legalai',
  health:                     '/organisatie/health',
  security:                   '/organisatie/security',
}

export function pathFor(viewId) {
  return VIEW_PATHS[viewId] || '/'
}

// Map een URL-pad terug naar view-id. Langste match wint, zodat
// '/postvak/instellingen' niet per ongeluk als 'autodraft' herkend wordt.
const SORTED_PATHS = Object.entries(VIEW_PATHS)
  .sort((a, b) => b[1].length - a[1].length)

export function viewFromPathname(pathname) {
  // Alles onder /organisatie/* is één view voor de shell: de pane tekent z'n
  // eigen kop, dus de topbalk zegt alleen "Organisatie". Zonder deze regel
  // wint /organisatie/health van /organisatie en krijg je de titel én de
  // subtitel van Health dubbel — één keer in de topbalk, één keer in de pane.
  if (isAdminPathname(pathname)) return 'admin'
  for (const [vid, p] of SORTED_PATHS) {
    if (p === '/') continue
    if (pathname === p || pathname.startsWith(p + '/')) return vid
  }
  // '/' (en onbekende paden) = Dashboard (view-id 'zoeken').
  return 'zoeken'
}

// Label van de nav-groep waar een view onder hangt — voedt het broodkruimel-
// spoor in de desktop-topbalk ("Operations / Postvak"). Losse items (Dashboard,
// Analyse) en views buiten de nav geven null: dan toont de topbalk
// alleen de titel.
export function groupLabelFor(viewId) {
  const g = NAV_GROUPS.find(n => n.kind === 'group' && (n.children || []).includes(viewId))
  return g ? g.label : null
}

// De ouder van een pad — voedt `◂ <ouder>` in de desktop-topbalk (v1.191).
//
// Eén regel voor de hele app, zodat de weg terug op elke pagina op dezelfde
// plek staat en niet per view opnieuw bedacht wordt:
//   • `/` (Dashboard) heeft geen ouder — de landing wijst nergens naar terug;
//   • een pad dat dieper ligt dan de route van zijn view (/klantverlies/:id,
//     /kennisbank/artikel/:id, /organisatie/health) gaat terug naar die view;
//   • een view wiens route onder de route van een ándere view hangt
//     (/pipeline/kwartaal, /pipeline/hygiene, /postvak/instellingen,
//     /agenda/spelregels) gaat terug naar die ouder-view;
//   • elke andere view is top-level en gaat terug naar Dashboard.
// Uitzondering: een pane met eigen paginanavigatie (Instellingen, Organisatie)
// redirect haar wortel naar een standaardpagina — `/instellingen` wordt altijd
// `/instellingen/algemeen`. Een `◂ Instellingen` zou daar terugbotsen op de
// pagina waar je al staat; die panes gaan dus op elke diepte naar Dashboard.
// Geeft { viewId, label, path } of null.
const PANE_VIEWS = new Set(['settings', 'admin'])

export function parentFor(pathname) {
  if (!pathname || pathname === '/') return null
  const viewId = viewFromPathname(pathname)
  if (viewId === 'zoeken') return null
  const eigenPad = VIEW_PATHS[viewId]
  const naar = (id) => ({ viewId: id, label: VIEWS.find(v => v.id === id)?.label || id, path: VIEW_PATHS[id] })

  if (PANE_VIEWS.has(viewId)) return { viewId: 'zoeken', label: 'Dashboard', path: '/' }

  // Dieper dan de eigen route → terug naar de view zelf.
  if (eigenPad && pathname !== eigenPad) return naar(viewId)

  // De langste andere route die een strikt voorvoegsel is, is de ouder.
  for (const [vid, p] of SORTED_PATHS) {
    if (vid === viewId || p === '/') continue
    if (eigenPad && eigenPad.startsWith(p + '/')) return naar(vid)
  }
  return { viewId: 'zoeken', label: 'Dashboard', path: '/' }
}

// Telt een pad als 'Organisatie'? Voedt de actieve tab in de mobiele tabbar
// (Meer) en de nav-markering. /admin/* staat er nog bij omdat de redirect pas
// ná de eerste render valt — anders flikkert de tabbar.
export function isAdminPathname(pathname) {
  return pathname === '/organisatie' || pathname.startsWith('/organisatie/') ||
         pathname === '/admin' || pathname.startsWith('/admin/')
}
