import { useState } from 'react'
import { supabase } from '../../../../../lib/supabase'
import { STORAGE_LABEL } from '../../../../../lib/apiKeys'

/**
 * EditModal — edit-flow voor een api-key.
 *
 * Routing op storage_location:
 *  - vault (skill:NAME:KEY) → set_skill_secret RPC
 *  - agent_config           → set_secret_value RPC
 *  - edge_function_secret   → handmatig in Supabase + mark_secret_rotated
 *  - composio_managed       → OAuth (Composio dashboard)
 *  - dashboard_only         → niet via dashboard
 *
 * Na save:
 *  1. set_skill_secret / set_secret_value voor de waarde-update
 *  2. mark_secret_rotated om inventory-status → groen + last_4 te updaten
 *  3. applyOverride voor optimistic UI in de tabel
 */
export default function EditModal({ row, onClose, applyOverride }) {
  const [value, setValue] = useState('')
  const [description, setDescription] = useState(
    row.purpose && row.purpose !== '— niet ingevuld —' ? row.purpose : '',
  )
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [savedLast4, setSavedLast4] = useState(null)

  const isVaultSkill  = row.storage_location === 'vault' && row.storage_ref?.startsWith('skill:')
  const isAgentConfig = row.storage_location === 'agent_config'
  const isEdgeFn      = row.storage_location === 'edge_function_secret'
  const isComposio    = row.storage_location === 'composio_managed'
  const cannotEdit    = isComposio || (!isVaultSkill && !isAgentConfig && !isEdgeFn)

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
          p_notes: 'gewijzigd via dashboard',
        })
      } catch { /* niet kritiek */ }
      applyOverride?.(row.key_name, {
        last_4: last4,
        status: 'green_dashboard_only',
        last_status_change_at: new Date().toISOString(),
      })
      setSavedLast4(last4)
      setTimeout(onClose, 900)
    } catch (e) {
      setErr(e.message); setBusy(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" className="set-modal__backdrop" onClick={onClose}>
      <div className="set-modal" onClick={e => e.stopPropagation()}>
        <h3 className="set-modal__title">{row.display_name || row.key_name}</h3>
        <div className="set-modal__sub">{row.key_name} · {STORAGE_LABEL[row.storage_location]}</div>

        {row.last_4 && (
          <div className="set-modal__current">
            Huidige waarde eindigt op <code>··{row.last_4}</code>. Nieuwe waarde overschrijft.
          </div>
        )}

        {savedLast4 ? (
          <div className="set-banner set-banner--ok">
            <strong>✓ Opgeslagen</strong>&nbsp;— status → 🟢 Veilig, last 4: <code>··{savedLast4}</code>
          </div>
        ) : cannotEdit ? (
          <div className="set-banner set-banner--warn">
            {isComposio
              ? <><strong>Composio OAuth</strong> — vernieuw de connectie in het Composio dashboard.</>
              : <>Deze key heeft geen edit-flow vanuit dashboard. Wijzig de waarde in Supabase / Vercel zelf.</>}
          </div>
        ) : (
          <>
            {row.rotation_url && (
              <div style={{ marginBottom: 14 }}>
                <a
                  href={row.rotation_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="set-btn set-btn--ghost set-btn--sm"
                >
                  ↗ Open vendor-dashboard om nieuwe key te genereren
                </a>
              </div>
            )}
            <div className="set-field">
              <label className="set-field__label">Nieuwe waarde</label>
              <textarea
                className="set-textarea set-textarea--mono"
                rows={3}
                value={value}
                onChange={e => setValue(e.target.value)}
                disabled={busy}
                placeholder="Plak nieuwe key/token hier"
                autoFocus
              />
            </div>
            {isVaultSkill && (
              <div className="set-field">
                <label className="set-field__label">Beschrijving (optioneel)</label>
                <input
                  className="set-input"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  disabled={busy}
                />
              </div>
            )}
          </>
        )}

        {!savedLast4 && (
          <div className="set-actions">
            {!cannotEdit && (
              <button className="set-btn set-btn--primary" onClick={onSave} disabled={busy || !value.trim()}>
                {busy ? 'Opslaan…' : 'Opslaan'}
              </button>
            )}
            <button className="set-btn set-btn--ghost" onClick={onClose} disabled={busy}>
              {cannotEdit ? 'Sluiten' : 'Annuleer'}
            </button>
          </div>
        )}

        {err && (
          <div className="set-banner set-banner--err" style={{ marginTop: 12, marginBottom: 0 }}>
            ⚠ {err}
          </div>
        )}
      </div>
    </div>
  )
}
