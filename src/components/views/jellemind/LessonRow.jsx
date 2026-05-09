import { useState, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import {
  lessonTypeMeta,
  fmtAppliesTo,
  fmtRelative,
  btnPrimary,
  btnSecondary,
  btnGhost,
  textareaStyle,
} from '../../../lib/jellemind'

export default function LessonRow({ row, scope, onChanged }) {
  const meta = lessonTypeMeta(row.lesson_type)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(row.lesson_text)
  const [appliesTo, setAppliesTo] = useState((row.applies_to || []).join(', '))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const save = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      const arr = appliesTo.split(',').map(s => s.trim()).filter(Boolean)
      const { data, error } = await supabase.rpc('edit_jellemind_lesson', {
        p_lesson_id: row.id,
        p_lesson_text: text,
        p_applies_to: arr.length ? arr : null,
      })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.reason || 'kon niet opslaan')
      setEditing(false); onChanged()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }, [row.id, text, appliesTo, onChanged])

  const retire = useCallback(async () => {
    if (!confirm('Deze lesson retiren? Hij wordt inactief gemaakt — niet verwijderd.')) return
    setBusy(true); setError(null)
    try {
      const { data, error } = await supabase.rpc('retire_jellemind_lesson', {
        p_lesson_id: row.id, p_reason: 'manual retire vanuit dashboard',
      })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.reason || 'kon niet retiren')
      onChanged()
    } catch (e) { setError(e.message); setBusy(false) }
  }, [row.id, onChanged])

  return (
    <div
      style={{
        padding: 'var(--s-3) var(--s-4)',
        borderRadius: 6,
        border: '1px solid var(--border)',
        background: 'var(--bg-2)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 999,
            color: meta.color, background: `color-mix(in srgb, ${meta.color} 15%, var(--bg-1))`,
          }}
        >
          {meta.label}
        </span>
        <span className="muted" style={{ fontSize: 10 }}>
          voor {fmtAppliesTo(row.applies_to)} · {fmtRelative(row.created_at)}
          {row.times_applied > 0 && ` · ${row.times_applied}× toegepast`}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
          <button onClick={() => setEditing(e => !e)} disabled={busy} style={btnGhost}>
            {editing ? '↩' : '✎'}
          </button>
          <button onClick={retire} disabled={busy} style={{ ...btnGhost, color: '#ef4444' }}>🗑</button>
        </div>
      </div>

      {editing ? (
        <div className="stack" style={{ gap: 'var(--s-2)' }}>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={3} style={textareaStyle} />
          <input value={appliesTo} onChange={e => setAppliesTo(e.target.value)}
            placeholder="* of comma-list (auto-draft, daily-admin)"
            style={{
              padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)',
              background: 'var(--bg-1)', color: 'var(--text)', fontSize: 11,
            }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={save} disabled={busy || text.length < 5} style={btnPrimary(scope.accent)}>Opslaan</button>
            <button onClick={() => setEditing(false)} disabled={busy} style={btnSecondary}>Annuleer</button>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
          {row.lesson_text}
        </div>
      )}

      {error && <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>{error}</div>}
    </div>
  )
}
