import { useEffect, useState } from 'react'
import Modal from '../../ui/Modal'

const DEFAULT_COLORS = [
  '#dc2626', '#ea580c', '#d97706', '#ca8a04',
  '#65a30d', '#16a34a', '#0891b2', '#2563eb',
  '#6366f1', '#7c3aed', '#a855f7', '#db2777',
  '#6b7280',
]

const INSTRUCTIONS_PLACEHOLDER = `Bv:
- Schrijf in directe, zakelijke taal — geen marketing-spin.
- Noem altijd of het over inhoudelijk werk of over prijs ging.
- Als ze de tabel-functie misten, vermeld dat letterlijk.
- Kort en feitelijk; ik lees deze samenvattingen op een drukke ochtend.`

/**
 * CategoryManagerModal — instellingen voor /klantverlies.
 * Twee secties: AI-samenvatting stijl (custom_instructions) + Categorieën-beheer.
 */
export default function CategoryManagerModal({
  open, onClose, allCategories, onUpsert, onDelete,
  summaryInstructions, onSaveSummaryInstructions,
}) {
  const [pendingDeleteId, setPendingDeleteId] = useState(null)
  const [instructions, setInstructions] = useState(summaryInstructions || '')
  const [savingInstr, setSavingInstr] = useState(false)
  const [savedInstr, setSavedInstr] = useState(false)

  useEffect(() => { setInstructions(summaryInstructions || '') }, [summaryInstructions, open])

  const instructionsDirty = instructions !== (summaryInstructions || '')

  const handleSaveInstructions = async () => {
    setSavingInstr(true)
    setSavedInstr(false)
    try {
      await onSaveSummaryInstructions(instructions)
      setSavedInstr(true)
      setTimeout(() => setSavedInstr(false), 3000)
    } catch (err) {
      alert('Opslaan mislukt: ' + (err.message || String(err)))
    } finally {
      setSavingInstr(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Klantverlies — instellingen" size="lg">
      <div className="kl-cat-mgr">
        <section className="kl-settings-section">
          <h3 className="kl-settings-h3">AI-samenvatting stijl</h3>
          <p style={{ color: 'var(--muted)', fontSize: '0.88rem', margin: '4px 0 8px' }}>
            Extra instructies die de skill bij elke nieuwe samenvatting meekrijgt. Houd het kort en
            scherp — deze tekst wordt direct aan de system-prompt geplakt. Werkt vanaf de eerstvolgende
            samenvattings-run (handmatig of 07:00).
          </p>
          <textarea
            className="kl-note-textarea"
            style={{ minHeight: 140 }}
            placeholder={INSTRUCTIONS_PLACEHOLDER}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
            <button
              type="button"
              className="btn btn--accent"
              onClick={handleSaveInstructions}
              disabled={savingInstr || !instructionsDirty}
            >
              {savingInstr ? 'Opslaan…' : 'Opslaan'}
            </button>
            {savedInstr && <span className="kl-note-saved">✓ Opgeslagen</span>}
            {instructions.length > 0 && (
              <span style={{ color: 'var(--muted)', fontSize: '0.78rem', marginLeft: 'auto' }}>
                {instructions.length} tekens
              </span>
            )}
          </div>
        </section>

        <hr className="kl-settings-hr" />

        <section className="kl-settings-section">
          <h3 className="kl-settings-h3">Categorieën</h3>
          <p style={{ color: 'var(--muted)', fontSize: '0.88rem', margin: '4px 0 8px' }}>
            Beheer de categorieën die de AI gebruikt om churn-redenen te labelen. Systeem-categorieën
            kun je verbergen via het oogje (zet inactief), maar niet verwijderen — andere categorieën
            kun je vrij aanpassen of weggooien.
          </p>
        </section>

        <div className="kl-cat-mgr__list">
          {allCategories.map(c => (
            <CategoryRow
              key={c.id}
              category={c}
              onUpsert={onUpsert}
              onDelete={() => setPendingDeleteId(c.id)}
              onToggleActive={() => onUpsert({ ...c, is_active: !c.is_active })}
            />
          ))}
        </div>

        <NewCategoryRow onUpsert={onUpsert} existingKeys={allCategories.map(c => c.category_key)} />
      </div>

      <Modal.Footer>
        <button type="button" className="btn" onClick={onClose}>Sluiten</button>
      </Modal.Footer>

      <Modal
        open={pendingDeleteId != null}
        onClose={() => setPendingDeleteId(null)}
        title="Categorie verwijderen?"
        size="sm"
      >
        <p>
          Klanten die op deze categorie staan worden bij de volgende run automatisch
          opnieuw gecategoriseerd door de AI.
        </p>
        <Modal.Footer>
          <button className="btn" onClick={() => setPendingDeleteId(null)}>Annuleer</button>
          <button
            className="btn btn--accent"
            onClick={async () => {
              try {
                await onDelete(pendingDeleteId)
                setPendingDeleteId(null)
              } catch (err) {
                alert('Verwijderen mislukt: ' + (err.message || String(err)))
              }
            }}
          >
            Verwijderen
          </button>
        </Modal.Footer>
      </Modal>
    </Modal>
  )
}

function CategoryRow({ category, onUpsert, onDelete, onToggleActive }) {
  const [label, setLabel] = useState(category.label)
  const [sortOrder, setSortOrder] = useState(category.sort_order)
  const [color, setColor] = useState(category.color)
  const [colorPickerOpen, setColorPickerOpen] = useState(false)

  const isDirty =
    label !== category.label ||
    Number(sortOrder) !== category.sort_order ||
    color !== category.color

  const save = async () => {
    if (!isDirty) return
    try {
      await onUpsert({ ...category, label, sort_order: Number(sortOrder), color })
    } catch (err) {
      alert('Opslaan mislukt: ' + (err.message || String(err)))
    }
  }

  return (
    <div className={`kl-cat-row ${category.is_active ? '' : 'is-inactive'}`}>
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          className="kl-cat-row__color"
          style={{ background: color }}
          onClick={() => setColorPickerOpen(o => !o)}
          aria-label="Kleur kiezen"
        />
        {colorPickerOpen && (
          <div style={{
            position: 'absolute', top: 28, left: 0, zIndex: 10,
            background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: 6, padding: 6, display: 'grid',
            gridTemplateColumns: 'repeat(6, 22px)', gap: 4,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
          }}>
            {DEFAULT_COLORS.map(c => (
              <button
                key={c}
                type="button"
                style={{
                  width: 22, height: 22, borderRadius: 4, cursor: 'pointer',
                  background: c, border: c === color ? '2px solid var(--text)' : '1px solid var(--border)',
                }}
                onClick={() => { setColor(c); setColorPickerOpen(false) }}
                aria-label={c}
              />
            ))}
          </div>
        )}
      </div>
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
      />
      <input
        type="number"
        className="kl-cat-row__sort"
        value={sortOrder}
        onChange={(e) => setSortOrder(e.target.value)}
        onBlur={save}
        title="Sorteer-volgorde (lager = eerst)"
      />
      <button
        type="button"
        className="kl-cat-row__btn"
        onClick={onToggleActive}
        title={category.is_active ? 'Verberg deze categorie' : 'Toon deze categorie weer'}
      >
        {category.is_active ? '👁' : '🚫'}
      </button>
      <button
        type="button"
        className="kl-cat-row__btn kl-cat-row__btn--danger"
        onClick={onDelete}
        disabled={category.is_system}
        title={category.is_system ? 'Systeem-categorie kan niet verwijderd worden — verberg via oogje' : 'Verwijderen'}
      >
        {category.is_system ? <span className="kl-cat-row__system">sys</span> : '✕'}
      </button>
    </div>
  )
}

function slugify(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

function NewCategoryRow({ onUpsert, existingKeys }) {
  const [label, setLabel] = useState('')
  const [color, setColor] = useState('#6366f1')

  const add = async () => {
    const trimmed = label.trim()
    if (!trimmed) return
    let key = slugify(trimmed)
    let n = 2
    while (existingKeys.includes(key)) { key = `${slugify(trimmed)}_${n++}` }
    try {
      await onUpsert({ category_key: key, label: trimmed, color, sort_order: 100, is_active: true })
      setLabel('')
    } catch (err) {
      alert('Toevoegen mislukt: ' + (err.message || String(err)))
    }
  }

  return (
    <div className="kl-cat-add">
      <input
        type="text"
        placeholder="Nieuwe categorie toevoegen…"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') add() }}
        style={{
          flex: 1, padding: '8px 10px', borderRadius: 6,
          border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)'
        }}
      />
      <input
        type="color"
        value={color}
        onChange={(e) => setColor(e.target.value)}
        style={{ width: 36, height: 36, border: '1px solid var(--border)', borderRadius: 6, padding: 2, cursor: 'pointer' }}
      />
      <button type="button" className="btn btn--accent" onClick={add} disabled={!label.trim()}>
        Toevoegen
      </button>
    </div>
  )
}
