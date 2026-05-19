import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useSupabaseQuery } from '../../../hooks/useSupabaseQuery'
import { relativeTime } from '../../../lib/dateFormat'
import Stat from './Stat'
import styles from './IntelligenceView.module.css'

/**
 * IntelligenceObservabilityView — Claude-call telemetrie.
 *
 * Bron: claude_api_calls + insight-views. Zie Confluence 450101261.
 *
 * Layout (top → bottom):
 *   1. Burn-rate banner (MTD + projection + 24u)
 *   2. Cohort cards (vandaag vs gisteren vs vorige week)
 *   3. Cost-trend sparkline (30d)
 *   4. KPI-cards (7d) + model-mix bars
 *   5. Cache-efficiency per skill
 *   6. Top duurste prompts (herhalende patronen)
 *   7. Top duurste runs (agent_runs join)
 *   8. Loop-detectie (1h)
 *   9. Laatste 50 calls
 */
export default function IntelligenceObservabilityView() {
  const q1 = useSupabaseQuery('claude_api_burn_rate',        { select: '*', maybeSingle: true, initialData: null })
  const q2 = useSupabaseQuery('claude_api_cohort_compare',   { select: '*', initialData: null })
  const q3 = useSupabaseQuery('claude_api_cost_by_day_30d',  { select: 'day, calls, cost_usd', orderBy: ['day', { ascending: true }], initialData: null })
  const q4 = useSupabaseQuery('claude_api_costs_7d',         { select: '*', orderBy: ['cost_usd_7d', { ascending: false, nullsFirst: false }], limit: 100, initialData: null })
  const q5 = useSupabaseQuery('claude_api_model_mix_7d',     { select: '*', initialData: null })
  const q6 = useSupabaseQuery('claude_api_cache_efficiency_7d', { select: '*', initialData: null })
  const q7 = useSupabaseQuery('claude_api_top_prompts_7d',   { select: '*', limit: 10, initialData: null })
  const q8 = useSupabaseQuery('claude_api_top_runs_7d',      { select: '*', limit: 10, initialData: null })
  const q9 = useSupabaseQuery('claude_api_loops_1h',         { select: '*', orderBy: ['n_calls', { ascending: false }], limit: 20, initialData: null })
  const q10 = useSupabaseQuery('claude_api_calls', {
    select: 'id, run_id, source, skill_name, source_edge_function, model, input_tokens, cache_read_input_tokens, output_tokens, cost_usd, latency_ms, status, created_at',
    orderBy: ['created_at', { ascending: false }],
    limit: 50,
    initialData: null,
  })

  const refresh = () => [q1, q2, q3, q4, q5, q6, q7, q8, q9, q10].forEach(q => q.refresh?.())
  const loading = [q1, q2, q3, q4].some(q => q.loading)

  const isMigrationMissing = q4.error && /relation .* does not exist|claude_api_costs_7d/i.test(String(q4.error))
  const isEmpty = !isMigrationMissing && q4.data && q4.data.length === 0

  // Aggregate fallback voor KPI-cards
  const agg = useMemo(() => {
    if (!q4.data?.length) return null
    let totalCost = 0, totalCalls = 0, totalInput = 0, totalCached = 0, totalOutput = 0, totalErrors = 0
    let maxLatency = 0, topModel = null, topModelCost = 0
    for (const r of q4.data) {
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
  }, [q4.data])

  return (
    <div className="stack" style={{ gap: 'var(--s-6)' }}>
      <Header onRefresh={refresh} loading={loading} />

      {isMigrationMissing && <MigrationMissingBanner />}
      {q4.error && !isMigrationMissing && <ErrorCard message={String(q4.error)} />}
      {isEmpty && <EmptyStateBanner />}

      {!isMigrationMissing && !isEmpty && (
        <>
          {q9.data?.length > 0 && <LoopDetectionAlert loops={q9.data} />}
          {q1.data && <BurnRateBanner data={q1.data} />}
          {q2.data && <CohortCards rows={q2.data} />}
          {q3.data?.length > 0 && <CostTrendSparkline rows={q3.data} />}
          {agg && <KpiCards agg={agg} />}
          {q5.data?.length > 0 && <ModelMixBars rows={q5.data} />}
          {q6.data?.length > 0 && <CacheEfficiencyTable rows={q6.data} />}
          {q7.data?.length > 0 && <TopPromptsTable rows={q7.data} />}
          {q8.data?.length > 0 && <TopRunsTable rows={q8.data} />}
          {q10.data?.length > 0 && <RecentCallsTable rows={q10.data} />}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components — inline om <400 LOC totaal te houden + één-bestand cohesie
// ---------------------------------------------------------------------------

function Header({ onRefresh, loading }) {
  return (
    <div className={styles.qualityHeader}>
      <div>
        <Link to="/intelligence" className="muted text-md">← Intelligence Hub</Link>
        <h1 className={styles.qualityTitle}>Observability — Claude-call telemetry</h1>
      </div>
      <button className="btn" onClick={onRefresh} disabled={loading}>
        {loading ? 'Laden…' : '↻ Refresh'}
      </button>
    </div>
  )
}

function MigrationMissingBanner() {
  return (
    <div className="card" style={{ padding: 'var(--s-5)' }}>
      <h3 style={{ marginTop: 0 }}>Tabel niet beschikbaar</h3>
      <p className="muted text-md" style={{ marginBottom: 0 }}>
        Migration <code>20260518_claude_api_calls.sql</code> nog niet op deze omgeving gedraaid.
        Zie <a href="https://bg-intelligence.atlassian.net/wiki/spaces/LM/pages/450101261" target="_blank" rel="noreferrer">Confluence 450101261</a> (F.6).
      </p>
    </div>
  )
}

function ErrorCard({ message }) {
  return <div className="card" style={{ padding: 'var(--s-5)' }}><span className="muted">Fout: {message}</span></div>
}

function EmptyStateBanner() {
  return (
    <div className="card" style={{ padding: 'var(--s-5)' }}>
      <h3 style={{ marginTop: 0 }}>Nog geen calls gelogd</h3>
      <p className="muted text-md" style={{ marginBottom: 0 }}>
        <code>claude_api_calls</code> is leeg. Eerste rij komt zodra Edge Function via
        <code> _shared/anthropic-fetch.ts</code> aanroept of orchestrator de parser draait (F.7/F.8).
      </p>
    </div>
  )
}

function LoopDetectionAlert({ loops }) {
  return (
    <section className="card" style={{ padding: 'var(--s-5)', borderLeft: '4px solid var(--danger)' }}>
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
  )
}

function BurnRateBanner({ data }) {
  const mtd = Number(data.cost_mtd ?? 0)
  const projected = Number(data.projected_month_total ?? 0)
  const cost24h = Number(data.cost_24h ?? 0)
  const daysElapsed = data.days_elapsed
  const daysTotal = data.days_total_month
  const pctElapsed = daysTotal > 0 ? (daysElapsed / daysTotal) * 100 : 0
  return (
    <section className="card" style={{ padding: 'var(--s-5)' }}>
      <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>
        Burn-rate ({daysElapsed}/{daysTotal} dagen — {pctElapsed.toFixed(0)}% van de maand)
      </h2>
      <div className={styles.gridAuto}>
        <Stat label="Cost MTD (theoretical)" value={`$${mtd.toFixed(2)}`} />
        <Stat label="Projection EOM" value={`$${projected.toFixed(2)}`} color={projected > mtd * 2 ? 'var(--danger)' : undefined} />
        <Stat label="Laatste 24u" value={`$${cost24h.toFixed(2)}`} />
        <Stat label="Calls 24u" value={Number(data.calls_24h ?? 0).toLocaleString('nl-NL')} />
      </div>
      <p className="muted text-sm" style={{ marginTop: 'var(--s-3)', marginBottom: 0 }}>
        Projectie = (gemiddelde 7d/dag) × {daysTotal} dagen. <em>Theoretical pay-per-call</em> — bij Claude Max-subscription betaal je vaste fee, deze cijfers zijn informatief.
      </p>
    </section>
  )
}

function CohortCards({ rows }) {
  const today    = rows.find(r => r.bucket === 'today')                  ?? {}
  const yest     = rows.find(r => r.bucket === 'yesterday')              ?? {}
  const wkAgo    = rows.find(r => r.bucket === 'week_ago_same_weekday')  ?? {}
  const delta = (a, b) => {
    const av = Number(a ?? 0), bv = Number(b ?? 0)
    if (bv === 0) return av > 0 ? '+∞' : '–'
    const pct = ((av - bv) / bv) * 100
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`
  }
  return (
    <section className="card" style={{ padding: 'var(--s-5)' }}>
      <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Cohort vergelijking</h2>
      <div className={styles.gridAuto}>
        <Stat label={`Vandaag (${today.as_of_date || '–'})`} value={`$${Number(today.cost_usd ?? 0).toFixed(2)}`} />
        <Stat label={`Calls vandaag`} value={Number(today.calls ?? 0).toLocaleString('nl-NL')} />
        <Stat label={`vs gisteren`} value={delta(today.cost_usd, yest.cost_usd)} />
        <Stat label={`vs vorige ${getWeekdayName(today.as_of_date)}`} value={delta(today.cost_usd, wkAgo.cost_usd)} />
      </div>
    </section>
  )
}

function getWeekdayName(iso) {
  if (!iso) return 'week'
  const days = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag']
  return days[new Date(iso).getDay()]
}

function CostTrendSparkline({ rows }) {
  if (rows.length === 0) return null
  const max = Math.max(...rows.map(r => Number(r.cost_usd ?? 0)), 0.0001)
  const W = 600, H = 80, P = 4
  const xStep = (W - 2 * P) / Math.max(rows.length - 1, 1)
  const pts = rows.map((r, i) => {
    const x = P + i * xStep
    const y = H - P - (Number(r.cost_usd ?? 0) / max) * (H - 2 * P)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const totalCost = rows.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0)
  const activeDays = rows.filter(r => Number(r.calls) > 0).length
  return (
    <section className="card" style={{ padding: 'var(--s-5)' }}>
      <h2 className="section__title" style={{ marginBottom: 'var(--s-3)' }}>Cost-trend laatste 30 dagen</h2>
      <div className="muted text-sm" style={{ marginBottom: 'var(--s-3)' }}>
        Totaal 30d: <strong>${totalCost.toFixed(2)}</strong> · Actieve dagen: {activeDays}/30 · Piek/dag: ${max.toFixed(2)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: 'block' }}>
        <polyline fill="none" stroke="var(--accent, #4a8cff)" strokeWidth="2" points={pts} />
        {rows.map((r, i) => {
          const x = P + i * xStep
          const v = Number(r.cost_usd ?? 0)
          const y = H - P - (v / max) * (H - 2 * P)
          if (v <= 0) return null
          return <circle key={i} cx={x} cy={y} r={2.5} fill="var(--accent, #4a8cff)"><title>{r.day}: ${v.toFixed(2)} ({r.calls} calls)</title></circle>
        })}
      </svg>
      <div className="muted text-sm" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--s-2)' }}>
        <span>{rows[0]?.day}</span>
        <span>{rows[rows.length - 1]?.day}</span>
      </div>
    </section>
  )
}

function KpiCards({ agg }) {
  return (
    <section className="card" style={{ padding: 'var(--s-5)' }}>
      <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Afgelopen 7 dagen — overzicht</h2>
      <div className={styles.gridAuto}>
        <Stat label="Total cost" value={`$${agg.totalCost.toFixed(4)}`} />
        <Stat label="Calls" value={agg.totalCalls.toLocaleString('nl-NL')} />
        <Stat label="Input tokens" value={agg.totalInput.toLocaleString('nl-NL')} />
        <Stat label="Cache hit-ratio" value={`${(agg.cacheRatio * 100).toFixed(1)}%`} />
        <Stat label="Output tokens" value={agg.totalOutput.toLocaleString('nl-NL')} />
        <Stat label="Max p95 latency" value={agg.maxLatency ? `${agg.maxLatency.toFixed(0)} ms` : '–'} />
        <Stat label="Errors" value={agg.totalErrors} color={agg.totalErrors > 0 ? 'var(--danger)' : undefined} />
        <Stat label="Top model" value={agg.topModel ?? '–'} />
      </div>
    </section>
  )
}

function ModelMixBars({ rows }) {
  const max = Math.max(...rows.map(r => Number(r.pct_of_cost ?? 0)), 1)
  return (
    <section className="card" style={{ padding: 'var(--s-5)' }}>
      <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Model-mix (7d)</h2>
      <div>
        {rows.map(r => (
          <div key={r.model} style={{ marginBottom: 'var(--s-3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--s-1)' }}>
              <span style={{ fontWeight: 500 }}>{r.model}</span>
              <span className={styles.listMono}>
                {r.calls} calls · {Number(r.pct_of_calls).toFixed(1)}% v calls · {Number(r.pct_of_cost ?? 0).toFixed(1)}% v cost · ${Number(r.cost_usd_7d ?? 0).toFixed(2)}
              </span>
            </div>
            <div style={{ height: 6, background: 'var(--bg-subtle, #eee)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${(Number(r.pct_of_cost ?? 0) / max) * 100}%`, height: '100%', background: 'var(--accent, #4a8cff)' }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function CacheEfficiencyTable({ rows }) {
  return (
    <section className="card" style={{ padding: 'var(--s-5)' }}>
      <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Cache-efficiency per skill (7d)</h2>
      <div className="muted text-sm" style={{ marginBottom: 'var(--s-3)' }}>
        {'<'}50% hit = kandidaat voor stable-prefix-redesign · hoger = caching werkt goed
      </div>
      <div>
        {rows.map(r => (
          <div key={`${r.attribution}-${r.source}`} className={styles.outcomeRow}>
            <span style={{ minWidth: 200, fontWeight: 500 }}>{r.attribution}</span>
            <span style={{ minWidth: 80, color: 'var(--text-muted)' }}>{r.source === 'edge_function' ? 'Edge' : 'Claude'}</span>
            <span className={styles.listMono}>{r.calls} calls</span>
            <span
              className={styles.listMono}
              style={{ color: Number(r.cache_hit_pct) < 50 ? 'var(--danger)' : Number(r.cache_hit_pct) < 80 ? 'var(--warning, #d97706)' : 'var(--text-muted)', minWidth: 70 }}
            >
              {Number(r.cache_hit_pct).toFixed(1)}% hit
            </span>
            <span className={styles.listMono}>${Number(r.cost_usd_7d ?? 0).toFixed(4)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function TopPromptsTable({ rows }) {
  return (
    <section className="card" style={{ padding: 'var(--s-5)' }}>
      <h2 className="section__title" style={{ marginBottom: 'var(--s-3)' }}>Top duurste prompt-patterns (7d, herhalend)</h2>
      <div className="muted text-sm" style={{ marginBottom: 'var(--s-3)' }}>
        Group by prompt-hash. Herhalende patronen = kandidaten voor caching of prompt-engineering.
      </div>
      <div>
        {rows.map(r => (
          <div key={r.prompt_hash} className={styles.outcomeRow}>
            <span style={{ minWidth: 140, fontWeight: 500 }}>{r.attribution}</span>
            <span className={styles.listMono}>{r.n_calls}×</span>
            <span className={styles.listMono}>${Number(r.cost_usd_7d ?? 0).toFixed(2)}</span>
            <span className={styles.listMono}>~${Number(r.avg_cost_per_call ?? 0).toFixed(4)}/call</span>
            <span className={styles.runSummary} style={{ flex: 1, fontStyle: 'italic', color: 'var(--text-muted)' }}>
              {(r.sample_prompt_preview || '').slice(0, 100)}{(r.sample_prompt_preview || '').length > 100 ? '…' : ''}
            </span>
            <span className={styles.listMono}>{relativeTime(r.last_seen) || '–'}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function TopRunsTable({ rows }) {
  return (
    <section className="card" style={{ padding: 'var(--s-5)' }}>
      <h2 className="section__title" style={{ marginBottom: 'var(--s-3)' }}>Top duurste runs (7d)</h2>
      <div>
        {rows.map(r => (
          <div key={r.run_id} className={styles.outcomeRow}>
            <span style={{ minWidth: 140, fontWeight: 500 }}>{r.agent_name ?? '(geen agent_runs join)'}</span>
            <span className={styles.listMono}>{r.n_calls} calls</span>
            <span className={styles.listMono}>${Number(r.cost_usd ?? 0).toFixed(2)}</span>
            <span style={{ minWidth: 80, color: 'var(--text-muted)' }}>{r.run_status ?? '–'}</span>
            <span className={styles.runSummary} style={{ flex: 1, color: 'var(--text-muted)' }}>{r.run_summary ?? '–'}</span>
            <span className={styles.listMono}>{relativeTime(r.last_call) || '–'}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function RecentCallsTable({ rows }) {
  return (
    <section className="card" style={{ padding: 'var(--s-5)' }}>
      <h2 className="section__title" style={{ marginBottom: 'var(--s-4)' }}>Laatste 50 calls</h2>
      <div>
        {rows.map(c => (
          <div key={c.id} className={styles.outcomeRow}>
            <span style={{ minWidth: 140, color: 'var(--text-muted)' }}>{c.skill_name ?? c.source_edge_function ?? '–'}</span>
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
  )
}
