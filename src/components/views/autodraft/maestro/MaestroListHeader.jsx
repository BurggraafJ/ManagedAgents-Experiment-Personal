import { useState, useRef, useEffect } from 'react'

// MaestroListHeader — list-pane titel-strook bovenaan de mail-list pane.
//
// V8.4 (2026-05-13): 3-dots is nu een dropdown-trigger. Bevat één menu-item:
// "Toon RAG-coverage" (toggle). State + callback komen via props van
// AutoDraftMaestroView; InboxPanel rendert RagHealthPanel alleen als
// showRagHealth=true.
//
// Mockup-bron: Downloads/Postvak (1).html .list-head / .list-title-row.

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
  // V8.4: nieuwe props voor RAG-toggle. Default false/no-op zodat de oude
  // /postvak route (zonder maestro) onaangetast blijft.
  showRagHealth = false,
  onToggleRagHealth = null,
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
              {onToggleRagHealth && (
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={showRagHealth}
                  className={`mcm-list-header__menu-item ${showRagHealth ? 'mcm-list-header__menu-item--active' : ''}`}
                  onClick={() => { onToggleRagHealth(!showRagHealth); setMenuOpen(false) }}
                  title="Toon de wekelijkse RAG-coverage banner boven de mail-list"
                >
                  <span className="mcm-list-header__menu-check" aria-hidden>
                    {showRagHealth ? (
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m9 12 2 2 4-4"/>
                      </svg>
                    ) : null}
                  </span>
                  <span className="mcm-list-header__menu-label">
                    Toon RAG-coverage
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
