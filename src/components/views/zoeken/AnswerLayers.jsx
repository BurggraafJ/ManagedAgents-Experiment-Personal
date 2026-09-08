import { useState } from 'react'
import a from './answer-layers.module.css'
import SourcesInline from './SourcesInline'
import TechnicalPanel from './TechnicalPanel'
import ReasoningTrace from './ReasoningTrace'
import { buildProvenance, buildResearchSentence, usedCiteNs } from '../../../lib/answerLayers'

// =============================================================================
// AnswerLayers — wat er onder een afgerond antwoord staat (spoor 08, P2)
// =============================================================================
// Vier lagen, één zichtbaar: de verantwoordingsregel staat er altijd, Bronnen
// en Onderzoek staan dicht achter een ingang, Technisch is een derde ingang die
// alleen owner ziet. Dat is pakket "Normaal" uit ASK-JELLE §2, door Jelle
// gekozen op 2026-09-07.
//
// De regel zelf is één vaste vorm op élke route (H1) — semantisch, structured,
// sweep of agentic. Wie hem één keer leest, weet daarna waar de periode staat en
// waar het gat staat. Dat is de reden dat hier geen route-afhankelijke varianten
// zitten: de vorm mag niet meebewegen met de techniek eronder.
//
// v1.155 (I1, Jelle 2026-09-08 — vorm L1 "Onderregel"): dezelfde inhoud, maar
// de kaart eromheen is weg. Wat er veranderde en waarom:
//   • container   → één haarlijn. Geen vlak/rand/schaduw/radius/oranje meer;
//                   met een gewichtloos antwoord ("Los op pagina") zou elk
//                   vlak hieronder het zwaarste ding op het scherm zijn.
//   • twee regels → één zin. De periode stond er twee keer (regel 1 én de
//                   mono-regel eronder); die herhaling was de helft van het blok.
//   • "Gebaseerd op" → weg. Drie woorden ceremonie onder élk antwoord; de
//                   positie (direct onder de tekst) zegt het al. Bij een
//                   telling blijft er wél een werkwoord staan, want daar
//                   spreekt het níet vanzelf: "31 rijen, exact geteld".
//   • "niet doorzocht: agenda" → "agenda niet doorzocht". Zelfde informatie,
//                   leest als een mededeling in plaats van als een veldnaam.
//   • knoppen     → tekstknoppen met chevron; vlak pas bij hover/focus.
// Niets van de inhoud is geschrapt: elke regel tekst en elke ingang staat er
// nog, en de diepte (SourcesInline / ReasoningTrace / TechnicalPanel) is
// ongewijzigd. Zie META-LITE.md §6 en design/d2/OPTIONS.md.
// =============================================================================

const CHEV = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
)

function Entry({ open, onClick, primary, dev, children }) {
  return (
    <button
      type="button"
      className={`${a.chip} ${open ? a.chipOn : ''} ${primary ? a.chipPrim : ''} ${dev ? a.chipDev : ''}`}
      onClick={onClick}
      aria-expanded={open}
    >
      {children}
      <span className={`${a.chev} ${open ? a.chevOpen : ''}`}>{CHEV}</span>
    </button>
  )
}

export default function AnswerLayers({ m, isOwner, onOpenCite, onOpenPanel }) {
  // Eén laag open per antwoord: 'bronnen' | 'onderzoek' | 'technisch' | null.
  // Twee tegelijk maakt de kolom onleesbaar lang en het is nooit nodig.
  const [layer, setLayer] = useState(null)
  const [defOpen, setDefOpen] = useState(false)
  const toggle = (k) => setLayer(cur => (cur === k ? null : k))

  const prov = buildProvenance(m)
  const cites = Array.isArray(m.citations) ? m.citations : []
  const usedNs = usedCiteNs(m)
  const steps = Array.isArray(m.steps) ? m.steps : []
  const sentence = buildResearchSentence(m)
  const restCount = cites.length - usedNs.size
  // De kolomdefinitie bij een telling ("wat is een klant?") stond in de voet van
  // het analytics-blok in 11px mono. Op de onderregel is dat één tekstknop.
  const definition = m.analytics?.definition || m.envelope?.definition || null

  const hasSources = cites.length > 0
  const hasResearch = steps.length > 0
  if (prov.empty && !hasSources && !hasResearch && !isOwner) return null

  // De segmenten worden eerst verzameld en dan met middots aan elkaar geregen.
  // Niet elk segment zijn eigen scheidingsteken laten meebrengen: bij een leeg
  // antwoord bestaat `basis` niet, en dan begon de regel met een losse middot.
  // Poort U4 vraagt letterlijk dat er nooit een onderregel staat die alleen uit
  // scheidingstekens bestaat.
  const segments = []
  if (prov.basis) segments.push(renderBasis(prov.basis))
  if (prov.basisNote) segments.push(<span className={a.provNote}>{prov.basisNote}</span>)
  if (prov.period) segments.push(prov.period)
  // Het gat: "agenda niet doorzocht". Er staat niets als er niets te melden
  // valt — coverage.not_searched is vaak leeg.
  if (prov.notSearchedLabel) segments.push(<span className={a.provGap}>{prov.notSearchedLabel} niet doorzocht</span>)
  if (prov.duration) segments.push(prov.duration)
  if (prov.cost) segments.push(<span className={a.provMoney}>{prov.cost}</span>)
  if (definition) {
    segments.push(
      <button type="button" className={a.provDef} onClick={() => setDefOpen(v => !v)} aria-expanded={defOpen}>
        definitie<i>{defOpen ? '▾' : '▸'}</i>
      </button>
    )
  }

  return (
    <div className={a.provWrap}>
      <div className={a.prov}>
        {segments.length > 0 && (
          <div className={a.provLine}>
            {segments.map((seg, i) => (
              <span key={i}>{i > 0 && <span className={a.provSep}> · </span>}{seg}</span>
            ))}
          </div>
        )}
        {defOpen && definition && <div className={a.provDefBody}>{definition}</div>}

        {(hasSources || hasResearch || isOwner) && (
          <div className={a.chips}>
            {hasSources && (
              <Entry open={layer === 'bronnen'} onClick={() => toggle('bronnen')} primary>
                Bronnen <span className={a.n}>{usedNs.size > 0 ? usedNs.size : Math.min(3, cites.length)}</span>
                {restCount > 0 && <span className={a.plus}>+{restCount}</span>}
              </Entry>
            )}
            {hasResearch && (
              <Entry open={layer === 'onderzoek'} onClick={() => toggle('onderzoek')}>
                Onderzoek
              </Entry>
            )}
            {isOwner && (
              <Entry open={layer === 'technisch'} onClick={() => toggle('technisch')} dev>
                Technisch
              </Entry>
            )}
          </div>
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


// "3 mails en 1 meeting" — de getallen krijgen gewicht, de rest blijft stil.
// Geen innerHTML: de tekst komt uit onze eigen afleiding, maar een bronnaam kan
// een klantnaam bevatten en die hoort nooit door een HTML-parser.
function renderBasis(text) {
  return String(text).split(/(\d+(?:\.\d+)?)/).map((part, i) =>
    /^\d/.test(part) ? <strong key={i}>{part}</strong> : part)
}
