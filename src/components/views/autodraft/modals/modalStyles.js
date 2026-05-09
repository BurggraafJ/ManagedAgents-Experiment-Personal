// Modal-styling: gedeeld tussen Preference + Spelcheck.
export const modalBackdropStyle = {
  position: 'fixed', inset: 0, zIndex: 100,
  background: 'rgba(15, 23, 42, 0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 24,
}

export const modalCardStyle = {
  background: 'var(--bg)', color: 'var(--text)',
  border: '1px solid var(--border)', borderRadius: 10,
  width: '100%', maxWidth: 480, padding: 20,
  boxShadow: '0 24px 48px rgba(0,0,0,0.18)',
  fontFamily: 'inherit',
}

export const modalLabelStyle = {
  display: 'block', fontSize: 11, fontWeight: 600,
  color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em',
  marginBottom: 4,
}

export const modalInputStyle = {
  width: '100%', padding: '8px 10px',
  border: '1px solid var(--border)', borderRadius: 6,
  background: 'var(--bg)', color: 'var(--text)',
  fontSize: 13,
}

export const modalBtn = {
  padding: '8px 16px', borderRadius: 6,
  border: '1px solid var(--border)', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
}
