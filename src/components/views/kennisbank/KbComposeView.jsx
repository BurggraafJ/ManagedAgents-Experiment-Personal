import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { useKbCompose } from '../../../hooks/useKbCompose'
import { showToast } from '../../Toast'
import { kbMarkdownToHtml } from './kbMarkdown'
import { TYPE_LABEL } from './kbMeta'
import './kennisbank-maestro.css'
import './kb-compose.css'

function Lc({ d, w = 16 }) {
  return <svg className="lc" viewBox="0 0 24 24" width={w} height={w}>{d.map((p, i) => <path key={i} d={p} />)}</svg>
}
const I = {
  back: ['m15 18-6-6 6-6'],
  spark: ['M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8'],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'm21 21-4.3-4.3'],
  check: ['M20 6 9 17l-5-5'],
  doc: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z'],
  redo: ['M3 12a9 9 0 0 1 15.4-6.4L21 8', 'M21 3v5h-5'],
  chevron: ['m6 9 6 6 6-6'],
  edit: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
  link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
}
const TYPES = ['how_to', 'beleid', 'referentie', 'troubleshooting', 'faq', 'besluit_rationale']

/**
 * KbComposeView — "Nieuw artikel" (Kennisbank 2.0).
 * 1. Jelle geeft titel + beschrijving.
 * 2. Het systeem toont direct welke BESTAANDE artikelen erop lijken.
 * 3. Genereer → één artikel → Publiceren / Bijstellen (instructie) / Opnieuw.
 */
