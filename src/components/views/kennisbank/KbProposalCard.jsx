import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'
import { showToast } from '../../Toast'
import KbProvenance from './KbProvenance'
import { useKbSources } from '../../../hooks/useKbSources'
import { kbMarkdownToHtml } from './kbMarkdown'
import { catClass, catLabel, fmtDate, impactKey, IMPACT_LABEL } from './kbMeta'

function Lc({ d, w }) {
  return <svg className="lc" viewBox="0 0 24 24" width={w} height={w}>{d.map((p, i) => <path key={i} d={p} />)}</svg>
}
const I = {
  check: ['M20 6 9 17l-5-5'],
  edit: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'],
  x: ['M18 6 6 18M6 6l12 12'],
  clock: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', 'M12 8v4l2.5 1.5'],
  undo: ['M3 7v6h6', 'M3 13a9 9 0 1 0 3-7.7L3 8'],
  spark: ['M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8'],
  qa: ['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9v4M12 17h.01'],
  book: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z'],
  archive: ['M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z', 'M3 4h18v4H3z', 'M10 12h4'],
  pen: ['M12 19l7-7 3 3-7 7-3-3z', 'M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z'],
  link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
}
const NOTE_SUG = ['Houd het kort en praktisch', 'Voeg een stappenplan toe', 'Noem ook hoe het in de app werkt']
const AMEND_SUG = ['Korter & bondiger', 'Formelere toon', 'Voeg een concrete stap toe']

/**
 * KbProposalCard — detailpaneel van de review-queue (Kennisbank 2.0).
 * Drie fasen in één kaart:
 *  - pending  : LICHT voorstel (titel + beschrijving + bronvragen + "lijkt op…")
 *               → "Maak dit artikel" (met optionele aanwijzing) / Afwijzen / Later
 *  - accepted/amended : de AI schrijft — wachtbanner
 *  - written  : het geschreven artikel → Publiceren / Finetunen / Afwijzen
 */
