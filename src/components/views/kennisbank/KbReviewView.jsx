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
  archive: ['M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z', 'M3 4h18v4H3z', 'M10 12h4'],
  doc: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'],
}

/**
 * KbReviewView — review-queue Kennisbank 2.0.
 * Lichte voorstellen (titel + beschrijving, per categorie) → Jelle beslist →
 * AI schrijft → Jelle publiceert/finetuned. Tabs:
 *  - Te beoordelen : pending (licht voorstel)
 *  - Wacht op AI   : accepted (wordt geschreven) + amended (wordt herschreven)
 *  - Geschreven    : written (artikel klaar → publiceren / finetunen / afwijzen)
 *  - Later         : uitgesteld
 */
export default function KbReviewView() {
  const navigate = useNavigate()
  const { proposals, categories, parked, parkedLoaded, parkedCount, loadParked, dropParked, loading, error, refresh } = useKennisbank()
  const [view, setView] = useState('queue')      // queue | parked
  const [tab, setTab] = useState('todo')          // todo | waiting | written | later
  const [activeCat, setActiveCat] = useState('all')
  const [activeImpact, setActiveImpact] = useState('all')
  const [selectedId, setSelectedId] = useState(null)

  const inParked = view === 'parked'
  useEffect(() => { if (inParked && !parkedLoaded) loadParked() }, [inParked, parkedLoaded, loadParked])

  const catMap = useMemo(() => { const m = {}; for (const c of categories) m[c.id] = c.label; return m }, [categories])
  const todo = useMemo(() => proposals.filter(p => p.status === 'pending' && !p.deferred_at), [proposals])
  const waiting = useMemo(() => proposals.filter(p => p.status === 'accepted' || p.status === 'amended'), [proposals])
  const written = useMemo(() => proposals.filter(p => p.status === 'written' && !p.deferred_at), [proposals])
  const later = useMemo(() => proposals.filter(p => (p.status === 'pending' || p.status === 'written') && p.deferred_at), [proposals])

  const base = inParked ? parked : (tab === 'waiting' ? waiting : tab === 'written' ? written : tab === 'later' ? later : todo)
  const counts = useMemo(() => { const m = {}; for (const p of base) m[p.kb_category] = (m[p.kb_category] || 0) + 1; return m }, [base])
  const byCat = useMemo(() => activeCat === 'all' ? base : base.filter(p => p.kb_category === activeCat), [base, activeCat])
  const impCounts = useMemo(() => { const m = { hoog: 0, midden: 0, laag: 0 }; for (const p of byCat) m[impactKey(p)]++; return m }, [byCat])
  const list = useMemo(() => activeImpact === 'all' ? byCat : byCat.filter(p => impactKey(p) === activeImpact), [byCat, activeImpact])
  const selected = list.find(p => p.id === selectedId) || list[0] || null
  const parkedShown = parkedLoaded ? parked.length : parkedCount

  // categorieën die in de huidige lijst voorkomen maar niet (meer) actief zijn → toch tonen
  const catChips = useMemo(() => {
    const known = new Set(categories.map(c => c.id))
    const extra = Object.keys(counts).filter(id => !known.has(id)).map(id => ({ id, label: id }))
    return [...categories, ...extra]
  }, [categories, counts])

  return (
    <div className="theme-maestro knb-maestro knb-review">
      <div className="rev-head">
        <div className="rev-head__title">
          <h1>{inParked ? 'Geparkeerd' : 'Review-queue'}</h1>
          {!loading && !error && (inParked
            ? <span className="rev-head__count">{parkedShown} geparkeerd</span>
            : proposals.length > 0 && <span className="rev-head__count">{todo.length} te beoordelen{written.length ? ` · ${written.length} geschreven` : ''}{waiting.length ? ` · ${waiting.length} bij de AI` : ''}{later.length ? ` · ${later.length} later` : ''}</span>)}
        </div>
        <div className="rev-head__right">
          {(parkedCount > 0 || inParked) && (
            <button className={`rev-parked-toggle ${inParked ? 'is-active' : ''}`} onClick={() => { setView(inParked ? 'queue' : 'parked'); setSelectedId(null) }}>
              <Lc d={inParked ? I.inbox : I.archive} w={13} />{inParked ? 'Naar wachtrij' : `Geparkeerd · ${parkedCount}`}
            </button>
          )}
          <button className="btn btn-sm" onClick={refresh}><Lc d={I.refresh} w={13} />Verversen</button>
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
            <div className="rev-list__head">
              {inParked ? (
                <div className="rev-parked-note"><Lc d={I.archive} />Geparkeerde voorstellen — “Terughalen” zet ze terug in de wachtrij.</div>
              ) : (
                <div className="rev-seg">
                  <button className={tab === 'todo' ? 'is-active' : ''} onClick={() => setTab('todo')}>Te beoordelen <span className="n">{todo.length}</span></button>
                  <button className={tab === 'written' ? 'is-active' : ''} onClick={() => setTab('written')}>Geschreven <span className="n">{written.length}</span></button>
                  <button className={tab === 'waiting' ? 'is-active' : ''} onClick={() => setTab('waiting')}>Bij de AI <span className="n">{waiting.length}</span></button>
                  <button className={tab === 'later' ? 'is-active' : ''} onClick={() => setTab('later')}>Later <span className="n">{later.length}</span></button>
                </div>
              )}
              <div className="rev-seg rev-seg--imp" title="Filter op belang (door de AI gescoord)">
                <button className={activeImpact === 'all' ? 'is-active' : ''} onClick={() => setActiveImpact('all')}>Alle <span className="n">{byCat.length}</span></button>
                <button className={`imp-hoog ${activeImpact === 'hoog' ? 'is-active' : ''}`} onClick={() => setActiveImpact('hoog')}>Hoog <span className="n">{impCounts.hoog}</span></button>
                <button className={`imp-midden ${activeImpact === 'midden' ? 'is-active' : ''}`} onClick={() => setActiveImpact('midden')}>Midden <span className="n">{impCounts.midden}</span></button>
                <button className={`imp-laag ${activeImpact === 'laag' ? 'is-active' : ''}`} onClick={() => setActiveImpact('laag')}>Laag <span className="n">{impCounts.laag}</span></button>
              </div>
            </div>
            <div className="rev-list__scroll">
              {list.length === 0 ? (
                <div className="rev-list__empty"><Lc d={I.inbox} />{inParked ? (parkedLoaded ? 'Niets geparkeerd' : 'Geparkeerde voorstellen laden…') : tab === 'later' ? 'Niets op “later” gezet' : tab === 'waiting' ? 'Niets bij de AI in behandeling' : tab === 'written' ? 'Geen geschreven artikelen die op je wachten' : 'Geen voorstellen te beoordelen'}{activeCat !== 'all' ? ' voor deze categorie' : ''}.</div>
              ) : list.map(p => {
                const nSig = p.source_signal_ids?.length || 0
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
                        {p.status === 'pending' && (
                          <span>{p.distinct_threads != null ? `${p.distinct_threads} thread${p.distinct_threads === 1 ? '' : 's'}` : `${nSig} vra${nSig === 1 ? 'ag' : 'gen'}`}</span>
                        )}
                        {hasSimilar && <span className="rev-row__qa" title="Lijkt op een bestaand artikel of ander voorstel">lijkt op…</span>}
                        {p.needs_review && p.status === 'written' && <span className="rev-row__qa" title="De AI markeerde dit concept zelf voor controle">QA</span>}
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
              <div className="rev-empty"><Lc d={I.inbox} /><p>{inParked ? 'Kies links een geparkeerd voorstel.' : 'Kies links een voorstel om het te beoordelen.'}</p></div>
            )}
          </section>
        </div>
        </>
      )}
    </div>
  )
}
