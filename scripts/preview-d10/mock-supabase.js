// Stub voor lib/supabase in de D10-preview-harness.
//
// Belangrijk: dit harnas draait de ECHTE D10View (pure board sinds v1.178)
// en useD10Verlies; alleen de netwerklaag is vervangen. De cijfers hieronder zijn geen verzinsels maar de
// stand van de productie-mirror op 13-09-2026 00:45 UTC, gelezen uit de
// v_d10_*-views zelf. Zo toont de screenshot wat het bord op de dag van bouwen
// werkelijk zegt — inclusief het ongemak dat negen van de twintig
// klantverliezen geen bruikbare reden dragen en dat A helemaal geen reden heeft.
//
// Klant-, deal- en eigenaarsnamen zijn met opzet neutrale plaatshouders: deze
// repo is publiek en een screenshot is een publicatie. Wat de lijsten moeten
// laten zien is de vórm — klant, datum, dagen, bandbreedte, eigenaar, deeplink
// — niet wie erop staat. De bedragen zijn wél echt: het zijn licentie-aantallen
// maal de lijstprijs, en die twee staan sinds v1.173 al publiek in
// supabase/migrations/20260912220000_dash_foundation_a_parameters_events.sql.
export const SUPABASE_URL = 'https://preview.invalid'
export const SUPABASE_ANON_KEY = 'preview'

const PEILDATUM = '2026-09-13T00:45:07.015Z'

const META = {
  peildatum: PEILDATUM,
  minuten_oud: 11,
  mirror_verouderd: false,
  deals_zichtbaar: 1138,
  noemer_klantdeals: 66,
  noemer_kantoren: 46,
  klantdeals_incl_proef: 83,
  kantoren_incl_proef: 62,
  proeven: 17,
  beeindigd: 20,
  a_totaal: 57,
  a_stage_entry: 57,
  a_closedate: 0,
  a_zonder_datum: 0,
  a_met_reden: 0,
  bc_totaal: 20,
  grensgevallen: 2,
  bc_zonder_plafond: 1,
  dossiers: 18,
  met_samenvatting: 18,
  met_churned_at: 9,
  laatste_run: '2026-09-10T05:26:36.340Z',
  dossiers_ontbrekend: 2,
  duurgrens_dagen: 365,
  grensmarge_dagen: 35,
  afas_gekoppeld: false,
  churn_pct_toonbaar: false,
  companies_met_omvang: 218,
  companies_zichtbaar: 5621,
}

const KOP = [
  {
    soort: 'A', volgnummer: 1, soort_label: 'Prospectverlies', is_churn: false,
    churn_label: 'telt niet als churn — deal verloren vóór de proef',
    totaal: 57, deze_maand: 2, vorige_maand: 5, laatste_13_maanden: 57,
    zonder_datum: 0, grensgevallen: 0, waardeerbaar: 0, plafond_bekend: 0,
    waarde_bodem: null, waarde_plafond: null, licenties_bodem: null, licenties_plafond: null,
    duur_min: 0, duur_max: 512, duur_mediaan: 205, duur_gemiddeld: 175,
    duur_grondslag: 'deal aangemaakt → verliesstage',
    vroegste: '2025-10-03', laatste: '2026-09-11',
  },
  {
    soort: 'B', volgnummer: 2, soort_label: 'Proef niet omgezet', is_churn: false,
    churn_label: 'telt niet als churn — proef eindigde zonder klant te worden',
    totaal: 19, deze_maand: 2, vorige_maand: 0, laatste_13_maanden: 19,
    zonder_datum: 0, grensgevallen: 1, waardeerbaar: 19, plafond_bekend: 18,
    waarde_bodem: 10652, waarde_plafond: 13632, licenties_bodem: 45, licenties_plafond: 113,
    duur_min: 26, duur_max: 364, duur_mediaan: 61, duur_gemiddeld: 87,
    duur_grondslag: 'startdatum → einddatum',
    vroegste: '2025-12-31', laatste: '2026-09-09',
  },
  {
    soort: 'C', volgnummer: 3, soort_label: 'Opzegging', is_churn: true,
    churn_label: 'dit is churn — opzegging in de licentieperiode',
    totaal: 1, deze_maand: 0, vorige_maand: 0, laatste_13_maanden: 1,
    zonder_datum: 0, grensgevallen: 1, waardeerbaar: 1, plafond_bekend: 1,
    waarde_bodem: 475, waarde_plafond: 2850, licenties_bodem: 5, licenties_plafond: 30,
    duur_min: 380, duur_max: 380, duur_mediaan: 380, duur_gemiddeld: 380,
    duur_grondslag: 'startdatum → einddatum',
    vroegste: '2026-06-30', laatste: '2026-06-30',
  },
]

