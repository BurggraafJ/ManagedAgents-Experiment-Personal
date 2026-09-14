import { useRef, useState } from 'react'
import { useContactSuggestions } from '../../../hooks/useContactSuggestions'
import './agenda-attendees.css'

/* AgendaAttendeeField — genodigden kiezen, één component voor desktop én mobiel.
 *
 * Eén bestand om dezelfde reden als `lib/agendaWrite.js`: twee kopieën van een
 * chip-lijst lopen uit elkaar en de helft die achterblijft merk je niet. De
 * `variant` zet alleen de maatvoering (`--sheet` = duimen, dus grotere raakvlakken);
 * het gedrag is op beide schermen identiek.
 *
 * Drie manieren om iemand toe te voegen, want het adresboek is klein (negen
 * contacten) en de mensen met wie je vergadert zijn dat niet:
 *
 *   1. kiezen uit de suggesties (adresboek + genodigden-historie);
 *   2. een adres intikken en op Enter drukken;
 *   3. plakken — komma's, puntkomma's en spaties splitsen, zodat een rijtje uit
 *      een mail in één keer landt.
 *
 * Verwijderen is het kruisje op de chip, en Backspace in een leeg veld haalt de
 * laatste eraf. Dat laatste is het gedrag van elk mailprogramma; wie het niet
 * kent verliest er niets mee, wie het wel kent mist het meteen.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** "Jan de Vries <jan@x.nl>" en "jan@x.nl" leveren allebei hetzelfde adres. */
export function parseEntry(raw) {
  const s = String(raw || '').trim().replace(/^["']|["']$/g, '')
  if (!s) return null
  const angled = s.match(/^(.*)<([^>]+)>$/)
  const email = (angled ? angled[2] : s).trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return null
  const name = angled ? angled[1].trim().replace(/^["']|["']$/g, '') : ''
  return { email, name: name || null, type: 'required' }
}

/** Alles wat als scheidingsteken kan dienen in een geplakt rijtje. */
const SPLIT_RE = /[,;\s]+/

export default function AgendaAttendeeField({
  value = [], onChange, variant = 'pop', disabled = false, label = 'Genodigden',
}) {
  const { query, setQuery, results, loading, reset } = useContactSuggestions()
  const [open, setOpen] = useState(false)
  const inputRef = useRef(null)
  const cls = (base) => `ag-att__${base}${variant === 'sheet' ? ` ag-att__${base}--sheet` : ''}`

  const has = (email) => value.some((a) => a.email === String(email || '').toLowerCase())

  const add = (entries) => {
    const fresh = []
    for (const e of [].concat(entries)) {
      const parsed = typeof e === 'string' ? parseEntry(e) : e
      if (!parsed?.email) continue
      if (has(parsed.email) || fresh.some((f) => f.email === parsed.email)) continue
      fresh.push({ email: parsed.email, name: parsed.name || null, type: parsed.type || 'required' })
    }
    if (fresh.length) onChange?.([...value, ...fresh])
    reset()
    setOpen(false)
  }

  const remove = (email) => onChange?.(value.filter((a) => a.email !== email))

  const commitTyped = () => {
    const parts = query.split(SPLIT_RE).map((p) => p.trim()).filter(Boolean)
    const parsed = parts.map(parseEntry).filter(Boolean)
    if (parsed.length) { add(parsed); return true }
    return false
  }

  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      // Eén suggestie voor de hand? Dan is Enter "die bedoel ik". Anders telt
      // wat er staat als getypt adres.
      if (e.key === 'Enter' && results.length > 0 && !EMAIL_RE.test(query.trim())) {
        e.preventDefault(); add(results[0]); return
      }
      if (commitTyped()) e.preventDefault()
      return
    }
    if (e.key === 'Backspace' && !query && value.length > 0) {
      remove(value[value.length - 1].email)
      return
    }
    if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false) }
  }

  // Bij plakken meteen splitsen: een rijtje adressen uit een mail hoort in één
  // handeling te landen, niet in vijf keer Enter.
  const onPaste = (e) => {
    const text = e.clipboardData?.getData('text') || ''
    if (!SPLIT_RE.test(text)) return
    const parsed = text.split(SPLIT_RE).map((p) => p.trim()).filter(Boolean).map(parseEntry).filter(Boolean)
    if (parsed.length) { e.preventDefault(); add(parsed) }
  }

  const suggestions = results.filter((r) => !has(r.email))
  const typedIsEmail = EMAIL_RE.test(query.trim()) && !has(query.trim().toLowerCase())

  return (
    <div className={cls('wrap')}>
      <span className={cls('label')}>
        {label}
        {value.length > 0 && <em className="ag-att__count">{value.length}</em>}
      </span>

      {value.length > 0 && (
        <ul className={cls('chips')}>
          {value.map((a) => (
            <li key={a.email} className="ag-att__chip" title={a.email}>
              <span className="ag-att__chip-name">{a.name || a.email}</span>
              <button
                type="button"
                className="ag-att__chip-x"
                onClick={() => remove(a.email)}
                disabled={disabled}
                aria-label={`${a.name || a.email} verwijderen`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="ag-att__inputwrap">
        <input
          ref={inputRef}
          className={cls('input')}
          type="text"
          value={query}
          disabled={disabled}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          // Niet meteen sluiten: een klik op een suggestie is eerst een blur.
          onBlur={() => setTimeout(() => setOpen(false), 140)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder="Naam of e-mailadres…"
          autoComplete="off"
          spellCheck={false}
        />
        {open && (suggestions.length > 0 || typedIsEmail) && (
          <ul className={cls('menu')}>
            {typedIsEmail && (
              <li>
                <button type="button" className="ag-att__opt" onMouseDown={(e) => e.preventDefault()} onClick={() => commitTyped()}>
                  <span className="ag-att__opt-name">{query.trim()}</span>
                  <span className="ag-att__opt-src">toevoegen</span>
                </button>
              </li>
            )}
            {suggestions.map((r) => (
              <li key={r.email}>
                <button type="button" className="ag-att__opt" onMouseDown={(e) => e.preventDefault()} onClick={() => add(r)}>
                  <span className="ag-att__opt-name">{r.name || r.email}</span>
                  {r.name && <span className="ag-att__opt-mail">{r.email}</span>}
                  <span className="ag-att__opt-src">{r.source === 'outlook' ? 'contact' : 'agenda'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {open && loading && suggestions.length === 0 && !typedIsEmail && (
          <div className={cls('menu')}><div className="ag-att__empty">Zoeken…</div></div>
        )}
      </div>
    </div>
  )
}
