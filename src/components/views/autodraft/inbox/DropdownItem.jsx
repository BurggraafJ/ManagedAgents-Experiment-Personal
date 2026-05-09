export default function DropdownItem({ icon, title, subtitle, onClick }) {
  return (
    <button type="button"
      onClick={onClick}
      style={{
        display: 'flex', gap: 10, alignItems: 'flex-start', width: '100%',
        padding: '8px 10px', borderRadius: 4,
        border: 'none', cursor: 'pointer', fontFamily: 'inherit',
        background: 'transparent', color: 'var(--text)', textAlign: 'left',
      }}
      onMouseEnter={e => e.currentTarget.style.background = '#F3F2F1'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }} aria-hidden>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 500 }}>{title}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.4 }}>{subtitle}</div>
      </div>
    </button>
  )
}
