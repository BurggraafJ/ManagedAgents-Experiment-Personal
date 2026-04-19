const COLORS = {
  success: '#2d6a2d',
  warning: '#7a5f00',
  error: '#6a1a1a',
  empty: '#252525',
}

export default function Sparkline({ history = [] }) {
  const slots = history.length >= 7 ? history.slice(-7) : [...Array(7 - history.length).fill('empty'), ...history]
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {slots.map((s, i) => (
        <div key={i} style={{
          width: 10,
          height: 16,
          background: COLORS[s] || COLORS.empty,
          borderRadius: 2,
        }} title={s} />
      ))}
    </div>
  )
}
