import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { PIPELINE_STAGES, STAGE_DETAILS } from '../../../lib/intelligence'
import { relativeTime } from '../../../lib/dateFormat'
import styles from './IntelligenceView.module.css'

/**
 * PipelineDiagram — 7-stage flow met selecteerbare stappen. Klik op een
 * stage opent StageDetail eronder met explainer + recente runs (en bundles
 * voor de retrieve-stap).
 */
export default function PipelineDiagram({ counts, selectedStage, onSelect }) {
  return (
    <>
      <div className={styles.pipeline}>
        {PIPELINE_STAGES.map((stage, i) => {
          const active = selectedStage === stage.id
          return (
            <div key={stage.id} className={styles.pipelineItem}>
              <button
                type="button"
                onClick={() => onSelect(active ? null : stage.id)}
                className={styles.pipelineBtn}
                data-active={active ? '1' : '0'}
                title="Klik voor uitleg + recente runs"
              >
                <div className={styles.pipelineLabel}>{i + 1}. {stage.label}</div>
                <div className={styles.pipelineDesc}>{stage.desc}</div>
                {counts?.[stage.id] != null && (
                  <div className={styles.pipelineCount}>{counts[stage.id]}</div>
                )}
              </button>
              {i < PIPELINE_STAGES.length - 1 && <div className={styles.pipelineArrow}>→</div>}
            </div>
          )
        })}
      </div>
      {selectedStage ? (
        <StageDetail stageId={selectedStage} onClose={() => onSelect(null)} />
      ) : (
        <div className={styles.pipelineHint}>Klik op een stap voor uitleg + recente runs.</div>
      )}
    </>
  )
}

function StageDetail({ stageId, onClose }) {
  const stage = PIPELINE_STAGES.find(s => s.id === stageId)
  const detail = STAGE_DETAILS[stageId]
  const [agentRuns, setAgentRuns] = useState(null)
  const [bundles, setBundles] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!stage || !detail) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        if (detail.agents.length > 0) {
          const { data } = await supabase.from('agent_runs')
            .select('agent_name, status, summary, started_at, completed_at')
            .in('agent_name', detail.agents)
            .order('started_at', { ascending: false }).limit(8)
          if (!cancelled) setAgentRuns(data ?? [])
        } else if (!cancelled) {
          setAgentRuns([])
        }
        if (detail.bundleAudit) {
          const { data } = await supabase.from('context_bundles')
            .select('bundle_id, intent, audience, total_chunks, build_ms, reranked, created_at, retrieval_meta')
            .order('created_at', { ascending: false }).limit(8)
          if (!cancelled) setBundles(data ?? [])
        }
      } catch {
        if (!cancelled) { setAgentRuns([]); setBundles([]) }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [stageId, stage, detail])

  if (!stage || !detail) return null

  return (
    <div className={styles.stageDetail}>
      <div className={styles.stageDetailHead}>
        <h3 className={styles.stageDetailTitle}>
          {stage.label} <span className={styles.stageDetailDesc}>— {stage.desc}</span>
        </h3>
        <button type="button" onClick={onClose} className={styles.closeBtn}>Sluit ✕</button>
      </div>
      <div className={styles.stageDetailExplainer}>{detail.explainer}</div>
      <div className={styles.stageDetailSource}>Tabellen / RPC's: {detail.source}</div>

      {detail.agents.length > 0 && (
        <div>
          <div className={styles.stageSubLabel}>Recente runs (top 8)</div>
          {loading && !agentRuns && <div className="muted text-md">laden…</div>}
          {agentRuns && agentRuns.length === 0 && <div className="muted text-md">Geen runs zichtbaar in deze tijdsperiode.</div>}
          {agentRuns && agentRuns.length > 0 && (
            <div>
              {agentRuns.map((r, i) => {
                const tone = r.status === 'success' ? 'success' : r.status === 'warning' ? 'warning' : r.status === 'error' ? 'error' : ''
                return (
                  <div key={i} className={`${styles.listRow} ${styles.runRow}`}>
                    <div className={styles.runLeft}>
                      <span className={styles.runStatus} data-tone={tone} />
                      <span className={styles.runName}>{r.agent_name}</span>
                      <span className={styles.runSummary}>{r.summary || '–'}</span>
                    </div>
                    <span className={styles.listMono}>{relativeTime(r.completed_at || r.started_at) || '–'}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {detail.bundleAudit && (
        <div>
          <div className={styles.stageSubLabel}>Recente context_bundles (laatste 8 RAG-calls)</div>
          {loading && !bundles && <div className="muted text-md">laden…</div>}
          {bundles && bundles.length === 0 && <div className="muted text-md">Nog geen bundles geproduceerd.</div>}
          {bundles && bundles.length > 0 && (
            <div>
              {bundles.map(b => {
                const strategy = b.retrieval_meta?.strategy || '?'
                return (
                  <div key={b.bundle_id} className={`${styles.listRow} ${styles.bundleRow}`}>
                    <span style={{ fontWeight: 600 }}>{b.intent}</span>
                    <span className={styles.listMono}>{strategy}</span>
                    <span className={styles.listMuted}>{b.audience || '–'}</span>
                    <span className={styles.listMono}>{b.total_chunks} chunks</span>
                    <span className={styles.listMono}>{b.build_ms}ms</span>
                    <span className={styles.listMono} style={{ textAlign: 'right' }}>
                      {relativeTime(b.created_at) || '–'}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
