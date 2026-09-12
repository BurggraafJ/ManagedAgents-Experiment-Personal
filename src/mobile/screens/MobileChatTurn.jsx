import { useState } from 'react'
import Markdown from '../../components/views/zoeken/Markdown'
import AnalyticsBlock from '../../components/views/zoeken/AnalyticsBlock'
import CoverageNote from '../../components/views/zoeken/CoverageNote'
import MobileAnswerSheet from '../MobileAnswerSheet'
import { stripFollowUpBlock } from '../../lib/rag'
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

export default function MobileChatTurn({ m, onCancel }) {
  const [sheet, setSheet] = useState(null)   // 'bronnen' | 'onderzoek' | null
  // v1.155 (I1) — dezelfde twee dingen als desktop: welke citatie "aan" staat
  // (de alinea eromheen krijgt het oranje accent) en de open definitie. Een
  // telefoon heeft geen hover, dus hier zet een TIK het accent; wat die tik
  // niet doet, staat bij onCiteClick hieronder. Tot deze versie was een citatie
  // op mobiel niet eens aan te tikken.
  const [pinnedCite, setPinnedCite] = useState(null)
  const [defOpen, setDefOpen] = useState(false)

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
  const main = stripFollowUpBlock(m.content || '')
  const sentence = buildResearchSentence(m)
  const liveUsd = fmtUsd(m.spent?.usd)
  const canCancel = !!(m.run_id && onCancel && !RUN_TERMINAL.has(m.run_state))
  const restCount = citations.length - usedNs.size
  const definition = m.analytics?.definition || m.envelope?.definition || null
  // Zelfde opbouw als desktop: segmenten verzamelen en dán rijgen, anders begint
  // de regel bij een leeg antwoord (geen basis) met een losse middot — poort U4.
  const segments = []
  if (prov.basis) segments.push(prov.basis)
  if (prov.basisNote) segments.push(<em>{prov.basisNote}</em>)
  if (prov.period) segments.push(prov.period)
  if (prov.notSearchedLabel) segments.push(<span className="m-prov__gap">{prov.notSearchedLabel} niet doorzocht</span>)
  if (prov.duration) segments.push(prov.duration)
  if (prov.cost) segments.push(<span className="m-prov__money">{prov.cost}</span>)
  if (definition) {
    segments.push(
      <button type="button" className="m-prov__def" onClick={() => setDefOpen(v => !v)} aria-expanded={defOpen}>
        definitie<i>{defOpen ? '▾' : '▸'}</i>
      </button>
    )
  }

  return (
    /* m-answerblk = de token-brug (mobile.css): <Markdown>, AnalyticsBlock en
       CoverageNote lezen Maestro-tokens, en die bestaan buiten .theme-maestro
       niet. Zonder de brug valt bv. het oranje citaat-accent stil weg. */
    <div className="m-bubble m-bubble--ai m-answerblk">
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
        {m.content ? (
          <Markdown
            text={main}
            validCiteNs={validCiteNs}
            activeCiteN={pinnedCite}
            // Een tik zet alléén het accent, en opent NIET de sheet. Op een
            // telefoon dekt die sheet 82 % van het scherm — dan markeer je een
            // passage die je meteen daarna niet meer ziet, en dat is precies
            // omgekeerd aan de bedoeling van het accent. De bron zelf blijft op
            // twee tikken (Bronnen › en dan de rij), dus poort U5 blijft staan.
            // Nog een tik op hetzelfde nummer haalt het accent weer weg.
            onCiteClick={(n) => setPinnedCite(cur => (cur === n ? null : n))}
          />
        ) : null}
        {isLoading && m.content && <span className="m-bubble__caret">▍</span>}
      </div>

      {m.error && <div className="m-bubble__err">⚠ {m.error}</div>}

      {/* v1.155 (I1, poort U7) — twee blokken die op de telefoon simpelweg
          ontbraken: de exacte tabel bij een telling (het antwoord zei "zie de
          tabel" en er stond geen) en de dekkingsmelding bij een leeg antwoord
          (dan stond er alleen een vriendelijke alinea, zonder de reden). Zelfde
          componenten als desktop; de tabel scrollt horizontaal, zie mobile.css. */}
      {!isLoading && m.analytics && <AnalyticsBlock analytics={m.analytics} />}
      {!isLoading && <CoverageNote coverage={m.envelope?.coverage} />}

      {/* De verantwoordingsregel mag op 390 px over twee regels lopen; de
          volgorde blijft die van desktop zodat je hem op beide leert lezen.
          v1.155 (I1) — zelfde vorm als desktop L1: één zin, daaronder
          tekstknoppen met chevron. Geen omrande chips meer, en het
          aanraakvlak is ≥ 44 px terwijl de tekst 13 px blijft (padding doet
          het werk, poort U15). */}
      {!isLoading && (segments.length > 0 || citations.length > 0 || steps.length > 0) && (
        <div className="m-prov">
          {segments.length > 0 && (
            <div className="m-prov__line">
              {segments.map((seg, i) => (
                <span key={i}>{i > 0 && ' · '}{seg}</span>
              ))}
            </div>
          )}
          {defOpen && definition && <div className="m-prov__defbody">{definition}</div>}
          {(citations.length > 0 || steps.length > 0) && (
            <div className="m-prov__chips">
              {citations.length > 0 && (
                <button type="button" className="m-prov__chip is-prim" onClick={() => setSheet('bronnen')}>
                  Bronnen
                  <em>{usedNs.size > 0 ? usedNs.size : Math.min(3, citations.length)}</em>
                  {restCount > 0 && <i>+{restCount}</i>}
                  <span className="m-prov__chev" aria-hidden>›</span>
                </button>
              )}
              {steps.length > 0 && (
                <button type="button" className="m-prov__chip" onClick={() => setSheet('onderzoek')}>
                  Onderzoek
                  <span className="m-prov__chev" aria-hidden>›</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* v1.165 — hier stonden de vervolgvraag-chips. Vervolgvragen zijn uit
          het hele product (Jelle 2026-09-12), desktop én mobiel. */}

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
