import { useState, useEffect, useRef } from 'react'
import s from './zoeken.module.css'
import { Ico } from './Icons'
import { makeAnswerParts } from '../../../lib/rag'

// Loading-state met seconde-teller. We weten de echte server-stages niet
// (rag-chat streamt geen progressie), maar wel hoe lang het al duurt — dat
// is realistischer dan fake step-timers. Stages worden alleen visueel
// "geschat" op basis van verstreken tijd: retrieval+rerank is meestal de
// eerste 1-3s, generate de rest. Bij entity-aware kan retrieval langer duren.
//
// Sinds 2026-05-21: bij webSearch=on krijgt de UI ook een 'Web doorzoeken'-
// stage die parallel loopt met bronnen ophalen (Live Search via gpt-4o).
export function LoadingSteps({ webSearch = false } = {}) {
  const [elapsedMs, setElapsedMs] = useState(0)
  const startRef = useRef(Date.now())
  useEffect(() => {
    startRef.current = Date.now()
    const id = setInterval(() => setElapsedMs(Date.now() - startRef.current), 200)
    return () => clearInterval(id)
  }, [])
  const labels = webSearch
    ? [
        { label: 'Interne bronnen ophalen',         icon: Ico.search,  start: 0,    typical: 2500 },
        { label: 'Web doorzoeken (Live Search)',    icon: Ico.globe,   start: 1000, typical: 4000 },
        { label: 'Rerank op relevantie (Cohere)',   icon: Ico.sliders, start: 5500, typical: 800 },
        { label: 'Antwoord schrijven met citaten',  icon: Ico.sparkle, start: 6500, typical: 9999999 },
      ]
    : [
        { label: 'Bronnen ophalen',                 icon: Ico.search,  start: 0,    typical: 2500 },
        { label: 'Rerank op relevantie (Cohere)',   icon: Ico.sliders, start: 2500, typical: 800 },
        { label: 'Antwoord schrijven met citaten',  icon: Ico.sparkle, start: 3500, typical: 9999999 },
      ]
  let stage = 0
  for (let i = labels.length - 1; i >= 0; i--) { if (elapsedMs > labels[i].start) { stage = i; break } }
  const seconds = (elapsedMs / 1000).toFixed(1)
  return (
    <div className={s.loadingSteps}>
      <div className={s.loadingHeader}>
        <span className={s.loadingTimer}>{seconds}s</span>
        <span className={s.loadingHint}>{webSearch ? 'RAG + web-search draait — typisch 6–12s' : 'RAG-pipeline draait — typisch 3–8s'}</span>
      </div>
      {labels.map((step, i) => {
        const active = i === stage
        const done = i < stage
        return (
          <div key={i} className={`${s.loadingStep} ${active ? s.loadingStepActive : ''} ${done ? s.loadingStepDone : ''}`}>
            <span className={s.loadingStepDot} />
            <span className={s.loadingStepIcon}>{done ? <span className={s.loadingStepCheck}>✓</span> : step.icon}</span>
            <span>{step.label}{active ? '…' : ''}</span>
          </div>
        )
      })}
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
