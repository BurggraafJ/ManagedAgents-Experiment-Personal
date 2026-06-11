import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useKbArticles } from '../../../hooks/useKbArticles'
import { supabase } from '../../../lib/supabase'
import { showToast } from '../../Toast'
import KbDocuments from './KbDocuments'
import { catClass, catLabel, fmtDate, isNeedsReview } from './kbMeta'
import './kennisbank-maestro.css'

function Lc({ d, w }) {
  return <svg className="lc" viewBox="0 0 24 24" width={w} height={w}>{d.map((p, i) => <path key={i} d={p} />)}</svg>
}
const I = {
  book: ['M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z', 'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z'],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'm21 21-4.3-4.3'],
  check: ['M20 6 9 17l-5-5'],
  arrow: ['M5 12h14', 'm12 5 7 7-7 7'],
  alert: ['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9v4M12 17h.01'],
  clock: ['M12 7v5l3 2'],
  plus: ['M12 5v14M5 12h14'],
  inbox: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z'],
  paperclip: ['M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48'],
  chevron: ['m6 9 6 6 6-6'],
}

/**
 * KennisbankView — overzicht van gepubliceerde klant-artikelen.
 * Rustige opbouw: kop met één primaire actie → review-banner (als er
 * voorstellen wachten) → zoekbalk → categorie-chips → kaarten →
 * documentenbibliotheek (inklapbaar).
 */
