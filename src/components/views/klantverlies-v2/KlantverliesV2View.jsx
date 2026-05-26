import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChurnData } from '../../../hooks/useChurnData'
import CategoryManagerModal from '../klantverlies/CategoryManagerModal'
import KpiStrip from './KpiStrip'
import FilterBar from './FilterBar'
import ChurnCard from './ChurnCard'
import './klantverlies-v2.css'

const MONTHS = ['januari','februari','maart','april','mei','juni','juli','augustus','september','oktober','november','december']
function monthLabel(d) { return `${MONTHS[d.getMonth()]} ${d.getFullYear()}` }
function monthKey(d) { return `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}` }

/**
 * KlantverliesV2View — schaduw-view op /klantverlies-v2.
 * Design uit Klantverlies.html: paper-look shell, topbar met crumbs,
 * witte card met brede klant-kaarten gegroepeerd per maand.
 */
export default function KlantverliesV2View() {
  const navigate = useNavigate()
  const {
    churns, categories, allCategories, summaryInstructions, loading, error,
    upsertCategory, deleteCategory, triggerRun, saveSummaryInstructions,
  } = useChurnData()

  const [activeCategoryId, setActiveCategoryId] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [noNoteOnly, setNoNoteOnly] = useState(false)
  const [sortDesc, setSortDesc] = useState(true)
  const [catModalOpen, setCatModalOpen] = useState(false)
  const [triggering, setTriggering] = useState(false)
  const [triggerMsg, setTriggerMsg] = useState(null)

  const filteredChurns = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    let list = churns.filter(c => {
      if (activeCategoryId !== null && c.category_id !== activeCategoryId) return false
      if (noNoteOnly && c.user_note && c.user_note.trim()) return false
      if (q) {
        const h = `${c.company_name || ''} ${c.dealname || ''} ${c.domain || ''} ${c.new_provider || ''}`.toLowerCase()
        if (!h.includes(q)) return false
      }
      return true
    })
    list = [...list].sort((a, b) => {
      const ad = a.closedate ? new Date(a.closedate).getTime() : 0
      const bd = b.closedate ? new Date(b.closedate).getTime() : 0
      return sortDesc ? bd - ad : ad - bd
    })
    return list
  }, [churns, activeCategoryId, searchQuery, noNoteOnly, sortDesc])

  const noNoteCount = useMemo(
    () => churns.filter(c => !(c.user_note && c.user_note.trim())).length,
    [churns]
  )

  const monthGroups = useMemo(() => {
    const groups = new Map()
    filteredChurns.forEach(c => {
      if (!c.closedate) return
      const d = new Date(c.closedate)
      const k = monthKey(d)
      if (!groups.has(k)) groups.set(k, { label: monthLabel(d), items: [], mrr: 0 })
      const g = groups.get(k)
      g.items.push(c)
      g.mrr += Number(c.mrr) || 0
    })
    const undated = filteredChurns.filter(c => !c.closedate)
    if (undated.length) groups.set('zzz_undated', { label: 'Zonder datum', items: undated, mrr: 0 })
    return Array.from(groups.values())
  }, [filteredChurns])

  const onTriggerRun = async () => {
    setTriggering(true); setTriggerMsg(null)
    try {
      await triggerRun()
      setTriggerMsg('Run aangevraagd — orchestrator pikt op binnen 15 min.')
      setTimeout(() => setTriggerMsg(null), 6000)
    } catch (err) {
      setTriggerMsg('Mislukt: ' + (err.message || String(err)))
    } finally { setTriggering(false) }
  }

  const agentMeta = (() => {
    const lasts = churns.map(c => c.last_summarized_at).filter(Boolean)
    if (!lasts.length) return 'nog niet gedraaid'
    const max = lasts.map(t => new Date(t).getTime()).reduce((a, b) => Math.max(a, b), 0)
    const d = new Date(max)
    const isToday = d.toDateString() === new Date().toDateString()
    const time = d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
    return isToday ? `vandaag ${time}` : `${d.toLocaleDateString('nl-NL')} ${time}`
  })()

  return (
    <div className="kl2-app">
      <header className="kl2-topbar">
        <div className="kl2-crumbs">
          <span>Werkruimte</span>
          <span className="kl2-crumbs__sep">/</span>
          <span>Customer Success</span>
          <span className="kl2-crumbs__sep">/</span>
          <span className="kl2-crumbs__current">Klantverlies</span>
        </div>
        <div className="kl2-topbar__right">
          <div className="kl2-agent-pill" title="Churn-agent draait dagelijks om 07:00 NL">
            <span className="kl2-agent-pill__beat" />
            <span>Churn-agent</span>
            <span className="kl2-agent-pill__sep">·</span>
            <span className="kl2-agent-pill__meta">{agentMeta}</span>
          </div>
          <button type="button" className="kl2-btn kl2-btn--sm" onClick={() => setCatModalOpen(true)}>
            Instellingen
          </button>
          <button
            type="button"
            className="kl2-btn kl2-btn--sm kl2-btn--primary"
            onClick={onTriggerRun}
            disabled={triggering}
          >
            {triggering ? 'Aangevraagd…' : 'Nu draaien'}
          </button>
        </div>
      </header>

      <div className="kl2-card">
        <div className="kl2-card-inner">
          <div className="kl2-wrap">
            {loading ? (
              <>
                <div className="skeleton" style={{ height: 80 }} />
                <div className="skeleton" style={{ height: 96 }} />
                <div className="skeleton" style={{ height: 320 }} />
              </>
            ) : error ? (
              <div className="kl2-banner">Kan klantverlies-data niet laden: {error}</div>
            ) : (
              <>
                <div className="kl2-ph">
                  <div>
                    <div className="kl2-ph__eyebrow"><span className="kl2-ph__eyebrow-dot" />Customer Success</div>
                    <h2 className="kl2-ph__title">Klantverlies</h2>
                    <p className="kl2-ph__intro">
                      Alle gechurnte klanten uit HubSpot, met AI-samenvatting van de reden en ruimte voor je
                      eigen notitie. Gesorteerd op afsluitdatum.
                    </p>
                  </div>
                </div>

                <KpiStrip churns={churns} />

                <div className="kl2-tools">
                  <label className="kl2-search">
                    <span aria-hidden>🔍</span>
                    <input
                      type="text"
                      placeholder="Zoek klant, domein of overgestapt-naar…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="kl2-select-mini"
                    onClick={() => setSortDesc(s => !s)}
                  >
                    Sorteer: <b>{sortDesc ? 'nieuwste eerst' : 'oudste eerst'}</b>
                  </button>
                  <button
                    type="button"
                    className={`kl2-select-mini kl2-select-mini--right ${noNoteOnly ? 'is-active' : ''}`}
                    onClick={() => setNoNoteOnly(v => !v)}
                  >
                    {noNoteOnly ? '✓ alleen zonder notitie' : `${noNoteCount} zonder notitie`}
                  </button>
                </div>

                <FilterBar
                  categories={categories}
                  churns={churns}
                  activeCategoryId={activeCategoryId}
                  onChange={setActiveCategoryId}
                />

                {triggerMsg && <div className="kl2-banner">{triggerMsg}</div>}

                {filteredChurns.length === 0 ? (
                  <div className="kl2-empty">
                    <div className="kl2-empty__title">
                      {churns.length === 0 ? 'Nog geen gechurnte klanten geregistreerd' : 'Geen klanten in deze filterselectie'}
                    </div>
                    <div className="kl2-empty__desc">
                      {churns.length === 0
                        ? 'De churn-agent draait dagelijks om 07:00 en vult deze tabel.'
                        : 'Pas filters aan of klik op "filter wissen".'}
                    </div>
                  </div>
                ) : (
                  monthGroups.map(g => (
                    <div key={g.label} className="kl2-month-group">
                      <div className="kl2-month-head">
                        <h3>{g.label}</h3>
                        <span className="kl2-month-head__count">· {g.items.length} {g.items.length === 1 ? 'klant' : 'klanten'}</span>
                        {g.mrr > 0 && (
                          <span className="kl2-month-head__mrr">
                            verloren MRR <b>€&nbsp;{g.mrr.toLocaleString('nl-NL', { maximumFractionDigits: 0 })}</b>
                          </span>
                        )}
                      </div>
                      <div className="kl2-klant-list">
                        <div className="kl2-klant-thead">
                          <div>Klant</div>
                          <div>Reden + overgestapt naar</div>
                          <div>AI-samenvatting</div>
                          <div>Mijn notitie</div>
                        </div>
                        {g.items.map(c => (
                          <ChurnCard
                            key={c.deal_id}
                            churn={c}
                            onOpen={() => navigate(`/klantverlies-v2/${c.deal_id}`)}
                          />
                        ))}
                      </div>
                    </div>
                  ))
                )}

                <div className="kl2-legal-foot">
                  Bron: HubSpot CRM · churn-agent draait dagelijks om 07:00 NL · samenvattingen worden
                  alleen hergegenereerd als er nieuwe notes of mails zijn sinds de laatste run.
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <CategoryManagerModal
        open={catModalOpen}
        onClose={() => setCatModalOpen(false)}
        allCategories={allCategories}
        onUpsert={upsertCategory}
        onDelete={deleteCategory}
        summaryInstructions={summaryInstructions}
        onSaveSummaryInstructions={saveSummaryInstructions}
      />
    </div>
  )
}
