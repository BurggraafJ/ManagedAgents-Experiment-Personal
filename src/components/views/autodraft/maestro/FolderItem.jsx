import { useState, useEffect } from 'react'

// FolderItem — recursive folder-tree entry binnen TabsSidebar.
//
// V8.7 (2026-05-13): folders met children krijgen een ▾/▸ chevron en
// kunnen in/uitgeklapt worden. State wordt per fullPath bewaard in
// localStorage 'mcm-folder-open' (JSON map) zodat de keuze tussen
// refreshes blijft.
//
// Folders zonder children blijven plain buttons (geen chevron).

const STORAGE_KEY = 'mcm-folder-open'

function loadOpenState() {
  if (typeof localStorage === 'undefined') return {}
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch { return {} }
}
function saveOpenState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch {}
}

// Module-level cache zodat alle FolderItem-instances dezelfde map zien
// en re-renders niet door localStorage hoeven. Wordt na elke toggle
// bijgewerkt + naar localStorage gepersist.
let openCache = null

export default function FolderItem({ folder, depth = 0, defaultOpen = true }) {
  const hasChildren = Array.isArray(folder.children) && folder.children.length > 0
  if (openCache === null) openCache = loadOpenState()

  // Initial-open: bij eerste niveau (depth=0) default open; daaronder default
  // dicht zodat de lijst beheersbaar blijft. localStorage overrult default.
  const key = folder.fullPath || folder.id
  const persisted = openCache[key]
  const initialOpen = persisted !== undefined
    ? !!persisted
    : (depth === 0 ? defaultOpen : false)
  const [open, setOpen] = useState(initialOpen)

  // Sync localStorage telkens als deze folder geopend/gesloten wordt.
  useEffect(() => {
    if (!hasChildren) return  // bladeren hebben geen open-state
    openCache[key] = open
    saveOpenState(openCache)
  }, [open, hasChildren, key])

  function toggle() {
    if (hasChildren) setOpen(v => !v)
    // Voor blad-folders: klik doet voorlopig niets functioneels — folder-
    // filtering is een open vraag (zie V4 comment).
  }

  return (
    <>
      <button
        type="button"
        className={`mcm-tab mcm-tab--folder ${hasChildren ? 'mcm-tab--folder-parent' : ''} ${open ? 'mcm-tab--folder-open' : ''}`}
        // V8.9 (2026-05-13): indent vergroot van 16 → 22px per niveau (Outlook-stijl).
        // Leaf-folders krijgen +6px zodat ze duidelijk verder rechts staan dan
        // parents op dezelfde depth — visueel onderscheid op klikbaarheid.
        style={{ paddingLeft: 10 + depth * 22 + (hasChildren ? 0 : 6) }}
        title={hasChildren
          ? `${folder.label} — klik om in/uit te klappen`
          : `Verplaats naar ${folder.label}`}
        onClick={toggle}
        aria-expanded={hasChildren ? open : undefined}
      >
        {hasChildren ? (
          <span className="mcm-tab__chev" aria-hidden>
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </span>
        ) : (
          // Spacer met zelfde breedte als chev zodat blad-folders inlijnen
          <span className="mcm-tab__chev mcm-tab__chev--spacer" aria-hidden />
        )}
        <span className="mcm-tab__icon" aria-hidden>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            {hasChildren && open ? (
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
            ) : (
              <>
                <path d="M2 7a2 2 0 0 1 2-2h7l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"/>
                <path d="M2 11h20"/>
              </>
            )}
          </svg>
        </span>
        <span className="mcm-tab__label">{folder.label}</span>
      </button>
      {hasChildren && open && folder.children.map(child => (
        <FolderItem key={child.id} folder={child} depth={depth + 1} />
      ))}
    </>
  )
}
