import { useState } from 'react'
import { supabase } from '../../../../lib/supabase'
import styles from './api-keys.module.css'
import { STORAGE_LABEL } from '../../../../lib/apiKeys'
import MarkRotatedModalForm from './MarkRotatedModalForm'

const EXPIRY_PRESETS = [
  { days: 30,  label: '30 dagen' },
  { days: 90,  label: '90 dagen' },
  { days: 180, label: '180 dagen' },
  { days: 365, label: '1 jaar' },
]

export default function EditModal({ row, onClose, applyOverride }) {
  const [value, setValue] = useState('')
  const [description, setDescription] = useState(row.purpose && row.purpose !== '— niet ingevuld —' ? row.purpose : '')
  const [expiresAt, setExpiresAt] = useState(row.expires_at ? new Date(row.expires_at).toISOString().slice(0, 10) : '')
  const [expiryNote, setExpiryNote] = useState(row.expiry_note || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [savedLast4, setSavedLast4] = useState(null)
  const [expirySaved, setExpirySaved] = useState(false)

  const isVaultSkill = row.storage_location === 'vault' && row.storage_ref?.startsWith('skill:')
  const isAgentConfig = row.storage_location === 'agent_config'
  const isEdgeFnSecret = row.storage_location === 'edge_function_secret'
  const isComposioManaged = row.storage_location === 'composio_managed'

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
        setErr('Deze key kun je niet via dashboard bewerken — zie toelichting hieronder.')
        setBusy(false)
        return
      }
      if (result.error) {
        setErr(result.error.message)
        setBusy(false)
        return
      }
      if (result.data && result.data.ok === false) {
        setErr(result.data.hint || result.data.reason || 'opslaan mislukt')
        setBusy(false)
        return
      }

      // Sync inventory-status + last_4 zodat de tabel-status springt naar groen.
      try {
        await supabase.rpc('mark_secret_rotated', {
          p_key_name: row.key_name,
          p_new_last_4: last4,
          p_notes: 'gewijzigd via dashboard',
        })
      } catch { /* niet kritiek */ }

      // Optimistic — toon nieuwe last_4 + groene status meteen in tabel
      applyOverride?.(row.key_name, {
        last_4: last4,
        status: 'green_dashboard_only',
        last_status_change_at: new Date().toISOString(),
      })
      setSavedLast4(last4)
      setTimeout(onClose, 900)
    } catch (e) {
      setErr(e.message)
      setBusy(false)
    }
  }

  async function onMarkRotatedOnly(last4) {
    if (!last4 || last4.length === 0) { setErr('Vul de laatste 4 tekens in'); return }
    setBusy(true); setErr(null)
    try {
      const { error } = await supabase.rpc('mark_secret_rotated', {
        p_key_name: row.key_name,
        p_new_last_4: last4,
        p_notes: 'edge function secret — handmatig in Supabase ingevuld',
      })
      if (error) setErr(error.message)
      else {
        setSavedLast4(last4)
        setTimeout(onClose, 900)
        return
      }
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  async function saveExpiry(rawDate, note) {
    const iso = rawDate ? new Date(rawDate + 'T00:00:00').toISOString() : null
    // Optimistic
    applyOverride?.(row.key_name, { expires_at: iso, expiry_note: note || null })
    setExpiresAt(rawDate)
    setExpiryNote(note || '')
    setExpirySaved(true)
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc('set_secret_expiry', {
        p_key_name: row.key_name,
        p_expires_at: iso,
        p_expiry_note: note || null,
      })
      if (error) { setErr(error.message); setExpirySaved(false) }
      else if (data && data.ok === false) { setErr(data.reason || 'expiry instellen mislukt'); setExpirySaved(false) }
    } catch (e) { setErr(e.message); setExpirySaved(false) }
    setBusy(false)
    setTimeout(() => setExpirySaved(false), 1800)
  }

  function applyPreset(days) {
    const d = new Date()
    d.setDate(d.getDate() + days)
    const iso = d.toISOString().slice(0, 10)
    saveExpiry(iso, expiryNote)
  }

  // Edge function secrets krijgen een eigen flow: handmatig in Supabase + last4 hier markeren.
  // composio_managed en onbekende storage_locations hebben helemaal geen edit-pad.
  const isMarkRotatedFlow = isEdgeFnSecret
  const cannotEdit = isComposioManaged || (!isVaultSkill && !isAgentConfig && !isEdgeFnSecret)
  // Expiry-editor heeft een echte inventory-rij nodig (created_at is dan gevuld).
  const canSetExpiry = !!row.created_at

  return (
    <div role="dialog" aria-modal="true" className="api-keys__modal-backdrop" onClick={onClose}>
      <div className="card api-keys__modal" onClick={e => e.stopPropagation()}>
        <h3 className="api-keys__modal-title">{row.display_name || row.key_name}</h3>
        <div className={`muted mono ${styles.modalSub}`}>
          {row.key_name} · {STORAGE_LABEL[row.storage_location]}
        </div>

        {row.last_4 && (
          <div className="api-keys__modal-current">
            Huidige waarde eindigt op <code>****{row.last_4}</code>. Nieuwe waarde overschrijft.
          </div>
        )}

        {savedLast4 ? (
          <div className="api-keys__modal-success">
            <span className={styles.savedCheck}>✓</span>
            <div>
              <div className={styles.successTitle}>Opgeslagen</div>
              <div className={styles.successMeta}>
                Status wordt bijgewerkt naar <strong style={{ color: 'var(--success)' }}>🟢 Veilig</strong> · last 4: <code>****{savedLast4}</code>
              </div>
            </div>
          </div>
        ) : cannotEdit ? (
          <div className="api-keys__modal-cannot">
            {isComposioManaged ? (
              <>
                <strong>Composio OAuth</strong> — vernieuw de connectie in het Composio dashboard.
                Geen plaintext om hier in te plakken.
              </>
            ) : (
              <>Deze key heeft geen edit-flow vanuit dashboard. Zie storage_location in de toelichting.</>
            )}
          </div>
        ) : isMarkRotatedFlow ? (
          <MarkRotatedModalForm
            row={row}
            busy={busy}
            onSubmit={onMarkRotatedOnly}
          />
        ) : (
          <>
            {row.rotation_url && (
              <div style={{ marginBottom: 14 }}>
                <a
                  href={row.rotation_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`btn btn--ghost ${styles.btnSmall}`}
                >
                  ↗ Open vendor-dashboard om nieuwe key te genereren
                </a>
              </div>
            )}

            <label className={styles.formLabel}>
              <div className={`kpi__label ${styles.labelMargin}`}>Nieuwe waarde</div>
              <textarea
                value={value}
                onChange={e => setValue(e.target.value)}
                disabled={busy}
                rows={3}
                placeholder="Plak nieuwe key/token hier"
                autoFocus
                className="settings-textarea settings-textarea--mono"
              />
            </label>

            {isVaultSkill && (
              <label className={styles.formLabelMd}>
                <div className={`kpi__label ${styles.labelMargin}`}>Beschrijving (optioneel)</div>
                <input
                  type="text"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  disabled={busy}
                  className={`settings-input ${styles.inputFull}`}
                />
              </label>
            )}
          </>
        )}

        {!savedLast4 && (
          <div className={styles.actionRow}>
            {!cannotEdit && !isMarkRotatedFlow && (
              <button className="btn btn--accent" onClick={onSave} disabled={busy || !value.trim()}>
                {busy ? 'Opslaan…' : 'Opslaan'}
              </button>
            )}
            <button className="btn btn--ghost" onClick={onClose} disabled={busy}>
              {cannotEdit ? 'Sluiten' : 'Annuleer'}
            </button>
          </div>
        )}

        {!savedLast4 && canSetExpiry && (
          <div className={styles.expirySep}>
            <div className={styles.expiryHead}>
              <div className="kpi__label">Verloopdatum</div>
              {expirySaved && (
                <span className={styles.expirySaved}>✓ Opgeslagen</span>
              )}
            </div>
            <div className={`muted ${styles.expiryHint}`}>
              Helpt rotaties op tijd plannen. Tabel toont oranje pill &lt;30d, rood &lt;7d.
            </div>

            {/* Quick-presets */}
            <div className={styles.actionRowSm}>
              {EXPIRY_PRESETS.map(p => (
                <button
                  key={p.days}
                  type="button"
                  className={`btn btn--ghost ${styles.btnXs}`}
                  onClick={() => applyPreset(p.days)}
                  disabled={busy}
                >
                  + {p.label}
                </button>
              ))}
            </div>

            {/* Custom date + note */}
            <div className={styles.actionRow}>
              <input
                type="date"
                value={expiresAt}
                onChange={e => setExpiresAt(e.target.value)}
                disabled={busy}
                className={`settings-input ${styles.inputDate}`}
              />
              <input
                type="text"
                value={expiryNote}
                onChange={e => setExpiryNote(e.target.value)}
                disabled={busy}
                placeholder="Notitie (optioneel, bv. 'q3-rotatie')"
                className={`settings-input ${styles.inputNoteFlex}`}
              />
              <button
                className={`btn btn--accent ${styles.btnSmall}`}
                onClick={() => saveExpiry(expiresAt, expiryNote)}
                disabled={busy}
              >
                Opslaan
              </button>
              {expiresAt && (
                <button
                  type="button"
                  className={`btn btn--ghost ${styles.btnXs}`}
                  style={{ color: 'var(--text-muted)' }}
                  onClick={() => saveExpiry('', '')}
                  disabled={busy}
                  title="Verwijder verloopdatum"
                >
                  Wissen
                </button>
              )}
            </div>
          </div>
        )}

        {err && (
          <div className={styles.errorBox}>
            ⚠ {err}
          </div>
        )}
      </div>
    </div>
  )
}