// 13 maanden × 3 soorten, exact zoals v_d10_verlies_per_soort_maand ze levert.
const REEKS = [
  ['2025-09', 0, 0, 0, null, null], ['2025-10', 27, 0, 0, 223, null],
  ['2025-11', 6, 0, 0, 35, null],   ['2025-12', 1, 2, 0, 54, 84],
  ['2026-01', 5, 0, 0, 70, null],   ['2026-02', 0, 2, 0, null, 52],
  ['2026-03', 4, 0, 0, 153.5, null],['2026-04', 0, 3, 0, null, 60],
  ['2026-05', 5, 4, 0, 79, 74.5],   ['2026-06', 1, 1, 1, 0, 166],
  ['2026-07', 1, 5, 0, 61, 30],     ['2026-08', 5, 0, 0, 237, null],
  ['2026-09', 2, 2, 0, 196, 44.5],
]

const MAANDREEKS = REEKS.flatMap(([key, a, b, c, amed, bmed]) => {
  const maand = `${key}-01`
  const huidig = key === '2026-09'
  const rij = (soort, volgnummer, aantal, med) => ({
    maand, maand_key: key, is_huidige_maand: huidig, soort, volgnummer, aantal,
    grensgevallen: 0, licenties_bodem: null, licenties_plafond: null,
    waarde_bodem: null, waarde_plafond: null, op_gebeurtenisdatum: aantal,
    duur_mediaan: med,
  })
  return [rij('A', 1, a, amed), rij('B', 2, b, bmed), rij('C', 3, c, key === '2026-06' ? 380 : null)]
})

const REDENEN = [
  { bron: 'ai', bron_label: 'AI-categorisering uit notities en mails', bron_bereik: 'B · C — klantkant', reden: 'Concurrent gekozen', kleur: null, aantal: 6, noemer: 20, is_niet_geregistreerd: false, blok: 1, sort_order: 10, aantal_30d: 0 },
  { bron: 'ai', bron_label: 'AI-categorisering uit notities en mails', bron_bereik: 'B · C — klantkant', reden: 'Productkwaliteit', kleur: null, aantal: 2, noemer: 20, is_niet_geregistreerd: false, blok: 1, sort_order: 20, aantal_30d: 0 },
  { bron: 'ai', bron_label: 'AI-categorisering uit notities en mails', bron_bereik: 'B · C — klantkant', reden: 'Missende functie', kleur: null, aantal: 1, noemer: 20, is_niet_geregistreerd: false, blok: 1, sort_order: 30, aantal_30d: 0 },
  { bron: 'ai', bron_label: 'AI-categorisering uit notities en mails', bron_bereik: 'B · C — klantkant', reden: 'Prijs / budget', kleur: null, aantal: 2, noemer: 20, is_niet_geregistreerd: false, blok: 1, sort_order: 40, aantal_30d: 1 },
  { bron: 'ai', bron_label: 'AI-categorisering uit notities en mails', bron_bereik: 'B · C — klantkant', reden: 'Reden onbekend', kleur: null, aantal: 7, noemer: 20, is_niet_geregistreerd: true, blok: 1, sort_order: 900, aantal_30d: 0 },
  { bron: 'ai', bron_label: 'AI-categorisering uit notities en mails', bron_bereik: 'B · C — klantkant', reden: 'Nog geen dossier (agent loopt achter)', kleur: null, aantal: 2, noemer: 20, is_niet_geregistreerd: true, blok: 1, sort_order: 960, aantal_30d: null },
  { bron: 'hubspot', bron_label: 'Veld closed_lost_reason in HubSpot', bron_bereik: 'A — prospectkant', reden: 'Niet geregistreerd', kleur: null, aantal: 57, noemer: 57, is_niet_geregistreerd: true, blok: 2, sort_order: 900, aantal_30d: 2 },
]

