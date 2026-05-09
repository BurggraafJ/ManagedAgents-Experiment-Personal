import { useState, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import {
  SCOPES,
  SCOPE_BY_KEY,
  lessonTypeMeta,
  fmtAppliesTo,
  fmtRelative,
  btnPrimary,
  btnSecondary,
  btnDanger,
  textareaStyle,
} from '../../../lib/jellemind'

export default function RuleRow({ lesson, onChanged }) {
  const meta = lessonTypeMeta(lesson.lesson_type)
  const scope = SCOPE_BY_KEY[lesson.mind_scope] || SCOPES[0]
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(lesson.lesson_text)
  const [appliesTo, setAppliesTo] = useState((lesson.applies_to || []).join(', '))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const save = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      const arr = appliesTo.split(',').map(s => s.trim()).filter(Boolean)
      const { data, error } = await supabase.rpc('edit_jellemind_lesson', {
        p_lesson_id: lesson.id,
        p_lesson_text: text,
        p_applies_to: arr.length ? arr : null,
      })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.reason || 'kon niet opslaan')
      setEditing(false); onChanged()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }, [lesson.id, text, appliesTo, onChanged])

  const retire = useCallback(async () => {
    if (!confirm('Deze regel retiren? Hij wordt inactief gemaakt — niet verwijderd.')) return
    setBusy(true); setError(null)
    try {
      const { data, error } = await supabase.rpc('retire_jellemind_lesson', {
        p_lesson_id: lesson.id, p_reason: 'manual retire vanuit regels-browser',
      })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.reason || 'kon niet retiren')
      onChanged()
    } catch (e) { setError(e.message); setBusy(false) }
  }, [lesson.id, onChanged])

  const isInactive = !lesson.active
  return (
    <div
      style={{
        padding: 'var(--s-3) var(--s-4)',
        borderRadius: 6,
        border: '1px solid var(--border)',
        background: isInactive ? 'transparent' : 'var(--bg-2)',
        opacity: isInactive ? 0.62 : 1,
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', cursor: 'pointer' }}
        onClick={() => setExpanded(e => !e)}
      >
        <span
          style={{
            fontSize: 10, fontWeight: 700, padding: '2px 7px',
            borderRadius: 4, color: scope.accent,
            background: `color-mix(in srgb, ${scope.accent} 15%, var(--bg-1))`,
            border: `1px solid ${scope.accent}55`,
          }}
        >{scope.label}</span>
        <span
          style={{
            fontSize: 10, fontWeight: 600, padding: '2px 7px',
            borderRadius: 999, color: meta.color,
            background: `color-mix(in srgb, ${meta.color} 15%, var(--bg-1))`,
          }}
        >{meta.label}</span>
        <span style={{ flex: 1, minWidth: 200, fontSize: 12, lineHeight: 1.45 }}>
          {lesson.lesson_text.length > 130 && !expanded
            ? `${lesson.lesson_text.slice(0, 130)}…`
            : lesson.lesson_text}
        </span>
        <span className="muted" style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
          {fmtAppliesTo(lesson.applies_to)}
          {lesson.times_applied > 0 && ` · ${lesson.times_applied}×`}
          {isInactive && ' · inactief'}
        </span>
      </div>

      {expanded && (
        <div className="stack" style={{ gap: 'var(--s-2)', marginTop: 'var(--s-3)', paddingLeft: 4 }}>
          {editing ? (
            <>
              <textarea value={text} onChange={e => setText(e.target.value)} rows={3} style={textareaStyle} />
              <input
                value={appliesTo}
                onChange={e => setAppliesTo(e.target.value)}
                placeholder="* of comma-list (auto-draft, daily-admin)"
                style={{
                  padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)',
                  background: 'var(--bg-1)', color: 'var(--text)', fontSize: 11,
                }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={save} disabled={busy || text.length < 5} style={btnPrimary(scope.accent)}>Opslaan</button>
                <button onClick={() => { setEditing(false); setText(lesson.lesson_text) }} disabled={busy} style={btnSecondary}>Annuleer</button>
              </div>
            </>
          ) : (
            <>
              {lesson.evidence_summary && (
                <div className="muted" style={{ fontSize: 11, lineHeight: 1.4 }}>
                  <strong>Voorbeelden:</strong> {lesson.evidence_summary}
                </div>
              )}
              <div className="muted" style={{ fontSize: 10, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                id: {lesson.id} · scope: {lesson.mind_scope} · type: {lesson.lesson_type}
                {lesson.embedding_model && ` · model: ${lesson.embedding_model}`}
              </div>
              <div className="muted" style={{ fontSize: 10 }}>
                aangemaakt: {new Date(lesson.created_at).toLocaleString('nl-NL')}
                {lesson.last_applied_at && ` · laatst toegepast: ${fmtRelative(lesson.last_applied_at)}`}
                {lesson.times_contradicted > 0 && ` · ${lesson.times_contradicted}× tegengesproken`}
              </div>
              {isInactive && (
                <div style={{ fontSize: 11, color: '#ef4444' }}>
                  <strong>Inactief sinds {lesson.retired_at ? new Date(lesson.retired_at).toLocaleDateString('nl-NL') : '—'}.</strong>
                  {lesson.retired_reason && ` Reden: ${lesson.retired_reason}`}
                </div>
              )}
              {!isInactive && (
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <button onClick={() => setEditing(true)} disabled={busy} style={btnSecondary}>✎ Bewerken</button>
                  <button onClick={retire} disabled={busy} style={btnDanger}>🗑 Retiren</button>
                </div>
              )}
            </>
          )}
          {error && <div style={{ fontSize: 11, color: '#ef4444' }}>{error}</div>}
        </div>
      )}
    </div>
  )
}
