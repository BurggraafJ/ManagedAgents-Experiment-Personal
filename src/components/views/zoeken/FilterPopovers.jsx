import { useState, useEffect, useRef } from 'react'
import s from './zoeken.module.css'
import { Ico, SOURCE_LABELS } from './Icons'
import { ALL_SOURCES, DATE_PRESETS } from '../../../lib/rag'
import { supabase } from '../../../lib/supabase'

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


// =============================================================================
// Composer-popovers die eerder in ChatMode.jsx stonden (v1.165)
// =============================================================================
// ChatMode stond op 490 regels en daarmee ruim over de 400-regelcap uit
// CLAUDE.md. Deze twee popovers horen bij de composer-bar, net als de drie
// hierboven, en zijn 1-op-1 verplaatst: geen gedragswijziging.
// =============================================================================
// Voorkeuren-popover in de composer-bar. Drie categorieën uit DB:
//   - Schrijfstijl (lengte/vorm)
//   - Toon (formaliteit)
//   - Focus (inhoud-doel)
// Elke selectie wordt direct opgeslagen in localStorage en meegestuurd in body.
export function PreferencesPopover({ open, styles, tones, focuses, style, tone, focus, onPick, onClose, anchorRef }) {
  const popRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const handle = (e) => {
      if (popRef.current?.contains(e.target)) return
      if (anchorRef?.current?.contains(e.target)) return
      onClose?.()
    }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') onClose?.() })
    return () => document.removeEventListener('mousedown', handle)
  }, [open, anchorRef, onClose])
  if (!open) return null
  return (
    <div ref={popRef} className={s.prefsPopover} role="dialog" aria-label="Voorkeuren">
      <PrefGroup title="Schrijfstijl" options={styles} value={style} onPick={(slug) => onPick('style', slug)} />
      <PrefGroup title="Toon"        options={tones}  value={tone}  onPick={(slug) => onPick('tone',  slug)} />
      <PrefGroup title="Focus"       options={focuses} value={focus} onPick={(slug) => onPick('focus', slug)} />
    </div>
  )
}

// Prompt library popover — lijst van voorbeelden uit DB. Klik vult input
// (verstuurt niet) zodat Jelle zelf nog kan tweaken voor versturen.
export function PromptLibraryPopover({ open, items, onPick, onClose, anchorRef }) {
  const popRef = useRef(null)
  useEffect(() => {
    if (!open) return
    const handle = (e) => {
      if (popRef.current?.contains(e.target)) return
      if (anchorRef?.current?.contains(e.target)) return
      onClose?.()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [open, anchorRef, onClose])
  if (!open) return null
  return (
    <div ref={popRef} className={s.libPopover} role="menu" aria-label="Voorbeeld-prompts">
      <div className={s.libHeader}>Voorbeeld-prompts</div>
      {(!items || items.length === 0) ? (
        <div style={{ padding: 12, fontSize: 12, color: 'var(--neutral-400)' }}>Geen voorbeelden ingesteld.</div>
      ) : items.map(item => (
        <button
          key={item.id}
          type="button"
          className={s.libItem}
          onClick={() => onPick(item.prompt_text)}
          role="menuitem"
        >
          <span className={s.libItemLabel}>{item.label}</span>
          <span className={s.libItemPreview}>{item.prompt_text}</span>
        </button>
      ))}
    </div>
  )
}

function PrefGroup({ title, options, value, onPick }) {
  if (!options || options.length === 0) return null
  return (
    <div className={s.prefsGroup}>
      <div className={s.prefsGroupTitle}>{title}</div>
      <div className={s.prefsOptions}>
        {options.map(opt => (
          <button
            key={opt.slug}
            type="button"
            className={`${s.prefsOption} ${value === opt.slug ? s.prefsOptionActive : ''}`}
            onClick={() => onPick(opt.slug)}
            title={opt.description || opt.label}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

