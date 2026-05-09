import {
  STORAGE_LABEL,
  EXPIRY_TONE_COLOR,
  expiryStatus,
  formatRelative,
} from '../../../../lib/apiKeys'
import ProtectionAndDeleteRow from './ProtectionAndDeleteRow'
import MarkRotatedInline from './MarkRotatedInline'

export default function DetailPanel({ row, applyOverride }) {
  const since = row.last_status_change_at ? new Date(row.last_status_change_at) : null
  const isVault = row.storage_location === 'vault' && row.storage_ref?.startsWith('skill:')
  const exp = expiryStatus(row.expires_at)

  return (
    <div className="api-keys__detail">
      {row.purpose && row.purpose !== '— niet ingevuld —' && (
        <div className="api-keys__detail-block">
          <div className="api-keys__detail-label">Waarvoor</div>
          <div className="api-keys__detail-text">{row.purpose}</div>
        </div>
      )}
      <div className="api-keys__detail-grid">
        <div>
          <div className="api-keys__detail-label">Opslaglocatie</div>
          <div className="api-keys__detail-text">
            {STORAGE_LABEL[row.storage_location] || row.storage_location}
            {row.storage_ref && (
              <span className="mono muted" style={{ display: 'block', fontSize: 11, marginTop: 2 }}>
                {row.storage_ref}
              </span>
            )}
          </div>
        </div>
        {since && (
          <div>
            <div className="api-keys__detail-label">Laatst gewijzigd</div>
            <div className="api-keys__detail-text">
              {since.toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })}
              {row.last_status_change_by && ` door ${row.last_status_change_by}`}
            </div>
          </div>
        )}
        {isVault && (
          <div>
            <div className="api-keys__detail-label">Laatst gebruikt</div>
            <div className="api-keys__detail-text">
              {row.last_accessed_at ? (
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontWeight: 500 }}>
                      {new Date(row.last_accessed_at).toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                    <span className="muted" style={{ fontSize: 11 }}>
                      ({formatRelative(row.last_accessed_at)})
                    </span>
                  </div>
                  {row.access_count > 0 && (
                    <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                      {row.access_count} {row.access_count === 1 ? 'read' : 'reads'} totaal
                    </div>
                  )}
                </div>
              ) : (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontSize: 12, padding: '4px 10px', borderRadius: 999,
                  background: 'var(--surface-2)', color: 'var(--text-muted)',
                }}>
                  <span style={{ fontSize: 14 }}>🌱</span>
                  <span>Nog niet gelezen — wacht op eerste skill-read</span>
                </div>
              )}
            </div>
          </div>
        )}
        {!isVault && (row.storage_location === 'edge_function_secret' || row.storage_location === 'composio_managed') && (
          <div>
            <div className="api-keys__detail-label">Laatst gebruikt</div>
            <div className="api-keys__detail-text muted" style={{ fontSize: 12 }}>
              Niet meetbaar voor {STORAGE_LABEL[row.storage_location]}
            </div>
          </div>
        )}
        {row.expires_at && (
          <div>
            <div className="api-keys__detail-label">Verloopt</div>
            <div className="api-keys__detail-text" style={{ color: exp ? EXPIRY_TONE_COLOR[exp.tone] : 'inherit' }}>
              {new Date(row.expires_at).toLocaleDateString('nl-NL', { day: '2-digit', month: 'long', year: 'numeric' })}
              {exp && <span style={{ fontSize: 11, marginLeft: 8 }}>({exp.label})</span>}
              {row.expiry_note && (
                <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{row.expiry_note}</div>
              )}
            </div>
          </div>
        )}
        {isVault && (
          <div style={{ gridColumn: '1 / -1' }}>
            <ProtectionAndDeleteRow row={row} applyOverride={applyOverride} />
          </div>
        )}
        {row.status?.startsWith('red') && row.storage_location !== 'agent_config' && row.storage_location !== 'vault' && (
          <div style={{ gridColumn: '1 / -1' }}>
            <MarkRotatedInline row={row} />
          </div>
        )}
      </div>
    </div>
  )
}
