import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

// Functions — alle Supabase edge functions in één overzicht: laatste run-status,
// fouten, en (voor vercel-control) deploy-knoppen voor het dashboard zelf.
//
// Edge functions hebben we hardcoded omdat hun namen + bedoeling niet uit de DB
// te halen zijn. Wel hun runs: die staan in agent_runs op agent_name.

const REFRESH_MS = 30_000

const FUNCTIONS = [
  // --- Data sync ---
  { slug: 'mail-sync-etl-v2',         agent: 'mail-sync',                category: 'Data',    label: 'Mail sync',            desc: 'Outlook delta sync — live elke 15 min' },
  { slug: 'mail-backfill',            agent: 'mail-backfill',            category: 'Data',    label: 'Mail backfill',        desc: '12 mnd historische mail ophalen, in batches' },
  { slug: 'hubspot-sync-etl',         agent: 'hubspot-sync',             category: 'Data',    label: 'HubSpot sync',         desc: 'Deals / companies / contacts / owners / pipelines' },
  { slug: 'hubspot-engagements-sync', agent: 'hubspot-engagements-sync', category: 'Data',    label: 'HubSpot engagements',  desc: 'Calls / emails / notes / tasks / meetings' },
  { slug: 'jira-sync-etl',            agent: 'jira-sync',                category: 'Data',    label: 'Jira sync',            desc: 'Sales / Management / Recruitment / Partnerships boards' },
  // --- AI / processing ---
  { slug: 'mail-embed',               agent: 'mail-embed',               category: 'AI',      label: 'Mail embed',           desc: 'OpenAI embeddings voor mails + engagements (text-embedding-3-small)' },
  { slug: 'transcribe',               agent: null,                       category: 'AI',      label: 'Transcribe (Whisper)', desc: 'Voice-to-text via OpenAI Whisper', noTracking: true, trackingNote: 'Geen run-logging — zie Token Cost Counter project' },
  // --- Utility ---
  { slug: 'km-distance-lookup',       agent: null,                       category: 'Utility', label: 'Km distance lookup',   desc: 'Google Maps reisafstand-lookup voor kilometerregistratie', noTracking: true, trackingNote: 'On-demand call vanuit dashboard, geen run-logging' },
  { slug: 'km-excel-generate',        agent: 'km-excel-generate',        category: 'Utility', label: 'Km Excel generate',    desc: 'Genereert maand-Excel kilometerregistratie' },
  // --- Deploy / control ---
  { slug: 'vercel-control',           agent: 'vercel-control',           category: 'Deploy',  label: 'Vercel control',       desc: 'Dashboard deploy / rollback / promote / cancel via Vercel API', primary: true },
  { slug: 'vercel-relay',             agent: null,                       category: 'Deploy',  label: 'Vercel relay',         desc: '⚠ Deprecated 2026-04-28 — vervangen door vercel-control. Returnt 410 Gone.', deprecated: true, noTracking: true },
]

