import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { STAGES, STAGE_DETAILS, SOURCE_LABELS } from '../../../lib/pijplijn'
import { relativeTime } from '../../../lib/dateFormat'

/**
 * PijplijnStepDetail — het paneel onder de flow als je op een stap klikt.
 *
 * Vaste delen: uitleg, tabellen/RPC's. Per stap komt daar het live blok bij
 * (versheid per bron, chunks per bron, edges/aliases, outcomes) uit de data
 * die PijplijnPage al had. Alleen de recente runs (agent_runs) en, op
 * Retrieve, de laatste context_bundles worden hier apart opgehaald — dat is
 * de enige netwerkactie bij een klik.
 */
export default function PijplijnStepDetail({ stageId, data, onClose }) {
  const stage = STAGES.find(s => s.id === stageId)
  const detail = STAGE_DETAILS[stageId]
  const [runs, setRuns] = useState(null)
  const [bundles, setBundles] = useState(null)

  useEffect(() => {
    if (!detail) return
    let cancelled = false
    setRuns(null); setBundles(null)
    ;(async () => {
      try {
        if (detail.agents.length > 0) {
          const { data: rows } = await supabase.from('agent_runs')
            .select('agent_name, status, summary, started_at, completed_at')
            .in('agent_name', detail.agents)
            .order('started_at', { ascending: false }).limit(8)
          if (!cancelled) setRuns(rows ?? [])
        } else if (!cancelled) {
          setRuns([])
        }
        if (detail.bundleAudit) {
          const { data: rows } = await supabase.from('context_bundles')
            .select('bundle_id, intent, audience, total_chunks, build_ms, created_at, retrieval_meta')
            .order('created_at', { ascending: false }).limit(8)
          if (!cancelled) setBundles(rows ?? [])
        }
      } catch {
        if (!cancelled) { setRuns([]); setBundles([]) }
      }
    })()
    return () => { cancelled = true }
  }, [stageId, detail])

  if (!stage || !detail) return null

  return (
    <section className="pl-detail" aria-label={`Stap ${stage.nr}: ${stage.label}`}>
      <header className="pl-detail__head">
        <div>
          <div className="pl-detail__kicker">Stap {stage.nr} van 7</div>
          <h3 className="pl-detail__title">{stage.label} <span>— {stage.desc}</span></h3>
        </div>
        <button type="button" className="set-btn set-btn--ghost set-btn--sm" onClick={onClose}>Sluiten</button>
      </header>

      <p className="pl-detail__explainer">{detail.explainer}</p>
      <div className="pl-detail__source"><span>Tabellen / RPC's</span>{detail.source}</div>

      <LiveBlock stageId={stageId} data={data} />

      {detail.agents.length > 0 && (
        <div className="pl-block">
          <div className="pl-block__label">Recente runs</div>
          {runs === null && <div className="pl-muted">laden…</div>}
          {runs && runs.length === 0 && <div className="pl-muted">Geen runs gevonden voor deze agents.</div>}
          {runs && runs.length > 0 && runs.map((r, i) => (
            <div key={i} className="pl-run">
              <span className={`pl-run__dot pl-run__dot--${r.status || 'idle'}`} aria-hidden />
              <span className="pl-run__name">{r.agent_name}</span>
              <span className="pl-run__summary">{r.summary || '–'}</span>
              <span className="pl-mono">{relativeTime(r.completed_at || r.started_at) || '–'}</span>
            </div>
          ))}
        </div>
      )}

      {detail.bundleAudit && (
        <div className="pl-block">
          <div className="pl-block__label">Laatste context_bundles</div>
          {bundles === null && <div className="pl-muted">laden…</div>}
          {bundles && bundles.length === 0 && <div className="pl-muted">Nog geen bundels.</div>}
          {bundles && bundles.length > 0 && bundles.map(b => (
            <div key={b.bundle_id} className="pl-bundle">
              <span className="pl-bundle__intent">{b.intent}</span>
              <span className="pl-mono">{b.retrieval_meta?.strategy || '?'}</span>
              <span className="pl-muted">{b.audience || '–'}</span>
              <span className="pl-mono">{b.total_chunks} chunks</span>
              <span className="pl-mono">{b.build_ms} ms</span>
              <span className="pl-mono pl-right">{relativeTime(b.created_at) || '–'}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// Het live blok per stap. Alles komt uit `data` (usePijplijn); als dat er
// niet is, zegt het blok dat — geen placeholder-cijfers.
function LiveBlock({ stageId, data }) {
  if (!data) return <div className="pl-block"><div className="pl-muted">Live cijfers niet geladen.</div></div>

  if (stageId === 'sync') {
    const h = data.health
    if (!h) return <div className="pl-block"><div className="pl-muted">sync_health_all() gaf geen antwoord.</div></div>
    const keys = Object.keys(h).filter(k => k !== 'all_fresh' && k !== 'checked_at' && h[k] && typeof h[k] === 'object')
    return (
      <div className="pl-block">
        <div className="pl-block__label">Versheid per bron</div>
        <div className="pl-grid">
          {keys.map(k => {
            const v = h[k]
            const tone = v.is_fresh === true ? 'ok' : v.is_fresh === false ? 'err' : 'idle'
            return (
              <div key={k} className="pl-cell">
                <span className={`pl-run__dot pl-run__dot--${tone}`} aria-hidden />
                <span className="pl-cell__label">{SOURCE_LABELS[k] || k}</span>
                <span className="pl-cell__value">{v.source_count != null ? Number(v.source_count).toLocaleString('nl-NL') : '–'}</span>
                <span className="pl-cell__sub">{v.last_sync_at ? relativeTime(v.last_sync_at) : 'nooit'}</span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (stageId === 'chunk' || stageId === 'embed') {
    const rows = data.chunksPerSource || []
    return (
      <div className="pl-block">
        <div className="pl-block__label">
          {stageId === 'chunk' ? 'Chunks per bron' : 'Vectoren per bron'} · totaal {Number(data.chunksTotal ?? 0).toLocaleString('nl-NL')}
        </div>
        {rows.length === 0 ? <div className="pl-muted">Geen chunks gevonden.</div> : (
          <div className="pl-grid">
            {rows.map(r => (
              <div key={r.source} className="pl-cell">
                <span className="pl-cell__label">{SOURCE_LABELS[r.source] || r.source}</span>
                <span className="pl-cell__value">{Number(r.total).toLocaleString('nl-NL')}</span>
              </div>
            ))}
          </div>
        )}
        {stageId === 'embed' && <div className="pl-muted">Elke chunk draagt precies één vector; het aantal vectoren is dus het aantal chunks.</div>}
      </div>
    )
  }

  if (stageId === 'index') {
    return (
      <div className="pl-block">
        <div className="pl-block__label">Entity-graaf</div>
        <div className="pl-grid pl-grid--2">
          <div className="pl-cell"><span className="pl-cell__label">Edges (v_entity_edges_full)</span><span className="pl-cell__value">{fmt(data.edges)}</span></div>
          <div className="pl-cell"><span className="pl-cell__label">Aliases (entity_resolution)</span><span className="pl-cell__value">{fmt(data.resolutions)}</span></div>
        </div>
      </div>
    )
  }

  if (stageId === 'retrieve') {
    return (
      <div className="pl-block">
        <div className="pl-block__label">Retrieve-calls</div>
        <div className="pl-grid pl-grid--2">
          <div className="pl-cell"><span className="pl-cell__label">context_bundles · laatste 7 dagen</span><span className="pl-cell__value">{fmt(data.bundles7d)}</span></div>
        </div>
      </div>
    )
  }

  if (stageId === 'quality') {
    const o = data.outcomes
    if (!o || !o.total) return <div className="pl-block"><div className="pl-muted">Nog geen rag_outcomes gelogd — de trigger vult dit zodra er drafts beoordeeld worden.</div></div>
    const acc = o.byOutcome.accept || 0
    return (
      <div className="pl-block">
        <div className="pl-block__label">rag_outcomes</div>
        <div className="pl-grid">
          <div className="pl-cell"><span className="pl-cell__label">Totaal</span><span className="pl-cell__value">{fmt(o.total)}</span></div>
          <div className="pl-cell"><span className="pl-cell__label">Accept</span><span className="pl-cell__value">{fmt(acc)}</span></div>
          <div className="pl-cell"><span className="pl-cell__label">Amend</span><span className="pl-cell__value">{fmt(o.byOutcome.amend || 0)}</span></div>
          <div className="pl-cell"><span className="pl-cell__label">Reject</span><span className="pl-cell__value">{fmt(o.byOutcome.reject || 0)}</span></div>
          <div className="pl-cell"><span className="pl-cell__label">Acceptance</span><span className="pl-cell__value">{o.total ? `${((acc / o.total) * 100).toFixed(1)}%` : '–'}</span></div>
          <div className="pl-cell"><span className="pl-cell__label">Gem. chunks</span><span className="pl-cell__value">{o.avgChunks ?? '–'}</span></div>
        </div>
      </div>
    )
  }

  return null
}

function fmt(v) {
  return v == null ? '–' : Number(v).toLocaleString('nl-NL')
}
