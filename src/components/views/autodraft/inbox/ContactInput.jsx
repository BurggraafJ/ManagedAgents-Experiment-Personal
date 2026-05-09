import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../../lib/supabase'
import { parseRecipientTokens, chipLabel } from '../../../../lib/autodraft'

// ContactInput — chip-style recipient-input (sinds F.1.f, 2026-05-05).
// Toont elke recipient als pill met × om te verwijderen; chips wrappen op
// nieuwe regel zodat 2+ adressen ruim passen. Autocomplete via search_contacts
// RPC op de actieve edit-buffer (debounced 200ms).
//
// Backwards compatible: props-signature ongewijzigd (`value` blijft een
// comma-separated string die parent zelf opslaat in DB).
export default function ContactInput({ value, onChange, disabled, placeholder, style }) {
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [highlightIdx, setHighlightIdx] = useState(0)
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)

  const tokens = parseRecipientTokens(value)

  function commitDraft(text) {
    const t = (text ?? draft).trim().replace(/^[,;\s]+|[,;\s]+$/g, '')
    if (!t) return
    const newTokens = [...tokens, t]
    onChange(newTokens.join(', '))
    setDraft('')
  }

  function removeToken(idx) {
    const newTokens = tokens.filter((_, i) => i !== idx)
    onChange(newTokens.join(', '))
    inputRef.current?.focus()
  }

  function pickContact(c) {
    const formatted = c.display_name && c.display_name !== c.email
      ? `${c.display_name} <${c.email}>`
      : c.email
    commitDraft(formatted)
    setOpen(false)
    setSuggestions([])
    inputRef.current?.focus()
  }

  // Debounced search op de edit-buffer (niet meer op de hele value)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!draft || draft.trim().length < 2) {
      setSuggestions([])
      return
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const { data } = await supabase.rpc('search_contacts', { p_query: draft.trim(), p_limit: 8 })
        setSuggestions(Array.isArray(data) ? data : [])
        setHighlightIdx(0)
      } catch { setSuggestions([]) }
    }, 200)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [draft])

  useEffect(() => {
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    if (open) {
      document.addEventListener('mousedown', onDocClick)
      return () => document.removeEventListener('mousedown', onDocClick)
    }
  }, [open])

  function onKeyDown(e) {
    // Backspace op lege buffer → laatste chip verwijderen
    if (e.key === 'Backspace' && !draft && tokens.length > 0) {
      e.preventDefault()
      onChange(tokens.slice(0, -1).join(', '))
      return
    }
    // Suggestie kiezen heeft prio bij Enter/Tab
    if ((e.key === 'Enter' || e.key === 'Tab') && open && suggestions.length > 0) {
      const c = suggestions[highlightIdx]
      if (c) { e.preventDefault(); pickContact(c); return }
    }
    // Komma / puntkomma / Enter / Tab op niet-lege buffer → commit als ruwe text
    if ((e.key === ',' || e.key === ';' || e.key === 'Enter' || e.key === 'Tab') && draft.trim()) {
      e.preventDefault()
      commitDraft()
      return
    }
    if (open && suggestions.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlightIdx(i => Math.min(i + 1, suggestions.length - 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlightIdx(i => Math.max(i - 1, 0)) }
      else if (e.key === 'Escape') { setOpen(false) }
    }
  }

  function onBlurInput() {
    // Geef suggestion-mousedown voorrang; commit alleen als gebruiker écht weg is
    setTimeout(() => {
      if (draft.trim()) commitDraft()
    }, 120)
  }

  return (
    <div ref={wrapRef} style={{
      flex: 1, position: 'relative',
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4,
      minHeight: 22, paddingTop: 2, paddingBottom: 2,
    }}>
      {tokens.map((t, idx) => (
        <span key={`${t}-${idx}`} title={t} style={{
          display: 'inline-flex', alignItems: 'center', gap: 2,
          padding: '1px 4px 1px 8px', borderRadius: 12,
          background: 'var(--accent-soft)', color: 'var(--text)',
          fontSize: 12, lineHeight: 1.45, maxWidth: '100%',
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
            {chipLabel(t)}
          </span>
          {!disabled && (
            <button type="button" onClick={() => removeToken(idx)} aria-label="Verwijder ontvanger" style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              color: 'var(--text-muted)', padding: '0 2px', fontFamily: 'inherit',
              fontSize: 13, lineHeight: 1,
            }}>×</button>
          )}
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={e => { setDraft(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={onBlurInput}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder={tokens.length === 0 ? placeholder : ''}
        style={{
          ...style,
          flex: '1 1 80px',
          minWidth: 80,
          width: 'auto',
        }}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 2px)', left: 0,
          minWidth: 320, maxWidth: 480, zIndex: 10,
          background: 'var(--surface-1)', border: '1px solid var(--border)',
          borderRadius: 6, padding: 4,
          boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
          maxHeight: 280, overflowY: 'auto',
        }}>
          {suggestions.map((c, idx) => (
            <button key={c.email} type="button"
              onMouseDown={e => { e.preventDefault(); pickContact(c) }}
              onMouseEnter={() => setHighlightIdx(idx)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '6px 8px', borderRadius: 4,
                border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                background: idx === highlightIdx ? 'var(--accent-soft)' : 'transparent',
                color: 'var(--text)', textAlign: 'left',
              }}>
              <span style={{
                width: 24, height: 24, borderRadius: '50%',
                background: c.source === 'hubspot' ? 'var(--accent-soft)' : 'color-mix(in srgb, var(--text-muted) 15%, transparent)',
                color: c.source === 'hubspot' ? 'var(--accent)' : 'var(--text-muted)',
                display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 600,
                flexShrink: 0,
              }}>
                {(c.display_name || c.email).slice(0, 1).toUpperCase()}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.display_name || c.email}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.email}{c.company ? ` · ${c.company}` : ''}
                </div>
              </span>
              {c.source === 'hubspot' && (
                <span style={{ fontSize: 10, color: 'var(--accent)', flexShrink: 0 }}>HubSpot</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
