// Stub voor lib/supabase in de preview-harness: de echte componenten mogen
// renderen zonder netwerk, sessie of Vault. Alleen wat de gebruikerspagina bij
// het renderen aanraakt.
export const SUPABASE_URL = 'https://preview.invalid'
export const SUPABASE_ANON_KEY = 'preview'

const noop = async () => ({ data: null, error: null })

export const supabase = {
  auth: {
    getUser: async () => ({ data: { user: { id: 'owner-1' } }, error: null }),
    getSession: async () => ({ data: { session: null }, error: null }),
  },
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: noop }), order: noop }),
    upsert: noop,
    update: () => ({ eq: noop }),
    insert: noop,
  }),
  rpc: noop,
  removeChannel: () => {},
}

export function createRealtimeChannel() {
  return { on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }
}
