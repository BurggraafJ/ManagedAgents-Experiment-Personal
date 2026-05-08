import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useFormState } from '../../../hooks/useFormState'
import { SEGMENT_LABEL, splitList } from '../../../lib/linkedin'
import styles from './LinkedInView.module.css'

/**
 * LinkedInStrategyPanel — bekijk + bewerk linkedin_strategy (single row, id=1).
 * Form via useFormState (Refactor 04). Save via upsert + onSaved callback om
 * de container te laten refetchen.
 */
export default function LinkedInStrategyPanel({ strategy, onSaved }) {
  const [editing, setEditing] = useState(false)

  return (
    <section>
      <div className="section__head">
        <h2 className="section__title">Strategie</h2>
        <span className="section__hint">leidend voor wie de agent kiest</span>
      </div>
      {!editing ? (
        <ReadOnly strategy={strategy} onEdit={() => setEditing(true)} />
      ) : (
        <EditForm
          strategy={strategy}
          onSave={() => { setEditing(false); onSaved?.() }}
          onCancel={() => setEditing(false)}
        />
      )}
    </section>
  )
}

function ReadOnly({ strategy, onEdit }) {
  return (
    <div className="card">
      <dl className={`kv ${styles.dl}`}>
        <dt className="muted">Dagquota</dt>
        <dd>{strategy?.daily_quota ?? 15} invites/dag</dd>
        <dt className="muted">Segment-prioriteit</dt>
        <dd>{renderList(strategy?.segment_priority, SEGMENT_LABEL)}</dd>
        <dt className="muted">Concurrenten</dt>
        <dd>{renderList(strategy?.competitors)}</dd>
        <dt className="muted">Thought leaders</dt>
        <dd>{renderList(strategy?.thought_leaders)}</dd>
        <dt className="muted">Keywords</dt>
        <dd>{renderList(strategy?.keywords)}</dd>
        <dt className="muted">Tactiek-notities</dt>
        <dd style={{ whiteSpace: 'pre-wrap' }}>
          {strategy?.tactic_notes || <span className="muted">—</span>}
        </dd>
        <dt className="muted">Pause</dt>
        <dd>{strategy?.pause_until ? `tot ${strategy.pause_until}` : <span className="muted">actief</span>}</dd>
      </dl>
      <div style={{ marginTop: 12 }}>
        <button className="btn" onClick={onEdit}>Bewerken</button>
      </div>
    </div>
  )
}

function EditForm({ strategy, onSave, onCancel }) {
  const { values, setValue } = useFormState({
    daily_quota:      strategy?.daily_quota ?? 15,
    segment_priority: (strategy?.segment_priority || []).join(', '),
    competitors:      (strategy?.competitors || []).join(', '),
    thought_leaders:  (strategy?.thought_leaders || []).join(', '),
    keywords:         (strategy?.keywords || []).join(', '),
    tactic_notes:     strategy?.tactic_notes || '',
    pause_until:      strategy?.pause_until || '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  async function save() {
    setSaving(true); setErr(null)
    const payload = {
      id: 1,
      daily_quota:      Number(values.daily_quota) || 15,
      segment_priority: splitList(values.segment_priority),
      competitors:      splitList(values.competitors),
      thought_leaders:  splitList(values.thought_leaders),
      keywords:         splitList(values.keywords),
      tactic_notes:     values.tactic_notes || null,
      pause_until:      values.pause_until || null,
      updated_at:       new Date().toISOString(),
      updated_by:       'dashboard',
    }
    const { error } = await supabase.from('linkedin_strategy').upsert(payload, { onConflict: 'id' })
    setSaving(false)
    if (error) setErr(error.message)
    else onSave()
  }

  return (
    <div className="card stack stack--sm">
      <Field label="Dagquota">
        <input
          className="input"
          type="number"
          value={values.daily_quota}
          onChange={e => setValue('daily_quota', e.target.value)}
        />
      </Field>
      <Field label="Segment-prioriteit (comma-separated, volgorde = prio)">
        <input
          className="input"
          value={values.segment_priority}
          onChange={e => setValue('segment_priority', e.target.value)}
          placeholder="mailbox, hubspot_new, advocatenkantoor_proefperiode, competitors, thought_leaders"
        />
      </Field>
      <Field label="Concurrenten (kantoor- of persoonsnamen)">
        <input
          className="input"
          value={values.competitors}
          onChange={e => setValue('competitors', e.target.value)}
          placeholder="bv. Juristica, Advocaat.nl, ..."
        />
      </Field>
      <Field label="Thought leaders (namen of LinkedIn URLs)">
        <input
          className="input"
          value={values.thought_leaders}
          onChange={e => setValue('thought_leaders', e.target.value)}
        />
      </Field>
      <Field label="Keywords voor people-search">
        <input
          className="input"
          value={values.keywords}
          onChange={e => setValue('keywords', e.target.value)}
          placeholder="bv. legal tech, kantoormanager, compliance"
        />
      </Field>
      <Field label="Tactiek-notities (vrije tekst die de agent meeleest)">
        <textarea
          className="input"
          rows={4}
          value={values.tactic_notes}
          onChange={e => setValue('tactic_notes', e.target.value)}
          placeholder="bv. 'Prioriteer partners boven associates. Sla recruiters over. Bij proefperiode-kantoren eerst managing partner dan rest.'"
        />
      </Field>
      <Field label="Pause tot (yyyy-mm-dd, leeg = actief)">
        <input
          className="input"
          type="date"
          value={values.pause_until || ''}
          onChange={e => setValue('pause_until', e.target.value)}
        />
      </Field>
      {err && <div className="s-error" style={{ fontSize: 12 }}>{err}</div>}
      <div className={styles.editActions}>
        <button className="btn btn--accent" disabled={saving} onClick={save}>
          {saving ? 'Opslaan…' : 'Opslaan'}
        </button>
        <button className="btn" disabled={saving} onClick={onCancel}>Annuleer</button>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className={styles.fieldStack}>
      <div className={styles.fieldLabel}>{label}</div>
      {children}
    </label>
  )
}

function renderList(arr, labelMap) {
  if (!arr || arr.length === 0) return <span className="muted">—</span>
  return arr.map((v, i) => (
    <span key={i} className="pill" style={{ marginRight: 6 }}>{labelMap?.[v] || v}</span>
  ))
}
