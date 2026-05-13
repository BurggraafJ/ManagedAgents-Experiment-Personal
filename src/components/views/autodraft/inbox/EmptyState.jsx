// EmptyState — V8.2 (2026-05-13): Maestro-restyle. Geen 📭-emoji meer, maar
// een inline-lucide envelop-icoon (matchend met Postvak-icoon in sidebar) +
// nettere typografie. Twee modi:
//   - hasAnyMails=false → "Nog geen mails gescand" met scan-cta
//   - hasAnyMails=true  → "Geen mails matchen je filter" zonder cta
//
// Renders zelf zonder Maestro-specifieke class — autodraft-maestro.css
// styleert .ad-empty binnen .theme-maestro scope. Op /postvak (oude route)
// blijft de default .ad-empty styling uit index.css gelden.

export default function EmptyState({ hasAnyMails, onScan, scanBusy }) {
  return (
    <div className="ad-empty">
      <div className="ad-empty__icon" aria-hidden>
        <svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h9"/>
          <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
          <circle cx="18" cy="18" r="3"/>
          <path d="m22 22-1.5-1.5"/>
        </svg>
      </div>
      <div className="ad-empty__title">
        {hasAnyMails ? 'Geen mails matchen je filter' : 'Nog geen mails gescand'}
      </div>
      <div className="ad-empty__hint">
        {hasAnyMails
          ? 'Pas de filter-chips of zoekbalk aan om resultaten te zien.'
          : 'De auto-draft skill haalt je inbox binnen zodra hij draait. Trigger de scan om direct te starten.'}
      </div>
      {!hasAnyMails && (
        <button
          type="button"
          className="ad-empty__cta"
          disabled={scanBusy}
          onClick={onScan}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
            <path d="M21 3v5h-5"/>
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
            <path d="M8 16H3v5"/>
          </svg>
          {scanBusy ? 'Wordt aangevraagd…' : 'Scan nu'}
        </button>
      )}
    </div>
  )
}
