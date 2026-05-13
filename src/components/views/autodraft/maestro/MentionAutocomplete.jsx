import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { supabase } from '../../../../lib/supabase'

// MentionAutocomplete — V8.9 (2026-05-13).
//
// Outlook-stijl @-tagging voor de DraftEditor-textarea. Detecteert "@..." op de
// cursor-positie, opent een dropdown met afzenders uit mail_messages (laatste
// 6 maanden, distinct on from_email), filtert op de query achter de @, en
// inserts "@Naam " (plain text) bij selectie.
//
// MVP-keuze: textarea blijft plain-text — geen rich chip-elementen. Bij submit
// naar Outlook wordt elke `@Naam` automatisch als mention herkend (Microsoft
// Graph parsed it). Volledige rich-chip-implementatie (contenteditable + chips
// + klik-actions) is een latere upgrade.
//
// Gebruik:
//   const mention = useMentionAutocomplete({ textareaRef, value, setValue })
//   return (
//     <>
//       <textarea ref={textareaRef} value={value} onChange={...} onKeyDown={mention.onKeyDown} onKeyUp={mention.onKeyUp} ... />
//       {mention.dropdown}
//     </>
//   )

let _sendersCache = null   // module-level cache zodat alle DraftEditors delen
let _sendersFetching = null

async function fetchSenders() {
  if (_sendersCache) return _sendersCache
  if (_sendersFetching) return _sendersFetching
  _sendersFetching = (async () => {
    const since = new Date(Date.now() - 180 * 86400 * 1000).toISOString()
    const { data, error } = await supabase
      .from('mail_messages')
      .select('from_email, from_name')
      .gte('received_at', since)
      .order('received_at', { ascending: false })
      .limit(2000)
    if (error) { _sendersFetching = null; return [] }
    // Dedup op from_email, keep first non-empty name
    const map = new Map()
    for (const r of data || []) {
      if (!r.from_email) continue
      const key = r.from_email.toLowerCase()
      const existing = map.get(key)
      if (!existing) {
        map.set(key, { email: r.from_email, name: r.from_name || '' })
      } else if (!existing.name && r.from_name) {
        existing.name = r.from_name
      }
    }
    _sendersCache = Array.from(map.values())
    _sendersFetching = null
    return _sendersCache
  })()
  return _sendersFetching
}

export function useMentionAutocomplete({ textareaRef, value, setValue }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [anchorPos, setAnchorPos] = useState(null) // index in textarea waar @ staat
  const [selected, setSelected] = useState(0)
  const [senders, setSenders] = useState([])
  const dropdownPosRef = useRef({ top: 0, left: 0 })

  // Lazy-fetch senders bij eerste open
  useEffect(() => {
    if (!open) return
    if (senders.length > 0) return
    fetchSenders().then(setSenders)
  }, [open, senders.length])

  // Filter op query
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim()
    if (!q) return senders.slice(0, 8)
    return senders.filter(s =>
      s.email.toLowerCase().includes(q) ||
      (s.name || '').toLowerCase().includes(q)
    ).slice(0, 8)
  }, [senders, query])

  // Reset selected wanneer filter verandert
  useEffect(() => { setSelected(0) }, [query])

  // Detecteer "@..." op cursor positie
  const detectMention = useCallback(() => {
    const el = textareaRef?.current
    if (!el) return
    const pos = el.selectionStart
    if (pos == null) return
    const text = el.value
    // Zoek terug naar laatste @ binnen 30 chars, max tot whitespace
    let at = -1
    for (let i = pos - 1; i >= Math.max(0, pos - 30); i--) {
      const c = text[i]
      if (c === '@') { at = i; break }
      if (c === ' ' || c === '\n' || c === '\t') break
    }
    if (at < 0) {
      if (open) setOpen(false)
      return
    }
    // Geldige mention-start: @ aan begin van text OF voorafgegaan door whitespace
    const prev = at > 0 ? text[at - 1] : '\n'
    if (prev !== ' ' && prev !== '\n' && prev !== '\t' && at !== 0) {
      if (open) setOpen(false)
      return
    }
    const q = text.slice(at + 1, pos)
    // Cancel als query een whitespace bevat
    if (/\s/.test(q)) { if (open) setOpen(false); return }
    setQuery(q)
    setAnchorPos(at)
    if (!open) setOpen(true)
    // Pos van dropdown: vereenvoudigd — onder de textarea-edge, links uitgelijnd.
    // Volledige cursor-positie berekenen vraagt mirror-div trick; voor MVP
    // plaatsen we de dropdown onder de textarea (anchored op .mc-ai-mention-wrap).
    const rect = el.getBoundingClientRect()
    dropdownPosRef.current = { top: rect.top + el.scrollTop + 24, left: rect.left + 8 }
  }, [textareaRef, open])

  const insertMention = useCallback((sender) => {
    if (anchorPos == null) return
    const el = textareaRef?.current
    if (!el) return
    const text = el.value
    const cursorPos = el.selectionStart
    const display = sender.name && sender.name.trim() ? sender.name : sender.email
    const replacement = `@${display} `
    const newText = text.slice(0, anchorPos) + replacement + text.slice(cursorPos)
    setValue(newText)
    setOpen(false)
    // Restore cursor na de inserted mention
    setTimeout(() => {
      if (textareaRef.current) {
        const newPos = anchorPos + replacement.length
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newPos, newPos)
      }
    }, 0)
  }, [anchorPos, textareaRef, setValue])

  const onKeyDown = useCallback((e) => {
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected(s => Math.min(filtered.length - 1, s + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected(s => Math.max(0, s - 1))
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (filtered[selected]) {
        e.preventDefault()
        insertMention(filtered[selected])
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }, [open, filtered, selected, insertMention])

  const onKeyUp = useCallback(() => {
    detectMention()
  }, [detectMention])

  const onClick = useCallback(() => {
    detectMention()
  }, [detectMention])

  const dropdown = open && filtered.length > 0 ? (
    <div
      className="mc-mention-dropdown"
      style={{ top: dropdownPosRef.current.top, left: dropdownPosRef.current.left }}
      role="listbox"
      aria-label="Personen om te taggen"
    >
      {filtered.map((s, i) => (
        <button
          key={s.email}
          type="button"
          role="option"
          aria-selected={i === selected}
          className={`mc-mention-item ${i === selected ? 'mc-mention-item--selected' : ''}`}
          onMouseDown={(e) => { e.preventDefault(); insertMention(s) }}
          onMouseEnter={() => setSelected(i)}
        >
          <span className="mc-mention-avatar" aria-hidden>
            {(s.name?.[0] || s.email[0] || '?').toUpperCase()}
          </span>
          <span className="mc-mention-body">
            <span className="mc-mention-name">{s.name || s.email}</span>
            {s.name && <span className="mc-mention-email">{s.email}</span>}
          </span>
        </button>
      ))}
    </div>
  ) : null

  return { onKeyDown, onKeyUp, onClick, dropdown, open }
}

export default useMentionAutocomplete
