// Stub voor de Rechten/Usage-preview (v1.191).
//
// Fixture-data, geen peiling. Dit zijn shots van de layout; de échte cijfers
// staan in UI-B-USAGE-NOTES.md en zijn met een geminte owner-JWT gemeten, niet
// met dit harnas. De personen komen uit preview-users/mock-hooks.js zodat de
// Gebruikers- en Rechten-shots over dezelfde mensen gaan.
//
// De catalogus hieronder is een verkorte kopie van public.capabilities: alle
// 33 rijen (v1.192: legalai, gebruikers.beheren en data.mail.collega eruit),
// met dezelfde keys, groepen, sort_order en vlaggen. Wijkt de database af, dan
// wijkt de preview af — daarom is dit het enige harnas dat zijn fixture uit een
// migratie overneemt in plaats van zelf te verzinnen.
export const SUPABASE_URL = 'https://preview.invalid'
export const SUPABASE_ANON_KEY = 'preview'

const C = (key, soort, groep, label, omschrijving, grantable, levert, bundle, toelichting, sort) =>
  ({ key, soort, groep, label, omschrijving, grantable, levert_vandaag: levert,
     ui_bundle: bundle, toelichting, sort_order: sort, afdwingen_in: null })

export const CAPABILITIES = [
  // Basisrechten — de enige groep die OPEN staat in de matrix (Kennisbank
  // beheren en Administratie zijn in aanbouw).
  C('home', 'module', 'Basisrechten', 'Dashboard', 'De startpagina met de stuurkaarten.', true, true, null, null, 110),
  C('analyse', 'module', 'Basisrechten', 'Chat en vragenbak', 'Vragen stellen over de eigen bronnen.', true, true, null, null, 120),
  C('postvak', 'module', 'Basisrechten', 'Postvak', 'Inbox, drafts en de postvak-instellingen.', true, true, null, 'Werkt pas met een eigen mailbox-koppeling.', 130),
  C('agenda', 'module', 'Basisrechten', 'Agenda', 'Afspraken en de spelregels eromheen.', true, true, null, null, 140),
  C('taken', 'module', 'Basisrechten', 'Taken', 'Mijn taken en projecten.', true, true, null, null, 150),
  C('instellingen.eigen', 'module', 'Basisrechten', 'Eigen instellingen', 'Profiel, connectors, tweede factor.', true, true, null, null, 160),
  C('mail.versturen', 'handeling', 'Basisrechten', 'Mailbesluit uitvoeren', 'Een draft als Outlook-concept plaatsen.', true, false, null, 'Vandaag owner-only; wordt per-user zodra members een eigen mailbox hebben.', 170),
  C('modellen.gebruiken', 'handeling', 'Basisrechten', 'Betaalde model-calls', 'Taalcheck, transcribe, kb-compose, chat. Het verbruik staat op de Usage-pagina.', true, true, null, 'Het plafond staat in user_model_budget maar wordt nergens afgedwongen.', 180),
  C('kennisbank.lezen', 'module', 'Basisrechten', 'Kennisbank lezen', 'Artikelen raadplegen.', true, true, null, null, 190),
  C('kennisbank.beheren', 'module', 'Basisrechten', 'Kennisbank beheren', 'Review-queue en artikelen vaststellen.', true, false, null, 'De kb_*-tabellen staan op eigen rijen.', 191),
  C('administratie', 'module', 'Basisrechten', 'Administratie', 'De HubSpot-spiegel: deals, bedrijven, contacten.', true, false, null, 'Beslissing 2 zegt ja, maar de RLS is vandaag is_admin_or_higher() — nul rijen.', 195),
  C('data.crm.lezen', 'data', 'Basisrechten', 'CRM-spiegel lezen', 'HubSpot-deals, -bedrijven en -contacten.', true, false, null, 'De policy-omzetting moet nog gebeuren; tot dan nul rijen.', 196),
  C('data.crm.schrijven', 'data', 'Basisrechten', 'CRM-spiegel schrijven', 'Terugschrijven naar HubSpot.', true, false, null, 'hubspot-write doet geen rolcheck (GAP-3).', 197),
  // Dashboards — per bord één recht. Legal AI is er per v1.192 uit.
  C('pipeline', 'module', 'Dashboards', 'Pijplijn (D1)', 'Het commerciële stuurbord.', true, false, null, 'Leest de HubSpot-spiegel.', 210),
  C('datakwaliteit', 'module', 'Dashboards', 'Datakwaliteit (D9)', 'Hygiënechecks op de CRM-data.', true, false, null, 'Leest de HubSpot-spiegel.', 220),
  C('klantverlies', 'module', 'Dashboards', 'Klantverlies (D10)', 'Wie is weggegaan en waarom.', true, false, null, 'Leest de HubSpot-spiegel.', 230),
  C('kwartaaldiagnose', 'module', 'Dashboards', 'Kwartaaldiagnose', 'Het kwartaalbeeld.', true, false, null, 'Leest de HubSpot-spiegel.', 240),
  C('klantbase', 'module', 'Dashboards', 'Klantbase', 'Overdracht en verlengingen.', true, false, null, 'Leest de HubSpot-spiegel.', 250),
  // Eigen gegevens
  C('data.mail.eigen', 'data', 'Eigen gegevens', 'Eigen mail', 'De eigen mailbox en drafts.', true, true, null, null, 310),
  C('data.agenda.eigen', 'data', 'Eigen gegevens', 'Eigen agenda', 'De eigen afspraken.', true, true, null, null, 320),
  C('data.confluence.spaces', 'data', 'Eigen gegevens', 'Confluence-spaces', 'Per space, via confluence_space_grants.', true, true, null, 'Het enige per-user bereik dat vandaag volledig werkt.', 330),
  // Organisatie — Platform hoort er sinds v1.192 bij, API keys niet.
  C('organisatie.gebruikers', 'module', 'Organisatie', 'Gebruikers', 'Mensen toevoegen, uitnodigen, rechten zetten.', true, false, 'organisatie', 'list_users_for_admin() eist vandaag de owner-rol.', 410),
  C('organisatie.health', 'module', 'Organisatie', 'Health', 'Draaien de agents.', true, false, 'organisatie', null, 420),
  C('organisatie.security', 'module', 'Organisatie', 'Security', 'Bevindingen en meldingen.', true, false, 'organisatie', null, 430),
  C('organisatie.skills', 'module', 'Organisatie', 'Skills', 'De org-skills en hun injectie.', true, false, 'organisatie', null, 440),
  C('organisatie.pijplijn', 'module', 'Organisatie', 'Pijplijn', 'De RAG-keten van bron tot antwoord.', true, false, 'organisatie', null, 450),
  C('instellingen.beheer', 'module', 'Organisatie', 'Beheerinstellingen', 'Agents, terminologie, templates, externe partijen — de beheerkant van Instellingen.', true, false, null, 'De afscherming zit vandaag alleen in de RLS eronder.', 460),
  C('agent.uitvoeren', 'handeling', 'Organisatie', 'Agents starten', 'request_run_now en de trigger-RPC’s.', true, false, null, 'De RPC eist de owner-rol.', 470),
  C('agent.instructies', 'handeling', 'Organisatie', 'Agent-instructies wijzigen', 'upsert_agent_instructions.', true, false, null, 'Idem.', 480),
  C('data.telemetrie', 'data', 'Organisatie', 'Telemetrie', 'agent_runs, claude_api_*, evalresultaten.', true, false, null, null, 490),
  C('organisatie.platform', 'module', 'Organisatie', 'Platform', 'Config, edge functions, database.', false, false, null, 'Niet uit te delen.', 495),
  // De sleutelzone
  C('organisatie.apikeys', 'module', 'API keys en secrets', 'API keys', 'Tokens en sleutels.', false, false, null, 'Niet uit te delen.', 510),
  C('secrets.beheren', 'handeling', 'API keys en secrets', 'Secrets', 'Sleutels zetten, roteren, intrekken.', false, false, null, 'Niet uit te delen.', 520),
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

// De dekking in drie stukken (v1.192). Dit zijn de ECHTE cijfers van prod,
// gemeten 2026-09-14: 311 = 37 + 233 + 41 en $4,9835 = $0,6573 + $3,5934 +
// $0,7328. Als de fixture hier gaat afwijken van de view klopt de shot niet
// meer met wat Jelle op het scherm ziet.
const DEKKING = [
  { maand: '2026-09-01', vragen_totaal: 311, vragen_toegewezen: 37, usd_totaal: '4.9835', usd_toegewezen: '0.6573',
    vragen_systeem: 233, usd_systeem: '3.5934', vragen_gat: 41, usd_gat: '0.7328' },
  { maand: '2026-08-01', vragen_totaal: 43, vragen_toegewezen: 0, usd_totaal: '0.5179', usd_toegewezen: null,
    vragen_systeem: 43, usd_systeem: '0.5179', vragen_gat: 0, usd_gat: null },
]

// De doorkijk: een handvol vragen van de owner, zodat de shot van het
// detailpaneel de kolommen laat zien (tijd, vraag, route, model, kosten, duur).
// Vraagteksten zijn verzonnen — dit harnas mag geen echte inhoud dragen.
const USAGE_DETAIL = [
  { id: 'q1', user_id: 'owner-1', maand: '2026-09-01', asked_at: '2026-09-14T09:12:04Z', question: 'Welke deals in de Sales Pipeline staan langer dan 60 dagen stil?', route: 'agentic', answer_model: 'gpt-5.4', est_cost_usd: '0.0913', latency_ms: 14200, answer_chars: 2140, fout: false },
  { id: 'q2', user_id: 'owner-1', maand: '2026-09-01', asked_at: '2026-09-13T16:41:55Z', question: 'Wat is er afgesproken over de verlenging bij die pilot van vorige maand?', route: 'semantic', answer_model: 'gpt-5.4-mini', est_cost_usd: '0.0184', latency_ms: 5100, answer_chars: 1180, fout: false },
  { id: 'q3', user_id: 'owner-1', maand: '2026-09-01', asked_at: '2026-09-13T11:02:18Z', question: 'Geef me de vijf grootste openstaande bedragen per klant.', route: 'structured', answer_model: 'gpt-5.4-mini', est_cost_usd: '0.0054', latency_ms: 2300, answer_chars: 640, fout: false },
  { id: 'q4', user_id: 'owner-1', maand: '2026-09-01', asked_at: '2026-09-12T08:55:31Z', question: 'Welke agents zijn de afgelopen week stil gevallen?', route: 'semantic', answer_model: 'gpt-5.4-mini', est_cost_usd: null, latency_ms: 8900, answer_chars: 0, fout: true },
  { id: 'q5', user_id: 'jay-1', maand: '2026-09-01', asked_at: '2026-09-11T14:20:09Z', question: 'Waar staat de laatste versie van de licentieovereenkomst?', route: 'semantic', answer_model: 'gpt-5.4-mini', est_cost_usd: '0.0112', latency_ms: 4400, answer_chars: 820, fout: false },
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
  v_user_model_usage_detail: USAGE_DETAIL,
  v_user_model_budget: BUDGET,
  // De koers is bewust NULL — dat is precies wat de Usage-pagina moet tonen.
  dash_parameters: [{ sleutel: 'model_budget_usd_per_eur', waarde: null }],
}

// Minimale thenable query-builder: genoeg voor select/order/eq/limit/maybeSingle.
//
// `.eq()` filtert sinds v1.192 écht. De doorkijk op de Usage-pagina doet
// `.eq('user_id', …)`, en een stub die dat negeert zet de vragen van Jay onder
// de naam van de owner — een shot die iets laat zien wat de app niet doet is
// erger dan geen shot.
function builder(rows) {
  let huidig = rows
  const api = {
    select: () => api,
    order: () => api,
    limit: () => api,
    eq: (kolom, waarde) => { huidig = huidig.filter(r => String(r[kolom]) === String(waarde)); return api },
    in: () => api,
    delete: () => api,
    upsert: async () => ({ data: null, error: null }),
    maybeSingle: async () => ({ data: huidig[0] ?? null, error: null }),
    then: (res) => res({ data: huidig, error: null }),
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
