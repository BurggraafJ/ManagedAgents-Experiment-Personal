import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../../lib/supabase'

// EdgeFunctionsPage (admin) — live status per Edge Function uit agent_runs.
// Verhuisd vanuit Settings/Infrastructuur 2026-05-22 met nieuwe admin-styling.

const REFRESH_MS = 30_000

const FUNCTIONS = [
  { slug: 'mail-sync-etl-v2',          agent: 'mail-sync',                category: 'Data',    label: 'Mail sync',             desc: 'Outlook delta sync — live elke 5 min',                              consumedBy: ['auto-draft', 'autodraft-rag-prefill', 'rag-search', 'daily-admin'] },
  { slug: 'mail-backfill',             agent: 'mail-backfill',            category: 'Data',    label: 'Mail backfill',         desc: '12 mnd historische mail ophalen, in batches',                       consumedBy: ['chunker'] },
  { slug: 'hubspot-sync-etl',          agent: 'hubspot-sync',             category: 'Data',    label: 'HubSpot sync',          desc: 'Deals / companies / contacts / owners / pipelines',                 consumedBy: ['daily-admin', 'sales-followups', 'rag-search'] },
  { slug: 'hubspot-engagements-sync',  agent: 'hubspot-engagements-sync', category: 'Data',    label: 'HubSpot engagements',   desc: 'Calls / emails / notes / tasks / meetings',                         consumedBy: ['daily-admin', 'sales-followups', 'rag-search'] },
  { slug: 'jira-sync-etl',             agent: 'jira-sync',                category: 'Data',    label: 'Jira sync',             desc: 'Sales / Management / Recruitment / Partnerships boards',            consumedBy: ['daily-admin', 'task-organizer', 'rag-search'] },
  { slug: 'fireflies-sync-etl',        agent: 'fireflies-sync',           category: 'Data',    label: 'Fireflies sync',        desc: 'Meeting-transcripts + summaries',                                    consumedBy: ['task-organizer', 'daily-admin', 'rag-search'] },
  { slug: 'outlook-calendar-sync-etl', agent: 'outlook-calendar-sync',    category: 'Data',    label: 'Outlook calendar sync', desc: 'Agenda-events + attendees',                                          consumedBy: ['daily-admin', 'agenda'] },
  { slug: 'chunker',                   agent: 'chunker',                  category: 'AI',      label: 'Chunker',               desc: 'Chunkt + embedt 9 source-types (3072d halfvec)',                    consumedBy: ['rag-search', 'autodraft-rag-prefill', 'auto-draft'] },
  { slug: 'jellemind-embed',           agent: 'jellemind-embed',          category: 'AI',      label: 'JelleMind embed',       desc: 'Embeddings voor accepted lessons',                                   consumedBy: ['jellemind'] },
  { slug: 'autodraft-rag-prefill',     agent: 'autodraft-rag-prefill',    category: 'AI',      label: 'AutoDraft RAG prefill', desc: 'Vult per nieuwe mail rag_context in autodraft_mails',               consumedBy: ['auto-draft'] },
  { slug: 'task-organizer-fireflies',  agent: 'task-organizer-fireflies', category: 'AI',      label: 'Task-organizer Fireflies', desc: 'Parsed action-items uit Fireflies-meetings',                      consumedBy: ['task-organizer'] },
  { slug: 'rag-search',                agent: null,                       category: 'AI',      label: 'RAG search',            desc: 'On-demand vector-search over alle bronnen', noTracking: true, consumedBy: ['dashboard zoek-tab', 'auto-draft'] },
  { slug: 'transcribe',                agent: null,                       category: 'AI',      label: 'Transcribe (Whisper)',  desc: 'Voice-to-text via OpenAI Whisper',          noTracking: true, consumedBy: ['voice-input', 'agenda'] },
]

const CATEGORIES = ['Data', 'AI', 'Utility']

