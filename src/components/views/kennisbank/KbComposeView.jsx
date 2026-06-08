import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { useKbCompose } from '../../../hooks/useKbCompose'
import { useKbAudience } from '../../../hooks/useKbAudience'
import { showToast } from '../../Toast'
import KbVariantCard from './KbVariantCard'
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
}
const TYPES = ['how_to', 'beleid', 'referentie', 'troubleshooting', 'faq', 'besluit_rationale']

export default function KbComposeView() {
  const navigate = useNavigate()
  const [aud, setAud] = useKbAudience()
  const { generate, publish, reset, loading, publishing, error, result } = useKbCompose()

  const [description, setDescription] = useState('')
  const [kbCategory, setKbCategory] = useState('')
  const [articleType, setArticleType] = useState('')
  const [useContext, setUseContext] = useState(true)
  const [categories, setCategories] = useState([])
  const [selectedKey, setSelectedKey] = useState(null)
  const [ctxOpen, setCtxOpen] = useState(false)

  useEffect(() => {
    supabase.from('kb_categories').select('id,label,sort_order').order('sort_order', { ascending: true })
      .then(({ data }) => setCategories(data || []))
  }, [])

  const audLabel = aud === 'intern' ? 'Intern' : 'Klant'
  const canGenerate = description.trim().length >= 10 && !loading
  const variants = result?.variants || []
  const context = result?.context || null
  const selected = variants.find(v => v.key === selectedKey) || null

  async function onGenerate() {
    setSelectedKey(null)
    const r = await generate({ description: description.trim(), audience: aud, kbCategory, articleType, useContext })
    if (!r.ok) showToast({ kind: 'error', message: 'Genereren mislukt', detail: r.error })
    else if ((r.data?.variants || []).length) setSelectedKey(r.data.variants[0].key)
  }

  async function onPublish(status) {
    if (!selected) return
    const r = await publish({ variant: selected, description: description.trim(), audience: aud, kbCategory, articleType, status, context })
    if (!r.ok) { showToast({ kind: 'error', message: 'Publiceren mislukt', detail: r.error }); return }
    showToast({ kind: 'success', message: status === 'concept' ? 'Opgeslagen als concept' : 'Gepubliceerd in de kennisbank ✓' })
    if (r.articleId) navigate(`/kennisbank/artikel/${r.articleId}`)
    else navigate('/kennisbank')
  }

  const inStep2 = variants.length > 0

  return (
    <div className="theme-maestro knb-maestro">
      <div className="knb-inner kbc">
        <button className="art-back" onClick={() => navigate('/kennisbank')}><Lc d={I.back} />Terug naar kennisbank</button>

        <div className="kbc-head">
          <div className="kbc-head__eyebrow"><Lc d={I.spark} w={15} />AI-aanmaak · {audLabel}</div>
          <h1>Nieuw kennisbank-artikel</h1>
          <p className="kbc-head__sub">Beschrijf waar het artikel over moet gaan. De AI zoekt context in de kennisbank &amp; mailhistorie en schrijft <b>twee versies</b> — kies de beste en publiceer.</p>
        </div>

        {/* STAP 1 — BRIEF */}
        <div className="kbc-brief">
          <div className="kbc-seg" role="tablist" aria-label="Kennisbank">
            <button className={aud === 'intern' ? 'is-active' : ''} onClick={() => setAud('intern')}>Intern</button>
            <button className={aud === 'klant' ? 'is-active' : ''} onClick={() => setAud('klant')}>Klant</button>
          </div>

          <label className="kbc-label" htmlFor="kbc-desc">Beschrijving</label>
          <textarea id="kbc-desc" className="kbc-textarea" value={description} autoFocus
            onChange={e => setDescription(e.target.value)}
            placeholder="Bv. ‘Hoe wijzigt een klant het factuuradres? Beschrijf de stappen en wie ze moeten mailen.’ — of plak een korte notitie waar de AI een net artikel van maakt." />

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

          <div className="kbc-brief__foot">
            <button className="btn btn-primary kbc-gen" disabled={!canGenerate} onClick={onGenerate}>
              <Lc d={I.spark} w={14} />{loading ? 'De AI schrijft twee versies…' : inStep2 ? 'Opnieuw genereren' : 'Genereer 2 versies'}
            </button>
            {description.trim().length > 0 && description.trim().length < 10 && <span className="kbc-warn">Geef iets meer beschrijving.</span>}
          </div>
        </div>

        {error && !loading && <p className="knb-state knb-state--err">{error}</p>}

        {loading && (
          <div className="kbc-loading">
            <div className="kbc-loading__spin" />
            <p>Context zoeken &amp; twee versies schrijven… dit duurt ~10–25 seconden.</p>
          </div>
        )}

        {/* STAP 2 — KIES */}
        {inStep2 && !loading && (
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

            <div className="kbc-pick-hint">Kies de versie die je het beste bevalt:</div>
            <div className="kbc-variants">
              {variants.map((v, i) => (
                <KbVariantCard key={v.key} variant={v} index={i} selected={selectedKey === v.key} onSelect={() => setSelectedKey(v.key)} />
              ))}
            </div>

            <div className="kbc-actions">
              <button className="btn btn-primary" disabled={!selected || publishing} onClick={() => onPublish('gevalideerd')}>
                <Lc d={I.check} w={14} />{publishing ? 'Bezig…' : 'Publiceren'}
              </button>
              <button className="btn" disabled={!selected || publishing} onClick={() => onPublish('concept')}>
                <Lc d={I.doc} w={14} />Opslaan als concept
              </button>
              <button className="btn btn-ghost" disabled={publishing} onClick={onGenerate}>
                <Lc d={I.redo} w={14} />Opnieuw genereren
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
