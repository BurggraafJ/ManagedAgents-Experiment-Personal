import { EVENT_STATUS_LABEL, EVENT_STATUS_TONE } from '../../../lib/salesOnRoad'
import { formatDateTime } from '../../../lib/dateFormat'

/**
 * EventsTable — verwerkte sales-on-road gesprekken (sales_on_road_events).
 * Toont datum, bedrijf, stage-overgang, acties, draft-status, status-pill.
 */
export default function EventsTable({ events }) {
  return (
    <section>
      <div className="section__head">
        <h2 className="section__title">
          Gesprekken {events.length > 0 && <span className="section__count">{events.length}</span>}
        </h2>
        <span className="section__hint">nieuwste boven</span>
      </div>

      {events.length === 0 ? (
        <div className="empty">
          Nog geen gesprekken verwerkt. Drop een aantekening in het invoerblok hierboven —
          de agent pakt het op bij de volgende orchestrator-poll.
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 110 }}>Wanneer</th>
                <th>Bedrijf</th>
                <th>Stage</th>
                <th>Acties</th>
                <th>Draft</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {events.map(e => <EventRow key={e.id} e={e} />)}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function EventRow({ e }) {
  return (
    <tr>
      <td>{formatDateTime(e.created_at)}</td>
      <td style={{ color: 'var(--text)', fontWeight: 500 }}>
        {e.company_name || <span className="muted">—</span>}
      </td>
      <td>
        {e.stage_before && e.stage_after && e.stage_before !== e.stage_after ? (
          <>
            <span className="muted">{e.stage_before}</span>
            <span style={{ margin: '0 4px' }}>→</span>
            <span style={{ color: 'var(--accent)' }}>{e.stage_after}</span>
          </>
        ) : e.stage_after ? (
          <span style={{ color: 'var(--accent)' }}>{e.stage_after}</span>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td>
        {Array.isArray(e.actions) && e.actions.length > 0 ? (
          <span className="muted" style={{ fontSize: 12 }}>{e.actions.join(' · ')}</span>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td>
        {e.outlook_draft_created ? (
          <span className="s-success">✓</span>
        ) : e.license_requested ? (
          <span className="s-warning" title="licentie nog handmatig">⚠ licentie</span>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td>
        <span className={`pill s-${EVENT_STATUS_TONE[e.status] || 'idle'}`}>
          {EVENT_STATUS_LABEL[e.status] || e.status}
        </span>
      </td>
    </tr>
  )
}
