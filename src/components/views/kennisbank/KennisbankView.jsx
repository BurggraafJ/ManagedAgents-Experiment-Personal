import { useMemo, useState } from 'react'
import { useKennisbank } from '../../../hooks/useKennisbank'
import KbProposalCard from './KbProposalCard'
import './kennisbank.css'

/**
 * KennisbankView — review-queue voor artikel-voorstellen (Project Kennisbank F.3).
 * Toont openstaande kb_article_proposals; per voorstel: goedkeuren / aanpassen / afwijzen.
 * Pas bij goedkeuren landt er een artikel in de kennisbank.
 */
export default function KennisbankView() {
  const { proposals, categories, loading, error, refresh } = useKennisbank()
  const [activeCat, setActiveCat] = useState('all')

  const catLabel = useMemo(() => {
    const m = {}
    for (const c of categories) m[c.id] = c.label
    return m
  }, [categories])

  const counts = useMemo(() => {
    const m = {}
    for (const p of proposals) m[p.kb_category] = (m[p.kb_category] || 0) + 1
    return m
  }, [proposals])

  if (loading) return <div className="knb-app"><p className="knb-state">Voorstellen laden…</p></div>
  if (error) return <div className="knb-app"><p className="knb-state knb-state--err">Kon voorstellen niet laden: {error}</p></div>

  const visible = activeCat === 'all' ? proposals : proposals.filter(p => p.kb_category === activeCat)

  return (
    <div className="knb-app">
      <div className="knb-intro">
        <p>
          Artikel-voorstellen gedestilleerd uit je mailhistorie. Keur goed, laat aanpassen, of wijs af —
          pas bij <strong>goedkeuren</strong> komt een artikel in de kennisbank.
        </p>
      </div>

      <div className="knb-filters">
        <button className={`knb-tab ${activeCat === 'all' ? 'is-active' : ''}`} onClick={() => setActiveCat('all')}>
          Alle <span className="knb-tab__n">{proposals.length}</span>
        </button>
        {categories.filter(c => counts[c.id]).map(c => (
          <button key={c.id} className={`knb-tab ${activeCat === c.id ? 'is-active' : ''}`} onClick={() => setActiveCat(c.id)}>
            {c.label} <span className="knb-tab__n">{counts[c.id]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="knb-empty">
          <div className="knb-empty__icon" aria-hidden>📚</div>
          <h3>Geen openstaande voorstellen</h3>
          <p>Nieuwe voorstellen verschijnen hier zodra de kennisbank-curator ze aanmaakt.</p>
        </div>
      ) : (
        <div className="knb-list">
          {visible.map(p => (
            <KbProposalCard key={p.id} proposal={p} categoryLabel={catLabel[p.kb_category]} onDone={refresh} />
          ))}
        </div>
      )}
    </div>
  )
}
