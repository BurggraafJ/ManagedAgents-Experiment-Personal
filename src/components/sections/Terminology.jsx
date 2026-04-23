import { useState, useMemo } from 'react'
import { supabase } from '../../lib/supabase'

// Terminologie-correcties — Jelle gebruikt spraak-naar-tekst die soms termen
// verkeerd overneemt (Tariq → Tarik, Andre AI → Andri AI). Agents die Jelle's
// vrije tekst verwerken (sales-on-road Slack-input, hubspot-daily-sync
// amendments, chat-berichten) lezen deze tabel en vervangen de typos vóór
// inhoudelijke verwerking. Beheer hier direct zonder code-push.
export default function Terminology({ rows }) {
  const list = useMemo(
    () => (rows || []).slice().sort((a, b) => a.incorrect.localeCompare(b.incorrect)),
    [rows],
  )

  const [editingId, setEditingId] = useState(null)
  const [addingNew, setAddingNew] = useState(false)

  return (
    <section id="terminology">
      <div className="section__head">
        <h2 className="section__title">
          Terminologie-correcties <span className="section__count">{list.length}</span>
        </h2>
        <button
          type="button"
          className="btn btn--accent"
          style={{ fontSize: 12, padding: '6px 12px' }}
          onClick={() => { setAddingNew(true); setEditingId(null) }}
        >
          + Nieuwe correctie
        </button>
      </div>
      <div className="section__hint" style={{ marginBottom: 10 }}>
        Wat spraak-naar-tekst verkeerd hoort → wat het moet worden. Agents die jouw vrije tekst verwerken (sales-on-road Slack, amendments, chat) vervangen deze termen vóór inhoudelijke verwerking.
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="terminology-table">
          <div className="terminology-table__head">
            <div>Verkeerd</div>
            <div>→ Correct</div>
            <div>Categorie</div>
            <div>Notitie</div>
            <div style={{ textAlign: 'right' }}>Acties</div>
          </div>
          {addingNew && (
            <TerminologyRow
              key="new"
              row={null}
              onDone={() => setAddingNew(false)}
              onCancel={() => setAddingNew(false)}
            />
          )}
          {list.length === 0 && !addingNew && (
            <div className="empty empty--compact" style={{ padding: 16 }}>
              Nog geen correcties. Klik "+ Nieuwe correctie" om er één toe te voegen — bv. <span className="mono">Tariq → Tarik</span>.
            </div>
          )}
          {list.map(row => (
            editingId === row.id ? (
              <TerminologyRow
                key={row.id}
                row={row}
                onDone={() => setEditingId(null)}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <TerminologyRowReadOnly
                key={row.id}
                row={row}
                onEdit={() => { setEditingId(row.id); setAddingNew(false) }}
              />
            )
          ))}
        </div>
      </div>
    </section>
  )
}

function TerminologyRowReadOnly({ row, onEdit }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function onDelete() {
    if (!window.confirm(`Verwijder "${row.incorrect} → ${row.correct}"?`)) return
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc('delete_terminology', { p_id: row.id })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
    } catch (e) {
      setErr(e.message || 'netwerkfout')
    }
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
    } catch (e) {
      setErr(e.message || 'netwerkfout')
    }
    setBusy(false)
  }

  const inactive = !row.is_active

  return (
    <div className={`terminology-table__row ${inactive ? 'is-inactive' : ''}`}>
      <div className="mono">{row.incorrect}</div>
      <div className="mono" style={{ fontWeight: 600 }}>{row.correct}</div>
      <div className="muted">{row.category || '—'}</div>
      <div className="muted" style={{ fontSize: 12, lineHeight: 1.4 }}>{row.notes || '—'}</div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn--ghost" style={btnStyle} onClick={onToggle} disabled={busy}
          title={inactive ? 'Activeren — agent past deze vervanging weer toe' : 'Pauzeren — agent negeert deze vervanging'}>
          {inactive ? '▶ activeer' : '⏸ pauzeer'}
        </button>
        <button type="button" className="btn btn--ghost" style={btnStyle} onClick={onEdit} disabled={busy}>✎ bewerk</button>
        <button type="button" className="btn btn--ghost" style={{ ...btnStyle, color: 'var(--error)' }} onClick={onDelete} disabled={busy}>🗑 verwijder</button>
      </div>
      {err && <div className="terminology-table__error">⚠ {err}</div>}
    </div>
  )
}

function TerminologyRow({ row, onDone, onCancel }) {
  const [incorrect, setIncorrect] = useState(row?.incorrect || '')
  const [correct, setCorrect]     = useState(row?.correct || '')
  const [category, setCategory]   = useState(row?.category || '')
  const [notes, setNotes]         = useState(row?.notes || '')
  const [caseSensitive, setCaseSensitive] = useState(row?.case_sensitive || false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function onSave() {
    if (!incorrect.trim() || !correct.trim()) {
      setErr('Beide velden verplicht'); return
    }
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
    } catch (e) {
      setErr(e.message || 'netwerkfout')
    }
    setBusy(false)
  }

  return (
    <div className="terminology-table__row terminology-table__row--editing">
      <input type="text" value={incorrect} onChange={e => setIncorrect(e.target.value)}
        placeholder="Tariq" style={inputStyle} disabled={busy} autoFocus />
      <input type="text" value={correct} onChange={e => setCorrect(e.target.value)}
        placeholder="Tarik" style={inputStyle} disabled={busy} />
      <input type="text" value={category} onChange={e => setCategory(e.target.value)}
        placeholder="persoon / product / ..." style={inputStyle} disabled={busy} />
      <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
        placeholder="Waarom, wanneer, context" style={inputStyle} disabled={busy} />
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap', alignItems: 'center' }}>
        <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}
          title="Als aan: match exact op hoofdlettergebruik. Default: case-insensitive (meestal gewenst).">
          <input type="checkbox" checked={caseSensitive} onChange={e => setCaseSensitive(e.target.checked)} disabled={busy} />
          Aa
        </label>
        <button type="button" className="btn btn--accent" style={btnStyle} onClick={onSave} disabled={busy || !incorrect.trim() || !correct.trim()}>
          {busy ? '…' : '💾 opslaan'}
        </button>
        <button type="button" className="btn btn--ghost" style={btnStyle} onClick={onCancel} disabled={busy}>annuleer</button>
      </div>
      {err && <div className="terminology-table__error">⚠ {err}</div>}
    </div>
  )
}

const btnStyle = { fontSize: 11, padding: '4px 8px' }
const inputStyle = {
  padding: '6px 8px',
  border: '1px solid var(--border)',
  borderRadius: 4,
  background: 'var(--bg)',
  color: 'var(--text)',
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
}
