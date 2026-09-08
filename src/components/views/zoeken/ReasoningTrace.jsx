import { useState, useEffect, useRef } from 'react'
import s from './zoeken.module.css'
import { stepKind } from '../../../lib/answerLayers'

// ReasoningTrace v3 (spoor 08, v1.152) — het onderzoek als tijdlijn.
//   💭 gedachten   = gewone cursieve tekstregels, alsof Maestro praat.
//   🔧 tool-calls  = compacte regels die automatisch INKLAPPEN zodra er een
//                    nieuwe stap binnenkomt — alleen de huidige staat open;
//                    alles blijft achteraf per klik uitklapbaar (vondsten +
//                    zoekopdracht). Neutrale kleuren, geen kaders.
// Steps uit rag-chat: {t, stage, label, detail?, args?, findings?}.
//
// Wat v3 verandert (Jelle 2026-09-07, item 1g "ja"):
//   • De kop was een telling ("9 stappen · 2 gedachten · 5 tool-calls"). Die
//     telling staat nu in TechnicalPanel; de kop is één zin die AnswerLayers
//     bouwt. Vandaar `embedded`: de chip is de toggle, dit bestand rendert dan
//     alleen de feed.
//   • Drie registers in plaats van twee. "0 resultaten — <reden>" was niet van
//     een vondst te onderscheiden; dat is nu een eigen, gedempt register. Een
//     zoekactie die niets vond en een zoekactie die faalde lezen verschillend,
//     want dat is het verschil tussen "bestaat niet" en "probeer opnieuw".
//   • Live toont P2 alleen de laatste drie stappen; wat af is klapt zichzelf op
//     tot één regel. Anders groeit de kolom tijdens 30–60 s onbeheersbaar.
//
// v1.151 (spoor 02 I2): `phaseLabel` is de fase die de run-rij zelf meldt —
// specifieker dan een vaste regel, en juist ook ná een reload. `startedAt` is
// het moment waarop de run begon, zodat de teller na een reload de échte
// verstreken tijd toont in plaats van opnieuw bij 0,0 s te beginnen.
const LIVE_TAIL = 3

export default function ReasoningTrace({ steps, live = false, webSearch = false, phaseLabel = null, startedAt = null, embedded = false }) {
  const hasSteps = Array.isArray(steps) && steps.length > 0

  if (live) {
    // Geen eigen kopregel meer: de fase, de verstreken tijd en de kosten staan
    // in de metaregel van het bericht (ChatMode). Tot v1.151 stond de fase hier
    // óók, en dan las één status als twee.
    return (
      <div className={s.rtFlow}>
        {hasSteps
          ? <TraceFeed steps={steps} live />
          : (
            <div className={s.rtRow}>
              <span className={s.rtPulse} aria-hidden />
              <span className={s.rtRowLabel}>{phaseLabel || (webSearch ? 'Vraag interpreteren — bronnen + web…' : 'Vraag interpreteren…')}</span>
            </div>
          )}
      </div>
    )
  }

  if (!hasSteps) return null
  // `embedded` is de enige niet-live stand sinds v1.152: AnswerLayers zet de kop
  // en de chip is de knop. De prop staat er nog om die afspraak leesbaar te
  // maken op de aanroepplek.
  void embedded
  return <div className={s.rtFlow}><TraceFeed steps={steps} /></div>
}

// De tikkende klok van een lopende run. Staat sinds v1.152 in de metaregel van
// het bericht, naast de fase en de kosten — daar hoort "hoe lang al" bij de
// verwachting ("kan 30–60 seconden duren") en niet boven de stappenlijst.
export function LiveElapsed({ startedAt = null }) {
  const started = startedAt ? new Date(startedAt).getTime() : null
  const startRef = useRef(Number.isFinite(started) ? started : Date.now())
  const [elapsedMs, setElapsedMs] = useState(Date.now() - startRef.current)
  useEffect(() => {
    // Alleen de klok van deze run: bij een reload staat `startedAt` in de rij,
    // dus de teller loopt door waar hij was in plaats van bij 0,0 s te beginnen.
    startRef.current = Number.isFinite(started) ? started : Date.now()
    setElapsedMs(Date.now() - startRef.current)
    const id = setInterval(() => setElapsedMs(Date.now() - startRef.current), 200)
    return () => clearInterval(id)
  }, [started])
  return <span className={s.rtTimer}>{(elapsedMs / 1000).toFixed(1).replace('.', ',')} s</span>
}

const hasDetails = (step) => Boolean(step?.findings?.length || step?.args)

