import { useState } from 'react'
import { supabase } from '../../../../lib/supabase'
import { showToast } from '../../../Toast'

export default function PreferenceRow({ row }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(row.preference_text)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    const { data, error } = await supabase.rpc('update_category_preference', {
      p_id: row.id, p_preference_text: text,
    })
    setBusy(false)
    if (error) { showToast({ kind: 'error', message: 'Opslaan mislukt', detail: error.message }); return }
    if (data && data.ok === false) { showToast({ kind: 'error', message: 'Opslaan geweigerd', detail: data.reason }); return }
    setEditing(false)
    showToast({ message: 'Voorkeur bijgewerkt' })
  }

  async function remove() {
    if (!confirm('Voorkeur verwijderen?')) return
    setBusy(true)
    const { data, error } = await supabase.rpc('deactivate_category_preference', { p_id: row.id })
    setBusy(false)
    if (error || (data && data.ok === false)) {
      showToast({ kind: 'error', message: 'Verwijderen mislukt', detail: error?.message || data?.reason })
      return
    }
    showToast({ message: 'Voorkeur verwijderd' })
  }

  if (editing) {
    return (
      <div style={{ background: 'var(--surface-1, #f8fafc)', padding: 8, borderRadius: 6, marginBottom: 6 }}>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={3}
          style={{
            width: '100%', padding: '8px 10px', border: '1px solid var(--border)',
            borderRadius: 6, background: 'var(--bg)', color: 'var(--text)',
            fontFamily: 'inherit', fontSize: 13, resize: 'vertical',
          }} />
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <button type="button" onClick={save} disabled={busy || !text.trim()}
            style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)', cursor: 'pointer', fontFamily: 'inherit' }}>
            {busy ? 'Opslaan…' : 'Opslaan'}
          </button>
          <button type="button" onClick={() => { setText(row.preference_text); setEditing(false) }} disabled={busy}
            style={{ padding: '4px 10px', fontSize: 12, borderRadius: 6, background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit' }}>
            Annuleer
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex', gap: 8, alignItems: 'flex-start',
      padding: '6px 8px', borderRadius: 6,
      background: 'transparent', border: '1px solid transparent',
      marginBottom: 4,
    }}>
      <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text)', flex: 1, whiteSpace: 'pre-wrap' }}>
        {row.preference_text}
      </span>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
        {row.source === 'manual_quick' ? 'quick' : row.source}
      </span>
      <button type="button" onClick={() => setEditing(true)}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, padding: 2 }}
        title="Bewerk">✎</button>
      <button type="button" onClick={remove} disabled={busy}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12, padding: 2 }}
        title="Verwijder">×</button>
    </div>
  )
}
