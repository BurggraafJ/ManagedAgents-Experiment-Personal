// Stub voor lib/supabase in de D1-preview-harness.
//
// Belangrijk: dit harnas draait de ECHTE hook (useD1Pipeline) en de ECHTE
// componenten; alleen de netwerklaag is vervangen. De cijfers hieronder zijn
// geen verzinsels maar de stand van de productie-mirror op 13-09-2026 00:04
// UTC, read-only gemeten via de Management API (peildatum in PEILDATUM). Zo
// toont de screenshot wat het bord op de dag van bouwen werkelijk zegt —
// inclusief het ongemak dat het critical number 3 van de 6 haalt en dat de
// dekkingskaart leeg blijft omdat het kwartaaldoel nergens staat.
//
// Deal- en eigenaarsnamen zijn met opzet neutrale plaatshouders: deze repo is
// publiek en een screenshot is een publicatie. Wat de lijst moet laten zien is
// de vórm — naam, reden, eigenaar, dagen, deeplink — niet wie erop staat.
export const SUPABASE_URL = 'https://preview.invalid'
export const SUPABASE_ANON_KEY = 'preview'

const PEILDATUM = '2026-09-13T00:04:08.854Z'

const META = {
  peildatum: PEILDATUM,
  minuten_oud: 11,
  mirror_verouderd: false,
  deals_zichtbaar: 108,
  open_deals: 32,
  closedate_leeg: 14,
  closedate_verlopen: 17,
  closedate_onbruikbaar: 31,
  verloren: 57,
  verloren_zonder_reden: 57,
  kennismaking_gevuld: 88,
  kennismaking_gepland: 1,
  sales_deals: 108,
  op_lijstprijs: 0,
  prop_beslisdatum: true,
  prop_kennismaking: true,
  prop_prijs: true,
  companies_zichtbaar: 5627,
  companies_met_veld: 1755,
  companies_met_omvang: 218,
  segment_bruikbaar: false,
  trend_vanaf: null,
  trend_dagen: 0,
}

const AANVOER_KOP = {
  doel: 6,
  doel_peildatum: '2026-09-12',
  doel_bron: 'Dashboarding 642449420 §3, SDR-map 635633696',
  week_label: '2026-W36',
  week_start: '2026-08-31',
  week_eind: '2026-09-06',
  kennismakingen: 3,
  nieuwe_deals: 0,
  kennismakingen_lopend: 2,
  kennismakingen_gepland: 0,
  nieuwe_deals_lopend: 1,
  km_4wk: 7,
  nieuw_4wk: 8,
  km_gemiddeld_4wk: 1.8,
  km_gevuld: 88,
  km_noemer: 108,
  peildatum: PEILDATUM,
}

// Twaalf weken, oud → nieuw. De laatste rij is de lopende week (W37) en die is
// dus onvolledig; het bord tekent hem daarom apart.
const AANVOER = [
  ['2026-06-22', '2026-W26', 0, 0], ['2026-06-29', '2026-W27', 1, 1],
  ['2026-07-06', '2026-W28', 0, 2], ['2026-07-13', '2026-W29', 1, 1],
  ['2026-07-20', '2026-W30', 1, 0], ['2026-07-27', '2026-W31', 1, 0],
  ['2026-08-03', '2026-W32', 0, 0], ['2026-08-10', '2026-W33', 2, 7],
  ['2026-08-17', '2026-W34', 1, 1], ['2026-08-24', '2026-W35', 1, 0],
  ['2026-08-31', '2026-W36', 3, 0], ['2026-09-07', '2026-W37', 2, 1],
].map(([week_start, week_label, kennismakingen, nieuwe_deals], i, arr) => {
  const eind = new Date(`${week_start}T00:00:00Z`)
  eind.setUTCDate(eind.getUTCDate() + 6)
  return {
    week_start, week_label, kennismakingen, nieuwe_deals,
    week_eind: eind.toISOString().slice(0, 10),
    kennismakingen_gepland: 0,
    is_huidige_week: i === arr.length - 1,
  }
})

const PER_FASE = [
  { fase: '1', fase_label: 'Fase 1 · Kennismaking', volgnummer: 1, aantal: 7, aantal_gewaardeerd: 6, aantal_volledig: 6, bodem_licenties: 55, plafond_licenties: 133, mrr_bodem: 9625, mrr_plafond: 23275, peildatum: PEILDATUM },
  { fase: '2', fase_label: 'Fase 2 · Offerte sturen', volgnummer: 2, aantal: 0, aantal_gewaardeerd: 0, aantal_volledig: 0, bodem_licenties: null, plafond_licenties: null, mrr_bodem: null, mrr_plafond: null, peildatum: PEILDATUM },
  { fase: '3', fase_label: 'Fase 3 · Offerte t/m overeenkomst', volgnummer: 3, aantal: 25, aantal_gewaardeerd: 22, aantal_volledig: 22, bodem_licenties: 123, plafond_licenties: 298, mrr_bodem: 21085, mrr_plafond: 51710, peildatum: PEILDATUM },
]

