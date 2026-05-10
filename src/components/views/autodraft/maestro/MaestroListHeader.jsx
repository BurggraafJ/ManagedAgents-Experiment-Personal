// MaestroListHeader — list-pane titel-strook bovenaan de mail-list pane.
//
// Sessie MCM-V4 (2026-05-10) — nieuw component dat tussen tabs-sidebar en
// InboxPanel zit. Mockup `.list-head`-equivalent: toont actieve audience-titel
// + meta-info (totaal pending mails, ongelezen, etc).
//
// HARD-RULE: oude code is leidend. Dit is een Maestro-only nieuwe feature
// bovenop bestaande functionaliteit — InboxPanel + MinimalToolbar blijven
// onaangeroerd. Visuele toevoeging zonder functionele impact.
//
// Mockup-bron: Downloads/Postvak (1).html regel 1599-1616 (.list-head /
// .list-title-row / .list-title / .list-meta).

const TAB_LABELS = {
  for_you:     'Voor jou',
  priority:    'Pin',
  awaiting:    'In afwachting',
  not_for_you: 'Niet voor jou',
  sent_drafts: 'Concepten',
  logs:        'Logs',
}

export default function MaestroListHeader({
  audience = 'for_you',
  pendingTotal = 0,
  audienceCount = null,
}) {
  const title = TAB_LABELS[audience] || 'Postvak'
  const count = audienceCount !== null ? audienceCount : pendingTotal
  const meta = count === 1 ? '1 mail' : `${count} mails`

  return (
    <div className="mcm-list-header">
      <div className="mcm-list-header__row">
        <div className="mcm-list-header__text">
          <h2 className="mcm-list-header__title">{title}</h2>
          <div className="mcm-list-header__meta">{meta}</div>
        </div>
        <button
          type="button"
          className="mcm-list-header__action"
          title="Meer opties (sorteer / filter / weergave)"
          aria-label="Meer opties"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="1"/>
            <circle cx="19" cy="12" r="1"/>
            <circle cx="5"  cy="12" r="1"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
