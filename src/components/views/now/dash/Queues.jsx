import Icon from '../Icon'

// Wachtrij-kaarten: Administratie / Taken / Postvak. Per kaart een progress-
// ring (verwerkt vandaag vs nog open), een split-teller, een preview van het
// volgende item en een CTA. Data uit useDashboard().queues.

const RING_CIRCUMFERENCE = 2 * Math.PI * 24 // r=24 → ~150.8

function QueueIcon({ name }) {
  if (name === 'admin') return <Icon size={18}><path d="M3 21h18" /><path d="M5 21V7l7-4 7 4v14" /><rect x="9" y="11" width="6" height="10" /></Icon>
  if (name === 'taken') return <Icon size={18}><rect x="4" y="4" width="16" height="18" rx="2" /><path d="M9 2h6v4H9z" /><path d="m9 14 2 2 4-4" /></Icon>
  return <Icon size={18}><path d="M3 7h18v12H3z" /><path d="M3 7l9 7 9-7" /></Icon>
}

function QueueCard({ q, goto }) {
  const dash = (q.pct / 100) * RING_CIRCUMFERENCE
  return (
    <a
      className={`q ${q.tone}`}
      href={q.href}
      onClick={(e) => { e.preventDefault(); goto(q.href) }}
    >
      <div className="q__top">
        <div className="q__icon"><QueueIcon name={q.icon} /></div>
        <div className="q__head-text">
          <div className="q__eyebrow">{q.eyebrow}</div>
          <div className="q__title">{q.title}</div>
        </div>
      </div>

      <div className="q__progress">
        <div className="q__ring">
          <svg width="60" height="60" viewBox="0 0 60 60">
            <circle className="q__ring-bg" cx="30" cy="30" r="24" />
            <circle
              className="q__ring-fg"
              cx="30" cy="30" r="24"
              strokeDasharray={`${dash.toFixed(1)} ${RING_CIRCUMFERENCE.toFixed(1)}`}
            />
          </svg>
          <div className="q__ring-num"><strong>{q.pct}%</strong><small>klaar</small></div>
        </div>
        <div className="q__split">
          <div className="q__split-row">
            <span className="q__split-dot done" />
            <span className="q__split-num">{q.done}</span>
            <span className="q__split-lbl">{q.doneLabel}</span>
          </div>
          <div className="q__split-row open">
            <span className="q__split-dot open" />
            <span className="q__split-num">{q.open}</span>
            <span className="q__split-lbl">{q.openLabel}</span>
          </div>
        </div>
      </div>

      <div className="q__preview">
        <div className="q__preview-eyebrow">Volgende</div>
        {q.previewLine ? (
          <>
            <div className="q__preview-line"><strong>{q.previewLine}</strong></div>
            <div className="q__preview-sub">{q.previewSub}</div>
          </>
        ) : (
          <div className="q__preview-line">{q.previewSub}</div>
        )}
      </div>

      <div className="q__cta">
        {q.cta}
        <span className="q__cta-arrow"><Icon size={12}><path d="m9 18 6-6-6-6" /></Icon></span>
      </div>
    </a>
  )
}

export default function Queues({ queues, totalOpen, totalDone, goto }) {
  return (
    <>
      <div className="section-head">
        <h2>Wachtrijen</h2>
        <div className="section-head__sub">
          <strong>{totalOpen}</strong> open · <strong>{totalDone}</strong> verwerkt vandaag
        </div>
      </div>
      <div className="queues">
        {queues.map(q => <QueueCard key={q.key} q={q} goto={goto} />)}
      </div>
    </>
  )
}
