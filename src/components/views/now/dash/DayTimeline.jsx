import Icon from '../Icon'
import { truncate } from '../../../../lib/now'

// DayTimeline — "Nu & vanmiddag": forward-only lijst van de resterende
// agenda-events vandaag. Eerste/lopende item krijgt accent (now-dot).
export default function DayTimeline({ timeline, goto }) {
  return (
    <>
      <div className="section-head">
        <h2>Nu &amp; vanmiddag</h2>
        <div className="section-head__sub">
          <strong>{timeline.length}</strong> {timeline.length === 1 ? 'item' : 'items'} resterend
        </div>
      </div>

      {timeline.length === 0 ? (
        <div className="tl-empty">Geen afspraken meer vandaag.</div>
      ) : (
        <div className="tl">
          {timeline.map(it => (
            <div className="tl-row" key={it.id}>
              <div className="tl-row__time">{it.time}<small>{it.dur}</small></div>
              <div className="tl-row__spine">
                <div className={`tl-row__dot ${it.isNow ? 'tl-row__dot--now' : ''}`} />
              </div>
              <div className={`tl-card ${it.isNow ? 'tl-card--now' : ''}`}>
                <div className="tl-card__ico">
                  <Icon size={13}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M3 10h18M8 2v4M16 2v4" /></Icon>
                </div>
                <div className="tl-card__body">
                  <div className="tl-card__title">{it.title}</div>
                  <div className="tl-card__sub">
                    {it.online
                      ? <span className="tl-tag info">Online</span>
                      : it.location ? <span className="tl-tag">{truncate(it.location, 22)}</span> : null}
                    {it.dur} {it.isNow ? '· nu aan de beurt' : ''}
                  </div>
                </div>
                <a
                  className="tl-card__cta"
                  href="/agenda"
                  onClick={(e) => { e.preventDefault(); goto('/agenda') }}
                >
                  Agenda
                  <Icon size={11}><path d="m9 18 6-6-6-6" /></Icon>
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
