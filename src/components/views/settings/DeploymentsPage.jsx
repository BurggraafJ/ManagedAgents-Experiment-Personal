import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import { SettingsPage } from './SettingsLayout'

// DeploymentsPage — Vercel deploy/rollback/promote/cancel via vercel-control
// edge-function. Was sub-section van FunctionsView; nu eigen pagina omdat het
// geregeld nodig is en duidelijke acties heeft.

const REFRESH_MS = 30_000

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
        {deploys.map(d => {
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
                {d.commit_sha && <span className="mono" style={{ color: 'var(--text-muted)', marginRight: 6 }}>{d.commit_sha}</span>}
                <span style={{ color: 'var(--text-muted)' }}>
                  {d.commit_message ? (d.commit_message.length > 50 ? d.commit_message.slice(0, 50) + '…' : d.commit_message) : '—'}
                </span>
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

export default function DeploymentsPage() {
  const [deploys, setDeploys] = useState(null)
  const [busy, setBusy] = useState(false)
  const [actionMsg, setActionMsg] = useState(null)

  const bootstrap = useCallback(async () => {
    // Trek meest recente vercel-control 'list' run als bootstrap zodat we
    // niet hoeven invoke'en bij eerste pagina-laad.
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
        setActionMsg(`✓ ${data.result?.length || 0} deploys opgehaald`)
      } else {
        setActionMsg(`✓ ${action} verstuurd — ververs over enkele seconden`)
        setTimeout(() => callVercel('list'), 2500)
      }
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

  return (
    <SettingsPage
      title="Deployments"
      intro="Vercel deploy-controles voor dit dashboard zelf — list, promote, redeploy en cancel via vercel-control edge function."
    >
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
          <div style={{
            fontSize: 12, padding: 8, borderRadius: 6, marginBottom: 'var(--s-3)',
            background: actionMsg.startsWith('✓') ? 'var(--success-dim)' : 'var(--error-dim)',
            color: actionMsg.startsWith('✓') ? 'var(--success)' : 'var(--error)',
          }}>
            {actionMsg}
          </div>
        )}
        <VercelDeployTable deploys={deploys} busy={busy} onPromote={onPromote} onCancel={onCancel} />
      </div>
    </SettingsPage>
  )
}