const DEKKING = {
  mrr_bodem: 21085, mrr_plafond: 51710, aantal: 25, aantal_gewaardeerd: 22,
  kwartaaldoel_mrr: null, doel_peildatum: '2026-08-12',
  doel_bron: 'Omzet & Doelen (Confluence 554762268)',
  dekkingsnorm: null, dekking_plafond: null, dekking_bodem: null,
  kwartaal_label: 'Q3 2026', kwartaal_eind: '2026-09-30', dagen_resterend: 17,
  reden: 'NOG NIET VASTGELEGD. Het kwartaaldoel staat handmatig op Omzet & Doelen met peildatum 12-08-2026.',
}

const WIN_RATE = [
  { basis: 'closedate_jaar', backburner: 'verloren', volgnummer: 1, hoofdhoek: true,  jaar: 2026, gewonnen: 3, verloren: 23, basis_n: 26, win_rate: 11.5, zonder_closedate: 26, populatie: 60 },
  { basis: 'closedate_jaar', backburner: 'buiten',   volgnummer: 2, hoofdhoek: false, jaar: 2026, gewonnen: 3, verloren: 11, basis_n: 14, win_rate: 21.4, zonder_closedate: 5,  populatie: 24 },
  { basis: 'alles',          backburner: 'verloren', volgnummer: 3, hoofdhoek: false, jaar: 2026, gewonnen: 3, verloren: 57, basis_n: 60, win_rate: 5.0,  zonder_closedate: 26, populatie: 60 },
  { basis: 'alles',          backburner: 'buiten',   volgnummer: 4, hoofdhoek: false, jaar: 2026, gewonnen: 3, verloren: 21, basis_n: 24, win_rate: 12.5, zonder_closedate: 5,  populatie: 24 },
]

const FC = (bucket, soort, maand_start, volgnummer, binnen_kwartaal, fasegroep, fase_volgnummer, aantal, bl, pl, mb, mp) => ({
  bucket, soort, maand_start, volgnummer, binnen_kwartaal,
  fasegroep, fase_volgnummer,
  fasegroep_label: fasegroep === 'f3' ? 'Fase 3 · offerte t/m overeenkomst' : 'Fase 1–2 · indicatief',
  aantal, aantal_gewaardeerd: aantal, bodem_licenties: bl, plafond_licenties: pl, mrr_bodem: mb, mrr_plafond: mp,
})

const FORECAST = [
  FC('2026-09', 'maand', '2026-09-01', 0, true,  'f3',  1, 7, 31, 75, 5425, 13125),
  FC('2026-09', 'maand', '2026-09-01', 0, true,  'f12', 2, 0, null, null, null, null),
  FC('2026-10', 'maand', '2026-10-01', 1, false, 'f3',  1, 4, 16, 32, 2360, 5160),
  FC('2026-10', 'maand', '2026-10-01', 1, false, 'f12', 2, 0, null, null, null, null),
  FC('2026-11', 'maand', '2026-11-01', 2, false, 'f3',  1, 7, 49, 139, 8575, 24325),
  FC('2026-11', 'maand', '2026-11-01', 2, false, 'f12', 2, 3, 30, 78, 5250, 13650),
  FC('2026-12', 'maand', '2026-12-01', 3, false, 'f3',  1, 3, 12, 22, 2100, 3850),
  FC('2026-12', 'maand', '2026-12-01', 3, false, 'f12', 2, 2, 10, 20, 1750, 3500),
  FC('later',   'later', null,         4, false, 'f3',  1, 2, 15, 30, 2625, 5250),
  FC('later',   'later', null,         4, false, 'f12', 2, 1, 15, 35, 2625, 6125),
  FC('geen',    'geen',  null,         5, false, 'f3',  1, 2, null, null, null, null),
  FC('geen',    'geen',  null,         5, false, 'f12', 2, 1, null, null, null, null),
]

const ONT = (snede, sleutel, label, volgnummer, aantal, gew, mb, mp, jong, oud) => ({
  snede, sleutel, label, volgnummer, aantal, aantal_gewaardeerd: gew,
  mrr_bodem: mb, mrr_plafond: mp, jongste_dagen: jong, oudste_dagen: oud,
})