export default function KennisbankView() {
  const navigate = useNavigate()
  const { articles, categories, pendingCount, loading, error, refresh } = useKbArticles()
  const [activeCat, setActiveCat] = useState('all')
  const [needsOnly, setNeedsOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [docsOpen, setDocsOpen] = useState(false)
  const [addingCat, setAddingCat] = useState(false)
  const [newCatLabel, setNewCatLabel] = useState('')
  const [newCatDesc, setNewCatDesc] = useState('')
  const [catBusy, setCatBusy] = useState(false)

  const visible = useMemo(() => articles.filter(a => a.status !== 'gearchiveerd' && a.status !== 'verworpen'), [articles])
  const needsCount = useMemo(() => visible.filter(isNeedsReview).length, [visible])
  const catCount = useMemo(() => {
    const m = {}; for (const a of visible) m[a.kb_category] = (m[a.kb_category] || 0) + 1; return m
  }, [visible])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return visible.filter(a => {
      if (activeCat !== 'all' && a.kb_category !== activeCat) return false
      if (needsOnly && !isNeedsReview(a)) return false
      if (q && !(`${a.title} ${a.summary || ''}`.toLowerCase().includes(q))) return false
      return true
    })
  }, [visible, activeCat, needsOnly, query])

  async function addCategory() {
    if (catBusy || newCatLabel.trim().length < 3) return
    setCatBusy(true)
    try {
      const { data, error: e } = await supabase.rpc('add_kb_category', {
        p_label: newCatLabel.trim(), p_description: newCatDesc.trim() || null,
      })
      if (e) throw e
      if (data && data.ok === false) throw new Error(data.reason || 'mislukt')
      showToast(data?.existing ? 'Categorie heractiveerd' : 'Categorie toegevoegd ✓')
      setAddingCat(false); setNewCatLabel(''); setNewCatDesc('')
      refresh()
    } catch (e) {
      showToast({ kind: 'error', message: 'Categorie toevoegen mislukt', detail: e?.message || String(e) })
    } finally {
      setCatBusy(false)
    }
  }

  if (error) {
    return (
      <div className="theme-maestro knb-maestro"><div className="knb-inner">
        <p className="knb-state knb-state--err">Kon de kennisbank niet laden: {error}</p>
      </div></div>
    )
  }

  return (
    <div className="theme-maestro knb-maestro">
      <div className="knb-inner">

        <div className="knb-head">
          <div>
            <div className="knb-head__eyebrow"><Lc d={I.book} />Kennisbank · voor de klant</div>
            <h1>Kennisbank</h1>
            <p className="knb-head__sub">Antwoorden op echte klantvragen, gedestilleerd uit de mailhistorie. Elk artikel laat zien op basis van wélke mails het gemaakt is.</p>
          </div>
          <div className="knb-head__actions">
            <Link className="btn btn-primary knb-new" to="/kennisbank/nieuw"><Lc d={I.plus} w={14} />Nieuw artikel</Link>
          </div>
        </div>

        {/* Voorstellen wachten → één duidelijke banner i.p.v. stat-tegels */}
        {pendingCount > 0 && (
          <Link to="/kennisbank/review" className="run-banner knb-review-banner">
            <div className="run-banner__ic"><Lc d={I.inbox} w={17} /></div>
            <div>
              <div className="run-banner__txt"><b>{pendingCount} voorstel{pendingCount === 1 ? '' : 'len'}</b> wacht{pendingCount === 1 ? '' : 'en'} op je in de review-queue</div>
              <div className="run-banner__sub">Beoordeel op titel + beschrijving — het artikel wordt pas na jouw akkoord geschreven</div>
            </div>
            <span className="knb-review-banner__go"><Lc d={I.arrow} w={15} /></span>
          </Link>
        )}

        {loading ? (
          <div className="knb-skel">{[0, 1, 2, 3].map(i => <div key={i} className="knb-skel-card skel-bg" />)}</div>
        ) : visible.length === 0 ? (
          <div className="knb-empty">
            <div className="knb-empty__art"><Lc d={I.book} /></div>
            <h3>Nog geen artikelen in de kennisbank</h3>
            <p>Zodra je voorstellen goedkeurt in de review-queue verschijnen ze hier — mét de bronmails en de redenering erachter.</p>
            <div className="knb-empty__actions">
              <button className="btn btn-primary" onClick={() => navigate('/kennisbank/review')}>
                <Lc d={I.check} w={14} />{pendingCount} voorstellen beoordelen
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="knb-search">
              <Lc d={I.search} />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Zoek in de kennisbank — bv. ‘factuuradres wijzigen’, ‘inloggen lukt niet’…" />
              {query && <span className="knb-search__kbd">{filtered.length}/{visible.length}</span>}
            </div>

            {/* Categorie-chips — zelfde patroon als de review-queue */}
            <div className="rev-cats knb-cats">
              <button className={`rq-chip ${activeCat === 'all' && !needsOnly ? 'active' : ''}`} onClick={() => { setActiveCat('all'); setNeedsOnly(false) }}>Alle <span className="cnt">{visible.length}</span></button>
              {categories.filter(c => catCount[c.id]).map(c => (
                <button key={c.id} className={`rq-chip ${activeCat === c.id ? 'active' : ''}`} onClick={() => { setActiveCat(activeCat === c.id ? 'all' : c.id); setNeedsOnly(false) }}>
                  <span className={`swatch ${catClass(c.id)}`} />{c.label} <span className="cnt">{catCount[c.id]}</span>
                </button>
              ))}
              {needsCount > 0 && (
                <button className={`rq-chip knb-chip-needs ${needsOnly ? 'active' : ''}`} onClick={() => { setNeedsOnly(o => !o); setActiveCat('all') }}>
                  <Lc d={I.alert} w={12} />Needs-review <span className="cnt">{needsCount}</span>
                </button>
              )}
              {addingCat ? (
                <div className="knb-addcat knb-addcat--inline">
                  <input value={newCatLabel} autoFocus onChange={e => setNewCatLabel(e.target.value)}
                    placeholder="Naam — bv. ‘Rapportages’" maxLength={60}
                    onKeyDown={e => { if (e.key === 'Enter') addCategory(); if (e.key === 'Escape') setAddingCat(false) }} />
                  <input value={newCatDesc} onChange={e => setNewCatDesc(e.target.value)}
                    placeholder="Korte omschrijving (optioneel)" maxLength={160}
                    onKeyDown={e => { if (e.key === 'Enter') addCategory(); if (e.key === 'Escape') setAddingCat(false) }} />
                  <button className="btn btn-sm btn-primary" disabled={catBusy || newCatLabel.trim().length < 3} onClick={addCategory}>{catBusy ? 'Bezig…' : 'Toevoegen'}</button>
                  <button className="btn btn-sm" disabled={catBusy} onClick={() => { setAddingCat(false); setNewCatLabel(''); setNewCatDesc('') }}>Annuleren</button>
                </div>
              ) : (
                <button className="rq-chip knb-chip-add" onClick={() => setAddingCat(true)} title="Nieuwe categorie toevoegen"><Lc d={I.plus} w={12} />Categorie</button>
              )}
            </div>

            {filtered.length === 0 ? (
              <div className="knb-empty">
                <div className="knb-empty__art" style={{ background: 'linear-gradient(180deg,var(--paper-3),#eceae3)', color: 'var(--neutral-400)', boxShadow: 'none' }}><Lc d={I.search} /></div>
                <h3>Geen artikelen gevonden</h3>
                <p>Pas je zoekopdracht of categorie aan om de volledige kennisbank te zien.</p>
                <div className="knb-empty__actions"><button className="btn btn-primary" onClick={() => { setActiveCat('all'); setNeedsOnly(false); setQuery('') }}>Wis filters</button></div>
              </div>
            ) : (
              <div className="knb-cards">
                {filtered.map(a => {
                  const nr = isNeedsReview(a)
                  const overdue = a.review_due_at && new Date(a.review_due_at) < new Date()
                  return (
                    <Link key={a.id} to={`/kennisbank/artikel/${a.id}`} className={`knb-card ${nr ? 'is-flagged' : ''}`}>
                      <div className="knb-card__top">
                        <span className={`cat-chip ${catClass(a.kb_category)}`}><span className="cat-chip__dot" />{catLabel(a.kb_category, categories.find(c => c.id === a.kb_category)?.label)}</span>
                        {nr && <span className="st-pill st-needs"><span className="pdot" />Needs-review</span>}
                      </div>
                      <div className="knb-card__body">
                        <h3 className="knb-card__title">{a.title}</h3>
                        {a.summary && <p className="knb-card__summary">{a.summary}</p>}
                      </div>
                      <div className="knb-card__foot">
                        <div className="knb-card__foot-l">
                          {overdue
                            ? <span className="knb-card__verified flag"><Lc d={I.clock} />Review verlopen</span>
                            : <span className="knb-card__verified"><Lc d={I.check} />Geverifieerd {fmtDate(a.last_verified_at)}</span>}
                        </div>
                      </div>
                    </Link>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* Documentenbibliotheek — inklapbaar, uit de hoofdflow */}
        <div className="knb-later">
          <button className={`knb-later__head ${docsOpen ? 'is-open' : ''}`} onClick={() => setDocsOpen(o => !o)}>
            <Lc d={I.paperclip} w={15} />Documentenbibliotheek
            <span className="knb-later__chev"><Lc d={I.chevron} w={15} /></span>
          </button>
          {docsOpen && <div style={{ marginTop: 14 }}><KbDocuments variant="library" /></div>}
        </div>
      </div>
    </div>
  )
}
