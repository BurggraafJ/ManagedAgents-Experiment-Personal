import { useState, useMemo } from 'react'
import { supabase } from '../../../../lib/supabase'
import { useSupabaseQuery } from '../../../../hooks/useSupabaseQuery'
import { SettingsPage } from '../SettingsLayout'

/**
 * TerminologiePage (v2) — spraak-naar-tekst correctie-tabel.
 *
 * Vervangt Terminology-component uit v1. Eigen styling (.sv2-table) zonder
 * inline-styles. Inline-edit + nieuwe rij.
 */
export default function TerminologiePage() {
  const { data: rows } = useSupabaseQuery('terminology_corrections', {
    orderBy: ['incorrect', { ascending: true }],
    realtime: true,
  })

  const list = useMemo(
    () => (rows || []).slice().sort((a, b) => a.incorrect.localeCompare(b.incorrect)),
    [rows],
  )

  const [editingId, setEditingId] = useState(null)
  const [addingNew, setAddingNew] = useState(false)

  return (
    <SettingsPage
      title="Terminologie"
      intro="Wat spraak-naar-tekst verkeerd hoort → wat het moet worden. Agents vervangen deze termen vóór inhoudelijke verwerking."
      right={
        <button
          type="button"
          className="sv2-btn sv2-btn--primary"
          onClick={() => { setAddingNew(true); setEditingId(null) }}
        >
          + Nieuwe correctie
        </button>
      }
    >
      {list.length === 0 && !addingNew ? (
        <div className="sv2-stub">
          <div className="sv2-stub__title">Nog geen correcties</div>
          <div className="sv2-stub__hint">
            Klik <strong>+ Nieuwe correctie</strong> om er één toe te voegen — bv. <code>Tariq → Tarik</code>.
          </div>
        </div>
      ) : (
        <div className="sv2-panel">
          <table className="sv2-table">
            <thead>
              <tr>
                <th>Verkeerd</th>
                <th>→ Correct</th>
                <th>Categorie</th>
                <th>Notitie</th>
                <th className="is-right">Acties</th>
              </tr>
            </thead>
            <tbody>
              {addingNew && (
                <EditRow
                  key="new"
                  row={null}
                  onDone={() => setAddingNew(false)}
                  onCancel={() => setAddingNew(false)}
                />
              )}
              {list.map(row =>
                editingId === row.id ? (
                  <EditRow
                    key={row.id}
                    row={row}
                    onDone={() => setEditingId(null)}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <ViewRow
                    key={row.id}
                    row={row}
                    onEdit={() => { setEditingId(row.id); setAddingNew(false) }}
                  />
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </SettingsPage>
  )
}

function ViewRow({ row, onEdit }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const inactive = !row.is_active

  async function onDelete() {
    if (!window.confirm(`Verwijder "${row.incorrect} → ${row.correct}"?`)) return
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc('delete_terminology', { p_id: row.id })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
    } catch (e) { setErr(e.message || 'netwerkfout') }
    setBusy(false)
  }

  async function onToggle() {
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc('upsert_terminology', {
        p_id: row.id,
        p_incorrect: row.incorrect,
        p_correct: row.correct,
        p_category: row.category,
        p_notes: row.notes,
        p_case_sensitive: row.case_sensitive,
        p_is_active: !row.is_active,
        p_updated_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
    } catch (e) { setErr(e.message || 'netwerkfout') }
    setBusy(false)
  }

  return (
    <tr style={{ opacity: inactive ? 0.55 : 1 }}>
      <td><span className="sv2-cell-mono">{row.incorrect}</span></td>
      <td><span className="sv2-cell-mono" style={{ fontWeight: 600, color: 'var(--sv-ink)' }}>{row.correct}</span></td>
      <td>{row.category ? <span className="sv2-pill sv2-pill--info">{row.category}</span> : <span style={{ color: 'var(--sv-n-400)' }}>—</span>}</td>
      <td style={{ fontSize: 12.5, color: 'var(--sv-n-500)' }}>{row.notes || '—'}</td>
      <td className="is-right">
        <div className="sv2-row-actions">
          <button className="sv2-btn sv2-btn--ghost sv2-btn--sm" onClick={onToggle} disabled={busy}>
            {inactive ? '▶ Activeer' : '⏸ Pauzeer'}
          </button>
          <button className="sv2-btn sv2-btn--ghost sv2-btn--sm" onClick={onEdit} disabled={busy}>Bewerk</button>
          <button className="sv2-btn sv2-btn--danger sv2-btn--sm" onClick={onDelete} disabled={busy}>✕</button>
        </div>
        {err && <div style={{ fontSize: 11, color: 'var(--sv-error)', marginTop: 4 }}>⚠ {err}</div>}
      </td>
    </tr>
  )
}

function EditRow({ row, onDone, onCancel }) {
  const [incorrect, setIncorrect] = useState(row?.incorrect || '')
  const [correct, setCorrect]     = useState(row?.correct   || '')
  const [category, setCategory]   = useState(row?.category  || '')
  const [notes, setNotes]         = useState(row?.notes     || '')
  const [caseSensitive, setCaseSensitive] = useState(row?.case_sensitive || false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function onSave() {
    if (!incorrect.trim() || !correct.trim()) { setErr('Beide velden verplicht'); return }
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc('upsert_terminology', {
        p_id: row?.id || null,
        p_incorrect: incorrect.trim(),
        p_correct: correct.trim(),
        p_category: category.trim() || null,
        p_notes: notes.trim() || null,
        p_case_sensitive: caseSensitive,
        p_is_active: row?.is_active ?? true,
        p_updated_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
      else onDone()
    } catch (e) { setErr(e.message || 'netwerkfout') }
    setBusy(false)
  }

  return (
    <tr style={{ background: 'var(--sv-paper-2)' }}>
      <td><input className="sv2-input" value={incorrect} onChange={e => setIncorrect(e.target.value)} placeholder="Tariq" disabled={busy} autoFocus /></td>
      <td><input className="sv2-input" value={correct} onChange={e => setCorrect(e.target.value)} placeholder="Tarik" disabled={busy} /></td>
      <td><input className="sv2-input" value={category} onChange={e => setCategory(e.target.value)} placeholder="persoon / product …" disabled={busy} /></td>
      <td><input className="sv2-input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Waarom, context" disabled={busy} /></td>
      <td className="is-right">
        <div className="sv2-row-actions" style={{ alignItems: 'center' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--sv-n-500)' }} title="Hoofdlettergevoelig">
            <input type="checkbox" checked={caseSensitive} onChange={e => setCaseSensitive(e.target.checked)} disabled={busy} />
            Aa
          </label>
          <button className="sv2-btn sv2-btn--primary sv2-btn--sm" onClick={onSave} disabled={busy || !incorrect.trim() || !correct.trim()}>
            {busy ? '…' : 'Opslaan'}
          </button>
          <button className="sv2-btn sv2-btn--ghost sv2-btn--sm" onClick={onCancel} disabled={busy}>Annuleer</button>
        </div>
        {err && <div style={{ fontSize: 11, color: 'var(--sv-error)', marginTop: 4 }}>⚠ {err}</div>}
      </td>
    </tr>
  )
}