function TraceFeed({ steps, live = false }) {
  // userOpen[i] = expliciete keuze van Jelle; wint van de auto-stand.
  // Auto-stand: alleen de HUIDIGE (laatste) stap staat open — zodra een
  // nieuwe stap binnenkomt klapt de vorige dus vanzelf in.
  const [userOpen, setUserOpen] = useState({})
  const [tailOnly, setTailOnly] = useState(true)
  const endRef = useRef(null)
  useEffect(() => {
    if (live) endRef.current?.scrollIntoView({ behavior: 'auto', block: 'nearest' })
  }, [steps?.length, live])

  const lastIdx = steps.length - 1
  // Live in P2: de laatste drie stappen plus één regel voor wat al af is.
  const hiddenCount = live && tailOnly ? Math.max(0, steps.length - LIVE_TAIL) : 0
  const shown = hiddenCount > 0 ? steps.slice(hiddenCount) : steps

  return (
    <div className={`${s.rtFeed2} ${s.rtTimeline} ${live ? s.rtFeed2Live : ''}`}>
      {hiddenCount > 0 && (
        <button type="button" className={s.rtEarlier} onClick={() => setTailOnly(false)}>
          <span className={s.rtEarlierIco} aria-hidden>⋯</span>
          {hiddenCount} eerdere {hiddenCount === 1 ? 'stap' : 'stappen'}
          <span className={s.rtChev} aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
          </span>
        </button>
      )}
      {shown.map((step, j) => {
        const i = j + hiddenCount
        const isCurrent = live && i === lastIdx
        if (stepKind(step) === 'think') {
          return (
            <div key={i} className={`${s.rtThought} ${isCurrent ? s.rtThoughtActive : ''}`}>
              <span className={s.rtThoughtIco} aria-hidden>💭</span>
              <span>{step.label}</span>
            </div>
          )
        }
        const autoOpen = isCurrent && hasDetails(step)
        const isOpen = userOpen[i] ?? autoOpen
        return (
          <ToolRow
            key={i}
            step={step}
            current={isCurrent}
            open={isOpen}
            onToggle={hasDetails(step) ? () => setUserOpen(o => ({ ...o, [i]: !isOpen })) : undefined}
          />
        )
      })}
      <div ref={endRef} />
    </div>
  )
}

// Drie registers, één rij-component. `kind` bepaalt icoon, dempen en waar de
// reden staat: bij een vondst achter een gedachtestreepje op dezelfde regel,
// bij leeg-of-mislukt op een eigen regel eronder — want dat is de mededeling.
function ToolRow({ step, current, open, onToggle }) {
  const kind = stepKind(step)
  const findings = Array.isArray(step.findings) ? step.findings : []
  const detail = step.detail || ''
  // "0 resultaten (12 gescand) — de agenda kent geen afspraak in dit venster"
  // → de reden is het deel na het gedachtestreepje; de telling zelf is jargon.
  const reason = kind === 'empty' || kind === 'fail'
    ? (detail.split(/\s+—\s+/).slice(1).join(' — ') || detail.replace(/^mislukt:\s*/i, ''))
    : null

  return (
    <div className={`${s.rtTool2} ${kind === 'empty' ? s.rtRowEmpty : ''} ${kind === 'fail' ? s.rtRowFail : ''}`}>
      <button
        type="button"
        className={`${s.rtRow} ${onToggle ? s.rtRowClickable : ''}`}
        onClick={onToggle}
        disabled={!onToggle}
      >
        <span className={s.rtIco} aria-hidden>
          {current ? <span className={s.rtPulse} />
            : kind === 'fail' ? <span className={s.rtFail}>✕</span>
            : kind === 'empty' ? '–'
            : '✓'}
        </span>
        <span className={s.rtRowLabel}>
          {step.label}
          {kind === 'ok' && detail && <span className={s.rtRowDetail}> — {detail}</span>}
          {reason && <span className={s.rtRowReason}>{kind === 'fail' ? `mislukt: ${reason}` : reason}</span>}
        </span>
        {onToggle && (
          <span className={`${s.rtChev} ${open ? s.rtChevOpen : ''}`} aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
          </span>
        )}
      </button>
      {open && (
        <div className={s.rtDetails}>
          {step.args && <div className={s.rtArgs2}>zoekopdracht: {step.args}</div>}
          {findings.map((f, i) => (
            <div key={i} className={s.rtFinding}>
              <span className={s.rtFindingDate}>{fmtDate(f.datum)}</span>
              <span className={s.rtFindingName}>{f.naam || '—'}</span>
              {f.detail && <span className={s.rtFindingDetail}>{f.detail}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function fmtDate(d) {
  if (!d || typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(d)) return '·'
  const [y, m, day] = d.slice(0, 10).split('-')
  return `${day}-${m}-${y}`
}
