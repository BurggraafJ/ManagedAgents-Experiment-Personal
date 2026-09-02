import { useState } from 'react'
import { MSetHead } from './MobileSettingsBits'

// Terminologie op mobiel (v1.126): "fout → goed"-rijen i.p.v. de 4-koloms
// desktop-tabel. Tik op een rij → inline bewerken (zelfde velden + Pauzeer /
// Verwijder als desktop). Mutaties via useTerminology (upsert_terminology /
// delete_terminology RPC's). `term` komt van MobileSettings (één hook-instantie).
export default function MobileSettingsTerminologie({ term, onBack }) {
  const { rows, loading, save, toggle, remove } = term
  const [editingId, setEditingId] = useState(null)
  const [addingNew, setAddingNew] = useState(false)

  const startNew = () => { setAddingNew(true); setEditingId(null) }

  return (
    <div className="m-dash m-set">
      <MSetHead back={onBack} backLabel="Instellingen" title="Terminologie"
        sub="Wat spraak-naar-tekst verkeerd hoort → wat het moet worden. Agents vervangen deze termen vóór verwerking." />
      <div className="m-set__body">
        <div className="m-set__addrow">
          <button type="button" className="m-set__btn" onClick={startNew} disabled={addingNew}>+ Nieuwe correctie</button>
        </div>
        <div className="m-inset">
          {addingNew && (
            <TermEdit key="new" row={null} save={save} onDone={() => setAddingNew(false)} />
          )}
          {rows.length === 0 && !addingNew && (
            <div className="m-set__empty">{loading ? 'Laden…' : 'Nog geen correcties. Tik op “Nieuwe correctie” — bv. Tariq → Tarik.'}</div>
          )}
          {rows.map(row => (
            <div key={row.id} className="m-inset__static">
              <button
                type="button"
                className={`m-inset__row m-term__row ${row.is_active ? '' : 'is-inactive'}`}
                onClick={() => { setEditingId(editingId === row.id ? null : row.id); setAddingNew(false) }}
                aria-expanded={editingId === row.id}
              >
                <span className="m-term__main">
                  <span className="m-term__pair">
                    <span className="m-term__wrong">{row.incorrect}</span>
                    <span className="m-term__arrow">→</span>
                    <span className="m-term__right">{row.correct}</span>
                  </span>
                  {(row.category || row.notes || !row.is_active) && (
                    <span className="m-term__sub">
                      {row.category && <em>{row.category}</em>}
                      {!row.is_active && 'gepauzeerd · '}
                      {row.notes}
                    </span>
                  )}
                </span>
              </button>
              {editingId === row.id && (
                <TermEdit row={row} save={save} toggle={toggle} remove={remove} onDone={() => setEditingId(null)} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function TermEdit({ row, save, toggle, remove, onDone }) {
  const [f, setF] = useState({
    incorrect: row?.incorrect || '', correct: row?.correct || '',
    category: row?.category || '', notes: row?.notes || '',
    case_sensitive: !!row?.case_sensitive,
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setF(prev => ({ ...prev, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const valid = f.incorrect.trim() && f.correct.trim()

  async function run(fn) {
    setBusy(true); setErr(null)
    const e = await fn()
    setBusy(false)
    if (e) setErr(e); else onDone()
  }
  const onSave = () => run(() => save({ ...row, ...f, id: row?.id || null, is_active: row?.is_active ?? true }))
  const onDelete = () => {
    if (!window.confirm(`Verwijder "${row.incorrect} → ${row.correct}"?`)) return
    run(() => remove(row.id))
  }

  return (
    <div className="m-term__edit">
      <label className="m-term__field"><span>Verkeerd</span>
        <input className="m-term__input" value={f.incorrect} onChange={set('incorrect')} placeholder="Tariq" disabled={busy} autoFocus={!row} /></label>
      <label className="m-term__field"><span>Correct</span>
        <input className="m-term__input" value={f.correct} onChange={set('correct')} placeholder="Tarik" disabled={busy} /></label>
      <label className="m-term__field"><span>Categorie</span>
        <input className="m-term__input" value={f.category} onChange={set('category')} placeholder="persoon / product …" disabled={busy} /></label>
      <label className="m-term__field"><span>Notitie</span>
        <input className="m-term__input" value={f.notes} onChange={set('notes')} placeholder="Waarom, context" disabled={busy} /></label>
      <label className="m-term__check">
        <input type="checkbox" checked={f.case_sensitive} onChange={set('case_sensitive')} disabled={busy} /> Hoofdlettergevoelig
      </label>
      <div className="m-set__actions">
        <button type="button" className="m-set__btn m-set__btn--primary" onClick={onSave} disabled={busy || !valid}>{busy ? '…' : 'Opslaan'}</button>
        <button type="button" className="m-set__btn" onClick={onDone} disabled={busy}>Annuleer</button>
        {row && toggle && (
          <button type="button" className="m-set__btn" onClick={() => run(() => toggle(row))} disabled={busy}>
            {row.is_active ? 'Pauzeer' : 'Activeer'}
          </button>
        )}
        {row && remove && (
          <button type="button" className="m-set__btn m-set__btn--danger" onClick={onDelete} disabled={busy}>Verwijder</button>
        )}
      </div>
      {err && <div className="m-set__errline">⚠ {err}</div>}
    </div>
  )
}
