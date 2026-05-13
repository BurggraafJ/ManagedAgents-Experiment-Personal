import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../../lib/supabase'
import { SettingsV2Page } from '../SettingsV2Layout'

const REFRESH_MS = 30_000

const FUNCTIONS = [
  { slug: 'mail-sync-etl-v2',          agent: 'mail-sync',                category: 'Data',    label: 'Mail sync',             desc: 'Outlook delta sync — live elke 5 min',                              consumedBy: ['auto-draft', 'autodraft-rag-prefill', 'rag-search', 'daily-admin'] },
  { slug: 'mail-backfill',             agent: 'mail-backfill',            category: 'Data',    label: 'Mail backfill',         desc: '12 mnd historische mail ophalen, in batches',                       consumedBy: ['chunker'] },
  { slug: 'hubspot-sync-etl',          agent: 'hubspot-sync',             category: 'Data',    label: 'HubSpot sync',          desc: 'Deals / companies / contacts / owners / pipelines',                 consumedBy: ['daily-admin', 'sales-on-road', 'sales-followups', 'rag-search'] },
  { slug: 'hubspot-engagements-sync',  agent: 'hubspot-engagements-sync', category: 'Data',    label: 'HubSpot engagements',   desc: 'Calls / emails / notes / tasks / meetings',                         consumedBy: ['daily-admin', 'sales-followups', 'rag-search'] },
  { slug: 'jira-sync-etl',             agent: 'jira-sync',                category: 'Data',    label: 'Jira sync',             desc: 'Sales / Management / Recruitment / Partnerships boards',            consumedBy: ['daily-admin', 'task-organizer', 'rag-search'] },
  { slug: 'fireflies-sync-etl',        agent: 'fireflies-sync',           category: 'Data',    label: 'Fireflies sync',        desc: 'Meeting-transcripts + summaries',                                    consumedBy: ['task-organizer', 'daily-admin', 'rag-search'] },
  { slug: 'outlook-calendar-sync-etl', agent: 'outlook-calendar-sync',    category: 'Data',    label: 'Outlook calendar sync', desc: 'Agenda-events + attendees',                                          consumedBy: ['daily-admin', 'agenda'] },
  { slug: 'chunker',                   agent: 'chunker',                  category: 'AI',      label: 'Chunker',               desc: 'Chunkt + embedt 9 source-types (3072d halfvec)',                    consumedBy: ['rag-search', 'autodraft-rag-prefill', 'auto-draft'] },
  { slug: 'jellemind-embed',           agent: 'jellemind-embed',          category: 'AI',      label: 'JelleMind embed',       desc: 'Embeddings voor accepted lessons',                                   consumedBy: ['jellemind'] },
  { slug: 'autodraft-rag-prefill',     agent: 'autodraft-rag-prefill',    category: 'AI',      label: 'AutoDraft RAG prefill', desc: 'Vult per nieuwe mail rag_context in autodraft_mails',               consumedBy: ['auto-draft'] },
  { slug: 'task-organizer-fireflies',  agent: 'task-organizer-fireflies', category: 'AI',      label: 'Task-organizer Fireflies', desc: 'Parsed action-items uit Fireflies-meetings',                      consumedBy: ['task-organizer'] },
  { slug: 'rag-search',                agent: null,                       category: 'AI',      label: 'RAG search',            desc: 'On-demand vector-search over alle bronnen', noTracking: true, consumedBy: ['dashboard zoek-tab', 'auto-draft'] },
  { slug: 'transcribe',                agent: null,                       category: 'AI',      label: 'Transcribe (Whisper)',  desc: 'Voice-to-text via OpenAI Whisper',          noTracking: true, consumedBy: ['voice-input', 'sales-on-road', 'agenda'] },
  { slug: 'km-distance-lookup',        agent: null,                       category: 'Utility', label: 'Km distance lookup',    desc: 'Google Maps reisafstand-lookup',            noTracking: true, consumedBy: ['kilometerregistratie'] },
  { slug: 'km-excel-generate',         agent: 'km-excel-generate',        category: 'Utility', label: 'Km Excel generate',     desc: 'Genereert maand-Excel kilometerregistratie',                       consumedBy: ['kilometerregistratie'] },
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
  const day = Math.floor(hr / 24)
  return `${day}d`
}

