import { useState, useMemo } from 'react'
import { useUpdates } from '../../hooks/useUpdates'
import { Icon } from './updatesIcons'
import { parseDate, shortDate, dayMonthLong, MONTHS_NL, processData } from './updatesProcessing'
import { HeroCard, MajorCard, ModuleBlock, TinyBlock, GITHUB_REPO_BASE } from './UpdatesTiers'
import './updates-timeline.css'

// UpdatesTimeline — editorial changelog met drie tiers van update-grootte.
//   1. Hero        — top-release per dag (één per render, nieuwste dag)
//   2. Major card  — feature-blokken (≥2 commits met dezelfde key)
//   3. Stream rij  — losse commits, gegroepeerd per module
//   + Tiny         — kleine commits (chore/typo/fix), collapsible onderaan
//
// Data komt uit useUpdates → platform_updates (één rij per dag per area).
// RLS bepaalt zichtbaarheid; areaFilter='platform' forceert user-view-mode.
// De render-tiers leven in UpdatesTiers, copy-opschoning in updatesHumanize.

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
              Owner
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
                <span><b>{counts.all - counts.user}</b> alleen voor owner</span>
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
                    <div className="win-date-head__num">{dayMonthLong(period.release_date)}</div>
                    {periodIdx === 0 && (
                      <span className="win-date-head__ver is-current">Live · meest recent</span>
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
