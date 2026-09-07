import { useState } from 'react'
import a from './answer-layers.module.css'
import { Ico } from './Icons'
import SourcesInline from './SourcesInline'
import TechnicalPanel from './TechnicalPanel'
import ReasoningTrace from './ReasoningTrace'
import { buildProvenance, buildResearchSentence, usedCiteNs } from '../../../lib/answerLayers'

// =============================================================================
// AnswerLayers — wat er onder een afgerond antwoord staat (spoor 08, P2)
// =============================================================================
// Vier lagen, één zichtbaar: de verantwoordingsregel staat er altijd, Bronnen
// en Onderzoek staan dicht achter een chip, Technisch is een derde chip die
// alleen owner ziet. Dat is pakket "Normaal" uit ASK-JELLE §2, door Jelle
// gekozen op 2026-09-07.
//
// De regel zelf is één vaste vorm op élke route (H1) — semantisch, structured,
// sweep of agentic. Wie hem één keer leest, weet daarna waar de periode staat en
// waar het gat staat. Dat is de reden dat hier geen route-afhankelijke varianten
// zitten: de vorm mag niet meebewegen met de techniek eronder.
//
// Chevron-regel: chips zijn de toggle. ReasoningTrace en SourcesInline hebben
// daarom geen eigen kop-knop meer nodig; ze renderen alleen hun inhoud.
// =============================================================================

const CHEV = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
)

function Chip({ open, onClick, icon, children, dev }) {
  return (
    <button
      type="button"
      className={`${a.chip} ${open ? a.chipOn : ''} ${dev ? a.chipDev : ''}`}
      onClick={onClick}
      aria-expanded={open}
    >
      {icon}
      {children}
      <span className={`${a.chev} ${open ? a.chevOpen : ''}`}>{CHEV}</span>
    </button>
  )
}

export default function AnswerLayers({ m, isOwner, onOpenCite, onOpenPanel }) {
  // Eén laag open per antwoord: 'bronnen' | 'onderzoek' | 'technisch' | null.
  // Twee tegelijk maakt de kolom onleesbaar lang en het is nooit nodig.
  const [layer, setLayer] = useState(null)
  const toggle = (k) => setLayer(cur => (cur === k ? null : k))

  const prov = buildProvenance(m)
  const cites = Array.isArray(m.citations) ? m.citations : []
  const usedNs = usedCiteNs(m)
  const steps = Array.isArray(m.steps) ? m.steps : []
  const sentence = buildResearchSentence(m)
  const restCount = cites.length - usedNs.size

  const hasSources = cites.length > 0
  const hasResearch = steps.length > 0
  if (prov.empty && !hasSources && !hasResearch && !isOwner) return null

  return (
    <div className={a.prov}>
      {!prov.empty && (
        <div className={a.provLine}>
          {prov.basis && <span>{renderBasis(prov.basis)}</span>}
          {prov.basisNote && <><span className={a.provSep}>·</span><span className={a.provNote}>{prov.basisNote}</span></>}
          {prov.period && <><span className={a.provSep}>·</span><span>{prov.period}</span></>}
          {prov.notSearchedLabel && (
            <>
              <span className={a.provSep}>·</span>
              <span>niet doorzocht: <span className={a.provGap}>{prov.notSearchedLabel}</span></span>
            </>
          )}
          {prov.duration && <><span className={a.provSep}>·</span><span>{prov.duration}</span></>}
          {prov.cost && <><span className={a.provSep}>·</span><span className={a.provMoney}>{prov.cost}</span></>}
        </div>
      )}

      <div className={a.chips}>
        {hasSources && (
          <Chip open={layer === 'bronnen'} onClick={() => toggle('bronnen')} icon={Ico.docs}>
            Bronnen <span className={a.n}>{usedNs.size > 0 ? usedNs.size : Math.min(3, cites.length)}</span>
            {restCount > 0 && <span className={a.plus}>+{restCount}</span>}
          </Chip>
        )}
        {hasResearch && (
          <Chip open={layer === 'onderzoek'} onClick={() => toggle('onderzoek')} icon={Ico.search}>
            Onderzoek <span className={a.n}>{steps.length} {steps.length === 1 ? 'stap' : 'stappen'}</span>
          </Chip>
        )}
        {isOwner && (
          <Chip open={layer === 'technisch'} onClick={() => toggle('technisch')} dev>
            Technisch
          </Chip>
        )}
      </div>

      {layer === 'bronnen' && (
        <SourcesInline citations={cites} usedNs={usedNs} onOpenCite={onOpenCite} onOpenPanel={onOpenPanel} />
      )}

      {layer === 'onderzoek' && (
        <div className={a.drawer}>
          {sentence && <div className={a.drawerHead}><div className={a.drawerKop}>{sentence}</div></div>}
          <div className={a.drawerBody}>
            <ReasoningTrace steps={steps} embedded />
          </div>
        </div>
      )}

      {layer === 'technisch' && <TechnicalPanel m={m} />}
    </div>
  )
}

// "Gebaseerd op 3 mails en 1 meeting" — de getallen krijgen gewicht, de rest
// blijft stil. Geen innerHTML: de tekst komt uit onze eigen afleiding, maar een
// bronnaam kan een klantnaam bevatten en die hoort nooit door een HTML-parser.
function renderBasis(text) {
  return String(text).split(/(\d+(?:\.\d+)?)/).map((part, i) =>
    /^\d/.test(part) ? <strong key={i}>{part}</strong> : part)
}
