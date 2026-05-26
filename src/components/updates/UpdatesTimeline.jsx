import { useState, useMemo } from 'react'
import { useUpdates } from '../../hooks/useUpdates'
import { Icon } from './updatesIcons'
import {
  TAG_LABEL,
  tagFromMessage,
  trimFeaturePrefix,
  splitMessage,
  majorVisualClass,
  parseDate,
  shortDate,
  dayMonthLong,
  MONTHS_NL,
  processData,
} from './updatesProcessing'
import './updates-timeline.css'

// UpdatesTimeline — editorial changelog met drie tiers van update-grootte.
//   1. Hero        — top-release per periode (één per render, eerste periode)
//   2. Major card  — feature-blokken (≥2 commits met dezelfde key)
//   3. Stream rij  — losse commits, gegroepeerd per module
//   + Tiny         — kleine commits (chore/typo/fix), collapsible onderaan
//
// Data komt uit useUpdates → platform_updates (één rij per dag per area).
// RLS bepaalt zichtbaarheid; areaFilter='platform' forceert user-view-mode.

const GITHUB_REPO_BASE = 'https://github.com/BurggraafJ/ManagedAgents-Experiment-Personal'

// ---------- Sub-components ----------

function Tag({ kind, children }) {
  return (
    <span className={`win-tag is-${kind}`}>
      {(kind === 'new' || kind === 'imp' || kind === 'fix' || kind === 'beta' || kind === 'module') && <span className="dot" />}
      {children}
    </span>
  )
}

function HeroCard({ hero }) {
  const latest = hero.items[0]
  const split = splitMessage(latest.message)
  const title = hero.isSingleton ? split.head : hero.key
  const lede = hero.isSingleton
    ? (split.sub || `${latest.author || 'onbekend'}${latest.area === 'admin' ? ' · admin-area' : ''}`)
    : `${hero.items.length} commits in deze release. Laatste: ${split.head}`

  const chips = hero.isSingleton
    ? []
    : hero.items.slice(0, 3).map(c => {
      const trimmed = trimFeaturePrefix(c.message, hero.key)
      const s = splitMessage(trimmed)
      return { text: s.head, sha: c.sha }
    })

  return (
    <article className="win-hero" data-aud={hero.adminOnly ? 'admin' : 'platform'}>
      <div className="win-hero__rail" aria-hidden="true">
        <div className="win-hero__rail-stamp">Hoofd-<br />release</div>
        <div className="win-hero__rail-ver">{hero.items.length}×</div>
        <div className="win-hero__rail-date">{shortDate(hero.latestDate)}</div>
      </div>
      <div className="win-hero__main">
        <div className="win-hero__cat-row">
          <span className="win-hero__cat"><span className="dot" />{hero.module.name}</span>
          <span>{dayMonthLong(hero.latestDate)}{hero.author ? ` · ${hero.author}` : ''}</span>
        </div>
        <h2 className="win-hero__title">{title}</h2>
        <p className="win-hero__lede">{lede}</p>
        {chips.length > 0 && (
          <div className="win-hero__chips">
            {chips.map(c => (
              <span className="win-hero__chip" key={c.sha}>
                <Icon name="sparkles" />
                <strong>{c.text}</strong>
              </span>
            ))}
          </div>
        )}
      </div>
      <a className="win-hero__cta" href={`${GITHUB_REPO_BASE}/commit/${latest.sha}`} target="_blank" rel="noopener noreferrer">
        Bekijk commit
        <Icon name="arrow" />
      </a>
    </article>
  )
}

