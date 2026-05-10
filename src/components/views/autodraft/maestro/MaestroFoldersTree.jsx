import { useMemo } from 'react'
import FolderItem from './FolderItem'

// MaestroFoldersTree — bouwt een nested folder-tree uit flat autodraft_folders
// data. Vervangt de statische FOLDER_TREE in TabsSidebar wanneer er real data is.
//
// Sessie MCM-V5 (2026-05-10): nieuwe component voor dynamic folder-binding.
// Gebruikt useAutoDraft.folders prop (rij {full_path, display_name, ...}).
//
// Conventie:
//   - Path "Inbox/General Storage/Sales" wordt nested:
//     Inbox > General Storage > Sales
//   - "Inbox/Projecten/*" (legacy) wordt overgeslagen — zie MailDetail.folderTree
//
// Fallback: als er geen folders data is, render een statische default-tree
// die overeenkomt met Outlook-conventie van Jelle.

const FALLBACK_TREE = [
  { id: 'inbox',     label: 'Inbox' },
  { id: 'general',   label: 'General Storage' },
  { id: 'afdelingen', label: 'Afdelingen', children: [
    { id: 'sales', label: 'Sales' },
    { id: 'cs',    label: 'Customer Success' },
    { id: 'jur',   label: 'Juridisch' },
  ]},
  { id: 'archief',   label: 'Archief' },
  { id: 'spam',      label: 'Spam' },
]

const PROJECTS_LEGACY = /^Inbox\/Projecten(\/|$)/i

function buildTree(folders) {
  if (!folders || folders.length === 0) return null

  // Verzamel unieke paths
  const paths = new Set()
  for (const f of folders) {
    const p = f.full_path || f.display_name
    if (p && !PROJECTS_LEGACY.test(p)) paths.add(p)
  }
  if (paths.size === 0) return null

  // Bouw nested-tree structuur
  // Voor elk path "A/B/C": maak entries voor A, A/B, A/B/C met parent-pointers
  const allEntries = new Map() // pathFromRoot → entry
  for (const path of paths) {
    const parts = path.split('/')
    for (let i = 1; i <= parts.length; i++) {
      const subPath = parts.slice(0, i).join('/')
      if (!allEntries.has(subPath)) {
        allEntries.set(subPath, {
          id: subPath,
          label: parts[i - 1],
          fullPath: subPath,
          children: [],
        })
      }
    }
  }

  // Link children naar parents
  const roots = []
  for (const entry of allEntries.values()) {
    const parts = entry.fullPath.split('/')
    if (parts.length === 1) {
      roots.push(entry)
    } else {
      const parentPath = parts.slice(0, -1).join('/')
      const parent = allEntries.get(parentPath)
      if (parent) parent.children.push(entry)
    }
  }

  // Sort root-level "Inbox" eerst, dan alfabetisch
  roots.sort((a, b) => {
    if (a.label.toLowerCase() === 'inbox') return -1
    if (b.label.toLowerCase() === 'inbox') return 1
    return a.label.localeCompare(b.label)
  })

  // Sort children alfabetisch (recursief)
  function sortChildren(node) {
    node.children.sort((a, b) => a.label.localeCompare(b.label))
    for (const c of node.children) sortChildren(c)
  }
  for (const r of roots) sortChildren(r)

  return roots
}

export default function MaestroFoldersTree({ folders }) {
  const tree = useMemo(() => buildTree(folders), [folders])
  const items = tree && tree.length > 0 ? tree : FALLBACK_TREE

  return (
    <div className="mcm-tabs__nav">
      {items.map(f => (
        <FolderItem key={f.id} folder={f} />
      ))}
    </div>
  )
}
