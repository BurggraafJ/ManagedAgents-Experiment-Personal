import { useParams, useNavigate } from 'react-router-dom'
import { useKbArticle } from '../../../hooks/useKbArticle'
import { showToast } from '../../Toast'
import KbProvenance from './KbProvenance'
import { kbMarkdownToHtml } from './kbMarkdown'
import {
  audClass, AUD_LABEL, catClass, catLabel, confInfo, fmtDate,
  initials, isNeedsReview, statusPill, TYPE_LABEL,
} from './kbMeta'
import './kennisbank-maestro.css'

function Lc({ d, w }) {
  return <svg className="lc" viewBox="0 0 24 24" width={w} height={w}>{d.map((p, i) => <path key={i} d={p} />)}</svg>
}
const I = {
  back: ['m15 18-6-6 6-6'],
  edit: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
  revise: ['M3 12a9 9 0 0 1 15.4-6.4L21 8', 'M21 3v5h-5'],
  archive: ['M5 7v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7M10 11h4'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
  clock: ['M12 7v5l3 2'],
}

function Shell({ children }) {
  return <div className="theme-maestro knb-maestro"><div className="knb-inner">{children}</div></div>
}

export default function KbArticleView({ profile }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const { article, category, sources, extras, provenance, loading, notFound, error } = useKbArticle(id)

  const back = () => navigate('/kennisbank')
  const soon = (wat) => showToast({ kind: 'info', message: `${wat} komt in een volgende fase`, detail: 'De artikel-acties worden in een vervolgsessie bedraad.' })

  if (loading) return <Shell><p className="knb-state">Artikel laden…</p></Shell>
  if (error) return <Shell><p className="knb-state knb-state--err">Kon artikel niet laden: {error}</p></Shell>
  if (notFound || !article) {
    return (
      <Shell>
        <button className="art-back" onClick={back}><Lc d={I.back} />Terug naar kennisbank</button>
        <p className="knb-state">Dit artikel bestaat niet (meer).</p>
      </Shell>
    )
  }

  const cls = catClass(article.kb_category)
  const cLabel = catLabel(article.kb_category, category?.label)
  const typeLabel = TYPE_LABEL[article.article_type] || article.article_type
  const aud = article.audience || 'intern'
  const sp = statusPill(article)
  const conf = confInfo(article.confidence)
  const overdue = article.review_due_at && new Date(article.review_due_at) < new Date()
  const ownerName = profile?.display_name || 'Legal Mind'

  return (
    <div className="theme-maestro knb-maestro">
      <div className="knb-inner">
        <button className="art-back" onClick={back}><Lc d={I.back} />Terug naar kennisbank</button>

        <div className="art-grid">
          {/* MAIN COLUMN */}
          <div>
            <div className="art-hero">
              <div className="art-hero__chips">
                <span className={`cat-chip ${cls}`}><span className="cat-chip__dot" />{cLabel}</span>
                {typeLabel && <span className="type-tag"><Lc d={I.shield} />{typeLabel}</span>}
                <span className={`aud-tag ${audClass(aud)}`}><span className="dot" />{AUD_LABEL[aud] || aud}</span>
                <span className={`st-pill ${sp.cls}`}><span className="pdot" />{sp.label}</span>
              </div>
              <div className="art-hero__bar">
                <h1>{article.title}</h1>
                <div className="art-hero__actions">
                  <button className="btn btn-primary" onClick={() => soon('Bewerken')}><Lc d={I.edit} w={14} />Bewerken</button>
                  <button className="btn btn-blue" onClick={() => soon('Herzien')}><Lc d={I.revise} w={14} />Herzien</button>
                  <button className="btn btn-icon" title="Archiveren" onClick={() => soon('Archiveren')}><Lc d={I.archive} w={14} /></button>
                </div>
              </div>
            </div>

            <article className="art-body" dangerouslySetInnerHTML={{ __html: kbMarkdownToHtml(article.body) }} />

            <KbProvenance article={article} sources={sources} extras={extras} provenance={provenance} />
          </div>

          {/* METADATA RAIL */}
          <aside className="art-rail">
            <div className="meta-card">
              <div className="meta-card__head"><h3>Eigenschappen</h3></div>
              <div className="meta-list">
                <div className="meta-row"><span className="meta-row__k">Categorie</span><span className="meta-row__v"><span className={`cat-chip ${cls}`}><span className="cat-chip__dot" />{cLabel}</span></span></div>
                {typeLabel && <div className="meta-row"><span className="meta-row__k">Type</span><span className="meta-row__v">{typeLabel}</span></div>}
                <div className="meta-row"><span className="meta-row__k">Doelgroep</span><span className="meta-row__v"><span className={`aud-tag ${audClass(aud)}`}><span className="dot" />{AUD_LABEL[aud] || aud}</span></span></div>
                <div className="meta-row"><span className="meta-row__k">Status</span><span className="meta-row__v"><span className={`st-pill ${sp.cls}`}><span className="pdot" />{sp.label}</span></span></div>
                {conf && (
                  <div className="meta-row"><span className="meta-row__k">Confidence</span><span className="meta-row__v">
                    <span className="conf"><span className={`conf__bar ${conf.bucket === 'mid' ? 'mid' : conf.bucket === 'low' ? 'low' : ''}`}><i style={{ width: `${conf.pct}%` }} /></span><span className="conf__val">{conf.pct}%</span></span>
                  </span></div>
                )}
              </div>
            </div>

            <div className="meta-card">
              <div className="meta-card__head"><h3>Levenscyclus</h3></div>
              <div className="meta-list">
                <div className="meta-row"><span className="meta-row__k">Laatst geverifieerd</span><span className="meta-row__v mono">{fmtDate(article.last_verified_at)}</span></div>
                <div className="meta-row"><span className="meta-row__k">Review-datum</span>
                  {overdue
                    ? <span className="meta-row__v mono flag"><Lc d={I.clock} w={13} />verlopen</span>
                    : <span className="meta-row__v mono">{fmtDate(article.review_due_at)}</span>}
                </div>
                <div className="meta-row"><span className="meta-row__k">Versie</span><span className="meta-row__v mono">v{article.version ?? 1}</span></div>
                <div className="meta-row"><span className="meta-row__k">Aangemaakt</span><span className="meta-row__v mono">{fmtDate(article.created_at)}</span></div>
              </div>
              <div className="meta-owner">
                <div className="meta-owner__av">{initials(ownerName)}</div>
                <div className="meta-owner__info">
                  <div className="meta-owner__name">{ownerName}</div>
                  <div className="meta-owner__role">eigenaar · customer success</div>
                </div>
              </div>
            </div>

            {isNeedsReview(article) && article.needs_review_reason && (
              <div className="meta-card"><div className="meta-note">⚠ <b>Review nodig:</b> {article.needs_review_reason}</div></div>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
