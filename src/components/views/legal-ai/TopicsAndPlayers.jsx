import { relativeTime } from '../../../lib/dateFormat'
import styles from './LegalAIView.module.css'

/**
 * TopicsAndPlayers — twee-kolom overzicht van actieve topics + spelers.
 */
export default function TopicsAndPlayers({ topics, players }) {
  return (
    <div className={styles.gridTwo}>
      <div>
        <div className={styles.colHead}>Topics ({topics.length})</div>
        <div className="stack stack--sm" style={{ fontSize: 13 }}>
          {topics.length === 0 && <div className={styles.dimText}>Geen topics actief.</div>}
          {topics.map(t => (
            <div key={t.id} className={styles.colItem}>
              <span>{t.title}</span>
              <span className={styles.colMeta}>
                {relativeTime(t.last_researched_at) || 'nooit'} · d{t.depth_score}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className={styles.colHead}>Spelers ({players.length})</div>
        <div className="stack stack--sm" style={{ fontSize: 13 }}>
          {players.length === 0 && <div className={styles.dimText}>Geen spelers actief.</div>}
          {players.map(p => (
            <div key={p.id} className={styles.colItem}>
              <a href={p.website} target="_blank" rel="noreferrer">{p.name}</a>
              <span className={styles.colMeta}>imp. {p.importance_score}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
