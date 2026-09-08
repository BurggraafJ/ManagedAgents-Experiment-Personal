import { useState } from 'react'
import a from './answer-layers.module.css'
import { Ico, SOURCE_ICONS } from './Icons'
import { srcWord } from '../../../lib/answerLayers'

// =============================================================================
// SourcesInline — "Gebruikt (3)" eerst, "Ook bekeken (21)" één klik dieper
// =============================================================================
// Spoor 08 H2. Tot v1.151 droeg elk semantisch antwoord 24 bronkaarten met een
// similarity-getal en een badge *RPC*; in 62 % van de antwoorden werd er geen
// enkele geciteerd. Dat is geen verantwoording maar een dump.
//
// Wat er verandert (1d, Jelle "ja"): het getal 0.61 en de badges verhuizen naar
// de Developer-laag, en de groep "context" wordt hier de kop "ook bekeken, niet
// gebruikt". Wat blijft: elke bron is aanklikbaar en opent hetzelfde
// SourcesPanel dat er al was — deze lijst vervangt dat paneel niet, hij zet
// alleen de drie die het antwoord dragen bovenaan.
//
// Zonder citaties (ASK-JELLE punt 4) staat er "Meest relevant (3) — niet in het
// antwoord genoemd": nooit stil doen alsof ze gebruikt zijn.
// =============================================================================

const fmtDate = (iso) => {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return null }
}

function SourceRow({ cite, onOpen }) {
  const src = cite.source || 'mail'
  const date = fmtDate(cite.occurred_at || cite.ts)
  const herkomst = cite.from_name || srcWord(src, 1)
  return (
    <button type="button" className={a.srcRow} onClick={() => onOpen?.(cite.n)}>
      <span className={a.srcNum}>{cite.n ?? '·'}</span>
      <span className={a.srcIco}>{SOURCE_ICONS[src] || SOURCE_ICONS.mail}</span>
      <span className={a.srcMain}>
        <span className={a.srcTitle}>{cite.subject || cite.title || srcWord(src, 1)}</span>
        <span className={a.srcSub}>
          {date}
          {herkomst && <><span className={a.dot}>·</span>{herkomst}</>}
        </span>
      </span>
      <span className={a.srcOpen}>open origineel{Ico.external}</span>
    </button>
  )
}

export default function SourcesInline({ citations, usedNs, onOpenCite, onOpenPanel }) {
  const [restOpen, setRestOpen] = useState(false)
  const cites = Array.isArray(citations) ? citations : []
  const used = usedNs || new Set()
  const usedList = cites.filter(c => used.has(c.n))
  const restList = cites.filter(c => !used.has(c.n))

  // Niets geciteerd → de top-3 op volgorde van teruggave, met de eerlijke kop.
  const geenCitaties = usedList.length === 0
  const primary = geenCitaties ? restList.slice(0, 3) : usedList
  const rest = geenCitaties ? restList.slice(3) : restList

  if (cites.length === 0) return null

  return (
    <div className={a.drawer}>
      <div className={a.drawerHead}>
        <div className={a.drawerKop}>
          {geenCitaties
            ? <><em>Meest relevant ({primary.length})</em> — niet in het antwoord genoemd</>
            : <><em>Gebruikt in dit antwoord ({primary.length})</em> — genummerd zoals in de tekst</>}
        </div>
      </div>
      <div className={a.drawerBody}>
        {primary.map(c => <SourceRow key={c.n ?? c.chunk_id} cite={c} onOpen={onOpenCite} />)}
        {rest.length > 0 && (
          <>
            <button type="button" className={a.srcMore} onClick={() => setRestOpen(v => !v)}>
              <span className={`${a.chev} ${restOpen ? a.chevOpen : ''}`}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
              </span>
              Ook bekeken, niet gebruikt <span className={a.n}>{rest.length}</span>
            </button>
            {restOpen && rest.map(c => <SourceRow key={c.n ?? c.chunk_id} cite={c} onOpen={onOpenCite} />)}
          </>
        )}
      </div>
      <div className={a.drawerFoot}>
        <span className={a.drawerFootHint}>tik een bron om het origineel te lezen</span>
        <button type="button" className={a.drawerFootBtn} onClick={() => onOpenPanel?.()}>
          Alles in het bronnenpaneel
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
      </div>
    </div>
  )
}
