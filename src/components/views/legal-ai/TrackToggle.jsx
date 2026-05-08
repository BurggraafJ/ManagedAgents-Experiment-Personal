import { TRACKS } from '../../../lib/legalAi'
import styles from './LegalAIView.module.css'

/**
 * TrackToggle — pill-buttons om te wisselen tussen advocatuur / bedrijfsleven.
 */
export default function TrackToggle({ active, onChange }) {
  return (
    <div className={styles.trackToggle}>
      {TRACKS.map(t => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={styles.trackBtn}
          data-active={active === t.key ? '1' : '0'}
          style={{ '--track-accent': t.accent }}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
