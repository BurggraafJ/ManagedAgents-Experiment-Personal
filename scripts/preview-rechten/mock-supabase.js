// Stub voor de Rechten/Usage-preview (v1.191).
//
// Fixture-data, geen peiling. Dit zijn shots van de layout; de échte cijfers
// staan in UI-B-USAGE-NOTES.md en zijn met een geminte owner-JWT gemeten, niet
// met dit harnas. De personen komen uit preview-users/mock-hooks.js zodat de
// Gebruikers- en Rechten-shots over dezelfde mensen gaan.
//
// De catalogus hieronder is een verkorte kopie van public.capabilities: alle
// 36 rijen, met dezelfde keys, groepen, sort_order en vlaggen. Wijkt de
// database af, dan wijkt de preview af — daarom is dit het enige harnas dat
// zijn fixture uit een migratie overneemt in plaats van zelf te verzinnen.
export const SUPABASE_URL = 'https://preview.invalid'
export const SUPABASE_ANON_KEY = 'preview'

const C = (key, soort, groep, label, omschrijving, grantable, levert, bundle, toelichting, sort) =>
  ({ key, soort, groep, label, omschrijving, grantable, levert_vandaag: levert,
     ui_bundle: bundle, toelichting, sort_order: sort, afdwingen_in: null })

