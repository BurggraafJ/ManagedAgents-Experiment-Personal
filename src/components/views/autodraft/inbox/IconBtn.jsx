export default function IconBtn({ children, onClick, title, disabled, active }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title}
      style={{
        padding: '5px 9px', borderRadius: 6,
        border: '1px solid var(--border)',
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1, fontFamily: 'inherit', fontSize: 12,
      }}>
      {children}
    </button>
  )
}
