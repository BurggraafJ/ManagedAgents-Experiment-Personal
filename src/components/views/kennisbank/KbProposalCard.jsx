import { useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { showToast } from '../../Toast'
import KbProvenance from './KbProvenance'
import { useKbSources } from '../../../hooks/useKbSources'
import { kbMarkdownToHtml } from './kbMarkdown'
import { audBucket, catClass, catLabel, confInfo, fmtDate } from './kbMeta'

function Lc({ d, w }) {
  return <svg className="lc" viewBox="0 0 24 24" width={w} height={w}>{d.map((p, i) => <path key={i} d={p} />)}</svg>
}
const I = {
  check: ['M20 6 9 17l-5-5'],
  alert: ['M12 9v4M12 17h.01'],
  edit: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
  x: ['M18 6 6 18M6 6l12 12'],
  clock: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', 'M12 8v4l2.5 1.5'],
  undo: ['M3 7v6h6', 'M3 13a9 9 0 1 0 3-7.7L3 8'],
  spark: ['M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8'],
  swap: ['m16 3 4 4-4 4', 'M20 7H4', 'm8 21-4-4 4-4', 'M4 17h16'],
  qa: ['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9v4M12 17h.01'],
}
const ADJUST_SUG = ['Korter & bondiger', 'Formelere toon', 'Voeg een concrete stap toe']

/**
 * KbProposalCard — detailpaneel van de review-queue (rechterkolom). Toont één
 * voorstel: meta, titel, samenvatting, tabs (Voorgesteld artikel / Onderbouwing)
 * en de acties. Wired op de bestaande approve/amend/reject/defer-RPC's.
 */
export default function KbProposalCard({ proposal: p, categoryLabel, onDone, deferred = false }) {
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState('idle') // idle | adjust
  const [tab, setTab] = useState('artikel') // artikel | why
  const [amendText, setAmendText] = useState('')

  const why = tab === 'why'
  const { sources, extras, loading } = useKbSources(p.source_signal_ids, p.source_mail_ids, why)
  const answered = p?.evidence?.answered === true
  const bronvragen = p?.evidence?.vragen ?? (p?.source_signal_ids?.length || 1)
  const nMails = (Array.isArray(p.source_mail_ids) && p.source_mail_ids.length) || bronvragen
  const conf = confInfo(p.confidence)
  const qaPoints = p.needs_review && p.qa_notes ? p.qa_notes.split(/\s+·\s+/).map(s => s.trim()).filter(Boolean) : []
  const waiting = p.status === 'amended' // aanpassing gevraagd, AI moet nog herschrijven

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
  const approve = () => run('approve_kb_article_proposal', { p_proposal_id: p.id }, 'Goedgekeurd & gepubliceerd ✓')
  const moveTo = audBucket(p.audience) === 'intern' ? 'klant' : 'intern'
  const moveAudience = () => run('set_kb_proposal_audience', { p_proposal_id: p.id, p_audience: moveTo }, `Verplaatst naar ${moveTo === 'intern' ? 'Intern' : 'Klant'}`)
  const amend = () => run('amend_kb_article_proposal', { p_proposal_id: p.id, p_amendment: amendText.trim() }, 'Aanpassing genoteerd — wordt herschreven')
  const reject = () => run('reject_kb_article_proposal', { p_proposal_id: p.id, p_reason: null }, 'Voorstel afgewezen')
  const setLater = (later) => run('defer_kb_article_proposal', { p_proposal_id: p.id, p_later: later }, later ? 'Naar “later reviewen” verplaatst' : 'Terug in de queue')

  return (
    <div className="rev-detail__inner">
      <div className="rev-detail__scroll">
        <div className="rev-detail__meta">
          <span className={`cat-chip ${catClass(p.kb_category)}`}><span className="cat-chip__dot" />{categoryLabel || catLabel(p.kb_category)}</span>
          <span className={`ans-badge ${answered ? 'ans-found' : 'ans-confirm'}`}>
            <Lc d={answered ? I.check : I.alert} />{answered ? 'Antwoord gevonden' : 'Te bevestigen'}
          </span>
          {conf && <span className="conf"><span className={`conf__bar ${conf.bucket === 'mid' ? 'mid' : conf.bucket === 'low' ? 'low' : ''}`}><i style={{ width: `${conf.pct}%` }} /></span><span className="conf__val">{conf.pct}%</span></span>}
          <button type="button" className="rev-move" disabled={busy} onClick={moveAudience} title={`Verplaats naar de ${moveTo === 'intern' ? 'Intern' : 'Klant'}-kennisbank`}>
            <Lc d={I.swap} />Naar {moveTo === 'intern' ? 'intern' : 'klant'}
          </button>
        </div>

        <h2 className="rev-detail__title">{p.title}</h2>
        {p.proposed_summary && <p className="rev-detail__summary">{p.proposed_summary}</p>}

        {waiting && (
          <div className="rev-wait">
            <div className="rev-wait__head"><Lc d={I.clock} />Wacht op AI — dit voorstel wordt herschreven</div>
            {p.amendment && <p className="rev-wait__instr">Jouw instructie: “{p.amendment}”</p>}
          </div>
        )}

        {!waiting && p.needs_review && (
          <div className="rev-qa">
            <div className="rev-qa__head"><Lc d={I.qa} />De AI markeerde dit concept zelf voor controle</div>
            {qaPoints.length > 0 && (
              <ul className="rev-qa__list">{qaPoints.map((pt, i) => <li key={i}>{pt}</li>)}</ul>
            )}
            {(p.drafted_model || p.restyled_at) && (
              <div className="rev-qa__foot">AI-zelfcontrole{p.drafted_model ? ` · ${p.drafted_model}` : ''}{p.restyled_at ? ` · herschreven ${fmtDate(p.restyled_at)}` : ''}</div>
            )}
          </div>
        )}

        <div className="rev-tabs" role="tablist">
          <button role="tab" aria-selected={!why} className={`rev-tab ${!why ? 'is-active' : ''}`} onClick={() => setTab('artikel')}>Voorgesteld artikel</button>
          <button role="tab" aria-selected={why} className={`rev-tab ${why ? 'is-active' : ''}`} onClick={() => setTab('why')}>Onderbouwing · {nMails} mail{nMails === 1 ? '' : 's'}</button>
        </div>

        {why ? (
          <KbProvenance mode="proposal" defaultOpen
            article={{ source_mail_ids: p.source_mail_ids, kb_category: p.kb_category, article_type: p.article_type, confidence: p.confidence }}
            provenance={{ confidence: p.confidence, rationale: p.rationale }}
            sources={sources} extras={extras} loadingSources={loading} />
        ) : (
          <article className="art-body rev-detail__body" dangerouslySetInnerHTML={{ __html: kbMarkdownToHtml(p.proposed_body) }} />
        )}

        {mode === 'adjust' && (
          <div className="rq-editor adjust" style={{ background: 'transparent', borderTop: 'none', padding: '4px 0 0' }}>
            <div className="rq-editor__inner" style={{ paddingTop: 8 }}>
              <div className="rq-editor__lbl adjust"><Lc d={I.spark} />Geef de AI een instructie — die herschrijft het artikel</div>
              <textarea value={amendText} autoFocus onChange={e => setAmendText(e.target.value)}
                placeholder="Bv. ‘Voeg een stap toe over het wijzigen van het e-mailadres’ of ‘Maak het korter en formeler’…" />
              <div className="rq-editor__chips">
                {ADJUST_SUG.map(s => <button key={s} type="button" className="rq-editor__sug" onClick={() => setAmendText(s)}>{s}</button>)}
              </div>
              <div className="rq-editor__foot">
                <button className="btn" disabled={busy} onClick={() => { setMode('idle'); setAmendText('') }}>Annuleren</button>
                <button className="btn btn-primary" disabled={busy || !amendText.trim()} onClick={amend}>Herschrijf met AI</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="rev-detail__actions">
        <button className="rq-btn rq-btn--approve" disabled={busy || waiting} title={waiting ? 'Beschikbaar zodra de AI het voorstel heeft herschreven' : undefined} onClick={approve}><Lc d={I.check} />Goedkeuren</button>
        <button className={`rq-btn rq-btn--adjust ${mode === 'adjust' ? 'is-active' : ''}`} disabled={busy || waiting} onClick={() => setMode(mode === 'adjust' ? 'idle' : 'adjust')}><Lc d={I.edit} />Aanpassen</button>
        <button className="rq-btn rq-btn--reject" disabled={busy} onClick={reject}><Lc d={I.x} />Afwijzen</button>
        {deferred
          ? <button className="rq-btn rq-btn--later" disabled={busy} onClick={() => setLater(false)}><Lc d={I.undo} />Terughalen</button>
          : <button className="rq-btn rq-btn--later" disabled={busy || waiting} onClick={() => setLater(true)}><Lc d={I.clock} />Later</button>}
      </div>
    </div>
  )
}
