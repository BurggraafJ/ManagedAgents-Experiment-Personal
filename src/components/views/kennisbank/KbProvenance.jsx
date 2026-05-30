import { useState } from 'react'
import { avatarClass, catLabel, confInfo, fmtDate, initials, TYPE_LABEL } from './kbMeta'

/* Kleine helper voor de lucide-stijl iconen uit het design. */
function Lc({ d, children }) {
  return <svg className="lc" viewBox="0 0 24 24">{children || (Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />)}</svg>
}
const I = {
  mail: ['M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h9', 'm22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7'],
  bulb: ['M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1h6c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z'],
  q: ['M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01'],
  send: ['m22 2-7 20-4-9-9-4z'],
  chev: ['m6 9 6 6 6-6'],
  folder: ['M3 7a2 2 0 0 1 2-2h6l2 2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  chart: ['M3 3v18h18', 'm19 9-5 5-4-4-3 3'],
  check: ['M20 6 9 17l-5-5'],
}

/* Eén bron-rij: afzender + onderwerp, uitklapbaar naar vraag + antwoord
   (of, voor 'overige' mails zonder eigen signaal, een fragment-preview). */
function SourceRow({ mail, signal, index }) {
  const [open, setOpen] = useState(false)
  const who = mail?.from_name || mail?.from_email || (signal ? 'Bron-mail' : 'Onbekende afzender')
  const date = fmtDate(mail?.received_at || signal?.received_at)
  const subject = mail?.subject || '(onderwerp onbekend)'
  const answered = signal?.answer_status === 'answered' && signal?.answer_text

  return (
    <div className={`src ${open ? 'is-open' : ''}`}>
      <button type="button" className="src__head" onClick={() => setOpen(o => !o)}>
        <div className={`src__av ${avatarClass(index)}`}>{initials(who)}</div>
        <div className="src__main">
          <div className="src__top"><span className="src__who">{who}</span><span className="src__date">{date}</span></div>
          <div className="src__subj">{subject}</div>
        </div>
        <span className="src__chev"><Lc d={I.chev} /></span>
      </button>
      <div className="src__frag">
        <div className="frag">
          {signal ? (
            <>
              <div className="frag__lbl q"><Lc d={I.q} />Vraag van de klant</div>
              <p className="frag__quote">{signal.canonical_question}</p>
              {answered ? (
                <>
                  <div className="frag__lbl a"><Lc d={I.send} />Ons antwoord</div>
                  <p className="frag__quote a">{signal.answer_text}</p>
                </>
              ) : (
                <p className="frag__quote todo">Antwoord nog te bevestigen — deze bronvraag is herkend, maar het antwoord is nog niet vastgelegd.</p>
              )}
            </>
          ) : (
            <p className="frag__quote">{mail?.body_preview || '(geen voorbeeld beschikbaar)'}</p>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * KbProvenance — het transparantie-paneel ("AI-herkomst"): op basis van welke
 * mails en waarom. Herbruikbaar voor artikel-detail én later de review-queue.
 */
export default function KbProvenance({ article, sources = [], extras = [], provenance, defaultOpen = false, mode = 'article', onOpen, loadingSources = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const [showExtras, setShowExtras] = useState(false)

  const nMails = (Array.isArray(article?.source_mail_ids) && article.source_mail_ids.length) || (sources.length + extras.length)
  const conf = confInfo(provenance?.confidence ?? article?.confidence)
  const sigs = sources.map(s => s.signal).filter(Boolean)
  const questions = [...new Set(sigs.map(s => s.canonical_question).filter(Boolean))].slice(0, 4)
  const genTrue = sigs.filter(s => s.generalizable).length
  const allGen = sigs.length > 0 && genTrue === sigs.length
  const someGen = genTrue > 0
  const pendingAns = sigs.filter(s => s.answer_status !== 'answered').length

  const typeLabel = TYPE_LABEL[article?.article_type] || article?.article_type
  const rationaleText = provenance?.rationale ||
    `Geclassificeerd als ${catLabel(article?.kb_category)}${typeLabel ? ` · ${typeLabel}` : ''} op basis van ${nMails} bronmail${nMails === 1 ? '' : 's'}.`

  const genText = sigs.length === 0
    ? 'Onderbouwing op basis van de gekoppelde bronnen.'
    : allGen
      ? 'De antwoorden golden consistent over de bronvragen heen — algemeen toepasbaar.'
      : someGen
        ? 'Deels algemeen geldend; een aantal antwoorden is context-afhankelijk en kan per geval afwijken.'
        : 'Context-afhankelijk — beoordeel per geval voordat je dit als algemeen beleid hanteert.'

  let confTail = ''
  if (conf) {
    confTail = conf.pct >= 80 ? 'Antwoord meermaals consistent gegeven en geverifieerd.'
      : conf.pct >= 50 ? 'Redelijk onderbouwd; bevestig de details bij twijfel.'
        : 'Beperkt onderbouwd — verificatie aanbevolen.'
    if (pendingAns) confTail += ` ${pendingAns} bronvraag${pendingAns === 1 ? '' : '/-vragen'} nog te bevestigen.`
  }

  const isProposal = mode === 'proposal'
  const markText = isProposal ? 'Waarom dit voorstel?' : 'AI-herkomst'
  const titleText = isProposal
    ? `${nMails} bronmail${nMails === 1 ? '' : 's'} · ${allGen ? 'consistent antwoord' : 'menselijke check nodig'}`
    : `Gebaseerd op ${nMails} mail${nMails === 1 ? '' : 's'}`
  const metaText = isProposal
    ? (conf ? `${conf.pct}% confidence` : 'voorstel')
    : `waarom dit artikel${conf ? ` · ${conf.pct}%` : ''}`
  const bronLabel = isProposal ? 'Bronmails' : 'Gebaseerd op deze mails'
  const reasonLabel = isProposal ? 'AI-redenering' : 'Waarom dit artikel'

  return (
    <div className={`prov collapsible ${open ? 'is-open' : ''}`} style={isProposal ? undefined : { marginTop: 30 }}>
      <div className="prov__head" onClick={() => setOpen(o => { const n = !o; if (n && onOpen) onOpen(); return n })}>
        <span className="prov__mark"><span className="pulse" />{markText}</span>
        <span className="prov__title">{titleText}</span>
        <span className="prov__meta">{metaText}</span>
      </div>
      <div className="prov__body">
        <div className="prov__grid">

          {/* BRON-BLOK */}
          <div className="prov-sub">
            <div className="prov-sub__label"><Lc d={I.mail} />{bronLabel} <span className="cnt">{nMails} bronnen</span></div>
            <div className="src-list">
              {sources.map((row, i) => <SourceRow key={row.signal?.id || `s${i}`} mail={row.mail} signal={row.signal} index={i} />)}
              {extras.length > 0 && !showExtras && (
                <button type="button" className="src-more" onClick={() => setShowExtras(true)}>
                  + {extras.length} overige bronmail{extras.length === 1 ? '' : 's'} tonen
                </button>
              )}
              {showExtras && extras.map((m, i) => <SourceRow key={m.mail_id} mail={m} signal={null} index={sources.length + i} />)}
              {sources.length === 0 && extras.length === 0 && (
                <p className="frag__quote" style={{ borderLeftColor: 'var(--border)' }}>
                  {loadingSources ? 'Bronnen laden…' : 'Geen bron-mails gekoppeld.'}
                </p>
              )}
            </div>
          </div>

          {/* REDENEER-BLOK — één doorlopend, leesbaar blok */}
          <div className="prov-sub">
            <div className="prov-sub__label">
              <Lc d={I.bulb} />{reasonLabel}
              {conf && <span className="why__pct" style={{ color: conf.stroke }}>{conf.pct}%</span>}
              {sigs.length > 0 && (allGen
                ? <span className="gen-pill gen-yes"><Lc d={I.check} />Algemeen geldend</span>
                : <span className="gen-pill gen-no">Context-afhankelijk</span>)}
            </div>
            <div className="why">
              <p className="why__p">{rationaleText}</p>
              <p className="why__p why__p--muted">{genText}</p>
              {questions.length > 0 && (
                <div className="why__q">
                  <div className="why__q-lbl">{questions.length === 1 ? 'Terugkerende vraag' : 'Terugkerende vragen'}</div>
                  {questions.map((qq, i) => <p className="why__q-item" key={i}>{qq}</p>)}
                </div>
              )}
              {conf && confTail && <p className="why__conf">{confTail}</p>}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
