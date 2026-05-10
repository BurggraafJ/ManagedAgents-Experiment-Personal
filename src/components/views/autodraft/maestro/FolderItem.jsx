// FolderItem — recursive folder-tree entry binnen TabsSidebar.
//
// Sessie MCM-V4 (2026-05-10): extract uit AutoDraftMaestroView naar maestro/
// subfolder voor schone code-organisatie analoog aan oude inbox/modals/settings/.
//
// Toont folder-label met inspring per depth-niveau. Klikken doet voorlopig
// niets — folder-filtering is een open vraag (zie Confluence).

export default function FolderItem({ folder, depth = 0 }) {
  return (
    <>
      <button
        type="button"
        className="mcm-tab mcm-tab--folder"
        style={{ paddingLeft: 10 + depth * 16 }}
        title={`Verplaats naar ${folder.label}`}
      >
        <span className="mcm-tab__icon" aria-hidden>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 7a2 2 0 0 1 2-2h7l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"/>
            <path d="M2 11h20"/>
          </svg>
        </span>
        <span className="mcm-tab__label">{folder.label}</span>
      </button>
      {folder.children?.map(child => (
        <FolderItem key={child.id} folder={child} depth={depth + 1} />
      ))}
    </>
  )
}
