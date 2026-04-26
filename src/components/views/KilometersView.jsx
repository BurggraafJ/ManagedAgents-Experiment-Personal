import AgentCard from '../AgentCard'

// Kilometers-view — minimale pagina voor een agent die maar 1× per maand draait.
// Toont gewoon de agent-card (incl. ⋯-menu voor cadence + run-now) plus een
// kort overzicht van recente runs en hoe Jelle handmatig een maand kan
// triggeren via Slack.
export default function KilometersView({ data }) {
  const schedule  = (data.schedules || []).find(s => s.agent_name === 'kilometerregistratie')
  const latestRun = (data.latestRuns || {})['kilometerregistratie']
  const history   = (data.history    || {})['kilometerregistratie'] || []

  // Recente runs uit recentRuns / weekRuns gefilterd op deze agent
  const allRuns = (data.rangeRuns || data.recentRuns || []).filter(
    r => r.agent_name === 'kilometerregistratie'
  ).slice(0, 12)

  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>
      <div className="grid grid--agents">
        <AgentCard
          agent="kilometerregistratie"
          schedule={schedule}
          latestRun={latestRun}
          history={history}
          openQuestions={[]}
        />
      </div>

      <section>
        <div className="section__head">
          <h2 className="section__title">Hoe gebruik ik dit?</h2>
        </div>
        <div className="card" style={{ padding: 'var(--s-5)', lineHeight: 1.6, color: 'var(--text-dim)' }}>
          <p style={{ marginTop: 0 }}>
            Standaard draait de agent op de <strong>2e van elke maand</strong> en verwerkt automatisch
            de vorige maand uit je Outlook-agenda. Ritten + parkeerkosten landen in
            <span className="mono"> reiskosten_2026.xlsx</span>.
          </p>
          <p style={{ marginBottom: 0 }}>
            Wil je een specifieke maand handmatig laten verwerken? Stuur in Slack
            <span className="mono"> #kilometerregistratie</span> een bericht zoals
            <em> "doe maart"</em> of <em>"verwerk april"</em>. De agent pikt het op bij de eerstvolgende
            orchestrator-poll. Of klik op <strong>↻ Run nu</strong> in het ⋯-menu rechts op de kaart hierboven.
          </p>
        </div>
      </section>

      <section>
        <div className="section__head">
          <h2 className="section__title">
            Recente runs <span className="section__count">{allRuns.length}</span>
          </h2>
        </div>
        {allRuns.length === 0 ? (
          <div className="empty">Nog geen recente runs.</div>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            {allRuns.map(r => (
              <div
                key={r.id}
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--border)',
                  display: 'grid',
                  gridTemplateColumns: '110px 1fr 80px',
                  gap: 12,
                  alignItems: 'center',
                  fontSize: 13,
                }}
              >
                <span className="muted mono" style={{ fontSize: 11 }}>
                  {new Date(r.started_at).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
                <span style={{ color: 'var(--text)' }}>{r.summary || '—'}</span>
                <span
                  className={`s-${r.status}`}
                  style={{
                    fontSize: 11, textAlign: 'right', textTransform: 'uppercase',
                    letterSpacing: 0.4, fontWeight: 600,
                  }}
                >
                  {r.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
