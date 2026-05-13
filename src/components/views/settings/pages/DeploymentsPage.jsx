import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../../lib/supabase'
import { SettingsPage } from '../SettingsLayout'

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
  const day = Math.floor(hr / 24)
  return `${day}d`
}

/**
 * DeploymentsPage (v2) — Vercel deploy-controles via vercel-control edge-function.
 */
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
    <SettingsPage
      title="Deployments"
      intro="Vercel deploy-controles via vercel-control edge function."
      right={
        <>
          <button
            type="button"
            className="set-btn set-btn--ghost set-btn--sm"
            disabled={busy}
            onClick={() => callVercel('list')}
          >
            {busy ? '…' : '↻'} Refresh
          </button>
          <button
            type="button"
            className="set-btn set-btn--primary set-btn--sm"
            disabled={busy}
            onClick={onRedeploy}
          >
            Redeploy main
          </button>
          <a
            href="https://vercel.com/jelle-burggraaf/legal-mind-dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="set-btn set-btn--ghost set-btn--sm"
          >
            Open in Vercel ↗
          </a>
        </>
      }
    >
      {actionMsg && (
        <div className={`set-banner set-banner--${actionMsg.tone}`}>{actionMsg.text}</div>
      )}

      {!deploys ? (
        <div className="set-stub">
          <div className="set-stub__title">Nog geen deploys opgehaald</div>
          <div className="set-stub__hint">
            Klik <strong>Refresh</strong> om vercel-control te draaien — laatste run wordt anders pas
            zichtbaar wanneer de cron-job heeft gedraaid.
          </div>
        </div>
      ) : deploys.length === 0 ? (
        <div className="set-stub">
          <div className="set-stub__title">Geen deploys gevonden</div>
          <div className="set-stub__hint">Vercel API gaf 0 deployments terug.</div>
        </div>
      ) : (
        <div className="set-panel">
          <table className="set-table">
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
                const tone =
                  d.state === 'READY' ? 'ok' :
                  d.state === 'ERROR' ? 'err' :
                  isBuilding ? 'warn' : 'info'
                return (
                  <tr key={d.uid}>
                    <td>
                      <span className={`set-pill set-pill--${tone}`}>
                        <span className="set-pill__dot" />
                        {d.state}{isLive ? ' · live' : ''}
                      </span>
                    </td>
                    <td>
                      <span className="set-pill">{d.target || 'preview'}</span>
                    </td>
                    <td>
                      {d.commit_sha && <span className="set-cell-mono" style={{ marginRight: 8, color: 'var(--set-n-500)' }}>{d.commit_sha.slice(0, 6)}</span>}
                      <span style={{ color: 'var(--set-n-700)', fontSize: 12.5 }}>
                        {d.commit_message ? (d.commit_message.length > 60 ? d.commit_message.slice(0, 60) + '…' : d.commit_message) : '—'}
                      </span>
                    </td>
                    <td><span className="set-cell-mono" style={{ color: 'var(--set-n-500)' }}>{relTime(d.created_at)}</span></td>
                    <td className="is-right">
                      <div className="set-row-actions">
                        {d.url && (
                          <a href={d.url} target="_blank" rel="noreferrer" className="set-btn set-btn--ghost set-btn--sm">
                            Open ↗
                          </a>
                        )}
                        {d.state === 'READY' && !isLive && (
                          <button className="set-btn set-btn--ghost set-btn--sm" disabled={busy} onClick={() => onPromote(d.uid)} title="Maak deze deployment live">
                            Promote
                          </button>
                        )}
                        {isBuilding && (
                          <button className="set-btn set-btn--danger set-btn--sm" disabled={busy} onClick={() => onCancel(d.uid)}>
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
    </SettingsPage>
  )
}
