/**
 * KennisbankView — placeholder.
 * Definitieve invulling volgt — voor nu een duidelijk 'binnenkort'-bericht
 * zodat de sidebar-entry werkt en de URL al bookmarkbaar is.
 */
export default function KennisbankView() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      gap: 16,
      textAlign: 'center',
      padding: '24px',
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: 16,
        background: 'var(--accent-soft, rgba(59,130,246,0.12))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 28,
      }} aria-hidden>📚</div>
      <h2 style={{ margin: 0, fontWeight: 500 }}>Kennisbank — binnenkort</h2>
      <p style={{ color: 'var(--muted)', maxWidth: 540, lineHeight: 1.5, margin: 0 }}>
        Hier komt de centrale plek waar je vragen, antwoorden, best-practices en
        proces-documentatie voor Customer Success bij elkaar bewaart. De inhoud wordt
        in een volgende sessie ingericht.
      </p>
    </div>
  )
}
