import {
  STATUS_META,
  EXPIRY_TONE_COLOR,
  rotationLocation,
  expiryStatus,
  formatRelative,
} from '../../../../lib/apiKeys'
import DetailPanel from './DetailPanel'

export default function Row({ row, expanded, onToggle, onEdit, applyOverride }) {
  const meta = STATUS_META[row.status] || STATUS_META.unset
  const isDeprecated = row.status === 'deprecated'
  const rotLocation = rotationLocation(row.rotation_url)
  const usedBy = row.used_by || []
  const exp = expiryStatus(row.expires_at)
  const lastUsed = formatRelative(row.last_accessed_at)
  const isVault = row.storage_location === 'vault' && row.storage_ref?.startsWith('skill:')

  return (
    <>
      <tr className={expanded ? 'api-keys__row is-expanded' : 'api-keys__row'}>
        <td>
          <span
            className="api-keys__status-pill"
            style={{ background: meta.color + '22', color: meta.color }}
            title={meta.hint}
          >
            {meta.label}
          </span>
          {exp && (
            <div
              style={{
                marginTop: 4,
                fontSize: 10,
                fontWeight: 600,
                color: EXPIRY_TONE_COLOR[exp.tone],
              }}
              title={`Verloopt op ${new Date(row.expires_at).toLocaleDateString('nl-NL')}`}
            >
              {exp.tone === 'expired' ? '⚠ ' : exp.tone === 'crit' ? '⏰ ' : exp.tone === 'warn' ? '⏳ ' : '🕒 '}
              {exp.label}
            </div>
          )}
          {isVault && row.delete_protection === false && (
            <div style={{ marginTop: 4, fontSize: 10, fontWeight: 600, color: '#dc2626' }} title="Slot is uit — kan handmatig verwijderd worden">
              🔓 Ontgrendeld
            </div>
          )}
        </td>
        <td>
          <div className="api-keys__name">{row.display_name || row.key_name}</div>
          <div className="api-keys__name-mono">{row.key_name}</div>
          {usedBy.length > 0 && (
            <div className="api-keys__usedby">
              {usedBy.map(u => (
                <span key={u} className="api-keys__usedby-pill">{u}</span>
              ))}
            </div>
          )}
        </td>
        <td className="api-keys__last4">
          {row.last_4 ? <code>****{row.last_4}</code> : <span className="muted">—</span>}
          {isVault && lastUsed && (
            <div className="muted" style={{ fontSize: 10, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>🕒</span>
              <span>{lastUsed}</span>
              {row.access_count > 1 && (
                <span style={{ opacity: 0.7 }} title={`${row.access_count} keer gelezen`}>· {row.access_count}×</span>
              )}
            </div>
          )}
          {isVault && !lastUsed && (
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 10, fontWeight: 500, marginTop: 4,
              padding: '2px 6px', borderRadius: 999,
              background: 'var(--surface-2)', color: 'var(--text-muted)',
              opacity: 0.7,
            }}
              title="Nog geen activiteit sinds last-used tracking aanstaat (2026-05-03)"
            >
              <span>🌱</span>
              <span>Nog ongebruikt</span>
            </div>
          )}
        </td>
        <td className="api-keys__actions">
          {!isDeprecated && (
            <div className="api-keys__action-cell">
              <div className="api-keys__action-row">
                {row.rotation_url ? (
                  <a
                    href={row.rotation_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn--ghost api-keys__btn"
                    title={rotLocation ? `Open ${rotLocation}` : 'Open vendor-dashboard om nieuwe key te genereren'}
                  >
                    Roteer ↗
                  </a>
                ) : (
                  <span
                    className="btn btn--ghost api-keys__btn api-keys__btn--disabled"
                    title="Geen rotation-URL bekend voor deze key"
                    aria-disabled="true"
                  >
                    Roteer
                  </span>
                )}
                <button
                  type="button"
                  className="btn btn--accent api-keys__btn"
                  onClick={onEdit}
                >
                  Bewerk
                </button>
                <button
                  type="button"
                  className="btn btn--ghost api-keys__btn"
                  onClick={onToggle}
                  aria-expanded={expanded}
                >
                  {expanded ? 'Info ▾' : 'Info ▸'}
                </button>
              </div>
              {rotLocation && (
                <div className="api-keys__action-caption">via {rotLocation}</div>
              )}
            </div>
          )}
        </td>
      </tr>
      {expanded && !isDeprecated && (
        <tr className="api-keys__detail-row">
          <td colSpan={4}>
            <DetailPanel row={row} applyOverride={applyOverride} />
          </td>
        </tr>
      )}
    </>
  )
}
