import UpdatesTimeline from '../../../updates/UpdatesTimeline'

// UpdatesPage (admin) — host de herbruikbare timeline. Timeline rendert
// z'n eigen header (paper-look), dus AdminSubHeader is uitgeschakeld voor
// dit pad. Owner ziet beide areas (RLS).
export default function UpdatesPage() {
  return (
    <UpdatesTimeline
      limit={120}
      title="Updates"
      intro="Per dag overzicht van wat er aan het platform en beheercentrum is veranderd. Gerelateerde wijzigingen worden samengevoegd; kleine aanpassingen vind je ingeklapt onderaan elke dag."
    />
  )
}
