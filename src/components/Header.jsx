export default function Header({ lastRefresh, onRefresh }) {
  const t = lastRefresh ? lastRefresh.toLocaleTimeString('nl-NL') : '—'
  return (
    <header style={{
      background: '#2B2B2B',
      borderBottom: '1px solid #383838',
      padding: '16px 28px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    }}>
      <div style={{ fontSize: 22, fontWeight: 300, letterSpacing: '-0.3px' }}>
        legal <span style={{ color: '#E86832' }}>mind</span>
        <span style={{ color: '#888', marginLeft: 12, fontSize: 14 }}>agent dashboard</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, color: '#888', fontSize: 12 }}>
        <span>bijgewerkt {t}</span>
        <button onClick={onRefresh} style={{
          background: '#1E1E1E',
          color: '#E0E0E0',
          border: '1px solid #383838',
          padding: '6px 12px',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 12,
        }}>↻ ververs</button>
      </div>
    </header>
  )
}
