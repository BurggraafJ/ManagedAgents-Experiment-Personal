import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useSupabaseQuery } from '../../../hooks/useSupabaseQuery'
import { relativeTime } from '../../../lib/dateFormat'
import Stat from './Stat'
import styles from './IntelligenceView.module.css'

/**
 * IntelligenceObservabilityView — Claude-call telemetrie.
 *
 * Bron: claude_api_calls + claude_api_costs_7d view. Zie Confluence 450101261.
 * Empty-state als migration nog niet gedraaid is of nog geen calls gelogd zijn.
 *
 * Schrijft NIET — alleen visualisatie. Data komt van:
 *   - Edge Functions via _shared/anthropic-fetch.ts (inline)
 *   - Claude Code-sessies via scripts/parse-claude-session.cjs (achteraf)
 */
export default function IntelligenceObservabilityView() {
  const {
    data: costs, error: costsError, refresh: refreshCosts, loading: loadingCosts,
  } = useSupabaseQuery('claude_api_costs_7d', {
    select: '*',
    orderBy: ['cost_usd_7d', { ascending: false, nullsFirst: false }],
    limit: 100,
    initialData: null,
  })

  const {
    data: recent, error: recentError, refresh: refreshRecent, loading: loadingRecent,
  } = useSupabaseQuery('claude_api_calls', {
    select: 'id, source, skill_name, source_edge_function, model, input_tokens, cache_read_input_tokens, output_tokens, cost_usd, latency_ms, status, created_at',
    orderBy: ['created_at', { ascending: false }],
    limit: 50,
    initialData: null,
  })

  const {
    data: loops, refresh: refreshLoops,
  } = useSupabaseQuery('claude_api_loops_1h', {
    select: 'prompt_hash, attribution, n_calls, cost_usd_1h, first_seen, last_seen, sample_prompt_preview',
    orderBy: ['n_calls', { ascending: false }],
    limit: 20,
    initialData: null,
  })

  const aggregate = useMemo(() => {
    if (!costs || costs.length === 0) return null
    let totalCost = 0, totalCalls = 0, totalInput = 0, totalCached = 0, totalOutput = 0, totalErrors = 0
    let maxLatency = 0, topModel = null, topModelCost = 0
    for (const r of costs) {
      totalCost += Number(r.cost_usd_7d ?? 0)
      totalCalls += Number(r.calls ?? 0)
      totalInput += Number(r.input_tokens ?? 0)
      totalCached += Number(r.cached_input_tokens ?? 0)
      totalOutput += Number(r.output_tokens ?? 0)
      totalErrors += Number(r.errors ?? 0)
      const lat = Number(r.p95_latency_ms ?? 0)
      if (lat > maxLatency) maxLatency = lat
      const cost = Number(r.cost_usd_7d ?? 0)
      if (cost > topModelCost) { topModel = r.model; topModelCost = cost }
    }
    const totalReadable = totalInput + totalCached
    const cacheRatio = totalReadable > 0 ? totalCached / totalReadable : 0
    return { totalCost, totalCalls, totalInput, totalCached, totalOutput, totalErrors, maxLatency, topModel, cacheRatio }
  }, [costs])

  const refresh = () => { refreshCosts(); refreshRecent(); refreshLoops() }
  const isMigrationMissing = costsError && /relation .* does not exist|claude_api_costs_7d/i.test(String(costsError))
  const isEmpty = !isMigrationMissing && costs && costs.length === 0

  return (
    <div className="stack" style={{ gap: 'var(--s-6)' }}>
      <div className={styles.qualityHeader}>
        <div>
          <Link to="/intelligence" className="muted text-md">← Intelligence Hub</Link>
          <h1 className={styles.qualityTitle}>Observability — Claude-call telemetry</h1>
        </div>
        <button className="btn" onClick={refresh} disabled={loadingCosts || loadingRecent}>
          {(loadingCosts || loadingRecent) ? 'Laden…' : '↻ Refresh'}
        </button>
      </div>

      {isMigrationMissing && (
        <div className="card" style={{ padding: 'var(--s-5)' }}>
          <h3 style={{ marginTop: 0 }}>Tabel niet beschikbaar</h3>
          <p className="muted text-md" style={{ marginBottom: 0 }}>
            Migration <code>20260518_claude_api_calls.sql</code> is nog niet op deze omgeving gedraaid.
            Zie <a href="https://bg-intelligence.atlassian.net/wiki/spaces/LM/pages/450101261" target="_blank" rel="noreferrer">Confluence 450101261</a> voor het rolloutplan (F.6).
          </p>
        </div>
      )}

      {costsError && !isMigrationMissing && (
        <div className="card" style={{ padding: 'var(--s-5)' }}>
          <span className="muted">Fout bij ophalen: {String(costsError)}</span>
        </div>
      )}

      {isEmpty && (
        <div className="card" style={{ padding: 'var(--s-5)' }}>
          <h3 style={{ marginTop: 0 }}>Nog geen calls gelogd</h3>
          <p className="muted text-md" style={{ marginBottom: 0 }}>
            <code>claude_api_calls</code> is leeg. Edge Functions die via <code>_shared/anthropic-fetch.ts</code> routeren
            schrijven inline; Claude Code-sessies (skills) worden achteraf gevuld door <code>scripts/parse-claude-session.cjs</code> —
            dat hangt af van F.7 (orchestrator-hook) of F.8 (catch-up cron).
          </p>
        </div>
      )}

      {!isMigrationMissing && !isEmpty && aggregate && (
        <>
          {loops && loops.length > 0 && (
            <section
              className="card"
              style={{ padding: 'var(--s-5)', borderLeft: '4px solid var(--danger)' }}
            >
              <h2 className="section__title" style={{ marginBottom: 'var(--s-4)', color: 'var(--danger)' }}>
                ⚠ Loop-detectie — {loops.length} prompt(s) {'>'}5x in afgelopen uur
              </h2>
              <div>
                {loops.map(l => (
                  <div key={l.prompt_hash} className={styles.outcomeRow}>
                    <span style={{ minWidth: 140, fontWeight: 500 }}>{l.attribution}</span>
                    <span className={styles.listMono} style={{ color: 'var(--danger)' }}>{l.n_calls}× calls</span>
                    {l.cost_usd_1h != null && <span className={styles.listMono}>${Number(l.cost_usd_1h).toFixed(4)}</span>}
                    <span className={styles.runSummary} style={{ flex: 1, fontStyle: 'italic', color: 'var(--text-muted)' }}>
                      {(l.sample_prompt_preview || '').slice(0, 120)}{(l.sample_prompt_preview || '').length > 120 ? '…' : ''}
                    </span>
                    <span className={styles.listMono}>{relativeTime(l.last_seen) || '–'}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="card" style={{ padding: 'var(--s-5)' }}>
            <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Afgelopen 7 dagen</h2>
            <div className={styles.gridAuto}>
              <Stat label="Total cost" value={`$${aggregate.totalCost.toFixed(4)}`} />
              <Stat label="Calls" value={aggregate.totalCalls.toLocaleString('nl-NL')} />
              <Stat label="Input tokens" value={aggregate.totalInput.toLocaleString('nl-NL')} />
              <Stat label="Cache hit-ratio" value={`${(aggregate.cacheRatio * 100).toFixed(1)}%`} />
              <Stat label="Output tokens" value={aggregate.totalOutput.toLocaleString('nl-NL')} />
              <Stat label="Max p95 latency" value={aggregate.maxLatency ? `${aggregate.maxLatency.toFixed(0)} ms` : '–'} />
              <Stat label="Errors" value={aggregate.totalErrors} color={aggregate.totalErrors > 0 ? 'var(--danger)' : undefined} />
              <Stat label="Top model" value={aggregate.topModel ?? '–'} />
            </div>
          </section>

          <section className="card" style={{ padding: 'var(--s-5)' }}>
            <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Per attribution × model (7d)</h2>
            <div>
              {costs.map((r, i) => (
                <div key={`${r.attribution}-${r.model}-${i}`} className={styles.outcomeRow}>
                  <span style={{ minWidth: 180, fontWeight: 500 }}>{r.attribution}</span>
                  <span style={{ minWidth: 80, color: 'var(--text-muted)' }}>{r.source === 'edge_function' ? 'Edge' : 'Claude'}</span>
                  <span style={{ minWidth: 160, color: 'var(--text-muted)' }}>{r.model}</span>
                  <span className={styles.listMono}>{Number(r.calls).toLocaleString('nl-NL')} calls</span>
                  <span className={styles.listMono}>${Number(r.cost_usd_7d ?? 0).toFixed(4)}</span>
                  <span className={styles.listMono}>{r.p95_latency_ms ? `${Number(r.p95_latency_ms).toFixed(0)}ms p95` : '–'}</span>
                  {Number(r.errors ?? 0) > 0 && (
                    <span className={styles.listMono} style={{ color: 'var(--danger)' }}>{r.errors} err</span>
                  )}
                </div>
              ))}
            </div>
          </section>

          {recent && recent.length > 0 && (
            <section className="card" style={{ padding: 'var(--s-5)' }}>
              <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Laatste 50 calls</h2>
              <div>
                {recent.map(c => (
                  <div key={c.id} className={styles.outcomeRow}>
                    <span style={{ minWidth: 140, color: 'var(--text-muted)' }}>
                      {c.skill_name ?? c.source_edge_function ?? '–'}
                    </span>
                    <span style={{ minWidth: 150, color: 'var(--text-muted)' }}>{c.model}</span>
                    <span className={styles.listMono}>{c.input_tokens} in</span>
                    {Number(c.cache_read_input_tokens ?? 0) > 0 && (
                      <span className={styles.listMono}>{c.cache_read_input_tokens} cached</span>
                    )}
                    <span className={styles.listMono}>{c.output_tokens} out</span>
                    {c.cost_usd != null && <span className={styles.listMono}>${Number(c.cost_usd).toFixed(6)}</span>}
                    {c.latency_ms != null && <span className={styles.listMono}>{c.latency_ms}ms</span>}
                    <span
                      className={styles.runSummary}
                      style={{ flex: 1, color: c.status === 'ok' ? 'var(--text-muted)' : 'var(--danger)' }}
                    >
                      {c.status}
                    </span>
                    <span className={styles.listMono}>{relativeTime(c.created_at) || '–'}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {recentError && !recent && (
            <div className="card" style={{ padding: 'var(--s-5)' }}>
              <span className="muted">Recent calls niet geladen: {String(recentError)}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
