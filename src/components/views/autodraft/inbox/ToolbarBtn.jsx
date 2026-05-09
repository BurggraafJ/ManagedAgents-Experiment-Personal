// Outlook-toolbar button — icon-boven-label, ribbon-style. Gebruikt .ot-btn
// CSS-klasse die alleen binnen .mc-app de Outlook-look pakt.
export default function ToolbarBtn({ icon, label, primary, danger, active, disabled, onClick, title }) {
  const cls = ['ot-btn']
  if (primary) cls.push('ot-btn--primary')
  else if (danger) cls.push('ot-btn--danger')
  else if (active) cls.push('ot-btn--accent')
  return (
    <button type="button" disabled={disabled} onClick={onClick} title={title}
      className={cls.join(' ')}
      style={{ background: active && !primary && !danger ? 'var(--accent-soft)' : undefined }}>
      <span className="ot-btn__icon" aria-hidden>{icon}</span>
      <span className="ot-btn__label">{label}</span>
    </button>
  )
}
