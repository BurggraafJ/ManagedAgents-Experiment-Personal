import ReorganizeButton from './ReorganizeButton'
import styles from './tasks.module.css'

export default function TopActionBar({ search, onSearch, totalLive }) {
  return (
    <div className={styles.topBar}>
      <input
        className={`input ${styles.topBarInput}`}
        placeholder="zoeken in titels, notes, tags…"
        value={search}
        onChange={e => onSearch(e.target.value)}
      />
      <span className={`muted ${styles.topBarCount}`}>
        {totalLive} live
      </span>
      <ReorganizeButton />
    </div>
  )
}