export default function KbProposalCard({ proposal: p, categoryLabel, onDone, deferred = false, parked = false, onRestore }) {
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState('idle')      // idle | note | adjust
  const [tab, setTab] = useState('artikel')     // artikel | why  (alleen bij written)
  const [noteText, setNoteText] = useState('')
  const [amendText, setAmendText] = useState('')

  const isPending = p.status === 'pending'
  const isWaiting = p.status === 'accepted' || p.status === 'amended'
  const isWritten = p.status === 'written'
  const why = tab === 'why'
  // Bij een licht voorstel laden we de bronvragen meteen (dat ís de onderbouwing);
  // bij een geschreven artikel pas wanneer de Onderbouwing-tab opengaat.
  const { sources, extras, loading } = useKbSources(p.source_signal_ids, p.source_mail_ids, isPending || parked || why)
  const imp = impactKey(p)
  const threads = p.distinct_threads
  const qaPoints = p.needs_review && p.qa_notes ? p.qa_notes.split(/\s+·\s+/).map(s => s.trim()).filter(Boolean) : []
  const simArticles = p.similar_info?.articles || []
  const simProposals = p.similar_info?.proposals || []

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
  const accept = () => run('accept_kb_proposal', { p_proposal_id: p.id, p_note: noteText.trim() || null }, 'Akkoord — de AI schrijft het artikel ✓')
  const approve = () => run('approve_kb_article_proposal', { p_proposal_id: p.id }, 'Gepubliceerd in de kennisbank ✓')
  const amend = () => run('amend_kb_article_proposal', { p_proposal_id: p.id, p_amendment: amendText.trim() }, 'Instructie genoteerd — wordt herschreven')
  const reject = () => run('reject_kb_article_proposal', { p_proposal_id: p.id, p_reason: null }, 'Voorstel afgewezen')
  const setLater = (later) => run('defer_kb_article_proposal', { p_proposal_id: p.id, p_later: later }, later ? 'Naar “later” verplaatst' : 'Terug in de queue')
  const restore = () => run('restore_kb_parked_proposal', { p_proposal_id: p.id }, 'Teruggehaald naar de wachtrij', () => { onRestore?.(p.id); onDone?.() })

  return (
    <div className="rev-detail__inner">
      <div className="rev-detail__scroll">
        <div className="rev-detail__meta">
          <span className={`cat-chip ${catClass(p.kb_category)}`}><span className="cat-chip__dot" />{categoryLabel || catLabel(p.kb_category)}</span>
          <span className={`rev-imp rev-imp--${imp}`} title="Belang — door de AI gescoord">{IMPACT_LABEL[imp]}</span>
          {threads != null && <span className="rev-threads" title="Uit hoeveel losse mailgesprekken deze vraag komt">{threads} thread{threads === 1 ? '' : 's'}</span>}
          {isWritten && <span className="ans-badge ans-found"><Lc d={I.pen} />Artikel geschreven</span>}
        </div>

        {p.impact_reason && <p className="rev-imp-note">{p.impact_reason}</p>}

        <h2 className="rev-detail__title">{p.title}</h2>

        {/* "Lijkt op…" — dedup-zicht over artikelen + andere voorstellen */}
        {(simArticles.length > 0 || simProposals.length > 0) && (
          <div className="rev-similar">
            <div className="rev-similar__head"><Lc d={I.link} w={13} />Lijkt op</div>
            <ul className="rev-similar__list">
              {simArticles.map(s => (
                <li key={`a-${s.id}`}>
                  <Link to={`/kennisbank/artikel/${s.id}`} title="Open het bestaande artikel">{s.title}</Link>
                  <span className="rev-similar__tag">artikel · {Math.round((s.sim || 0) * 100)}%</span>
                </li>
              ))}
              {simProposals.map(s => (
                <li key={`p-${s.id}`}>
                  <span>{s.title}</span>
                  <span className="rev-similar__tag">ander voorstel · {Math.round((s.sim || 0) * 100)}%</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {parked && (
          <div className="rev-parked-banner">
            <div className="rev-parked-banner__head"><Lc d={I.archive} />Geparkeerd — buiten de wachtrij gehouden</div>
            {p.scope_reason && <p className="rev-parked-banner__why">{p.scope_reason}</p>}
          </div>
        )}

        {isWaiting && (
          <div className="rev-wait">
            <div className="rev-wait__head"><Lc d={I.clock} />{p.status === 'accepted' ? 'De AI schrijft dit artikel — klaar binnen ±15 min' : 'De AI herschrijft dit artikel'}</div>
            {p.status === 'accepted' && p.generate_note && <p className="rev-wait__instr">Jouw aanwijzing: “{p.generate_note}”</p>}
            {p.status === 'amended' && p.amendment && <p className="rev-wait__instr">Jouw instructie: “{p.amendment}”</p>}
          </div>
        )}

        {/* ====== FASE 1 — LICHT VOORSTEL ====== */}
        {(isPending || parked) && (
          <>
            {p.description
              ? <div className="rev-desc"><div className="rev-desc__lbl">Wat dit artikel gaat behandelen</div><p>{p.description}</p></div>
              : p.proposed_summary && <p className="rev-detail__summary">{p.proposed_summary}</p>}
            {p.rationale && <p className="rev-rationale">{p.rationale}</p>}

            <div className="rev-srcq">
              <div className="rev-srcq__lbl">De klantvragen hieronder ({(p.source_signal_ids || []).length})</div>
              {loading ? (
                <p className="knb-state">Bronvragen laden…</p>
              ) : (
                <ul className="rev-srcq__list">
                  {sources.slice(0, 10).map(({ signal }) => (
                    <li key={signal.id}>
                      <span className={`rev-srcq__dot ${signal.answer_status === 'answered' ? 'ok' : ''}`} />
                      {signal.canonical_question}
                      {signal.answer_status === 'answered' && <span className="rev-srcq__ans">✓ antwoord aanwezig</span>}
                    </li>
                  ))}
                  {sources.length > 10 && <li className="rev-srcq__more">… en nog {sources.length - 10} vragen</li>}
                </ul>
              )}
            </div>

            {mode === 'note' && !parked && (
              <div className="rq-editor adjust" style={{ background: 'transparent', borderTop: 'none', padding: '4px 0 0' }}>
                <div className="rq-editor__inner" style={{ paddingTop: 8 }}>
                  <div className="rq-editor__lbl adjust"><Lc d={I.spark} />Aanwijzing voor de schrijver <span style={{ opacity: .6 }}>(optioneel)</span></div>
                  <textarea value={noteText} autoFocus onChange={e => setNoteText(e.target.value)}
                    placeholder="Bv. ‘Maak het kort en praktisch’ of ‘Noem ook de mobiele app’ — of laat leeg en klik op Schrijf het artikel." />
                  <div className="rq-editor__chips">
                    {NOTE_SUG.map(s => <button key={s} type="button" className="rq-editor__sug" onClick={() => setNoteText(s)}>{s}</button>)}
                  </div>
                  <div className="rq-editor__foot">
                    <button className="btn" disabled={busy} onClick={() => { setMode('idle'); setNoteText('') }}>Annuleren</button>
                    <button className="btn btn-primary" disabled={busy} onClick={accept}><Lc d={I.pen} w={13} />Schrijf het artikel</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ====== FASE 3 — GESCHREVEN ARTIKEL ====== */}
        {isWritten && (
          <>
            {p.proposed_summary && <p className="rev-detail__summary">{p.proposed_summary}</p>}

            {p.needs_review && (
              <div className="rev-qa">
                <div className="rev-qa__head"><Lc d={I.qa} />De AI markeerde dit concept zelf voor controle</div>
                {qaPoints.length > 0 && <ul className="rev-qa__list">{qaPoints.map((pt, i) => <li key={i}>{pt}</li>)}</ul>}
                {(p.drafted_model || p.written_at) && (
                  <div className="rev-qa__foot">AI-zelfcontrole{p.drafted_model ? ` · ${p.drafted_model}` : ''}{p.written_at ? ` · geschreven ${fmtDate(p.written_at)}` : ''}</div>
                )}
              </div>
            )}

            <div className="rev-tabs" role="tablist">
              <button role="tab" aria-selected={!why} className={`rev-tab ${!why ? 'is-active' : ''}`} onClick={() => setTab('artikel')}>Het artikel</button>
              <button role="tab" aria-selected={why} className={`rev-tab ${why ? 'is-active' : ''}`} onClick={() => setTab('why')}>Onderbouwing · {(p.source_mail_ids || []).length || (p.source_signal_ids || []).length} bron{((p.source_mail_ids || []).length || (p.source_signal_ids || []).length) === 1 ? '' : 'nen'}</button>
            </div>

            {why ? (
              <KbProvenance mode="proposal" defaultOpen
                article={{ source_mail_ids: p.source_mail_ids, kb_category: p.kb_category, article_type: p.article_type, confidence: p.confidence }}
                provenance={{ confidence: p.confidence, rationale: p.rationale }}
                sources={sources} extras={extras} loadingSources={loading} />
            ) : (
              <article className="art-body rev-detail__body" dangerouslySetInnerHTML={{ __html: kbMarkdownToHtml(p.proposed_body || '') }} />
            )}

            {mode === 'adjust' && (
              <div className="rq-editor adjust" style={{ background: 'transparent', borderTop: 'none', padding: '4px 0 0' }}>
                <div className="rq-editor__inner" style={{ paddingTop: 8 }}>
                  <div className="rq-editor__lbl adjust"><Lc d={I.spark} />Geef de AI een instructie — die herschrijft het artikel</div>
                  <textarea value={amendText} autoFocus onChange={e => setAmendText(e.target.value)}
                    placeholder="Bv. ‘Voeg een stap toe over het wijzigen van het e-mailadres’ of ‘Maak het korter en formeler’…" />
                  <div className="rq-editor__chips">
                    {AMEND_SUG.map(s => <button key={s} type="button" className="rq-editor__sug" onClick={() => setAmendText(s)}>{s}</button>)}
                  </div>
                  <div className="rq-editor__foot">
                    <button className="btn" disabled={busy} onClick={() => { setMode('idle'); setAmendText('') }}>Annuleren</button>
                    <button className="btn btn-primary" disabled={busy || !amendText.trim()} onClick={amend}>Herschrijf met AI</button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ====== ACTIES ====== */}
      {parked ? (
        <div className="rev-detail__actions rev-detail__actions--single">
          <button className="rq-btn rq-btn--restore" disabled={busy} onClick={restore}><Lc d={I.undo} />Terughalen naar wachtrij</button>
        </div>
      ) : isWaiting ? (
        <div className="rev-detail__actions rev-detail__actions--single">
          <button className="rq-btn rq-btn--reject" disabled={busy} onClick={reject}><Lc d={I.x} />Toch afwijzen</button>
        </div>
      ) : isWritten ? (
        <div className="rev-detail__actions">
          <button className="rq-btn rq-btn--approve" disabled={busy} onClick={approve}><Lc d={I.check} />Publiceren</button>
          <button className={`rq-btn rq-btn--adjust ${mode === 'adjust' ? 'is-active' : ''}`} disabled={busy} onClick={() => setMode(mode === 'adjust' ? 'idle' : 'adjust')}><Lc d={I.edit} />Finetunen</button>
          <button className="rq-btn rq-btn--reject" disabled={busy} onClick={reject}><Lc d={I.x} />Afwijzen</button>
          {deferred
            ? <button className="rq-btn rq-btn--later" disabled={busy} onClick={() => setLater(false)}><Lc d={I.undo} />Terughalen</button>
            : <button className="rq-btn rq-btn--later" disabled={busy} onClick={() => setLater(true)}><Lc d={I.clock} />Later</button>}
        </div>
      ) : (
        <div className="rev-detail__actions">
          <button className="rq-btn rq-btn--approve" disabled={busy} onClick={() => (mode === 'note' ? accept() : setMode('note'))}>
            <Lc d={I.pen} />Maak dit artikel
          </button>
          <button className="rq-btn rq-btn--reject" disabled={busy} onClick={reject}><Lc d={I.x} />Afwijzen</button>
          {deferred
            ? <button className="rq-btn rq-btn--later" disabled={busy} onClick={() => setLater(false)}><Lc d={I.undo} />Terughalen</button>
            : <button className="rq-btn rq-btn--later" disabled={busy} onClick={() => setLater(true)}><Lc d={I.clock} />Later</button>}
        </div>
      )}
    </div>
  )
}
