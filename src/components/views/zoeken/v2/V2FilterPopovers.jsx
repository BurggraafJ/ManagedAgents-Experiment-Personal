import { useState, useEffect, useRef } from 'react'
import s from './zoeken-v2.module.css'
import { Ico, SOURCE_LABELS } from './V2Icons'
import { ALL_SOURCES, DATE_PRESETS } from '../../../../lib/rag'
import { supabase } from '../../../../lib/supabase'

// Drie popovers die de chat-composer-tags vullen. Compact + scoped onder
// .zkApp tokens. Sluiten op klik-outside of Esc.

function useOutside(refs, onClose, enabled) {
  useEffect(() => {
    if (!enabled) return
    function onDoc(e) {
      if (refs.some(r => r.current?.contains(e.target))) return
      onClose()
    }
    function onKey(e) { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [refs, onClose, enabled])
}

// ============ Sources popover ============
export function SourcesPopover({ open, value, onChange, onClose, anchorRef }) {
  const popRef = useRef(null)
  useOutside([popRef, anchorRef], onClose, open)
  if (!open) return null
  const isAll = !value || value.length === 0 || value.length === ALL_SOURCES.length
  const toggle = (src) => {
    const set = new Set(value || [])
    if (set.has(src)) set.delete(src)
    else set.add(src)
    if (set.size === 0 || set.size === ALL_SOURCES.length) onChange([])
    else onChange([...set])
  }
  return (
    <div ref={popRef} className={s.advPop} style={{ top: 'auto', bottom: '38px', right: 'auto', left: 0, width: 240 }}>
      <div className={s.advRow}>
        <label>Bronnen ({isAll ? 'alle' : value.length})</label>
        {!isAll && (
          <button type="button" className={s.advReset} onClick={() => onChange([])}>reset</button>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        {ALL_SOURCES.map(src => {
          const checked = isAll || (value || []).includes(src)
          return (
            <label key={src} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 6, cursor: 'pointer', fontSize: 12.5 }}>
              <input type="checkbox" checked={checked} onChange={() => toggle(src)} style={{ accentColor: 'var(--orange)' }} />
              {SOURCE_LABELS[src] || src}
            </label>
          )
        })}
      </div>
      <div className={s.advNote}>Leeg = alle bronnen meenemen.</div>
    </div>
  )
}

// ============ Period popover ============
export function PeriodPopover({ open, value, onChange, onClose, anchorRef }) {
  const popRef = useRef(null)
  useOutside([popRef, anchorRef], onClose, open)
  if (!open) return null
  return (
    <div ref={popRef} className={s.advPop} style={{ top: 'auto', bottom: '38px', right: 'auto', left: 0, width: 200 }}>
      <div className={s.advRow}><label>Periode</label></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {DATE_PRESETS.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => { onChange(p.id); onClose() }}
            className={s.popPickBtn}
            data-active={value === p.id ? '1' : '0'}
          >
            <span>{p.label}</span>
            {value === p.id && <span style={{ color: 'var(--orange)' }}>✓</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

// ============ Entity popover ============
export function EntityPopover({ open, value, onChange, onClose, anchorRef }) {
  const popRef = useRef(null)
  useOutside([popRef, anchorRef], onClose, open)
  const [kind, setKind] = useState(value?.type || 'company')
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30) }, [open])
  useEffect(() => {
    if (!open) return
    const trimmed = q.trim()
    if (trimmed.length < 2) { setResults([]); return }
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        let rows = []
        if (kind === 'company') {
          const { data } = await supabase.rpc('search_companies', { query: trimmed, limit_n: 8 })
          rows = (data || []).map(r => ({ type: 'company', id: r.company_id, label: r.name || r.domain || '—', sub: r.domain }))
        } else if (kind === 'contact') {
          const { data } = await supabase.rpc('search_contactpersonen', { query: trimmed, limit_n: 8 })
          rows = (data || []).map(r => ({
            type: 'contact',
            id: r.hubspot_contact_id || r.contact_id,
            label: r.display_naam || `${r.voornaam || ''} ${r.achternaam || ''}`.trim() || r.email || '—',
            sub: [r.firm_naam, r.email].filter(Boolean).join(' · '),
          })).filter(r => r.id)
        } else if (kind === 'deal') {
          const { data } = await supabase.from('hubspot_deals')
            .select('deal_id, dealname, dealstage, amount')
            .ilike('dealname', `%${trimmed}%`).eq('is_archived', false).limit(8)
          rows = (data || []).map(r => ({
            type: 'deal',
            id: r.deal_id,
            label: r.dealname,
            sub: [r.dealstage, r.amount ? `€ ${r.amount}` : null].filter(Boolean).join(' · '),
          }))
        }
        setResults(rows)
      } catch (e) {
        console.error('entity popover search', e)
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [q, kind, open])

  if (!open) return null
  return (
    <div ref={popRef} className={s.advPop} style={{ top: 'auto', bottom: '38px', right: 'auto', left: 0, width: 320 }}>
      <div className={s.advRow}>
        <label>Entity-filter</label>
        {value && (
          <button type="button" className={s.advReset} onClick={() => { onChange(null); onClose() }}>reset</button>
        )}
      </div>
      <div className={s.entityKindRow}>
        {['company', 'contact', 'deal'].map(k => (
          <button key={k} type="button"
                  className={s.entityKindBtn}
                  data-active={kind === k ? '1' : '0'}
                  onClick={() => { setKind(k); setQ(''); setResults([]) }}>
            {k === 'company' ? 'Bedrijf' : k === 'contact' ? 'Contact' : 'Deal'}
          </button>
        ))}
      </div>
      <input
        ref={inputRef}
        type="text"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder={`Zoek ${kind === 'company' ? 'bedrijf' : kind === 'contact' ? 'contact' : 'deal'} — minstens 2 tekens…`}
        className={s.popInput}
      />
      {searching && <div className={s.advNote}>Zoeken…</div>}
      {!searching && q.trim().length >= 2 && results.length === 0 && (
        <div className={s.advNote}>Niets gevonden.</div>
      )}
      {results.length > 0 && (
        <div className={s.popList}>
          {results.map(r => (
            <button key={`${r.type}-${r.id}`} type="button"
                    className={s.popListItem}
                    onClick={() => { onChange(r); onClose() }}>
              <div className={s.popListLabel}>{r.label}</div>
              {r.sub && <div className={s.popListSub}>{r.sub}</div>}
            </button>
          ))}
        </div>
      )}
      <div className={s.advNote}>Beperkt retrieval tot deze entity (1-hop chunks).</div>
    </div>
  )
}

// ============ Tag-rendering helper ============
export function ChatFilterTag({ icon, label, active, onClick, anchorRef }) {
  return (
    <button
      type="button"
      ref={anchorRef}
      className={`${s.composerTag} ${active ? s.composerTagActive : ''}`}
      onClick={onClick}
    >
      {icon}
      {label}
      {active && <span style={{ marginLeft: 4 }}>{Ico.close}</span>}
    </button>
  )
}
