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
  archive: ['M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z', 'M3 4h18v4H3z', 'M10 12h4'],
  pen: ['M12 19l7-7 3 3-7 7-3-3z', 'M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z'],
  link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
}
const AMEND_SUG = ['Korter & bondiger', 'Formelere toon', 'Voeg een concrete stap toe']

/**
 * KbProposalCard — detailpaneel van de review-queue (Kennisbank 2.0).
 * Rustige opbouw, drie fasen:
 *  - pending  : titel + beschrijving + bronvragen → "Maak dit artikel" (1 klik;
 *               aanwijzing optioneel via apart knopje) / Afwijzen / Later
 *  - accepted/amended : de AI schrijft — wachtbanner
 *  - written  : het artikel → Publiceren / Finetunen / Afwijzen
 */
export default function KbProposalCard({ proposal: p, categoryLabel, onDone, deferred = false, parked = false, onRestore }) {
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState('idle')      // idle | note | adjust
  const [tab, setTab] = useState('artikel')     // artikel | why  (alleen bij written)
  const [noteText, setNoteText] = useState('')
  const [amendText, setAmendText] = useState('')
  const [allSources, setAllSources] = useState(false)

  const isPending = p.status === 'pending'
  const isWaiting = p.status === 'accepted' || p.status === 'amended'
  const isWritten = p.status === 'written'
  const why = tab === 'why'
  // Bij een licht voorstel zijn de bronvragen de onderbouwing → meteen laden;
  // bij een geschreven artikel pas wanneer de Onderbouwing-tab opengaat.
  const { sources, extras, loading } = useKbSources(p.source_signal_ids, p.source_mail_ids, isPending || parked || why)
  const imp = impactKey(p)
  const threads = p.distinct_threads
  const qaPoints = p.needs_review && p.qa_notes ? p.qa_notes.split(/\s+·\s+/).map(s => s.trim()).filter(Boolean) : []
  const simArticles = p.similar_info?.articles || []
  const simProposals = p.similar_info?.proposals || []
  const shownSources = allSources ? sources : sources.slice(0, 6)

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
  const accept = (note) => run('accept_kb_proposal', { p_proposal_id: p.id, p_note: (note || '').trim() || null }, 'Akkoord — de AI schrijft het artikel ✓')
  const approve = () => run('approve_kb_article_proposal', { p_proposal_id: p.id }, 'Gepubliceerd in de kennisbank ✓')
  const amend = () => run('amend_kb_article_proposal', { p_proposal_id: p.id, p_amendment: amendText.trim() }, 'Instructie genoteerd — wordt herschreven')
  const reject = () => run('reject_kb_article_proposal', { p_proposal_id: p.id, p_reason: null }, 'Voorstel afgewezen')
  const setLater = (later) => run('defer_kb_article_proposal', { p_proposal_id: p.id, p_later: later }, later ? 'Naar “later” verplaatst' : 'Terug in de queue')
  const restore = () => run('restore_kb_parked_proposal', { p_proposal_id: p.id }, 'Teruggehaald naar de wachtrij', () => { onRestore?.(p.id); onDone?.() })

  return (
    <div className="rev-detail__inner">
      <div className="rev-detail__scroll">
        {/* Eén rustige meta-regel */}
        <div className="rev-detail__meta">
          <span className={`cat-chip ${catClass(p.kb_category)}`}><span className="cat-chip__dot" />{categoryLabel || catLabel(p.kb_category)}</span>
          <span className={`rev-imp rev-imp--${imp}`} title={p.impact_reason || 'Belang — door de AI gescoord'}>{IMPACT_LABEL[imp]}</span>
          {threads != null && threads > 0 && <span className="rev-threads" title="Uit hoeveel losse mailgesprekken deze vraag komt">{threads} gesprek{threads === 1 ? '' : 'ken'}</span>}
        </div>

        <h2 className="rev-detail__title">{p.title}</h2>

        {/* Beschrijving = gewone lead-tekst (geen aparte box) */}
        {(isPending || parked) && (p.description || p.proposed_summary) && (
          <p className="rev-detail__summary">{p.description || p.proposed_summary}</p>
        )}
        {isWritten && p.proposed_summary && <p className="rev-detail__summary">{p.proposed_summary}</p>}

        {/* "Lijkt op…" — alleen tonen als het er is */}
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
            {isWaiting && (p.description || p.proposed_summary) && <p className="rev-wait__instr" style={{ fontStyle: 'normal' }}>{p.description || p.proposed_summary}</p>}
          </div>
        )}

        {/* Bronvragen — de onderbouwing van een licht voorstel */}
        {(isPending || parked) && (
          <div className="rev-srcq">
            <div className="rev-srcq__lbl">Gebaseerd op deze klantvragen ({(p.source_signal_ids || []).length})</div>
            {loading ? (
              <p className="knb-state" style={{ padding: '8px 0' }}>Bronvragen laden…</p>
            ) : (
              <ul className="rev-srcq__list">
                {shownSources.map(({ signal }) => (
                  <li key={signal.id}>
                    <span className={`rev-srcq__dot ${signal.answer_status === 'answered' ? 'ok' : ''}`} title={signal.answer_status === 'answered' ? 'Ons antwoord is gevonden in de thread' : 'Nog geen antwoord gevonden'} />
                    <span className="rev-srcq__txt">{signal.canonical_question}</span>
                  </li>
                ))}
                {sources.length > 6 && !allSources && (
                  <li className="rev-srcq__more"><button type="button" onClick={() => setAllSources(true)}>Toon alle {sources.length} vragen</button></li>
                )}
              </ul>
            )}
          </div>
        )}

        {/* Geschreven artikel */}
        {isWritten && (
          <>
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
              <button role="tab" aria-selected={why} className={`rev-tab ${why ? 'is-active' : ''}`} onClick={() => setTab('why')}>Onderbouwing</button>
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
                  <div className="rq-editor__lbl adjust"><Lc d={I.spark} />Wat moet er anders? De AI herschrijft het artikel.</div>
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

        {/* Optioneel aanwijzing-veld bij accepteren (pending) */}
        {isPending && mode === 'note' && (
          <div className="rq-editor adjust" style={{ background: 'transparent', borderTop: 'none', padding: '4px 0 0' }}>
            <div className="rq-editor__inner" style={{ paddingTop: 8 }}>
              <div className="rq-editor__lbl adjust"><Lc d={I.spark} />Aanwijzing voor de schrijver</div>
              <textarea value={noteText} autoFocus onChange={e => setNoteText(e.target.value)}
                placeholder="Bv. ‘Maak het kort en praktisch’ of ‘Noem ook de mobiele app’…" />
              <div className="rq-editor__foot">
                <button className="btn" disabled={busy} onClick={() => { setMode('idle'); setNoteText('') }}>Annuleren</button>
                <button className="btn btn-primary" disabled={busy || !noteText.trim()} onClick={() => accept(noteText)}><Lc d={I.pen} w={13} />Schrijf met deze aanwijzing</button>
              </div>
            </div>
          </div>
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
          {/* Eén klik = akkoord; aanwijzing is een aparte, kleinere keuze */}
          <button className="rq-btn rq-btn--approve" disabled={busy || mode === 'note'} onClick={() => accept()}><Lc d={I.pen} />Maak dit artikel</button>
          <button className={`rq-btn rq-btn--adjust ${mode === 'note' ? 'is-active' : ''}`} disabled={busy} onClick={() => setMode(mode === 'note' ? 'idle' : 'note')} title="Akkoord, maar met een aanwijzing voor de schrijver"><Lc d={I.edit} />Met aanwijzing</button>
          <button className="rq-btn rq-btn--reject" disabled={busy} onClick={reject}><Lc d={I.x} />Afwijzen</button>
          {deferred
            ? <button className="rq-btn rq-btn--later" disabled={busy} onClick={() => setLater(false)}><Lc d={I.undo} />Terughalen</button>
            : <button className="rq-btn rq-btn--later" disabled={busy} onClick={() => setLater(true)}><Lc d={I.clock} />Later</button>}
        </div>
      )}
    </div>
  )
}
