// View-registry (v1.128: uit App.jsx gelicht om de 400-LOC cap te halen).
// Bevat de view-definities, de sidebar-volgorde en de view-id ↔ URL-mapping.
// Pure data + helpers; geen React.

export const VIEWS = [
  // Vragenbak in de breedte (471302146): de zoekpagina is "Home" op / —
  // de cockpit heet "Briefing" op /briefing. Functionaliteit 100% behouden,
  // alleen route + naam (hard-rule design-migratie).
  { id: 'nu',        label: 'Briefing',        title: 'Briefing',         subtitle: 'Wat draait er, wat is er vandaag gebeurd, hoe gaat het de afgelopen periode.', fullWidth: true },
  { id: 'jellemind', label: 'JelleMind',       title: 'JelleMind',        subtitle: 'Drie laden voor wat agents geleerd hebben — Jelle (persoonlijke voorkeur), Legal Mind (organisatie-waarheid), Skills (procesinstructies). Alles op één blad om snel te beheren.', wide: true, adminOnly: true },
  { id: 'legalai',   label: 'Legal AI',        title: 'Legal AI Thought Leadership', subtitle: 'Dagelijks dossier over de Legal AI-markt — twee tracks (advocatuur + bedrijfsleven). Onderzoek + dagartikel. Voice-feedback evolueert je visie zonder tunnel-visie.', adminOnly: true },
  { id: 'hubspot',         label: 'Administratie', title: 'Administratie · Admin',    subtitle: '', fullWidth: true },
  { id: 'hubspot_future',  label: 'Toekomst',      title: 'Administratie · Toekomst', subtitle: '', fullWidth: true },
  { id: 'autodraft',          label: 'Postvak',     title: 'Postvak',              subtitle: '1:1 je Outlook-inbox met een Maestro-voorstel per mail (Postvak v2-design).', fullWidth: true },
  { id: 'autodraft_settings', label: 'Instellingen', title: 'Mailing · Instellingen', subtitle: 'Voorstellen, categorieën, logboek en geleerde regels — alle skill-configuratie van auto-draft op één plek met tabs.' },
  { id: 'agenda',             label: 'Agenda',      title: 'Agenda',               subtitle: 'Outlook-agenda met week- en dag-view. Toggle \"Toon spelregels\" rendert reistijd-buffers, verkeer-windows en interne dagen als shadow-laag. Outlook blijft bron-van-waarheid.', fullWidth: true },
  { id: 'agenda_rules',       label: 'Spelregels',  title: 'Agenda · Spelregels',  subtitle: 'Beheer alle spelregels van je agenda — verkeer-windows, reistijd-buffers, interne dagen, locatieregels en meer. Wijzigingen werken direct door op de agenda-view.', fullWidth: true },
  { id: 'taken',         label: 'Taken',         title: 'Taken',         subtitle: '', fullWidth: true },
  { id: 'long_running',  label: 'Long running tasks', title: 'Long running tasks', subtitle: 'Elke geplande taak met de vraag die er nu toe doet: waar draait hij — in de app of nog in een externe Claude-routine — en hoe lang doet hij erover.' },
  { id: 'klantverlies',    label: 'Klantverlies',     title: 'Klantverlies',     subtitle: '', fullWidth: true },
  { id: 'klantbase',       label: 'Klantbase',        title: 'Klantbase',        subtitle: '', fullWidth: true },
  { id: 'kennisbank',      label: 'Kennisbank',       title: 'Kennisbank',       subtitle: '', fullWidth: true },
  { id: 'kennisbank_review', label: 'Review-queue',   title: 'Review-queue',     subtitle: '', fullWidth: true },
  { id: 'zoeken',        label: 'Home',          title: 'Home',          subtitle: '', fullWidth: true },
  { id: 'intelligence',  label: 'Intelligence',  title: 'Intelligence Hub', subtitle: '', fullWidth: true, adminOnly: true },
  { id: 'intelligence_quality', label: 'Kwaliteit', title: 'Intelligence · Kwaliteit', subtitle: 'Diepere analyse op rag_outcomes — acceptance-rate per skill, per chunk-source, per retrieval-strategie. match_chunks vs match_chunks_for_entity vergelijking zodra ≥10 outcomes per strategie.', adminOnly: true },
  { id: 'intelligence_observability', label: 'Kosten', title: 'Intelligence · Kosten', subtitle: 'Claude-call telemetrie — model, tokens, cost, latency per skill en Edge Function. Bron: claude_api_calls + claude_api_costs_7d view.', adminOnly: true },
  { id: 'health',        label: 'Health & Issues', title: 'Health & Issues', subtitle: 'In één blik welke agents echte aandacht vragen. Run-success per 7 dagen, fouten en stille agents. Bron: agent_runs_health_7d view; auto-refresh per minuut.', adminOnly: true },
  { id: 'security',      label: 'Security',        title: 'Security Monitor', subtitle: 'Open bevindingen van de dagelijkse security-scan. Kritieke issues bovenaan. Klik op een bevinding voor detail; markeer als opgelost of geaccepteerd risico.', adminOnly: true },
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
  { kind: 'item',  id: 'nu' },
  { kind: 'group', id: 'operations',       label: 'Operations',        children: ['hubspot', 'autodraft', 'agenda', 'taken', 'long_running'] },
  { kind: 'group', id: 'kennis',           label: 'Kennis',            children: ['kennisbank', 'kennisbank_review'] },
  { kind: 'group', id: 'customer-success', label: 'Customer Success',  children: ['klantverlies', 'klantbase'] },
]

// View-id ↔ URL-pad. Elke view heeft een eigen route — diepe links werken,
// browser-back werkt, copy-paste van URL werkt. Sub-pagina's gebruiken
// nested paths (bv. /postvak/instellingen, /agenda/spelregels).
export const VIEW_PATHS = {
  // Vragenbak (471302146): Home (vragenbak) = landingspagina op /;
  // de cockpit verhuist naar /briefing als "Briefing". /zoeken redirect → /.
  nu:                 '/briefing',
  hubspot:        '/administratie',
  hubspot_future: '/administratie/toekomst',
  autodraft:          '/postvak',
  autodraft_settings: '/postvak/instellingen',
  agenda:             '/agenda',
  agenda_rules:       '/agenda/spelregels',
  zoeken:             '/',
  taken:              '/taken',
  long_running:       '/long-running-tasks',
  klantverlies:       '/klantverlies',
  klantbase:          '/klantbase',
  kennisbank:         '/kennisbank',
  kennisbank_review:  '/kennisbank/review',
  settings:           '/instellingen',
  updates:            '/updates',
  // Admin-views leven onder /admin/* — eigen shell met eigen navigatie
  // (desktop) of het mobiele Admin-hub met drill-in (v1.128, design A).
  admin:                      '/admin',
  admin_users:                '/admin/gebruikers',
  intelligence:               '/admin/intelligence',
  intelligence_quality:       '/admin/intelligence/kwaliteit',
  intelligence_observability: '/admin/intelligence/kosten',
  jellemind:                  '/admin/jellemind',
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
  // '/' (en onbekende paden) = Home = de vragenbak (view-id 'zoeken').
  return 'zoeken'
}

export function isAdminPathname(pathname) {
  return pathname === '/admin' || pathname.startsWith('/admin/')
}
