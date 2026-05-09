import { useState } from 'react'
import { supabase } from '../../../../lib/supabase'
import { showToast } from '../../../Toast'

export default function NewPreferenceForm({ scopeType, scopeOptions, onCancel, onSaved }) {
  const [scopeValue, setScopeValue] = useState(scopeOptions[0]?.value || '')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    if (!text.trim()) return
    if (scopeType !== 'global' && !scopeValue) return
    setBusy(true)
    const { data, error } = await supabase.rpc('add_category_preference', {
      p_scope_type: scopeType,
      p_scope_value: scopeType === 'global' ? null : scopeValue,
      p_preference_text: text.trim(),
      p_source: 'manual_settings',
      p_origin_mail_id: null,
    })
    setBusy(false)
    if (error || (data && data.ok === false)) {
      showToast({ kind: 'error', message: 'Toevoegen mislukt', detail: error?.message || data?.reason })
      return
    }
    showToast({ message: 'Voorkeur toegevoegd' })
    onSaved()
  }

  return (
    <div style={{ background: 'var(--surface-1, #f8fafc)', padding: 10, borderRadius: 6, marginBottom: 12 }}>
      {scopeType !== 'global' && (
        <div style={{ marginBottom: 8 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>
            Scope
          </label>
          <select value={scopeValue} onChange={e => setScopeValue(e.target.value)}
            style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, minWidth: 220 }}>
            {scopeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )}
      <textarea value={text} onChange={e => setText(e.target.value)} rows={3} autoFocus
        placeholder='bv. "Voor in te plannen afspraken altijd 3 concrete slots aanbieden, geen vage windows."'
        style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text)', fontFamily: 'inherit', fontSize: 13, resize: 'vertical', lineHeight: 1.5 }} />
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <button type="button" onClick={save} disabled={busy || !text.trim() || (scopeType !== 'global' && !scopeValue)}
          style={{ padding: '6px 14px', fontSize: 12.5, borderRadius: 6, background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)', cursor: 'pointer', fontFamily: 'inherit' }}>
          {busy ? 'Toevoegen…' : 'Toevoegen'}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}
          style={{ padding: '6px 14px', fontSize: 12.5, borderRadius: 6, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>
          Annuleer
        </button>
      </div>
    </div>
  )
}
