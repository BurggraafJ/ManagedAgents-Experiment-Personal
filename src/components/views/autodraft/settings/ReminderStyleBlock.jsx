import { useState, useEffect } from 'react'
import { supabase } from '../../../../lib/supabase'
import styles from '../autodraft.module.css'

// ReminderStyleBlock — system message voor reminder/follow-up mails. Stored
// in agent_config (key='reminder_style', agent='auto-draft'). Wordt door
// AwaitingActions getoond bij follow-up als hint, en door auto-draft skill
// gebruikt bij genereren van reminder-mails.
export default function ReminderStyleBlock({ agentInstructions }) {
  const existing = (agentInstructions || []).find(r =>
    r.agent_name === 'auto-draft' && r.config_key === 'reminder_style')
  const initialText = (() => {
    const v = existing?.config_value
    return typeof v === 'string' ? v : (v?.text || '')
  })()
  const [text, setText] = useState(initialText)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    setText(initialText); setSaved(false); setErr(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.updated_at])

  const dirty = text !== initialText

  async function save() {
    setBusy(true); setErr(null); setSaved(false)
    try {
      const { error } = await supabase.from('agent_config').upsert({
        agent_name: 'auto-draft',
        config_key: 'reminder_style',
        config_value: { text },
        updated_at: new Date().toISOString(),
        is_secret: false,
      }, { onConflict: 'agent_name,config_key' })
      if (error) setErr(error.message)
      else setSaved(true)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <section className="va-block">
      <div className={`va-block__head ${styles.cursorDefault}`}>
        <span className="va-block__caret">·</span>
        <span className="va-block__title">Reminder-stijl</span>
        <span className="muted va-block__hint">hoe een follow-up/reminder-mail moet klinken</span>
      </div>
      <div className={`va-block__body ${styles.bodyGrid10}`}>
        <textarea value={text} onChange={e => setText(e.target.value)} disabled={busy} rows={6}
          className="ad-textarea"
          placeholder={'Bijvoorbeeld:\n- Hou het kort en luchtig.\n- Geen druk leggen, niet sturend zijn.\n- Eerste-naam-only opener, geen "Beste".\n- Geen em-dashes, geen Engelse uitdrukkingen.'} />
        <div className={styles.actionsRowAligned}>
          <button className="btn btn--accent" onClick={save} disabled={busy || !dirty}>
            {busy ? 'Opslaan…' : 'Opslaan'}
          </button>
          {saved && <span className={styles.statusOk}>✓ opgeslagen</span>}
          {err   && <span className={styles.statusErr}>⚠ {err}</span>}
          <span className={styles.headerHint}>
            Wordt getoond bij follow-up + meegenomen door de skill.
          </span>
        </div>
      </div>
    </section>
  )
}
