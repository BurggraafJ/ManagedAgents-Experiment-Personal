import { useState, useMemo } from 'react'
import { useUpdates } from '../../hooks/useUpdates'
import './updates-timeline.css'

// UpdatesTimeline — herbruikbare changelog timeline (admin + platform).
// RLS bepaalt zichtbaarheid; areaFilter (optioneel) forceert nog een
// extra filter zodat /updates voor owner-views consistent blijft met
// wat een member zou zien.
//
// Design-keuze: eigen paper-look (witte cards, warmere bg, theme-vrij)
// zodat lezen comfortabel is ongeacht dark/light. Geen timestamps in de
// UI — de dag-koptekst is voldoende. Gerelateerde commits worden auto-
// gemerged tot één feature-block met sub-bullets.

const GITHUB_REPO_BASE = 'https://github.com/BurggraafJ/ManagedAgents-Experiment-Personal'

// --- Classify --------------------------------------------------------------
const SMALL_PREFIX_RE = /^(fix|style|chore|refactor|polish|docs|test|cleanup|tweak|nit|build|ci|deps|typo)[:(]/i

function isSmallCommit(c) {
  const msg = c?.message || ''
  if (SMALL_PREFIX_RE.test(msg)) return true
  const fileCount = Array.isArray(c?.files) ? c.files.length : 0
  if (fileCount <= 2 && msg.length <= 80) return true
  return false
}

// Feature-key: pak het stuk vóór de eerste `:` (of `—`) en strip trailing
// version-suffixen zoals "V9.7" of "v2.0" zodat alle revisies van hetzelfde
// project samen vallen.
function featureKey(msg) {
  if (!msg) return null
  // Eerst grote splitter: ":" of "—" of " - "
  let head = msg.split(/[:—]| - /)[0].trim()
  // Strip conventional prefix als die alleen staat (bv "fix:")
  if (/^[a-z]+$/.test(head)) return null  // bv. "fix" alleen — geen feature
  // Strip trailing version-suffix: " V9.7", " v2.0.3", " 9.7"
  head = head.replace(/\s+v?\d+(\.\d+)+\s*$/i, '').trim()
  // Strip trailing "-V8.5" / "_V2"
  head = head.replace(/[\s\-_]v?\d+(\.\d+)*\s*$/i, '').trim()
  // Strip trailing "ronde X" / "sessie X" — design-migratie patterns
  head = head.replace(/\s+(ronde|sessie|batch|stap)\s+\d+\s*$/i, '').trim()
  if (head.length < 3) return null
  return head
}

// --- Formatters ------------------------------------------------------------
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

// Strip de feature-prefix uit een individuele commit zodat een merged-block
// "Taken v2.0" niet 8x "Taken v2.0: ..." onder zich heeft, maar alleen de
// daadwerkelijke deelwijziging.
function trimFeaturePrefix(msg, key) {
  if (!msg || !key) return msg
  // Verwijder "<key>(.X)?:\s*" of "<key>(.X)?\s*[—-]\s*"
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s.\\dv]*[:\\u2014\\-]\\s*`, 'i')
  return msg.replace(re, '').trim() || msg
}

const AREA_LABEL = { platform: 'Platform', admin: 'Beheercentrum' }

// --- Render sub-components -------------------------------------------------

function CommitRow({ c }) {
  const fileCount = Array.isArray(c?.files) ? c.files.length : 0
  return (
    <div className="ut-commit">
      <div className="ut-commit__msg">{c.message}</div>
      <div className="ut-commit__meta">
        <a
          className="ut-commit__sha"
          href={`${GITHUB_REPO_BASE}/commit/${c.sha}`}
          target="_blank" rel="noopener noreferrer"
        >{c.sha?.slice(0, 7)}</a>
        {c.author && <span>· {c.author}</span>}
        {fileCount > 0 && <span title={c.files.join('\n')}>· {fileCount} file{fileCount === 1 ? '' : 's'}</span>}
      </div>
    </div>
  )
}

function FeatureBlock({ feature, items }) {
  return (
    <div className="ut-feature">
      <div className="ut-feature__head">
        <span className="ut-feature__title">{feature}</span>
        <span className="ut-feature__count">{items.length} updates</span>
      </div>
      <ul className="ut-feature__list">
        {items.map(c => {
          const trimmed = trimFeaturePrefix(c.message, feature)
          return (
            <li key={c.sha} className="ut-feature__item">
              <span className="ut-feature__bullet">•</span>
              <span className="ut-feature__detail">{trimmed}</span>
              <a className="ut-feature__sha" href={`${GITHUB_REPO_BASE}/commit/${c.sha}`} target="_blank" rel="noopener noreferrer">
                {c.sha?.slice(0, 7)}
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function SmallRow({ c }) {
  return (
    <div className="ut-small__row">
      <span className="ut-small__msg">{c.message}</span>
      <a className="ut-small__sha" href={`${GITHUB_REPO_BASE}/commit/${c.sha}`} target="_blank" rel="noopener noreferrer">
        {c.sha?.slice(0, 7)}
      </a>
    </div>
  )
}

function AreaBlock({ row, area }) {
  const [smallOpen, setSmallOpen] = useState(false)

  // Split highlight / klein
  const { highlights, smalls } = useMemo(() => {
    const all = Array.isArray(row?.commits) ? row.commits : []
    const big = []; const small = []
    for (const c of all) {
      if (isSmallCommit(c)) small.push(c); else big.push(c)
    }
    return { highlights: big, smalls: small }
  }, [row])

  // Groepeer highlights op feature-key (≥2 hits = feature-block)
  const { features, singles } = useMemo(() => {
    const buckets = new Map()
    const loose = []
    for (const c of highlights) {
      const k = featureKey(c.message)
      if (!k) { loose.push(c); continue }
      if (!buckets.has(k)) buckets.set(k, [])
      buckets.get(k).push(c)
    }
    const feats = []
    for (const [k, items] of buckets) {
      if (items.length >= 2) feats.push({ key: k, items })
      else loose.push(...items)
    }
    // sort feats biggest-first
    feats.sort((a, b) => b.items.length - a.items.length)
    return { features: feats, singles: loose }
  }, [highlights])

  if (!row || (highlights.length === 0 && smalls.length === 0)) return null

  return (
    <div className={`ut-area ut-area--${area}`}>
      <div className="ut-area__head">
        <span>{AREA_LABEL[area] || area}</span>
        <span className="ut-area__head-count">
          {features.length > 0 && <>{features.length} feature{features.length === 1 ? '' : 's'} · </>}
          {singles.length > 0 && <>{singles.length} los · </>}
          {smalls.length} klein
        </span>
      </div>

      {features.length > 0 && features.map(f => (
        <FeatureBlock key={f.key} feature={f.key} items={f.items} />
      ))}

      {singles.length > 0 && (
        <div className="ut-highlights">
          {singles.map(c => <CommitRow key={c.sha} c={c} />)}
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
              {smalls.map(c => <SmallRow key={c.sha} c={c} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// --- Main component --------------------------------------------------------

export default function UpdatesTimeline({ limit = 120, areaFilter, title = 'Wat is nieuw', intro }) {
  const { days, loading, error, refresh } = useUpdates({ limit })

  const filteredDays = useMemo(() => days.map(d => {
    if (!areaFilter) return d
    const next = { release_date: d.release_date, areas: {} }
    if (d.areas[areaFilter]) next.areas[areaFilter] = d.areas[areaFilter]
    return next
  }).filter(d => Object.keys(d.areas).length > 0), [days, areaFilter])

  const defaultIntro = areaFilter === 'platform'
    ? 'Per dag een overzicht van wat er aan het platform is veranderd. Gerelateerde wijzigingen staan samengevoegd; kleine aanpassingen vind je ingeklapt onderaan elke dag.'
    : 'Per dag wat er aan het platform en aan beheercentrum is veranderd. Gerelateerde wijzigingen staan samengevoegd; kleine aanpassingen vind je ingeklapt onderaan elke dag.'

  return (
    <div className="ut-app">
      <header className="ut-head">
        <div className="ut-head__title-block">
          <div className="ut-head__kicker">Changelog</div>
          <h1 className="ut-head__title">{title}</h1>
          <p className="ut-head__intro">{intro || defaultIntro}</p>
        </div>
        <div className="ut-head__actions">
          <button type="button" className="ut-btn" onClick={refresh} disabled={loading}>
            {loading ? 'Laden…' : 'Vernieuwen'}
          </button>
        </div>
      </header>

      {error && <div className="ut-banner ut-banner--err">⚠ {error}</div>}

      {!error && filteredDays.length === 0 && !loading && (
        <div className="ut-empty">
          <p className="ut-empty__title">Nog niks om te tonen</p>
          <p className="ut-empty__hint">Zodra er nieuwe updates op het dashboard landen verschijnen ze hier.</p>
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
