import { useState, useEffect, useRef } from 'react'
import s from './zoeken.module.css'
import { Ico } from './Icons'

// ReasoningTrace (v2.3, 2026-07-17) — dé weergave van het agent-onderzoek.
// Vervangt LoadingSteps + StepsSummary door één chronologische feed:
//   💭 gedachten (de agent praat hardop tegen zichzelf)
//   🔎 tool-calls met detail ("34 resultaten (121 gescand)"), de gebruikte
//      argumenten én de top-vondsten per call (uitklapbaar)
//   ▸ route/entity/schrijf-stappen als subtiele regels
// Twee modi:
//   live   — tijdens de run: timer-header, alles zichtbaar, laatste stap pulst,
//            vondsten van de laatste tool-call staan open.
//   after  — bij/na het antwoord: ingeklapt achter "Onderzoek · N stappen · Xs".
// Steps komen uit rag-chat v5.3: {t, stage, label, detail?, args?, findings?}.

const STAGE_ICON = {
  router: Ico.sliders, route: Ico.sliders, entity: Ico.user,
  data: Ico.search, write: Ico.sparkle,
}

export default function ReasoningTrace({ steps, live = false, timingMs = null, webSearch = false }) {
  const [open, setOpen] = useState(false)
  const hasSteps = Array.isArray(steps) && steps.length > 0

  if (live) {
    return (
      <div className={s.rtWrap}>
        <LiveHeader webSearch={webSearch} hasSteps={hasSteps} />
        {hasSteps
          ? <TraceFeed steps={steps} live />
          : (
            <div className={`${s.loadingStep} ${s.loadingStepActive}`}>
              <span className={s.loadingStepDot} />
              <span className={s.loadingStepIcon}>{Ico.sliders}</span>
              <span>{webSearch ? 'Vraag interpreteren — bronnen + web…' : 'Vraag interpreteren…'}</span>
            </div>
          )}
      </div>
    )
  }

  if (!hasSteps) return null
  const secs = typeof timingMs === 'number' ? ` · ${(timingMs / 1000).toFixed(1)}s` : ''
  const nThoughts = steps.filter(st => st.stage === 'think').length
  const nTools = steps.filter(st => st.findings?.length || (st.stage === 'data' && st.detail)).length
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
      {open && <div className={s.rtWrap}><TraceFeed steps={steps} /></div>}
    </div>
  )
}

function LiveHeader({ webSearch, hasSteps }) {
  const [elapsedMs, setElapsedMs] = useState(0)
  const startRef = useRef(Date.now())
  useEffect(() => {
    startRef.current = Date.now()
    const id = setInterval(() => setElapsedMs(Date.now() - startRef.current), 200)
    return () => clearInterval(id)
  }, [])
  return (
    <div className={s.loadingHeader}>
      <span className={s.loadingTimer}>{(elapsedMs / 1000).toFixed(1)}s</span>
      <span className={s.loadingHint}>
        {hasSteps ? 'Maestro onderzoekt — stappen live' : (webSearch ? 'Maestro interpreteert de vraag — incl. web' : 'Maestro interpreteert de vraag')}
      </span>
    </div>
  )
}

function TraceFeed({ steps, live = false }) {
  const endRef = useRef(null)
  useEffect(() => {
    if (live) endRef.current?.scrollIntoView({ behavior: 'auto', block: 'nearest' })
  }, [steps?.length, live])
  const lastFindingsIdx = live
    ? steps.reduce((acc, st, i) => (st.findings?.length ? i : acc), -1)
    : -1
  return (
    <div className={`${s.rtFeed} ${live ? s.rtFeedLive : ''}`}>
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1
        if (step.stage === 'think') return <ThinkStep key={i} step={step} active={live && isLast} />
        return (
          <ToolStep
            key={i}
            step={step}
            active={live && isLast}
            defaultOpen={live && i === lastFindingsIdx}
          />
        )
      })}
      <div ref={endRef} />
    </div>
  )
}

// 💭 De agent praat hardop: volledige gedachte als cursief blok.
function ThinkStep({ step, active }) {
  return (
    <div className={`${s.rtThink} ${active ? s.rtThinkActive : ''}`}>
      <span className={s.rtThinkIco} aria-hidden>💭</span>
      <span>{step.label}</span>
    </div>
  )
}

// 🔎 Tool-call / pipeline-stap: label + detail, en indien aanwezig de
// argumenten (subtiel) en de top-vondsten (uitklapbaar).
function ToolStep({ step, active, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => { if (defaultOpen) setOpen(true) }, [defaultOpen])
  const findings = Array.isArray(step.findings) ? step.findings : []
  const clickable = findings.length > 0
  const failed = /mislukt:/i.test(step.detail || '')
  return (
    <div className={s.rtTool}>
      <button
        type="button"
        className={`${s.loadingStep} ${s.rtToolRow} ${active ? s.loadingStepActive : s.loadingStepDone} ${clickable ? s.rtToolClickable : ''}`}
        onClick={clickable ? () => setOpen(v => !v) : undefined}
        disabled={!clickable}
      >
        <span className={s.loadingStepDot} />
        <span className={s.loadingStepIcon}>
          {active ? (STAGE_ICON[step.stage] || Ico.search)
            : failed ? <span className={s.rtFail}>✕</span>
            : <span className={s.loadingStepCheck}>✓</span>}
        </span>
        <span className={s.rtToolLabel}>
          {step.label}{active ? '…' : ''}
          {step.detail && <span className={s.loadingStepDetail}> — {step.detail}</span>}
        </span>
        {clickable && (
          <span className={`${s.rtChevron} ${open ? s.rtChevronOpen : ''}`} aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          </span>
        )}
      </button>
      {open && (
        <div className={s.rtFindings}>
          {step.args && <div className={s.rtArgs}>zoekopdracht: {step.args}</div>}
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
