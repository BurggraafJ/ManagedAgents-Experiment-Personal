import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import { SettingsPage } from './SettingsLayout'

// EdgeFunctionsPage — overzicht van alle Supabase Edge Functions met laatste
// run-status per agent. Apart van Deployments omdat dit puur data sync /
// processing is, terwijl deploys over de dashboard-front-end gaan.

const REFRESH_MS = 30_000

// `consumedBy` = welke skills/agents deze functie's output benutten. Niet
// hetzelfde als `agent` (= agent_name onder welke de functie zelf logt).
const FUNCTIONS = [
  { slug: 'mail-sync-etl-v2',          agent: 'mail-sync',                category: 'Data',    label: 'Mail sync',             desc: 'Outlook delta sync — live elke 5 min',
    consumedBy: ['auto-draft', 'autodraft-rag-prefill', 'rag-search', 'daily-admin'] },
  { slug: 'mail-backfill',             agent: 'mail-backfill',            category: 'Data',    label: 'Mail backfill',         desc: '12 mnd historische mail ophalen, in batches',
    consumedBy: ['mail-embed'] },
  { slug: 'hubspot-sync-etl',          agent: 'hubspot-sync',             category: 'Data',    label: 'HubSpot sync',          desc: 'Deals / companies / contacts / owners / pipelines',
    consumedBy: ['daily-admin', 'sales-on-road', 'sales-followups', 'rag-search'] },
  { slug: 'hubspot-engagements-sync',  agent: 'hubspot-engagements-sync', category: 'Data',    label: 'HubSpot engagements',   desc: 'Calls / emails / notes / tasks / meetings',
    consumedBy: ['daily-admin', 'sales-followups', 'rag-search'] },
  { slug: 'jira-sync-etl',             agent: 'jira-sync',                category: 'Data',    label: 'Jira sync',             desc: 'Sales / Management / Recruitment / Partnerships boards',
    consumedBy: ['daily-admin', 'task-organizer', 'rag-search'] },
  { slug: 'fireflies-sync-etl',        agent: 'fireflies-sync',           category: 'Data',    label: 'Fireflies sync',        desc: 'Meeting-transcripts + summaries',
    consumedBy: ['task-organizer', 'daily-admin', 'rag-search'] },
  { slug: 'outlook-calendar-sync-etl', agent: 'outlook-calendar-sync',    category: 'Data',    label: 'Outlook calendar sync', desc: 'Agenda-events + attendees',
    consumedBy: ['daily-admin', 'agenda'] },
  { slug: 'mail-embed',                agent: 'mail-embed',               category: 'AI',      label: 'Mail embed',            desc: 'OpenAI embeddings voor mail/engagements/jira/hubspot',
    consumedBy: ['rag-search', 'autodraft-rag-prefill'] },
  { slug: 'jellemind-embed',           agent: 'jellemind-embed',          category: 'AI',      label: 'JelleMind embed',       desc: 'Embeddings voor accepted lessons',
    consumedBy: ['jellemind', 'rag-search'] },
  { slug: 'autodraft-rag-prefill',     agent: 'autodraft-rag-prefill',    category: 'AI',      label: 'AutoDraft RAG prefill', desc: 'Vult per nieuwe mail rag_context in autodraft_mails',
    consumedBy: ['auto-draft'] },
  { slug: 'task-organizer-fireflies',  agent: 'task-organizer-fireflies', category: 'AI',      label: 'Task-organizer Fireflies', desc: 'Parsed action-items voor Jelle uit Fireflies-meetings',
    consumedBy: ['task-organizer'] },
  { slug: 'rag-search',                agent: null,                       category: 'AI',      label: 'RAG search',            desc: 'On-demand vector-search over alle bronnen', noTracking: true, trackingNote: 'On-demand call vanuit dashboard, geen run-logging',
    consumedBy: ['dashboard zoek-tab', 'auto-draft'] },
  { slug: 'transcribe',                agent: null,                       category: 'AI',      label: 'Transcribe (Whisper)',  desc: 'Voice-to-text via OpenAI Whisper', noTracking: true, trackingNote: 'Geen run-logging — zie Token Cost Counter project',
    consumedBy: ['dashboard voice-input', 'sales-on-road', 'agenda'] },
  { slug: 'km-distance-lookup',        agent: null,                       category: 'Utility', label: 'Km distance lookup',    desc: 'Google Maps reisafstand-lookup', noTracking: true, trackingNote: 'On-demand call vanuit dashboard, geen run-logging',
    consumedBy: ['kilometerregistratie'] },
  { slug: 'km-excel-generate',         agent: 'km-excel-generate',        category: 'Utility', label: 'Km Excel generate',     desc: 'Genereert maand-Excel kilometerregistratie',
    consumedBy: ['kilometerregistratie'] },
]

