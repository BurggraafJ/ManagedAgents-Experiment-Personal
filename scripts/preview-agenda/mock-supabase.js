// Stub voor de Agenda-preview (v1.183). De agenda-data komt uit mock-hooks.js;
// dit bestand vangt alleen de losse supabase-calls (useAutoDraft, sync-rpc).
//
// v1.203 — `useContactSuggestions` zoekt in twee échte tabellen
// (`outlook_contacts` en `calendar_attendees`), dus de stub moet die kunnen
// beantwoorden. Anders toont de preview een genodigden-veld dat nooit een
// suggestie geeft, en dan shot je een leeg menu in plaats van het menu.
//
// De vorm is met opzet dezelfde als in productie: één rij per (contact, adres)
// met `display_name`/`company_name` bij het adresboek en `name` bij de
// genodigden-historie. Een mock die andere veldnamen verzint verbergt precies
// de bug die je wilde zien — dezelfde les als `last_sync_at` in mock-hooks.js.
export const SUPABASE_URL = 'https://preview.invalid'
export const SUPABASE_ANON_KEY = 'preview'

const CONTACTS = [
  { email: 'r.vandijk@example.com', display_name: 'Ruben van Dijk', company_name: 'Van Dijk Advocaten' },
  { email: 'i.deruiter@example.com', display_name: 'Ilse de Ruiter', company_name: 'De Ruiter Notarissen' },
  { email: 'm.smits@example.com', display_name: 'Marieke Smits', company_name: 'Smits & Co' },
]
const SEEN = [
  { email: 's.bakker@example.com', name: 'Sanne Bakker', created_at: '2026-09-10T09:00:00Z' },
  { email: 'p.dirksen@example.com', name: 'Pieter Dirksen', created_at: '2026-09-04T09:00:00Z' },
  { email: 'l.vanderberg@example.com', name: 'Lotte van der Berg', created_at: '2026-08-28T09:00:00Z' },
]

/** `email.ilike.%ru%,display_name.ilike.%ru%` → "ru" */
function termOf(filter) {
  const m = String(filter || '').match(/ilike\.%([^%]*)%/)
  return (m ? m[1] : '').toLowerCase()
}

function rowsFor(table, term) {
  if (!term) return []
  const hit = (v) => String(v || '').toLowerCase().includes(term)
  if (table === 'outlook_contacts') return CONTACTS.filter((c) => hit(c.email) || hit(c.display_name))
  if (table === 'calendar_attendees') return SEEN.filter((c) => hit(c.email) || hit(c.name))
  return []
}

function builder(table) {
  let term = ''
  const payload = () => ({ data: rowsFor(table, term), error: null, count: null })
  const api = {
    select: () => api, order: () => api, limit: () => api, eq: () => api, in: () => api,
    gte: () => api, lte: () => api, neq: () => api, is: () => api, not: () => api,
    or: (f) => { term = termOf(f); return api },
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
  from: (table) => builder(table),
  rpc: async () => ({ data: null, error: null }),
  // useAgendaWrite roept dit alleen op een klik aan, maar een preview hoort niet
  // te kunnen crashen omdat iemand er per ongeluk één doet.
  functions: { invoke: async () => ({ data: { ok: true }, error: null }) },
  removeChannel: () => {},
}

export function createRealtimeChannel() {
  return { on() { return this }, subscribe: () => ({}) }
}
