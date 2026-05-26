import { useEffect, useState } from 'react'

/**
 * ChurnRow — één gechurnte klant in de tabel.
 * Klik op de rij = uitklappen (detail-paneel met summary + edit-velden).
 */
export default function ChurnRow({ churn, categories, isExpanded, onToggle, onSaveNote, onChangeCategory }) {
  const cat = churn.category
  const closedate = churn.closedate ? new Date(churn.closedate) : null
  const closedateLabel = closedate
    ? closedate.toLocaleDateString('nl-NL', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—'

  return (
    <>
      <tr className={isExpanded ? 'is-expanded' : ''} onClick={onToggle}>
        <td className="kl-col-date">{closedateLabel}</td>
        <td className="kl-col-company">
          <div>{churn.company_name || churn.dealname || '—'}</div>
          {churn.domain && <div className="kl-col-domain">{churn.domain}</div>}
        </td>
        <td className="kl-col-category">
          {cat ? (
            <span className="kl-category-badge" style={{ '--cat-color': cat.color }}>
              <span className="kl-pill__dot" />
              {cat.label}
            </span>
          ) : (
            <span className="kl-category-badge kl-category-badge--unknown">Nog niet bepaald</span>
          )}
        </td>
        <td className="kl-col-new-provider">
          {churn.new_provider
            ? <span className="kl-new-provider">{churn.new_provider}</span>
            : <span className="kl-new-provider kl-new-provider--empty">—</span>}
        </td>
        <td className="kl-col-summary">
          <div className="kl-summary-preview">
            {churn.churn_summary || (churn.last_summarized_at
              ? <em>Geen reden gevonden in notes/mails.</em>
              : <em style={{ color: 'var(--muted)' }}>Nog niet samengevat — wacht op volgende run.</em>)}
          </div>
        </td>
        <td className="kl-col-actions">{isExpanded ? '▴' : '▾'}</td>
      </tr>
      {isExpanded && (
        <tr className="kl-detail-row">
          <td colSpan={6}>
            <ChurnDetail
              churn={churn}
              categories={categories}
              onSaveNote={onSaveNote}
              onChangeCategory={onChangeCategory}
            />
          </td>
        </tr>
      )}
    </>
  )
}

function ChurnDetail({ churn, categories, onSaveNote, onChangeCategory }) {
  const [note, setNote] = useState(churn.user_note || '')
  const [savedAt, setSavedAt] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { setNote(churn.user_note || '') }, [churn.user_note])

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSaveNote(churn.deal_id, note)
      setSavedAt(new Date())
    } catch (err) {
      alert('Opslaan mislukt: ' + (err.message || String(err)))
    } finally {
      setSaving(false)
    }
  }

  const lastSum = churn.last_summarized_at ? new Date(churn.last_summarized_at) : null

  return (
    <div className="kl-detail" onClick={(e) => e.stopPropagation()}>
      <div className="kl-detail__block">
        <div className="kl-detail__label">AI-samenvatting</div>
        <div className="kl-detail__summary">
          {churn.churn_summary || <em>Nog niet gegenereerd — wacht tot de volgende run om 07:00.</em>}
        </div>
        <div className="kl-detail__meta">
          {lastSum && <span>Laatst samengevat: <b>{lastSum.toLocaleDateString('nl-NL')}</b></span>}
          <span>Notes: <b>{churn.source_notes_count ?? 0}</b></span>
          <span>Mails: <b>{churn.source_mails_count ?? 0}</b></span>
          {churn.category_confidence != null && (
            <span>Confidence: <b>{(churn.category_confidence * 100).toFixed(0)}%</b></span>
          )}
          {churn.new_provider && (
            <span>Overgestapt naar: <b>{churn.new_provider}</b></span>
          )}
        </div>
        <div className="kl-category-select" style={{ marginTop: 4 }}>
          <span className="kl-detail__label" style={{ marginRight: 4 }}>Categorie:</span>
          <select
            value={churn.category_id || ''}
            onChange={(e) => onChangeCategory(churn.deal_id, e.target.value || null)}
          >
            <option value="">— Geen —</option>
            {categories.map(c => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="kl-detail__block">
        <div className="kl-detail__label">Mijn aantekening</div>
        <textarea
          className="kl-note-textarea"
          placeholder="Eigen notitie over deze klant — bv. specifieke aanleiding, follow-up idee, of correctie op de AI-samenvatting…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn--accent"
            onClick={handleSave}
            disabled={saving || note === (churn.user_note || '')}
          >
            {saving ? 'Opslaan…' : 'Opslaan'}
          </button>
          {savedAt && <span className="kl-note-saved">✓ Opgeslagen om {savedAt.toLocaleTimeString('nl-NL')}</span>}
          {churn.user_note_updated_at && !savedAt && (
            <span style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>
              Laatste wijziging: {new Date(churn.user_note_updated_at).toLocaleDateString('nl-NL')}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
