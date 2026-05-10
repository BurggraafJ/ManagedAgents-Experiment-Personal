import { useEffect, useState } from 'react'
import { greetingFor, dateLabel, timeLabel } from '../../../lib/now'

export default function Greeting({ badges = {} }) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(id)
  }, [])

  const attention =
    (badges.adminPending || 0) +
    (badges.autodraftPropsCount || 0) +
    ((badges.tasks || []).filter(t => t.is_newly_found).length)

  return (
    <div className="now-greet">
      <h1>
        {greetingFor(now)} Jelle.{' '}
        <span>
          {attention > 0
            ? `${attention} ding${attention === 1 ? '' : 'en'} ${attention === 1 ? 'kan' : 'kunnen'} vandaag jouw aandacht gebruiken.`
            : 'niets vraagt urgent jouw aandacht.'}
        </span>
      </h1>
      <div className="now-greet-meta">
        {dateLabel(now)} · <span>{timeLabel(now)}</span>
      </div>
    </div>
  )
}
