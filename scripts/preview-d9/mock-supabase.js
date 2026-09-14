// Stub voor lib/supabase in de D9-preview-harness.
//
// Belangrijk: dit harnas draait de ECHTE hook (useD9Hygiene) en de ECHTE
// componenten; alleen de netwerklaag is vervangen. De cijfers hieronder zijn
// geen verzinsels maar de stand van de productie-mirror op 12-09-2026 23:30
// UTC, read-only gemeten via de Management API (peildatum in PEILDATUM). Zo
// toont de screenshot wat het bord op de dag van bouwen werkelijk zegt —
// inclusief het ongemak dat het critical number "0 van 32" is terwijl drie van
// de vier blokkerende checks nog niet meetbaar zijn.
export const SUPABASE_URL = 'https://preview.invalid'
export const SUPABASE_ANON_KEY = 'preview'

const PEILDATUM = '2026-09-12T23:30:07.895Z'

const META = {
  peildatum: PEILDATUM,
  peildatum_companies: PEILDATUM,
  minuten_oud: 12,
  mirror_verouderd: false,
  deals_zichtbaar: 1139,
  companies_zichtbaar: 5629,
  prop_beslisdatum: false,
  prop_verwachtingsvelden: false,
  prop_next_step: false,
  prop_verliesreden: false,
  prop_kennismaking: false,
  prop_stage_entry: false,
  prop_company_omvang: false,
  trend_vanaf: null,
  trend_dagen: 0,
}

const WACHT = 'Het veld bestaat in HubSpot maar staat nog niet in de mirror: de propertylijst van hubspot-sync-etl moet uitgebreid en één keer volledig gesynct worden.'

