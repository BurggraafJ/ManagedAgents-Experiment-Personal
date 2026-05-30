import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useKbArticles } from '../../../hooks/useKbArticles'
import { useKbAudience } from '../../../hooks/useKbAudience'
import KbAudienceSwitch from './KbAudienceSwitch'
import { audBucket, catClass, catLabel, fmtDate, isNeedsReview, TYPE_LABEL } from './kbMeta'
import './kennisbank-maestro.css'

function Lc({ d, w }) {
  return <svg className="lc" viewBox="0 0 24 24" width={w} height={w}>{d.map((p, i) => <path key={i} d={p} />)}</svg>
}
const I = {
  book: ['M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z', 'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z'],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'm21 21-4.3-4.3'],
  check: ['M20 6 9 17l-5-5'],
  arrow: ['m9 18 6-6-6-6'],
  alert: ['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9v4M12 17h.01'],
  x: ['M18 6 6 18M6 6l12 12'],
  clock: ['M12 7v5l3 2'],
  sort: ['M11 5h10M11 9h7M11 13h4M3 17l3 3 3-3M6 18V4'],
  grid: ['M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'],
  list: ['M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'],
  filter: ['M22 3H2l8 9.46V19l4 2v-8.54L22 3z'],
}

const TYPES = ['how_to', 'beleid', 'referentie', 'troubleshooting', 'faq', 'besluit_rationale']
const empty = () => ({ cat: new Set(), type: new Set(), status: new Set() })

