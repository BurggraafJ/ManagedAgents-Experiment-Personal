import { useMemo, useState } from 'react'
import { useChurnData } from '../../../hooks/useChurnData'
import ChurnRow from './ChurnRow'
import CategoryManagerModal from './CategoryManagerModal'
import './klantverlies.css'

/**
 * KlantverliesView — overzicht gechurnte klanten met AI-samenvatting + Jelle's eigen notitie.
 * Filter op categorie, instellingen-popup voor categorie-beheer, knop "Nu draaien" voor manual trigger.
 */
export default function KlantverliesView() {
  const {
    churns, categories, allCategories, loading, error,
    updateNote, updateCategory, upsertCategory, deleteCategory, triggerRun,
  } = useChurnData()

  const [activeFilters, setActiveFilters] = useState(() => new Set()) // empty = alles tonen
  const [expandedId, setExpandedId] = useState(null)
  const [catModalOpen, setCatModalOpen] = useState(false)
  const [triggering, setTriggering] = useState(false)
  const [triggerMsg, setTriggerMsg] = useState(null)

  // Per-categorie count voor de filter-pills
  const countsByCategory = useMemo(() => {
    const map = new Map()
    for (const c of churns) {
      const id = c.category_id || '__none__'
      map.set(id, (map.get(id) || 0) + 1)
    }
    return map
  }, [churns])

  const filteredChurns = useMemo(() => {
    if (activeFilters.size === 0) return churns
    return churns.filter(c => {
      const id = c.category_id || '__none__'
      return activeFilters.has(id)
    })
  }, [churns, activeFilters])

  const toggleFilter = (id) => {
    setActiveFilters(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearFilters = () => setActiveFilters(new Set())

  const onTriggerRun = async () => {
    setTriggering(true)
    setTriggerMsg(null)
    try {
      await triggerRun()
      setTriggerMsg('Run aangevraagd — orchestrator pikt op binnen 15 min.')
      setTimeout(() => setTriggerMsg(null), 6000)
    } catch (err) {
      setTriggerMsg('Mislukt: ' + (err.message || String(err)))
    } finally {
      setTriggering(false)
    }
  }

  if (loading) {
    return (
      <div className="kl-app">
        <div className="skeleton" style={{ height: 44 }} />
        <div className="skeleton" style={{ height: 320 }} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="kl-app">
        <div className="banner">Kan klantverlies-data niet laden: {error}</div>
      </div>
    )
  }

  const noneCount = countsByCategory.get('__none__') || 0

  return (
    <div className="kl-app">
      <div className="kl-toolbar">
        <div className="kl-filters">
          <button
            type="button"
            className={`kl-pill ${activeFilters.size === 0 ? 'is-active' : ''}`}
            onClick={clearFilters}
          >
            Alle <span className="kl-pill__count">{churns.length}</span>
          </button>
          {categories.map(c => {
            const n = countsByCategory.get(c.id) || 0
            if (n === 0) return null
            const active = activeFilters.has(c.id)
            return (
              <button
                key={c.id}
                type="button"
                className={`kl-pill ${active ? 'is-active' : ''}`}
                style={{ '--cat-color': c.color, color: c.color }}
                onClick={() => toggleFilter(c.id)}
              >
                <span className="kl-pill__dot" />
                <span style={{ color: 'var(--text)' }}>{c.label}</span>
                <span className="kl-pill__count">{n}</span>
              </button>
            )
          })}
          {noneCount > 0 && (
            <button
              type="button"
              className={`kl-pill ${activeFilters.has('__none__') ? 'is-active' : ''}`}
              onClick={() => toggleFilter('__none__')}
            >
              Nog niet bepaald <span className="kl-pill__count">{noneCount}</span>
            </button>
          )}
        </div>

        <div className="kl-toolbar__spacer" />

        <span className="kl-toolbar__count">{filteredChurns.length} van {churns.length}</span>
        <button type="button" className="btn" onClick={() => setCatModalOpen(true)}>
          Categorieën beheren
        </button>
        <button type="button" className="btn btn--accent" onClick={onTriggerRun} disabled={triggering}>
          {triggering ? 'Aangevraagd…' : 'Nu draaien'}
        </button>
      </div>

      {triggerMsg && (
        <div className="banner" style={{ background: 'var(--accent-soft, rgba(59,130,246,0.1))', color: 'var(--text)' }}>
          {triggerMsg}
        </div>
      )}

      {filteredChurns.length === 0 ? (
        <div className="kl-empty">
          <div className="kl-empty__title">
            {churns.length === 0
              ? 'Nog geen gechurnte klanten geregistreerd'
              : 'Geen klanten in deze filter-selectie'}
          </div>
          <div>
            {churns.length === 0
              ? 'De churn-analytics agent draait dagelijks om 07:00 en vult deze tabel zodra deals in de stage "Afgesloten - Beëindigd na gebruik" komen.'
              : 'Pas het filter aan of klik op "Alle" om alles te zien.'}
          </div>
        </div>
      ) : (
        <table className="kl-table">
          <thead>
            <tr>
              <th>Churn-datum</th>
              <th>Klant</th>
              <th>Categorie</th>
              <th>Samenvatting</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filteredChurns.map(c => (
              <ChurnRow
                key={c.deal_id}
                churn={c}
                categories={categories}
                isExpanded={expandedId === c.deal_id}
                onToggle={() => setExpandedId(expandedId === c.deal_id ? null : c.deal_id)}
                onSaveNote={updateNote}
                onChangeCategory={updateCategory}
              />
            ))}
          </tbody>
        </table>
      )}

      <CategoryManagerModal
        open={catModalOpen}
        onClose={() => setCatModalOpen(false)}
        allCategories={allCategories}
        onUpsert={upsertCategory}
        onDelete={deleteCategory}
      />
    </div>
  )
}
