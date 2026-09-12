// Pure helpers + constants voor ApiKeysPage. Geen React/Supabase.

export const STATUS_META = {
  red_chat_legacy:        { color: '#dc2626', label: '🔴 Legacy', hint: 'Ooit via chat geleverd in vorige sessies' },
  red_chat_just_received: { color: '#dc2626', label: '🔴 Net via chat', hint: 'Recent in chat geplakt — direct rotatie aanbevolen' },
  green_dashboard_only:   { color: '#16a34a', label: '🟢 Veilig', hint: 'Alleen via dashboard ingesteld' },
  unset:                  { color: '#94a3b8', label: '⚪ Unset', hint: 'Nog niet geconfigureerd' },
  deprecated:             { color: '#94a3b8', label: '⊘ Deprecated', hint: 'Niet meer in gebruik' },
}

export const STORAGE_LABEL = {
  vault:                'Postgres Vault',
  agent_config:         'agent_config',
  edge_function_secret: 'Edge Function secret',
  dashboard_only:       'Frontend env',
  composio_managed:     'Composio (OAuth)',
  not_stored:           'Niet opgeslagen',
  deprecated:           'Niet meer in gebruik',
}

export const CATEGORY_META = {
  token_providers: { label: 'Token providers' },
  composio:        { label: 'Composio' },
  integraties:     { label: 'Integraties' },
  intern:          { label: 'Intern' },
}
export const CATEGORY_ORDER = ['token_providers', 'composio', 'integraties', 'intern']

// De DB (secrets_inventory.category) kent deze vier tabs niet: daar staan nog
// service_api / eigen_infra / identifiers / ai_provider. Zonder vertaling is
// grouped[tab] leeg en toont de pagina niets. Vertalen doen we in drie stappen,
// van hard naar zacht — zo verdwijnt een rij nooit stilletjes uit de UI:
//   1. KEY_CATEGORY   — expliciete verdeling per key_name (AUDIT §3, akkoord Jelle)
//   2. naam-patroon   — nieuwe keys die nog niet in de lijst staan
//   3. legacy-category — laatste redmiddel voor de oude DB-waarden
export const KEY_CATEGORY = {
  openai_embedding_key:           'token_providers',
  openai_whisper_key:             'token_providers',
  legal_ai_research_grok_api_key: 'token_providers',
  composio_api_key:               'composio',
  composio_user_id:               'composio',
  composio_outlook_connection_id: 'composio',
  hubspot_truth_access_token:     'integraties',
  fireflies_api_key:              'integraties',
  atlassian_api_token:            'integraties',
  atlassian_email:                'integraties',
  cron_secret:                    'intern',
  changelog_token:                'intern',
}

const NAME_CATEGORY = [
  [/composio/i,                                              'composio'],
  [/openai|anthropic|claude|grok|xai|cohere|whisper|embedding|gemini|mistral/i, 'token_providers'],
  [/hubspot|fireflies|atlassian|jira|confluence|outlook|graph|slack|plaud/i,    'integraties'],
  [/cron|changelog|service_role|dashboard_refresh/i,         'intern'],
]

const LEGACY_CATEGORY = {
  ai_provider: 'token_providers',
  service_api: 'integraties',
  identifiers: 'integraties',
  eigen_infra: 'intern',
}

// Geeft altijd één van CATEGORY_ORDER terug — nooit undefined, nooit een
// waarde waar geen tab voor bestaat.
export function normalizeCategory(row) {
  if (!row) return 'intern'
  const byKey = KEY_CATEGORY[row.key_name]
  if (byKey) return byKey

  const haystack = [row.key_name, row.storage_ref, row.secret_name, row.skill_name, row.display_name]
    .filter(Boolean).join(' ')
  for (const [re, cat] of NAME_CATEGORY) {
    if (re.test(haystack)) return cat
  }

  const legacy = LEGACY_CATEGORY[row.category]
  if (legacy) return legacy
  return CATEGORY_META[row.category] ? row.category : 'intern'
}

// Keys die NIET in de UI getoond worden (maar blijven in inventory + Vault).
// Let op: we matchen op substring over key_name / storage_ref / secret_name,
// niet op exacte key_name. De Maps-key bestaat namelijk alleen nog als
// registry-wees en heet dan `skill:global:google_maps_api_key` — een exacte
// match op 'google_maps' mist die, en dan staat hij er tóch.
export const HIDDEN_KEYS = new Set([
  'vercel_token',
  'supabase_management_token',
  'github_token',
  'google_maps',
])

export function isHiddenKey(row) {
  if (!row) return false
  const haystack = [row.key_name, row.storage_ref, row.secret_name]
    .filter(Boolean).join(' ').toLowerCase()
  for (const slug of HIDDEN_KEYS) {
    if (haystack.includes(slug)) return true
  }
  return false
}

