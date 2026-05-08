import { useState, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import { useFormState } from '../../../hooks/useFormState'
import { todayIso } from '../../../lib/kilometers'
import styles from './KilometersView.module.css'

const INITIAL = {
  datum: todayIso(),
  van: '',
  naar: '',
  doel: '',
  parkeerkosten: '',
}

/**
 * TripForm — quick-capture invoervorm voor een nieuwe rit. Schrijft naar
 * `km_trips_inbox` via RPC `submit_km_trip`. Gebruikt useFormState (Refactor 04)
 * voor velden + lokale state voor submit-status (idle/submitting/ok/error).
 *
 * Datum wordt na submit bewust *behouden* zodat batch-invoer voor één dag
 * snel gaat. Andere velden resetten naar leeg.
 */
export default function TripForm({ recentPlaces }) {
  const { values, setValue, setValues, reset } = useFormState(INITIAL)
  const [submitState, setSubmitState] = useState('idle') // idle | submitting | ok | error
  const [submitError, setSubmitError] = useState(null)

  async function submit() {
    if (submitState === 'submitting') return
    if (!values.datum) {
      setSubmitError('Datum is verplicht')
      setSubmitState('error')
      setTimeout(() => setSubmitState('idle'), 3000)
      return
    }
    if (!values.van.trim()) {
      setSubmitError('Van is verplicht')
      setSubmitState('error')
      setTimeout(() => setSubmitState('idle'), 3000)
      return
    }
    setSubmitState('submitting')
    setSubmitError(null)
    const { error } = await supabase.rpc('submit_km_trip', {
      p_datum: values.datum,
      p_van: values.van.trim(),
      p_naar: values.naar.trim() || null,
      p_doel: values.doel.trim() || null,
      p_parkeerkosten: values.parkeerkosten ? Number(values.parkeerkosten) : null,
    })
    if (error) {
      setSubmitError(error.message)
      setSubmitState('error')
      setTimeout(() => setSubmitState('idle'), 4000)
      return
    }
    // Reset andere velden, datum behouden voor batch-invoer.
    setValues({ van: '', naar: '', doel: '', parkeerkosten: '' })
    setSubmitState('ok')
    setTimeout(() => setSubmitState('idle'), 2000)
  }

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  const placesId = 'km-places'

  return (
    <section>
      <div className="section__head">
        <h2 className="section__title">Nieuwe rit</h2>
        <span className="section__hint">agent verzamelt en verwerkt op de 2e van de maand</span>
      </div>
      <div className="card" style={{ padding: 'var(--s-5)' }}>
        <datalist id={placesId}>
          {recentPlaces.map(p => <option key={p} value={p} />)}
        </datalist>
        <div className={styles.formGrid}>
          <FormField label="Datum">
            <input
              type="date"
              value={values.datum}
              onChange={e => setValue('datum', e.target.value)}
              onKeyDown={onKeyDown}
              className={styles.fieldInput}
            />
          </FormField>
          <FormField label="Van *">
            <input
              type="text"
              value={values.van}
              onChange={e => setValue('van', e.target.value)}
              onKeyDown={onKeyDown}
              list={placesId}
              placeholder="Deil (thuis)"
              className={styles.fieldInput}
            />
          </FormField>
          <FormField label="Naar">
            <input
              type="text"
              value={values.naar}
              onChange={e => setValue('naar', e.target.value)}
              onKeyDown={onKeyDown}
              list={placesId}
              placeholder="Amsterdam"
              className={styles.fieldInput}
            />
          </FormField>
          <FormField label="Doel">
            <input
              type="text"
              value={values.doel}
              onChange={e => setValue('doel', e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Klantbezoek Joosten"
              className={styles.fieldInput}
            />
          </FormField>
          <FormField label="Parkeerkosten (€)">
            <input
              type="number"
              step="0.01"
              min="0"
              value={values.parkeerkosten}
              onChange={e => setValue('parkeerkosten', e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="0,00"
              className={styles.fieldInput}
            />
          </FormField>
        </div>

        <div className={styles.formActions}>
          <span className={styles.formHint}>
            * Datum + Van verplicht. Ctrl/⌘+Enter om te versturen.
          </span>
          <div className={styles.formActionsRight}>
            {submitState === 'ok' && <span className={`s-success ${styles.formStatus}`}>✓ opgeslagen</span>}
            {submitState === 'error' && (
              <span className={`s-error ${styles.formStatus}`} title={submitError}>✗ {submitError}</span>
            )}
            <button
              type="button"
              className="btn btn--accent"
              onClick={submit}
              disabled={submitState === 'submitting'}
            >
              {submitState === 'submitting' ? 'Versturen…' : 'Rit toevoegen'}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

function FormField({ label, children }) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  )
}