const CATEGORIES = ['Data', 'AI', 'Utility']

function relTime(iso) {
  if (!iso) return 'nooit'
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min geleden`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}u geleden`
  const day = Math.floor(hr / 24)
  return `${day}d geleden`
}

function statusPill(status) {
  if (status === 'success' || status === 'ok') return { tag: 's-success', label: 'success' }
  if (status === 'warning')                     return { tag: 's-warning', label: 'warning' }
  if (status === 'error')                       return { tag: 's-error',   label: 'error' }
  if (status === 'running')                     return { tag: 's-warning', label: 'running' }
  return { tag: 's-idle', label: status || 'idle' }
}

function FunctionRow({ fn, runs7d, latest }) {
  const errs = (runs7d || []).filter(r => r.status === 'error').length
  const succ = (runs7d || []).filter(r => r.status === 'success').length
  const pill = latest ? statusPill(latest.status) : { tag: 's-idle', label: 'geen logs' }

  return (
    <div className="card" style={{ padding: 'var(--s-4)', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{fn.label}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--mono)' }}>{fn.slug}</div>
        </div>
        <span className={`status-pill ${pill.tag}`} style={{ flexShrink: 0 }}>{pill.label}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fn.desc}</div>
      {(fn.consumedBy || []).length > 0 && (
        <div className="api-keys__usedby" style={{ marginTop: 2 }}>
          {fn.consumedBy.map(c => (
            <span key={c} className="api-keys__usedby-pill">{c}</span>
          ))}
        </div>
      )}
      {fn.noTracking ? (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', paddingTop: 4 }}>
          {fn.trackingNote || 'Geen run-logging.'}
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', paddingTop: 4, borderTop: '1px solid var(--border)' }}>
          <span title={latest?.started_at ? new Date(latest.started_at).toLocaleString('nl-NL') : 'Nog nooit gedraaid'}>
            Laatste run: {latest ? relTime(latest.started_at) : 'nooit'}
          </span>
          <span title={`Laatste 7 dagen: ${succ} success${errs > 0 ? `, ${errs} error` : ''}`}>
            7d: {succ}✓ {errs > 0 ? `${errs}✗` : ''}
          </span>
        </div>
      )}
      {latest?.summary && !fn.noTracking && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', borderLeft: '2px solid var(--border)', paddingLeft: 8 }}>
          {latest.summary.length > 120 ? latest.summary.slice(0, 120) + '…' : latest.summary}
        </div>
      )}
    </div>
  )
}

export default function EdgeFunctionsPage() {
  const [latestByAgent, setLatestByAgent] = useState({})
  const [runs7dByAgent, setRuns7dByAgent] = useState({})
  const [error, setError] = useState(null)
  const [fetchedAt, setFetchedAt] = useState(null)

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
      setLatestByAgent(latest)
      setRuns7dByAgent(runs7d)
      setFetchedAt(new Date())
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    fetchHealth()
    const id = setInterval(fetchHealth, REFRESH_MS)
    return () => clearInterval(id)
  }, [fetchHealth])

  const grouped = CATEGORIES.map(cat => ({
    cat,
    fns: FUNCTIONS.filter(f => f.category === cat),
  })).filter(g => g.fns.length > 0)

  return (
    <SettingsPage
      title="Edge Functions"
      intro="Alle Supabase edge-functies met laatste run-status. Data-sync, AI-processing en utilities."
      actions={
        <span className="muted" style={{ fontSize: 12 }}>
          {fetchedAt ? `Ververst: ${fetchedAt.toLocaleTimeString('nl-NL')}` : 'laden…'}
          {error && ` · ${error}`}
        </span>
      }
    >
      <div className="stack" style={{ gap: 'var(--s-6)' }}>
        {grouped.map(({ cat, fns }) => (
          <div key={cat}>
            <div className="kpi__label" style={{ fontSize: 11, marginBottom: 'var(--s-2)' }}>{cat}</div>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--s-3)' }}>
              {fns.map(fn => (
                <FunctionRow
                  key={fn.slug}
                  fn={fn}
                  latest={fn.agent ? latestByAgent[fn.agent] : null}
                  runs7d={fn.agent ? runs7dByAgent[fn.agent] : null}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </SettingsPage>
  )
}
