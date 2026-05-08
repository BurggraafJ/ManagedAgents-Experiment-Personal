import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { CONTACT_TYPE_LABEL } from '../../lib/contacten'
import styles from '../views/contacten/ContactenView.module.css'

/**
 * ContactAutocomplete — herbruikbare contactpersoon-autocomplete.
 *
 * Roept search_contactpersonen RPC aan bij ≥2 tekens (200ms debounce).
 * Klaar voor inbouw in mail-compose, recruitment-forms, sales-on-road, etc.
 *
 * Props:
 *  - value         (string)            — initial text (default '')
 *  - onSelect      (contact) => void   — gekozen contact-row
 *  - placeholder   (string)            — input placeholder
 *  - filterType    (string|null)       — beperk resultaten tot één contact_type
 *  - limit         (number)            — max resultaten (default 8)
 *  - autoFocus     (boolean)
 */
export default function ContactAutocomplete({
  value = '',
  onSelect,
  placeholder = 'Zoek contactpersoon…',
  filterType = null,
  limit = 8,
  autoFocus = false,
}) {
  const [query, setQuery] = useState(value)
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([])
      setOpen(false)
      return
    }
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const { data, error } = await supabase.rpc('search_contactpersonen', {
          query: query.trim(),
          limit_n: limit,
          filter_type: filterType,
        })
        if (error) throw error
        setResults(data || [])
        setOpen((data || []).length > 0)
        setActiveIdx(-1)
      } catch {
        // Silent fallback — geen results
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [query, filterType, limit])

  function pick(c) {
    if (!c) return
    setQuery(c.email)
    setOpen(false)
    onSelect?.(c)
  }

  function handleKeyDown(e) {
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, -1))
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault()
      pick(results[activeIdx])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className={styles.autocompleteWrap}>
      <input
        type="text"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        style={{ width: '100%' }}
      />
      {open && (
        <div className={styles.autocompletePopup}>
          {loading && <div className={styles.autocompleteHint}>Zoeken…</div>}
          {!loading && results.map((r, i) => (
            <div
              key={r.id}
              onMouseDown={() => pick(r)}
              onMouseEnter={() => setActiveIdx(i)}
              className={styles.autocompleteRow}
              data-active={i === activeIdx ? '1' : '0'}
            >
              <div className={styles.autocompleteName}>{r.display_naam}</div>
              <div className={styles.autocompleteSub}>
                {r.email}{r.firm_naam ? ` · ${r.firm_naam}` : ''}
                {r.contact_type && r.contact_type !== 'overig' && (
                  <span style={{ marginLeft: 8, opacity: 0.7 }}>· {CONTACT_TYPE_LABEL[r.contact_type] || r.contact_type}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
