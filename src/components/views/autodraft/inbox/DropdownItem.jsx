import styles from '../autodraft.module.css'

export default function DropdownItem({ icon, title, subtitle, onClick }) {
  return (
    <button type="button"
      onClick={onClick}
      className={styles.dropdownItem}
      onMouseEnter={e => e.currentTarget.style.background = '#F3F2F1'}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
      <span className={styles.dropdownItemIcon} aria-hidden>{icon}</span>
      <div className={styles.dropdownItemContent}>
        <div className={styles.dropdownItemTitle}>{title}</div>
        <div className={styles.dropdownItemSub}>{subtitle}</div>
      </div>
    </button>
  )
}
