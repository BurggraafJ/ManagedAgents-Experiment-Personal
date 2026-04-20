export default function Sparkline({ history = [] }) {
  const slots = history.length >= 7
    ? history.slice(-7)
    : [...Array(7 - history.length).fill('empty'), ...history]

  return (
    <span className="spark" title="laatste 7 runs">
      {slots.map((s, i) => (
        <span key={i} className={`spark__bar spark__bar--${s || 'empty'}`} />
      ))}
    </span>
  )
}
