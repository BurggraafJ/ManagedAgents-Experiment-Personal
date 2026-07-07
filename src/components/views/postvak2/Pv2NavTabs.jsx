import { useEffect, useMemo, useState } from 'react'
import Ic from './pv2Icons'

/* Pv2NavTabs — linker tabs-kolom van Postvak variant 2 (design: .nav).
 *
 * Zoekveld (⌘K) + zes/zeven weergave-tabs met live tellers + mappen-tree
 * (autodraft_folders ∪ categorie-target-folders) die drop-target is voor
 * mail-slepen. Volledig nieuwe styling (.pvk2 .nav-*), functioneel gelijk
 * aan variant 1's TabsSidebar + MaestroFoldersTree.
 */
export const PV2_TABS = [
  // 'voor-jou' = "Inbox": 1:1 het Outlook-postvak (id blijft voor state-
  // compat). Binnen de tab splitst Prioriteit/Overige (review-ronde 2) —
  // de losse "Niet voor jou"-tab is daarin opgegaan als "Overige".
  { id: 'voor-jou', label: 'Inbox', icon: 'inbox' },
  { id: 'pin', label: 'Pin', icon: 'pin' },
  { id: 'wachten-klant', label: 'In afwachting (klanten)', icon: 'hourglass', dot: 'var(--c-klant)' },
  { id: 'wachten-algemeen', label: 'In afwachting (algemeen)', icon: 'hourglass', dot: 'var(--c-overig)' },
  { id: 'drafts', label: 'Concepten', icon: 'edit' },
  { id: 'logs', label: 'Logs', icon: 'log' },
]

const PROJECTS_LEGACY = /^Inbox\/Projecten(\/|$)/i

// Zelfde tree-bron als variant 1 (autodraft_folders + default_target_folder),
// zodat slepen-naar-map exact dezelfde doelen kent.
function buildTree(folders, categories) {
  const paths = new Set()
  for (const f of (folders || [])) {
    const p = f.full_path || f.display_name
    if (p && !PROJECTS_LEGACY.test(p)) paths.add(p)
  }
  for (const c of (categories || [])) {
    const p = c.default_target_folder
    if (p && !PROJECTS_LEGACY.test(p)) paths.add(p)
  }
  const all = new Map()
  for (const path of paths) {
    const parts = path.split('/')
    for (let i = 1; i <= parts.length; i++) {
      const sub = parts.slice(0, i).join('/')
      if (!all.has(sub)) all.set(sub, { id: sub, label: parts[i - 1], children: [] })
    }
  }
  const roots = []
  for (const e of all.values()) {
    const parts = e.id.split('/')
    if (parts.length === 1) roots.push(e)
    else all.get(parts.slice(0, -1).join('/'))?.children.push(e)
  }
  roots.sort((a, b) => {
    if (a.label.toLowerCase() === 'inbox') return -1
    if (b.label.toLowerCase() === 'inbox') return 1
    return a.label.localeCompare(b.label)
  })
  const sortKids = n => { n.children.sort((a, b) => a.label.localeCompare(b.label)); n.children.forEach(sortKids) }
  roots.forEach(sortKids)
  return roots
}