export const CAPABILITIES = [
  C('home', 'module', 'Werk', 'Dashboard', 'De startpagina met de stuurkaarten.', true, true, null, null, 10),
  C('analyse', 'module', 'Werk', 'Chat en vragenbak', 'Vragen stellen over de eigen bronnen.', true, true, null, null, 20),
  C('postvak', 'module', 'Werk', 'Postvak', 'Inbox, drafts en de postvak-instellingen.', true, true, null, 'Werkt pas met een eigen mailbox-koppeling.', 30),
  C('agenda', 'module', 'Werk', 'Agenda', 'Afspraken en de spelregels eromheen.', true, true, null, null, 40),
  C('taken', 'module', 'Werk', 'Taken', 'Mijn taken en projecten.', true, true, null, null, 50),
  C('kennisbank.lezen', 'module', 'Werk', 'Kennisbank lezen', 'Artikelen raadplegen.', true, true, null, null, 60),
  C('instellingen.eigen', 'module', 'Werk', 'Eigen instellingen', 'Profiel, connectors, tweede factor.', true, true, null, null, 70),
  C('kennisbank.beheren', 'module', 'Werk', 'Kennisbank beheren', 'Review-queue en artikelen vaststellen.', true, false, null, 'De kb_*-tabellen staan op eigen rijen.', 80),
  C('administratie', 'module', 'Stuurinformatie', 'Administratie', 'De HubSpot-spiegel: deals, bedrijven, contacten.', true, false, null, 'Beslissing 2 zegt ja, maar de RLS is vandaag is_admin_or_higher() — nul rijen.', 110),
  C('pipeline', 'module', 'Stuurinformatie', 'Pijplijn (D1)', 'Het commerciële stuurbord.', true, false, null, 'Leest de HubSpot-spiegel.', 120),
  C('datakwaliteit', 'module', 'Stuurinformatie', 'Datakwaliteit (D9)', 'Hygiënechecks op de CRM-data.', true, false, null, 'Leest de HubSpot-spiegel.', 130),
  C('klantverlies', 'module', 'Stuurinformatie', 'Klantverlies (D10)', 'Wie is weggegaan en waarom.', true, false, null, 'Leest de HubSpot-spiegel.', 140),
  C('klantbase', 'module', 'Stuurinformatie', 'Klantbase', 'Overdracht en verlengingen.', true, false, null, 'Leest de HubSpot-spiegel.', 150),
  C('kwartaaldiagnose', 'module', 'Stuurinformatie', 'Kwartaaldiagnose', 'Het kwartaalbeeld.', true, false, null, 'Leest de HubSpot-spiegel.', 160),
  C('legalai', 'module', 'Stuurinformatie', 'Legal AI', 'Het marktbeeld.', true, false, null, null, 170),
  C('organisatie.gebruikers', 'module', 'Organisatie', 'Gebruikers', 'Mensen toevoegen, uitnodigen, rechten zetten.', true, false, 'organisatie', 'list_users_for_admin() eist vandaag de owner-rol.', 210),
  C('organisatie.health', 'module', 'Organisatie', 'Health', 'Draaien de agents.', true, false, 'organisatie', null, 220),
  C('organisatie.security', 'module', 'Organisatie', 'Security', 'Bevindingen en meldingen.', true, false, 'organisatie', null, 230),
  C('organisatie.skills', 'module', 'Organisatie', 'Skills', 'De org-skills en hun injectie.', true, false, 'organisatie', null, 240),
  C('organisatie.pijplijn', 'module', 'Organisatie', 'Pijplijn', 'De RAG-keten van bron tot antwoord.', true, false, 'organisatie', null, 250),
  C('instellingen.beheer', 'module', 'Organisatie', 'Beheerinstellingen', 'Agents, terminologie, templates, externe partijen.', true, false, null, 'De afscherming zit vandaag alleen in de RLS eronder.', 260),
  C('organisatie.platform', 'module', 'Organisatie', 'Platform', 'Config, edge functions, database.', false, false, null, 'Niet uit te delen.', 270),
  C('organisatie.apikeys', 'module', 'Organisatie', 'API keys', 'Tokens en sleutels.', false, false, null, 'Niet uit te delen.', 280),
  C('data.mail.eigen', 'data', 'Bereik', 'Eigen mail', 'De eigen mailbox en drafts.', true, true, null, null, 310),
  C('data.agenda.eigen', 'data', 'Bereik', 'Eigen agenda', 'De eigen afspraken.', true, true, null, null, 320),
  C('data.confluence.spaces', 'data', 'Bereik', 'Confluence-spaces', 'Per space, via confluence_space_grants.', true, true, null, 'Het enige per-user bereik dat vandaag volledig werkt.', 330),
  C('data.crm.lezen', 'data', 'Bereik', 'CRM-spiegel lezen', 'HubSpot-deals, -bedrijven en -contacten.', true, false, null, 'De policy-omzetting moet nog gebeuren; tot dan nul rijen.', 340),
  C('data.crm.schrijven', 'data', 'Bereik', 'CRM-spiegel schrijven', 'Terugschrijven naar HubSpot.', true, false, null, 'hubspot-write doet geen rolcheck (GAP-3).', 350),
  C('data.telemetrie', 'data', 'Bereik', 'Telemetrie', 'agent_runs, claude_api_*, evalresultaten.', true, false, null, null, 360),
  C('data.mail.collega', 'data', 'Bereik', 'Mail van een collega', 'De mailbox van iemand anders inzien.', false, false, null, 'Niet ontworpen, niet gebouwd, niet uit te delen.', 370),
  C('agent.uitvoeren', 'handeling', 'Handelingen', 'Agents starten', 'request_run_now en de trigger-RPC’s.', true, false, null, 'De RPC eist de owner-rol.', 410),
  C('agent.instructies', 'handeling', 'Handelingen', 'Agent-instructies wijzigen', 'upsert_agent_instructions.', true, false, null, 'Idem.', 420),
  C('mail.versturen', 'handeling', 'Handelingen', 'Mailbesluit uitvoeren', 'Een draft als Outlook-concept plaatsen.', true, false, null, 'Vandaag owner-only; wordt per-user zodra members een eigen mailbox hebben.', 430),
  C('modellen.gebruiken', 'handeling', 'Handelingen', 'Betaalde model-calls', 'Taalcheck, transcribe, kb-compose, chat.', true, true, null, 'Het plafond staat in user_model_budget maar wordt nergens afgedwongen.', 440),
  C('secrets.beheren', 'handeling', 'Handelingen', 'Secrets', 'Sleutels zetten, roteren, intrekken.', false, false, null, 'Niet uit te delen.', 450),
  C('gebruikers.beheren', 'handeling', 'Handelingen', 'Gebruikers beheren', 'Aanmaken, uitnodigen, rol wijzigen.', false, false, null, 'create-user en invite-user doen al een eigen rolcheck.', 460),
]

const MEMBER_PRESET = [
  'home', 'analyse', 'postvak', 'agenda', 'taken', 'kennisbank.lezen', 'instellingen.eigen',
  'data.mail.eigen', 'data.agenda.eigen', 'data.confluence.spaces',
  'administratie', 'data.crm.lezen', 'mail.versturen', 'modellen.gebruiken',
]

