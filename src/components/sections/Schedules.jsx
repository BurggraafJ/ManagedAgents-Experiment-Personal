function fmt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function Schedules({ schedules }) {
  return (
    <section id="schedules">
      <div className="section__head">
        <h2 className="section__title">Schedules</h2>
        <span className="section__hint">orchestrator-gestuurd · cron in UTC</span>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Cron</th>
              <th>Aan</th>
              <th>Laatste run</th>
              <th>Volgende run</th>
              <th>Slack</th>
            </tr>
          </thead>
          <tbody>
            {schedules.map(s => (
              <tr key={s.agent_name}>
                <td style={{ color: 'var(--text)', fontWeight: 500 }}>
                  {s.is_running && <span className="dot dot--pulse s-running" style={{ marginRight: 8 }} />}
                  {s.display_name || s.agent_name}
                </td>
                <td className="mono">{s.cron_expression || '—'}</td>
                <td>{s.enabled ? <span className="s-success">●</span> : <span className="s-error">uit</span>}</td>
                <td>{fmt(s.last_run_at)}</td>
                <td>{fmt(s.next_run_at)}</td>
                <td>{s.slack_channel ? `#${s.slack_channel}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
