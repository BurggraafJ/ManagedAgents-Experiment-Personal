import { useState, useEffect, useRef } from 'react'
import { popoverItemStyle } from '../../../../lib/autodraft'
import styles from '../autodraft.module.css'

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

  return (
    <div className={`mc-meta-chips ${styles.metaChipsRow}`}>
      <div ref={catRef} className={styles.metaChipWrap}>
        <button type="button" disabled={!!busy}
          onClick={() => setOpenCat(v => !v)}
          className={`${styles.metaChip} ${openCat ? styles.metaChipActive : ''}`}
          title={cat?.handling_instructions || 'Categorie wijzigen'}>
          <span className={styles.metaChipDot} style={{ background: cat?.color || 'var(--text-muted)' }} />
          <span>{cat?.label || '— ongecategoriseerd —'}</span>
          <span className={styles.metaChipCaret}>▾</span>
        </button>
        {openCat && (
          <div className={styles.metaPopover}>
            <button type="button"
              onClick={() => { changeCategory(''); setOpenCat(false) }}
              style={popoverItemStyle(categoryKey === '')}>
              — niet gecategoriseerd —
            </button>
            {categories.filter(c => c.active !== false).map(c => (
              <button key={c.category_key} type="button"
                onClick={() => { changeCategory(c.category_key); setOpenCat(false) }}
                style={popoverItemStyle(c.category_key === categoryKey)}>
                <span className={styles.metaCatDotInline} style={{ background: c.color || 'var(--text-muted)' }} />
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={folderRef} className={styles.metaChipWrap}>
        <button type="button" disabled={!!busy}
          onClick={() => setOpenFolder(v => !v)}
          className={`${styles.metaChip} ${openFolder ? styles.metaChipActive : ''}`}
          title="Doelmap na verwerken">
          <span aria-hidden>📁</span>
          <span>{targetFolder || cat?.default_target_folder || '— map kiezen —'}</span>
          <span className={styles.metaChipCaret}>▾</span>
        </button>
        {openFolder && (
          <div className={`${styles.metaPopover} ${styles.metaPopoverWide}`}>
            <input type="text" value={folderQuery} onChange={e => setFolderQuery(e.target.value)}
              autoFocus
              placeholder="Zoek map…"
              className={styles.metaPopoverSearch} />
            <div className={styles.metaFolderList}>
              {(!folderTree || folderTree.length === 0) && (
                <div className={styles.metaFolderEmpty}>
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
                    <span className={styles.metaFolderIcon} style={{ opacity: f.depth > 0 ? 0.55 : 1 }}>
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
        <span className={styles.metaInstrIcon}
          title={cat.handling_instructions}>ℹ</span>
      )}
    </div>
  )
}