const CHECKS = [
  { check_id: 'H1', volgnummer: 1, titel: 'Verliesreden ontbreekt', eigenaar: 'Jay', scope: 'sales', scope_label: 'Sales Pipeline', raakt: ['D1', 'D10'], records_view: 'v_d9_h1_verliesreden_leeg', blokkerend: false, status: 'wacht_op_mirror', aantal: null, noemer: 57, noemer_label: 'verloren deals', reden: WACHT, definitie: 'Deal in Afgevallen na demo of Backburner zonder ingevulde verliesreden.' },
  { check_id: 'H2', volgnummer: 2, titel: 'Fase 3 zonder beslisdatum of verwachting', eigenaar: 'Jay', scope: 'sales', scope_label: 'Sales Pipeline', raakt: ['D1'], records_view: 'v_d9_h2_fase3_zonder_velden', blokkerend: true, status: 'wacht_op_mirror', aantal: null, noemer: 25, noemer_label: 'deals in fase 3', reden: WACHT, definitie: 'Deal in fase 3 zonder beslisdatum, minimumafname of contractomvang.' },
  { check_id: 'H3', volgnummer: 3, titel: 'Beslisdatum is verlopen', eigenaar: 'Jay', scope: 'sales', scope_label: 'Sales Pipeline', raakt: ['D1'], records_view: 'v_d9_h3_verlopen_beslisdatum', blokkerend: true, status: 'wacht_op_mirror', aantal: null, noemer: 93, noemer_label: 'open deals', reden: WACHT, definitie: 'Open deal met een beslisdatum die in het verleden ligt.' },
  { check_id: 'H4', volgnummer: 4, titel: 'Geen volgende stap gepland', eigenaar: 'Jay', scope: 'sales', scope_label: 'Sales Pipeline', raakt: ['D1'], records_view: 'v_d9_h4_geen_next_step', blokkerend: true, status: 'wacht_op_mirror', aantal: null, noemer: 32, noemer_label: 'open sales-deals', reden: WACHT, definitie: 'Open sales-deal zonder geplande volgende activiteit, ouder dan 14 dagen.' },
  { check_id: 'H5', volgnummer: 5, titel: 'Zonder of met onbekende eigenaar', eigenaar: 'CS', scope: 'beide', scope_label: 'Sales Pipeline + Customer Base', raakt: ['D1', 'D4', 'D7'], records_view: 'v_d9_h5_zonder_owner', blokkerend: true, status: 'meetbaar', aantal: 16, noemer: 161, noemer_label: 'open deals + klantdeals', reden: null, definitie: 'Open deal of klantdeal zonder eigenaar, of met een eigenaar die niet meer actief is.' },
  { check_id: 'H6', volgnummer: 6, titel: 'Gewonnen deal staat nog in de Sales Pipeline', eigenaar: 'Jay', scope: 'sales', scope_label: 'Sales Pipeline', raakt: ['D1', 'D4'], records_view: 'v_d9_h6_gewonnen_in_sales', blokkerend: false, status: 'meetbaar', aantal: 3, noemer: 3, noemer_label: 'gewonnen deals', reden: null, definitie: 'Deal in Gesloten & Gescoord waarvan de klant geen klantdeal heeft.' },
  { check_id: 'H7', volgnummer: 7, titel: 'Meer dan één open deal op dezelfde klant', eigenaar: 'Jay', scope: 'beide', scope_label: 'Sales Pipeline + Customer Base', raakt: ['D1', 'D4', 'D10'], records_view: 'v_d9_h7_dubbele_open_deals', blokkerend: false, status: 'meetbaar', aantal: 0, noemer: 92, noemer_label: 'klanten met een open deal', reden: null, definitie: 'Company met twee of meer lopende deals in dezelfde pipeline.' },
  { check_id: 'H8', volgnummer: 8, titel: 'Klantdeal zonder kernvelden', eigenaar: 'CS', scope: 'klant', scope_label: 'Customer Base', raakt: ['D3', 'D4', 'D10'], records_view: 'v_d9_h8_klantdeal_zonder_kernvelden', blokkerend: false, status: 'meetbaar', aantal: 0, noemer: 83, noemer_label: 'lopende klantdeals', reden: null, definitie: 'Lopende klantdeal zonder startdatum, contractomvang of minimumafname.' },
  { check_id: 'H9', volgnummer: 9, titel: 'Proef zonder of met verlopen einddatum', eigenaar: 'CS', scope: 'klant', scope_label: 'Customer Base', raakt: ['D3', 'D4', 'D10'], records_view: 'v_d9_h9_proef_einddatum', blokkerend: false, status: 'meetbaar', aantal: 12, noemer: 17, noemer_label: 'proeven', reden: null, definitie: 'Proef zonder einddatum, of met een einddatum die al voorbij is.' },
  { check_id: 'H10', volgnummer: 10, titel: 'Afsluitdatum op een lopende klantdeal', eigenaar: 'CS', scope: 'klant', scope_label: 'Customer Base', raakt: ['D4', 'D10'], records_view: 'v_d9_h10_administratieve_closedate', blokkerend: false, status: 'meetbaar', aantal: 46, noemer: 56, noemer_label: 'lopende klantdeals', reden: null, definitie: 'Lopende klantdeal met een ingevulde afsluitdatum — administratief, nooit een verliesdatum.' },
  { check_id: 'H11', volgnummer: 11, titel: 'Doublure-velden contractstart en contracteinde', eigenaar: 'Jelle', scope: 'beide', scope_label: 'Sales Pipeline + Customer Base', raakt: ['D4', 'D10'], records_view: 'v_d9_h11_doublure_velden', blokkerend: false, status: 'constatering', aantal: 0, noemer: 1139, noemer_label: 'deals in de mirror', reden: null, definitie: 'Eenmalige constatering: contract_start_date en contract_einddatum zijn dode velden.' },
  { check_id: 'H12', volgnummer: 12, titel: 'Kantoorgrootte ontbreekt op de company', eigenaar: 'Jelle', scope: 'company', scope_label: 'Companies', raakt: ['D1', 'D4', 'D10'], records_view: 'v_d9_h12_company_zonder_omvang', blokkerend: false, status: 'wacht_op_mirror', aantal: null, noemer: 5629, noemer_label: 'companies', reden: WACHT, definitie: 'Company zonder totale omvang; draagt de segment-ontleding op elk bord.' },
  { check_id: 'H13', volgnummer: 13, titel: 'Deal zonder company', eigenaar: 'Jay', scope: 'beide', scope_label: 'Sales Pipeline + Customer Base', raakt: ['D1', 'D4', 'D10'], records_view: 'v_d9_h13_zonder_company', blokkerend: false, status: 'meetbaar', aantal: 1, noemer: 161, noemer_label: 'open deals + klantdeals', reden: null, definitie: 'Open deal of klantdeal zonder gekoppelde company.' },
  { check_id: 'H14', volgnummer: 14, titel: 'Leadbron of kanaal ontbreekt', eigenaar: 'Jelle', scope: 'sales', scope_label: 'Sales Pipeline', raakt: ['D1', 'D2'], records_view: null, blokkerend: false, status: 'niet_meetbaar', aantal: null, noemer: null, noemer_label: null, reden: 'Veld bestaat niet in HubSpot — aanmaken is een besluit van Jelle en Jay.', definitie: '' },
  { check_id: 'H15', volgnummer: 15, titel: 'Verlengde proef niet herkenbaar', eigenaar: 'Jelle', scope: 'klant', scope_label: 'Customer Base', raakt: ['D10', 'D4'], records_view: null, blokkerend: false, status: 'niet_meetbaar', aantal: null, noemer: null, noemer_label: null, reden: 'Veld bestaat niet in HubSpot — raakt direct de B/C-grens op D10.', definitie: '' },
  { check_id: 'H16', volgnummer: 16, titel: 'Concurrent in de proef', eigenaar: 'Jelle', scope: 'klant', scope_label: 'Customer Base', raakt: ['D10'], records_view: null, blokkerend: false, status: 'niet_meetbaar', aantal: null, noemer: null, noemer_label: null, reden: 'Veld bestaat niet in HubSpot.', definitie: '' },
  { check_id: 'H17', volgnummer: 17, titel: 'Naammatching Genie ↔ HubSpot', eigenaar: 'Jelle', scope: 'extern', scope_label: 'Genie ↔ HubSpot', raakt: ['D3', 'D4'], records_view: null, blokkerend: false, status: 'niet_gekoppeld', aantal: null, noemer: null, noemer_label: null, reden: 'Genie/Databricks is niet ontsloten; er is nog geen dim_klant_alias.', definitie: '' },
  { check_id: 'H18', volgnummer: 18, titel: 'Klantaantal wijkt af tussen bronnen', eigenaar: 'Jelle', scope: 'extern', scope_label: 'AFAS ↔ HubSpot', raakt: ['D4', 'D5', 'D10'], records_view: null, blokkerend: false, status: 'niet_gekoppeld', aantal: null, noemer: null, noemer_label: null, reden: 'AFAS is niet gekoppeld; er is geen factuur-export in de database.', definitie: '' },
  { check_id: 'H19', volgnummer: 19, titel: 'Uitvalreden ontbreekt op klantdeals', eigenaar: 'CS', scope: 'klant', scope_label: 'Customer Base', raakt: ['D10'], records_view: null, blokkerend: false, status: 'niet_meetbaar', aantal: null, noemer: 20, noemer_label: 'beëindigde klantdeals', reden: 'Veld bestaat niet in HubSpot — de basis staat in de noemer.', definitie: '' },
]

