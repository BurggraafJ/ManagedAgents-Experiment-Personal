import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useKennisbank } from '../../../hooks/useKennisbank'
import KbProposalCard from './KbProposalCard'
import { catClass } from './kbMeta'
import './kennisbank-maestro.css'

function Lc({ d, w }) {
  return <svg className="lc" viewBox="0 0 24 24" width={w} height={w}>{d.map((p, i) => <path key={i} d={p} />)}</svg>
}
const I = {
  check: ['M9 11l3 3L22 4', 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'],
  spark: ['M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8'],
  refresh: ['M3 12a9 9 0 0 1 15.4-6.4L21 8', 'M21 3v5h-5'],
  book: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z'],
}

export default function KbReviewView() {
  const navigate = useNavigate()
  const { proposals, categories, loading, error, refresh } = useKennisbank()
  const [activeCat, setActiveCat] = useState('all')

  const catMap = useMemo(() => {
    const m = {}; for (const c of categories) m[c.id] = c.label; return m
  }, [categories])
  const counts = useMemo(() => {
    const m = {}; for (const p of proposals) m[p.kb_category] = (m[p.kb_category] || 0) + 1; return m
  }, [proposals])

  const visible = activeCat === 'all' ? proposals : proposals.filter(p => p.kb_category === activeCat)

  return (
    <div className="theme-maestro knb-maestro">
      <div className="knb-inner">

        <div className="knb-head" style={{ marginBottom: 18 }}>
          <div>
            <div className="knb-head__eyebrow"><Lc d={I.check} />Voorstellen ter goedkeuring</div>
            <h1>Review-queue</h1>
            <p className="knb-head__sub">De AI las twee jaar mailhistorie en stelt nieuwe kennisbank-artikelen voor. Keur goed, laat aanpassen of wijs af — pas na jouw akkoord wordt het gepubliceerd.</p>
          </div>
          <div className="knb-head__stats">
            <div className="knb-stat"><div className="knb-stat__num">{proposals.length}</div><div className="knb-stat__lbl">te beoordelen</div></div>
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
                <div className="run-banner__txt"><b>{proposals.length} voorstellen</b> uit je mailhistorie</div>
                <div className="run-banner__sub">Gedestilleerd uit has_question-mails · pas na jouw akkoord gepubliceerd</div>
              </div>
              <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={refresh}><Lc d={I.refresh} w={13} />Verversen</button>
            </div>

            <div className="rq-toolbar">
              <div className="rq-filters">
                <button className={`rq-chip ${activeCat === 'all' ? 'active' : ''}`} onClick={() => setActiveCat('all')}>Alle <span className="cnt">{proposals.length}</span></button>
                {categories.filter(c => counts[c.id]).map(c => (
                  <button key={c.id} className={`rq-chip ${activeCat === c.id ? 'active' : ''}`} onClick={() => setActiveCat(c.id)}>
                    <span className={`swatch ${catClass(c.id)}`} />{c.label} <span className="cnt">{counts[c.id]}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="rq-cards">
              {visible.map(p => (
                <KbProposalCard key={p.id} proposal={p} categoryLabel={catMap[p.kb_category]} onDone={refresh} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
