import { useState, useEffect, useRef } from 'react'
import { popoverItemStyle } from '../../../../lib/autodraft'
import styles from '../autodraft.module.css'

// MetaChips — V8 (2026-05-12): alleen nog FOLDER-chip. Category-chip is
// verhuisd naar MailRow (linker mail-card) zodat Jelle daar direct kan
// switchen zonder eerst naar rechts te springen. Voorheen rendete deze
// component ook een category-popover hier — dat was visueel dubbel naast
// de chip in de row.
//
// Props die hier nog gebruikt worden: cat (alleen voor folder-fallback),
// targetFolder/setTargetFolder, folderTree, busy. categoryKey/changeCategory/
// categories blijven optionele props voor backwards-compat met /postvak
// (oude route die nog wel een category-chip in MetaChips kan willen),
// maar worden niet meer gerenderd standaard.
export default function MetaChips({
  cat, categoryKey, changeCategory, categories,
  targetFolder, setTargetFolder, folderOptions, folderTree, busy,
  // V8: legacy-prop, niet gebruikt — chip is verhuisd. Behouden voor
  // toekomstige "alleen-folder"-mode opt-out.
  showCategory: _showCategory = false,
}) {
  const [openFolder, setOpenFolder] = useState(false)
  const [folderQuery, setFolderQuery] = useState('')
  const folderRef = useRef(null)

  useEffect(() => {
    function onDocClick(e) {
      if (folderRef.current && !folderRef.current.contains(e.target)) setOpenFolder(false)
    }
    if (openFolder) {
      document.addEventListener('mousedown', onDocClick)
      return () => document.removeEventListener('mousedown', onDocClick)
    }
  }, [openFolder])

  return (
    <div className={`mc-meta-chips ${styles.metaChipsRow}`}>
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