const ANNOTATIES = [{
  datum: '2025-10-03',
  gebeurtenis: 'Opruimronde verliesstages Sales Pipeline (oktober 2025)',
  toelichting: '27 deals uit januari–april 2025 gingen in die maand alsnog naar een verliesstage, verspreid over zes dagen. Mediane leeftijd bij verlies 223 dagen, tegen 35–80 in de maanden erna.',
}]

const P = (i, status, startdatum, einddatum, bron, dagen, bodem, plafond, eigenaar) => ({
  deal_id: `proef-${i}`, klant: `Kantoor ${String.fromCharCode(64 + i)} · plaatshouder`,
  dealname: `Kantoor ${String.fromCharCode(64 + i)}`, stage_label: 'Proeftijd',
  eigenaar, startdatum, einddatum, einddatum_bron: bron, einddatum_veld: bron === 'veld' ? einddatum : null,
  looptijd_maanden: 2, dagen_lopend: null, dagen_te_gaan: dagen, status,
  bodem_lic: null, plafond_lic: null, waarde_bodem: bodem, waarde_plafond: plafond, hubspot_url: '#',
})

const PROEVEN = [
  P(1, 'verlopen', '2026-03-02', '2026-05-02', 'afgeleid', -134, 875, 875, 'Eigenaar A · customer success'),
  P(2, 'verlopen', '2026-01-01', '2026-07-01', 'afgeleid', -74, 540, 675, 'Eigenaar A · customer success'),
  P(3, 'verlopen', '2026-05-06', '2026-07-06', 'afgeleid', -69, 350, 350, 'Eigenaar B · directie'),
  P(4, 'verlopen', '2026-05-18', '2026-07-18', 'afgeleid', -57, 525, 525, 'Eigenaar A · customer success'),
  P(5, 'verlopen', '2026-03-13', '2026-08-07', 'veld', -37, 0, 0, 'Eigenaar B · directie'),
  P(6, 'verlopen', '2026-06-01', '2026-08-31', 'veld', -13, 525, 525, 'Eigenaar A · customer success'),
  P(7, 'verlopen', '2026-07-02', '2026-09-02', 'afgeleid', -11, 350, 350, 'Eigenaar A · customer success'),
  P(8, 'verlopen', '2026-07-08', '2026-09-08', 'afgeleid', -5, 700, 1050, 'Eigenaar B · directie'),
  P(9, 'binnen_30', '2026-07-15', '2026-09-15', 'afgeleid', 2, 700, 1050, 'Eigenaar A · customer success'),
  P(10, 'binnen_30', '2026-07-15', '2026-09-15', 'afgeleid', 2, 567, 567, 'Eigenaar A · customer success'),
  P(11, 'binnen_30', '2026-05-27', '2026-09-27', 'veld', 14, 875, 875, 'Eigenaar B · directie'),
  P(12, 'binnen_30', '2026-02-02', '2026-10-01', 'veld', 18, 875, 1750, 'Eigenaar A · customer success'),
]

const V = (i, status, startdatum, moment, dagen, bodem, plafond, eigenaar) => ({
  deal_id: `verleng-${i}`, klant: `Kantoor ${i} · plaatshouder`, dealname: `Kantoor ${i}`,
  fase: 'actief', fase_label: 'Actief', stage_label: 'Actieve deals', eigenaar,
  startdatum, verlengingsmoment: moment, dagen_te_gaan: dagen, status,
  moment_grondslag: 'startdatum + 12 maanden',
  bodem_lic: null, plafond_lic: null, waarde_bodem: bodem, waarde_plafond: plafond, hubspot_url: '#',
})