const ONTLEDING = [
  ONT('fase', '1', 'Fase 1 · Kennismaking', 1, 7, 6, 9625, 23275, 24, 598),
  ONT('fase', '2', 'Fase 2 · Offerte sturen', 2, 0, 0, null, null, null, null),
  ONT('fase', '3', 'Fase 3 · Offerte t/m overeenkomst', 3, 25, 22, 21085, 51710, 11, 611),
  ONT('stage', 'appointmentscheduled', 'Kennismaking plaatsgevonden', 10, 7, 6, 9625, 23275, 24, 598),
  ONT('stage', '3206386936', 'Offerte gestuurd', 30, 6, 5, 4725, 13475, 11, 543),
  ONT('stage', '5732535537', 'In afwachting / onderhandeling', 31, 14, 13, 12790, 29240, 24, 611),
  ONT('stage', 'contractsent', 'Mondeling/mail/offerte akkoord', 32, 2, 1, 525, 875, 142, 311),
  ONT('stage', '4075158742', 'Licentieovereenkomst gestuurd', 33, 3, 3, 3045, 8120, 60, 388),
  ONT('eigenaar', 'o1', 'Sales A', 0, 24, 20, 18445, 42070, 11, 388),
  ONT('eigenaar', 'o2', 'Directie B', 0, 8, 8, 12265, 32915, 110, 611),
]

const WERKBORD_TELLERS = [
  { lijst: 'geen_next_step', lijst_label: 'Geen volgende stap', lijst_volgnummer: 1, aantal: 6, toelichting: 'Open deal zonder geplande volgende activiteit (of met een activiteit in het verleden) die langer open staat dan de drempel uit dash_parameters. Een deal zonder volgende stap beweegt niet.' },
  { lijst: 'verlopen_beslisdatum', lijst_label: 'Verlopen beslisdatum', lijst_volgnummer: 2, aantal: 0, toelichting: 'Open deal met een beslisdatum die al voorbij is. De datum is dan geen verwachting meer maar een herinnering.' },
  { lijst: 'fase3_zonder_velden', lijst_label: 'Fase 3 zonder velden', lijst_volgnummer: 3, aantal: 3, toelichting: 'Deal in fase 3 zonder beslisdatum, minimumafname of contractomvang — dezelfde definitie als hygiënecheck H2.' },
  { lijst: 'zonder_eigenaar', lijst_label: 'Zonder eigenaar', lijst_volgnummer: 4, aantal: 0, toelichting: 'Open deal zonder eigenaar, of met een eigenaar die niet (meer) actief in HubSpot staat.' },
]

const WB = (lijst, n, fase_label, eigenaar, beslisdatum, dagen, reden, mb, mp) => ({
  lijst, lijst_label: '', lijst_volgnummer: 1,
  deal_id: `${lijst}-${n}`, dealname: `Kantoor · voorbeeldrij ${n}`,
  fase: '3', fase_label, stage_label: fase_label,
  eigenaar, beslisdatum, next_step: null, dagen_open: dagen,
  bodem_lic: null, plafond_lic: null, mrr_bodem: mb, mrr_plafond: mp,
  hubspot_url: '#', reden,
})

const WERKBORD = [
  WB('geen_next_step', 1, 'Fase 3 · In afwachting / onderhandeling', 'Directie B', '2026-10-05', 611, 'geen volgende activiteit gepland', 1750, 3500),
  WB('geen_next_step', 2, 'Fase 3 · Offerte gestuurd', 'Directie B', '2026-11-02', 543, 'geen volgende activiteit gepland', 2625, 6125),
  WB('geen_next_step', 3, 'Fase 1 · Kennismaking', 'Directie B', '2026-11-16', 268, 'geen volgende activiteit gepland', 3500, 9100),
  WB('geen_next_step', 4, 'Fase 3 · Offerte gestuurd', 'Directie B', '2026-11-01', 173, 'geen volgende activiteit gepland', 875, 1750),
  WB('geen_next_step', 5, 'Fase 3 · Offerte gestuurd', 'Directie B', '2026-11-02', 110, 'geen volgende activiteit gepland', 1225, 3500),
  WB('geen_next_step', 6, 'Fase 3 · In afwachting / onderhandeling', 'Directie B', '2026-09-14', 110, 'geen volgende activiteit gepland', 1400, 2800),
  WB('fase3_zonder_velden', 7, 'Fase 3 · Mondeling akkoord', 'Sales A', '2026-09-14', 142, 'minimumafname · contractomvang ontbreekt', null, null),
  WB('fase3_zonder_velden', 8, 'Fase 3 · Offerte gestuurd', 'Sales A', null, 31, 'beslisdatum · minimumafname · contractomvang ontbreekt', null, null),
  WB('fase3_zonder_velden', 9, 'Fase 3 · In afwachting / onderhandeling', 'Sales A', null, 24, 'beslisdatum · minimumafname · contractomvang ontbreekt', null, null),
]

