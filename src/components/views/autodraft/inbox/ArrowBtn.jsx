import styles from '../autodraft.module.css'

export default function ArrowBtn({ dir, disabled, onClick }) {
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={() => { if (!disabled) onClick() }}
      onKeyDown={e => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick() } }}
      className={styles.arrowBtn}
      style={{
        color: disabled ? 'var(--text-muted)' : 'var(--text)',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
      }}
      aria-label={dir === 'left' ? 'vorige variant' : 'volgende variant'}
    >
      {dir === 'left' ? '←' : '→'}
    </div>
  )
}
