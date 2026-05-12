import { useMemo } from 'react'
import FolderItem from './FolderItem'

// MaestroFoldersTree — bouwt een folder-tree uit dezelfde bron als V1's
// MailDetail.jsx folderTree, zodat de mappenindeling in V2 1-op-1
// overeenkomt met de mappen die V1's move-picker toont.
//
// Bronnen (gelijk aan V1):
//   - autodraft_folders.full_path (alles wat we van Outlook hebben gesynced)
//   - autodraft_categories.default_target_folder (target-folders per categorie)
//
// Filter (gelijk aan V1):
//   - skip 'Inbox/Projecten/*' (legacy Outlook-flow)
//
// Render: nested tree per `/`-segment, sort root "Inbox" eerst, dan
// alfabetisch. Fallback-tree wanneer er geen data is.

const FALLBACK_TREE = [
  { id: 'Inbox',                    label: 'Inbox',            fullPath: 'Inbox', children: [] },
  { id: 'Inbox/General Storage',    label: 'General Storage',  fullPath: 'Inbox/General Storage', children: [
    { id: 'Inbox/General Storage/Sales',            label: 'Sales',            fullPath: 'Inbox/General Storage/Sales', children: [] },
    { id: 'Inbox/General Storage/Customer Success', label: 'Customer Success', fullPath: 'Inbox/General Storage/Customer Success', children: [] },
    { id: 'Inbox/General Storage/Juridisch',        label: 'Juridisch',        fullPath: 'Inbox/General Storage/Juridisch', children: [] },
  ]},
  { id: 'Archief', label: 'Archief', fullPath: 'Archief', children: [] },
  { id: 'Spam',    label: 'Spam',    fullPath: 'Spam',    children: [] },
]

const PROJECTS_LEGACY = /^Inbox\/Projecten(\/|$)/i

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
  if (paths.size === 0) return null

  const allEntries = new Map()
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

  roots.sort((a, b) => {
    if (a.label.toLowerCase() === 'inbox') return -1
    if (b.label.toLowerCase() === 'inbox') return 1
    return a.label.localeCompare(b.label)
  })

  function sortChildren(node) {
    node.children.sort((a, b) => a.label.localeCompare(b.label))
    for (const c of node.children) sortChildren(c)
  }
  for (const r of roots) sortChildren(r)

  return roots
}

export default function MaestroFoldersTree({ folders, categories }) {
  const tree = useMemo(() => buildTree(folders, categories), [folders, categories])
  const items = tree && tree.length > 0 ? tree : FALLBACK_TREE

  return (
    <div className="mcm-tabs__nav mcm-tabs__nav--folders">
      {items.map(f => (
        <FolderItem key={f.id} folder={f} />
      ))}
    </div>
  )
}
