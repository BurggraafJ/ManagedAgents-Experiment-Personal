function fmt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function ConfigTab({ schedules }) {
  return (
    <div>
      <h2 style={sectionTitle}>Agent schedules</h2>
      <div style={{ background: '#2B2B2B', border: '1px solid #383838', borderRadius: 6, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#1E1E1E', color: '#888', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              <th style={th}>Agent</th>
              <th style={th}>Cron</th>
              <th style={th}>Aan</th>
              <th style={th}>Laatste run</th>
              <th style={th}>Volgende run</th>
              <th style={th}>Slack</th>
            </tr>
          </thead>
          <tbody>
            {schedules.map(s => (
              <tr key={s.agent_name} style={{ borderTop: '1px solid #383838' }}>
                <td style={{ ...td, color: '#E0E0E0', fontWeight: 500 }}>{s.display_name || s.agent_name}</td>
                <td style={{ ...td, fontFamily: 'monospace', color: '#E86832' }}>{s.cron_expression || '—'}</td>
                <td style={td}>{s.enabled ? '✓' : <span style={{ color: '#d9534f' }}>uit</span>}</td>
                <td style={td}>{fmt(s.last_run_at)}</td>
                <td style={td}>{fmt(s.next_run_at)}</td>
                <td style={td}>{s.slack_channel ? `#${s.slack_channel}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 style={sectionTitle}>Database</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
        <InfoCell label="Supabase project" value="ezxihctobrqoklufawim" mono />
        <InfoCell label="Regio" value="EU-West-1" />
        <InfoCell label="Frontend" value="Vite + React 18" />
        <InfoCell label="Hosting" value="Vercel (auto-deploy via main)" />
      </div>
    </div>
  )
}

function InfoCell({ label, value, mono }) {
  return (
    <div style={{ background: '#2B2B2B', border: '1px solid #383838', borderRadius: 6, padding: '14px 18px' }}>
      <div style={{ color: '#666', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{label}</div>
      <div style={{ color: '#E0E0E0', fontSize: 14, fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</div>
    </div>
  )
}

const sectionTitle = { color: '#E0E0E0', fontWeight: 400, fontSize: 15, letterSpacing: '0.3px', margin: '0 0 14px', textTransform: 'uppercase' }
const th = { textAlign: 'left', padding: '10px 14px', fontWeight: 500 }
const td = { padding: '10px 14px', color: '#bbb' }
