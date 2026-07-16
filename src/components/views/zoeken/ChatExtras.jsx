import { useState, useEffect, useRef } from 'react'
import s from './zoeken.module.css'
import { Ico } from './Icons'
import { makeAnswerParts } from '../../../lib/rag'

// Loading-state met seconde-teller.
//
// v5.1 (2026-07-07): rag-chat streamt nu ECHTE reasoning-steps als SSE
// {type:'status'} — route-besluit, per tool "Agenda doorzocht: 2 resultaten
// (113 gescand)", tijdlijn/vector/rerank. Als die er zijn tonen we die live;
// de laatste is de actieve. Zolang er nog geen server-step binnen is (eerste
// ~1s, of het non-stream fallback-pad) valt de weergave terug op één
// neutrale "Aan de slag…"-regel — geen verzonnen fases meer.
const STAGE_ICON = { router: Ico.sliders, route: Ico.sliders, entity: Ico.user, data: Ico.search, write: Ico.sparkle, think: <span aria-hidden>💭</span> }

export function LoadingSteps({ steps = null, webSearch = false } = {}) {
  const [elapsedMs, setElapsedMs] = useState(0)
  const startRef = useRef(Date.now())
  useEffect(() => {
    startRef.current = Date.now()
    const id = setInterval(() => setElapsedMs(Date.now() - startRef.current), 200)
    return () => clearInterval(id)
  }, [])
  const seconds = (elapsedMs / 1000).toFixed(1)
  const live = Array.isArray(steps) && steps.length > 0
  const shown = live ? steps.slice(-8) : [{ label: webSearch ? 'Aan de slag — bronnen + web' : 'Aan de slag…', stage: 'data' }]
  const hint = live ? 'Maestro voert de stappen live uit' : (webSearch ? 'RAG + web-search draait — typisch 6–12s' : 'RAG-pipeline draait')
  return (
    <div className={s.loadingSteps}>
      <div className={s.loadingHeader}>
        <span className={s.loadingTimer}>{seconds}s</span>
        <span className={s.loadingHint}>{hint}</span>
      </div>
      {shown.map((step, i) => {
        const active = i === shown.length - 1
        const done = !active
        const think = step.stage === 'think'
        return (
          <div key={`${step.label}-${i}`} className={`${s.loadingStep} ${active ? s.loadingStepActive : ''} ${done ? s.loadingStepDone : ''} ${think ? s.loadingStepThink : ''}`}>
            <span className={s.loadingStepDot} />
            <span className={s.loadingStepIcon}>{think ? STAGE_ICON.think : (done ? <span className={s.loadingStepCheck}>✓</span> : (STAGE_ICON[step.stage] || Ico.search))}</span>
            <span>
              {step.label}{active && !think ? '…' : ''}
              {step.detail && <span className={s.loadingStepDetail}> — {step.detail}</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// Na afloop: compacte, uitklapbare samenvatting van de echte stappen —
// "hoe kwam Maestro aan dit antwoord". Boven het antwoord, subtiel.
export function StepsSummary({ steps, timingMs }) {
  const [open, setOpen] = useState(false)
  if (!Array.isArray(steps) || steps.length === 0) return null
  const secs = typeof timingMs === 'number' ? ` · ${(timingMs / 1000).toFixed(1)}s` : ''
  return (
    <div className={s.stepsSum}>
      <button type="button" className={`${s.stepsSumToggle} ${open ? s.stepsSumToggleOpen : ''}`} onClick={() => setOpen(v => !v)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
        {steps.length} {steps.length === 1 ? 'stap' : 'stappen'} uitgevoerd{secs}
      </button>
      {open && (
        <div className={s.stepsSumList}>
          {steps.map((step, i) => (
            <div key={i} className={`${s.loadingStep} ${s.loadingStepDone} ${step.stage === 'think' ? s.loadingStepThink : ''}`}>
              <span className={s.loadingStepIcon}>{step.stage === 'think' ? <span aria-hidden>💭</span> : <span className={s.loadingStepCheck}>✓</span>}</span>
              <span>
                {step.label}
                {step.detail && <span className={s.loadingStepDetail}> — {step.detail}</span>}
                {typeof step.t === 'number' && <span className={s.stepsSumT}>{(step.t / 1000).toFixed(1)}s</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Retrieval-pipeline debug-blok: chunks gevonden → na rerank → gebruikt.
// Cite-counts worden client-side afgeleid uit antwoord-tekst.
export function RetrievalDebug({ m }) {
  const [open, setOpen] = useState(false)
  const cites = m.citations || []
  const usedNs = new Set()
  for (const p of makeAnswerParts(m.content || '')) {
    if (p.type === 'cite') usedNs.add(p.n)
  }
  const usedCount = usedNs.size
  const totalChunks = m.chunk_count ?? cites.length
  const reranked = cites.length
  const tokens = m.tokens
  const timing = m.timing_ms ? `${(m.timing_ms / 1000).toFixed(2)} s` : null
  const strategy = m.retrieval_strategy

  if (totalChunks === 0 && reranked === 0) return null

  return (
    <div className={s.dbgWrap}>
      <button type="button" className={`${s.dbgToggle} ${open ? s.dbgToggleOpen : ''}`} onClick={() => setOpen(v => !v)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
        Retrieval-pipeline · {totalChunks} → {reranked} → {usedCount}
      </button>
      {open && (
        <dl className={`${s.dbgPanel} ${s.dbgRow}`}>
          <dt>Chunks gevonden</dt>
          <dd>
            <strong>{totalChunks}</strong>
            {totalChunks !== reranked && <span style={{ color: 'var(--neutral-500)' }}> (vóór per-source-cap)</span>}
          </dd>
          <dt>Na rerank / cap</dt>
          <dd><strong>{reranked}</strong> chunks teruggegeven aan model</dd>
          <dt>Gebruikt in antwoord</dt>
          <dd>
            <strong>{usedCount}</strong>
            {usedCount !== reranked && <span style={{ color: 'var(--neutral-500)' }}> (rest is context, niet geciteerd)</span>}
          </dd>
          {strategy && (<><dt>Retrieval-strategie</dt><dd>{strategy}</dd></>)}
          {m.debug_pipeline && (
            <>
              <dt>RPC-chunks</dt>
              <dd>
                <strong>{m.debug_pipeline.rpc_chunks ?? 0}</strong>
                {m.debug_pipeline.rpc_fetch_ms != null && (
                  <span style={{ color: 'var(--neutral-500)' }}> · {m.debug_pipeline.rpc_fetch_ms}ms</span>
                )}
                {m.debug_pipeline.rpc_error && (
                  <span style={{ color: '#991b1b' }}> · {m.debug_pipeline.rpc_error}</span>
                )}
              </dd>
              <dt>Vector-chunks</dt>
              <dd>
                <strong>{m.debug_pipeline.vector_chunks ?? 0}</strong>
                {m.debug_pipeline.vector_fetch_ms != null && (
                  <span style={{ color: 'var(--neutral-500)' }}> · {m.debug_pipeline.vector_fetch_ms}ms</span>
                )}
              </dd>
              {m.debug_pipeline.pre_rerank_chunks != null && (
                <>
                  <dt>Vóór rerank</dt>
                  <dd><strong>{m.debug_pipeline.pre_rerank_chunks}</strong> chunks samengevoegd</dd>
                </>
              )}
              <dt>Rerank (Cohere v3.5)</dt>
              <dd>
                {m.debug_pipeline.rerank_used
                  ? <><strong>✓ actief</strong>{m.debug_pipeline.rerank_ms != null && <span style={{ color: 'var(--neutral-500)' }}> · {m.debug_pipeline.rerank_ms}ms</span>}</>
                  : <span style={{ color: 'var(--neutral-500)' }}>skipped {m.debug_pipeline.rerank_error ? `(${m.debug_pipeline.rerank_error.slice(0,60)})` : '(geen API-key)'}</span>}
              </dd>
              {m.debug_pipeline.entity_resolve_ms != null && (
                <>
                  <dt>Entity-resolve</dt>
                  <dd>{m.debug_pipeline.entity_resolve_ms}ms {m.debug_pipeline.entity_found ? '· ✓' : '· geen match'}</dd>
                </>
              )}
            </>
          )}
          {m.entity_used && (
            <>
              <dt>Entity-aware</dt>
              <dd>{m.entity_used.entity_type}: <strong>{m.entity_used.name}</strong> · gematched op "{m.entity_used.matched_term}"{m.entity_used.duplicate_count ? ` (${m.entity_used.duplicate_count} duplicates)` : ''}</dd>
            </>
          )}
          {m.knowledge_lessons?.length > 0 && (
            <>
              <dt>JelleMind lessons</dt>
              <dd>{m.knowledge_lessons.length} lesson{m.knowledge_lessons.length === 1 ? '' : 's'} toegevoegd aan context</dd>
            </>
          )}
          {tokens && (<><dt>Tokens</dt><dd>in: {tokens.chat_in ?? tokens.input ?? '—'} · uit: {tokens.chat_out ?? tokens.output ?? '—'}</dd></>)}
          {timing && (<><dt>Tijd</dt><dd>{timing}</dd></>)}
          {m.bundle_id && (<><dt>Bundle</dt><dd style={{ fontSize: 10.5, wordBreak: 'break-all' }}>{m.bundle_id}</dd></>)}
        </dl>
      )}
    </div>
  )
}

// Welke citation-nummers staan echt in een assistant-message?
export function usedNsFor(msg) {
  const set = new Set()
  if (!msg?.content) return set
  for (const p of makeAnswerParts(msg.content)) {
    if (p.type === 'cite') set.add(p.n)
  }
  return set
}
