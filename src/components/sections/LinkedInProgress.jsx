export default function LinkedInProgress({ rows }) {
  if (!rows || rows.length === 0) return null

  return (
    <section id="linkedin">
      <div className="section__head">
        <h2 className="section__title">LinkedIn voortgang</h2>
        <span className="section__hint">laatste {Math.min(15, rows.length)} kantoren</span>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Week</th>
              <th>Kantoor</th>
              <th>Fase</th>
              <th style={{ textAlign: 'right' }}>Verstuurd</th>
              <th style={{ textAlign: 'right' }}>Pending</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 15).map(r => (
              <tr key={`${r.year}-${r.week_number}-${r.company_name}`}>
                <td>{r.week_number}</td>
                <td style={{ color: 'var(--text)' }}>{r.company_name}</td>
                <td>{r.pipeline_stage}</td>
                <td style={{ textAlign: 'right', color: 'var(--accent)' }}>{r.connects_sent ?? 0}</td>
                <td style={{ textAlign: 'right' }}>{r.connects_pending ?? 0}</td>
                <td>{r.batch_completed ? <span className="s-success">● afgerond</span> : <span className="muted">lopend</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
