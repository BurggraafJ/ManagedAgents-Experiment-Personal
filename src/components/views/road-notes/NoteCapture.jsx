import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useFormState } from '../../../hooks/useFormState'
import MicButton from '../../MicButton'
import styles from './SalesOnRoadView.module.css'

/**
 * NoteCapture — quick-capture textarea voor een sales-on-road notitie.
 * Submit gaat via RPC `submit_sales_on_road_note` naar `sales_on_road_inbox`.
 *
 * Gebruikt useFormState (Refactor 04) ook al heeft het maar één veld:
 * de bind() shortcut + `setValues({ text: '' })` voor reset is consistenter
 * dan een aparte useState.
 */
export default function NoteCapture() {
  const { values, setValue, setValues } = useFormState({ text: '' })
  const [submitState, setSubmitState] = useState('idle') // idle | submitting | ok | error
  const [submitError, setSubmitError] = useState(null)

  async function submit() {
    if (submitState === 'submitting') return
    const trimmed = values.text.trim()
    if (!trimmed) return
    setSubmitState('submitting')
    setSubmitError(null)
    const { error } = await supabase.rpc('submit_sales_on_road_note', { p_text: trimmed })
    if (error) {
      setSubmitError(error.message)
      setSubmitState('error')
      setTimeout(() => setSubmitState('idle'), 4000)
      return
    }
    setValues({ text: '' })
    setSubmitState('ok')
    setTimeout(() => setSubmitState('idle'), 2000)
  }

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  return (
    <section>
      <div className="section__head">
        <h2 className="section__title">Nieuwe aantekening</h2>
        <span className="section__hint">na een kennismaking — agent verwerkt bij volgende run</span>
      </div>
      <div className="card" style={{ padding: 'var(--s-5)' }}>
        <div className={styles.textareaWrap}>
          <textarea
            value={values.text}
            onChange={e => setValue('text', e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Bijv. Net bij Stellicher geweest, 8 advocaten, stuur offerte. Of: kennismaking met Joosten Advocaten — Tarik wil demo volgende week."
            rows={4}
            className={styles.textarea}
            disabled={submitState === 'submitting'}
          />
          <MicButton
            onTranscript={t => setValue('text', values.text ? `${values.text} ${t}` : t)}
          />
        </div>
        <div className={styles.formActions}>
          <span className="muted">Ctrl/⌘+Enter om te versturen</span>
          <div className={styles.formActionsRight}>
            {submitState === 'ok' && <span className="s-success">✓ opgeslagen</span>}
            {submitState === 'error' && <span className="s-error" title={submitError}>✗ fout</span>}
            <button
              type="button"
              className="btn btn--accent"
              onClick={submit}
              disabled={submitState === 'submitting' || !values.text.trim()}
            >
              {submitState === 'submitting' ? 'Versturen…' : 'Versturen'}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
