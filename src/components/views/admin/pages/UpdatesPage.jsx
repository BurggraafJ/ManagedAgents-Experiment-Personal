import { useUpdates } from '../../../../hooks/useUpdates'

// UpdatesPage — vol-automatische changelog timeline binnen admin-shell.
// Owner ziet beide areas (platform + admin) gegroepeerd per dag, newest first.
// Voor members zou /updates (alleen platform) gebruikt worden; deze pagina
// zit achter de admin-shell-gate dus alleen voor owner zichtbaar.
//
// Bron: hook useUpdates() leest public.platform_updates met RLS-respect.

const GITHUB_REPO_BASE = 'https://github.com/BurggraafJ/ManagedAgents-Experiment-Personal'

function formatDay(iso) {
  if (!iso) return '—'
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) }
  catch { return iso }
}

function relativeDay(iso) {
  if (!iso) return ''
  try {
    const days = Math.floor((Date.now() - new Date(iso + 'T00:00:00').getTime()) / 86400000)
    if (days === 0) return 'vandaag'
    if (days === 1) return 'gisteren'
    if (days < 7) return `${days}d geleden`
    if (days < 30) return `${Math.floor(days / 7)}w geleden`
    return `${Math.floor(days / 30)}m geleden`
  } catch { return '' }
}

function formatTime(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) }
  catch { return '—' }
}

function AreaBlock({ row, area }) {
  if (!row) return null
  const commits = Array.isArray(row.commits) ? row.commits : []
  if (commits.length === 0) return null
  return (
    <div className={`updates-area updates-area--${area}`}>
      <div className="updates-area__head">
        <span>{area === 'admin' ? 'Beheercentrum' : 'Platform'} · {commits.length}</span>
      </div>
      <div>
        {commits.map(c => (
          <div key={c.sha} className="updates-commit">
            <span className="updates-commit__time">{formatTime(c.timestamp)}</span>
            <div className="updates-commit__body">
              <div className="updates-commit__msg">{c.message}</div>
              <div className="updates-commit__meta">
                <a
                  className="updates-commit__sha"
                  href={`${GITHUB_REPO_BASE}/commit/${c.sha}`}
                  target="_blank" rel="noopener noreferrer"
                  title={`Bekijk commit ${c.sha} op GitHub`}
                >{c.sha?.slice(0, 7)}</a>
                {c.author && <span>· {c.author}</span>}
                {Array.isArray(c.files) && c.files.length > 0 && (
                  <span title={c.files.join('\n')}>· {c.files.length} file{c.files.length === 1 ? '' : 's'}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function UpdatesPage() {
  const { days, loading, error, refresh } = useUpdates({ limit: 120 })

  return (
    <>
      <div className="admin-toolbar">
        <div className="admin-toolbar__meta">
          {days.length > 0 && <span>{days.length} dag{days.length === 1 ? '' : 'en'} historie</span>}
          <span>· Vol-automatisch — elke push op main wordt opgenomen</span>
        </div>
        <div className="admin-toolbar__actions">
          <button type="button" className="admin-btn" disabled={loading} onClick={refresh}>
            {loading ? 'Laden…' : 'Vernieuwen'}
          </button>
        </div>
      </div>

      {error && <div className="admin-banner admin-banner--err">⚠ {error}</div>}

      {!error && days.length === 0 && !loading && (
        <div className="admin-empty">
          <p className="admin-empty__title">Nog geen updates</p>
          <p className="admin-empty__hint">Zodra je naar <code>main</code> pusht voegt de workflow ze hier toe.</p>
        </div>
      )}

      {days.length > 0 && (
        <div className="updates-list">
          {days.map(day => {
            const adminCount = day.areas.admin ? (day.areas.admin.commits?.length || 0) : 0
            const platformCount = day.areas.platform ? (day.areas.platform.commits?.length || 0) : 0
            return (
              <section key={day.release_date} className="updates-day">
                <header className="updates-day__head">
                  <span className="updates-day__date">{formatDay(day.release_date)}</span>
                  <span className="updates-day__rel">{relativeDay(day.release_date)}</span>
                  <span className="updates-day__counts">
                    {adminCount > 0 && <span>Beheer {adminCount}</span>}
                    {platformCount > 0 && <span>Platform {platformCount}</span>}
                  </span>
                </header>
                <AreaBlock row={day.areas.admin} area="admin" />
                <AreaBlock row={day.areas.platform} area="platform" />
              </section>
            )
          })}
        </div>
      )}
    </>
  )
}
