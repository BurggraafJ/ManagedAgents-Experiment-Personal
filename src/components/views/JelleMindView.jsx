// JelleMind — Jelle's brein-pagina. Wordt nog gebouwd.
//
// De bedoeling: een centrale plek waar Jelle's gedachten, ideeën, notities
// en context samenkomen. Voor agents om uit te lezen, voor Jelle om te
// reflecteren. Concrete invulling volgt later — voor nu placeholder.

export default function JelleMindView() {
  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <div
        className="panel panel--accent-purple"
        style={{ padding: 'var(--s-7) var(--s-6)', textAlign: 'center' }}
      >
        <div
          style={{
            width: 64, height: 64, borderRadius: 16,
            background: 'color-mix(in srgb, var(--panel-accent, #8b5cf6) 20%, var(--bg-2))',
            color: 'var(--panel-accent, #8b5cf6)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto var(--s-4)',
          }}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2a4 4 0 0 0-4 4v1a4 4 0 0 0-2 7.5V17a3 3 0 0 0 3 3h.5"/>
            <path d="M12 2a4 4 0 0 1 4 4v1a4 4 0 0 1 2 7.5V17a3 3 0 0 1-3 3h-.5"/>
            <path d="M12 6v18"/>
          </svg>
        </div>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>JelleMind</h2>
        <p className="muted" style={{ fontSize: 14, lineHeight: 1.5, marginTop: 8, maxWidth: 460, marginInline: 'auto' }}>
          Jouw brein als centrale context — gedachten, ideeën, notities en
          patronen waar de agents uit kunnen lezen. <strong>Wordt nog gebouwd.</strong>
        </p>
        <div className="muted" style={{ fontSize: 12, marginTop: 'var(--s-5)', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: 'var(--bg-2)', borderRadius: 999, border: '1px dashed var(--border)' }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--panel-accent, #8b5cf6)' }} />
          coming soon
        </div>
      </div>
    </div>
  )
}
