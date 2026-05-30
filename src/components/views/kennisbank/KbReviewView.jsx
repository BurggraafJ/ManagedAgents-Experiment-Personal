import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useKennisbank } from '../../../hooks/useKennisbank'
import { useKbAudience } from '../../../hooks/useKbAudience'
import KbProposalCard from './KbProposalCard'
import KbAudienceSwitch from './KbAudienceSwitch'
import { audBucket, catClass, confInfo } from './kbMeta'
import './kennisbank-maestro.css'

function Lc({ d, w }) {
  return <svg className="lc" viewBox="0 0 24 24" width={w} height={w}>{d.map((p, i) => <path key={i} d={p} />)}</svg>
}
const I = {
  check: ['M9 11l3 3L22 4', 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'],
  refresh: ['M3 12a9 9 0 0 1 15.4-6.4L21 8', 'M21 3v5h-5'],
  book: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z'],
  inbox: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z'],
}

export default function KbReviewView() {
  const navigate = useNavigate()
  const { proposals, categories, loading, error, refresh } = useKennisbank()
  const [aud] = useKbAudience()
  const [tab, setTab] = useState('todo')        // todo | later
  const [activeCat, setActiveCat] = useState('all')
  const [selectedId, setSelectedId] = useState(null)

  const catMap = useMemo(() => { const m = {}; for (const c of categories) m[c.id] = c.label; return m }, [categories])
  const pool = useMemo(() => proposals.filter(p => audBucket(p.audience) === aud), [proposals, aud])
  const todo = useMemo(() => pool.filter(p => !p.deferred_at), [pool])
  const later = useMemo(() => pool.filter(p => p.deferred_at), [pool])

  const base = tab === 'later' ? later : todo
  const counts = useMemo(() => { const m = {}; for (const p of base) m[p.kb_category] = (m[p.kb_category] || 0) + 1; return m }, [base])
  const list = activeCat === 'all' ? base : base.filter(p => p.kb_category === activeCat)
  const selected = list.find(p => p.id === selectedId) || list[0] || null
  const audLabel = aud === 'intern' ? 'Intern' : 'Klant'

  return (
    <div className="theme-maestro knb-maestro knb-review">
      <div className="rev-head">
        <div className="rev-head__title">
          <h1>Review-queue</h1>
          {!loading && !error && proposals.length > 0 && (
            <span className="rev-head__count">{todo.length} te beoordelen{later.length ? ` · ${later.length} later` : ''}</span>
          )}
        </div>
        <div className="rev-head__right">
          <KbAudienceSwitch />
          <button className="btn btn-sm" onClick={refresh}><Lc d={I.refresh} w={13} />Verversen</button>
        </div>
      </div>

      {error ? (
        <div className="rev-state"><p className="knb-state knb-state--err">Kon voorstellen niet laden: {error}</p></div>
      ) : loading ? (
        <div className="rev-state"><p className="knb-state">Voorstellen laden…</p></div>
      ) : proposals.length === 0 ? (
        <div className="rev-state">
          <div className="knb-empty">
            <div className="knb-empty__art"><Lc d={I.check} /></div>
            <h3>Geen openstaande voorstellen</h3>
            <p>Alles beoordeeld. Nieuwe voorstellen verschijnen hier zodra de kennisbank-curator weer draait.</p>
            <div className="knb-empty__actions"><button className="btn btn-primary" onClick={() => navigate('/kennisbank')}><Lc d={I.book} w={14} />Naar de kennisbank</button></div>
          </div>
        </div>
      ) : (
        <>
        <div className="rev-cats">
          <button className={`rq-chip ${activeCat === 'all' ? 'active' : ''}`} onClick={() => setActiveCat('all')}>Alle <span className="cnt">{base.length}</span></button>
          {categories.filter(c => counts[c.id]).map(c => (
            <button key={c.id} className={`rq-chip ${activeCat === c.id ? 'active' : ''}`} onClick={() => setActiveCat(c.id)}>
              <span className={`swatch ${catClass(c.id)}`} />{c.label} <span className="cnt">{counts[c.id]}</span>
            </button>
          ))}
        </div>
        <div className="rev-split">
          {/* LIJST */}
          <aside className="rev-list">
            <div className="rev-list__head">
              <div className="rev-seg">
                <button className={tab === 'todo' ? 'is-active' : ''} onClick={() => setTab('todo')}>Te beoordelen <span className="n">{todo.length}</span></button>
                <button className={tab === 'later' ? 'is-active' : ''} onClick={() => setTab('later')}>Later <span className="n">{later.length}</span></button>
              </div>
            </div>
            <div className="rev-list__scroll">
              {list.length === 0 ? (
                <div className="rev-list__empty"><Lc d={I.inbox} />{tab === 'later' ? 'Niets op “later” gezet' : `Geen voorstellen in de ${audLabel}-kennisbank`}{activeCat !== 'all' ? ' voor deze categorie' : ''}.</div>
              ) : list.map(p => {
                const conf = confInfo(p.confidence)
                const answered = p?.evidence?.answered === true
                const nMails = (Array.isArray(p.source_mail_ids) && p.source_mail_ids.length) || (p.source_signal_ids?.length || 0)
                return (
                  <button key={p.id} className={`rev-row ${selected?.id === p.id ? 'is-active' : ''}`} onClick={() => setSelectedId(p.id)}>
                    <span className={`rev-row__dot ${catClass(p.kb_category)}`} />
                    <span className="rev-row__main">
                      <span className="rev-row__title">{p.title}</span>
                      <span className="rev-row__meta">
                        <span className={answered ? 'ok' : 'todo'}>{answered ? '✓ antwoord' : '! te bevestigen'}</span>
                        {nMails > 0 && <span>· {nMails} bron{nMails === 1 ? '' : 'nen'}</span>}
                        {p.needs_review && <span className="rev-row__qa" title="De AI markeerde dit concept zelf voor controle">QA</span>}
                      </span>
                    </span>
                    {conf && <span className={`rev-row__conf c-${conf.bucket}`}>{conf.pct}%</span>}
                  </button>
                )
              })}
            </div>
          </aside>

          {/* DETAIL */}
          <section className="rev-detail">
            {selected ? (
              <KbProposalCard key={selected.id} proposal={selected} categoryLabel={catMap[selected.kb_category]} onDone={refresh} deferred={!!selected.deferred_at} />
            ) : (
              <div className="rev-empty"><Lc d={I.inbox} /><p>Kies links een voorstel om het te beoordelen.</p></div>
            )}
          </section>
        </div>
        </>
      )}
    </div>
  )
}