export const ROLE_CAPABILITIES = [
  ...CAPABILITIES.map(c => ({ app_role: 'owner', capability: c.key })),
  ...MEMBER_PRESET.map(k => ({ app_role: 'member', capability: k })),
]

// Drie handmatige afwijkingen, zodat het scherm zijn accent-toestanden toont:
// twee bijgezet, één weggehaald. Zelfde persoon als in de artboord-mockup.
export const USER_CAPABILITIES = [
  { user_id: 'victor-1', capability: 'organisatie.health', effect: 'grant', granted_at: '2026-09-14T08:00:00Z', note: null },
  { user_id: 'victor-1', capability: 'organisatie.security', effect: 'grant', granted_at: '2026-09-14T08:00:00Z', note: null },
  { user_id: 'jay-1', capability: 'data.telemetrie', effect: 'grant', granted_at: '2026-09-13T10:00:00Z', note: null },
  { user_id: 'jacqueline-1', capability: 'administratie', effect: 'revoke', granted_at: '2026-09-13T10:00:00Z', note: null },
]

const MAILBOX = [
  { user_id: 'owner-1', gekoppeld: true, enabled: true, paused: false, last_sync_finished_at: '2026-09-14T11:35:14Z', heeft_fout: false },
  { user_id: 'jay-1', gekoppeld: true, enabled: true, paused: true, last_sync_finished_at: '2026-09-11T07:02:00Z', heeft_fout: false },
]

const USAGE = [
  { user_id: 'owner-1', maand: '2026-09-01', vragen: 31, cost_usd: '0.5896' },
  { user_id: 'jay-1', maand: '2026-09-01', vragen: 6, cost_usd: '0.0677' },
]

const DEKKING = [
  { maand: '2026-09-01', vragen_totaal: 311, vragen_toegewezen: 37, usd_totaal: '4.9835', usd_toegewezen: '0.6573' },
  { maand: '2026-08-01', vragen_totaal: 43, vragen_toegewezen: 0, usd_totaal: '0.5179', usd_toegewezen: null },
]

const BUDGET = ['owner-1', 'jay-1', 'iris-1', 'jacqueline-1', 'niels-1', 'julia-1', 'victor-1']
  .map(user_id => ({ user_id, monthly_cap_eur: '50', alert_at_pct: '80', paused: false, expliciet_gezet: false }))

const TABLES = {
  capabilities: CAPABILITIES,
  role_capabilities: ROLE_CAPABILITIES,
  user_capabilities: USER_CAPABILITIES,
  v_mailbox_link_status: MAILBOX,
  v_user_model_usage_month: USAGE,
  v_model_usage_dekking: DEKKING,
  v_user_model_budget: BUDGET,
  // De koers is bewust NULL — dat is precies wat de Usage-pagina moet tonen.
  dash_parameters: [{ sleutel: 'model_budget_usd_per_eur', waarde: null }],
}

// Minimale thenable query-builder: genoeg voor select/order/eq/maybeSingle.
function builder(rows) {
  const api = {
    select: () => api,
    order: () => api,
    eq: () => api,
    in: () => api,
    delete: () => api,
    upsert: async () => ({ data: null, error: null }),
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (res) => res({ data: rows, error: null }),
  }
  return api
}

export const supabase = {
  from: (table) => builder(TABLES[table] || []),
  rpc: async (name) => {
    if (name === 'my_capabilities') {
      // De owner: alles aan, bron 'rol' behalve de vaste rechten.
      return {
        data: CAPABILITIES.map(c => ({
          capability: c.key, soort: c.soort, groep: c.groep, label: c.label,
          omschrijving: c.omschrijving, actief: true,
          bron: c.grantable ? 'rol' : 'vast',
          grantable: c.grantable, levert_vandaag: c.levert_vandaag,
          afdwingen_in: c.afdwingen_in, ui_bundle: c.ui_bundle,
          toelichting: c.toelichting, sort_order: c.sort_order,
        })),
        error: null,
      }
    }
    return { data: [], error: null }
  },
  auth: {
    getUser: async () => ({ data: { user: { id: 'owner-1' } } }),
    getSession: async () => ({ data: { session: null } }),
  },
  channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
  removeChannel: () => {},
}

export function createRealtimeChannel() {
  return { on() { return this }, subscribe() { return this } }
}
