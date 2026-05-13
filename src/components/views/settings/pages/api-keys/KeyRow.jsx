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
        <span className={`sv2-stat sv2-stat--${statusTone}`} title={meta.hint}>
          <span className="sv2-stat__dot" />
          {meta.label.replace(/^[^\w]+/, '').trim() || meta.label}
        </span>
      </td>
      <td>
        <div className="sv2-cell-name">{row.display_name || row.key_name}</div>
        <div className="sv2-cell-sub">{row.key_name}</div>
      </td>
      <td>
        <span className="sv2-pill">{STORAGE_LABEL[row.storage_location] || row.storage_location}</span>
      </td>
      <td>
        {row.last_4
          ? <code style={{ fontFamily: 'var(--sv-font-mono)', fontSize: 12, background: 'var(--sv-paper-2)', border: '1px solid var(--sv-border-soft)', padding: '2px 7px', borderRadius: 5 }}>··{row.last_4}</code>
          : <span style={{ color: 'var(--sv-n-400)' }}>—</span>}
      </td>
      <td>
        {usedBy.length > 0 ? (
          <div className="sv2-chip-stack">
            {usedBy.slice(0, 3).map(u => <span key={u} className="sv2-chip">{u}</span>)}
            {usedBy.length > 3 && <span className="sv2-chip">+{usedBy.length - 3}</span>}
          </div>
        ) : <span style={{ color: 'var(--sv-n-400)' }}>—</span>}
      </td>
      <td>
        {exp ? (
          <span className={`sv2-stat sv2-stat--${exp.tone === 'expired' || exp.tone === 'crit' ? 'err' : exp.tone === 'warn' ? 'warn' : 'ok'}`}>
            <span className="sv2-stat__dot" />{exp.label}
          </span>
        ) : (row.expires_at
            ? <span className="sv2-cell-mono" style={{ color: 'var(--sv-n-500)' }}>{new Date(row.expires_at).toLocaleDateString('nl-NL')}</span>
            : <span style={{ color: 'var(--sv-n-400)', fontSize: 12 }}>geen vervaldag</span>)}
      </td>
      <td className="is-right">
        {!isDeprecated && (
          <div className="sv2-row-actions">
            {row.rotation_url && (
              <a
                href={row.rotation_url}
                target="_blank"
                rel="noopener noreferrer"
                className="sv2-btn sv2-btn--ghost sv2-btn--sm"
                title={rotLoc ? `Open ${rotLoc}` : 'Open vendor-dashboard'}
              >
                ↗ Roteer
              </a>
            )}
            <button type="button" className="sv2-btn sv2-btn--primary sv2-btn--sm" onClick={onEdit}>
              Bewerk
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}
