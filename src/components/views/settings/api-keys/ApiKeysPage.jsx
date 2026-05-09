import { useState, useMemo, useEffect } from 'react'
import { SettingsPage } from '../SettingsLayout'
import { useSupabaseQuery } from '../../../../hooks/useSupabaseQuery'
import { CATEGORY_META, CATEGORY_ORDER, mergeRows } from '../../../../lib/apiKeys'
import Row from './Row'
import EditModal from './EditModal'

// ApiKeysPage — gemerge'de view die voorheen API Keys (SecretsInventory)
// + Skill Credentials (SkillSecrets) waren. Eén tabel, drie acties per
// rij: Roteer (link naar vendor + locatie eronder), Bewerk waarde, Toelichting
// (expand met purpose / used_by / storage_ref).
//
// Bewerk-waarde routing op storage_location:
//   - agent_config           → set_secret_value RPC
//   - vault (skill:NAME:KEY) → set_skill_secret RPC
//   - edge_function_secret   → handmatig in Supabase + mark_secret_rotated
//   - dashboard_only         → frontend env (geen edit-flow vanuit dashboard)
//   - composio_managed       → OAuth (ga naar Composio)

export default function ApiKeysPage() {
  // Refactor 07 — hook-migratie: page fetcht zelf de twee tabellen via
  // useSupabaseQuery (Refactor 04). Realtime aan voor live updates bij
  // rotatie/delete-acties op secrets.
  const { data: secretsInventory } = useSupabaseQuery('secrets_inventory', {
    orderBy: ['status', { ascending: true }],
    realtime: true,
  })
  const { data: skillSecrets } = useSupabaseQuery('skill_secrets_registry', {
    select: 'id,skill_name,secret_name,description,last_4,vault_secret_id,updated_at,updated_by,last_accessed_at,access_count,delete_protection',
    orderBy: ['skill_name', { ascending: true }],
    realtime: true,
  })

  // Optimistic overrides — laat elk save direct in de UI zien zonder te wachten
  // op de realtime-refetch. Wordt automatisch gewist zodra de echte data
  // hetzelfde is (5s reaper) of bij navigatie weg van de pagina.
  const [overrides, setOverrides] = useState({})
  const applyOverride = (keyName, patch) => {
    setOverrides(prev => ({ ...prev, [keyName]: { ...prev[keyName], ...patch, _ts: Date.now() } }))
  }

  // Reap stale overrides na 8s — tegen die tijd is realtime sowieso bij.
  useEffect(() => {
    const t = setInterval(() => {
      setOverrides(prev => {
        const cutoff = Date.now() - 8000
        const next = {}
        let changed = false
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
    for (const k in map) {
      map[k].sort((a, b) => {
        const order = { red_chat_just_received: 0, red_chat_legacy: 1, unset: 2, green_dashboard_only: 3, deprecated: 4 }
        const oa = order[a.status] ?? 5, ob = order[b.status] ?? 5
        if (oa !== ob) return oa - ob
        return (a.display_name || a.key_name || '').localeCompare(b.display_name || b.key_name || '')
      })
    }
    return map
  }, [allRows])

  const total  = allRows.length
  const reds   = allRows.filter(r => r.status?.startsWith('red')).length
  const greens = allRows.filter(r => r.status === 'green_dashboard_only').length

  const [editing, setEditing] = useState(null)
  const [expanded, setExpanded] = useState(null)

  return (
    <SettingsPage title="API Keys">
      <div className="api-keys__summary">
        <span className="api-keys__summary-pill" style={{ color: '#16a34a' }}>{greens}🟢 veilig</span>
        <span className="api-keys__summary-pill" style={{ color: '#dc2626' }}>{reds}🔴 roteren</span>
        <span className="api-keys__summary-pill muted">{total} totaal</span>
      </div>

      <div className="stack" style={{ gap: 'var(--s-5)' }}>
        {CATEGORY_ORDER.map(cat => {
          const rows = grouped[cat ?? 'null']
          if (!rows || rows.length === 0) return null
          const meta = CATEGORY_META[cat ?? 'null']
          return (
            <div key={cat ?? 'null'}>
              <div className="api-keys__cat-label">{meta.label}</div>
              <div className="card" style={{ padding: 0, overflow: 'auto' }}>
                <table className="api-keys__table">
                  <thead>
                    <tr>
                      <th style={{ width: 130 }}>Status</th>
                      <th>Naam</th>
                      <th style={{ width: 130 }}>Last 4</th>
                      <th style={{ width: 320, textAlign: 'right' }}>Acties</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <Row
                        key={r.key_name}
                        row={r}
                        expanded={expanded === r.key_name}
                        onToggle={() => setExpanded(expanded === r.key_name ? null : r.key_name)}
                        onEdit={() => setEditing(r)}
                        applyOverride={applyOverride}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}
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
