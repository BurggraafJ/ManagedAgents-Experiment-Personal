// Stub voor lib/supabase in de preview-harness: de echte componenten mogen
// renderen zonder netwerk, sessie of Vault. Alleen wat de gebruikerspagina bij
// het renderen aanraakt.
export const SUPABASE_URL = 'https://preview.invalid'
export const SUPABASE_ANON_KEY = 'preview'

const noop = async () => ({ data: null, error: null })

// v1.198 (multi-user M2) — de fixtures voor de RPC's die de gebruikerspagina nu
// leest. Dezelfde vorm als prod, en de getallen zijn de gemeten stand van
// 2026-09-14: vier poorten dicht, nul open. `?rood=1` in de URL draait de
// eerste twee om, zodat de geblokkeerde toestand óók een shot krijgt — dat is
// de toestand waar de knop iets doet en juist die wil je kunnen bekijken.
const ROOD = new URLSearchParams(location.search).get('rood') === '1'

const POORTEN = [
  { sleutel: 'views_zonder_invoker', gemeten: ROOD ? 12 : 0, norm: 0, ok: !ROOD, blokkerend: true,
    uitleg: 'Views die als hun eigenaar draaien slaan de RLS van de tabel eronder over. Zolang er één zo\'n view leesbaar is voor een ingelogde gebruiker, ziet een member daar alles in.' },
  { sleutel: 'rpcs_zonder_poort', gemeten: ROOD ? 105 : 0, norm: 0, ok: !ROOD, blokkerend: true,
    uitleg: 'SECURITY DEFINER draait als postgres; RLS beschermt daar niets. Een functie zonder poort die authenticated mag aanroepen, geeft elke member wat zij teruggeeft.' },
  { sleutel: 'execute_voor_publiek', gemeten: 0, norm: 0, ok: true, blokkerend: true,
    uitleg: 'EXECUTE voor PUBLIC erft ook anon. Een revoke op de rollen zelf haalt die grant niet weg.' },
  { sleutel: 'storage_alleen_bucket', gemeten: 0, norm: 0, ok: true, blokkerend: true,
    uitleg: 'Een storage-policy die alleen op bucket_id test geeft de hele bucket aan iedereen die ingelogd is.' },
]

const RPC_FIXTURES = {
  invite_readiness: {
    gemeten_op: '2026-09-14T20:00:00Z',
    poorten: POORTEN,
    blokkerend: ROOD,
    persoon: null,
  },
  my_mailbox_state: {
    mag_postvak: true, gekoppeld: true, gepauzeerd: false, heeft_fout: false,
    laatste_sync: '2026-09-14T19:45:00Z', mails_gespiegeld: 17743,
  },
  my_capabilities: [],
}

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
  rpc: async (naam) => ({ data: RPC_FIXTURES[naam] ?? null, error: null }),
  removeChannel: () => {},
}

export function createRealtimeChannel() {
  return { on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }
}
