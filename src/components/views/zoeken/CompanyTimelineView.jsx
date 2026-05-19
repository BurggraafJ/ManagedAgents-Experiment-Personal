import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../lib/supabase'
import CompanyTimeline from '../autodraft/inbox/CompanyTimeline'
import contactStyles from '../contacten/ContactenView.module.css'
import styles from './zoeken.module.css'

/**
 * CompanyTimelineView — 4e mode op Zoekpagina (V9.8).
 *
 * Tikt een HubSpot-company (zoekt in hubspot_companies op name + domain),
 * krijgt de complete company-tijdlijn: mails + meetings + notes van ALLE
 * contactpersonen die aan die company gekoppeld zijn, met attribution-
 * badge "via [contact]" per item.
 *
 * Notes default AAN op company-niveau (94% van notes leeft daar).
 */
export default function CompanyTimelineView() {
  const [company, setCompany] = useState(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Live search via search_companies RPC (V9.9 — consistent met
  // search_contactpersonen-pattern; vervangt inline ilike-query).
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); setOpen(false); return }
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const { data, error } = await supabase.rpc('search_companies', {
          query: query.trim(),
          limit_n: 8,
        })
        if (error) throw error
        setResults(data || [])
        setOpen((data || []).length > 0)
        setActiveIdx(-1)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [query])

  function pick(c) {
    if (!c) return
    setQuery(c.name || c.domain || '')
    setOpen(false)
    setCompany(c)
  }

  function onKeyDown(e) {
    if (!open) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, -1)) }
    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); pick(results[activeIdx]) }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div className={styles.contactTimelineWrap}>
      <div className={styles.contactTimelineSearch}>
        <label className={styles.contactTimelineLabel}>Company zoeken (HubSpot)</label>
        <div className={contactStyles.autocompleteWrap}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => results.length && setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={onKeyDown}
            placeholder="Tik naam of domain — minstens 2 tekens…"
            style={{ width: '100%' }}
          />
          {open && (
            <div className={contactStyles.autocompletePopup}>
              {loading && <div className={contactStyles.autocompleteHint}>Zoeken…</div>}
              {!loading && results.map((r, i) => (
                <div
                  key={r.company_id}
                  onMouseDown={() => pick(r)}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={contactStyles.autocompleteRow}
                  data-active={i === activeIdx ? '1' : '0'}
                  style={{ cursor: 'pointer' }}
                >
                  <div className={contactStyles.autocompleteName}>
                    {r.name || '—'}{r.domain && <span style={{ marginLeft: 6, opacity: 0.6, fontWeight: 400 }}>· {r.domain}</span>}
                  </div>
                  {(r.industry || r.city || r.lifecyclestage) && (
                    <div className={contactStyles.autocompleteSub}>
                      {[r.industry, r.city, r.country, r.lifecyclestage].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {company && (
          <div className={styles.contactTimelineSelected}>
            <div className={styles.contactTimelineSelectedInfo}>
              <div className={styles.contactTimelineSelectedName}>🏢 {company.name || '—'}</div>
              <div className={styles.contactTimelineSelectedMeta}>
                {company.domain && <span>{company.domain}</span>}
                {company.industry && <span> · {company.industry}</span>}
                {company.lifecyclestage && <span> · {company.lifecyclestage}</span>}
                {company.city && <span> · {company.city}</span>}
              </div>
            </div>
            <button type="button" onClick={() => { setCompany(null); setQuery('') }}
              className={styles.contactTimelineClear}>
              × Andere kiezen
            </button>
          </div>
        )}
      </div>

      {!company ? (
        <div className={styles.contactTimelineEmpty}>
          <div className={styles.contactTimelineEmptyIcon}>🏢</div>
          <div className={styles.contactTimelineEmptyTitle}>Tik een company om de tijdlijn te zien</div>
          <div className={styles.contactTimelineEmptySub}>
            Alle mails, meetings en HubSpot-notes van ALLE contactpersonen die aan die company gekoppeld zijn.
            Per item zie je "via [naam]" zodat duidelijk is wie van het bedrijf erbij betrokken was.
          </div>
        </div>
      ) : (
        <div className={styles.contactTimelinePanel}>
          <CompanyTimeline company={company} />
        </div>
      )}
    </div>
  )
}
