export default function ActionBtn({ label, kbd, variant = 'ghost', disabled, onClick, title }) {
  const base = btnStyle(variant)
  return (
    <div role="button" tabIndex={disabled ? -1 : 0}
      title={title}
      onClick={() => { if (!disabled && onClick) onClick() }}
      onKeyDown={e => {
        if (disabled) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick && onClick() }
      }}
      style={{
        ...base,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        userSelect: 'none',
      }}>
      <span>{label}</span>
      {kbd && <span style={kbdStyle}>{kbd}</span>}
    </div>
  )
}

export const kbdStyle = {
  display: 'inline-block', padding: '0 5px', minWidth: 16, textAlign: 'center',
  border: '1px solid color-mix(in srgb, currentColor 35%, transparent)',
  borderBottomWidth: 2, borderRadius: 4, fontSize: 10,
  fontFamily: "'SF Mono', Menlo, monospace", opacity: 0.75, lineHeight: 1.35,
}

export function btnStyle(variant) {
  const base = {
    minWidth: 120, padding: '8px 14px', borderRadius: 8,
    fontSize: 13, fontWeight: 500, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 8,
    fontFamily: 'inherit',
  }
  if (variant === 'primary') return { ...base, background: 'var(--accent)', color: 'white', border: '1px solid var(--accent)' }
  if (variant === 'ghost')   return { ...base, background: 'var(--surface-1)', color: 'var(--text)', border: '1px solid var(--border)' }
  if (variant === 'dim')     return { ...base, background: 'var(--surface-1)', color: 'var(--text-muted)', border: '1px solid var(--border)', opacity: 0.45 }
  return base
}
