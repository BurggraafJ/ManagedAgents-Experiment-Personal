// Stub voor de Analyse-preview (v1.226). Eén bewaard gesprek in
// rag_chat_sessions, drie voorkeuren-rijen, geen netwerk. Namen zijn de
// design-placeholders (Kantoor Foxtrot/Golf) — de repo is publiek.
export const SUPABASE_URL = 'https://preview.invalid'
export const SUPABASE_ANON_KEY = 'preview'

export const PREVIEW_SESSION_ID = '7c1e4b2a-5d3f-4a9e-8b6c-0f1a2b3c4d5e'
const OTHER_SESSION_ID = 'a4f0c9d8-1b2e-4f3a-9c8d-7e6f5a4b3c2d'

const T0 = Date.parse('2026-09-16T08:12:00Z')
const SESSION_MESSAGES = [
  { role: 'user', content: 'Welke deals zijn de afgelopen 30 dagen niet van fase veranderd?', ts: T0 },
  {
    role: 'assistant', ts: T0 + 1, run_id: 'run-preview-1', run_state: 'done',
    user_message: 'Welke deals zijn de afgelopen 30 dagen niet van fase veranderd?',
    content: [
      'Drie deals in de Sales Pipeline staan langer dan 30 dagen in dezelfde fase [bron #1]:',
      '',
      '| Deal | Fase | Dagen stil | Laatste contact |',
      '|---|---|---|---|',
      '| Kantoor Foxtrot · licentie 12 | Voorstel verzonden | 41 | 4 sep — mail over ingangsdatum [bron #2] |',
      '| Kantoor Golf · pilot | Demo gepland | 33 | 12 aug — notitie na kennismaking [bron #3] |',
      '| Kantoor Hotel · uitbreiding | Onderhandeling | 31 | 15 aug — mail over SLA-bijlage [bron #1] |',
      '',
      'Bij Foxtrot wacht de klant op een antwoord over de ingangsdatum; bij Golf staat de demo nog niet in de agenda.',
    ].join('\n'),
    citations: [
      { n: 1, source: 'deal', id: 'd-1', subject: 'Sales Pipeline · fasehistorie', occurred_at: '2026-09-16T08:00:00Z', preview: 'dealstage: Voorstel verzonden sinds 2026-08-06' },
      { n: 2, source: 'mail', id: 'm-1', subject: 'Re: ingangsdatum licentie', from_name: 'Kantoor Foxtrot', occurred_at: '2026-09-04T09:30:00Z', preview: 'Kunnen we de ingangsdatum verschuiven naar 1 oktober?' },
      { n: 3, source: 'engagement', id: 'e-1', subject: 'Notitie kennismaking', from_name: 'Jelle', occurred_at: '2026-08-12T14:00:00Z', preview: 'Demo plannen zodra de partner terug is van vakantie.' },
    ],
    model: 'claude-sonnet-5', timing_ms: { total: 14200 },
    tokens: { chat_in: 6120, chat_out: 410 },
    steps: [],
  },
  { role: 'user', content: 'Wat was het laatste contactmoment met Kantoor Foxtrot?', ts: T0 + 60000 },
  {
    role: 'assistant', ts: T0 + 60001, run_id: 'run-preview-2', run_state: 'done',
    user_message: 'Wat was het laatste contactmoment met Kantoor Foxtrot?',
    content: 'Het laatste contactmoment is de mail van **4 september** waarin Kantoor Foxtrot vraagt of de ingangsdatum naar 1 oktober kan [bron #1]. Daar is nog niet op geantwoord; er staat geen latere notitie of afspraak.',
    citations: [
      { n: 1, source: 'mail', id: 'm-1', subject: 'Re: ingangsdatum licentie', from_name: 'Kantoor Foxtrot', occurred_at: '2026-09-04T09:30:00Z', preview: 'Kunnen we de ingangsdatum verschuiven naar 1 oktober?' },
    ],
    model: 'claude-sonnet-5', timing_ms: { total: 6800 },
    tokens: { chat_in: 3100, chat_out: 120 },
    steps: [],
  },
]

const SESSIONS = [
  { id: PREVIEW_SESSION_ID, title: 'Welke deals zijn de afgelopen 30 dagen niet van fase veranderd?', message_count: 4, updated_at: '2026-09-16T08:13:10Z', created_at: '2026-09-16T08:12:00Z' },
  { id: OTHER_SESSION_ID, title: 'Wat is er in mijn meetings van vorige week besloten?', message_count: 2, updated_at: '2026-09-15T16:40:00Z', created_at: '2026-09-15T16:38:00Z' },
]

const STYLES = [
  { category: 'style', slug: 'kort', label: 'Kort', description: '', is_default: true, sort_order: 1 },
  { category: 'style', slug: 'uitgebreid', label: 'Uitgebreid', description: '', is_default: false, sort_order: 2 },
  { category: 'tone', slug: 'zakelijk', label: 'Zakelijk', description: '', is_default: true, sort_order: 3 },
  { category: 'focus', slug: 'feiten', label: 'Feiten', description: '', is_default: true, sort_order: 4 },
]

function builder(table) {
  const state = { single: false, eqId: null }
  const rows = () => {
    if (table === 'rag_chat_sessions') {
      if (state.single) return state.eqId === PREVIEW_SESSION_ID ? { id: PREVIEW_SESSION_ID, messages: SESSION_MESSAGES } : null
      return SESSIONS
    }
    if (table === 'rag_chat_writing_styles') return STYLES
    return state.single ? null : []
  }
  const payload = () => ({ data: rows(), error: null, count: null })
  const api = {
    select: () => api,
    order: () => api,
    limit: () => api,
    in: () => api,
    gte: () => api,
    lte: () => api,
    ilike: () => api,
    eq: (col, val) => { if (col === 'id') state.eqId = val; return api },
    update: () => api,
    insert: () => api,
    delete: () => api,
    maybeSingle: () => { state.single = true; return api },
    single: () => { state.single = true; return api },
    then: (res, rej) => Promise.resolve(payload()).then(res, rej),
  }
  return api
}

export const supabase = {
  auth: {
    getUser: async () => ({ data: { user: { id: 'owner-1' } }, error: null }),
    getSession: async () => ({ data: { session: { access_token: 'preview' } }, error: null }),
  },
  from: (table) => builder(table),
  rpc: async () => ({ data: null, error: null }),
  removeChannel: () => {},
}

// Ketenbaar: .on().on().subscribe() — een stub die zichzelf teruggeeft, anders
// een blanco shot (geheugen preview-harness-stub-and-real-gestures).
export function createRealtimeChannel() {
  const ch = { on: () => ch, subscribe: () => ch, unsubscribe: () => ch }
  return ch
}
