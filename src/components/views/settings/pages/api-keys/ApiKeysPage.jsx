import { useState, useMemo, useEffect } from 'react'
import { useSupabaseQuery } from '../../../../../hooks/useSupabaseQuery'
import { CATEGORY_META, CATEGORY_ORDER, isHiddenKey, normalizeCategory, mergeRows } from '../../../../../lib/apiKeys'
import { SettingsPage } from '../../SettingsLayout'
import KeyRow from './KeyRow'
import EditModal from './EditModal'
import './api-keys-maestro.css'

// Voettekst onder de tabel — legt per tab uit wat je hier wél en niet ziet.
function categoryNote(tab, hasAnthropic) {
  switch (tab) {
    case 'token_providers':
      return hasAnthropic
        ? 'AI- en model-API’s. Grok stond eerder verborgen omdat zijn categorie (ai_provider) geen tab had.'
        : 'AI- en model-API’s. Grok stond eerder verborgen omdat zijn categorie (ai_provider) geen tab had. Anthropic staat nog niet in de Vault — de gestippelde rij blijft staan tot hij gezet is.'
    case 'composio':
      return 'API-key plus de identifiers die de mail- en agenda-ETL nodig heeft. De mail-sync-etl-v2-rijen zijn de Vault-waarden die de ETL leest; de inventory-rij ernaast wijst naar agent_config. De connectie zelf leg je op Connectors, niet hier.'
    case 'integraties':
      return 'Directe vendor-API’s voor de org-mirrors (HubSpot, Fireflies, Atlassian). Los van de per-gebruiker OAuth op Connectors.'
    case 'intern':
      return 'Eigen platform-auth, geen vendor-key. Vercel-, Supabase-management- en GitHub-token staan bewust niet op deze pagina — hun waarde blijft in de Vault, beheer loopt via Configuratie en Deployments.'
    default:
      return null
  }
}

/**
 * ApiKeysPage — alle credentials & identifiers op één plek.
 *
 * Merged secrets_inventory + skill_secrets_registry (via mergeRows in
 * lib/apiKeys.js). Optimistic overrides voor instant UI-feedback na save.
 *
 * Sub-componenten:
 *  - KeyRow:    één tabel-rij (status-pill, last4, used-by, acties)
 *  - EditModal: edit-flow voor vault skill-secrets + agent_config keys
 */