function statusTone(status) {
  if (status === 'success' || status === 'ok') return 'ok'
  if (status === 'error')                       return 'err'
  if (status === 'warning' || status === 'running') return 'warn'
  return 'idle'
}

/**
 * EdgeFunctionsPage (v2) — cards-grid met live status uit agent_runs.
 */
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

  // Aggregaten voor header-pills
  const allLatest = Object.values(latestByAgent)
  const okCount  = allLatest.filter(r => r.status === 'success' || r.status === 'ok').length
  const errCount = allLatest.filter(r => r.status === 'error').length

  const grouped = CATEGORIES.map(cat => ({
    cat,
    fns: FUNCTIONS.filter(f => f.category === cat),
  })).filter(g => g.fns.length > 0)

  return (
    <SettingsV2Page
      title="Edge Functions"
      intro="Alle Supabase edge-functies met laatste run-status."
      right={
        <>
          <span className="sv2-pill sv2-pill--ok"><span className="sv2-pill__dot" />{okCount} ok</span>
          {errCount > 0 && (
            <span className="sv2-pill sv2-pill--err"><span className="sv2-pill__dot" />{errCount} fout</span>
          )}
          <span style={{ fontSize: 11, color: 'var(--sv-n-500)', marginLeft: 6 }}>
            {fetchedAt ? `↻ ${fetchedAt.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}` : 'laden…'}
          </span>
        </>
      }
    >
      {error && <div className="sv2-banner sv2-banner--err">⚠ {error}</div>}

      {grouped.map(({ cat, fns }) => (
        <div key={cat} style={{ marginBottom: 22 }}>
          <div className="sv2-kcat">{cat}</div>
          <div className="sv2-cards">
            {fns.map(fn => {
              const latest = fn.agent ? latestByAgent[fn.agent] : null
              const runs7d = fn.agent ? runs7dByAgent[fn.agent] : null
              const succ = (runs7d || []).filter(r => r.status === 'success').length
              const errs = (runs7d || []).filter(r => r.status === 'error').length
              const tone = latest ? statusTone(latest.status) : 'idle'
              const label = latest ? latest.status : (fn.noTracking ? 'on-demand' : 'geen logs')
              const delta = latest?.summary
                ? (latest.summary.length > 90 ? latest.summary.slice(0, 90) + '…' : latest.summary)
                : null

              return (
                <div key={fn.slug} className="sv2-card">
                  <div className="sv2-card__head">
                    <div style={{ minWidth: 0 }}>
                      <div className="sv2-card__title">{fn.label}</div>
                      <div className="sv2-card__slug">{fn.slug}</div>
                    </div>
                    <span className={`sv2-stat sv2-stat--${tone}`}>
                      <span className="sv2-stat__dot" />
                      {label}
                    </span>
                  </div>
                  <div className="sv2-card__desc">{fn.desc}</div>
                  {(fn.consumedBy || []).length > 0 && (
                    <div className="sv2-chip-stack">
                      {fn.consumedBy.map(c => (
                        <span key={c} className="sv2-chip">{c}</span>
                      ))}
                    </div>
                  )}
                  {delta && (
                    <div className={`sv2-card__delta ${tone === 'err' ? 'sv2-card__delta--err' : ''}`}>
                      {delta}
                    </div>
                  )}
                  <div className="sv2-card__foot">
                    <span>{latest ? `${relTime(latest.started_at)} geleden` : (fn.noTracking ? 'geen logging' : 'nooit')}</span>
                    <span>{fn.noTracking ? '—' : `7d: ${succ}✓${errs > 0 ? ` ${errs}✗` : ''}`}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </SettingsV2Page>
  )
}