// Provider-mark (optie A "Rust"): gekleurd vierkantje met initialen naast de
// naam. Puur cosmetisch — een onbekende provider krijgt het neutrale intern-mark.
const PROVIDER_MARKS = [
  [/openai|whisper|embedding/i, { tone: 'openai',    initials: 'OA' }],
  [/anthropic|claude/i,         { tone: 'anthropic', initials: 'An' }],
  [/grok|xai/i,                 { tone: 'xai',       initials: 'xAI' }],
  [/composio/i,                 { tone: 'composio',  initials: 'Co' }],
  [/hubspot/i,                  { tone: 'hubspot',   initials: 'HS' }],
  [/fireflies/i,                { tone: 'fireflies', initials: 'FF' }],
  [/atlassian|jira|confluence/i,{ tone: 'atlassian', initials: 'At' }],
  [/cohere/i,                   { tone: 'cohere',    initials: 'Co' }],
]

export function providerMark(row) {
  const haystack = [row?.key_name, row?.display_name, row?.storage_ref].filter(Boolean).join(' ')
  for (const [re, mark] of PROVIDER_MARKS) {
    if (re.test(haystack)) return mark
  }
  const words = String(row?.display_name || row?.key_name || '?')
    .replace(/[^\p{L}\p{N} _-]/gu, ' ').split(/[\s_-]+/).filter(Boolean)
  const initials = (words[0]?.[0] || '?') + (words[1]?.[0] || '')
  return { tone: 'intern', initials: initials.toUpperCase() }
}

export const EXPIRY_TONE_COLOR = {
  ok:      '#16a34a',
  warn:    '#d97706',
  crit:    '#dc2626',
  expired: '#dc2626',
}

// Map vendor-host → vriendelijke locatie-naam onder de Roteer-knop
export function rotationLocation(url) {
  if (!url) return null
  try {
    const host = new URL(url).host.replace(/^www\./, '')
    const map = {
      'app.composio.dev':            'Composio dashboard',
      'platform.openai.com':         'OpenAI platform',
      'app.hubspot.com':             'HubSpot dashboard',
      'id.atlassian.com':            'Atlassian id',
      'github.com':                  'GitHub settings',
      'vercel.com':                  'Vercel dashboard',
      'supabase.com':                'Supabase dashboard',
      'app.fireflies.ai':            'Fireflies dashboard',
      'console.anthropic.com':       'Anthropic console',
      'console.cloud.google.com':    'Google Cloud',
    }
    return map[host] || host
  } catch {
    return null
  }
}

// Merge: skillSecrets-rows die NIET als inventory-row aanwezig zijn,
// projecteren we als pseudo-inventory-rij zodat ze ook in dezelfde tabel
// verschijnen. Tegelijkertijd back-annoteren we registry-velden
// (last_accessed_at, access_count, delete_protection) op echte inventory-rows
// die naar Vault wijzen, zodat de UI ze als één rij kan tonen.
export function mergeRows(secretsInventory, skillSecrets) {
  const skBy = new Map()
  for (const sk of (skillSecrets || [])) {
    skBy.set(`skill:${sk.skill_name}:${sk.secret_name}`, sk)
  }

  const inv = (secretsInventory || []).map(r => {
    if (r.storage_ref && r.storage_ref.startsWith('skill:')) {
      const sk = skBy.get(r.storage_ref)
      if (sk) {
        return {
          ...r,
          skill_name: sk.skill_name,
          secret_name: sk.secret_name,
          last_accessed_at: sk.last_accessed_at,
          access_count: sk.access_count,
          delete_protection: sk.delete_protection,
        }
      }
    }
    return r
  })

  const knownVaultRefs = new Set(
    inv.filter(r => r.storage_ref?.startsWith('skill:')).map(r => r.storage_ref),
  )
  for (const sk of (skillSecrets || [])) {
    const ref = `skill:${sk.skill_name}:${sk.secret_name}`
    if (!knownVaultRefs.has(ref)) {
      inv.push({
        key_name: ref,
        display_name: `${sk.skill_name} · ${sk.secret_name}`,
        // Geen verzonnen categorie: normalizeCategory kiest de tab op naam.
        category: null,
        status: sk.vault_secret_id ? 'green_dashboard_only' : 'unset',
        storage_location: 'vault',
        storage_ref: ref,
        last_4: sk.last_4,
        used_by: [sk.skill_name],
        purpose: sk.description || null,
        rotation_url: null,
        last_status_change_at: sk.updated_at,
        last_status_change_by: sk.updated_by,
        skill_name: sk.skill_name,
        secret_name: sk.secret_name,
        last_accessed_at: sk.last_accessed_at,
        access_count: sk.access_count,
        delete_protection: sk.delete_protection,
      })
    }
  }
  return inv
}

// Format relative time like "2u geleden", "3d geleden", "—" if null.
export function formatRelative(iso) {
  if (!iso) return null
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  if (diffMs < 0) return d.toLocaleDateString('nl-NL')
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return 'net'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m geleden`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}u geleden`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d geleden`
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Compute expiry-status: { tone: 'ok'|'warn'|'crit'|'expired', label, daysLeft }
export function expiryStatus(iso) {
  if (!iso) return null
  const d = new Date(iso)
  const days = Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  if (days < 0)  return { tone: 'expired', label: `Verlopen (${-days}d geleden)`, daysLeft: days }
  if (days <= 7)  return { tone: 'crit', label: `Nog ${days}d`, daysLeft: days }
  if (days <= 30) return { tone: 'warn', label: `Nog ${days}d`, daysLeft: days }
  return { tone: 'ok', label: `${d.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' })}`, daysLeft: days }
}
