import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../../lib/supabase'

// DeploymentsPage (admin) — Vercel deploy-controles via vercel-control Edge
// Function. Verhuisd vanuit Settings/Infrastructuur 2026-05-22 met admin-styling.

const REFRESH_MS = 30_000

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

function stateTone(state) {
  if (state === 'READY') return 'ok'
  if (state === 'ERROR') return 'err'
  if (['BUILDING', 'INITIALIZING', 'QUEUED'].includes(state)) return 'warn'
  return 'info'
}

export default function DeploymentsPage() {
  const [deploys, setDeploys] = useState(null)
  const [busy, setBusy] = useState(false)
  const [actionMsg, setActionMsg] = useState(null)

  const bootstrap = useCallback(async () => {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString()
      const { data } = await supabase.from('agent_runs')
        .select('stats,started_at')
        .eq('agent_name', 'vercel-control')
        .gte('started_at', sevenDaysAgo)
        .order('started_at', { ascending: false })
        .limit(20)
      const lastList = (data || []).find(r => r.stats?.action === 'list' && r.stats?.result)
      if (lastList) setDeploys(lastList.stats.result)
    } catch {/* ignore */}
  }, [])

  useEffect(() => {
    bootstrap()
    const id = setInterval(bootstrap, REFRESH_MS)
    return () => clearInterval(id)
  }, [bootstrap])

  async function callVercel(action, body = {}) {
    setBusy(true); setActionMsg(null)
    try {
      const { data, error: invokeErr } = await supabase.functions.invoke('vercel-control', {
        body: { action, ...body },
      })
      if (invokeErr) throw invokeErr
      if (data?.ok === false) throw new Error(data.error || 'unknown')
      if (action === 'list') {
        setDeploys(data.result || [])
        setActionMsg({ tone: 'ok', text: `✓ ${data.result?.length || 0} deploys opgehaald` })
      } else {
        setActionMsg({ tone: 'ok', text: `✓ ${action} verstuurd — ververs over enkele seconden` })
        setTimeout(() => callVercel('list'), 2500)
      }
    } catch (e) {
      setActionMsg({ tone: 'err', text: `✗ ${e.message || 'fout'}` })
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

  return (
    <>
      <div className="admin-toolbar">
        <div className="admin-toolbar__meta">
          {deploys != null && <span>{deploys.length} deploys</span>}
        </div>
        <div className="admin-toolbar__actions">
          <button type="button" className="admin-btn" disabled={busy} onClick={() => callVercel('list')}>
            {busy ? '…' : '↻'} Vernieuwen
          </button>
          <button type="button" className="admin-btn admin-btn--primary" disabled={busy} onClick={onRedeploy}>
            Redeploy main
          </button>
          <a href="https://vercel.com/jelle-burggraaf/legal-mind-dashboard" target="_blank" rel="noopener noreferrer" className="admin-btn">
            Open in Vercel ↗
          </a>
        </div>
      </div>

      {actionMsg && (
        <div className={`admin-banner admin-banner--${actionMsg.tone}`}>{actionMsg.text}</div>
      )}

      {!deploys ? (
        <div className="admin-empty">
          <p className="admin-empty__title">Nog geen deploys opgehaald</p>
          <p className="admin-empty__hint">Klik <strong>Vernieuwen</strong> om vercel-control te draaien.</p>
        </div>
      ) : deploys.length === 0 ? (
        <div className="admin-empty">
          <p className="admin-empty__title">Geen deploys gevonden</p>
          <p className="admin-empty__hint">Vercel API gaf 0 deployments terug.</p>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>State</th>
                <th>Target</th>
                <th>Commit</th>
                <th>Tijd</th>
                <th className="is-right">Acties</th>
              </tr>
            </thead>
            <tbody>
              {deploys.map(d => {
                const isProd = d.target === 'production'
                const isLive = d.state === 'READY' && isProd
                const isBuilding = ['BUILDING', 'INITIALIZING', 'QUEUED'].includes(d.state)
                const tone = stateTone(d.state)
                return (
                  <tr key={d.uid}>
                    <td>
                      <span className={`admin-pill admin-pill--${tone}`}>
                        <span className="admin-pill__dot" />
                        {d.state}{isLive ? ' · live' : ''}
                      </span>
                    </td>
                    <td>
                      <span className="admin-pill">{d.target || 'preview'}</span>
                    </td>
                    <td>
                      {d.commit_sha && <span className="admin-table__mono" style={{ marginRight: 8 }}>{d.commit_sha.slice(0, 6)}</span>}
                      <span style={{ color: 'var(--text)', fontSize: 12.5 }}>
                        {d.commit_message ? (d.commit_message.length > 60 ? d.commit_message.slice(0, 60) + '…' : d.commit_message) : '—'}
                      </span>
                    </td>
                    <td><span className="admin-table__mono">{relTime(d.created_at)}</span></td>
                    <td className="is-right">
                      <div className="admin-table__actions">
                        {d.url && (
                          <a href={d.url} target="_blank" rel="noreferrer" className="admin-btn admin-btn--sm">
                            Open ↗
                          </a>
                        )}
                        {d.state === 'READY' && !isLive && (
                          <button className="admin-btn admin-btn--sm" disabled={busy} onClick={() => onPromote(d.uid)} title="Maak deze deployment live">
                            Promote
                          </button>
                        )}
                        {isBuilding && (
                          <button className="admin-btn admin-btn--sm admin-btn--danger" disabled={busy} onClick={() => onCancel(d.uid)}>
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
        </div>
      )}
    </>
  )
}
