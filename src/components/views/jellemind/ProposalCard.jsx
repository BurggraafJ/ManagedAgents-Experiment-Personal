import { useState, useCallback, useEffect, useRef } from 'react'
import { supabase } from '../../../lib/supabase'
import {
  SCOPES,
  lessonTypeMeta,
  fmtAppliesTo,
  fmtRelative,
  btnPrimary,
  btnSecondary,
  btnDanger,
  btnGhost,
  textareaStyle,
} from '../../../lib/jellemind'
import SourceLine from './SourceLine'

// ProposalCard — bron-blokje + altijd-bewerkbaar veld + acties.
//
// lesson_text is een textarea die er net zo uitziet als de oude readonly-box,
// maar gewoon editable is. Klik erin = typen. "✓ Klopt" stuurt automatisch
// p_lesson_text_override mee als de tekst is gewijzigd.
//
// Sub-modes (alleen voor amend en move, niet meer voor edit):
//   - default  : ✓ Klopt | ↪ Verplaats | ✕ | 💬 AI-instructie
//   - amend    : textarea voor instructie-aan-LLM
//   - move     : kies andere mind-scope

export default function ProposalCard({ row, scope, meeting, signals, onDecided }) {
  const meta = lessonTypeMeta(row.lesson_type)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState('default')
  const [editText, setEditText] = useState(row.lesson_text)
  const [amendText, setAmendText] = useState('')
  const [error, setError] = useState(null)

  const decide = useCallback(async (action, payload = {}) => {
    setBusy(true); setError(null)
    try {
      const { data, error } = await supabase.rpc('submit_jellemind_decision', {
        p_proposal_id: row.id,
        p_action: action,
        ...payload,
      })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.reason || 'onbekende fout')
      onDecided()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }, [row.id, onDecided])

  const isEdited = editText.trim() !== row.lesson_text.trim()

  const accept = useCallback(() => {
    const payload = isEdited ? { p_lesson_text_override: editText.trim() } : {}
    decide('accept', payload)
  }, [decide, editText, isEdited])

  const acceptToScope = useCallback((scopeKey) => {
    const payload = { p_mind_scope_override: scopeKey }
    if (isEdited) payload.p_lesson_text_override = editText.trim()
    decide('accept', payload)
  }, [decide, editText, isEdited])

  const otherScopes = SCOPES.filter(s => s.key !== row.mind_scope)

  const textareaRef = useRef(null)
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = ta.scrollHeight + 'px'
  }, [editText])

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
            fontSize: 10, fontWeight: 600, padding: '2px 7px',
            borderRadius: 999, color: meta.color,
            background: `color-mix(in srgb, ${meta.color} 15%, var(--bg-1))`,
          }}
        >
          {meta.label}
        </span>
        <span className="muted" style={{ fontSize: 10 }}>
          voor {fmtAppliesTo(row.applies_to)} · {Math.round(row.confidence * 100)}% · {fmtRelative(row.created_at)}
        </span>
        {isEdited && (
          <span
            style={{
              fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 999,
              color: scope.accent,
              background: `color-mix(in srgb, ${scope.accent} 15%, var(--bg-1))`,
              border: `1px solid ${scope.accent}55`,
            }}
            title="Je hebt de tekst aangepast — Klopt slaat de bewerkte versie op"
          >
            bewerkt
          </span>
        )}
      </div>

      <SourceLine row={row} meeting={meeting} signals={signals} accent={scope.accent} />

      {row.proposed_question && (
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, lineHeight: 1.35 }}>
          {row.proposed_question}
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={editText}
        onChange={e => setEditText(e.target.value)}
        spellCheck={false}
        style={{
          width: '100%',
          fontSize: 12,
          lineHeight: 1.5,
          padding: 'var(--s-2) var(--s-3)',
          borderRadius: 4,
          background: 'var(--bg-1)',
          border: `1px solid ${isEdited ? scope.accent + '88' : 'var(--border)'}`,
          color: 'var(--text)',
          fontFamily: 'inherit',
          resize: 'vertical',
          outline: 'none',
          boxSizing: 'border-box',
          minHeight: '4.5em',
          overflow: 'hidden',
          transition: 'border-color 0.15s',
        }}
        onFocus={e => { e.target.style.borderColor = scope.accent }}
        onBlur={e => { e.target.style.borderColor = isEdited ? scope.accent + '88' : 'var(--border)' }}
      />

      {row.evidence_summary && mode === 'default' && (
        <div className="muted" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.4 }}>
          <strong>Voorbeelden:</strong> {row.evidence_summary}
        </div>
      )}

      {error && (
        <div style={{ fontSize: 11, color: '#ef4444', marginTop: 'var(--s-2)' }}>{error}</div>
      )}

      {mode === 'amend' && (
        <div style={{ marginTop: 'var(--s-3)' }}>
          <textarea
            value={amendText}
            onChange={e => setAmendText(e.target.value)}
            placeholder="Geef een instructie aan de AI om dit voorstel te herformuleren…"
            rows={3}
            style={textareaStyle}
            autoFocus
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 'var(--s-2)' }}>
            <button onClick={() => decide('amend', { p_amendment: amendText })}
              disabled={busy || amendText.trim().length < 5} style={btnPrimary(scope.accent)}>
              Stuur instructie
            </button>
            <button onClick={() => { setMode('default'); setAmendText('') }} disabled={busy} style={btnSecondary}>
              Annuleer
            </button>
          </div>
        </div>
      )}

      {mode === 'move' && (
        <div style={{ marginTop: 'var(--s-3)' }}>
          <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
            Verplaats naar{isEdited ? ' (met je bewerkte tekst)' : ''}:
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {otherScopes.map(s => (
              <button key={s.key}
                onClick={() => acceptToScope(s.key)}
                disabled={busy}
                style={{ ...btnSecondary, color: s.accent, fontWeight: 600, borderColor: s.accent }}>
                ✓ {s.label}
              </button>
            ))}
            <button onClick={() => setMode('default')} disabled={busy} style={btnSecondary}>
              Annuleer
            </button>
          </div>
        </div>
      )}

      {mode === 'default' && (
        <div style={{ display: 'flex', gap: 4, marginTop: 'var(--s-3)', flexWrap: 'wrap' }}>
          <button onClick={accept} disabled={busy || editText.trim().length < 5} style={btnPrimary(scope.accent)}>
            ✓ Klopt{isEdited ? ' — met deze tekst' : ''}
          </button>
          <button onClick={() => setMode('move')} disabled={busy} style={btnSecondary} title="Verplaats naar andere mind">↪</button>
          <button onClick={() => decide('reject')} disabled={busy} style={btnDanger} title="Verwerp">✕</button>
          <button onClick={() => setMode('amend')} disabled={busy} style={btnGhost} title="Stuur AI-instructie voor herformulering">
            💬
          </button>
        </div>
      )}
    </div>
  )
}
