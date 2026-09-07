import { useState } from 'react'
import Markdown from '../../components/views/zoeken/Markdown'
import { splitFollowUps } from '../../components/views/zoeken/Followups'
import MIcon from '../MIcon'
import MobileAnswerSheet from '../MobileAnswerSheet'
import {
  buildProvenance, buildResearchSentence, usedCiteNs, expectedDuration, fmtUsd,
} from '../../lib/answerLayers'

// =============================================================================
// MobileChatTurn — één chatbericht op de telefoon (spoor 08, H6)
// =============================================================================
// Apart bestand omdat MobileZoeken.jsx anders over de 400-regelcap gaat, en
// omdat dit de plek is waar mobiel en desktop dezelfde hiërarchie moeten tonen:
//
//   antwoord → verantwoordingsregel → twee chips → bottom-sheet
//
// Drie dingen die op mobiel stuk waren en hier meekomen:
//   • het label zei "JelleMind"; desktop zegt "Maestro" (1i-lijn).
//   • de duur verscheen nooit: de code las `timing_ms.total_ms`, het veld heet
//     `total`. Nu via dezelfde afleiding als desktop.
//   • er was geen dekkingsmelding en geen verantwoording — alleen acht
//     bronkaarten inline (1h).
// =============================================================================

const RUN_TERMINAL = new Set(['done', 'failed', 'cancelled'])

export default function MobileChatTurn({ m, onCancel, onFollowUp }) {
  const [sheet, setSheet] = useState(null)   // 'bronnen' | 'onderzoek' | null

  if (m.role === 'user') {
    return <div className="m-bubble m-bubble--user"><div className="m-bubble__txt">{m.content}</div></div>
  }

  const isLoading = m.streaming || m.loading
  const citations = Array.isArray(m.citations) ? m.citations : []
  // Geldige citation-nummers — voorkomt dat hallucinated [bron #N]-tags die niet
  // matchen met een echte bron als rare code in lopende tekst blijven staan.
  const validCiteNs = citations.map(c => c.n).filter(n => Number.isFinite(n))
  const usedNs = usedCiteNs(m)
  const steps = Array.isArray(m.steps) ? m.steps : []
  const prov = buildProvenance(m)
  // v1.152 — desktop splitst het "## Vervolgvragen"-blok al af naar chips;
  // mobiel liet het als dode markdown-lijst onder het antwoord staan. Zelfde
  // hiërarchie op beide (H6), en de vragen zijn nu aantikbaar.
  const { main, followups } = splitFollowUps(m.content || '')
  const sentence = buildResearchSentence(m)
  const liveUsd = fmtUsd(m.spent?.usd)
  const canCancel = !!(m.run_id && onCancel && !RUN_TERMINAL.has(m.run_state))
  const restCount = citations.length - usedNs.size

  return (
    <div className="m-bubble m-bubble--ai">
      <div className="m-bubble__head">
        <span className={`m-bubble__ring ${isLoading ? 'is-live' : ''}`} aria-hidden />
        <span className="m-bubble__lbl">Maestro</span>
        {isLoading && liveUsd && <span className="m-bubble__time">{liveUsd}</span>}
        {canCancel && <button type="button" className="m-bubble__stop" onClick={() => onCancel(m.run_id)}>Stop</button>}
      </div>

      {isLoading && !m.content && (
        <div className="m-bubble__wait">
          <div className="m-bubble__phase">{m.phase_label || 'Denken…'}</div>
          <div className="m-bubble__expect">{expectedDuration(m)}</div>
        </div>
      )}

      <div className="m-bubble__txt m-bubble__md">
        {m.content ? <Markdown text={main} validCiteNs={validCiteNs} /> : null}
        {isLoading && m.content && <span className="m-bubble__caret">▍</span>}
      </div>

      {m.error && <div className="m-bubble__err">⚠ {m.error}</div>}

      {!isLoading && followups.length > 0 && onFollowUp && (
        <div className="m-fu">
          {followups.map((q, i) => (
            <button key={i} type="button" className="m-fu__chip" onClick={() => onFollowUp(q)}>{q}</button>
          ))}
        </div>
      )}

      {/* De verantwoordingsregel mag op 390 px over twee regels lopen; de
          volgorde blijft die van desktop zodat je hem op beide leert lezen. */}
      {!isLoading && !prov.empty && (
        <div className="m-prov">
          <div className="m-prov__line">
            {prov.basis}
            {prov.basisNote && <> · <em>{prov.basisNote}</em></>}
            {prov.period && <> · {prov.period}</>}
            {prov.notSearchedLabel && <> · niet doorzocht: <span className="m-prov__gap">{prov.notSearchedLabel}</span></>}
            {prov.duration && <> · {prov.duration}</>}
            {prov.cost && <> · <span className="m-prov__money">{prov.cost}</span></>}
          </div>
          {(citations.length > 0 || steps.length > 0) && (
            <div className="m-prov__chips">
              {citations.length > 0 && (
                <button type="button" className="m-prov__chip" onClick={() => setSheet('bronnen')}>
                  <MIcon name="mail" size={11} /> Bronnen
                  <em>{usedNs.size > 0 ? usedNs.size : Math.min(3, citations.length)}</em>
                  {restCount > 0 && <i>+{restCount}</i>}
                </button>
              )}
              {steps.length > 0 && (
                <button type="button" className="m-prov__chip" onClick={() => setSheet('onderzoek')}>
                  <MIcon name="search" size={11} /> Onderzoek <em>{steps.length}</em>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <MobileAnswerSheet
        open={!!sheet}
        tab={sheet || 'bronnen'}
        onTab={setSheet}
        onClose={() => setSheet(null)}
        citations={citations}
        usedNs={usedNs}
        steps={steps}
        sentence={sentence}
        footer={[
          steps.length ? `${steps.length} ${steps.length === 1 ? 'stap' : 'stappen'}` : null,
          prov.duration, prov.cost,
        ].filter(Boolean).join(' · ')}
      />
    </div>
  )
}