export default function ApiKeysPage() {
  const { data: secretsInventory } = useSupabaseQuery('secrets_inventory', {
    orderBy: ['status', { ascending: true }],
    realtime: true,
  })
  const { data: skillSecrets } = useSupabaseQuery('skill_secrets_registry', {
    select: 'id,skill_name,secret_name,description,last_4,vault_secret_id,updated_at,updated_by,last_accessed_at,access_count,delete_protection',
    orderBy: ['skill_name', { ascending: true }],
    realtime: true,
  })

  // Optimistic overrides — toon save-feedback direct in UI, reaper na 8s.
  const [overrides, setOverrides] = useState({})
  const applyOverride = (keyName, patch) => {
    setOverrides(prev => ({ ...prev, [keyName]: { ...prev[keyName], ...patch, _ts: Date.now() } }))
  }
  useEffect(() => {
    const t = setInterval(() => {
      setOverrides(prev => {
        const cutoff = Date.now() - 8000
        const next = {}; let changed = false
        for (const [k, v] of Object.entries(prev)) {
          if (v._ts >= cutoff) next[k] = v
          else changed = true
        }
        return changed ? next : prev
      })
    }, 4000)
    return () => clearInterval(t)
  }, [])

  const allRows = useMemo(() => {
    const merged = mergeRows(secretsInventory, skillSecrets)
    return merged
      .filter(r => !isHiddenKey(r))
      .map(r => {
        // normalizeCategory vertaalt de DB-categorieën (service_api /
        // eigen_infra / identifiers / ai_provider) naar de vier tabs.
        const row = { ...r, category: normalizeCategory(r) }
        const o = overrides[r.key_name]
        if (!o) return row
        const { _ts, ...patch } = o
        return { ...row, ...patch }
      })
  }, [secretsInventory, skillSecrets, overrides])

  const grouped = useMemo(() => {
    const map = {}
    for (const cat of CATEGORY_ORDER) map[cat] = []
    for (const r of allRows) {
      if (!map[r.category]) map[r.category] = []
      map[r.category].push(r)
    }
    return map
  }, [allRows])

  const total  = allRows.length
  const reds   = allRows.filter(r => r.status?.startsWith('red')).length
  const greens = allRows.filter(r => r.status === 'green_dashboard_only').length

  const [editing, setEditing] = useState(null)
  const [activeTab, setActiveTab] = useState('token_providers')

  // Anthropic staat in geen van beide tabellen (bekend V0-gat, AUDIT §4.2).
  // We tonen hem als gestippelde placeholder zodat zichtbaar is dát hij mist —
  // met een werkende Toevoegen-knop die via set_skill_secret de Vault vult.
  // Zodra de echte rij bestaat (inventory óf registry) valt de placeholder weg.
  const anthropicPlaceholder = useMemo(() => ({
    key_name: 'skill:anthropic:api_key',
    display_name: 'Anthropic',
    category: 'token_providers',
    status: 'unset',
    storage_location: 'vault',
    storage_ref: 'skill:anthropic:api_key',
    last_4: null,
    used_by: [],
    expires_at: null,
    purpose: 'Claude-calls vanuit Edge Functions (anthropic-fetch wrapper).',
    rotation_url: 'https://console.anthropic.com/settings/keys',
    isPlaceholder: true,
  }), [])

  const hasAnthropic = useMemo(
    () => allRows.some(r => /anthropic/i.test([r.key_name, r.storage_ref, r.skill_name].filter(Boolean).join(' '))),
    [allRows],
  )

  const activeRows = useMemo(() => {
    const rows = grouped[activeTab] || []
    if (activeTab === 'token_providers' && !hasAnthropic) {
      return [...rows, anthropicPlaceholder]
    }
    return rows
  }, [grouped, activeTab, hasAnthropic, anthropicPlaceholder])

  return (
    <SettingsPage
      title="API Keys"
      intro="Alle externe credentials en interne identifiers op één plek. Status, opslag-locatie en gebruik per skill."
      right={
        reds > 0
          ? <span className="set-pill set-pill--err"><span className="set-pill__dot" />{reds} vereisen aandacht</span>
          : <span className="set-pill set-pill--ok"><span className="set-pill__dot" />{greens} veilig · {total} totaal</span>
      }
    >
      <div className="ak-maestro">
        <div className="ak-summary">
          <span className="set-pill set-pill--ok"><span className="set-pill__dot" />{greens} veilig</span>
          {reds > 0 && <span className="set-pill set-pill--err"><span className="set-pill__dot" />{reds} roteren</span>}
          <span className="set-pill">{total} totaal</span>
        </div>

        <div className="ak-tabs">
          {CATEGORY_ORDER.map(cat => {
            const meta = CATEGORY_META[cat]
            const count = (grouped[cat] || []).length
              + (cat === 'token_providers' && !hasAnthropic ? 1 : 0)
            return (
              <button
                key={cat}
                className={`ak-tab ${activeTab === cat ? 'is-active' : ''}`}
                onClick={() => setActiveTab(cat)}
              >
                {meta.label}
                {count > 0 && <span className="ak-tab__count">{count}</span>}
              </button>
            )
          })}
        </div>

        <div className="set-panel">
          <table className="set-table ak-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Naam</th>
                <th>Opslag</th>
                <th>Last 4</th>
                <th>Gebruikt door</th>
                <th>Verloopt</th>
                <th className="is-right">Acties</th>
              </tr>
            </thead>
            <tbody>
              {activeRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="ak-empty">Geen keys in deze categorie.</td>
                </tr>
              )}
              {activeRows.map(r => (
                <KeyRow
                  key={r.key_name}
                  row={r}
                  onEdit={() => setEditing(r)}
                />
              ))}
            </tbody>
          </table>
          <div className="ak-note">{categoryNote(activeTab, hasAnthropic)}</div>
        </div>
      </div>

      {editing && (
        <EditModal
          row={allRows.find(r => r.key_name === editing.key_name) || editing}
          onClose={() => setEditing(null)}
          applyOverride={applyOverride}
        />
      )}
    </SettingsPage>
  )
}
