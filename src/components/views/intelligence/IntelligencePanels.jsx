import { formatEur, DECISIONS } from '../../../lib/intelligence'
import { relativeTime } from '../../../lib/dateFormat'
import Stat from './Stat'
import styles from './IntelligenceView.module.css'

/**
 * OutcomesPanel — kort baseline-overzicht van rag_outcomes (totaal + accept/
 * amend/reject + acceptance-rate + avg chunks).
 */
export function OutcomesPanel({ outcomes }) {
  if (!outcomes) return <div className="muted text-md">laden…</div>
  if (outcomes.total === 0) {
    return (
      <div className={`card ${styles.cardSubtle}`}>
        Nog geen rag_outcomes gelogd. Trigger op <code>autodraft_decisions</code> vult dit
        automatisch zodra je drafts gaat beoordelen (send / amend / ignore).
      </div>
    )
  }
  const totalAcc = outcomes.byOutcome.accept || 0
  const totalAmd = outcomes.byOutcome.amend || 0
  const totalRej = outcomes.byOutcome.reject || 0
  const accRate = outcomes.total > 0 ? (totalAcc / outcomes.total) * 100 : 0
  return (
    <div className="stack stack--sm">
      <div className={styles.gridAuto}>
        <Stat label="Total" value={outcomes.total} />
        <Stat label="Accept" value={totalAcc} color="var(--success)" />
        <Stat label="Amend"  value={totalAmd} color="var(--warning)" />
        <Stat label="Reject" value={totalRej} color="var(--text-muted)" />
        <Stat label="Acceptance" value={`${accRate.toFixed(1)}%`} />
        <Stat label="Avg chunks" value={outcomes.avgChunks?.toFixed(1) ?? '-'} />
      </div>
      <div className="muted text-md">
        Bron: <code>rag_outcomes</code> — log van retrieved chunks per skill-decision.
      </div>
    </div>
  )
}

/**
 * CostPanel — token-kosten via context_bundles in afgelopen 30d, plus
 * vandaag + 30d aantallen calls/tokens.
 */
export function CostPanel({ stats }) {
  if (!stats) return <div className="muted text-md">laden…</div>
  return (
    <div className="stack stack--sm">
      <div className={styles.gridAuto}>
        <Stat label="Vandaag" value={formatEur(stats.eurToday)} />
        <Stat label="Calls vandaag" value={stats.callsToday} />
        <Stat label="Laatste 30d" value={formatEur(stats.eur30d)} />
        <Stat label="Calls 30d" value={stats.calls30d.toLocaleString()} />
        <Stat label="Tokens 30d" value={stats.tokens30d.toLocaleString()} />
      </div>
      <div className="muted text-md">
        Bron: <code>context_bundles.tokens_used</code> × $0.13/1M (text-embedding-3-large) × 0.93 EUR.
      </div>
    </div>
  )
}

/**
 * RecentRuns — kort lijstje van laatste agent_runs (chunker, autodraft-rag-prefill, jellemind-embed).
 */
export function RecentRuns({ runs }) {
  if (!runs) return <div className="muted text-md">laden…</div>
  if (runs.length === 0) return <div className="muted text-md">geen recente runs</div>
  return (
    <div>
      {runs.map((r, i) => {
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
  )
}

/**
 * FailingQueriesPanel — bundles met 0 chunks of avg-similarity < 0.5.
 * Lijstvorm met flag-pill links.
 */
export function FailingQueriesPanel({ rows }) {
  if (!rows) return <div className="muted text-md">laden…</div>
  if (rows.length === 0) {
    return (
      <div className={`card ${styles.cardSubtle}`}>
        Geen recente bundles met 0 chunks of avg-similarity &lt; 0.5 — retrieval ziet er goed uit.
      </div>
    )
  }
  return (
    <div>
      {rows.map(r => {
        const zero = (r.total_chunks ?? 0) === 0
        const lowSim = !zero && r.avg_top_similarity != null && r.avg_top_similarity < 0.5
        const flag = zero ? '0 chunks' : lowSim ? `top sim ${(r.avg_top_similarity * 100).toFixed(0)}%` : '?'
        const tone = zero ? 'error' : 'warning'
        return (
          <div key={r.bundle_id} className={`${styles.listRow} ${styles.failingRow}`}>
            <span className={styles.listFlag} data-tone={tone}>{flag}</span>
            <span style={{ fontWeight: 600 }}>{r.intent}</span>
            <span className={styles.listMuted}>{r.audience || '–'}</span>
            <span className={styles.listMono}>{r.build_ms}ms</span>
            <span className={styles.listMono} style={{ textAlign: 'right' }}>{relativeTime(r.created_at) || '–'}</span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * DecisionsLog — vaste lijst van architectuur-besluiten uit
 * current_architecture.md §8.
 */
export function DecisionsLog() {
  return (
    <div className="stack stack--sm">
      {DECISIONS.map(d => (
        <div key={d.id} className={styles.decisionRow}>
          <div className={styles.decisionId} data-status={d.status === '✓' ? 'ok' : ''}>{d.id}</div>
          <div style={{ flex: 1 }}>
            <div className={styles.decisionTitle}>{d.title}</div>
            <div className={styles.decisionBody}>{d.body}</div>
          </div>
          <span className={styles.decisionStatus} data-status={d.status === '✓' ? 'ok' : ''}>{d.status}</span>
        </div>
      ))}
    </div>
  )
}
