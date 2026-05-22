import UpdatesTimeline from '../../updates/UpdatesTimeline'

// PlatformUpdatesView — /updates route in Dashboard. Voor IEDEREEN (members
// + owner). RLS-policy 'platform_updates_read_authenticated' geeft members
// alleen area='platform' rijen; owners zien alles tenzij we expliciet
// filteren. Hier filteren we expliciet op platform zodat de pagina voor
// owner-views consistent is met wat een member zou zien.
export default function PlatformUpdatesView() {
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', width: '100%' }}>
      <UpdatesTimeline limit={120} areaFilter="platform" />
    </div>
  )
}