export default function KbComposeView() {
  const navigate = useNavigate()
  const { checkSimilar, generate, publish, loading, publishing, similarLoading, similar, error, result } = useKbCompose()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [kbCategory, setKbCategory] = useState('')
  const [articleType, setArticleType] = useState('')
  const [useContext, setUseContext] = useState(true)
  const [categories, setCategories] = useState([])
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [ctxOpen, setCtxOpen] = useState(false)
  const debounceRef = useRef(null)

  useEffect(() => {
    supabase.from('kb_categories').select('id,label,sort_order').eq('active', true).order('sort_order', { ascending: true })
      .then(({ data }) => setCategories(data || []))
  }, [])

  // Live similar-check: zodra er genoeg getypt is, kijken wat er al bestaat.
  useEffect(() => {
    const brief = `${title} ${description}`.trim()
    if (brief.length < 12) return
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { checkSimilar({ title, description }) }, 700)
    return () => clearTimeout(debounceRef.current)
  }, [title, description, checkSimilar])

  const canGenerate = (title.trim().length + description.trim().length) >= 10 && !loading
  const article = result?.article || null
  const context = result?.context || null

  async function onGenerate({ withInstruction = false } = {}) {
    const r = await generate({
      title: title.trim(), description: description.trim(),
      kbCategory, articleType, useContext,
      instruction: withInstruction ? instruction.trim() : undefined,
      previousBody: withInstruction ? (article?.body || '') : undefined,
    })
    if (!r.ok) showToast({ kind: 'error', message: 'Genereren mislukt', detail: r.error })
    else if (withInstruction) { setAdjustOpen(false); setInstruction(''); showToast('Artikel bijgesteld ✓') }
  }

  async function onPublish(status) {
    if (!article) return
    const r = await publish({ article, description: description.trim(), kbCategory, articleType, status, context })
    if (!r.ok) { showToast({ kind: 'error', message: 'Publiceren mislukt', detail: r.error }); return }
    showToast({ kind: 'success', message: status === 'concept' ? 'Opgeslagen als concept' : 'Gepubliceerd in de kennisbank ✓' })
    if (r.articleId) navigate(`/kennisbank/artikel/${r.articleId}`)
    else navigate('/kennisbank')
  }

  return (
    <div className="theme-maestro knb-maestro">
      <div className="knb-inner kbc">
        <button className="art-back" onClick={() => navigate('/kennisbank')}><Lc d={I.back} />Terug naar kennisbank</button>

        <div className="kbc-head">
          <div className="kbc-head__eyebrow"><Lc d={I.spark} w={15} />AI-aanmaak · klant-artikel</div>
          <h1>Nieuw kennisbank-artikel</h1>
          <p className="kbc-head__sub">Geef een <b>titel</b> en beschrijf wat erin moet. Je ziet meteen welke bestaande artikelen erop lijken — daarna schrijft de AI het artikel en kun je het publiceren of bijstellen.</p>
        </div>

        {/* STAP 1 — BRIEF */}
        <div className="kbc-brief">
          <label className="kbc-label" htmlFor="kbc-title">Titel</label>
          <input id="kbc-title" className="kbc-input" value={title} autoFocus
            onChange={e => setTitle(e.target.value)} maxLength={120}
            placeholder="Bv. ‘Factuuradres wijzigen’ of ‘Wat te doen als inloggen niet lukt’" />

          <label className="kbc-label" htmlFor="kbc-desc">Beschrijving</label>
          <textarea id="kbc-desc" className="kbc-textarea" value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Beschrijf wat het artikel moet behandelen — bv. ‘Stappen om het factuuradres te wijzigen, wie de klant moet mailen en hoe lang het duurt.’" />

          <div className="kbc-row">
            <div className="kbc-field">
              <label className="kbc-label" htmlFor="kbc-cat">Categorie <span className="kbc-opt">optioneel</span></label>
              <select id="kbc-cat" className="kbc-select" value={kbCategory} onChange={e => setKbCategory(e.target.value)}>
                <option value="">— AI kiest —</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div className="kbc-field">
              <label className="kbc-label" htmlFor="kbc-type">Type <span className="kbc-opt">optioneel</span></label>
              <select id="kbc-type" className="kbc-select" value={articleType} onChange={e => setArticleType(e.target.value)}>
                <option value="">— AI kiest —</option>
                {TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
              </select>
            </div>
          </div>

          <label className="kbc-toggle">
            <input type="checkbox" checked={useContext} onChange={e => setUseContext(e.target.checked)} />
            <span className="kbc-toggle__box"><Lc d={I.search} w={13} /></span>
            <span className="kbc-toggle__txt">Zoek context in de kennisbank &amp; mailhistorie ter aanvulling
              <span className="kbc-toggle__sub">De AI gebruikt relevante fragmenten als feitenbasis en verzint geen Legal Mind-specifieke feiten.</span>
            </span>
          </label>

          {/* Lijkt dit op iets dat er al staat? — onderaan de brief, springt niet in het formulier */}
          {(similarLoading || (similar && similar.length > 0)) && (
            <div className="kbc-similar">
              <div className="kbc-similar__head"><Lc d={I.link} w={13} />{similarLoading ? 'Checken wat er al is…' : `Dit staat er al in de kennisbank (${similar.length})`}</div>
              {!similarLoading && (
                <ul className="kbc-similar__list">
                  {similar.map(s => (
                    <li key={s.id}>
                      <Link to={`/kennisbank/artikel/${s.id}`} title="Open het bestaande artikel">{s.title}</Link>
                      <span className="kbc-similar__sim">{Math.round((s.sim || 0) * 100)}% overlap</span>
                      {s.summary && <p>{s.summary}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {similar && similar.length === 0 && !similarLoading && (title.trim().length + description.trim().length) >= 12 && (
            <p className="kbc-similar kbc-similar--none"><Lc d={I.check} w={13} />Niets vergelijkbaars gevonden — dit wordt een nieuw onderwerp.</p>
          )}

          <div className="kbc-brief__foot">
            <button className="btn btn-primary kbc-gen" disabled={!canGenerate} onClick={() => onGenerate()}>
              <Lc d={I.spark} w={14} />{loading ? 'De AI schrijft het artikel…' : article ? 'Opnieuw genereren' : 'Genereer artikel'}
            </button>
            {(title.trim().length + description.trim().length) > 0 && (title.trim().length + description.trim().length) < 10 && <span className="kbc-warn">Geef iets meer beschrijving.</span>}
          </div>
        </div>

        {error && !loading && <p className="knb-state knb-state--err">{error}</p>}

        {loading && (
          <div className="kbc-loading">
            <div className="kbc-loading__spin" />
            <p>Context zoeken &amp; het artikel schrijven… dit duurt ~10–25 seconden.</p>
          </div>
        )}

        {/* STAP 2 — HET ARTIKEL */}
        {article && !loading && (
          <div className="kbc-results">
            {context && (context.used || context.count > 0) && (
              <div className="kbc-ctx">
                <button className="kbc-ctx__head" onClick={() => setCtxOpen(o => !o)}>
                  <Lc d={I.search} w={14} /><b>Context gebruikt</b> · {context.count} fragment{context.count === 1 ? '' : 'en'} gevonden
                  <Lc d={I.chevron} w={15} />
                </button>
                {ctxOpen && (
                  <ul className="kbc-ctx__list">
                    {(context.snippets || []).map((s, i) => (
                      <li key={i}><span className="kbc-ctx__src">{s.source}{s.occurred_at ? ` · ${String(s.occurred_at).slice(0, 10)}` : ''}</span>{s.text}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {context && !context.used && context.count === 0 && (
              <p className="kbc-ctx kbc-ctx--none">Geen context gebruikt{context.error ? ` (${context.error})` : ''} — geschreven puur op je beschrijving.</p>
            )}

            <div className="kbc-article">
              <h2 className="kbc-article__title">{article.title}</h2>
              {article.summary && <p className="kbc-article__summary">{article.summary}</p>}
              <article className="art-body" dangerouslySetInnerHTML={{ __html: kbMarkdownToHtml(article.body || '') }} />
              {Array.isArray(article.te_bevestigen) && article.te_bevestigen.length > 0 && (
                <div className="kbc-confirm">
                  <b>Nog te bevestigen door jou/CS:</b>
                  <ul>{article.te_bevestigen.map((t, i) => <li key={i}>{t}</li>)}</ul>
                </div>
              )}
            </div>

            {adjustOpen && (
              <div className="rq-editor adjust" style={{ background: 'transparent', borderTop: 'none', padding: '4px 0 0' }}>
                <div className="rq-editor__inner" style={{ paddingTop: 8 }}>
                  <div className="rq-editor__lbl adjust"><Lc d={I.spark} />Wat moet er anders? De AI herschrijft het artikel.</div>
                  <textarea value={instruction} autoFocus onChange={e => setInstruction(e.target.value)}
                    placeholder="Bv. ‘Maak het korter’, ‘Voeg een stappenplan toe’, ‘Noem ook optie X’…" />
                  <div className="rq-editor__foot">
                    <button className="btn" disabled={loading} onClick={() => { setAdjustOpen(false); setInstruction('') }}>Annuleren</button>
                    <button className="btn btn-primary" disabled={loading || !instruction.trim()} onClick={() => onGenerate({ withInstruction: true })}>Stel bij met AI</button>
                  </div>
                </div>
              </div>
            )}

            <div className="kbc-actions">
              <button className="btn btn-primary" disabled={publishing || loading} onClick={() => onPublish('gevalideerd')}>
                <Lc d={I.check} w={14} />{publishing ? 'Bezig…' : 'Publiceren'}
              </button>
              <button className="btn" disabled={publishing || loading} onClick={() => setAdjustOpen(o => !o)}>
                <Lc d={I.edit} w={14} />Bijstellen
              </button>
              <button className="btn" disabled={publishing || loading} onClick={() => onPublish('concept')}>
                <Lc d={I.doc} w={14} />Opslaan als concept
              </button>
              <button className="btn btn-ghost" disabled={publishing || loading} onClick={() => onGenerate()}>
                <Lc d={I.redo} w={14} />Opnieuw
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
