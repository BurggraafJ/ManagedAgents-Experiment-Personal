import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useKennisbank } from '../../../hooks/useKennisbank'
import KbProposalCard from './KbProposalCard'
import { catClass, impactKey, IMPACT_LABEL } from './kbMeta'
import './kennisbank-maestro.css'

function Lc({ d, w }) {
  return <svg className="lc" viewBox="0 0 24 24" width={w} height={w}>{d.map((p, i) => <path key={i} d={p} />)}</svg>
}
const I = {
  check: ['M9 11l3 3L22 4', 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'],
  refresh: ['M3 12a9 9 0 0 1 15.4-6.4L21 8', 'M21 3v5h-5'],
  book: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z'],
  inbox: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z'],
  doc: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'],
}

// Tab-definities: één rij, geparkeerd is een gewone tab (geen aparte weergave-stand).
const TABS = [
  { id: 'todo',    label: 'Te beoordelen' },
  { id: 'written', label: 'Geschreven' },
  { id: 'waiting', label: 'Bij de AI' },
  { id: 'later',   label: 'Later' },
  { id: 'parked',  label: 'Geparkeerd' },
]

/**
 * KbReviewView — review-queue Kennisbank 2.0.
 * Eén tab-rij (werkvolgorde: beoordelen → geschreven publiceren), daaronder
 * de categorie-chips, daaronder lijst + detail. De lijst is op belang
 * gesorteerd; het belang staat als badge op elke rij.
 */
export default function KbReviewView() {
  const navigate = useNavigate()
  const { proposals, categories, parked, parkedLoaded, parkedCount, loadParked, dropParked, loading, error, refresh } = useKennisbank()
  const [tab, setTab] = useState('todo')
  const [activeCat, setActiveCat] = useState('all')
  const [selectedId, setSelectedId] = useState(null)

  const inParked = tab === 'parked'
  useEffect(() => { if (inParked && !parkedLoaded) loadParked() }, [inParked, parkedLoaded, loadParked])

  const catMap = useMemo(() => { const m = {}; for (const c of categories) m[c.id] = c.label; return m }, [categories])
  const pools = useMemo(() => ({
    todo:    proposals.filter(p => p.status === 'pending' && !p.deferred_at),
    written: proposals.filter(p => p.status === 'written' && !p.deferred_at),
    waiting: proposals.filter(p => p.status === 'accepted' || p.status === 'amended'),
    later:   proposals.filter(p => (p.status === 'pending' || p.status === 'written') && p.deferred_at),
    parked,
  }), [proposals, parked])
  const tabCount = (id) => id === 'parked' ? (parkedLoaded ? parked.length : parkedCount) : pools[id].length

  const base = pools[tab]
  const counts = useMemo(() => { const m = {}; for (const p of base) m[p.kb_category] = (m[p.kb_category] || 0) + 1; return m }, [base])
  const list = useMemo(() => activeCat === 'all' ? base : base.filter(p => p.kb_category === activeCat), [base, activeCat])
  const selected = list.find(p => p.id === selectedId) || list[0] || null

  // categorieën die in de huidige lijst voorkomen maar niet (meer) actief zijn → toch tonen
  const catChips = useMemo(() => {
    const known = new Set(categories.map(c => c.id))
    const extra = Object.keys(counts).filter(id => !known.has(id)).map(id => ({ id, label: id }))
    return [...categories, ...extra]
  }, [categories, counts])

  const emptyText = {
    todo: 'Geen voorstellen te beoordelen', written: 'Geen geschreven artikelen die op je wachten',
    waiting: 'Niets bij de AI in behandeling', later: 'Niets op “later” gezet',
    parked: parkedLoaded ? 'Niets geparkeerd' : 'Geparkeerde voorstellen laden…',
  }[tab]

  return (
    <div className="theme-maestro knb-maestro knb-review">
      <div className="rev-head">
        <div className="rev-head__title">
          <h1>Review-queue</h1>
        </div>
        <div className="rev-head__tabs rev-seg" role="tablist">
          {TABS.map(t => {
            const n = tabCount(t.id)
            if (t.id === 'parked' && n === 0 && tab !== 'parked') return null
            if (t.id === 'later' && n === 0 && tab !== 'later') return null
            return (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'is-active' : ''}
                onClick={() => { setTab(t.id); setActiveCat('all'); setSelectedId(null) }}>
                {t.label} <span className="n">{n}</span>
              </button>
            )
          })}
        </div>
        <div className="rev-head__right">
          <button className="btn btn-sm" onClick={refresh} title="Verversen"><Lc d={I.refresh} w={13} />Verversen</button>
        </div>
      </div>

      {error ? (
        <div className="rev-state"><p className="knb-state knb-state--err">Kon voorstellen niet laden: {error}</p></div>
      ) : loading ? (
        <div className="rev-state"><p className="knb-state">Voorstellen laden…</p></div>
      ) : (!inParked && proposals.length === 0) ? (
        <div className="rev-state">
          <div className="knb-empty">
            <div className="knb-empty__art"><Lc d={I.check} /></div>
            <h3>Geen openstaande voorstellen</h3>
            <p>Alles beoordeeld. Nieuwe voorstellen verschijnen hier zodra de kennisbank-curator nieuwe klantvragen heeft gegroepeerd.</p>
            <div className="knb-empty__actions"><button className="btn btn-primary" onClick={() => navigate('/kennisbank')}><Lc d={I.book} w={14} />Naar de kennisbank</button></div>
          </div>
        </div>
      ) : (
        <>
        <div className="rev-cats">
          <button className={`rq-chip ${activeCat === 'all' ? 'active' : ''}`} onClick={() => setActiveCat('all')}>Alle <span className="cnt">{base.length}</span></button>
          {catChips.filter(c => counts[c.id]).map(c => (
            <button key={c.id} className={`rq-chip ${activeCat === c.id ? 'active' : ''}`} onClick={() => setActiveCat(c.id)}>
              <span className={`swatch ${catClass(c.id)}`} />{c.label} <span className="cnt">{counts[c.id]}</span>
            </button>
          ))}
        </div>
        <div className="rev-split">
          {/* LIJST */}
          <aside className="rev-list">
            <div className="rev-list__scroll">
              {list.length === 0 ? (
                <div className="rev-list__empty"><Lc d={I.inbox} />{emptyText}{activeCat !== 'all' ? ' in deze categorie' : ''}.</div>
              ) : list.map(p => {
                const imp = impactKey(p)
                const hasSimilar = !!(p.similar_info && ((p.similar_info.articles?.length || 0) + (p.similar_info.proposals?.length || 0) > 0))
                return (
                  <button key={p.id} className={`rev-row ${selected?.id === p.id ? 'is-active' : ''}`} onClick={() => setSelectedId(p.id)}>
                    <span className={`rev-row__dot ${catClass(p.kb_category)}`} />
                    <span className="rev-row__main">
                      <span className="rev-row__title">{p.title}</span>
                      <span className="rev-row__meta">
                        {p.status === 'accepted' && <span className="rev-row__wait">AI schrijft…</span>}
                        {p.status === 'amended' && <span className="rev-row__wait">AI herschrijft…</span>}
                        {p.status === 'written' && <span className="ok"><Lc d={I.doc} w={11} /> artikel klaar</span>}
                        {(p.status === 'pending' || p.status === 'parked') && p.distinct_threads != null && (
                          <span>{p.distinct_threads} gesprek{p.distinct_threads === 1 ? '' : 'ken'}</span>
                        )}
                        {hasSimilar && <span className="rev-row__qa" title="Lijkt op een bestaand artikel of ander voorstel">lijkt op…</span>}
                      </span>
                    </span>
                    <span className="rev-row__right">
                      <span className={`rev-imp rev-imp--${imp}`}>{IMPACT_LABEL[imp]}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </aside>

          {/* DETAIL */}
          <section className="rev-detail">
            {selected ? (
              <KbProposalCard key={selected.id} proposal={selected} categoryLabel={catMap[selected.kb_category]}
                onDone={refresh} deferred={!!selected.deferred_at}
                parked={selected.status === 'parked'}
                onRestore={(id) => { dropParked(id); setSelectedId(null) }} />
            ) : (
              <div className="rev-empty"><Lc d={I.inbox} /><p>Kies links een voorstel.</p></div>
            )}
          </section>
        </div>
        </>
      )}
    </div>
  )
}
