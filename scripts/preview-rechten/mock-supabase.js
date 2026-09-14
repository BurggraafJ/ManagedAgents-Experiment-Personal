// Stub voor de Rechten/Usage-preview (v1.193).
//
// Fixture-data, geen peiling. Dit zijn shots van de layout; de échte cijfers
// staan in UI-B-USAGE-NOTES.md en zijn met een geminte owner-JWT gemeten, niet
// met dit harnas. De personen komen uit preview-users/mock-hooks.js zodat de
// Gebruikers- en Rechten-shots over dezelfde mensen gaan.
//
// De catalogus hieronder is een verkorte kopie van public.capabilities: alle
// 32 rijen met dezelfde keys, groepen, sort_order, bundels en vlaggen als
// migratie 20260914170000. Wijkt de database af, dan wijkt de preview af —
// daarom is dit het enige harnas dat zijn fixture uit een migratie overneemt in
// plaats van zelf te verzinnen.
export const SUPABASE_URL = 'https://preview.invalid'
export const SUPABASE_ANON_KEY = 'preview'

const C = (key, soort, groep, label, omschrijving, grantable, levert, bundle, toelichting, sort) =>
  ({ key, soort, groep, label, omschrijving, grantable, levert_vandaag: levert,
     ui_bundle: bundle, toelichting, sort_order: sort, afdwingen_in: null })

