import { useState, useEffect, useRef } from 'react'
import s from './zoeken.module.css'

// ReasoningTrace v2 (v2.5, 2026-07-17) — het onderzoek als chat-flow, niet
// als statisch blok (review-ronde 6 Jelle).
//   💭 gedachten   = gewone cursieve tekstregels, alsof Maestro praat.
//   🔧 tool-calls  = compacte regels die automatisch INKLAPPEN zodra er een
//                    nieuwe stap binnenkomt — alleen de huidige staat open;
//                    alles blijft achteraf per klik uitklapbaar (vondsten +
//                    zoekopdracht). Neutrale kleuren, geen kaders.
// Live = timer-regel + feed; after = ingeklapt achter "Onderzoek: …".
// Steps uit rag-chat: {t, stage, label, detail?, args?, findings?}.

export default function ReasoningTrace({ steps, live = false, timingMs = null, webSearch = false }) {
  const [open, setOpen] = useState(false)
  const hasSteps = Array.isArray(steps) && steps.length > 0

  if (live) {
    return (
      <div className={s.rtFlow}>
        <LiveTimer hasSteps={hasSteps} />
        {hasSteps
          ? <TraceFeed steps={steps} live />
          : (
            <div className={s.rtRow}>
              <span className={s.rtPulse} aria-hidden />
              <span className={s.rtRowLabel}>{webSearch ? 'Vraag interpreteren — bronnen + web…' : 'Vraag interpreteren…'}</span>
            </div>
          )}
      </div>
    )
  }

  if (!hasSteps) return null
  const secs = typeof timingMs === 'number' ? ` · ${(timingMs / 1000).toFixed(1)}s` : ''
  const nThoughts = steps.filter(st => st.stage === 'think').length
  const nTools = steps.filter(st => st.stage !== 'think' && (st.findings?.length || st.detail)).length
  const summary = [
    `${steps.length} ${steps.length === 1 ? 'stap' : 'stappen'}`,
    nThoughts > 0 ? `${nThoughts} ${nThoughts === 1 ? 'gedachte' : 'gedachten'}` : null,
    nTools > 0 ? `${nTools} tool-calls` : null,
  ].filter(Boolean).join(' · ')
  return (
    <div className={s.stepsSum}>
      <button type="button" className={`${s.stepsSumToggle} ${open ? s.stepsSumToggleOpen : ''}`} onClick={() => setOpen(v => !v)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
        Onderzoek: {summary}{secs}
      </button>
      {open && <div className={s.rtFlow}><TraceFeed steps={steps} /></div>}
    </div>
  )
}

function LiveTimer({ hasSteps }) {
  const [elapsedMs, setElapsedMs] = useState(0)
  const startRef = useRef(Date.now())
  useEffect(() => {
    startRef.current = Date.now()
    const id = setInterval(() => setElapsedMs(Date.now() - startRef.current), 200)
    return () => clearInterval(id)
  }, [])
  return (
    <div className={s.rtLiveHead}>
      <span className={s.rtTimer}>{(elapsedMs / 1000).toFixed(1)}s</span>
      <span>{hasSteps ? 'Maestro onderzoekt' : 'Maestro interpreteert de vraag'}</span>
    </div>
  )
}

const hasDetails = (step) => Boolean(step?.findings?.length || step?.args)

function TraceFeed({ steps, live = false }) {
  // userOpen[i] = expliciete keuze van Jelle; wint van de auto-stand.
  // Auto-stand: alleen de HUIDIGE (laatste) stap staat open — zodra een
  // nieuwe stap binnenkomt klapt de vorige dus vanzelf in.
  const [userOpen, setUserOpen] = useState({})
  const endRef = useRef(null)
  useEffect(() => {
    if (live) endRef.current?.scrollIntoView({ behavior: 'auto', block: 'nearest' })
  }, [steps?.length, live])
  const lastIdx = steps.length - 1
  return (
    <div className={`${s.rtFeed2} ${live ? s.rtFeed2Live : ''}`}>
      {steps.map((step, i) => {
        const isCurrent = live && i === lastIdx
        if (step.stage === 'think') {
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

function ToolRow({ step, current, open, onToggle }) {
  const failed = /mislukt:/i.test(step.detail || '')
  const findings = Array.isArray(step.findings) ? step.findings : []
  return (
    <div className={s.rtTool2}>
      <button
        type="button"
        className={`${s.rtRow} ${onToggle ? s.rtRowClickable : ''}`}
        onClick={onToggle}
        disabled={!onToggle}
      >
        <span className={s.rtIco} aria-hidden>
          {current ? <span className={s.rtPulse} /> : failed ? <span className={s.rtFail}>✕</span> : '✓'}
        </span>
        <span className={s.rtRowLabel}>
          {step.label}
          {step.detail && <span className={s.rtRowDetail}> — {step.detail}</span>}
        </span>
        {onToggle && (
          <span className={`${s.rtChev} ${open ? s.rtChevOpen : ''}`} aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
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