const TELLERS = [
  { scope: 'sales',   scope_label: 'Sales Pipeline',                 open_fouten: 3,  checks_meetbaar: 1, checks_wacht: 4, checks_blind: 1, sort_order: 1 },
  { scope: 'beide',   scope_label: 'Beide pipelines',                open_fouten: 17, checks_meetbaar: 3, checks_wacht: 0, checks_blind: 0, sort_order: 5 },
  { scope: 'klant',   scope_label: 'Customer Base',                  open_fouten: 58, checks_meetbaar: 3, checks_wacht: 0, checks_blind: 3, sort_order: 8 },
  { scope: 'company', scope_label: 'Companies',                      open_fouten: null, checks_meetbaar: 0, checks_wacht: 1, checks_blind: 0, sort_order: 12 },
]

const BLOKKERS = { aantal: 0, noemer: 32, blind_voor: ['H2', 'H3', 'H4'], peildatum: PEILDATUM }

// Recordlijst achter H5. De namen zijn met opzet neutrale plaatshouders en
// geen echte klantnamen: deze repo is publiek en een screenshot is een
// publicatie. Wat de lijst moet laten zien is de vórm — naam, reden, eigenaar,
// dagen, deeplink — niet wie erop staat.
const RECORDS = {
  v_d9_h5_zonder_owner: [
    { check_id: 'H5', record_id: '1', record_type: 'deal', naam: 'Klantdeal · voorbeeldrij 1', pipeline_label: 'Customer Base', fase_label: 'Actief', eigenaar: null, dagen_open: 412, detail: 'geen eigenaar toegewezen', hubspot_url: '#' },
    { check_id: 'H5', record_id: '2', record_type: 'deal', naam: 'Klantdeal · voorbeeldrij 2', pipeline_label: 'Customer Base', fase_label: 'Proef', eigenaar: null, dagen_open: 96, detail: 'geen eigenaar toegewezen', hubspot_url: '#' },
    { check_id: 'H5', record_id: '3', record_type: 'deal', naam: 'Klantdeal · voorbeeldrij 3', pipeline_label: 'Customer Base', fase_label: 'Vernieuwd', eigenaar: null, dagen_open: 604, detail: 'eigenaar-id is niet (meer) actief in HubSpot', hubspot_url: '#' },
  ],
}

