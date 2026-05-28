import styles from '../autodraft.module.css'
import MailRow from './MailRow'

// Render de gegroepeerde mail-lijst (Pinned / Vandaag / Gisteren / …) plus de
// "Laad meer"-knop. Pinned krijgt accent-classes voor visuele scheiding van
// de tijdslijn eronder (Outlook-stijl).
export default function InboxList({
  buckets, visibleFlat, hasMore, onLoadMore, pageSize, totalCount, visibleCount,
  categories, selectedId, setSelectedId, threadCounts, handledIds, flaggedIds,
  onToggleFlag, ragSummaryById, onChangeCategory,
}) {
  const visibleSet = new Set(visibleFlat.map(m => m.mail_id))
  const slice = items => items.filter(m => visibleSet.has(m.mail_id))
  const remaining = totalCount - visibleCount

  return (
    <>
      {(buckets.__order || []).map(label => (
        <Bucket
          key={label}
          label={label}
          items={slice(buckets[label] || [])}
          categories={categories}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          threadCounts={threadCounts}
          handledIds={handledIds}
          flaggedIds={flaggedIds}
          onToggleFlag={onToggleFlag}
          ragSummaryById={ragSummaryById}
          onChangeCategory={onChangeCategory}
        />
      ))}
      {hasMore && (
        <button type="button" onClick={onLoadMore} className={styles.loadMoreBtn}>
          ↓ Laad meer ({remaining} {remaining === 1 ? 'mail' : 'mails'} over)
        </button>
      )}
    </>
  )
}

function Bucket({
  label, items, categories, selectedId, setSelectedId, threadCounts,
  handledIds, flaggedIds, onToggleFlag, ragSummaryById, onChangeCategory,
}) {
  if (items.length === 0) return null
  const isPinned = label === '📌 Pinned'
  const isToday  = label === 'Vandaag'
  const headCls = [
    'ad-list-group__head',
    isPinned ? 'ad-list-group__head--pinned' : '',
    isToday  ? 'ad-list-group__head--today'  : '',
  ].filter(Boolean).join(' ')
  return (
    <div className={`ad-list-group ${isPinned ? 'ad-list-group--pinned' : ''}`}>
      <div className={headCls}>
        <span>{label}</span>
        <span className="ad-list-group__count">{items.length}</span>
      </div>
      {items.map(m => (
        <MailRow
          key={m.mail_id}
          mail={m}
          categories={categories}
          threadCount={threadCounts?.get(m.conversation_id) || 0}
          isHandled={handledIds?.has(m.mail_id)}
          isFlagged={flaggedIds?.has(m.mail_id)}
          onToggleFlag={onToggleFlag}
          onChangeCategory={onChangeCategory}
          ragSummary={ragSummaryById?.get(m.id) || null}
          selected={m.mail_id === selectedId}
          onSelect={() => setSelectedId(m.mail_id)}
        />
      ))}
    </div>
  )
}
