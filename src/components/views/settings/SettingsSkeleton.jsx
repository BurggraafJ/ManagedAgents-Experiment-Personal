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
      <div className="sv2-app" aria-hidden="true">
        <aside className="sv2-nav">
          <div className="sv2-nav__title">
            <Skeleton variant="line" width={104} height={16} />
          </div>
          {NAV_GROUPS.map((g, gi) => (
            <div key={gi} className="sv2-nav__group">
              <div className="sv2-nav__group-label">
                <Skeleton variant="line" width={g.label} height={9} />
              </div>
              {g.items.map((w, ii) => (
                <div key={ii} className="sv2-nav__item" style={{ pointerEvents: 'none' }}>
                  <Skeleton variant="circle" size={14} />
                  <span className="sv2-nav__item-label">
                    <Skeleton variant="line" width={w} height={11} />
                  </span>
                </div>
              ))}
            </div>
          ))}
        </aside>

        <div className="sv2-content">
          <div className="sv2-content__inner">
            <header className="sv2-ph">
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Skeleton variant="line" width={140} height={22} />
                <Skeleton variant="line" width="80%" />
                <Skeleton variant="line" width="62%" />
              </div>
              <div className="sv2-ph__right">
                <Skeleton variant="pill" width={130} />
              </div>
            </header>

            <div className="sv2-toggle" aria-hidden="true">
              <span className="sv2-toggle__btn is-active" style={{ pointerEvents: 'none' }}>
                <Skeleton variant="line" width={64} height={10} />
              </span>
              <span className="sv2-toggle__btn" style={{ pointerEvents: 'none' }}>
                <Skeleton variant="line" width={180} height={10} />
              </span>
            </div>

            <div className="sv2-tabs" aria-hidden="true">
              {TAB_WIDTHS.map((w, i) => (
                <span
                  key={i}
                  className={`sv2-tab ${i === 0 ? 'is-active' : ''}`}
                  style={{ pointerEvents: 'none' }}
                >
                  <Skeleton variant="line" width={w} height={11} />
                  <span className="sv2-tab__dot is-empty" />
                </span>
              ))}
            </div>

            <div className="sv2-meta-row" aria-hidden="true" style={{ marginTop: 8 }}>
              <Skeleton variant="line" width={140} height={11} />
              <Skeleton variant="line" width={260} height={11} />
            </div>

            <div className="sv2-editor" aria-hidden="true">
              <div className="sv2-editor__toolbar">
                <Skeleton variant="line" width={60} height={11} />
              </div>
              <div className="sv2-editor__body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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

            <div className="sv2-actions" aria-hidden="true">
              <Skeleton variant="pill" width={88} height={30} />
              <Skeleton variant="pill" width={130} height={30} />
            </div>
          </div>
        </div>
      </div>
    </Skeleton.Group>
  )
}