function MajorCard({ feature, idx }) {
  const latest = feature.items[0]
  const split = splitMessage(latest.message)
  const visualClass = majorVisualClass(idx, feature.tag)
  const isMulti = feature.items.length > 1
  const title = isMulti ? feature.key : split.head
  const description = isMulti
    ? `${feature.items.length} samenhangende commits. Meest recente wijziging: ${split.head}.`
    : (split.sub || `${feature.author || 'onbekend'} · ${feature.module.name}`)

  return (
    <article className={`win-major ${visualClass}`} data-aud={feature.adminOnly ? 'admin' : 'platform'}>
      <div className="win-major__visual">
        <div className="win-major__icon-bg">
          <Icon name={feature.module.icon} />
        </div>
      </div>
      <div className="win-major__body">
        <div className="win-major__tag-row">
          <Tag kind={feature.tag}>{TAG_LABEL[feature.tag]}</Tag>
          <Tag kind="module">{feature.module.name}</Tag>
          {feature.adminOnly && <Tag kind="admin">Admin</Tag>}
          <span className="win-major__date">{shortDate(feature.latestDate)}</span>
        </div>
        <h3 className="win-major__title">{title}</h3>
        <p className="win-major__desc">{description}</p>
        {isMulti && (
          <ul className="win-major__bullets">
            {feature.items.slice(0, 4).map(c => {
              const trimmed = trimFeaturePrefix(c.message, feature.key)
              const s = splitMessage(trimmed)
              return <li key={c.sha}>{s.head}</li>
            })}
            {feature.items.length > 4 && <li>… en {feature.items.length - 4} meer</li>}
          </ul>
        )}
        <div className="win-major__foot">
          <a href={`${GITHUB_REPO_BASE}/commit/${latest.sha}`} target="_blank" rel="noopener noreferrer">
            Bekijk laatste commit
            <Icon name="arrow" />
          </a>
          <span className="meta">{feature.items.length} commit{feature.items.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </article>
  )
}

function StreamItem({ commit }) {
  const tag = tagFromMessage(commit.message)
  const split = splitMessage(commit.message)
  const isAdmin = commit.area === 'admin'
  return (
    <div className={`win-item ${isAdmin ? 'is-admin' : ''}`} data-aud={isAdmin ? 'admin' : 'platform'}>
      <span className="win-item__date">{shortDate(commit.release_date)}</span>
      <span className="win-item__tag">
        {isAdmin ? <Tag kind="admin">Admin</Tag> : <Tag kind={tag}>{TAG_LABEL[tag]}</Tag>}
      </span>
      <span className="win-item__txt">
        <strong>{split.head}</strong>
        {split.sub && <span className="sub">{split.sub}</span>}
      </span>
      <a className="win-item__sha" href={`${GITHUB_REPO_BASE}/commit/${commit.sha}`} target="_blank" rel="noopener noreferrer">
        {commit.sha?.slice(0, 7)}
      </a>
    </div>
  )
}

function ModuleBlock({ mod }) {
  const { name, icon, items, tagCounts } = mod
  const bar = []
  if (tagCounts.new) bar.push({ k: 'b-new', n: tagCounts.new, lbl: 'nieuw' })
  if (tagCounts.imp) bar.push({ k: 'b-imp', n: tagCounts.imp, lbl: 'verbeterd' })
  if (tagCounts.fix) bar.push({ k: 'b-fix', n: tagCounts.fix, lbl: 'opgelost' })
  if (tagCounts.admin) bar.push({ k: 'b-admin', n: tagCounts.admin, lbl: 'admin' })

  return (
    <div className="win-mod">
      <div className="win-mod__head">
        <span className="win-mod__ic"><Icon name={icon} /></span>
        <span className="win-mod__name">{name}</span>
        <span className="win-mod__count">{items.length} wijziging{items.length === 1 ? '' : 'en'}</span>
        <span className="win-mod__bar">
          {bar.map(b => (
            <span key={b.k} className={b.k}><i />{b.n} {b.lbl}</span>
          ))}
        </span>
      </div>
      {items.map(c => <StreamItem key={c.sha} commit={c} />)}
    </div>
  )
}

function TinyBlock({ items, periodId }) {
  const [open, setOpen] = useState(false)
  if (items.length === 0) return null
  const adminCount = items.filter(c => c.area === 'admin').length
  return (
    <div className="win-tiny">
      <button
        type="button"
        className={`win-tiny__toggle ${open ? 'is-open' : ''}`}
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        <Icon name="arrow" />
        <span className="lbl">
          <b>{items.length}</b>&nbsp; nog kleinere wijzigingen ·{' '}
          <span style={{ color: 'var(--neutral-400)' }}>copy, typo&apos;s, mini-fixes</span>
        </span>
        <span className="hint">{adminCount > 0 ? `${adminCount} admin` : 'onderhoud'}</span>
      </button>
      <div className={`win-tiny__body ${open ? 'is-open' : ''}`} id={`tiny-${periodId}`}>
        <div className="win-tiny__inner">
          {items.map(c => {
            const tag = c.area === 'admin' ? 'admin' : tagFromMessage(c.message)
            const split = splitMessage(c.message)
            const isAdmin = c.area === 'admin'
            return (
              <div key={c.sha} className={`win-tiny-row ${isAdmin ? 'is-admin' : ''}`} data-aud={isAdmin ? 'admin' : 'platform'}>
                <span className="win-tiny-row__date">{shortDate(c.release_date)}</span>
                <span className={`win-tiny-row__dot is-${tag}`} />
                <span className="win-tiny-row__txt"><strong>{split.head}</strong></span>
                <a className="win-tiny-row__sha" href={`${GITHUB_REPO_BASE}/commit/${c.sha}`} target="_blank" rel="noopener noreferrer">
                  {c.sha?.slice(0, 7)}
                </a>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ---------- Main ----------

export default function UpdatesTimeline({ limit = 120, areaFilter, title = 'Wat is nieuw', intro }) {
  const { days, loading, error, refresh } = useUpdates({ limit })
  const [viewMode, setViewMode] = useState('all') // 'all' | 'user'

  const filteredDays = useMemo(() => {
    if (!areaFilter) return days
    return days
      .map(d => {
        const next = { release_date: d.release_date, areas: {} }
        if (d.areas[areaFilter]) next.areas[areaFilter] = d.areas[areaFilter]
        return next
      })
      .filter(d => Object.keys(d.areas).length > 0)
  }, [days, areaFilter])

  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }, [])
  const periods = useMemo(() => processData(filteredDays, today), [filteredDays, today])

  const counts = useMemo(() => {
    let userCount = 0
    let totalCount = 0
    for (const day of filteredDays) {
      const p = day.areas.platform?.commits?.length || 0
      const a = day.areas.admin?.commits?.length || 0
      userCount += p
      totalCount += p + a
    }
    return { user: userCount, all: totalCount }
  }, [filteredDays])

  const hasAdminItems = counts.all > counts.user
  const showViewTabs = !areaFilter && hasAdminItems

  const latestDate = periods[0]?.dateRange?.max || days[0]?.release_date
  const relativeLatest = useMemo(() => {
    if (!latestDate) return ''
    const d = parseDate(latestDate); if (!d) return ''
    const diff = Math.floor((today.getTime() - d.getTime()) / 86400000)
    if (diff <= 0) return 'vandaag'
    if (diff === 1) return 'gisteren'
    if (diff < 7) return `${diff} dagen geleden`
    if (diff < 30) return `${Math.floor(diff / 7)} weken geleden`
    return `${Math.floor(diff / 30)} maanden geleden`
  }, [latestDate, today])

  const defaultIntro = areaFilter === 'platform'
    ? 'Elke twee weken iets dat je dag rustiger maakt — en af en toe iets groots dat we zelf óók moeten uitleggen. Geen marketing. Wat er live ging, waarom, en wat het voor jou betekent.'
    : 'Per dag wat er aan het platform en aan beheercentrum is veranderd. Gerelateerde wijzigingen staan samengevoegd; kleine aanpassingen vind je ingeklapt onderaan elke periode.'

  const titleWithEm = title.includes('nieuw')
    ? title.split(/(nieuw)/i).map((part, i) =>
      part.toLowerCase() === 'nieuw' ? <em key={i}>{part}</em> : part
    )
    : title

  const isFilterUser = viewMode === 'user'
  const latestMonth = latestDate ? `${MONTHS_NL[parseDate(latestDate)?.getMonth() ?? 0]} ${parseDate(latestDate)?.getFullYear() ?? ''}` : 'live'

  return (
    <div className={`theme-maestro win-app ${isFilterUser ? 'is-filter-user' : ''}`}>
      <header className="win-mast">
        <div>
          <div className="win-mast__eyebrow">
            <span className="win-pulse" />
            Release notes · {latestMonth}
          </div>
          <h1 className="win-mast__h1">{titleWithEm}.</h1>
          <p className="win-mast__lede">{intro || defaultIntro}</p>
          {latestDate && (
            <div className="win-ver-pill" title="Laatste release">
              <span className="win-ver-pill__ic"><Icon name="refresh" /></span>
              Laatste release <b>{dayMonthLong(latestDate)}</b>
              <span className="sep">·</span>
              <span style={{ color: 'var(--neutral-500)' }}>{relativeLatest}</span>
            </div>
          )}
        </div>

        {showViewTabs && (
          <div className="win-view-tabs" role="tablist" aria-label="Filter">
            <button
              type="button"
              className={`win-view-tab ${viewMode === 'user' ? 'is-active' : ''}`}
              onClick={() => setViewMode('user')}
              role="tab"
              aria-selected={viewMode === 'user'}
            >
              Voor jou
              <span className="win-view-tab__count">{counts.user}</span>
            </button>
            <button
              type="button"
              className={`win-view-tab ${viewMode === 'all' ? 'is-active' : ''}`}
              onClick={() => setViewMode('all')}
              role="tab"
              aria-selected={viewMode === 'all'}
            >
              <Icon name="shield" />
              Admin
              <span className="win-view-tab__count">{counts.all}</span>
            </button>
          </div>
        )}
      </header>

      <div className="win-sub-strip">
        {loading ? (
          <span>Laden…</span>
        ) : (
          <>
            <span>Laatst geüpdatet {relativeLatest || 'zojuist'}</span>
            <span className="sep">·</span>
            <span><b>{counts.user}</b> updates voor jou</span>
            {hasAdminItems && (
              <>
                <span className="sep">·</span>
                <span><b>{counts.all - counts.user}</b> admin-only</span>
              </>
            )}
            <span className="sep">·</span>
            <button className="win-sub-strip__btn" onClick={refresh} disabled={loading}>
              Vernieuwen
            </button>
          </>
        )}
      </div>

      {error && <div className="win-banner">⚠ {error}</div>}

      {loading && periods.length === 0 && (
        <div className="win-loading">Laden…</div>
      )}

      {!loading && !error && periods.length === 0 && (
        <div className="win-empty">
          <p className="win-empty__title">Nog niks om te tonen</p>
          <p className="win-empty__hint">Zodra er nieuwe updates op het dashboard landen verschijnen ze hier.</p>
        </div>
      )}

      {periods.length > 0 && (
        <div className="win-body">
          {periods.map((period, periodIdx) => {
            const totalStream = period.modules.reduce((s, m) => s + m.items.length, 0)
            return (
              <section key={period.id}>
                <div className="win-date-head">
                  <div className="win-date-head__inner">
                    <div className="win-date-head__lbl">{period.label}</div>
                    <div className="win-date-head__num">
                      {period.dateRange.min === period.dateRange.max
                        ? shortDate(period.dateRange.max)
                        : `${shortDate(period.dateRange.min)} – ${shortDate(period.dateRange.max)}`}
                    </div>
                    {periodIdx === 0 && (
                      <span className="win-date-head__ver is-current">Live · {dayMonthLong(period.dateRange.max)}</span>
                    )}
                  </div>
                  <span className="win-date-head__meta">{period.summary}</span>
                </div>

                {period.hero && <HeroCard hero={period.hero} />}

                {period.features.map((f, i) => (
                  <MajorCard key={`${period.id}-${f.key}`} feature={f} idx={i} />
                ))}

                {(period.modules.length > 0 || period.smalls.length > 0) && (
                  <>
                    <div className="win-stream-label">
                      <h3>Kleine verbeteringen &amp; opgeloste bugs</h3>
                      <span className="meta">
                        <b>{totalStream + period.smalls.length}</b> wijziging{(totalStream + period.smalls.length) === 1 ? '' : 'en'} ·
                        gegroepeerd per onderdeel
                      </span>
                    </div>

                    <div className="win-stream">
                      {period.modules.map(mod => (
                        <ModuleBlock key={`${period.id}-${mod.name}`} mod={mod} />
                      ))}
                      {period.smalls.length > 0 && (
                        <TinyBlock items={period.smalls} periodId={period.id} />
                      )}
                    </div>
                  </>
                )}
              </section>
            )
          })}
        </div>
      )}

      <div className="win-foot">
        <a href={GITHUB_REPO_BASE} target="_blank" rel="noopener noreferrer">Volledig commit-archief</a>
        ·
        <button type="button" onClick={refresh} disabled={loading}>Vernieuwen</button>
      </div>
    </div>
  )
}
