import UpdatesTimeline from '../../../updates/UpdatesTimeline'

// UpdatesPage (admin) — host de herbruikbare timeline.
// Subheader (titel + intro) wordt al door AdminShell.AdminSubHeader gerenderd
// via SUB_PAGE_META['/admin/updates']. Owner ziet beide areas (RLS).
export default function UpdatesPage() {
  return <UpdatesTimeline limit={120} />
}
