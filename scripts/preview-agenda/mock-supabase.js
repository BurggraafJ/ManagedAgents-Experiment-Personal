// Stub voor de Agenda-preview (v1.183). De agenda-data komt uit mock-hooks.js;
// dit bestand vangt alleen de losse supabase-calls (useAutoDraft, sync-rpc).
export const SUPABASE_URL = 'https://preview.invalid'
export const SUPABASE_ANON_KEY = 'preview'

function builder() {
  const payload = () => ({ data: [], error: null, count: null })
  const api = {
    select: () => api, order: () => api, limit: () => api, eq: () => api, in: () => api,
    gte: () => api, lte: () => api, neq: () => api, is: () => api, not: () => api,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (res, rej) => Promise.resolve(payload()).then(res, rej),
  }
  return api
}

export const supabase = {
  auth: {
    getUser: async () => ({ data: { user: { id: 'owner-1' } }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  },
  from: () => builder(),
  rpc: async () => ({ data: null, error: null }),
  // useAgendaWrite roept dit alleen op een klik aan, maar een preview hoort niet
  // te kunnen crashen omdat iemand er per ongeluk één doet.
  functions: { invoke: async () => ({ data: { ok: true }, error: null }) },
  removeChannel: () => {},
}

export function createRealtimeChannel() {
  return { on() { return this }, subscribe: () => ({}) }
}
