import Skeleton from '../../ui/Skeleton'

/**
 * NowSkeleton — loading-state voor NowView (Dashboard).
 *
 * Mimickt het volledige layout van de dashboard zodat de overgang naar
 * echte data geen layout-shift veroorzaakt. NowTopbar + Greeting blijven
 * echt (geen data-afhankelijkheid) — dit component vervangt alles vanaf
 * de FocusGrid t/m de WeekProgress sectie.
 *
 * Gebruik: render in NowView zolang `useAgents().loading === true` en
 * er nog geen runs binnen zijn.
 */
export default function NowSkeleton() {
  return (
    <Skeleton.Group label="Dashboard wordt geladen — agent-runs, schedules en open vragen ophalen">
      {/* Focus-tiles (4 koloms) */}
      <div className="now-focus-grid">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`now-focus ${i === 0 ? 'now-focus--accent' : ''} now-focus--skel`}>
            <div className="now-focus__head">
              <Skeleton variant="block" width={22} height={22} className="now-skel__focus-icon" />
              <Skeleton variant="line" width="55%" />
            </div>
            <Skeleton variant="block" width={i === 1 ? 86 : 64} height={i === 1 ? 30 : 42} className="now-skel__focus-num" />
            <Skeleton variant="line" width="80%" className="now-skel__focus-sub" />
            <Skeleton variant="line" width="40%" className="now-skel__focus-cta" />
          </div>
        ))}
      </div>

      {/* Row 2-col: agenda-strip + activity-feed */}
      <div className="now-row-2col">
        {/* Agenda-strip placeholder */}
        <div className="now-section now-skel__strip">
          <div className="now-section__head">
            <Skeleton variant="line" width={140} height={14} />
            <Skeleton variant="pill" width={64} />
          </div>
          <div className="now-skel__strip-rail">
            {[
              { left: 8,  width: 18 },
              { left: 32, width: 14 },
              { left: 54, width: 22 },
              { left: 82, width: 12 },
            ].map((ev, i) => (
              <div
                key={i}
                className="now-skel__strip-ev"
                style={{ left: `${ev.left}%`, width: `${ev.width}%` }}
              >
                <Skeleton variant="line" width="75%" height={9} />
                <Skeleton variant="line" width="45%" height={8} />
              </div>
            ))}
          </div>
        </div>

        {/* Activity-feed placeholder */}
        <div className="now-feed now-skel__feed">
          <div className="now-feed__head">
            <Skeleton variant="line" width={120} height={14} />
            <Skeleton variant="line" width={56} height={11} />
          </div>
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="now-feed__row">
              <Skeleton variant="block" width={28} height={28} className="now-skel__feed-ic" />
              <div className="now-feed__main">
                <Skeleton variant="line" width="78%" />
                <Skeleton variant="line" width="50%" className="now-skel__feed-sub" />
              </div>
              <Skeleton variant="line" width={40} height={10} />
            </div>
          ))}
        </div>
      </div>

      {/* Agents-grid (3 koloms, 2 rijen) */}
      <div className="now-section now-skel__section">
        <div className="now-section__head">
          <Skeleton variant="line" width={160} height={16} />
          <Skeleton variant="line" width={80} height={11} />
        </div>
        <div className="now-agents-grid">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} className="now-agent now-skel__agent">
              <div className="now-agent__top">
                <Skeleton variant="block" width={34} height={34} className="now-skel__agent-ic" />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <Skeleton variant="line" width="70%" />
                  <Skeleton variant="line" width="40%" height={9} />
                </div>
                <Skeleton variant="pill" width={48} />
              </div>
              <Skeleton variant="line" width="90%" className="now-skel__agent-sub" />
              <Skeleton variant="line" width="60%" />
              <div className="now-skel__agent-foot">
                <Skeleton variant="line" width={72} height={10} />
                <Skeleton variant="line" width={50} height={10} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Runs-list */}
      <div className="now-runs now-skel__runs">
        <div className="now-runs__head">
          <Skeleton variant="line" width={140} height={14} />
          <Skeleton variant="line" width={64} height={11} />
        </div>
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="now-run-row">
            <Skeleton variant="block" width={26} height={26} className="now-skel__run-ic" />
            <div className="now-run-row__msg" style={{ flex: 1 }}>
              <Skeleton variant="line" width="55%" />
              <Skeleton variant="line" width="30%" height={9} className="now-skel__run-sub" />
            </div>
            <Skeleton variant="line" width={48} height={10} />
          </div>
        ))}
      </div>

      {/* Database-sectie (TruthOfSources) — groter blok */}
      <div className="now-skel__big-block">
        <div className="now-section__head">
          <Skeleton variant="line" width={120} height={14} />
        </div>
        <Skeleton width="100%" height={180} className="now-skel__big-body" />
      </div>
    </Skeleton.Group>
  )
}
