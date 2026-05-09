export default function EmptyState({ hasAnyMails, onScan, scanBusy }) {
  return (
    <div className="ad-empty">
      <div className="ad-empty__icon">📭</div>
      <div className="ad-empty__title">
        {hasAnyMails ? 'Geen mails matchen je filter' : 'Nog geen mails gescand'}
      </div>
      <div className="ad-empty__hint">
        {hasAnyMails
          ? 'Pas de filter-chips of zoekbalk aan.'
          : 'De auto-draft skill haalt je inbox binnen zodra hij draait. Je kan nu triggeren.'}
      </div>
      {!hasAnyMails && (
        <button type="button" className="btn btn--accent" disabled={scanBusy} onClick={onScan}>
          {scanBusy ? 'Wordt aangevraagd…' : '↻ Scan nu'}
        </button>
      )}
    </div>
  )
}
