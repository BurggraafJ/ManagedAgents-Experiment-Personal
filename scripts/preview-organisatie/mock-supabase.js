// Stub voor de Organisatie-preview (v1.183): Platform (Config · Edge ·
// Database) en Pijplijn. Fixture-cijfers, geen peiling — dit zijn shots van
// de layout, niet van de stand van de database.
export const SUPABASE_URL = 'https://preview.invalid'
export const SUPABASE_ANON_KEY = 'preview'

const PEIL = new Date('2026-09-14T00:20:00Z')
const minAgo = (m) => new Date(PEIL.getTime() - m * 60000).toISOString()

const AGENT_RUNS = [
  ['mail-sync', 'success', 'delta: 4 nieuw, 0 fouten', 3],
  ['hubspot-sync', 'success', 'deals 1.246 · companies 2.011 · contacts 4.880', 11],
  ['hubspot-engagements-sync', 'success', '38 nieuwe engagements', 12],
  ['jira-sync', 'success', '4 boards · 6 issues bijgewerkt', 9],
  ['outlook-calendar-sync', 'success', '2 events gewijzigd', 7],
  ['fireflies-sync', 'warning', 'MCP traag (14 s) · 1 meeting', 41],
  ['contactpersonen-sync', 'success', 'seed 0 · firm-match 3', 1290],
  ['chunker', 'success', '61 chunks · 61 embeddings · 12.4k prefix-tokens', 4],
  ['chunker', 'success', '19 chunks · 19 embeddings', 9],
  ['chunker', 'success', '0 chunks (niets te doen)', 14],
  ['autodraft-rag-prefill', 'success', '5 bundels · gem. 11 chunks', 6],
  ['daily-admin', 'success', '3 voorstellen', 470],
  ['agenda', 'success', 'reistijd-buffers geherberekend', 33],
  ['mail-backfill', 'success', 'bucket 2025-03 klaar', 2900],
  ['rag-eval-cron', 'error', 'openai_429 op 3/36 items', 190],
  ['kb-curator', 'success', '2 artikelen bijgewerkt', 840],
].map(([agent_name, status, summary, m], i) => ({
  id: `run-${i}`, agent_name, status, summary,
  started_at: minAgo(m + 1), completed_at: minAgo(m),
  errors: null, stats: agent_name === 'chunker' ? { total_tokens: 12400, model: 'text-embedding-3-large' } : null,
}))

const COUNTS = {
  mail_messages: 48213, hubspot_deals: 1246, hubspot_companies: 2011, hubspot_contacts: 4880,
  hubspot_engagements: 27904, jira_issues: 1873, jira_projects: 4, fireflies_meetings: 212,
  calendar_events: 3410, calendar_attendees: 9120, contactpersonen: 6120, firms: 1180,
  context_bundles: 1462,
}
// Embedded-tellingen (filters .not('embedding','is',null) en zo): iets onder
// het totaal, zodat de dekkingsbalken iets laten zien.
const EMBEDDED = { mail_messages: 48190, hubspot_engagements: 27110, fireflies_meetings: 212, calendar_events: 3388 }

