// Supabase-stub voor de Postvak-shots. Alleen de oppervlakte die de
// Postvak-hooks aanraken: de lijstdata komt uit de useAutoDraft-stub, hier
// staan de losse tabellen en RPC's die de view daarnaast nog bevraagt
// (snoozes, bucket-overrides, handtekening, Concepten uit outlook-live).
import { AUTODRAFT_MAILS, CATEGORIES } from './mock-data.js'

export const SUPABASE_URL = 'https://preview.invalid'
export const SUPABASE_ANON_KEY = 'preview'

function rowsFor(table) {
  switch (table) {
    case 'autodraft_categories': return CATEGORIES
    case 'autodraft_mails': return AUTODRAFT_MAILS
    case 'agent_config': return [{ config_value: 'Met vriendelijke groet,\nJelle Burggraaf' }]
    default: return []
  }
}

function builder(table) {
  const payload = () => ({ data: rowsFor(table), error: null, count: rowsFor(table).length })
  const one = () => ({ data: rowsFor(table)[0] ?? null, error: null })
  const api = {
    select: () => api, order: () => api, limit: () => api, range: () => api,
    eq: () => api, neq: () => api, in: () => api, or: () => api,
    gt: () => api, gte: () => api, lt: () => api, lte: () => api, is: () => api,
    maybeSingle: async () => one(),
    single: async () => one(),
    then: (res, rej) => Promise.resolve(payload()).then(res, rej),
  }
  return api
}

export const supabase = {
  auth: {
    getUser: async () => ({ data: { user: { id: '00000000-0000-4000-8000-000000000001' } }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  },
  from: (table) => builder(table),
  rpc: async () => ({ data: { ok: true }, error: null }),
  // Concepten-tab: de echte view haalt ze live op bij outlook-live. In de shot
  // blijft die tab bewust leeg — hij hoort niet bij deze PR.
  functions: { invoke: async () => ({ data: { ok: true, drafts: [] }, error: null }) },
  removeChannel: () => {},
  channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
}

export function createRealtimeChannel() {
  return { on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }
}