export const CAPABILITIES = [
  // Werk — de enige groep die OPEN staat (Administratie levert vandaag niets).
  // Vier bundels en twee losse rechten = 6 rijen.
  C('home', 'module', 'Werk', 'Dashboard', 'De startpagina met de stuurkaarten.', true, true, 'werkplek', null, 110),
  C('taken', 'module', 'Werk', 'Taken', 'Mijn taken en projecten.', true, true, 'werkplek', null, 111),
  C('instellingen.eigen', 'module', 'Werk', 'Eigen instellingen', 'Profiel, connectors, tweede factor.', true, true, 'werkplek', null, 112),
  C('analyse', 'module', 'Werk', 'Chat en vragenbak', 'Vragen stellen over de eigen bronnen.', true, true, 'analyse', null, 120),
  C('data.confluence.spaces', 'data', 'Werk', 'Confluence-spaces', 'Per space, via confluence_space_grants.', true, true, 'analyse', 'Het enige per-user bereik dat vandaag volledig werkt.', 121),
  C('modellen.gebruiken', 'handeling', 'Werk', 'Betaalde model-calls', 'Taalcheck, transcribe, kb-compose, chat.', true, true, 'analyse', 'Het plafond staat in user_model_budget maar wordt nergens afgedwongen.', 122),
  C('postvak', 'module', 'Werk', 'Postvak', 'Inbox, drafts en de postvak-instellingen.', true, true, 'postvak', 'Werkt pas met een eigen mailbox-koppeling.', 130),
  C('data.mail.eigen', 'data', 'Werk', 'Eigen mail', 'De eigen mailbox en drafts.', true, true, 'postvak', null, 131),
  C('mail.versturen', 'handeling', 'Werk', 'Mailbesluit uitvoeren', 'Een draft als Outlook-concept plaatsen.', true, false, 'postvak', 'Vandaag owner-only; wordt per-user zodra members een eigen mailbox hebben.', 132),
  C('agenda', 'module', 'Werk', 'Agenda', 'Afspraken en de spelregels eromheen.', true, true, 'agenda', null, 140),
  C('data.agenda.eigen', 'data', 'Werk', 'Eigen agenda', 'De eigen afspraken.', true, true, 'agenda', null, 141),
  C('administratie', 'module', 'Werk', 'Administratie', 'De HubSpot-spiegel: deals, bedrijven, contacten.', true, false, null, 'Beslissing 2 zegt ja, maar de RLS is vandaag is_admin_or_higher() — nul rijen.', 150),
  C('kennisbank', 'module', 'Werk', 'Kennisbank', 'Artikelen lezen, de review-queue en artikelen vaststellen.', true, true, null, 'Lezen werkt; het vaststellen niet — kennisbank_review staat in de nav als "soon".', 160),
  // Dashboards — per bord één recht, plus de spiegel waar ze uit lezen.
  C('pipeline', 'module', 'Dashboards', 'Pijplijn (D1)', 'Het commerciële stuurbord.', true, false, null, 'Leest de HubSpot-spiegel.', 210),
  C('datakwaliteit', 'module', 'Dashboards', 'Datakwaliteit (D9)', 'Hygiënechecks op de CRM-data.', true, false, null, 'Leest de HubSpot-spiegel.', 220),
  C('klantverlies', 'module', 'Dashboards', 'Klantverlies (D10)', 'Wie is weggegaan en waarom.', true, false, null, 'Leest de HubSpot-spiegel.', 230),
  C('kwartaaldiagnose', 'module', 'Dashboards', 'Kwartaaldiagnose', 'Het kwartaalbeeld.', true, false, null, 'Leest de HubSpot-spiegel.', 240),
  C('klantbase', 'module', 'Dashboards', 'Klantbase', 'Overdracht en verlengingen.', true, false, null, 'Leest de HubSpot-spiegel.', 250),
  C('data.crm.lezen', 'data', 'Dashboards', 'Stuurdata lezen (CRM-spiegel)', 'De HubSpot-gegevens onder Administratie en de vijf borden hierboven.', true, false, null, 'De policy-omzetting moet nog gebeuren; tot dan nul rijen.', 260),
  // Organisatie — één vinkje voor het portaal, één slot voor de sleutels.
  C('organisatie.gebruikers', 'module', 'Organisatie', 'Gebruikers', 'Mensen toevoegen, uitnodigen, rechten zetten.', true, false, 'organisatie', 'list_users_for_admin() eist vandaag de owner-rol.', 310),
  C('organisatie.health', 'module', 'Organisatie', 'Health', 'Draaien de agents.', true, false, 'organisatie', null, 311),
  C('organisatie.security', 'module', 'Organisatie', 'Security', 'Bevindingen en meldingen.', true, false, 'organisatie', null, 312),
  C('organisatie.skills', 'module', 'Organisatie', 'Skills', 'De org-skills en hun injectie.', true, false, 'organisatie', null, 313),
  C('organisatie.pijplijn', 'module', 'Organisatie', 'Pijplijn', 'De RAG-keten van bron tot antwoord.', true, false, 'organisatie', null, 314),
  C('instellingen.beheer', 'module', 'Organisatie', 'Beheerinstellingen', 'Agents, terminologie, templates, externe partijen.', true, false, 'organisatie', 'De afscherming zit vandaag alleen in de RLS eronder.', 315),
  C('agent.uitvoeren', 'handeling', 'Organisatie', 'Agents starten', 'request_run_now en de trigger-RPC’s.', true, false, 'organisatie', 'De RPC eist de owner-rol.', 316),
  C('agent.instructies', 'handeling', 'Organisatie', 'Agent-instructies wijzigen', 'upsert_agent_instructions.', true, false, 'organisatie', 'Idem.', 317),
  C('data.telemetrie', 'data', 'Organisatie', 'Telemetrie', 'agent_runs, claude_api_*, evalresultaten.', true, false, 'organisatie', null, 318),
  C('data.crm.schrijven', 'data', 'Organisatie', 'CRM-spiegel schrijven', 'Terugschrijven naar HubSpot — hoort bij het beheerdeel.', true, false, 'organisatie', 'hubspot-write doet geen rolcheck (GAP-3).', 319),
  C('organisatie.platform', 'module', 'Organisatie', 'Platform', 'Config, edge functions, database.', true, false, 'organisatie', 'Zit sinds v1.193 in de Organisatie-bundel.', 320),
  C('organisatie.apikeys', 'module', 'Organisatie', 'API keys', 'Tokens en sleutels.', false, false, 'sleutels', 'Niet uit te delen.', 330),
  C('secrets.beheren', 'handeling', 'Organisatie', 'Secrets', 'Sleutels zetten, roteren, intrekken.', false, false, 'sleutels', 'Niet uit te delen.', 331),
]

// ⚠ Geen enkele bundel mag deze lijst doorsnijden: dan toont elk memberhokje
// een streepje. Zie de verificatiequery onderaan migratie 20260914170000.
const MEMBER_PRESET = [
  'home', 'taken', 'instellingen.eigen',
  'analyse', 'data.confluence.spaces', 'modellen.gebruiken',
  'postvak', 'data.mail.eigen', 'mail.versturen',
  'agenda', 'data.agenda.eigen',
  'administratie', 'kennisbank', 'data.crm.lezen',
]

export const ROLE_CAPABILITIES = [
  ...CAPABILITIES.map(c => ({ app_role: 'owner', capability: c.key })),
  ...MEMBER_PRESET.map(k => ({ app_role: 'member', capability: k })),
]

