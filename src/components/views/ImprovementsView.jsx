// Improvements — placeholder voor de komende verbetervoorstellen-pagina.
// Voorlopig een uitnodigend "Coming soon"-paneel met de geplande capabilities.
// Wanneer je 'm gaat bouwen: data leeft al deels in `agent_feedback`,
// `agent_chat_messages` (category='improvement'), en `agent_proposals`.
export default function ImprovementsView({ data }) {
  // Tellen wat er al "klaar staat" om straks te tonen — geeft je een kijkje
  // in hoeveel input je agents al hebben verzameld.
  const feedbackCount = (data?.feedback || []).filter(f => f.status === 'open').length
  const chatImprovementCount = (data?.chat || []).filter(
    c => c.category === 'improvement' && c.status !== 'answered'
  ).length

  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>
      <div
        className="card"
        style={{
          padding: 'var(--s-7)',
          textAlign: 'center',
          background: 'linear-gradient(135deg, var(--bg-2) 0%, var(--bg) 100%)',
          border: '1px dashed var(--border)',
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 'var(--s-3)' }}>🛠️</div>
        <h2 style={{ fontFamily: 'var(--serif)', fontSize: 24, margin: 0, color: 'var(--text)' }}>
          Improvements
        </h2>
        <div className="muted" style={{ marginTop: 'var(--s-2)', fontSize: 14 }}>
          Coming soon
        </div>
        <p style={{ maxWidth: 520, margin: 'var(--s-5) auto 0', color: 'var(--text-dim)', lineHeight: 1.6 }}>
          Hier verzamelen we straks alle <strong>verbetervoorstellen</strong> die agents zelf doen,
          plus jouw eigen ideeën uit de Chat. Per voorstel zie je:
          status, geschiedenis, de agent die het indiende, en een snelknop om het
          te accepteren of door te zetten naar implementatie.
        </p>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 'var(--s-4)' }}>
        <div className="card" style={{ padding: 'var(--s-5)' }}>
          <div className="kpi__label">Open feedback</div>
          <div className="kpi__value" style={{ fontVariantNumeric: 'tabular-nums' }}>{feedbackCount}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            uit <span className="mono">agent_feedback</span> — wachten op verwerking
          </div>
        </div>
        <div className="card" style={{ padding: 'var(--s-5)' }}>
          <div className="kpi__label">Improvement-chats</div>
          <div className="kpi__value" style={{ fontVariantNumeric: 'tabular-nums' }}>{chatImprovementCount}</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            uit <span className="mono">agent_chat_messages</span> · category = improvement
          </div>
        </div>
        <div className="card" style={{ padding: 'var(--s-5)', opacity: 0.6 }}>
          <div className="kpi__label">Auto-suggesties van agents</div>
          <div className="kpi__value" style={{ fontVariantNumeric: 'tabular-nums' }}>—</div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            volgt zodra agents zelf voorstellen kunnen indienen
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 'var(--s-5)' }}>
        <div className="kpi__label" style={{ marginBottom: 'var(--s-3)' }}>Wat komt er ongeveer in?</div>
        <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-dim)', lineHeight: 1.7, fontSize: 13 }}>
          <li>Tijdlijn van wat agents over elkaar of over het systeem rapporteren.</li>
          <li>Filter op agent, type (skill-edit, schedule-tweak, nieuwe feature) en status.</li>
          <li>Eén-klik accepteren — dan komt het bij de juiste agent terecht als open taak.</li>
          <li>Geschiedenis van wat is overgenomen, afgewezen of geparkeerd.</li>
        </ul>
      </div>
    </div>
  )
}
