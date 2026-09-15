// Supabase-stub voor de Taken-shots.
//
// Anders dan de meeste preview-stubs is deze niet alleen-lezen: `update()`
// schrijft écht in de in-memory rijen en houdt bij wat er is weggeschreven.
// Dat is het hele punt van de sleep-shots — een screenshot van een gekleurde
// rand bewijst niets, de regel `tasks t-01 → {"priority":"low"}` wel. De
// componenten lopen verder door hun eigen code: useTasks haalt op, de view
// rendert, en na de drop haalt useTasks hier de nieuwe waarde op.
import { TASKS, PROJECTS } from './mock-data.js'

export const SUPABASE_URL = 'https://preview.invalid'
export const SUPABASE_ANON_KEY = 'preview'

const store = { tasks: TASKS.map(t => ({ ...t })), task_projects: PROJECTS.map(p => ({ ...p })) }

// Wat er is weggeschreven, in volgorde. `window.__WRITES__` zodat het
// capture-script het ook zonder React kan uitlezen.
export const writes = []
if (typeof window !== 'undefined') window.__WRITES__ = writes

function rowsFor(table) { return store[table] || [] }

function builder(table) {
  const state = { op: 'select', patch: null, filters: [] }
  const rows = () => rowsFor(table).filter(r => state.filters.every(([k, v]) => r[k] === v))

  const run = () => {
    if (state.op === 'update') {
      const hit = rows()
      for (const r of hit) Object.assign(r, state.patch)
      writes.push({ table, ids: hit.map(r => r.id), patch: state.patch, at: new Date().toISOString() })
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('preview-write'))
      return { data: hit, error: null }
    }
    if (state.op === 'insert') {
      const row = { id: 'new-' + (store[table].length + 1), status: 'open', tags: [], ...state.patch }
      store[table].push(row)
      writes.push({ table, ids: [row.id], patch: state.patch, at: new Date().toISOString() })
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('preview-write'))
      return { data: [row], error: null }
    }
    return { data: rows(), error: null, count: rows().length }
  }

  const api = {
    select: () => api, order: () => api, limit: () => api, range: () => api,
    neq: () => api, in: () => api, or: () => api, gt: () => api, gte: () => api,
    lt: () => api, lte: () => api, is: () => api,
    eq: (k, v) => { state.filters.push([k, v]); return api },
    update: (patch) => { state.op = 'update'; state.patch = patch; return api },
    insert: (patch) => { state.op = 'insert'; state.patch = patch; return api },
    delete: () => { state.op = 'delete'; return api },
    maybeSingle: async () => ({ data: run().data?.[0] ?? null, error: null }),
    single: async () => ({ data: run().data?.[0] ?? null, error: null }),
    then: (res, rej) => Promise.resolve(run()).then(res, rej),
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
  functions: { invoke: async () => ({ data: { ok: true }, error: null }) },
  removeChannel: () => {},
  channel: () => channelStub(),
}

// useTasks hangt twee `.on()`-luisteraars achter elkaar; de stub moet dus
// zichzelf teruggeven en niet een object met alleen `subscribe`.
function channelStub() {
  const ch = { on: () => ch, subscribe: () => ch, unsubscribe: () => {} }
  return ch
}

export function createRealtimeChannel() {
  return channelStub()
}