const VERLENGING = [
  V(1, 'verstreken', '2025-04-01', '2026-04-01', -165, 500, 500, null),
  V(2, 'verstreken', '2025-05-15', '2026-05-15', -121, 475, 1330, 'Eigenaar A · customer success'),
  V(3, 'verstreken', '2025-05-15', '2026-05-15', -121, 190, 950, 'Eigenaar A · customer success'),
  V(4, 'verstreken', '2025-05-15', '2026-05-15', -121, 675, 4995, 'Eigenaar B · directie'),
  V(5, 'verstreken', '2025-06-01', '2026-06-01', -104, 675, 675, 'Eigenaar A · customer success'),
  V(6, 'verstreken', '2025-06-01', '2026-06-01', -104, 475, 950, 'Eigenaar A · customer success'),
  V(7, 'verstreken', '2025-06-01', '2026-06-01', -104, 475, 475, 'Eigenaar B · directie'),
  V(8, 'verstreken', '2025-06-15', '2026-06-15', -90, 675, 1890, 'Eigenaar A · customer success'),
  V(9, 'verstreken', '2025-07-15', '2026-07-15', -60, 270, 270, 'Eigenaar A · customer success'),
  V(10, 'verstreken', '2025-08-01', '2026-08-01', -43, 270, 810, 'Eigenaar B · directie'),
  V(11, 'verstreken', '2025-08-15', '2026-08-15', -29, 540, 540, 'Eigenaar A · customer success'),
  V(12, 'binnen_90', '2025-09-15', '2026-09-15', 2, 270, 1890, 'Eigenaar A · customer success'),
  V(13, 'binnen_90', '2025-09-15', '2026-09-15', 2, 337.5, 337.5, 'Eigenaar B · directie'),
  V(14, 'binnen_90', '2025-10-01', '2026-10-01', 18, 625, 625, 'Eigenaar A · customer success'),
  V(15, 'binnen_90', '2025-10-01', '2026-10-01', 18, 400, 400, 'Eigenaar A · customer success'),
  V(16, 'binnen_90', '2025-10-01', '2026-10-01', 18, 270, 945, 'Eigenaar B · directie'),
  V(17, 'binnen_90', '2025-10-01', '2026-10-01', 18, 675, 1080, 'Eigenaar A · customer success'),
  V(18, 'binnen_90', '2025-10-15', '2026-10-15', 32, 405, 1215, 'Eigenaar A · customer success'),
  V(19, 'binnen_90', '2025-11-01', '2026-11-01', 49, 675, 675, 'Eigenaar B · directie'),
  V(20, 'binnen_90', '2025-11-01', '2026-11-01', 49, 1125, 1125, 'Eigenaar A · customer success'),
  V(21, 'binnen_90', '2025-11-01', '2026-11-01', 49, 675, 3375, 'Eigenaar A · customer success'),
  V(22, 'binnen_90', '2025-11-15', '2026-11-15', 63, 675, 1350, 'Eigenaar B · directie'),
  V(23, 'binnen_90', '2025-11-15', '2026-11-15', 63, 270, 540, 'Eigenaar A · customer success'),
  V(24, 'binnen_90', '2025-12-01', '2026-12-01', 79, 675, 1215, 'Eigenaar A · customer success'),
  V(25, 'binnen_90', '2025-12-01', '2026-12-01', 79, 675, 1350, 'Eigenaar A · customer success'),
  V(26, 'binnen_90', '2025-12-01', '2026-12-01', 79, 135, 135, 'Eigenaar B · directie'),
  V(27, 'binnen_90', '2025-12-01', '2026-12-01', 79, 250, 250, 'Eigenaar A · customer success'),
]

// ── Dossierlaag (useChurnData) — ongewijzigd gebleven onderdeel van het bord ──
const CATEGORIEEN = [
  { id: 'c1', category_key: 'concurrent_gekozen', label: 'Concurrent gekozen', description: null, color: '#dc6f3f', sort_order: 10, is_active: true, is_system: true },
  { id: 'c2', category_key: 'productkwaliteit', label: 'Productkwaliteit', description: null, color: '#8b4628', sort_order: 20, is_active: true, is_system: true },
  { id: 'c3', category_key: 'missende_functie', label: 'Missende functie', description: null, color: '#2f5fa8', sort_order: 30, is_active: true, is_system: true },
  { id: 'c4', category_key: 'prijs_budget', label: 'Prijs / budget', description: null, color: '#8a4d0c', sort_order: 40, is_active: true, is_system: true },
  { id: 'c9', category_key: 'reden_onbekend', label: 'Reden onbekend', description: null, color: '#737373', sort_order: 900, is_active: true, is_system: true },
]

