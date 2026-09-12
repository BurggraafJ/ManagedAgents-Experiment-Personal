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
//    de nav én via het zoekveld / topbalk-icoon / ⌘K. Mobiel: `/` blijft
//    MobileZoeken.

// Product-removal 2026-09-12 (Maestro-lock, sporen 12 + 13): de view-ids
// 'nu' (label "Briefing", route /briefing) en 'jellemind' (/admin/jellemind)
// zijn hier weg. De cockpit-componenten (views/now/**, NowView.jsx) staan
// nog op schijf — geparkeerd voor design-v3 "Home = dashboard" (spoor 09),
// niet verwijderd. /briefing en /jellemind redirecten in Dashboard.jsx.
//
// v1.168 (Maestro Organisatie B Platform): Organisatie verhuisd van AdminShell
// naar Dashboard-embedded view (zoals Instellingen). Espresso sidebar blijft
// zichtbaar, Organisatie opent als pane ernaast.
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
  { id: 'klantverlies',    label: 'Klantverlies',     title: 'Klantverlies',     subtitle: '', fullWidth: true, status: 'const' },
  { id: 'klantbase',       label: 'Klantbase',        title: 'Klantbase',        subtitle: '', fullWidth: true, status: 'const' },
  { id: 'kennisbank',      label: 'Kennisbank',       title: 'Kennisbank',       subtitle: '', fullWidth: true, status: 'soon' },
  { id: 'kennisbank_review', label: 'Review-queue',   title: 'Review-queue',     subtitle: '', fullWidth: true, status: 'soon' },
  { id: 'zoeken',        label: 'Dashboard',     title: 'Dashboard',     subtitle: '', fullWidth: true },
  // Analyse = chat/vragenbak (v1.158 polish). Nav-item onder Dashboard; ook
  // bereikbaar via sidebar-zoekveld / topbalk-icoon / ⌘K.
  { id: 'vragenbak',     label: 'Analyse',       title: 'Analyse',       subtitle: '', fullWidth: true },
  { id: 'intelligence',  label: 'Intelligence',  title: 'Intelligence Hub', subtitle: '', fullWidth: true, adminOnly: true },
  { id: 'intelligence_quality', label: 'Kwaliteit', title: 'Intelligence · Kwaliteit', subtitle: 'Diepere analyse op rag_outcomes — acceptance-rate per skill, per chunk-source, per retrieval-strategie. match_chunks vs match_chunks_for_entity vergelijking zodra ≥10 outcomes per strategie.', adminOnly: true },
  { id: 'intelligence_observability', label: 'Kosten', title: 'Intelligence · Kosten', subtitle: 'Claude-call telemetrie — model, tokens, cost, latency per skill en Edge Function. Bron: claude_api_calls + claude_api_costs_7d view.', adminOnly: true },
  { id: 'health',        label: 'Health & Issues', title: 'Health & Issues', subtitle: 'In één blik welke agents echte aandacht vragen. Run-success per 7 dagen, fouten en stille agents. Bron: agent_runs_health_7d view; auto-refresh per minuut.', adminOnly: true },
  { id: 'security',      label: 'Security',        title: 'Security Monitor', subtitle: 'Open bevindingen van de dagelijkse security-scan. Kritieke issues bovenaan. Klik op een bevinding voor detail; markeer als opgelost of geaccepteerd risico.', adminOnly: true },
  { id: 'organisatie',   label: 'Organisatie',     title: 'Organisatie',      subtitle: 'Owner-portaal: gebruikers, health, security, skills, intelligence, platform en meer. Opens binnen Dashboard (Espresso sidebar blijft zichtbaar).', fullWidth: true, adminOnly: true },
  // Instellingen is operationeel: members krijgen Instructies + Algemeen,
  // owner ziet daarnaast Tokens (API Keys) en Infrastructuur (binnen view).
  { id: 'settings',  label: 'Instellingen',    title: 'Instellingen',     subtitle: '', fullWidth: true },
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
  { kind: 'group', id: 'customer-success', label: 'Customer Success',  children: ['klantverlies', 'klantbase'] },
]

// View-id ↔ URL-pad. Elke view heeft een eigen route — diepe links werken,
// browser-back werkt, copy-paste van URL werkt. Sub-pagina's gebruiken
// nested paths (bv. /postvak/instellingen, /agenda/spelregels).
export const VIEW_PATHS = {
  // Dashboard-tegels op /; Analyse (vragenbak) op /zoeken.
  // Briefing (/briefing) en JelleMind zijn per 2026-09-12 weg (PR #75) —
  // redirects staan in Dashboard.jsx / AdminShell.jsx.
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
  klantverlies:       '/klantverlies',
  klantbase:          '/klantbase',
  kennisbank:         '/kennisbank',
  kennisbank_review:  '/kennisbank/review',
  organisatie:        '/organisatie',
  settings:           '/instellingen',
  updates:            '/updates',
  // Legacy admin paths remain for redirects in Dashboard.jsx
  admin:                      '/admin',
  admin_users:                '/admin/gebruikers',
  intelligence:               '/admin/intelligence',
  intelligence_quality:       '/admin/intelligence/kwaliteit',
  intelligence_observability: '/admin/intelligence/kosten',
  legalai:                    '/admin/legalai',
  health:                     '/admin/health',
  security:                   '/admin/security',
}

export function pathFor(viewId) {
  return VIEW_PATHS[viewId] || '/'
}

// Map een URL-pad terug naar view-id. Langste match wint, zodat
// '/postvak/instellingen' niet per ongeluk als 'autodraft' herkend wordt.
const SORTED_PATHS = Object.entries(VIEW_PATHS)
  .sort((a, b) => b[1].length - a[1].length)

export function viewFromPathname(pathname) {
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

export function isAdminPathname(pathname) {
  return pathname === '/admin' || pathname.startsWith('/admin/') ||
         pathname === '/organisatie' || pathname.startsWith('/organisatie/')
}