const CATEGORIES = ['Data', 'AI', 'Utility', 'Deploy']

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
  const errs = (runs7d || []).filter((r) => r.status === 'error').length
  const succ = (runs7d || []).filter((r) => r.status === 'success').length
  const pill = latest ? statusPill(latest.status) : { tag: 's-idle', label: 'geen logs' }

  return (
    <div className="card" style={{ padding: 'var(--s-4)', display: 'flex', flexDirection: 'column', gap: 6, borderColor: fn.deprecated ? 'var(--warning, #d97706)' : undefined, opacity: fn.deprecated ? 0.7 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{fn.label}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{fn.slug}</div>
        </div>
        <span className={`status-pill ${pill.tag}`} style={{ flexShrink: 0 }}>
          {pill.label}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fn.desc}</div>
      {fn.noTracking ? (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', paddingTop: 4 }}>
          {fn.trackingNote || 'Geen run-logging.'}
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', paddingTop: 4, borderTop: '1px solid var(--border)' }}>
          <span>Laatste run: {latest ? relTime(latest.started_at) : 'nooit'}</span>
          <span>7d: {succ}✓ {errs > 0 ? `${errs}✗` : ''}</span>
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

function VercelDeployTable({ deploys, busy, onPromote, onCancel }) {
  if (!deploys || deploys.length === 0) {
    return (
      <div style={{ padding: 'var(--s-5)', textAlign: 'center', color: 'var(--text-muted)' }}>
        Nog geen deploys opgehaald — klik <strong>Refresh</strong> om vercel-control te draaien.
      </div>
    )
  }
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
          <th style={{ padding: 10 }}>State</th>
          <th style={{ padding: 10 }}>Target</th>
          <th style={{ padding: 10 }}>Commit</th>
          <th style={{ padding: 10 }}>Tijd</th>
          <th style={{ padding: 10, textAlign: 'right' }}>Acties</th>
        </tr>
      </thead>
      <tbody>
        {deploys.map((d) => {
          const isProd = d.target === 'production'
          const isLive = d.state === 'READY' && isProd
          const isBuilding = ['BUILDING', 'INITIALIZING', 'QUEUED'].includes(d.state)
          const stateTone = d.state === 'READY' ? 's-success' : d.state === 'ERROR' ? 's-error' : isBuilding ? 's-warning' : 's-idle'
          return (
            <tr key={d.uid} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: 10 }}>
                <span className={`status-pill ${stateTone}`} style={{ fontSize: 11 }}>
                  {d.state}{isLive && ' · live'}
                </span>
              </td>
              <td style={{ padding: 10, fontSize: 12, color: isProd ? 'var(--text)' : 'var(--text-muted)' }}>
                {d.target || 'preview'}
              </td>
              <td style={{ padding: 10, fontSize: 12 }}>
                {d.commit_sha && <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginRight: 6 }}>{d.commit_sha}</span>}
                <span style={{ color: 'var(--text-muted)' }}>{d.commit_message ? (d.commit_message.length > 50 ? d.commit_message.slice(0, 50) + '…' : d.commit_message) : '—'}</span>
              </td>
              <td style={{ padding: 10, color: 'var(--text-muted)', fontSize: 12 }}>{relTime(d.created_at)}</td>
              <td style={{ padding: 10, textAlign: 'right' }}>
                <div style={{ display: 'inline-flex', gap: 6 }}>
                  {d.url && (
                    <a href={d.url} target="_blank" rel="noreferrer" className="btn btn--ghost" style={{ fontSize: 11, padding: '4px 8px' }}>
                      Open ↗
                    </a>
                  )}
                  {d.state === 'READY' && !isLive && (
                    <button className="btn btn--ghost" disabled={busy} onClick={() => onPromote(d.uid)} style={{ fontSize: 11, padding: '4px 8px' }} title="Maak deze deployment live in production">
                      Promote
                    </button>
                  )}
                  {isBuilding && (
                    <button className="btn btn--ghost" disabled={busy} onClick={() => onCancel(d.uid)} style={{ fontSize: 11, padding: '4px 8px' }} title="Annuleer deze build">
                      Cancel
                    </button>
                  )}
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export default function FunctionsView() {
  const [latestByAgent, setLatestByAgent] = useState({})
  const [runs7dByAgent, setRuns7dByAgent] = useState({})
  const [deploys, setDeploys] = useState(null)
  const [busy, setBusy] = useState(false)
  const [actionMsg, setActionMsg] = useState(null)
  const [error, setError] = useState(null)
  const [fetchedAt, setFetchedAt] = useState(null)

  const fetchHealth = useCallback(async () => {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString()
      const knownAgents = FUNCTIONS.filter((f) => f.agent).map((f) => f.agent)
      const { data, error: err } = await supabase.from('agent_runs')
        .select('agent_name,status,summary,started_at,stats')
        .in('agent_name', knownAgents)
        .gte('started_at', sevenDaysAgo)
        .order('started_at', { ascending: false })
        .limit(500)
      if (err) throw err

      const latest = {}
      const runs7d = {}
      for (const r of data || []) {
        if (!latest[r.agent_name]) latest[r.agent_name] = r
        if (!runs7d[r.agent_name]) runs7d[r.agent_name] = []
        runs7d[r.agent_name].push(r)
      }
      setLatestByAgent(latest)
      setRuns7dByAgent(runs7d)

      // Eerste keer: trek de meest recente vercel-control 'list'-result als bootstrap.
      const lastList = (runs7d['vercel-control'] || []).find((r) => r.stats?.action === 'list' && r.stats?.result)
      if (lastList && deploys === null) {
        setDeploys(lastList.stats.result)
      }

      setFetchedAt(new Date())
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    fetchHealth()
    const id = setInterval(fetchHealth, REFRESH_MS)
    return () => clearInterval(id)
  }, [fetchHealth])

  async function callVercel(action, body = {}) {
    setBusy(true)
    setActionMsg(null)
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke('vercel-control', {
        body: { action, ...body },
      })
      if (invokeErr) throw invokeErr
      if (data?.ok === false) throw new Error(data.error || 'unknown')
      if (action === 'list') {
        setDeploys(data.result || [])
        setActionMsg(`✓ ${data.result?.length || 0} deploys opgehaald`)
      } else {
        setActionMsg(`✓ ${action} verstuurd — ververs over enkele seconden`)
        setTimeout(() => callVercel('list'), 2500)
      }
      // Refresh health zodat de nieuwe agent_runs-row meekomt
      fetchHealth()
    } catch (e) {
      setActionMsg(`✗ ${e.message || 'fout'}`)
    } finally {
      setBusy(false)
      setTimeout(() => setActionMsg(null), 6000)
    }
  }

  async function onPromote(uid) {
    if (!confirm(`Deze deployment promoten naar production?\n\n${uid}`)) return
    callVercel('promote', { deployment_id: uid })
  }
  async function onCancel(uid) {
    if (!confirm(`Deze build annuleren?\n\n${uid}`)) return
    callVercel('cancel', { deployment_id: uid })
  }
  async function onRedeploy() {
    if (!confirm('Forceer een nieuwe production-deploy van branch main?')) return
    callVercel('redeploy', { branch: 'main' })
  }

  // Group functions by category
  const grouped = CATEGORIES.map((cat) => ({
    cat,
    fns: FUNCTIONS.filter((f) => f.category === cat),
  })).filter((g) => g.fns.length > 0)

  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>

      {/* Vercel deploy controls — staat bovenaan want is de meest interactieve sectie */}
      <section>
        <div className="section__head">
          <h2 className="section__title">Dashboard deployments</h2>
          <span className="section__hint">via vercel-control · niet meer via chat</span>
        </div>
        <div className="card" style={{ padding: 'var(--s-5)' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--s-3)', alignItems: 'center', marginBottom: 'var(--s-3)' }}>
            <button className="btn btn--ghost" disabled={busy} onClick={() => callVercel('list')}>
              {busy ? '…' : '↻'} Refresh
            </button>
            <button className="btn btn--accent" disabled={busy} onClick={onRedeploy} title="Forceer een nieuwe production-deploy van branch main">
              Redeploy main
            </button>
            <a href="https://vercel.com/jelle-burggraaf/legal-mind-dashboard" target="_blank" rel="noreferrer" className="btn btn--ghost" style={{ marginLeft: 'auto' }}>
              Open in Vercel ↗
            </a>
          </div>
          {actionMsg && (
            <div style={{ fontSize: 12, padding: 8, borderRadius: 6, marginBottom: 'var(--s-3)', background: actionMsg.startsWith('✓') ? 'var(--success-bg, #dcfce7)' : 'var(--error-bg, #fef2f2)', color: actionMsg.startsWith('✓') ? 'var(--success, #16a34a)' : 'var(--error, #d9534f)' }}>
              {actionMsg}
            </div>
          )}
          <VercelDeployTable deploys={deploys} busy={busy} onPromote={onPromote} onCancel={onCancel} />
        </div>
      </section>

      {/* Edge functions overzicht per categorie */}
      <section>
        <div className="section__head">
          <h2 className="section__title">Edge functions</h2>
          <span className="section__hint">
            {fetchedAt ? `Laatst ververst: ${fetchedAt.toLocaleTimeString('nl-NL')}` : 'laden…'}
            {error && ` · ${error}`}
          </span>
        </div>
        <div className="stack" style={{ gap: 'var(--s-5)' }}>
          {grouped.map(({ cat, fns }) => (
            <div key={cat}>
              <div className="kpi__label" style={{ fontSize: 11, marginBottom: 'var(--s-2)' }}>{cat}</div>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--s-3)' }}>
                {fns.map((fn) => (
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
      </section>
    </div>
  )
}