function relTime(iso) {
  if (!iso) return 'nooit'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}u`
  return `${Math.floor(hr / 24)}d`
}

function statusTone(status) {
  if (status === 'success' || status === 'ok') return 'ok'
  if (status === 'error') return 'err'
  if (status === 'warning' || status === 'running') return 'warn'
  return 'info'
}

export default function EdgeFunctionsPage() {
  const [latestByAgent, setLatestByAgent] = useState({})
  const [runs7dByAgent, setRuns7dByAgent] = useState({})
  const [fetchedAt, setFetchedAt] = useState(null)
  const [error, setError] = useState(null)

  const fetchHealth = useCallback(async () => {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString()
      const knownAgents = FUNCTIONS.filter(f => f.agent).map(f => f.agent)
      const { data, error: err } = await supabase.from('agent_runs')
        .select('agent_name,status,summary,started_at,stats')
        .in('agent_name', knownAgents)
        .gte('started_at', sevenDaysAgo)
        .order('started_at', { ascending: false })
        .limit(500)
      if (err) throw err
      const latest = {}, runs7d = {}
      for (const r of data || []) {
        if (!latest[r.agent_name]) latest[r.agent_name] = r
        if (!runs7d[r.agent_name]) runs7d[r.agent_name] = []
        runs7d[r.agent_name].push(r)
      }
      setLatestByAgent(latest); setRuns7dByAgent(runs7d)
      setFetchedAt(new Date()); setError(null)
    } catch (err) { setError(err.message) }
  }, [])

  useEffect(() => {
    fetchHealth()
    const id = setInterval(fetchHealth, REFRESH_MS)
    return () => clearInterval(id)
  }, [fetchHealth])

  const allLatest = Object.values(latestByAgent)
  const okCount  = allLatest.filter(r => r.status === 'success' || r.status === 'ok').length
  const errCount = allLatest.filter(r => r.status === 'error').length

  const grouped = CATEGORIES.map(cat => ({
    cat,
    fns: FUNCTIONS.filter(f => f.category === cat),
  })).filter(g => g.fns.length > 0)

  return (
    <>
      <div className="admin-toolbar">
        <div className="admin-toolbar__meta">
          <span className="admin-pill admin-pill--ok"><span className="admin-pill__dot" />{okCount} ok</span>
          {errCount > 0 && (
            <span className="admin-pill admin-pill--err"><span className="admin-pill__dot" />{errCount} fout</span>
          )}
          {fetchedAt && (
            <span>↻ laatst ververst {fetchedAt.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}</span>
          )}
        </div>
        <div className="admin-toolbar__actions">
          <button type="button" className="admin-btn" onClick={fetchHealth}>Vernieuwen</button>
        </div>
      </div>

      {error && <div className="admin-banner admin-banner--err">⚠ {error}</div>}

      {grouped.map(({ cat, fns }) => (
        <div key={cat}>
          <div className="admin-category-label">{cat}</div>
          <div className="admin-fn-grid">
            {fns.map(fn => {
              const latest = fn.agent ? latestByAgent[fn.agent] : null
              const runs7d = fn.agent ? runs7dByAgent[fn.agent] : null
              const succ = (runs7d || []).filter(r => r.status === 'success').length
              const errs = (runs7d || []).filter(r => r.status === 'error').length
              const tone = latest ? statusTone(latest.status) : 'info'
              const label = latest ? latest.status : (fn.noTracking ? 'on-demand' : 'geen logs')
              const delta = latest?.summary
                ? (latest.summary.length > 90 ? latest.summary.slice(0, 90) + '…' : latest.summary)
                : null

              return (
                <div key={fn.slug} className="admin-fn-card" data-tone={tone}>
                  <div className="admin-fn-card__head">
                    <div style={{ minWidth: 0 }}>
                      <h3 className="admin-fn-card__title">{fn.label}</h3>
                      <div className="admin-fn-card__slug">{fn.slug}</div>
                    </div>
                    <span className={`admin-pill admin-pill--${tone}`}>
                      <span className="admin-pill__dot" />
                      {label}
                    </span>
                  </div>
                  <div className="admin-fn-card__desc">{fn.desc}</div>
                  {(fn.consumedBy || []).length > 0 && (
                    <div className="admin-chip-stack">
                      {fn.consumedBy.map(c => (
                        <span key={c} className="admin-chip">{c}</span>
                      ))}
                    </div>
                  )}
                  {delta && (
                    <div className={`admin-fn-card__delta ${tone === 'err' ? 'admin-fn-card__delta--err' : ''}`}>
                      {delta}
                    </div>
                  )}
                  <div className="admin-fn-card__foot">
                    <span>{latest ? `${relTime(latest.started_at)} geleden` : (fn.noTracking ? 'geen logging' : 'nooit')}</span>
                    <span>{fn.noTracking ? '—' : `7d: ${succ}✓${errs > 0 ? ` ${errs}✗` : ''}`}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </>
  )
}
