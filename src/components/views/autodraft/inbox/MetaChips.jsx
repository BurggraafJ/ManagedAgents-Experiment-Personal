import { useState, useEffect, useRef } from 'react'
import { popoverItemStyle } from '../../../../lib/autodraft'

// MetaChips — compacte chips voor categorie + doelmap. Klik = popover.
// Folder-popover toont een mappenboom met indents (Outlook-stijl) ipv
// flat datalist; folderTree wordt opgebouwd in MailDetail.
export default function MetaChips({ cat, categoryKey, changeCategory, categories, targetFolder, setTargetFolder, folderOptions, folderTree, busy }) {
  const [openCat, setOpenCat] = useState(false)
  const [openFolder, setOpenFolder] = useState(false)
  const [folderQuery, setFolderQuery] = useState('')
  const catRef = useRef(null)
  const folderRef = useRef(null)

  useEffect(() => {
    function onDocClick(e) {
      if (catRef.current && !catRef.current.contains(e.target)) setOpenCat(false)
      if (folderRef.current && !folderRef.current.contains(e.target)) setOpenFolder(false)
    }
    if (openCat || openFolder) {
      document.addEventListener('mousedown', onDocClick)
      return () => document.removeEventListener('mousedown', onDocClick)
    }
  }, [openCat, openFolder])

  const chipBtn = (active) => ({
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '3px 10px', borderRadius: 999,
    border: '1px solid var(--border)',
    background: active ? 'var(--accent-soft)' : 'var(--bg)',
    color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit',
    fontSize: 11.5, lineHeight: 1.4,
  })
  const popover = {
    position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 6,
    background: 'var(--surface-1)', border: '1px solid var(--border)',
    borderRadius: 8, padding: 6, minWidth: 220,
    boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
  }

  return (
    <div className="mc-meta-chips" style={{
      display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
    }}>
      <div ref={catRef} style={{ position: 'relative' }}>
        <button type="button" disabled={!!busy}
          onClick={() => setOpenCat(v => !v)}
          style={chipBtn(openCat)}
          title={cat?.handling_instructions || 'Categorie wijzigen'}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: cat?.color || 'var(--text-muted)',
          }} />
          <span>{cat?.label || '— ongecategoriseerd —'}</span>
          <span style={{ opacity: 0.6, fontSize: 9 }}>▾</span>
        </button>
        {openCat && (
          <div style={popover}>
            <button type="button"
              onClick={() => { changeCategory(''); setOpenCat(false) }}
              style={popoverItemStyle(categoryKey === '')}>
              — niet gecategoriseerd —
            </button>
            {categories.filter(c => c.active !== false).map(c => (
              <button key={c.category_key} type="button"
                onClick={() => { changeCategory(c.category_key); setOpenCat(false) }}
                style={popoverItemStyle(c.category_key === categoryKey)}>
                <span style={{
                  display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                  background: c.color || 'var(--text-muted)', marginRight: 8,
                }} />
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={folderRef} style={{ position: 'relative' }}>
        <button type="button" disabled={!!busy}
          onClick={() => setOpenFolder(v => !v)}
          style={chipBtn(openFolder)}
          title="Doelmap na verwerken">
          <span aria-hidden>📁</span>
          <span>{targetFolder || cat?.default_target_folder || '— map kiezen —'}</span>
          <span style={{ opacity: 0.6, fontSize: 9 }}>▾</span>
        </button>
        {openFolder && (
          <div style={{ ...popover, minWidth: 320, padding: 8 }}>
            <input type="text" value={folderQuery} onChange={e => setFolderQuery(e.target.value)}
              autoFocus
              placeholder="Zoek map…"
              style={{
                width: '100%', padding: '6px 8px', border: '1px solid var(--border)',
                borderRadius: 4, background: 'var(--bg)', color: 'var(--text)',
                fontFamily: 'inherit', fontSize: 12, marginBottom: 6,
              }} />
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              {(!folderTree || folderTree.length === 0) && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 8px' }}>
                  Geen mappen gesynct.
                </div>
              )}
              {(folderTree || [])
                .filter(f => !folderQuery || f.path.toLowerCase().includes(folderQuery.toLowerCase()))
                .slice(0, 100)
                .map(f => (
                  <button key={f.path} type="button"
                    onClick={() => { setTargetFolder(f.path); setOpenFolder(false); setFolderQuery('') }}
                    style={{
                      ...popoverItemStyle(f.path === targetFolder),
                      paddingLeft: 8 + f.depth * 14,
                    }}
                    title={f.path}>
                    <span style={{ opacity: f.depth > 0 ? 0.55 : 1, marginRight: 6 }}>
                      {f.depth === 0 ? '📂' : '📁'}
                    </span>
                    {f.name}
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>

      {cat?.handling_instructions && (
        <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}
          title={cat.handling_instructions}>ℹ</span>
      )}
    </div>
  )
}