function FolderRow({ folder, depth = 0, dragging, over, setOver, onDropFolder, openMap, toggleOpen }) {
  const hasKids = folder.children.length > 0
  const open = openMap[folder.id] !== undefined ? openMap[folder.id] : depth === 0
  return (
    <>
      <button
        type="button"
        className={`nav-item nav-folder ${dragging ? 'is-droptarget' : ''} ${over === folder.id ? 'is-over' : ''}`}
        style={{ paddingLeft: 11 + depth * 18 + (hasKids ? 0 : 4) }}
        title={dragging ? `Sleep hierop om te verplaatsen naar ${folder.label}` : folder.label}
        onClick={() => hasKids && toggleOpen(folder.id, !open)}
        onDragOver={e => {
          const types = e.dataTransfer?.types || []
          if (dragging || (types.includes && types.includes('application/x-mail-id'))) {
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            if (over !== folder.id) setOver(folder.id)
          }
        }}
        onDragLeave={() => setOver(o => (o === folder.id ? null : o))}
        onDrop={e => {
          e.preventDefault()
          setOver(null)
          const mailId = e.dataTransfer?.getData('application/x-mail-id') || e.dataTransfer?.getData('text/plain')
          if (mailId) onDropFolder(mailId, folder.id, folder.label)
        }}
      >
        {hasKids
          ? <span className="nav-item-icon" style={{ width: 13, transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform .16s var(--ease)' }}><Ic n="chev" s={12}/></span>
          : <span style={{ width: 13, flexShrink: 0 }}/>}
        <span className="nav-item-icon"><Ic n={hasKids && open ? 'folder-open' : 'folder-in'} s={15}/></span>
        <span className="nav-item-label" style={depth > 0 ? { color: 'var(--ink-3)' } : null}>{folder.label}</span>
      </button>
      {hasKids && open && folder.children.map(c => (
        <FolderRow key={c.id} folder={c} depth={depth + 1} dragging={dragging} over={over} setOver={setOver}
                   onDropFolder={onDropFolder} openMap={openMap} toggleOpen={toggleOpen}/>
      ))}
    </>
  )
}

export default function Pv2NavTabs({
  active, setActive, counts = {}, collapsed,
  query = '', setQuery,
  folders = [], categories = [],
  dragging, onDropFolder,
}) {
  const [foldersOpen, setFoldersOpen] = useState(true)
  const [over, setOver] = useState(null)
  const [openMap, setOpenMap] = useState(() => {
    try { return JSON.parse(localStorage.getItem('pvk2-folder-open') || '{}') } catch { return {} }
  })
  const toggleOpen = (id, val) => {
    setOpenMap(prev => {
      const next = { ...prev, [id]: val }
      try { localStorage.setItem('pvk2-folder-open', JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  // Lokale zoekbuffer met debounce naar parent (zelfde gedrag als variant 1).
  const [localQuery, setLocalQuery] = useState(query)
  useEffect(() => { setLocalQuery(query) }, [query])
  useEffect(() => {
    if (!setQuery) return undefined
    const t = setTimeout(() => { if (localQuery !== query) setQuery(localQuery) }, 180)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localQuery])

  const tree = useMemo(() => buildTree(folders, categories), [folders, categories])

  return (
    <aside className={`nav ${collapsed ? 'nav--collapsed' : ''}`}>
      {!collapsed && (
        <div className="nav-search" tabIndex={0}>
          <Ic n="search" s={15}/>
          <input placeholder="Zoek in Postvak…" value={localQuery} onChange={e => setLocalQuery(e.target.value)} aria-label="Zoek in postvak"/>
          <span className="nav-kbd">⌘K</span>
        </div>
      )}
      <div className="nav-section">
        {PV2_TABS.map(t => {
          const cnt = counts[t.id]
          return (
            <button key={t.id} type="button"
                    className={`nav-item ${active === t.id ? 'active' : ''}`}
                    onClick={() => setActive(t.id)} title={t.label}>
              <span className="nav-item-icon">
                {t.dot
                  ? <span style={{ width: 8, height: 8, borderRadius: 9999, background: t.dot, display: 'inline-block' }}/>
                  : <Ic n={t.icon} s={16}/>}
              </span>
              <span className="nav-item-label">{t.label}</span>
              {cnt != null && cnt > 0 && (
                <span className={`nav-item-count ${t.id === 'voor-jou' ? 'alert' : ''}`}>{cnt}</span>
              )}
            </button>
          )
        })}
      </div>
      {!collapsed && (
        <>
          <div className="nav-divider"/>
          <div className={`nav-tree-toggle ${foldersOpen ? '' : 'collapsed'}`} onClick={() => setFoldersOpen(o => !o)}>
            <span className="chev"><Ic n="chev" s={11}/></span><span>Mappen</span>
          </div>
          {foldersOpen && (
            <div className="nav-section" style={{ overflowY: 'auto', minHeight: 0 }}>
              {tree.map(f => (
                <FolderRow key={f.id} folder={f} dragging={dragging} over={over} setOver={setOver}
                           onDropFolder={onDropFolder} openMap={openMap} toggleOpen={toggleOpen}/>
              ))}
            </div>
          )}
        </>
      )}
      <div style={{ flex: 1 }}/>
    </aside>
  )
}
