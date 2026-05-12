import Skeleton from '../../ui/Skeleton'

/**
 * SettingsSkeleton — loading-state voor SettingsView.
 *
 * Matched de Maestro-layout: 240px nav-pane (titel + 4 groep-secties met items)
 * + content-pane (page-head + toggle + tabs + body). Geen layout-shift bij
 * overgang naar echte data — class-namen en geometrie zijn identiek aan
 * SettingsLayout / page-head.
 *
 * Gebruik: render in SettingsView zolang de eerste hook (`schedules`) nog
 * geen rijen heeft geladen.
 */

const NAV_GROUPS_SKEL = [
  { label: 76, items: [180, 150, 130] },
  { label: 72, items: [110] },
  { label: 64, items: [90] },
  { label: 110, items: [100, 130, 110] },
]

const TAB_WIDTHS = [88, 80, 100, 110, 96, 120, 78, 130, 70, 130, 130]

export default function SettingsSkeleton() {
  return (
    <Skeleton.Group label="Instellingen worden geladen">
      <div className="theme-maestro settings-app settings-shell" aria-hidden="true">
        {/* Nav-pane */}
        <aside className="settings-nav">
          <div className="settings-nav__title">
            <Skeleton variant="line" width={104} height={16} />
          </div>

          {NAV_GROUPS_SKEL.map((g, gIdx) => (
            <div key={gIdx} className="settings-nav__group">
              <div className="settings-nav__group-label">
                <Skeleton variant="line" width={g.label} height={9} />
              </div>
              {g.items.map((w, iIdx) => (
                <div key={iIdx} className="settings-nav__link" style={{ pointerEvents: 'none' }}>
                  <Skeleton variant="line" width={w} height={11} />
                </div>
              ))}
            </div>
          ))}
        </aside>

        {/* Content */}
        <div className="settings-content">
          <div className="settings-page">
            {/* Page head */}
            <div className="settings-page__head">
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Skeleton variant="line" width={140} height={22} />
                <Skeleton variant="line" width="78%" />
                <Skeleton variant="line" width="62%" />
              </div>
              <div className="settings-page__actions">
                <Skeleton variant="pill" width={120} />
              </div>
            </div>

            {/* Toggle-group placeholder */}
            <div className="settings-toggle" aria-hidden="true">
              <span className="settings-toggle__btn is-active" style={{ pointerEvents: 'none' }}>
                <Skeleton variant="line" width={64} height={10} />
              </span>
              <span className="settings-toggle__btn" style={{ pointerEvents: 'none' }}>
                <Skeleton variant="line" width={180} height={10} />
              </span>
            </div>

            {/* Tabs (agents) placeholder */}
            <div className="instructies__tabs" aria-hidden="true">
              {TAB_WIDTHS.map((w, i) => (
                <span
                  key={i}
                  className={`instructies__tab ${i === 0 ? 'is-active' : ''}`}
                  style={{ pointerEvents: 'none' }}
                >
                  <Skeleton variant="line" width={w} height={11} />
                  <Skeleton variant="circle" size={6} />
                </span>
              ))}
            </div>

            {/* Meta-row */}
            <div className="instructies__meta" aria-hidden="true" style={{ marginTop: 8 }}>
              <Skeleton variant="line" width={140} height={11} />
              <Skeleton variant="line" width={260} height={11} />
            </div>

            {/* Editor placeholder card */}
            <div
              className="pcv7__note-rte"
              aria-hidden="true"
              style={{
                marginTop: 12,
                padding: 18,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                minHeight: 320,
              }}
            >
              <Skeleton variant="line" width="92%" />
              <Skeleton variant="line" width="88%" />
              <Skeleton variant="line" width="78%" />
              <Skeleton variant="line" width="94%" />
              <Skeleton variant="line" width="60%" />
              <div style={{ height: 12 }} />
              <Skeleton variant="line" width="86%" />
              <Skeleton variant="line" width="72%" />
              <Skeleton variant="line" width="90%" />
              <Skeleton variant="line" width="55%" />
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <Skeleton variant="pill" width={88} height={30} />
              <Skeleton variant="pill" width={130} height={30} />
            </div>
          </div>
        </div>
      </div>
    </Skeleton.Group>
  )
}
