// Stub voor lib/supabase in de D1-preview-harness.
//
// Dit harnas draait de ECHTE hook (useD1Pipeline) en de ECHTE componenten;
// alleen de netwerklaag is vervangen. De rijen in prod-2026-09-15.json zijn
// geen verzinsels: het is de uitkomst van migratie 20260915130000 op de
// productiemirror, gemeten op 2026-09-15 14:30 UTC via de Management API (in
// een teruggedraaide transactie, vóór de migratie werd toegepast). Zo toont
// de screenshot wat het bord op de dag van bouwen werkelijk zegt — inclusief
// het ongemak dat elke week onder het doel van 8 zit en dat zeven fase-3-deals
// geen fasedatum hebben.
//
// Wat wél is aangepast, en waarom: dealnamen zijn 'Kantoor NN' (Sales) en
// 'Kantoor LNN' (Lead-pipelines), eigenaren leeg, deal-ids d01…d46 / l01…l21,
// HubSpot-links '#'. Deze repo is publiek en een screenshot is een publicatie;
// wat de lijst moet laten zien is de vórm, niet wie erop staat. Tellingen,
// data, licenties, kanalen, banden en pipelinenamen zijn onaangeraakt.
//
// v1.215: `gepland` en `meta.kennismaking_gepland` komen uit migratie
// 20260915210000 (5 · 2 · 3 · 1 in de vier weken, 14 in totaal), en
// `aanvoerDeals` is er als aparte lijst bij gekomen — 45 Sales-rijen plus de
// 21 Lead-rijen die vóór deze migratie nergens op het bord stonden.
import prod from './prod-2026-09-15.json'

export const SUPABASE_URL = 'https://preview.invalid'
export const SUPABASE_ANON_KEY = 'preview'

const VIEWS = {
  v_d1_meta: prod.meta,
  v_d1_aanvoer_kop: prod.kop,
  v_d1_aanvoer: prod.aanvoer,
  v_d1_aanvoer_gepland: prod.gepland,
  v_d1_pipeline_per_fase: prod.fase,
  v_d1_fase_aging: prod.aging,
  v_d1_forecast_per_maand: prod.forecast,
  v_d1_beweging_week: prod.beweging,
  v_d1_kanaal: prod.kanaal,
  v_d1_kantoorgrootte: prod.grootte,
  v_d1_dekking: prod.dekking,
  v_d1_win_rate: [],
  v_d1_ontleding: [],
  v_d1_waarde: prod.deals,
  // De deals achter een weekstaaf (v1.215): de Sales-rijen plus de Lead-deals
  // uit de allowlist, met `pipeline_label` en `is_sales` per rij.
  v_d1_aanvoer_deals: prod.aanvoerDeals,
  v_d9_forecast_blokkers: prod.blokkers,
  // De pipeline waarop de telkaarten filteren; het label zoals HubSpot hem
  // noemt. Terugval voor een rij zonder eigen pipeline_label (v1.215).
  hubspot_pipelines: [{ pipeline_id: 'default', label: 'Sales Pipeline' }],
}

// Minimale query-builder: select → eq/gte/or → order → maybeSingle/then.
// De filters doen wat PostgREST zou doen op dezelfde kolommen, zodat de drie
// v_d1_waarde-queries van de hook (open · kennismaking-venster · beweging)
// elk hun eigen rijen krijgen.
function builder(view) {
  let rijen = [...(VIEWS[view] || [])]
  const api = {
    select: () => api,
    order: (col, { ascending = true } = {}) => {
      rijen.sort((a, b) => {
        const x = a[col], y = b[col]
        if (x === y) return 0
        if (x === null || x === undefined) return 1
        if (y === null || y === undefined) return -1
        return (x > y ? 1 : -1) * (ascending ? 1 : -1)
      })
      return api
    },
    limit: () => api,
    eq: (col, val) => { rijen = rijen.filter(r => r[col] === val); return api },
    gte: (col, val) => { rijen = rijen.filter(r => r[col] !== null && r[col] !== undefined && String(r[col]) >= String(val)); return api },
    lte: (col, val) => { rijen = rijen.filter(r => r[col] !== null && r[col] !== undefined && String(r[col]) <= String(val)); return api },
    or: (expr) => {
      const delen = expr.split(',').map(s => s.split('.'))
      rijen = rijen.filter(r => delen.some(([col, op, val]) => r[col] !== null && r[col] !== undefined && (op === 'gte' ? String(r[col]) >= val : String(r[col]) === val)))
      return api
    },
    maybeSingle: async () => ({ data: rijen[0] ?? null, error: null }),
    single: async () => ({ data: rijen[0] ?? null, error: null }),
    then: (res, rej) => Promise.resolve({ data: rijen, error: null }).then(res, rej),
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
  const ch = { on: () => ch, subscribe: () => ch }
  return ch
}
