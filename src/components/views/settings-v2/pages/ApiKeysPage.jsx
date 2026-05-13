import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../../../../lib/supabase'
import { useSupabaseQuery } from '../../../../hooks/useSupabaseQuery'
import {
  STATUS_META, STORAGE_LABEL, CATEGORY_META, CATEGORY_ORDER,
  EXPIRY_TONE_COLOR, rotationLocation, expiryStatus, formatRelative,
  mergeRows,
} from '../../../../lib/apiKeys'
import { SettingsV2Page } from '../SettingsV2Layout'

/**
 * ApiKeysPage (v2) — alle credentials & identifiers op één plek.
 * Werkende edit-modal voor vault skill-secrets en agent_config keys.
 * Edge-fn-secrets en composio-managed zijn read-only met uitleg.
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
    <SettingsV2Page
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
    </SettingsV2Page>
  )
}

function KeyRow({ row, onEdit }) {
  const meta = STATUS_META[row.status] || STATUS_META.unset
  const isDeprecated = row.status === 'deprecated'
  const rotLoc = rotationLocation(row.rotation_url)
  const usedBy = row.used_by || []
  const exp = expiryStatus(row.expires_at)
  const isVault = row.storage_location === 'vault' && row.storage_ref?.startsWith('skill:')
  const statusTone =
    row.status?.startsWith('red')        ? 'err' :
    row.status === 'green_dashboard_only' ? 'ok'  :
    row.status === 'deprecated'           ? 'info' : 'warn'

  return (
    <tr>
      <td>
        <span className={`sv2-stat sv2-stat--${statusTone}`} title={meta.hint}>
          <span className="sv2-stat__dot" />
          {meta.label.replace(/^[^\w]+/, '').trim() || meta.label}
        </span>
      </td>
      <td>
        <div className="sv2-cell-name">{row.display_name || row.key_name}</div>
        <div className="sv2-cell-sub">{row.key_name}</div>
      </td>
      <td><span className="sv2-pill">{STORAGE_LABEL[row.storage_location] || row.storage_location}</span></td>
      <td>
        {row.last_4
          ? <code style={{ fontFamily: 'var(--sv-font-mono)', fontSize: 12, background: 'var(--sv-paper-2)', border: '1px solid var(--sv-border-soft)', padding: '2px 7px', borderRadius: 5 }}>··{row.last_4}</code>
          : <span style={{ color: 'var(--sv-n-400)' }}>—</span>}
      </td>
      <td>
        {usedBy.length > 0 ? (
          <div className="sv2-chip-stack">
            {usedBy.slice(0, 3).map(u => <span key={u} className="sv2-chip">{u}</span>)}
            {usedBy.length > 3 && <span className="sv2-chip">+{usedBy.length - 3}</span>}
          </div>
        ) : <span style={{ color: 'var(--sv-n-400)' }}>—</span>}
      </td>
      <td>
        {exp
          ? <span className={`sv2-stat sv2-stat--${exp.tone === 'expired' || exp.tone === 'crit' ? 'err' : exp.tone === 'warn' ? 'warn' : 'ok'}`}>
              <span className="sv2-stat__dot" />{exp.label}
            </span>
          : (row.expires_at
              ? <span className="sv2-cell-mono" style={{ color: 'var(--sv-n-500)' }}>{new Date(row.expires_at).toLocaleDateString('nl-NL')}</span>
              : <span style={{ color: 'var(--sv-n-400)', fontSize: 12 }}>geen vervaldag</span>)}
      </td>
      <td className="is-right">
        {!isDeprecated && (
          <div className="sv2-row-actions">
            {row.rotation_url ? (
              <a href={row.rotation_url} target="_blank" rel="noopener noreferrer" className="sv2-btn sv2-btn--ghost sv2-btn--sm" title={rotLoc ? `Open ${rotLoc}` : 'Open vendor-dashboard'}>
                ↗ Roteer
              </a>
            ) : null}
            <button type="button" className="sv2-btn sv2-btn--primary sv2-btn--sm" onClick={onEdit}>
              Bewerk
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

function EditModal({ row, onClose, applyOverride }) {
  const [value, setValue] = useState('')
  const [description, setDescription] = useState(row.purpose && row.purpose !== '— niet ingevuld —' ? row.purpose : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [savedLast4, setSavedLast4] = useState(null)

  const isVaultSkill = row.storage_location === 'vault' && row.storage_ref?.startsWith('skill:')
  const isAgentConfig = row.storage_location === 'agent_config'
  const isEdgeFn = row.storage_location === 'edge_function_secret'
  const isComposio = row.storage_location === 'composio_managed'
  const cannotEdit = isComposio || (!isVaultSkill && !isAgentConfig && !isEdgeFn)

  async function onSave() {
    if (!value.trim()) { setErr('Waarde mag niet leeg zijn'); return }
    setBusy(true); setErr(null)
    try {
      const trimmed = value.trim()
      const last4 = trimmed.slice(-4)
      let result
      if (isVaultSkill) {
        const parts = row.storage_ref.split(':')
        result = await supabase.rpc('set_skill_secret', {
          p_skill_name: parts[1],
          p_secret_name: parts.slice(2).join(':'),
          p_plaintext: trimmed,
          p_description: description || null,
          p_updated_by: 'dashboard',
        })
      } else if (isAgentConfig) {
        result = await supabase.rpc('set_secret_value', {
          p_key_name: row.key_name,
          p_plaintext: trimmed,
        })
      } else {
        setErr('Edge function secrets handmatig instellen in Supabase, daarna hier markeren.')
        setBusy(false); return
      }
      if (result.error) { setErr(result.error.message); setBusy(false); return }
      if (result.data && result.data.ok === false) {
        setErr(result.data.hint || result.data.reason || 'opslaan mislukt'); setBusy(false); return
      }
      try {
        await supabase.rpc('mark_secret_rotated', {
          p_key_name: row.key_name,
          p_new_last_4: last4,
          p_notes: 'gewijzigd via dashboard v2',
        })
      } catch { /* niet kritiek */ }
      applyOverride?.(row.key_name, {
        last_4: last4,
        status: 'green_dashboard_only',
        last_status_change_at: new Date().toISOString(),
      })
      setSavedLast4(last4)
      setTimeout(onClose, 900)
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <div role="dialog" aria-modal="true" className="sv2-modal__backdrop" onClick={onClose}>
      <div className="sv2-modal" onClick={e => e.stopPropagation()}>
        <h3 className="sv2-modal__title">{row.display_name || row.key_name}</h3>
        <div className="sv2-modal__sub">{row.key_name} · {STORAGE_LABEL[row.storage_location]}</div>

        {row.last_4 && (
          <div className="sv2-modal__current">
            Huidige waarde eindigt op <code>··{row.last_4}</code>. Nieuwe waarde overschrijft.
          </div>
        )}

        {savedLast4 ? (
          <div className="sv2-banner sv2-banner--ok">
            <strong>✓ Opgeslagen</strong>&nbsp;— status → 🟢 Veilig, last 4: <code>··{savedLast4}</code>
          </div>
        ) : cannotEdit ? (
          <div className="sv2-banner sv2-banner--warn">
            {isComposio
              ? <><strong>Composio OAuth</strong> — vernieuw de connectie in het Composio dashboard.</>
              : <>Deze key heeft geen edit-flow vanuit dashboard. Wijzig de waarde in Supabase / Vercel zelf.</>}
          </div>
        ) : (
          <>
            {row.rotation_url && (
              <div style={{ marginBottom: 14 }}>
                <a href={row.rotation_url} target="_blank" rel="noopener noreferrer" className="sv2-btn sv2-btn--ghost sv2-btn--sm">
                  ↗ Open vendor-dashboard om nieuwe key te genereren
                </a>
              </div>
            )}
            <div className="sv2-field">
              <label className="sv2-field__label">Nieuwe waarde</label>
              <textarea
                className="sv2-textarea sv2-textarea--mono"
                rows={3}
                value={value}
                onChange={e => setValue(e.target.value)}
                disabled={busy}
                placeholder="Plak nieuwe key/token hier"
                autoFocus
              />
            </div>
            {isVaultSkill && (
              <div className="sv2-field">
                <label className="sv2-field__label">Beschrijving (optioneel)</label>
                <input className="sv2-input" value={description} onChange={e => setDescription(e.target.value)} disabled={busy} />
              </div>
            )}
          </>
        )}

        {!savedLast4 && (
          <div className="sv2-actions">
            {!cannotEdit && (
              <button className="sv2-btn sv2-btn--primary" onClick={onSave} disabled={busy || !value.trim()}>
                {busy ? 'Opslaan…' : 'Opslaan'}
              </button>
            )}
            <button className="sv2-btn sv2-btn--ghost" onClick={onClose} disabled={busy}>
              {cannotEdit ? 'Sluiten' : 'Annuleer'}
            </button>
          </div>
        )}

        {err && <div className="sv2-banner sv2-banner--err" style={{ marginTop: 12, marginBottom: 0 }}>⚠ {err}</div>}
      </div>
    </div>
  )
}
