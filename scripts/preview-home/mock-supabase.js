// Stub voor Home-preview (v1.179). Cijfers = zelfde peiling als D1/D9/D10-harnassen.
export const SUPABASE_URL = 'https://preview.invalid'
export const SUPABASE_ANON_KEY = 'preview'

const PEILDATUM = '2026-09-13T00:45:07.015Z'

const D1_META = {
  peildatum: PEILDATUM, minuten_oud: 11, mirror_verouderd: false, deals_zichtbaar: 108,
}
const AANVOER_KOP = {
  kennismakingen: 3, doel: 6, km_gemiddeld_4wk: 1.8,
  week_start: '2026-08-31', week_eind: '2026-09-06',
}
const PER_FASE = [
  { fase: '1', volgnummer: 1, aantal: 7 },
  { fase: '2', volgnummer: 2, aantal: 0 },
  { fase: '3', volgnummer: 3, aantal: 25 },
]
const BLOKKERS = { aantal: 0, noemer: 32, blind_voor: ['H2', 'H3', 'H4'], peildatum: PEILDATUM }
const D9_META = { peildatum: PEILDATUM, minuten_oud: 12 }
const D10_META = {
  peildatum: PEILDATUM, minuten_oud: 11, mirror_verouderd: false,
  deals_zichtbaar: 1138, proeven: 17,
}
const D10_KOP = [
  { soort: 'A', volgnummer: 1, deze_maand: 2, vorige_maand: 5, laatste_13_maanden: 57, churn_label: '' },
  { soort: 'B', volgnummer: 2, deze_maand: 2, vorige_maand: 0, laatste_13_maanden: 19, churn_label: 'telt niet als churn' },
  { soort: 'C', volgnummer: 3, deze_maand: 0, vorige_maand: 0, laatste_13_maanden: 1, churn_label: 'churn' },
]

function result(view) {
  switch (view) {
    case 'v_d1_meta': return D1_META
    case 'v_d1_aanvoer_kop': return AANVOER_KOP
    case 'v_d1_pipeline_per_fase': return PER_FASE
    case 'v_d9_forecast_blokkers': return BLOKKERS
    case 'v_d9_meta': return D9_META
    case 'v_d10_meta': return D10_META
    case 'v_d10_kop': return D10_KOP
    default: return []
  }
}

function builder(view) {
  const payload = () => ({ data: result(view), error: null, count: null })
  const api = {
    select: () => api,
    order: () => api,
    limit: () => api,
    eq: () => api,
    gte: () => api,
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
