import { useMemo, useState } from 'react'

// Administratie-deze-week widget — KPI's uit `agent_proposals` + sales/autodraft.
// Toont een blik op hoe je administratie loopt: hoeveel voorstellen er klaar
// staan, hoeveel je hebt geaccepteerd vs afgewezen, en de acceptatie-ratio.
//
// Range matcht 7/30/90 dagen — handmatig switchen via klein knopje.

const RANGES = [
  { id: '7d',  days: 7,  label: '7d'  },
  { id: '30d', days: 30, label: '30d' },
  { id: '90d', days: 90, label: '90d' },
]

const DAY_MS = 86400000

export default function AdministratieWidget({ proposals, salesTodos, autodraftDecisions }) {
  const [rangeId, setRangeId] = useState('7d')
  const range = RANGES.find(r => r.id === rangeId) || RANGES[0]

  const stats = useMemo(() => {
    const cutoff = Date.now() - range.days * DAY_MS
    const inRange = (iso) => iso && new Date(iso).getTime() >= cutoff

    // Proposals (Daily Admin) — created_at als referentie
    const propsInRange = (proposals || []).filter(p => inRange(p.created_at))
    const accepted  = propsInRange.filter(p => p.status === 'accepted').length
    const amended   = propsInRange.filter(p => p.status === 'amended').length
    const rejected  = propsInRange.filter(p => p.status === 'rejected').length
    const pending   = propsInRange.filter(p => p.status === 'pending').length
    const decided   = accepted + amended + rejected
    const acceptRatio = decided > 0 ? Math.round((accepted / decided) * 100) : null

    // Sales-todos draft_ready
    const todosReady = (salesTodos || []).filter(t => t.status === 'draft_ready').length
    const todosDoneInRange = (salesTodos || []).filter(
      t => t.status === 'sent' && inRange(t.completed_at || t.updated_at)
    ).length

    // AutoDraft beslissingen in range
    const autoSent = (autodraftDecisions || []).filter(
      d => d.action === 'send' && inRange(d.decided_at)
    ).length
    const autoIgnored = (autodraftDecisions || []).filter(
      d => d.action === 'ignore' && inRange(d.decided_at)
    ).length

    return {
      pending, accepted, amended, rejected, decided, acceptRatio,
      todosReady, todosDoneInRange,
      autoSent, autoIgnored,
    }
  }, [proposals, salesTodos, autodraftDecisions, range.days])

  return (
    <section id="administratie">
      <div className="section__head" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 'var(--s-3)' }}>
        <h2 className="section__title">
          <span aria-hidden style={{ marginRight: 6 }}>📋</span>
          Administratie
        </h2>
        <div style={{ display: 'flex', gap: 4 }}>
          {RANGES.map(r => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRangeId(r.id)}
              className="btn btn--ghost"
              style={{
                fontSize: 11,
                padding: '4px 10px',
                background: rangeId === r.id ? 'var(--accent)' : 'transparent',
                color: rangeId === r.id ? 'white' : 'var(--text-muted)',
                borderRadius: 6,
                border: '1px solid var(--border)',
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
        <span className="section__hint" style={{ marginLeft: 'auto' }}>
          voorstellen · todos · auto-drafts
        </span>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 'var(--s-3)' }}>
        <Tile
          icon="📥"
          label="Klaar voor jou"
          value={stats.pending + stats.todosReady}
          hint={`${stats.pending} voorstellen + ${stats.todosReady} sales-drafts wachten op review`}
          accent={stats.pending + stats.todosReady > 5 ? 'warn' : null}
        />
        <Tile
          icon="✅"
          label="Geaccepteerd"
          value={stats.accepted}
          hint={`van de ${stats.decided} beslissingen in deze periode`}
        />
        <Tile
          icon="✍"
          label="Aangepast"
          value={stats.amended}
          hint="amendments — agent leert van jouw correcties"
        />
        <Tile
          icon="🎯"
          label="Acceptatie-ratio"
          value={stats.acceptRatio === null ? '—' : `${stats.acceptRatio}%`}
          hint="accepted / (accepted + amended + rejected)"
          accent={stats.acceptRatio !== null && stats.acceptRatio >= 70 ? 'good' : null}
        />
        <Tile
          icon="📨"
          label="Auto-drafts uit"
          value={stats.autoSent}
          hint="mails verzonden via AutoDraft (niet de afgewezen / amended)"
        />
        <Tile
          icon="📬"
          label="Mails genegeerd"
          value={stats.autoIgnored}
          hint="naar de juiste map verplaatst zonder draft"
        />
      </div>
    </section>
  )
}

function Tile({ icon, label, value, hint, accent }) {
  const accentColor =
    accent === 'good' ? 'var(--success, #16a34a)' :
    accent === 'warn' ? 'var(--warning, #d98f00)' :
    'var(--text)'
  return (
    <div className="card" style={{ padding: 'var(--s-4)' }} title={hint}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span className="kpi__label" style={{ margin: 0 }}>{label}</span>
      </div>
      <div
        className="kpi__value"
        style={{
          fontVariantNumeric: 'tabular-nums',
          fontSize: 28,
          color: accentColor,
        }}
      >
        {value}
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 2, lineHeight: 1.4 }}>
        {hint}
      </div>
    </div>
  )
}
