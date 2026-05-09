import { useState } from 'react'
import { supabase } from '../../../../lib/supabase'
import styles from './api-keys.module.css'

export default function MarkRotatedInline({ row }) {
  const [last4, setLast4] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [done, setDone] = useState(false)

  async function onMark() {
    setBusy(true); setErr(null)
    try {
      const { error } = await supabase.rpc('mark_secret_rotated', {
        p_key_name: row.key_name,
        p_new_last_4: last4 || null,
        p_notes: null,
      })
      if (error) setErr(error.message)
      else setDone(true)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  if (done) return <span className={styles.successText}>✓ Gemarkeerd als geroteerd</span>

  return (
    <div className="api-keys__mark-rotated">
      <div className="api-keys__detail-label">Edge Function secret? Plak nieuwe waarde in Supabase, vul hier de last 4 in:</div>
      <div className={styles.markRotatedRow}>
        <input
          type="text"
          value={last4}
          onChange={e => setLast4(e.target.value.slice(-4))}
          placeholder="last 4"
          maxLength={4}
          disabled={busy}
          className={`settings-input ${styles.inputLast4}`}
        />
        <button className={`btn btn--accent ${styles.btnSmall}`} style={{ padding: '6px 12px' }} onClick={onMark} disabled={busy}>
          {busy ? '…' : 'Markeer geroteerd'}
        </button>
        {err && <span className={styles.errorInline}>{err}</span>}
      </div>
    </div>
  )
}