// Minimale query-builder: genoeg voor useD9Hygiene (select → order → limit →
// maybeSingle). Elke stap geeft hetzelfde thenable terug.
// ?trend=demo — een ILLUSTRATIEVE reeks voor de C3-trendcel. snap_hygiene_dag
// schrijft pas sinds 13-09-2026 en heeft dus nog geen acht weekstanden; op de
// echte stand toont elke cel `reeks start`. Deze rijen laten de vórm van de cel
// zien (▲ · ▼ · gelijk · — · jonge reeks) en staan zo in de PR benoemd.
const TREND_DEMO = new URLSearchParams(location.search).get('trend') === 'demo'
const META_DEMO = { ...META, trend_vanaf: '2026-07-25', trend_dagen: 50 }
const TREND = [
  { check_id: 'H5',  reeks_week: [12, 13, 13, 14, 15, 15, 14, 16] },      // structureel op → ▲ 2 (warn-ink)
  { check_id: 'H6',  reeks_week: [null, null, null, null, 2, 3, 3, 3] },   // jonge reeks, rechts uitgelijnd → gelijk
  { check_id: 'H9',  reeks_week: [null, null, null, null, null, null, null, 12] }, // één stand → reeks start
  { check_id: 'H10', reeks_week: [50, 49, 48, 47, 47, 47, 48, 46] },      // opgeruimd → ▼ 2 (ink)
  { check_id: 'H13', reeks_week: [2, 1, 1, 1, null, 1, null, 1] },        // vorige week geen meting → —
].map(t => ({ ...t, vanaf: '2026-07-25', tot: '2026-09-12', punten: 50, laatste: t.reeks_week[7], week_terug: t.reeks_week[6], reeks: [] }))

function result(view) {
  if (view === 'v_d9_meta') return TREND_DEMO ? META_DEMO : META
  if (view === 'v_d9_checks') return CHECKS
  if (view === 'v_d9_tellers') return TELLERS
  if (view === 'v_d9_forecast_blokkers') return BLOKKERS
  if (view === 'v_d9_trend') return TREND_DEMO ? TREND : []
  return RECORDS[view] || []
}

function builder(view) {
  const payload = () => ({ data: result(view), error: null })
  const api = {
    select: () => api,
    order: () => api,
    limit: () => api,
    eq: () => api,
    maybeSingle: async () => payload(),
    single: async () => payload(),
    then: (res, rej) => Promise.resolve(payload()).then(res, rej),
  }
  return api
}

export const supabase = {
  auth: {
    getUser: async () => ({ data: { user: { id: 'owner-1' } }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  },
  from: (view) => builder(view),
  rpc: async () => ({ data: null, error: null }),
  removeChannel: () => {},
}

export function createRealtimeChannel() {
  return { on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }
}