// Drie handmatige afwijkingen, zodat het scherm zijn accent-toestanden toont:
// twee bijgezet, één weggehaald.
//
// Victor krijgt de hele Organisatie-bundel — precies wat Jelle bedoelde met "ik
// kan Organisatie erbij vinken". Eén vinkje in de UI, elf rijen in de database;
// de teller in de kolomkop zegt daarom **1** en niet 11 (userStatsFor telt in
// rijen). Die elf worden hier gegenereerd in plaats van uitgeschreven, zodat de
// fixture niet stilletjes uit de pas loopt met de bundel in de catalogus.
const ORG_BUNDEL = CAPABILITIES.filter(c => c.ui_bundle === 'organisatie').map(c => c.key)

export const USER_CAPABILITIES = [
  ...ORG_BUNDEL.map(capability => ({
    user_id: 'victor-1', capability, effect: 'grant',
    granted_at: '2026-09-14T08:00:00Z', note: null,
  })),
  { user_id: 'jay-1', capability: 'klantverlies', effect: 'grant', granted_at: '2026-09-13T10:00:00Z', note: null },
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

// De doorkijk: een handvol vragen van de owner, zodat de shot van de modal de
// kolommen laat zien (tijd, vraag, route, model, kosten, duur). Vraagteksten
// zijn verzonnen — dit harnas mag geen echte inhoud dragen.
//
// ⚠ Bewuste mismatch: de tabel zegt 31 vragen voor de owner (dat telt op tot de
// 37 toegewezen uit de échte dekking), de modal toont er 4. 27 nepvragen
// verzinnen om die twee gelijk te trekken zou de shot mooier maken en de
// fixture onbetrouwbaar; de app haalt hier gewoon alle rijen op.
const USAGE_DETAIL = [
  { id: 'q1', user_id: 'owner-1', maand: '2026-09-01', asked_at: '2026-09-14T09:12:04Z', question: 'Welke deals in de Sales Pipeline staan langer dan 60 dagen stil?', route: 'agentic', answer_model: 'gpt-5.4', est_cost_usd: '0.0913', latency_ms: 14200, answer_chars: 2140, fout: false },
  { id: 'q2', user_id: 'owner-1', maand: '2026-09-01', asked_at: '2026-09-13T16:41:55Z', question: 'Wat is er afgesproken over de verlenging bij die pilot van vorige maand?', route: 'semantic', answer_model: 'gpt-5.4-mini', est_cost_usd: '0.0184', latency_ms: 5100, answer_chars: 1180, fout: false },
  { id: 'q3', user_id: 'owner-1', maand: '2026-09-01', asked_at: '2026-09-13T11:02:18Z', question: 'Geef me de vijf grootste openstaande bedragen per klant.', route: 'structured', answer_model: 'gpt-5.4-mini', est_cost_usd: '0.0054', latency_ms: 2300, answer_chars: 640, fout: false },
  { id: 'q4', user_id: 'owner-1', maand: '2026-09-01', asked_at: '2026-09-12T08:55:31Z', question: 'Welke agents zijn de afgelopen week stil gevallen?', route: 'semantic', answer_model: 'gpt-5.4-mini', est_cost_usd: null, latency_ms: 8900, answer_chars: 0, fout: true },
  { id: 'q5', user_id: 'jay-1', maand: '2026-09-01', asked_at: '2026-09-11T14:20:09Z', question: 'Waar staat de laatste versie van de licentieovereenkomst?', route: 'semantic', answer_model: 'gpt-5.4-mini', est_cost_usd: '0.0112', latency_ms: 4400, answer_chars: 820, fout: false },
]

// Plafonds: iedereen op de standaard, behalve Jay — die heeft er sinds v1.193
// een eigen, zodat de shot beide toestanden van de kolom toont ("standaard" en
// "eigen"). Maestro's plafond komt niet hier vandaan maar uit dash_parameters.
const BUDGET = ['owner-1', 'jay-1', 'iris-1', 'jacqueline-1', 'niels-1', 'julia-1', 'victor-1']
  .map(user_id => ({
    user_id,
    monthly_cap_eur: user_id === 'jay-1' ? '120' : '50',
    alert_at_pct: '80',
    paused: false,
    expliciet_gezet: user_id === 'jay-1',
  }))

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
  // Maestro's plafond staat ernaast, op dezelfde standaard als een persoon.
  dash_parameters: [
    { sleutel: 'model_budget_usd_per_eur', waarde: null },
    { sleutel: 'model_budget_maestro_eur', waarde: 50 },
  ],
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
    update: () => api,
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
