import { useMemo, useState } from 'react'
import { TARGET_STATUS_TONE, SEGMENT_LABEL, segmentCounts, truncate } from '../../../lib/linkedin'
import { formatDateTime } from '../../../lib/dateFormat'
import styles from './LinkedInView.module.css'

/**
 * LinkedInTargetsTable — segment- en status-filter + tabel met max 100 rijen.
 */
export default function LinkedInTargetsTable({ targets }) {
  const [segmentFilter, setSegmentFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('active')

  const segments = useMemo(() => segmentCounts(targets), [targets])

  const filtered = useMemo(() => targets.filter(t => {
    if (segmentFilter !== 'all' && t.segment !== segmentFilter) return false
    if (statusFilter === 'active' && (t.status === 'already_connected' || t.status === 'blacklisted' || t.status === 'skipped')) return false
    if (statusFilter !== 'all' && statusFilter !== 'active' && t.status !== statusFilter) return false
    return true
  }), [targets, segmentFilter, statusFilter])

  return (
    <section>
      <div className="section__head">
        <h2 className="section__title">
          Targets {targets.length > 0 && <span className="section__count">{targets.length}</span>}
        </h2>
        <div className={styles.headerActions}>
          <select className="select" value={segmentFilter} onChange={e => setSegmentFilter(e.target.value)}>
            <option value="all">alle segmenten</option>
            {segments.map(([seg, n]) => (
              <option key={seg} value={seg}>{SEGMENT_LABEL[seg] || seg} ({n})</option>
            ))}
          </select>
          <select className="select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="active">actief (exclusief afgehandelde)</option>
            <option value="all">alle</option>
            <option value="pending">pending</option>
            <option value="scheduled">scheduled</option>
            <option value="sent">verstuurd</option>
            <option value="accepted">geaccepteerd</option>
            <option value="failed">fouten</option>
            <option value="already_connected">al verbonden</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">
          Geen targets in dit filter. De agent vult deze lijst automatisch bij elke run —
          bronnen: Outlook-inbox, HubSpot sales-pipeline, concurrenten, proefperiode-kantoren.
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Naam</th>
                <th>Bedrijf</th>
                <th>Segment</th>
                <th>Tactiek</th>
                <th>Status</th>
                <th style={{ width: 120 }}>Laatste</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 100).map(t => (
                <tr key={t.id}>
                  <td style={{ fontWeight: 500 }}>
                    {t.linkedin_url
                      ? <a href={t.linkedin_url} target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>{t.full_name}</a>
                      : t.full_name}
                    {t.headline && <div className="muted" style={{ fontSize: 11 }}>{truncate(t.headline, 70)}</div>}
                  </td>
                  <td>{t.company_name || <span className="muted">—</span>}</td>
                  <td><span className="pill">{SEGMENT_LABEL[t.segment] || t.segment}</span></td>
                  <td className="muted" style={{ fontSize: 12 }} title={t.tactic || ''}>
                    {truncate(t.tactic || '—', 60)}
                  </td>
                  <td>
                    <span className={`pill s-${TARGET_STATUS_TONE[t.status] || 'idle'}`}>{t.status}</span>
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {formatDateTime(t.sent_at || t.last_attempt_at || t.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
