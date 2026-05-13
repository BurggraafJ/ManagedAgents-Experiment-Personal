import Skeleton from '../../ui/Skeleton'
import './settings.css'

/**
 * SettingsSkeleton — loading-state voor SettingsView.
 *
 * Spiegelt SettingsLayout geometry (240px nav + content) zodat overgang
 * naar echte data geen layout-shift veroorzaakt.
 */
const NAV_GROUPS = [
  { label: 70, items: [104, 124, 116] },
  { label: 64, items: [108] },
  { label: 50, items: [84] },
  { label: 100, items: [98, 124, 108] },
]
const TAB_WIDTHS = [88, 80, 100, 110, 96, 120, 78, 130, 70, 130, 130]

export default function SettingsSkeleton() {
  return (
    <Skeleton.Group label="Instellingen wordt geladen">
      <div className="set-app" aria-hidden="true">
        <aside className="set-nav">
          <div className="set-nav__title">
            <Skeleton variant="line" width={104} height={16} />
          </div>
          {NAV_GROUPS.map((g, gi) => (
            <div key={gi} className="set-nav__group">
              <div className="set-nav__group-label">
                <Skeleton variant="line" width={g.label} height={9} />
              </div>
              {g.items.map((w, ii) => (
                <div key={ii} className="set-nav__item" style={{ pointerEvents: 'none' }}>
                  <Skeleton variant="circle" size={14} />
                  <span className="set-nav__item-label">
                    <Skeleton variant="line" width={w} height={11} />
                  </span>
                </div>
              ))}
            </div>
          ))}
        </aside>

        <div className="set-content">
          <div className="set-content__inner">
            <header className="set-ph">
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Skeleton variant="line" width={140} height={22} />
                <Skeleton variant="line" width="80%" />
                <Skeleton variant="line" width="62%" />
              </div>
              <div className="set-ph__right">
                <Skeleton variant="pill" width={130} />
              </div>
            </header>

            <div className="set-toggle" aria-hidden="true">
              <span className="set-toggle__btn is-active" style={{ pointerEvents: 'none' }}>
                <Skeleton variant="line" width={64} height={10} />
              </span>
              <span className="set-toggle__btn" style={{ pointerEvents: 'none' }}>
                <Skeleton variant="line" width={180} height={10} />
              </span>
            </div>

            <div className="set-tabs" aria-hidden="true">
              {TAB_WIDTHS.map((w, i) => (
                <span
                  key={i}
                  className={`set-tab ${i === 0 ? 'is-active' : ''}`}
                  style={{ pointerEvents: 'none' }}
                >
                  <Skeleton variant="line" width={w} height={11} />
                  <span className="set-tab__dot is-empty" />
                </span>
              ))}
            </div>

            <div className="set-meta-row" aria-hidden="true" style={{ marginTop: 8 }}>
              <Skeleton variant="line" width={140} height={11} />
              <Skeleton variant="line" width={260} height={11} />
            </div>

            <div className="set-editor" aria-hidden="true">
              <div className="set-editor__toolbar">
                <Skeleton variant="line" width={60} height={11} />
              </div>
              <div className="set-editor__body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Skeleton variant="line" width="92%" />
                <Skeleton variant="line" width="86%" />
                <Skeleton variant="line" width="78%" />
                <Skeleton variant="line" width="94%" />
                <Skeleton variant="line" width="60%" />
                <div style={{ height: 12 }} />
                <Skeleton variant="line" width="86%" />
                <Skeleton variant="line" width="72%" />
                <Skeleton variant="line" width="90%" />
              </div>
            </div>

            <div className="set-actions" aria-hidden="true">
              <Skeleton variant="pill" width={88} height={30} />
              <Skeleton variant="pill" width={130} height={30} />
            </div>
          </div>
        </div>
      </div>
    </Skeleton.Group>
  )
}
