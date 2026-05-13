import Skeleton from '../../../ui/Skeleton'

/**
 * AdminMaestroSkeleton — loading-state voor HubSpotInboxMaestroView.
 *
 * Mimickt het exacte layout-skelet:
 *  - filter-chips (3 pillen)
 *  - adm-split: links 3 filter-bucket cards (Nieuw / Goedkeuren / Meer info)
 *    met sticky-head + 2-4 row-placeholders elk; rechts detail-card met
 *    head/diff/why/records/actions skelet
 *  - adm-bottom: 3 va-blocks (Laatst verwerkt / Andere contactmomenten / Cijfers)
 *
 * Renderen wanneer `useAdmin().loading === true` en er nog geen data is.
 * Geen layout-shift naar echte view want zelfde class-namen + dimensies.
 */

const LIST_BUCKETS = [
  { accent: 'new',    label: 'Nieuw',                 count: 5, rows: 4 },
  { accent: 'review', label: 'Goedkeuren',            count: 7, rows: 5 },
  { accent: 'need',   label: 'Meer informatie nodig', count: 2, rows: 2 },
]

const BOTTOM_BLOCKS = [
  { title: 'Laatst verwerkt',         rows: 3 },
  { title: 'Andere contactmomenten',  rows: 2 },
  { title: 'Cijfers',                 rows: 0 }, // KPI grid ipv log-rows
]

export default function AdminMaestroSkeleton() {
  return (
    <Skeleton.Group label="Administratie wordt geladen — voorstellen ophalen">
      <div className="adm adm--loading">

        {/* Filter chips */}
        <div className="adm-filters">
          <Skeleton variant="pill" width={92}  height={28} />
          <Skeleton variant="pill" width={130} height={28} />
          <Skeleton variant="pill" width={180} height={28} />
        </div>

        {/* Split: list (3 cards) + detail */}
        <div className="adm-split">
          <aside className="adm-list">
            <div className="adm-list-scroll">
              {LIST_BUCKETS.map(g => (
                <div key={g.accent} className="adm-list-group">
                  <div className={`adm-list-group-head adm-list-group-head--${g.accent}`}>
                    <span>{g.label}</span>
                    <span>{g.count}</span>
                  </div>
                  {Array.from({ length: g.rows }).map((_, i) => (
                    <SkeletonRow key={i} />
                  ))}
                </div>
              ))}
            </div>
          </aside>

          <main className="adm-detail">
            <SkeletonDetail />
          </main>
        </div>

        {/* Bottom blocks */}
        <div className="adm-bottom">
          {BOTTOM_BLOCKS.map((b, idx) => (
            <section key={idx} className="va-block">
              <div className="va-block__head">
                <Skeleton variant="line" width={10} />
                <Skeleton variant="line" width={120} height={13} />
                <Skeleton variant="line" width={20} />
                <span style={{ flex: 1 }} />
                <Skeleton variant="line" width={90} height={11} />
              </div>
              {b.rows > 0 ? (
                <div className="va-block__body">
                  {Array.from({ length: b.rows }).map((_, j) => (
                    <SkeletonLogRow key={j} />
                  ))}
                </div>
              ) : (
                <div className="kpi-grid">
                  <SkeletonKpi tone="accent" />
                  <SkeletonKpi tone="success" />
                  <SkeletonKpi />
                  <SkeletonKpi />
                </div>
              )}
            </section>
          ))}
        </div>

      </div>
    </Skeleton.Group>
  )
}

/* Eén list-row skelet: icon-square (26x26) + title-line + sub-line + time. */
function SkeletonRow() {
  return (
    <div className="adm-row sk-row">
      <Skeleton variant="circle" size={10} className="sk-row__icon" />
      <div className="adm-row__main">
        <Skeleton variant="line" width="80%" />
        <Skeleton variant="line" width="55%" className="sk-row__sub" />
      </div>
      <div className="adm-row__meta">
        <Skeleton variant="line" width={36} />
      </div>
    </div>
  )
}

/* Detail-card skelet: head + samenvatting + 2 record-cards + actions-row. */
function SkeletonDetail() {
  return (
    <div className="sk-detail">
      {/* Head: cat-pill + stage-pill + source-pill */}
      <div className="sk-detail__head">
        <div className="sk-detail__pills">
          <Skeleton variant="pill" width={70}  height={22} />
          <Skeleton variant="pill" width={150} height={22} />
          <Skeleton variant="pill" width={72}  height={22} />
        </div>
        <Skeleton variant="line" width="68%" height={20} className="sk-detail__title" />
        <Skeleton variant="line" width="38%" height={12} className="sk-detail__sub" />
      </div>

      {/* Samenvatting */}
      <div className="sk-detail__why">
        <Skeleton variant="line" width="22%" height={11} className="sk-detail__why-label" />
        <Skeleton variant="line" width="100%" />
        <Skeleton variant="line" width="92%" className="sk-detail__why-line" />
        <Skeleton variant="line" width="65%" className="sk-detail__why-line" />
      </div>

      {/* Records head */}
      <div className="sk-detail__records-head">
        <Skeleton variant="line" width="35%" height={11} />
      </div>

      {/* 2 rec-cards */}
      <div className="sk-detail__records">
        <SkeletonRecCard variant="note" />
        <SkeletonRecCard variant="task" />
      </div>

      {/* Actions row */}
      <div className="sk-detail__actions">
        <Skeleton width={130} height={34} className="sk-detail__btn" />
        <Skeleton width={110} height={34} className="sk-detail__btn" />
        <Skeleton width={92}  height={34} className="sk-detail__btn" />
      </div>
    </div>
  )
}

function SkeletonRecCard({ variant }) {
  return (
    <div className="sk-rec-card">
      <div className="sk-rec-card__bar">
        <Skeleton width={14} height={14} />
        <Skeleton variant="line" width={50} height={11} />
        <Skeleton variant="line" width={120} height={11} className="sk-rec-card__sub" />
        <span style={{ flex: 1 }} />
        <Skeleton width={24} height={24} className="sk-rec-card__tool" />
      </div>
      <div className="sk-rec-card__body">
        {variant === 'note' ? (
          <>
            <Skeleton variant="line" width="95%" />
            <Skeleton variant="line" width="88%" className="sk-rec-card__line" />
            <Skeleton variant="line" width="72%" className="sk-rec-card__line" />
          </>
        ) : (
          <>
            <Skeleton variant="line" width="60%" height={16} className="sk-rec-card__title" />
            <div className="sk-rec-card__task-row">
              <Skeleton variant="line" width="100%" height={28} />
              <Skeleton variant="line" width="100%" height={28} />
              <Skeleton variant="line" width="100%" height={28} />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SkeletonKpi({ tone }) {
  const cls = tone === 'accent' ? 'kpi accent' : tone === 'success' ? 'kpi success' : 'kpi'
  return (
    <div className={cls}>
      <Skeleton variant="line" width="50%" height={11} />
      <Skeleton variant="line" width="40%" height={22} className="sk-kpi__value" />
      <Skeleton variant="line" width="65%" height={11} className="sk-kpi__sub" />
    </div>
  )
}

function SkeletonLogRow() {
  return (
    <div className="log-row sk-log-row">
      <Skeleton variant="line" width={42} />
      <Skeleton variant="line" width="60%" />
      <span style={{ flex: 1 }} />
      <Skeleton variant="line" width={68} />
    </div>
  )
}
