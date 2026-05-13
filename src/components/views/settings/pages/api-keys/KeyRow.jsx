import { STATUS_META, STORAGE_LABEL, rotationLocation, expiryStatus } from '../../../../../lib/apiKeys'

/**
 * KeyRow — één api-keys tabel-rij. Toont status, naam+slug, opslag, last-4,
 * used-by chips, verloop-status en acties (Roteer ↗ + Bewerk).
 */
export default function KeyRow({ row, onEdit }) {
  const meta = STATUS_META[row.status] || STATUS_META.unset
  const isDeprecated = row.status === 'deprecated'
  const rotLoc = rotationLocation(row.rotation_url)
  const usedBy = row.used_by || []
  const exp = expiryStatus(row.expires_at)
  const statusTone =
    row.status?.startsWith('red')         ? 'err'  :
    row.status === 'green_dashboard_only' ? 'ok'   :
    row.status === 'deprecated'           ? 'info' : 'warn'

  return (
    <tr>
      <td>
        <span className={`set-stat set-stat--${statusTone}`} title={meta.hint}>
          <span className="set-stat__dot" />
          {meta.label.replace(/^[^\w]+/, '').trim() || meta.label}
        </span>
      </td>
      <td>
        <div className="set-cell-name">{row.display_name || row.key_name}</div>
        <div className="set-cell-sub">{row.key_name}</div>
      </td>
      <td>
        <span className="set-pill">{STORAGE_LABEL[row.storage_location] || row.storage_location}</span>
      </td>
      <td>
        {row.last_4
          ? <code style={{ fontFamily: 'var(--set-font-mono)', fontSize: 12, background: 'var(--set-paper-2)', border: '1px solid var(--set-border-soft)', padding: '2px 7px', borderRadius: 5 }}>··{row.last_4}</code>
          : <span style={{ color: 'var(--set-n-400)' }}>—</span>}
      </td>
      <td>
        {usedBy.length > 0 ? (
          <div className="set-chip-stack">
            {usedBy.slice(0, 3).map(u => <span key={u} className="set-chip">{u}</span>)}
            {usedBy.length > 3 && <span className="set-chip">+{usedBy.length - 3}</span>}
          </div>
        ) : <span style={{ color: 'var(--set-n-400)' }}>—</span>}
      </td>
      <td>
        {exp ? (
          <span className={`set-stat set-stat--${exp.tone === 'expired' || exp.tone === 'crit' ? 'err' : exp.tone === 'warn' ? 'warn' : 'ok'}`}>
            <span className="set-stat__dot" />{exp.label}
          </span>
        ) : (row.expires_at
            ? <span className="set-cell-mono" style={{ color: 'var(--set-n-500)' }}>{new Date(row.expires_at).toLocaleDateString('nl-NL')}</span>
            : <span style={{ color: 'var(--set-n-400)', fontSize: 12 }}>geen vervaldag</span>)}
      </td>
      <td className="is-right">
        {!isDeprecated && (
          <div className="set-row-actions">
            {row.rotation_url && (
              <a
                href={row.rotation_url}
                target="_blank"
                rel="noopener noreferrer"
                className="set-btn set-btn--ghost set-btn--sm"
                title={rotLoc ? `Open ${rotLoc}` : 'Open vendor-dashboard'}
              >
                ↗ Roteer
              </a>
            )}
            <button type="button" className="set-btn set-btn--primary set-btn--sm" onClick={onEdit}>
              Bewerk
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}
