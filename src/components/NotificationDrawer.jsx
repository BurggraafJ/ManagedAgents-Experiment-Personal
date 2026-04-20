import { useEffect } from 'react'

const AGENT_LABEL = {
  'hubspot-daily-sync':   'HubSpot Daily',
  'sales-on-road':        'Road Notes',
  'sales-todos':          'Daily Tasks',
  'linkedin-connect':     'LinkedIn Connect',
  'kilometerregistratie': 'Kilometerregistratie',
  'auto-draft':           'Auto-Draft',
  'orchestrator':         'Orchestrator',
}

const IGNORE = new Set(['orchestrator', 'auto-draft'])

const STATUS_ICON = {
  success: '✅',
  warning: '⚠️',
  error:   '❌',
  skipped: '·',
}

export default function NotificationDrawer({ open, onClose, runs = [] }) {
  // Lock body scroll wanneer open
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = prev }
    }
  }, [open])

  // Filter ignore-list + sorteer op started_at desc
  const visible = (runs || [])
    .filter(r => !IGNORE.has(r.agent_name))
    .slice(0, 20)

  if (!open) return null

  return (
    <>
      <div className="drawer__backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="Meldingen">
        <div className="drawer__head">
          <h2 className="drawer__title">Meldingen</h2>
          <button className="btn btn--ghost drawer__close" onClick={onClose} aria-label="Sluiten">×</button>
        </div>

        <div className="drawer__hint">
          Laatste agent-runs. Orchestrator en Auto-Draft staan op de ignore-list (draaien te vaak).
        </div>

        {visible.length === 0 ? (
          <div className="empty">Nog geen meldingen.</div>
        ) : (
          <ul className="drawer__list">
            {visible.map(r => (
              <li key={r.id || `${r.agent_name}-${r.started_at}`} className={`drawer__item drawer__item--${r.status}`}>
                <div className="drawer__item-head">
                  <span className="drawer__item-icon">{STATUS_ICON[r.status] || '·'}</span>
                  <span className="drawer__item-agent">{AGENT_LABEL[r.agent_name] || r.agent_name}</span>
                  <span className="drawer__item-time">{formatWhen(r.started_at)}</span>
                </div>
                {r.summary && (
                  <div className="drawer__item-body">{r.summary}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </aside>
    </>
  )
}

function formatWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'zojuist'
  if (mins < 60) return `${mins} min geleden`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h} uur geleden`
  return d.toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
