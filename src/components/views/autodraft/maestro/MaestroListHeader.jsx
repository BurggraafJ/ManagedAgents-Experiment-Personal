import { useState, useRef, useEffect } from 'react'

// MaestroListHeader — list-pane titel-strook bovenaan de mail-list.
//
// Toont de actieve audience-tab (Voor jou / Star / ...) + mail-count, plus
// een 3-dots dropdown die de RAG-gegevens-modal opent (callback uit parent).

const TAB_LABELS = {
  for_you:     'Voor jou',
  priority:    'Star',
  awaiting:    'In afwachting',
  not_for_you: 'Niet voor jou',
  sent_drafts: 'Concepten',
  logs:        'Logs',
}

export default function MaestroListHeader({
  audience = 'for_you',
  pendingTotal = 0,
  audienceCount = null,
  // Callback die de RagHealthModal opent (mounted in AutoDraftView).
  onOpenRagHealth = null,
}) {
  const title = TAB_LABELS[audience] || 'Postvak'
  const count = audienceCount !== null ? audienceCount : pendingTotal
  const meta = count === 1 ? '1 mail' : `${count} mails`

  const [menuOpen, setMenuOpen] = useState(false)
  const wrapRef = useRef(null)
  useEffect(() => {
    if (!menuOpen) return
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [menuOpen])

  return (
    <div className="mcm-list-header">
      <div className="mcm-list-header__row">
        <div className="mcm-list-header__text">
          <h2 className="mcm-list-header__title">{title}</h2>
          <div className="mcm-list-header__meta">{meta}</div>
        </div>
        <div ref={wrapRef} className="mcm-list-header__menu-wrap">
          <button
            type="button"
            className="mcm-list-header__action"
            title="Meer opties"
            aria-label="Meer opties"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen(v => !v)}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="1"/>
              <circle cx="19" cy="12" r="1"/>
              <circle cx="5"  cy="12" r="1"/>
            </svg>
          </button>
          {menuOpen && (
            <div className="mcm-list-header__menu" role="menu">
              {onOpenRagHealth && (
                <button
                  type="button"
                  role="menuitem"
                  className="mcm-list-header__menu-item"
                  onClick={() => { onOpenRagHealth(); setMenuOpen(false) }}
                  title="Open de wekelijkse RAG-coverage details in een popup"
                >
                  <span className="mcm-list-header__menu-icon" aria-hidden>
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 3v18h18"/>
                      <path d="M7 14l3-3 3 3 5-5"/>
                      <path d="M14 6h5v5"/>
                    </svg>
                  </span>
                  <span className="mcm-list-header__menu-label">
                    RAG-gegevens
                  </span>
                  <span className="mcm-list-header__menu-sub">
                    Wekelijkse coverage-stats van auto-draft
                  </span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
