import { useState } from 'react'
import { supabase } from '../../../../lib/supabase'

export default function CategoriesBlock({ categories, folders, alwaysOpen }) {
  const [openLocal, setOpen] = useState(!!alwaysOpen)
  const open = alwaysOpen ? true : openLocal
  const [editingKey, setEditingKey] = useState(null)
  return (
    <section className="va-block">
      {alwaysOpen ? (
        <div className="va-block__head" style={{ cursor: 'default' }}>
          <span className="va-block__title">Categorieën</span>
          <span className="va-block__count">{categories.length}</span>
          <span className="muted va-block__hint">kleur · instructies · doelmap · default actie</span>
        </div>
      ) : (
        <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
          <span className="va-block__caret">{open ? '▾' : '▸'}</span>
          <span className="va-block__title">Categorieën</span>
          <span className="va-block__count">{categories.length}</span>
          <span className="muted va-block__hint">kleur · instructies · doelmap · default actie</span>
        </button>
      )}
      {open && (
        <div className="va-block__body">
          <div className="ad-cat-grid">
            {categories.map(c => (
              <button key={c.category_key} type="button"
                className={`ad-cat-chip ${c.active === false ? 'is-off' : ''} ${editingKey === c.category_key ? 'is-selected' : ''}`}
                onClick={() => setEditingKey(c.category_key)}>
                <span className="ad-cat-chip__color" style={{ background: c.color || 'var(--border)' }} />
                <div className="ad-cat-chip__label">{c.label}</div>
                <div className="ad-cat-chip__key mono">{c.category_key}</div>
                <div className="ad-cat-chip__meta">
                  {c.default_action} · {c.default_target_folder || '(geen map)'}
                </div>
              </button>
            ))}
            <button type="button" className="ad-cat-chip ad-cat-chip--new" onClick={() => setEditingKey('__new__')}>
              + nieuwe categorie
            </button>
          </div>
          {editingKey && (
            <CategoryEditor key={editingKey}
              category={editingKey === '__new__' ? null : categories.find(c => c.category_key === editingKey)}
              onDone={() => setEditingKey(null)} folders={folders} />
          )}
        </div>
      )}
    </section>
  )
}

function CategoryEditor({ category, onDone }) {
  const [keyVal, setKeyVal]         = useState(category?.category_key || '')
  const [label, setLabel]           = useState(category?.label || '')
  const [description, setDescr]     = useState(category?.description || '')
  const [instructions, setInstr]    = useState(category?.handling_instructions || '')
  const [folder, setFolder]         = useState(category?.default_target_folder || '')
  const [defaultAction, setDA]      = useState(category?.default_action || 'draft')
  const [active, setActive]         = useState(category?.active !== false)
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState(null)
  const [ok, setOk]     = useState(false)

  async function save() {
    setBusy(true); setErr(null); setOk(false)
    try {
      const { data, error } = await supabase.rpc('upsert_autodraft_category', {
        p_category_key: keyVal, p_label: label, p_description: description,
        p_handling_instructions: instructions, p_default_target_folder: folder || null,
        p_default_action: defaultAction, p_active: active,
        p_sort_order: category?.sort_order ?? 100, p_updated_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
      else { setOk(true); setTimeout(onDone, 600) }
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div className="ad-cat-editor">
      <div className="ad-proposal__edit">
        <label><span>key</span>
          <input value={keyVal} onChange={e => setKeyVal(e.target.value)} className="ad-input"
            disabled={!!category} placeholder="bv. klant_offerte" />
        </label>
        <label><span>label</span><input value={label} onChange={e => setLabel(e.target.value)} className="ad-input" /></label>
        <label style={{ gridColumn: '1 / -1' }}>
          <span>korte beschrijving</span>
          <input value={description} onChange={e => setDescr(e.target.value)} className="ad-input" />
        </label>
        <label style={{ gridColumn: '1 / -1' }}>
          <span>instructies (hoe behandelt de skill dit type mail?)</span>
          <textarea value={instructions} onChange={e => setInstr(e.target.value)} rows={5} className="ad-textarea" />
        </label>
        <label><span>default map</span>
          <input value={folder} onChange={e => setFolder(e.target.value)} className="ad-input" list="ad-folder-suggestions" />
        </label>
        <label><span>default actie</span>
          <select value={defaultAction} onChange={e => setDA(e.target.value)} className="ad-select">
            <option value="draft">draft schrijven</option>
            <option value="skip">negeren/archiveren</option>
            <option value="flag">vraag aan Jelle stellen</option>
          </select>
        </label>
        <label>
          <span>status</span>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> actief
          </label>
        </label>
      </div>
      <div className="ad-proposal__actions">
        <button className="btn btn--accent" disabled={busy || !keyVal || !label} onClick={save}>
          {busy ? 'Opslaan…' : 'Opslaan'}
        </button>
        <button className="btn btn--ghost" onClick={onDone} disabled={busy}>Annuleer</button>
        {ok  && <span style={{ color: 'var(--success)', fontSize: 12 }}>✓ opgeslagen</span>}
        {err && <span style={{ color: 'var(--error)', fontSize: 12 }}>⚠ {err}</span>}
      </div>
    </div>
  )
}