const BLOKKERS = { aantal: 9, noemer: 32, blind_voor: [], peildatum: PEILDATUM }

// ── v_d1_waarde — de 32 open deals achter de regels hierboven ────────────────
// Het detailpaneel leest deze view. De aantallen per emmer zijn exact die van
// FORECAST (f3 7·4·7·3·2·2 = 25, f1–2 0·0·3·2·1·1 = 7, samen 32 = PER_FASE) en
// de bedragen per emmer tellen exact op tot de bedragen van FORECAST. Dat is
// geen netheid maar de hele toets: liepen ze uiteen, dan zou de preview precies
// de fout verbergen waarvoor het paneel zijn "n van m getoond" heeft.
//
// Namen zijn neutrale plaatshouders — deze repo is publiek en een screenshot is
// een publicatie. Wat de lijst toont is de vórm, niet wie erop staat.
const verdeel = (totaal, n) => {
  if (totaal === null) return Array(n).fill(null)
  // Oplopende gewichten, laatste deal krijgt de rest: de som klopt altijd.
  const gewicht = Array.from({ length: n }, (_, i) => i + 1)
  const som = gewicht.reduce((a, b) => a + b, 0)
  const uit = gewicht.slice(0, -1).map(g => Math.round((totaal * g) / som / 5) * 5)
  return [...uit, totaal - uit.reduce((a, b) => a + b, 0)]
}

const EMMERS = [
  ['2026-09-14', 'f3', 7, 5425, 13125], ['2026-10-12', 'f3', 4, 2360, 5160],
  ['2026-11-09', 'f3', 7, 8575, 24325], ['2026-12-07', 'f3', 3, 2100, 3850],
  ['2027-02-01', 'f3', 2, 2625, 5250],  [null,         'f3', 2, null, null],
  ['2026-11-16', 'f12', 3, 5250, 13650], ['2026-12-14', 'f12', 2, 1750, 3500],
  ['2027-01-18', 'f12', 1, 2625, 6125],  [null,          'f12', 1, null, null],
]

let dealTeller = 0
const DEALS = EMMERS.flatMap(([beslisdatum, groep, n, bodem, plafond]) => {
  const bodems = verdeel(bodem, n)
  const plafonds = verdeel(plafond, n)
  return Array.from({ length: n }, (_, i) => {
    const nr = ++dealTeller
    // Acht van de 32 bij eigenaar B — dezelfde verhouding als ONTLEDING.
    const b = nr % 4 === 0
    return {
      deal_id: `d${nr}`,
      dealname: `Kantoor ${String(nr).padStart(2, '0')}`,
      fase: groep === 'f3' ? '3' : '1',
      fase_label: groep === 'f3' ? 'Fase 3 · Offerte t/m overeenkomst' : 'Fase 1 · Kennismaking',
      hubspot_owner_id: b ? 'o2' : 'o1',
      eigenaar: b ? 'Directie B' : 'Sales A',
      beslisdatum,
      mrr_bodem: bodems[i],
      mrr_plafond: plafonds[i],
      waardeerbaar: bodems[i] !== null,
      dagen_open: 11 + ((nr * 37) % 600),
      hubspot_url: '#',
    }
  })
})

function result(view) {
  switch (view) {
    case 'v_d1_meta':               return META
    case 'v_d1_aanvoer_kop':        return AANVOER_KOP
    case 'v_d1_aanvoer':            return AANVOER
    case 'v_d1_pipeline_per_fase':  return PER_FASE
    case 'v_d1_dekking':            return DEKKING
    case 'v_d1_win_rate':           return WIN_RATE
    case 'v_d1_forecast_per_maand': return FORECAST
    case 'v_d1_ontleding':          return ONTLEDING
    case 'v_d1_waarde':             return DEALS
    case 'v_d1_werkbord_tellers':   return WERKBORD_TELLERS
    case 'v_d1_werkbord':           return WERKBORD
    case 'v_d9_forecast_blokkers':  return BLOKKERS
    default:                        return []
  }
}

// Minimale query-builder: genoeg voor useD1Pipeline (select → order → limit →
// maybeSingle). Elke stap geeft hetzelfde thenable terug.
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
