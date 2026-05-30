import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { showToast } from '../../Toast'
import KbProvenance from './KbProvenance'
import { useKbSources } from '../../../hooks/useKbSources'
import { kbMarkdownToHtml } from './kbMarkdown'
import { catClass, catLabel, confInfo } from './kbMeta'

function Lc({ d, w }) {
  return <svg className="lc" viewBox="0 0 24 24" width={w} height={w}>{d.map((p, i) => <path key={i} d={p} />)}</svg>
}
const I = {
  check: ['M20 6 9 17l-5-5'],
  edit: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
  x: ['M18 6 6 18M6 6l12 12'],
  book: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z'],
  chev: ['m6 9 6 6 6-6'],
  spark: ['M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8'],
  mail: ['M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h9', 'm22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7'],
  clock: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', 'M12 8v4l2.5 1.5'],
  undo: ['M3 7v6h6', 'M3 13a9 9 0 1 0 3-7.7L3 8'],
}
const ADJUST_SUG = ['Korter & bondiger', 'Formelere toon', 'Voeg een concrete stap toe']

export default function KbProposalCard({ proposal: p, categoryLabel, onDone, deferred = false }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState('idle') // idle | adjust
  const [discOpen, setDiscOpen] = useState(false)
  const [provSeen, setProvSeen] = useState(false)
  const [amendText, setAmendText] = useState('')

  const { sources, extras, loading } = useKbSources(p.source_signal_ids, p.source_mail_ids, provSeen || discOpen)
  const answered = p?.evidence?.answered === true
  const bronvragen = p?.evidence?.vragen ?? (p?.source_signal_ids?.length || 1)
  const conf = confInfo(p.confidence)

  async function run(rpc, args, okMsg, after) {
    if (busy) return
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc(rpc, args)
      if (error) throw error
      if (data && data.ok === false) throw new Error(data.reason || 'mislukt')
      showToast(okMsg)
      if (after) after(data)
      else if (onDone) onDone()
    } catch (e) {
      showToast({ kind: 'error', message: 'Mislukt', detail: e?.message || String(e) })
      setBusy(false)
    }
  }
  const approve = () => run('approve_kb_article_proposal', { p_proposal_id: p.id }, 'Goedgekeurd & gepubliceerd ✓',
    (data) => { if (data?.article_id) navigate(`/kennisbank/artikel/${data.article_id}`); else if (onDone) onDone() })
  const amend = () => run('amend_kb_article_proposal', { p_proposal_id: p.id, p_amendment: amendText.trim() }, 'Aanpassing genoteerd — wordt herschreven')
  const reject = () => run('reject_kb_article_proposal', { p_proposal_id: p.id, p_reason: null }, 'Voorstel afgewezen')
  const setLater = (later) => run('defer_kb_article_proposal', { p_proposal_id: p.id, p_later: later }, later ? 'Naar “later reviewen” verplaatst' : 'Terug in de queue')

  return (
    <article className="rq-card">
      <div className="rq-card__main">
        <div className="rq-card__badges">
          <span className={`cat-chip ${catClass(p.kb_category)}`}><span className="cat-chip__dot" />{categoryLabel || catLabel(p.kb_category)}</span>
          <span className={`ans-badge ${answered ? 'ans-found' : 'ans-confirm'}`}>
            <Lc d={answered ? I.check : ['M12 9v4M12 17h.01']} />{answered ? 'Antwoord gevonden' : 'Te bevestigen'}
          </span>
          <span className="spacer" />
          {conf && <span className="conf"><span className={`conf__bar ${conf.bucket === 'mid' ? 'mid' : conf.bucket === 'low' ? 'low' : ''}`}><i style={{ width: `${conf.pct}%` }} /></span><span className="conf__val">{conf.pct}%</span></span>}
          <span className="type-tag" title="aantal bronvragen"><Lc d={I.mail} />{bronvragen} bronvragen</span>
        </div>

        <h2 className="rq-card__title">{p.title}</h2>
        {p.proposed_summary && <p className="rq-card__summary">{p.proposed_summary}</p>}

        <div className={`rq-disc ${discOpen ? 'is-open' : ''}`}>
          <button type="button" className="rq-disc__btn" onClick={() => setDiscOpen(o => !o)}>
            <span className="ic"><Lc d={I.book} /></span>Bekijk voorgesteld artikel
            <span className="chev"><Lc d={I.chev} /></span>
          </button>
          <div className="rq-disc__panel">
            <div className="art-body" style={{ fontSize: '14.5px' }} dangerouslySetInnerHTML={{ __html: kbMarkdownToHtml(p.proposed_body) }} />
          </div>
        </div>

        <KbProvenance
          mode="proposal"
          article={{ source_mail_ids: p.source_mail_ids, kb_category: p.kb_category, article_type: p.article_type, confidence: p.confidence }}
          provenance={{ confidence: p.confidence, rationale: p.rationale }}
          sources={sources} extras={extras} loadingSources={loading}
          onOpen={() => setProvSeen(true)}
        />
      </div>

      {mode === 'idle' && (
        <div className="rq-actions">
          <button className="rq-btn rq-btn--approve" disabled={busy} onClick={approve}><Lc d={I.check} />Goedkeuren</button>
          <button className="rq-btn rq-btn--adjust" disabled={busy} onClick={() => setMode('adjust')}><Lc d={I.edit} />Aanpassen</button>
          <button className="rq-btn rq-btn--reject" disabled={busy} onClick={reject}><Lc d={I.x} />Afwijzen</button>
          {deferred
            ? <button className="rq-btn rq-btn--later" disabled={busy} onClick={() => setLater(false)}><Lc d={I.undo} />Terughalen</button>
            : <button className="rq-btn rq-btn--later" disabled={busy} onClick={() => setLater(true)}><Lc d={I.clock} />Later</button>}
        </div>
      )}

      {mode === 'adjust' && (
        <div className="rq-editor adjust"><div className="rq-editor__inner">
          <div className="rq-editor__lbl adjust"><Lc d={I.spark} />Geef de AI een instructie — die herschrijft het artikel</div>
          <textarea value={amendText} autoFocus onChange={e => setAmendText(e.target.value)}
            placeholder="Bv. ‘Voeg een stap toe over het wijzigen van het e-mailadres’ of ‘Maak het korter en formeler’…" />
          <div className="rq-editor__chips">
            {ADJUST_SUG.map(s => <button key={s} type="button" className="rq-editor__sug" onClick={() => setAmendText(s)}>{s}</button>)}
          </div>
          <div className="rq-editor__foot">
            <span className="hint">AI herschrijft → jij beoordeelt opnieuw</span>
            <button className="btn" disabled={busy} onClick={() => { setMode('idle'); setAmendText('') }}>Annuleren</button>
            <button className="btn btn-primary" disabled={busy || !amendText.trim()} onClick={amend}>Herschrijf met AI</button>
          </div>
        </div></div>
      )}

    </article>
  )
}
