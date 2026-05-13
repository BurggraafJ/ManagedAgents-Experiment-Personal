import { useState, useMemo, useEffect } from 'react'
import { useSupabaseQuery } from '../../../../../hooks/useSupabaseQuery'
import { CATEGORY_META, CATEGORY_ORDER, mergeRows } from '../../../../../lib/apiKeys'
import { SettingsPage } from '../../SettingsLayout'
import KeyRow from './KeyRow'
import EditModal from './EditModal'

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
    return merged.map(r => {
      const o = overrides[r.key_name]
      if (!o) return r
      const { _ts, ...patch } = o
      return { ...r, ...patch }
    })
  }, [secretsInventory, skillSecrets, overrides])

  const grouped = useMemo(() => {
    const map = {}
    for (const r of allRows) {
      const k = r.category ?? 'null'
      if (!map[k]) map[k] = []
      map[k].push(r)
    }
    return map
  }, [allRows])

  const total  = allRows.length
  const reds   = allRows.filter(r => r.status?.startsWith('red')).length
  const greens = allRows.filter(r => r.status === 'green_dashboard_only').length

  const [editing, setEditing] = useState(null)

  return (
    <SettingsPage
      title="API Keys"
      intro="Alle externe credentials en interne identifiers op één plek. Status, opslag-locatie en gebruik per skill."
      right={
        reds > 0
          ? <span className="sv2-pill sv2-pill--err"><span className="sv2-pill__dot" />{reds} vereisen aandacht</span>
          : <span className="sv2-pill sv2-pill--ok"><span className="sv2-pill__dot" />{greens} veilig · {total} totaal</span>
      }
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <span className="sv2-pill sv2-pill--ok"><span className="sv2-pill__dot" />{greens} veilig</span>
        {reds > 0 && <span className="sv2-pill sv2-pill--err"><span className="sv2-pill__dot" />{reds} roteren</span>}
        <span className="sv2-pill">{total} totaal</span>
      </div>

      {CATEGORY_ORDER.map(cat => {
        const rows = grouped[cat ?? 'null']
        if (!rows || rows.length === 0) return null
        const meta = CATEGORY_META[cat ?? 'null']
        return (
          <div key={cat ?? 'null'} style={{ marginBottom: 18 }}>
            <div className="sv2-kcat">{meta.label}</div>
            <div className="sv2-panel">
              <table className="sv2-table">
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
                  {rows.map(r => <KeyRow key={r.key_name} row={r} onEdit={() => setEditing(r)} />)}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

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