const D = (i, naam, closedate, category_id, samenvatting) => ({
  deal_id: `dossier-${i}`, company_id: `co-${i}`, company_name: naam, dealname: naam,
  domain: 'voorbeeld.nl', closedate, churned_at: null, dealstage: '3504650455',
  churn_summary: samenvatting, category_id, category_confidence: 0.8, new_provider: null,
  user_note: null, user_note_updated_at: null, last_summarized_at: '2026-09-10T05:26:36.340Z',
  source_notes_count: 3, source_mails_count: 7, detected_at: null, updated_at: null, superseded: false,
})

// Achttien dossiers, net als op productie (18 niet-superseded rijen tegen 20
// beëindigde klantdeals — de twee die ontbreken zijn precies de achterstand die
// het bord hierboven meldt). Datums volgen de échte verliesmaanden.
const DOSSIER_TEKSTEN = [
  ['c4', 'Proef van twee maanden liep af zonder besluit; budget voor het komende jaar is elders belegd.'],
  ['c9', 'Geen notities of mails gevonden waaruit de reden blijkt — de agent kon niets vaststellen.'],
  ['c1', 'Koos in de laatste week van de proef voor een andere aanbieder; functionaliteit was doorslaggevend.'],
  ['c9', 'Contact liep dood na de eerste twee weken; geen reactie op drie opvolgmails.'],
  ['c2', 'Klaagde in twee gesprekken over de kwaliteit van de uitvoer; proef niet verlengd.'],
  ['c3', 'Miste een koppeling die voor het kantoorproces noodzakelijk was.'],
]
const DOSSIER_DATUMS = [
  '2026-09-09', '2026-09-02', '2026-07-28', '2026-07-22', '2026-07-14', '2026-07-06',
  '2026-06-30', '2026-05-28', '2026-05-20', '2026-05-11', '2026-05-04', '2026-04-24',
  '2026-04-15', '2026-04-02', '2026-02-19', '2026-02-05', '2025-12-22', '2025-12-31',
]
const DOSSIERS = DOSSIER_DATUMS.map((datum, i) => {
  const [cat, tekst] = DOSSIER_TEKSTEN[i % DOSSIER_TEKSTEN.length]
  return D(i + 1, `Kantoor ${i + 1} · plaatshouder`, datum, cat, tekst)
})

function result(tabel) {
  switch (tabel) {
    case 'v_d10_meta':                    return META
    case 'v_d10_kop':                     return KOP
    case 'v_d10_verlies_per_soort_maand': return MAANDREEKS
    case 'v_d10_redenen':                 return REDENEN
    case 'v_d10_verlengingskalender':     return VERLENGING
    case 'v_d10_proeven_lopend':          return PROEVEN
    case 'v_d10_verlies_records':         return []
    case 'events_annotaties':             return ANNOTATIES
    case 'churn_categories':              return CATEGORIEEN
    case 'churn_customers':               return DOSSIERS
    case 'agent_config':                  return null
    case 'hubspot_deals':                 return []
    default:                              return []
  }
}

// Minimale query-builder: genoeg voor useD10Verlies en useChurnData
// (select → eq/in/contains → order → maybeSingle). Elke stap geeft hetzelfde
// thenable terug.
function builder(tabel) {
  const payload = () => ({ data: result(tabel), error: null })
  const api = {
    select: () => api,
    order: () => api,
    limit: () => api,
    eq: () => api,
    in: () => api,
    contains: () => api,
    update: () => api,
    insert: () => api,
    delete: () => api,
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
  from: (tabel) => builder(tabel),
  rpc: async () => ({ data: null, error: null }),
  removeChannel: () => {},
}

// `useChurnData` hangt twéé `.on()`-handlers aan hetzelfde channel, dus de stub
// moet net als de echte helper zichzelf teruggeven. Een stub die na de eerste
// `.on()` alleen nog `subscribe` kent, laat de hele view stil wit renderen —
// React vangt de TypeError in de effect af en er verschijnt geen foutmelding.
export function createRealtimeChannel() {
  const kanaal = { on: () => kanaal, subscribe: () => kanaal, unsubscribe: () => {} }
  return kanaal
}
