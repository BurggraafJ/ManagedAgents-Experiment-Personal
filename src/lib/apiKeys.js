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
  service_api: { label: 'Service API keys' },
  eigen_infra: { label: 'Eigen infrastructuur' },
  identifiers: { label: 'Identifiers' },
  null:        { label: 'Overig' },
}
export const CATEGORY_ORDER = ['service_api', 'eigen_infra', 'identifiers', null]

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
        category: 'service_api',
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