export default function KennisbankView() {
  const navigate = useNavigate()
  const { articles, categories, pendingCount, loading, error } = useKbArticles()
  const [aud] = useKbAudience()
  const [facets, setFacets] = useState(empty)
  const [query, setQuery] = useState('')
  const [view, setView] = useState('grid')
  const [filtersOpen, setFiltersOpen] = useState(true)

  const audLabel = aud === 'intern' ? 'Intern' : 'Klant'
  // Eerst filteren op de gekozen kennisbank (intern vs klant), dan op facetten.
  const inBucket = useMemo(() => articles.filter(a => audBucket(a.audience) === aud), [articles, aud])
  const needsCount = useMemo(() => inBucket.filter(isNeedsReview).length, [inBucket])
  const catCount = useMemo(() => {
    const m = {}; for (const a of inBucket) m[a.kb_category] = (m[a.kb_category] || 0) + 1; return m
  }, [inBucket])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return inBucket.filter(a => {
      if (facets.cat.size && !facets.cat.has(a.kb_category)) return false
      if (facets.type.size && !facets.type.has(a.article_type)) return false
      if (facets.status.size) {
        const nr = isNeedsReview(a)
        if (facets.status.has('needs') && !nr) return false
        if (facets.status.has('published') && nr) return false
      }
      if (q && !(`${a.title} ${a.summary || ''}`.toLowerCase().includes(q))) return false
      return true
    })
  }, [inBucket, facets, query])

  const toggle = (group, val) => setFacets(f => {
    const next = { ...f, [group]: new Set(f[group]) }
    next[group].has(val) ? next[group].delete(val) : next[group].add(val)
    return next
  })
  const activeChips = []
  for (const g of ['cat', 'type', 'status']) for (const v of facets[g]) activeChips.push({ g, v })
  const chipLabel = (g, v) => g === 'cat' ? catLabel(v, categories.find(c => c.id === v)?.label)
    : g === 'type' ? (TYPE_LABEL[v] || v) : (v === 'needs' ? 'Needs-review' : 'Gepubliceerd')

  if (error) {
    return (
      <div className="theme-maestro knb-maestro"><div className="knb-inner">
        <div className="knb-topbar"><KbAudienceSwitch /></div>
        <p className="knb-state knb-state--err">Kon de kennisbank niet laden: {error}</p>
      </div></div>
    )
  }

  return (
    <div className="theme-maestro knb-maestro">
      <div className="knb-inner">

        <div className="knb-topbar"><KbAudienceSwitch /></div>

        <div className="knb-head">
          <div>
            <div className="knb-head__eyebrow"><Lc d={I.book} />Kennisbank · {audLabel}</div>
            <h1>Kennisbank</h1>
            <p className="knb-head__sub">Antwoorden die we al gaven, gedestilleerd uit twee jaar mailhistorie. Elk artikel laat zien op basis van wélke mails het gemaakt is.</p>
          </div>
          <div className="knb-head__stats">
            <div className="knb-stat"><div className="knb-stat__num">{inBucket.length}</div><div className="knb-stat__lbl">gepubliceerd</div></div>
            {needsCount > 0 && (
              <button className="knb-stat is-flag" onClick={() => setFacets({ ...empty(), status: new Set(['needs']) })}>
                <div className="knb-stat__num">{needsCount} <Lc d={I.alert} /></div><div className="knb-stat__lbl">needs-review</div>
              </button>
            )}
            <Link className="knb-stat is-link" to="/kennisbank/review">
              <div className="knb-stat__num">{pendingCount} <Lc d={I.arrow} /></div><div className="knb-stat__lbl">voorstellen open</div>
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="knb-skel">{[0, 1, 2, 3].map(i => <div key={i} className="knb-skel-card skel-bg" />)}</div>
        ) : inBucket.length === 0 ? (
          <div className="knb-empty">
            <div className="knb-empty__art"><Lc d={I.book} /></div>
            <h3>Nog geen artikelen in de {audLabel}-kennisbank</h3>
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
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Zoek in de kennisbank — bv. ‘factuuradres wijzigen’, ‘opzegtermijn’, ‘DPA’…" />
              <span className="knb-search__kbd">{filtered.length}/{inBucket.length}</span>
            </div>

            <div className={`knb-layout ${filtersOpen ? '' : 'is-collapsed'}`}>
              <aside className="knb-facets">
                <Facet title="Categorie" onClear={facets.cat.size ? () => setFacets(f => ({ ...f, cat: new Set() })) : null}>
                  {categories.filter(c => catCount[c.id]).map(c => (
                    <FacetOpt key={c.id} active={facets.cat.has(c.id)} onClick={() => toggle('cat', c.id)}
                      lead={<span className={`knb-facet__swatch ${catClass(c.id)}`} />} label={c.label} count={catCount[c.id]} />
                  ))}
                </Facet>
                <Facet title="Type">
                  {TYPES.filter(t => inBucket.some(x => x.article_type === t)).map(t => (
                    <FacetOpt key={t} active={facets.type.has(t)} onClick={() => toggle('type', t)}
                      lead={<span className="knb-facet__check"><Lc d={I.check} /></span>} label={TYPE_LABEL[t]}
                      count={inBucket.filter(x => x.article_type === t).length} />
                  ))}
                </Facet>
              </aside>

              <div className="knb-results">
                <div className="knb-results__bar">
                  <div className="knb-results__count"><b>{filtered.length}</b> van {inBucket.length} artikelen · {audLabel}</div>
                  <div className="knb-results__tools">
                    <button className={`knb-filtertoggle ${filtersOpen ? 'is-open' : ''}`} onClick={() => setFiltersOpen(o => !o)}
                      title={filtersOpen ? 'Filters verbergen' : 'Filters tonen'}>
                      <Lc d={I.filter} />Filters{activeChips.length > 0 && <span className="knb-filtertoggle__n">{activeChips.length}</span>}
                    </button>
                    <span className="knb-sort"><Lc d={I.sort} />Laatst geverifieerd</span>
                    <div className="knb-viewtoggle">
                      <button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} title="Raster"><Lc d={I.grid} /></button>
                      <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} title="Lijst"><Lc d={I.list} /></button>
                    </div>
                  </div>
                </div>

                {activeChips.length > 0 && (
                  <div className="knb-active">
                    {activeChips.map(({ g, v }) => (
                      <span key={`${g}:${v}`} className="knb-active__chip">{chipLabel(g, v)}
                        <button onClick={() => toggle(g, v)} title="Verwijder"><Lc d={I.x} /></button>
                      </span>
                    ))}
                  </div>
                )}

                {filtered.length === 0 ? (
                  <div className="knb-empty">
                    <div className="knb-empty__art" style={{ background: 'linear-gradient(180deg,var(--paper-3),#eceae3)', color: 'var(--neutral-400)', boxShadow: 'none' }}><Lc d={I.search} /></div>
                    <h3>Geen artikelen met deze filters</h3>
                    <p>Pas je filters aan of wis ze om de volledige {audLabel}-kennisbank te zien.</p>
                    <div className="knb-empty__actions"><button className="btn btn-primary" onClick={() => { setFacets(empty()); setQuery('') }}>Wis alle filters</button></div>
                  </div>
                ) : (
                  <div className={`knb-cards ${view === 'list' ? 'is-list' : ''}`}>
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
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Facet({ title, onClear, children }) {
  return (
    <div className="knb-facet">
      <div className="knb-facet__title">{title}{onClear && <button className="knb-facet__clear" onClick={onClear}>wis</button>}</div>
      <div className="knb-facet__list">{children}</div>
    </div>
  )
}
function FacetOpt({ active, onClick, lead, label, count }) {
  return (
    <button className={`knb-facet__opt ${active ? 'active' : ''}`} onClick={onClick}>
      {lead}<span className="knb-facet__lbl">{label}</span><span className="knb-facet__cnt">{count}</span>
    </button>
  )
}
