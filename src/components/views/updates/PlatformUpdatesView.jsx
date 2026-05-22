import UpdatesTimeline from '../../updates/UpdatesTimeline'

// PlatformUpdatesView — /updates route in Dashboard. Voor IEDEREEN.
// Expliciet areaFilter='platform' zodat owner-views consistent zijn met
// wat een member zou zien (member krijgt sowieso alleen platform via RLS).
export default function PlatformUpdatesView() {
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', width: '100%' }}>
      <UpdatesTimeline
        limit={120}
        areaFilter="platform"
        title="Wat is nieuw"
        intro="Per dag een overzicht van wat er aan het dashboard is veranderd. Gerelateerde wijzigingen staan samengevoegd; kleine aanpassingen vind je ingeklapt onderaan elke dag."
      />
    </div>
  )
}
