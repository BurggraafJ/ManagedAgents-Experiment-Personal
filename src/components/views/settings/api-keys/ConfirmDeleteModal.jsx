import { useState } from 'react'
import { supabase } from '../../../../lib/supabase'

export default function ConfirmDeleteModal({ row, onCancel, onDone }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const expected = row.secret_name || row.key_name
  const match = typed.trim() === expected

  async function onConfirm() {
    if (!match) return
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc('delete_skill_secret', {
        p_skill_name: row.skill_name,
        p_secret_name: row.secret_name,
        p_updated_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.hint || data.reason || 'verwijderen mislukt')
      else onDone()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div role="dialog" aria-modal="true" className="api-keys__modal-backdrop" onClick={onCancel}>
      <div className="card api-keys__modal" onClick={e => e.stopPropagation()}>
        <h3 className="api-keys__modal-title" style={{ color: '#dc2626' }}>Definitief verwijderen?</h3>
        <div className="muted" style={{ fontSize: 12, marginBottom: 14, lineHeight: 1.5 }}>
          Je staat op het punt <code style={{ background: 'var(--surface-2)', padding: '1px 5px', borderRadius: 3 }}>{row.storage_ref || row.key_name}</code> uit
          de Vault te verwijderen. Skills die deze key gebruiken zullen falen tot je een nieuwe waarde invult.
        </div>
        <label style={{ display: 'block', marginBottom: 14 }}>
          <div className="kpi__label" style={{ marginBottom: 4 }}>
            Typ <code>{expected}</code> om te bevestigen
          </div>
          <input
            type="text"
            value={typed}
            onChange={e => setTyped(e.target.value)}
            disabled={busy}
            autoFocus
            className="settings-input"
            style={{ fontFamily: 'var(--mono)', maxWidth: 'none' }}
          />
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn"
            style={{ background: match ? '#dc2626' : 'var(--surface-2)', color: match ? 'white' : 'var(--text-muted)' }}
            onClick={onConfirm}
            disabled={!match || busy}
          >
            {busy ? 'Bezig…' : 'Verwijder'}
          </button>
          <button className="btn btn--ghost" onClick={onCancel} disabled={busy}>Annuleer</button>
        </div>
        {err && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--error-dim)', color: 'var(--error)', borderRadius: 6, fontSize: 12 }}>
            ⚠ {err}
          </div>
        )}
      </div>
    </div>
  )
}
