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

// Edge Functions. Genoeg oppervlak om de compose-shots door de échte code te
// laten lopen: de taalcheck levert een gecorrigeerde tekst (zodat de track-
// changes-weergave echt gerenderd wordt, niet nagebouwd), de verbeteraar een
// geschreven mail, en `send_mail` geeft de blokkade terug die vandaag ook echt
// terugkomt — de Entra-grant mist Mail.Send. `?view=verstuur` schiet die shot.
function invokeStub(name, opts) {
  const body = opts?.body || {}
  if (name === 'taalcheck-v2') {
    return {
      ok: true,
      corrected: String(body.text || '')
        .replace(/Hoi/g, 'Beste')
        .replace(/ff/g, 'even')
        .replace(/mischien/g, 'misschien')
        .replace(/kan je/g, 'kun je')
        .replace(/laat maar weten/g, 'laat het me weten'),
    }
  }
  if (name === 'mail-verbeteraar') {
    return { ok: true, improved_mail: String(body.original_mail || ''), examples_used: 5 }
  }
  if (name === 'outlook-live' && body.action === 'send_mail') {
    return { ok: false, reason: 'mail_send_scope_missing', detail: 'preview' }
  }
  if (name === 'outlook-live' && body.action === 'create_draft') {
    return { ok: true, id: 'preview-draft' }
  }
  // v1.205: de drie Outlook-mutaties op de mail zelf. In de shots hoeven ze
  // alleen te slagen — de terugdraai-paden zijn geen designbeslissing.
  if (name === 'outlook-live' && body.action === 'mark_read') {
    return { ok: true, id: body.message_id, is_read: body.is_read !== false }
  }
  if (name === 'outlook-live' && body.action === 'move_message') {
    return { ok: true, id: body.message_id, moved_to: body.target_folder }
  }
  if (name === 'outlook-live' && body.action === 'set_pin') {
    return {
      ok: true, id: body.message_id, pinned: body.pinned !== false,
      pinned_at: new Date().toISOString(), props: ['SystemTime 0x6204'],
    }
  }
  // Concepten-tab: de echte view haalt ze live op bij outlook-live.
  return { ok: true, drafts: [] }
}

export const supabase = {
  auth: {
    getUser: async () => ({ data: { user: { id: '00000000-0000-4000-8000-000000000001' } }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  },
  from: (table) => builder(table),
  rpc: async () => ({ data: { ok: true }, error: null }),
  functions: { invoke: async (name, opts) => ({ data: invokeStub(name, opts), error: null }) },
  removeChannel: () => {},
  channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
}

export function createRealtimeChannel() {
  return { on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }
}
