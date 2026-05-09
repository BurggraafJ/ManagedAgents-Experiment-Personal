import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import styles from './tasks.module.css'

const AGENT = 'task-organizer'

export default function ReorganizeButton() {
  const [state, setState] = useState('idle')
  const [msg, setMsg] = useState(null)

  const trigger = async () => {
    if (state === 'submitting') return
    setState('submitting'); setMsg(null)
    try {
      await supabase.from('tasks').update({ ai_processed: false })
        .neq('status', 'done').neq('status', 'dropped')
      const { data, error } = await supabase.rpc('request_run_now', { agent: AGENT })
      if (error) throw error
      if (data?.ok) {
        setState('ok')
        setMsg(data.status === 'already_requested'
          ? 'Aanvraag stond al open — wacht op orchestrator.'
          : 'Skill aangevraagd — orchestrator pakt hem bij volgende poll op.')
      } else {
        setState('err'); setMsg(data?.reason || 'mislukt')
      }
    } catch (err) {
      setState('err'); setMsg(err.message || 'mislukt')
    } finally {
      setTimeout(() => { setState('idle'); setMsg(null) }, 5000)
    }
  }

  return (
    <div className={styles.reorgWrapper}>
      <button
        className="btn btn--ghost" onClick={trigger}
        disabled={state === 'submitting'}
        title="Markeer alles voor herindeling en draai task-organizer-skill"
      >
        ✨ AI herindelen
      </button>
      {msg && (
        <div
          className={`muted ${styles.reorgMsg}`}
          style={{ color: state === 'err' ? 'var(--error)' : 'var(--accent)' }}
        >{msg}</div>
      )}
    </div>
  )
}
