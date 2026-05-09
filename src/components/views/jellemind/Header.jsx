export default function Header({ running, onRun, runMessage, totalPending }) {
  return (
    <div className="panel" style={{ padding: 'var(--s-5) var(--s-6)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)', flexWrap: 'wrap' }}>
        <div
          style={{
            width: 44, height: 44, borderRadius: 12,
            background: 'linear-gradient(135deg, #8b5cf633 0%, #06b6d433 50%, #10b98133 100%)',
            color: '#8b5cf6',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a4 4 0 0 0-4 4v1a4 4 0 0 0-2 7.5V17a3 3 0 0 0 3 3h.5"/>
            <path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1 2 7.5V17a3 3 0 0 1-3 3h-.5"/>
            <path d="M12 6v18"/>
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>JelleMind</h2>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.4, marginTop: 2, marginBottom: 0 }}>
            Drie laden — <strong style={{ color: '#8b5cf6' }}>Jelle</strong> (persoonlijk),{' '}
            <strong style={{ color: '#06b6d4' }}>Legal Mind</strong> (organisatie),{' '}
            <strong style={{ color: '#10b981' }}>Skills</strong> (procesinstructies).{' '}
            {totalPending > 0
              ? <>{totalPending} {totalPending === 1 ? 'voorstel wacht' : 'voorstellen wachten'} op review.</>
              : 'Alles up-to-date.'}
          </p>
        </div>
        <button
          onClick={onRun}
          disabled={running}
          style={{
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: running ? 'var(--bg-2)' : '#8b5cf6',
            color: running ? 'var(--text-muted)' : '#fff',
            fontSize: 13, fontWeight: 600,
            cursor: running ? 'wait' : 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        >
          {running ? '…' : '✨'} Draai jellemind
        </button>
      </div>
      {runMessage && (
        <div
          className="muted"
          style={{
            marginTop: 'var(--s-3)',
            fontSize: 12,
            padding: '6px 10px',
            borderRadius: 6,
            background: 'var(--bg-2)',
            border: '1px solid var(--border)',
          }}
        >
          {runMessage}
        </div>
      )}
    </div>
  )
}
