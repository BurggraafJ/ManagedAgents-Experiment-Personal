import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../../lib/supabase'

/**
 * WritingStylesEditor — beheert rag_chat_writing_styles.
 * Toont alle preset-stijlen (Kort/Standaard/Uitgebreid/Executive + custom),
 * elk met label/description/prompt_addition editable. Save per row.
 * Nieuwe stijl toevoegen via "+ Nieuwe stijl" knop.
 * Gebruikt door /zoeken composer-bar pill-picker.
 */
export default function WritingStylesEditor() {
  const [styles, setStyles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const { data, error: e } = await supabase
      .from('rag_chat_writing_styles')
      .select('*')
      .order('sort_order', { ascending: true })
    if (e) setError(e.message)
    else setStyles(data || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const updateRow = (id, patch) => {
    setStyles(prev => prev.map(s => s.id === id ? { ...s, ...patch, _dirty: true } : s))
  }

  const saveRow = async (row) => {
    setError(null)
    const { error: e } = await supabase
      .from('rag_chat_writing_styles')
      .update({ label: row.label, description: row.description, prompt_addition: row.prompt_addition, sort_order: row.sort_order })
      .eq('id', row.id)
    if (e) setError(e.message)
    else setStyles(prev => prev.map(s => s.id === row.id ? { ...s, _dirty: false, _saved: Date.now() } : s))
  }

  const deleteRow = async (row) => {
    if (!confirm(`"${row.label}" verwijderen?`)) return
    const { error: e } = await supabase.from('rag_chat_writing_styles').delete().eq('id', row.id)
    if (e) setError(e.message)
    else setStyles(prev => prev.filter(s => s.id !== row.id))
  }

  const setDefault = async (row) => {
    setError(null)
    // Unzet alle, zet alleen deze
    await supabase.from('rag_chat_writing_styles').update({ is_default: false }).neq('id', row.id)
    const { error: e } = await supabase.from('rag_chat_writing_styles').update({ is_default: true }).eq('id', row.id)
    if (e) setError(e.message)
    else load()
  }

  const addNew = async () => {
    const slug = prompt('Slug (kort, lowercase, geen spaties):')?.trim()
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) { alert('Slug moet lowercase + cijfers/streepjes'); return }
    const label = prompt('Label (zichtbaar in pill):')?.trim() || slug
    const maxSort = Math.max(0, ...styles.map(s => s.sort_order || 0))
    const { error: e } = await supabase.from('rag_chat_writing_styles').insert({
      slug, label, description: '', prompt_addition: '', sort_order: maxSort + 1,
    })
    if (e) setError(e.message)
    else load()
  }

  return (
    <div className="set-panel" style={{ marginTop: 22, padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div className="set-kcat" style={{ marginTop: 0 }}>Schrijfstijlen voor /zoeken</div>
          <div style={{ fontSize: 12, color: 'var(--set-n-500)' }}>
            Pillen onder de chat-balk. Selectie wijzigt hoe de assistent antwoordt.
          </div>
        </div>
        <button type="button" className="set-btn set-btn--ghost" onClick={addNew}>+ Nieuwe stijl</button>
      </div>

      {error && <div className="set-banner set-banner--err">⚠ {error}</div>}
      {loading && <div className="muted">Laden…</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {styles.map(row => (
          <div key={row.id} style={{ border: '1px solid var(--set-n-200)', borderRadius: 8, padding: 12, background: row.is_default ? '#f5f9ff' : '#fff' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 12, marginBottom: 8 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--set-n-500)', textTransform: 'uppercase' }}>Label</label>
                <input
                  value={row.label || ''}
                  onChange={e => updateRow(row.id, { label: e.target.value })}
                  className="set-input"
                  style={{ width: '100%', marginTop: 2 }}
                />
                <div style={{ fontSize: 10.5, color: 'var(--set-n-400)', marginTop: 4, fontFamily: 'monospace' }}>
                  slug: {row.slug}
                  {row.is_default && <span style={{ marginLeft: 6, color: 'var(--brand, #2563eb)', fontWeight: 600 }}>· default</span>}
                </div>
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--set-n-500)', textTransform: 'uppercase' }}>Korte beschrijving (tooltip)</label>
                <input
                  value={row.description || ''}
                  onChange={e => updateRow(row.id, { description: e.target.value })}
                  className="set-input"
                  placeholder="bv. Beknopt antwoord, max 3 zinnen"
                  style={{ width: '100%', marginTop: 2 }}
                />
              </div>
            </div>

            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--set-n-500)', textTransform: 'uppercase' }}>Prompt-instructie (wordt aan elke vraag gehangen)</label>
            <textarea
              value={row.prompt_addition || ''}
              onChange={e => updateRow(row.id, { prompt_addition: e.target.value })}
              className="set-textarea set-textarea--mono"
              rows={4}
              placeholder="STIJL: Houd het antwoord beknopt. Max 3 zinnen…"
              style={{ width: '100%', marginTop: 2, fontSize: 12 }}
            />

            <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
              <button
                type="button"
                className="set-btn set-btn--primary"
                onClick={() => saveRow(row)}
                disabled={!row._dirty}
                style={{ opacity: row._dirty ? 1 : 0.5 }}
              >
                Opslaan
              </button>
              {!row.is_default && (
                <button type="button" className="set-btn set-btn--ghost" onClick={() => setDefault(row)}>
                  Maak default
                </button>
              )}
              <button type="button" className="set-btn set-btn--ghost" onClick={() => deleteRow(row)} style={{ color: '#991b1b', marginLeft: 'auto' }}>
                Verwijderen
              </button>
              {row._saved && <span style={{ fontSize: 11, color: '#047857', fontWeight: 600 }}>✓ Opgeslagen</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