const ROWS = {
  mail_sync_state: [
    { folder_id: 'inbox', last_delta_at: minAgo(3), last_full_scan_at: minAgo(1440), last_error: null, total_messages_synced: 48213 },
    { folder_id: 'sent', last_delta_at: minAgo(4), last_full_scan_at: minAgo(1440), last_error: null, total_messages_synced: 12044 },
  ],
  mail_backfill_state: [
    ...Array.from({ length: 11 }, (_, i) => ({ status: 'done', messages_fetched: 4000, last_run_at: minAgo(2900), last_error: null })),
    { status: 'in_progress', messages_fetched: 1200, last_run_at: minAgo(60), last_error: null },
  ],
  hubspot_sync_state: { id: 1, last_delta_sync: minAgo(11), last_full_sync: minAgo(700), last_error: null },
  hubspot_engagements_sync_state: [{ engagement_type: 'all', last_delta_sync: minAgo(12), last_full_sync: minAgo(700), last_error: null }],
  hubspot_engagements_types: ['CALL', 'EMAIL', 'NOTE', 'TASK', 'MEETING'],
  jira_sync_state: { id: 1, last_delta_sync: minAgo(9), last_full_sync: minAgo(600), last_error: null },
  fireflies_action_items: Array.from({ length: 64 }, (_, i) => ({ id: i, is_for_jelle: i % 3 === 0, processed_at: i % 5 === 0 ? null : minAgo(500) })),
  fireflies_sync_state: { id: 1, last_delta_sync_at: minAgo(41), last_error: null },
  calendar_sync_state: { id: 1, last_delta_sync_at: minAgo(7), last_full_sync_at: minAgo(900), last_error: null },
  contactpersonen_types: ['klant', 'klant', 'partner', 'prospect', 'intern'],
  contactpersonen_sync_state: [{ source: 'nightly', last_delta_sync: minAgo(1290), total_synced: 6120, last_error: null }],
  v_intelligence_hub_summary: {
    chunks_per_source: [
      { source: 'mail', total: 51230 }, { source: 'engagement', total: 18760 }, { source: 'confluence', total: 4120 },
      { source: 'deal', total: 1246 }, { source: 'company', total: 2011 }, { source: 'contact', total: 4880 },
      { source: 'meeting', total: 1590 }, { source: 'event', total: 3390 }, { source: 'jira', total: 1873 },
    ],
    chunks_total: 89100, edges_count: 36420, resolutions_count: 5218,
    outcomes_summary: { total: 412, by_outcome: { accept: 286, amend: 71, reject: 55 }, avg_chunks: 9.4 },
    checked_at: PEIL.toISOString(),
  },
  context_bundles: [
    { bundle_id: 'b1', intent: 'draft_reply', audience: 'for_you', total_chunks: 12, build_ms: 840, created_at: minAgo(6), retrieval_meta: { strategy: 'hybrid_rrf' } },
    { bundle_id: 'b2', intent: 'search_fast', audience: null, total_chunks: 8, build_ms: 610, created_at: minAgo(18), retrieval_meta: { strategy: 'vector' } },
    { bundle_id: 'b3', intent: 'company_brief', audience: null, total_chunks: 14, build_ms: 1220, created_at: minAgo(52), retrieval_meta: { strategy: 'entity_1hop' } },
    { bundle_id: 'b4', intent: 'draft_reply', audience: 'not_for_you', total_chunks: 6, build_ms: 430, created_at: minAgo(90), retrieval_meta: { strategy: 'hybrid_rrf' } },
  ],
  agent_runs_health_7d: [],
  security_findings: [],
}

const SYNC_HEALTH = {
  mail:       { is_fresh: true,  age_minutes: 3,    source_count: 48213, last_sync_at: minAgo(3) },
  engagement: { is_fresh: true,  age_minutes: 12,   source_count: 27904, last_sync_at: minAgo(12) },
  deal:       { is_fresh: true,  age_minutes: 11,   source_count: 1246,  last_sync_at: minAgo(11) },
  jira:       { is_fresh: true,  age_minutes: 9,    source_count: 1873,  last_sync_at: minAgo(9) },
  calendar:   { is_fresh: true,  age_minutes: 7,    source_count: 3410,  last_sync_at: minAgo(7) },
  meeting:    { is_fresh: false, age_minutes: 41,   source_count: 212,   last_sync_at: minAgo(41) },
  confluence: { is_fresh: true,  age_minutes: 25,   source_count: 366,   last_sync_at: minAgo(25) },
  all_fresh: false, checked_at: PEIL.toISOString(),
}

function builder(table) {
  const st = { head: false, embedded: false, inAgents: null, limit: null, col: null }
  const rows = () => {
    if (table === 'agent_runs') {
      let r = AGENT_RUNS
      if (st.inAgents) r = r.filter(x => st.inAgents.includes(x.agent_name))
      return st.limit ? r.slice(0, st.limit) : r
    }
    if (table === 'hubspot_engagements' && st.col === 'engagement_type') return ROWS.hubspot_engagements_types.map(t => ({ engagement_type: t }))
    if (table === 'contactpersonen' && st.col === 'contact_type') return ROWS.contactpersonen_types.map(t => ({ contact_type: t }))
    const v = ROWS[table]
    if (Array.isArray(v)) return st.limit ? v.slice(0, st.limit) : v
    return v ? [v] : []
  }
  const count = () => (st.embedded ? EMBEDDED[table] : COUNTS[table]) ?? rows().length
  const payload = () => ({ data: st.head ? null : rows(), error: null, count: count() })
  const api = {
    select: (cols, opts) => { if (opts?.head) st.head = true; if (typeof cols === 'string' && !cols.includes(',') && cols !== '*') st.col = cols; return api },
    order: () => api, limit: (n) => { st.limit = n; return api }, eq: () => api, gte: () => api, lte: () => api,
    neq: () => api, is: () => api, or: () => api,
    not: (col) => { if (col === 'embedding') st.embedded = true; return api },
    in: (col, list) => { if (col === 'agent_name') st.inAgents = list; return api },
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    single: async () => ({ data: rows()[0] ?? null, error: null }),
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
  rpc: async (name) => {
    if (name === 'sync_health_all') return { data: SYNC_HEALTH, error: null }
    if (name === 'list_users_for_admin') return { data: [{ user_id: 'owner-1' }, { user_id: 'jay-1' }], error: null }
    return { data: null, error: null }
  },
  removeChannel: () => {},
}

export function createRealtimeChannel() {
  return { on() { return this }, subscribe: () => ({}) }
}
