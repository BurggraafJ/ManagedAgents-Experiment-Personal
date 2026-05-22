import { useState } from 'react'
import { useUpdates } from '../../hooks/useUpdates'
import './updates-timeline.css'

// Herbruikbare changelog-timeline — gebruikt door admin (/admin/updates)
// en platform (/updates). RLS regelt zichtbaarheid: members krijgen alleen
// area='platform', owner ziet beide. Geen extra props nodig — de hook
// vraagt simpelweg de tabel op.
//
// Sortering binnen een dag: per area block, met "groot/medium" boven en
// "kleine wijzigingen" in een collapsible sectie eronder.

const GITHUB_REPO_BASE = 'https://github.com/BurggraafJ/ManagedAgents-Experiment-Personal'

// Een commit telt als 'klein' als:
//   1. Conventional-commit prefix matched (auteur signaleert klein onderhoud)
//   2. OF max 2 modified files EN korte message (< 80 chars)
// Anders: medium/groot (krijgt eigen highlight-block).
const SMALL_PREFIX_RE = /^(fix|style|chore|refactor|polish|docs|test|cleanup|tweak|nit|build|ci|deps|typo)[:(]/i

function isSmallCommit(c) {
  const msg = c?.message || ''
  if (SMALL_PREFIX_RE.test(msg)) return true
  const fileCount = Array.isArray(c?.files) ? c.files.length : 0
  if (fileCount <= 2 && msg.length <= 80) return true
  return false
}

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

const AREA_LABEL = { platform: 'Platform', admin: 'Beheercentrum' }

function HighlightCommit({ c }) {
  const fileCount = Array.isArray(c?.files) ? c.files.length : 0
  return (
    <div className="ut-commit">
      <span className="ut-commit__time">{formatTime(c.timestamp)}</span>
      <div className="ut-commit__body">
        <div className="ut-commit__msg">{c.message}</div>
        <div className="ut-commit__meta">
          <a
            className="ut-commit__sha"
            href={`${GITHUB_REPO_BASE}/commit/${c.sha}`}
            target="_blank" rel="noopener noreferrer"
            title={`Bekijk commit ${c.sha} op GitHub`}
          >{c.sha?.slice(0, 7)}</a>
          {c.author && <span>{c.author}</span>}
          {fileCount > 0 && (
            <span title={c.files.join('\n')}>{fileCount} file{fileCount === 1 ? '' : 's'}</span>
          )}
        </div>
      </div>
    </div>
  )
}

function SmallCommit({ c }) {
  return (
    <div className="ut-small__row">
      <span className="ut-small__time">{formatTime(c.timestamp)}</span>
      <span className="ut-small__msg">{c.message}</span>
      <a
        className="ut-small__sha"
        href={`${GITHUB_REPO_BASE}/commit/${c.sha}`}
        target="_blank" rel="noopener noreferrer"
      >{c.sha?.slice(0, 7)}</a>
    </div>
  )
}

function AreaBlock({ row, area }) {
  const [smallOpen, setSmallOpen] = useState(false)
  if (!row) return null
  const commits = Array.isArray(row.commits) ? row.commits : []
  if (commits.length === 0) return null

  const highlights = []
  const smalls = []
  for (const c of commits) {
    if (isSmallCommit(c)) smalls.push(c); else highlights.push(c)
  }

  return (
    <div className={`ut-area ut-area--${area}`}>
      <div className="ut-area__head">
        <span>{AREA_LABEL[area] || area}</span>
        <span>{commits.length} · {highlights.length} highlight{highlights.length === 1 ? '' : 's'}, {smalls.length} klein</span>
      </div>

      {highlights.length > 0 && (
        <div className="ut-highlights">
          {highlights.map(c => <HighlightCommit key={c.sha} c={c} />)}
        </div>
      )}

      {smalls.length > 0 && (
        <div className="ut-small">
          <button
            type="button"
            className="ut-small__toggle"
            onClick={() => setSmallOpen(v => !v)}
            aria-expanded={smallOpen}
          >
            <span className={`ut-small__caret ${smallOpen ? 'ut-small__caret--open' : ''}`}>▸</span>
            {smalls.length} kleine wijziging{smalls.length === 1 ? '' : 'en'}
          </button>
          {smallOpen && (
            <div className="ut-small__list">
              {smalls.map(c => <SmallCommit key={c.sha} c={c} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// title/intro/right wordt door host-page bepaald (admin- of platform-shell).
export default function UpdatesTimeline({ limit = 120, areaFilter }) {
  const { days, loading, error, refresh } = useUpdates({ limit })

  // areaFilter (optioneel): 'platform' | 'admin' | undefined.
  // Voor /updates (member) is RLS al filterend, maar je kunt explicit owner →
  // alleen platform tonen door areaFilter='platform' mee te geven.
  const filteredDays = days.map(d => {
    if (!areaFilter) return d
    const next = { release_date: d.release_date, areas: {} }
    if (d.areas[areaFilter]) next.areas[areaFilter] = d.areas[areaFilter]
    return next
  }).filter(d => Object.keys(d.areas).length > 0)

  return (
    <div className="ut-app">
      <div className="ut-toolbar">
        <div className="ut-toolbar__meta">
          {filteredDays.length > 0 && <>{filteredDays.length} dag{filteredDays.length === 1 ? '' : 'en'} historie · </>}
          Vol-automatisch — elke push naar main wordt opgenomen.
        </div>
        <div className="ut-toolbar__actions">
          <button type="button" className="ut-btn" onClick={refresh} disabled={loading}>
            {loading ? 'Laden…' : 'Vernieuwen'}
          </button>
        </div>
      </div>

      {error && <div className="ut-banner ut-banner--err">⚠ {error}</div>}

      {!error && filteredDays.length === 0 && !loading && (
        <div className="ut-empty">
          <p className="ut-empty__title">Nog geen updates</p>
          <p className="ut-empty__hint">Zodra er naar main wordt gepusht, verschijnt het hier.</p>
        </div>
      )}

      {filteredDays.length > 0 && (
        <div className="ut-list">
          {filteredDays.map(day => {
            const adminCount = day.areas.admin ? (day.areas.admin.commits?.length || 0) : 0
            const platformCount = day.areas.platform ? (day.areas.platform.commits?.length || 0) : 0
            return (
              <section key={day.release_date} className="ut-day">
                <header className="ut-day__head">
                  <span className="ut-day__date">{formatDay(day.release_date)}</span>
                  <span className="ut-day__rel">{relativeDay(day.release_date)}</span>
                  <span className="ut-day__counts">
                    {adminCount > 0 && <span>Beheer {adminCount}</span>}
                    {platformCount > 0 && <span>Platform {platformCount}</span>}
                  </span>
                </header>
                {/* Admin eerst (als er is), dan platform */}
                <AreaBlock row={day.areas.admin} area="admin" />
                <AreaBlock row={day.areas.platform} area="platform" />
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
