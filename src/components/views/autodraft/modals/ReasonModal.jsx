import { useState } from 'react'

export default function ReasonModal({ opts, onCancel, onConfirm }) {
  const [text, setText] = useState('')
  const [pattern, setPattern] = useState('')
  const askPattern = !!opts.askPattern
  const canSubmit = askPattern ? pattern.trim().length >= 2 : true
  const title = opts.skipPattern ? '👥 Afgehandeld door collega'
              : askPattern        ? '✏ Eigen leerregel'
              : '🚫 Leerregel toevoegen'
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
      onClick={onCancel}>
      <div onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg)', borderRadius: 10,
          border: '1px solid var(--border)',
          padding: '20px 22px', width: 480, maxWidth: '90vw',
          boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
        }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 12 }}>
          {opts.prompt}
        </div>

        {askPattern && (
          <>
            <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>
              Sleutelwoord in onderwerp / inhoud
            </label>
            <input type="text" value={pattern} onChange={e => setPattern(e.target.value)}
              autoFocus
              placeholder='bv. teams meeting, uitnodiging, factuur'
              style={{
                width: '100%', padding: '8px 10px', marginBottom: 12,
                border: '1px solid var(--border)', borderRadius: 6,
                background: 'var(--bg)', color: 'var(--text)',
                fontFamily: 'inherit', fontSize: 13,
              }} />
          </>
        )}

        <label style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>
          Toelichting {askPattern ? '(optioneel)' : ''}
        </label>
        <textarea value={text} onChange={e => setText(e.target.value)}
          autoFocus={!askPattern}
          rows={3}
          placeholder={opts.skipPattern
            ? 'bv. "Mark heeft hem opgepakt"'
            : askPattern
              ? 'bv. "is een teams meeting, wil ik niet meer hebben"'
              : 'Korte uitleg waarom (wordt later getoond bij Regels)…'}
          style={{
            width: '100%', padding: '8px 10px',
            border: '1px solid var(--border)', borderRadius: 6,
            background: 'var(--bg)', color: 'var(--text)',
            fontFamily: 'inherit', fontSize: 13, resize: 'vertical',
          }} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" onClick={onCancel}
            style={{
              padding: '6px 14px', borderRadius: 4,
              border: '1px solid var(--border)',
              background: 'var(--bg)', color: 'var(--text)',
              cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5,
            }}>
            Annuleer
          </button>
          <button type="button" onClick={() => onConfirm({ text, pattern: pattern.trim() })}
            disabled={!canSubmit}
            style={{
              padding: '6px 14px', borderRadius: 4,
              border: '1px solid var(--accent)',
              background: canSubmit ? 'var(--accent)' : '#9CC2E5',
              color: '#fff',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600,
            }}>
            {opts.skipPattern ? 'Afhandelen' : 'Afhandelen + onthoud'}
          </button>
        </div>
      </div>
    </div>
  )
}
