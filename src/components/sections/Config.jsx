export default function Config() {
  const items = [
    { label: 'Supabase project', value: 'ezxihctobrqoklufawim', mono: true },
    { label: 'Regio',            value: 'EU-West-1' },
    { label: 'Frontend',         value: 'Vite + React 18' },
    { label: 'Hosting',          value: 'Vercel · auto-deploy via main' },
    { label: 'Realtime',         value: 'Supabase postgres_changes' },
    { label: 'Polling fallback', value: 'elke 2 minuten' },
  ]

  return (
    <section id="config">
      <div className="section__head">
        <h2 className="section__title">Systeem</h2>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        {items.map(i => (
          <div key={i.label} className="card">
            <div className="kpi__label" style={{ marginBottom: 6 }}>{i.label}</div>
            <div className={i.mono ? 'mono' : ''} style={{ color: 'var(--text)' }}>{i.value}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
