import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../../lib/supabase'
import { parseRecipientTokens, chipLabel } from '../../../../lib/autodraft'
import styles from '../autodraft.module.css'

// ContactInput — chip-style recipient-input (sinds F.1.f, 2026-05-05).
// Toont elke recipient als pill met × om te verwijderen; chips wrappen op
// nieuwe regel zodat 2+ adressen ruim passen. Autocomplete via search_contacts
// RPC op de actieve edit-buffer (debounced 200ms).
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
    if (e.key === 'Backspace' && !draft && tokens.length > 0) {
      e.preventDefault()
      onChange(tokens.slice(0, -1).join(', '))
      return
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && open && suggestions.length > 0) {
      const c = suggestions[highlightIdx]
      if (c) { e.preventDefault(); pickContact(c); return }
    }
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
    setTimeout(() => {
      if (draft.trim()) commitDraft()
    }, 120)
  }

  return (
    <div ref={wrapRef} className={styles.contactWrap}>
      {tokens.map((t, idx) => (
        <span key={`${t}-${idx}`} title={t} className={styles.contactToken}>
          <span className={styles.contactTokenText}>{chipLabel(t)}</span>
          {!disabled && (
            <button
              type="button"
              onClick={() => removeToken(idx)}
              aria-label="Verwijder ontvanger"
              className={styles.contactTokenRemove}
            >
              ×
            </button>
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
        className={styles.contactInputField}
        style={style}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <div className={styles.contactSuggestList}>
          {suggestions.map((c, idx) => (
            <button
              key={c.email}
              type="button"
              onMouseDown={e => { e.preventDefault(); pickContact(c) }}
              onMouseEnter={() => setHighlightIdx(idx)}
              className={`${styles.contactSuggestBtn} ${idx === highlightIdx ? styles.contactSuggestBtnActive : ''}`}
            >
              <span
                className={`${styles.contactAvatar} ${c.source === 'hubspot' ? styles.contactAvatarHubspot : styles.contactAvatarPlain}`}
              >
                {(c.display_name || c.email).slice(0, 1).toUpperCase()}
              </span>
              <span className={styles.contactSuggestBody}>
                <div className={styles.contactSuggestName}>
                  {c.display_name || c.email}
                </div>
                <div className={styles.contactSuggestEmail}>
                  {c.email}{c.company ? ` · ${c.company}` : ''}
                </div>
              </span>
              {c.source === 'hubspot' && (
                <span className={styles.contactSuggestSource}>HubSpot</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
