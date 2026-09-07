import { useState } from 'react'
import a from './answer-layers.module.css'
import { RetrievalDebug } from './ChatExtras'
import { stepKind } from '../../../lib/answerLayers'

// =============================================================================
// TechnicalPanel — de Developer-laag (spoor 08, 1a–1g "alles ja")
// =============================================================================
// Hier landt alles wat tot v1.151 in de klantweergave stond: "24 chunks
// gelezen", "87 % confidence", "~4,2k tokens", de retrieval-pipeline met
// RPC/Cohere/bundle-id, de agentic-banner met toolnamen en modelnaam, de
// telling "9 stappen · 2 gedachten · 5 tool-calls", en de effort/hops/tool-calls
// die RunBudgetLine eerst in de metaregel zette.
//
// Niets is verdwenen. `RetrievalDebug` staat hier onderaan letterlijk zoals hij
// was — inclusief zijn eigen uitklapper — zodat de pipeline-cijfers exact
// hetzelfde blijven lezen, alleen één laag dieper.
//
// Het register is bewust mono en gedempt (H5): lekt hier ooit iets terug naar de
// klantlaag, dan valt dat op omdat het er niet uitziet als de rest.
//
// Zichtbaar voor owner (ASK-JELLE punt 8, default "owner en admin"); de globale
// schakelaar in Instellingen is een aparte stap en zit niet in dit spoor.
// =============================================================================

const fmtMs = (ms) => (typeof ms === 'number' ? ms.toLocaleString('nl-NL') : null)
const short = (id) => (id ? `${String(id).slice(0, 4)}…${String(id).slice(-4)}` : null)

function CopyId({ label, value }) {
  const [done, setDone] = useState(false)
  if (!value) return null
  return (
    <>
      {label} {short(value)}
      <button
        type="button"
        className={a.copyId}
        title={value}
        onClick={() => {
          try { navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1400) } catch { /* ignore */ }
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 012-2h8" /></svg>
        {done ? 'gekopieerd' : 'kopieer'}
      </button>
    </>
  )
}

function Row({ term, children }) {
  if (children == null || children === false) return null
  return (<><dt>{term}</dt><dd>{children}</dd></>)
}

export default function TechnicalPanel({ m }) {
  const spent = m.spent || null
  const budget = m.budget || null
  const cov = m.envelope?.coverage || null
  const steps = Array.isArray(m.steps) ? m.steps : []
  const tokens = m.tokens || null
  const totalMs = (typeof m.timing_ms === 'object' && m.timing_ms) ? m.timing_ms.total : m.timing_ms

  const usd = typeof spent?.usd === 'number' ? `$${spent.usd.toFixed(4).replace('.', ',')}` : null
  const nThink = steps.filter(st => st.stage === 'think').length
  const nTools = steps.filter(st => st.stage !== 'think').length

  return (
    <div className={a.dev}>
      <div className={a.devHead}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6l-5 6 5 6M16 6l5 6-5 6" /></svg>
        technisch
        <span className={a.who}>alleen owner</span>
      </div>
      <dl className={a.devGrid}>
        <Row term="route">
          {(m.envelope?.route || m.analytics?.route || m.route) && (
            <>
              <strong>{m.envelope?.route || m.analytics?.route || m.route}</strong>
              {m.retrieval_strategy && <span className={a.devMute}> — {m.retrieval_strategy}</span>}
              {budget?.source && <span className={a.devMute}> · budget.source = {budget.source}</span>}
            </>
          )}
        </Row>
        <Row term="effort · budget">
          {(m.effort || budget) && (
            <>
              {m.effort || '?'}
              {budget && (
                <span className={a.devMute}>
                  {' → '}{budget.tool_calls ?? '?'} tool-calls · {budget.wall_ms ? `${Math.round(budget.wall_ms / 1000)} s` : '?'} · ${budget.usd ?? '?'}
                  {budget.hops_max ? ` · max ${budget.hops_max} hops` : ''}
                </span>
              )}
            </>
          )}
        </Row>
        <Row term="besteed">
          {(spent || totalMs) && (
            <>
              {typeof spent?.tool_calls === 'number' && `${spent.tool_calls} tool-calls · `}
              {fmtMs(totalMs ?? spent?.wall_ms)} ms
              {usd && <> · <strong>{usd}</strong></>}
              {typeof spent?.hops === 'number' && <span className={a.devMute}> · {spent.hops} hop{spent.hops === 1 ? '' : 's'}</span>}
            </>
          )}
        </Row>
        <Row term="modellen">{m.model || null}</Row>
        <Row term="tokens">
          {tokens && (
            <>
              in {tokens.chat_in ?? tokens.input ?? '—'} · uit {tokens.chat_out ?? tokens.output ?? '—'}
              {spent?.tokens?.embed_tokens != null && <span className={a.devMute}> · embed {spent.tokens.embed_tokens}</span>}
              {spent?.tokens?.cohere_calls != null && <span className={a.devMute}> · cohere {spent.tokens.cohere_calls}</span>}
            </>
          )}
        </Row>
        <Row term="chunks · confidence">
          {(m.chunk_count != null || m.confidence != null) && (
            <>
              {m.chunk_count != null && `${m.chunk_count} chunks gelezen`}
              {m.confidence != null && <span className={a.devMute}>{m.chunk_count != null ? ' · ' : ''}{Math.round(m.confidence * 100)} % confidence</span>}
            </>
          )}
        </Row>
        <Row term="coverage">
          {cov && (
            <>
              searched: {(cov.searched || []).join(', ') || '—'}
              <span className={a.devMute}> · reason: {cov.reason ?? 'null'}</span>
              {cov.rows_returned != null && <span className={a.devMute}> · rows: {cov.rows_returned}</span>}
            </>
          )}
        </Row>
        <Row term="trace">
          {steps.length > 0 && (
            <span className={a.devMute}>{steps.length} stappen · {nThink} gedachten · {nTools} tool-calls</span>
          )}
        </Row>
        <Row term="stappen (ms)">
          {steps.length > 0 && (
            <div className={a.devSteps}>
              {steps.map((st, i) => (
                <div key={i} className={a.devStep}>
                  <b>{typeof st.t === 'number' ? fmtMs(st.t) : '·'}</b>
                  <span>
                    {st.label}
                    {st.args && <span className={a.devMute}> · args: {st.args}</span>}
                    {st.detail && <span className={a.devMute}> · {st.detail}</span>}
                    {stepKind(st) === 'fail' && <span className={a.devMute}> ⟵ fail</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Row>
        <Row term="ids">
          {(m.run_id || m.bundle_id || m.query_log_id) && (
            <>
              <CopyId label="run" value={m.run_id} />
              {m.bundle_id && <> <span className={a.devMute}>·</span> <CopyId label="bundle" value={m.bundle_id} /></>}
              {m.query_log_id && <> <span className={a.devMute}>·</span> <CopyId label="query-log" value={m.query_log_id} /></>}
            </>
          )}
        </Row>
      </dl>
      {/* 1a — de retrieval-pipeline staat hier ongewijzigd, één laag dieper. */}
      <div style={{ padding: '0 13px 10px' }}>
        <RetrievalDebug m={m} />
      </div>
    </div>
  )
}
