import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../../lib/supabase'
import { ENTITY_TYPES } from '../../../lib/rag'

// EntityPicker — autocomplete voor company/contact/deal als hard-filter op zoekresultaten.
export default function EntityPicker({ entityType, onTypeChange, selectedEntity, onSelect }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [loading, setLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const debounceRef = useRef(null)
  const wrapperRef = useRef(null)

  useEffect(() => {
    const onClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setShowDropdown(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  useEffect(() => {
    if (entityType === 'none' || !searchQuery || searchQuery.length < 2) {
      setSuggestions([])
      return
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        let result = []
        if (entityType === 'company') {
          const { data } = await supabase.from('hubspot_companies')
            .select('company_id, name, domain').ilike('name', `%${searchQuery}%`).limit(10)
          result = (data ?? []).map(r => ({ id: r.company_id, label: r.name, sub: r.domain }))
        } else if (entityType === 'contact') {
          const { data } = await supabase.from('hubspot_contacts')
            .select('contact_id, firstname, lastname, email, jobtitle')
            .or(`firstname.ilike.%${searchQuery}%,lastname.ilike.%${searchQuery}%,email.ilike.%${searchQuery}%`)
            .limit(10)
          result = (data ?? []).map(r => ({
            id: r.contact_id,
            label: [r.firstname, r.lastname].filter(Boolean).join(' ') || r.email,
            sub: r.email + (r.jobtitle ? ` · ${r.jobtitle}` : ''),
          }))
        } else if (entityType === 'deal') {
          const { data } = await supabase.from('hubspot_deals')
            .select('deal_id, dealname, dealstage, amount')
            .ilike('dealname', `%${searchQuery}%`).eq('is_archived', false).limit(10)
          result = (data ?? []).map(r => ({
            id: r.deal_id, label: r.dealname,
            sub: r.dealstage + (r.amount ? ` · €${r.amount}` : ''),
          }))
        }
        setSuggestions(result)
        setShowDropdown(true)
      } finally { setLoading(false) }
    }, 250)
    return () => debounceRef.current && clearTimeout(debounceRef.current)
  }, [entityType, searchQuery])

  if (selectedEntity) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
        <span>Entity:</span>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', borderRadius: 4,
          background: 'var(--bg-input, rgba(0,0,0,0.05))',
          border: '1px solid var(--text-muted)', color: 'var(--text)',
        }}>
          <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, fontSize: 10 }}>
            {selectedEntity.type}
          </span>
          <span>{selectedEntity.label}</span>
          <button type="button" onClick={() => onSelect(null)} style={{
            background: 'none', border: 'none', color: 'var(--text-muted)',
            cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1,
          }} title="Reset entity-filter">✕</button>
        </span>
      </div>
    )
  }

  return (
    <div ref={wrapperRef} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', position: 'relative' }}>
      <span>Entity:</span>
      <select value={entityType} onChange={(e) => { onTypeChange(e.target.value); setSearchQuery(''); setSuggestions([]); }}
        style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-input, var(--bg))', color: 'var(--text)', fontSize: 12 }}>
        {ENTITY_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
      {entityType !== 'none' && (
        <>
          <input type="text" value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
            placeholder={`zoek ${entityType}…`}
            style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-input, var(--bg))', color: 'var(--text)', fontSize: 12, width: 220 }}
          />
          {loading && <span style={{ fontSize: 11 }}>…</span>}
          {showDropdown && suggestions.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 60, marginTop: 4,
              background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 10,
              minWidth: 320, maxHeight: 320, overflowY: 'auto',
            }}>
              {suggestions.map((item) => (
                <button key={item.id} type="button"
                  onClick={() => { onSelect({ type: entityType, id: item.id, label: item.label, sub: item.sub }); setSearchQuery(''); setShowDropdown(false); }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', border: 'none', background: 'transparent', cursor: 'pointer', borderBottom: '1px solid var(--border)', color: 'var(--text)', fontSize: 12 }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-input, rgba(0,0,0,0.05))'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                  <div style={{ fontWeight: 500 }}>{item.label}</div>
                  {item.sub && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.sub}</div>}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
