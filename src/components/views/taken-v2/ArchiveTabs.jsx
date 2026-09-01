import { supabase } from '../../../lib/supabase'
import { dbPrioToMockup, fmtDateOrMonth } from './v2-helpers'
import styles from './taken-v2.module.css'
import pops from './taken-v2-pops.module.css'

// Secundaire weergaven achter het ⋯-menu: Afgeronde taken + Verwijderd.

/* ============ Afgerond ============ */
export function AfgerondTab({ tasks, applyOptimistic }) {
  if (tasks.length === 0) {
    return <div className={styles.empty}>Nog geen afgeronde taken. Vink een taak af om hem hier in het log te zien.</div>
  }
  const restore = async (id) => {
    applyOptimistic(id, { status: 'open', completed_at: null })
    await supabase.from('tasks').update({ status: 'open', completed_at: null }).eq('id', id)
  }
  return (
    <div className={styles.card}>
      <div className={styles.hint}>Log van afgeronde taken — meest recent eerst.</div>
      {tasks.slice(0, 50).map(t => {
        const prio = dbPrioToMockup(t.priority)
        const when = t.completed_at || t.updated_at
        const kind = t.deadline_kind || 'day'
        return (
          <div key={t.id} className={styles.logRow}>
            <span className={`${styles.check} ${styles.checked} ${styles.checkStatic}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
            </span>
            <span className={styles.logTitle}>{t.title}</span>
            <div className={styles.logMeta}>
              <span className={`${pops.prioPill} ${pops[prio]}`}>{prio}</span>
              {when && <span>{fmtDateOrMonth(when.slice(0, 10), kind)}</span>}
              <button type="button" className={styles.smallBtn} onClick={() => restore(t.id)}>Heropen</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ============ Verwijderd (prullenbak, 14d bewaartermijn) ============ */
export function VerwijderdTab({ tasks, applyOptimistic }) {
  if (tasks.length === 0) {
    return <div className={styles.empty}>Prullenbak is leeg. Verwijderde taken verschijnen hier 14 dagen lang.</div>
  }
  const restore = async (id) => {
    applyOptimistic(id, { status: 'open' })
    await supabase.from('tasks').update({ status: 'open' }).eq('id', id)
  }
  const now = Date.now()
  return (
    <div className={styles.card}>
      <div className={styles.hint}>
        Verwijderde taken — na 14 dagen worden ze definitief weggegooid. Klik <em>Herstel</em> om terug te halen.
      </div>
      {tasks.map(t => {
        const when = new Date(t.updated_at || t.created_at)
        const daysSince = Math.floor((now - when.getTime()) / 86400000)
        const daysLeft = 14 - daysSince
        return (
          <div key={t.id} className={styles.logRow}>
            <span className={`${styles.logTitle} ${styles.logTitleStruck}`}>{t.title}</span>
            <div className={styles.logMeta}>
              <span>{daysSince === 0 ? 'vandaag' : daysSince === 1 ? 'gisteren' : daysSince + 'd geleden'}</span>
              <span className={`${styles.countdown} ${daysLeft <= 3 ? styles.countdownUrgent : ''}`}>verloopt over {daysLeft}d</span>
              <button type="button" className={styles.smallBtn} onClick={() => restore(t.id)}>Herstel</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
