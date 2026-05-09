import { useState, useEffect } from 'react'
import { supabase } from '../../../../lib/supabase'
import styles from '../autodraft.module.css'

// F.2.c — DateReservations: toont uitstaande datumvoorstellen (reserveringen)
// per conversation_id, zodat Jelle voor het versturen ziet welke datums hij
// al aan iemand anders heeft voorgesteld. Leest uit view v_active_date_reservations.
export default function DateReservations({ conversationId }) {
  const [rows, setRows] = useState([])
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (!conversationId) { setRows([]); setLoaded(true); return }
    let cancelled = false
    setLoaded(false)
    async function fetch() {
      try {
        const { data } = await supabase
          .from('v_active_date_reservations')
          .select('proposal_id, recipient_email, recipient_name, slot_state, slot_start, slot_end, expires_at, source, proposed_by')
          .eq('conversation_id', conversationId)
          .order('slot_start', { ascending: true })
        if (!cancelled) {
          setRows(Array.isArray(data) ? data : [])
          setLoaded(true)
        }
      } catch {
        if (!cancelled) { setRows([]); setLoaded(true) }
      }
    }
    fetch()
    return () => { cancelled = true }
  }, [conversationId])

  if (!loaded || rows.length === 0) return null

  const reserved = rows.filter(r => r.slot_state === 'reserved')
  const accepted = rows.filter(r => r.slot_state === 'accepted')

  function fmt(iso) {
    const d = new Date(iso)
    return d.toLocaleDateString('nl-NL', { weekday: 'short', day: '2-digit', month: 'short' })
      + ' · ' + d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
  }
  function ttlLabel(iso) {
    if (!iso) return ''
    const days = Math.round((new Date(iso).getTime() - Date.now()) / 86400000)
    if (days < 0) return ' · verlopen'
    if (days === 0) return ' · verloopt vandaag'
    if (days === 1) return ' · verloopt morgen'
    return ` · verloopt over ${days}d`
  }

  return (
    <div className={`${styles.badgeDetailBlock} ${styles.dateResWrap}`}>
      <div className={styles.dateResHead}>
        <strong>📅 Spelregels — voorgestelde datums</strong>
        <span className={`${styles.badgeMeta} ${styles.badgeMetaFlush}`}>
          via {rows[0]?.source === 'auto-draft-outgoing' ? 'auto-draft' : (rows[0]?.source || 'agenda')}
        </span>
      </div>
      {accepted.length > 0 && (
        <div className={styles.dateResAccepted}>
          ✓ <strong>Geaccepteerd:</strong> {fmt(accepted[0].slot_start)}–{new Date(accepted[0].slot_end).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
      {reserved.length > 0 && (
        <ul className={`${styles.badgeSlotList} ${styles.dateResReservedList}`}>
          {reserved.map((r, i) => (
            <li key={r.proposal_id + '-' + i} className={styles.badgeSlotItem}>
              {fmt(r.slot_start)}–{new Date(r.slot_end).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
              <span className={styles.mutedInline}>
                {' '}· bij <strong>{r.recipient_name || r.recipient_email}</strong>
                {ttlLabel(r.expires_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {reserved.length === 0 && accepted.length > 0 && (
        <div className={`${styles.badgeMeta} ${styles.badgeMetaFlush}`}>
          Andere voorgestelde slots zijn vrijgegeven.
        </div>
      )}
    </div>
  )
}
