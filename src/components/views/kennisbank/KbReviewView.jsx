import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useKennisbank } from '../../../hooks/useKennisbank'
import { useKbAudience } from '../../../hooks/useKbAudience'
import KbProposalCard from './KbProposalCard'
import KbAudienceSwitch from './KbAudienceSwitch'
import { audBucket, catClass } from './kbMeta'
import './kennisbank-maestro.css'

const PAGE_SIZE = 5

function Lc({ d, w }) {
  return <svg className="lc" viewBox="0 0 24 24" width={w} height={w}>{d.map((p, i) => <path key={i} d={p} />)}</svg>
}
const I = {
  check: ['M9 11l3 3L22 4', 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'],
  spark: ['M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8'],
  refresh: ['M3 12a9 9 0 0 1 15.4-6.4L21 8', 'M21 3v5h-5'],
  book: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z'],
  clock: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', 'M12 8v4l2.5 1.5'],
  left: ['m15 18-6-6 6-6'],
  right: ['m9 18 6-6-6-6'],
  chev: ['m6 9 6 6 6-6'],
}

function pageWindow(cur, total) {
  const span = Math.min(5, total)
  let start = Math.max(1, cur - 2)
  const end = Math.min(total, start + span - 1)
  start = Math.max(1, end - span + 1)
  const arr = []
  for (let i = start; i <= end; i++) arr.push(i)
  return arr
}

export default function KbReviewView() {
  const navigate = useNavigate()
  const { proposals, categories, loading, error, refresh } = useKennisbank()
  const [aud] = useKbAudience()
  const [activeCat, setActiveCat] = useState('all')
  const [page, setPage] = useState(1)
  const [showLater, setShowLater] = useState(false)

  useEffect(() => { setPage(1) }, [activeCat, aud])

  const catMap = useMemo(() => {
    const m = {}; for (const c of categories) m[c.id] = c.label; return m
  }, [categories])

  // Eerst filteren op de gekozen kennisbank (intern/klant), dan op categorie.
  const pool = useMemo(() => proposals.filter(p => audBucket(p.audience) === aud), [proposals, aud])
  const byCat = (list) => activeCat === 'all' ? list : list.filter(p => p.kb_category === activeCat)
  const active = useMemo(() => byCat(pool.filter(p => !p.deferred_at)), [pool, activeCat])
  const later = useMemo(() => byCat(pool.filter(p => p.deferred_at)), [pool, activeCat])
  const counts = useMemo(() => {
    const m = {}; for (const p of pool) if (!p.deferred_at) m[p.kb_category] = (m[p.kb_category] || 0) + 1; return m
  }, [pool])
  const activeTotal = pool.filter(p => !p.deferred_at).length
  const laterTotal = pool.filter(p => p.deferred_at).length

  const totalPages = Math.max(1, Math.ceil(active.length / PAGE_SIZE))
  const curPage = Math.min(page, totalPages)
  const pageItems = active.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE)

  return (
    <div className="theme-maestro knb-maestro">
      <div className="knb-inner">

        <div className="knb-topbar"><KbAudienceSwitch /></div>

        <div className="knb-head" style={{ marginBottom: 18 }}>
          <div>
            <div className="knb-head__eyebrow"><Lc d={I.check} />Voorstellen ter goedkeuring</div>
            <h1>Review-queue</h1>
            <p className="knb-head__sub">De AI las twee jaar mailhistorie en stelt nieuwe kennisbank-artikelen voor. Keur goed, laat aanpassen, wijs af of zet op “later”.</p>
          </div>
          <div className="knb-head__stats">
            <div className="knb-stat"><div className="knb-stat__num">{activeTotal}</div><div className="knb-stat__lbl">te beoordelen</div></div>
            {laterTotal > 0 && <div className="knb-stat"><div className="knb-stat__num">{laterTotal}</div><div className="knb-stat__lbl">later</div></div>}
          </div>
        </div>

        {error ? (
          <p className="knb-state knb-state--err">Kon voorstellen niet laden: {error}</p>
        ) : loading ? (
          <p className="knb-state">Voorstellen laden…</p>
        ) : proposals.length === 0 ? (
          <div className="knb-empty">
            <div className="knb-empty__art"><Lc d={I.check} /></div>
            <h3>Geen openstaande voorstellen</h3>
            <p>Alles beoordeeld. Nieuwe voorstellen verschijnen hier zodra de kennisbank-curator weer draait.</p>
            <div className="knb-empty__actions"><button className="btn btn-primary" onClick={() => navigate('/kennisbank')}><Lc d={I.book} w={14} />Naar de kennisbank</button></div>
          </div>
        ) : (
          <>
            <div className="run-banner">
              <div className="run-banner__ic"><Lc d={I.spark} w={17} /></div>
              <div>
                <div className="run-banner__txt"><b>{activeTotal + laterTotal} voorstellen</b> uit je mailhistorie</div>
                <div className="run-banner__sub">Gedestilleerd uit has_question-mails · pas na jouw akkoord gepubliceerd</div>
              </div>
              <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={refresh}><Lc d={I.refresh} w={13} />Verversen</button>
            </div>

            <div className="rq-toolbar">
              <div className="rq-filters">
                <button className={`rq-chip ${activeCat === 'all' ? 'active' : ''}`} onClick={() => setActiveCat('all')}>Alle <span className="cnt">{activeTotal}</span></button>
                {categories.filter(c => counts[c.id]).map(c => (
                  <button key={c.id} className={`rq-chip ${activeCat === c.id ? 'active' : ''}`} onClick={() => setActiveCat(c.id)}>
                    <span className={`swatch ${catClass(c.id)}`} />{c.label} <span className="cnt">{counts[c.id]}</span>
                  </button>
                ))}
              </div>
            </div>

            {pageItems.length === 0 ? (
              <p className="knb-state">Geen voorstellen in de {aud === 'intern' ? 'Intern' : 'Klant'}-kennisbank{activeCat !== 'all' ? ' voor deze categorie' : ''}{laterTotal ? ' — kijk bij “later te reviewen”' : ''}.</p>
            ) : (
              <div className="rq-cards">
                {pageItems.map(p => (
                  <KbProposalCard key={p.id} proposal={p} categoryLabel={catMap[p.kb_category]} onDone={refresh} />
                ))}
              </div>
            )}

            {totalPages > 1 && (
              <div className="knb-pager">
                <button className="knb-pager__btn" disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}><Lc d={I.left} /></button>
                {pageWindow(curPage, totalPages)[0] > 1 && <span className="knb-pager__ell">…</span>}
                {pageWindow(curPage, totalPages).map(n => (
                  <button key={n} className={`knb-pager__btn ${n === curPage ? 'active' : ''}`} onClick={() => setPage(n)}>{n}</button>
                ))}
                {pageWindow(curPage, totalPages).slice(-1)[0] < totalPages && <span className="knb-pager__ell">…</span>}
                <button className="knb-pager__btn" disabled={curPage >= totalPages} onClick={() => setPage(curPage + 1)}><Lc d={I.right} /></button>
              </div>
            )}

            {laterTotal > 0 && (
              <div className="knb-later">
                <button className={`knb-later__head ${showLater ? 'is-open' : ''}`} onClick={() => setShowLater(s => !s)}>
                  <Lc d={I.clock} />Later te reviewen <span className="cnt">{later.length}</span>
                  <span className="knb-later__chev"><Lc d={I.chev} /></span>
                </button>
                {showLater && (
                  later.length === 0
                    ? <p className="knb-state" style={{ padding: '12px 2px' }}>Geen “later”-voorstellen in deze categorie.</p>
                    : <div className="rq-cards">
                        {later.map(p => (
                          <KbProposalCard key={p.id} proposal={p} categoryLabel={catMap[p.kb_category]} onDone={refresh} deferred />
                        ))}
                      </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
