import { useState } from 'react'
import Sparkline from './Sparkline'
import AgentRunSnippet from './AgentRunSnippet'
import { supabase } from '../lib/supabase'

const NO_MANUAL_TRIGGER = new Set(['orchestrator', 'dashboard-refresh', 'agent-manager'])

// Een manual-run-aanvraag is "pending" zolang er een `manual_run_requested_at`
// staat die NA de laatste `last_run_at` ligt. Zodra de orchestrator hem heeft
// getriggerd en de agent heeft gedraaid (en dus `last_run_at` is bijgewerkt),
// verdwijnt de status weer naar idle.
function isRequestPending(schedule) {
  if (!schedule?.manual_run_requested_at) return false
  if (schedule.is_running) return true
  if (!schedule.last_run_at) return true
  return new Date(schedule.last_run_at) < new Date(schedule.manual_run_requested_at)
}

function useRunNow(agent, schedule) {
  const pending = isRequestPending(schedule)
  const [state, setState] = useState('idle') // idle | submitting | ok | err
  const [msg, setMsg]     = useState(null)

  async function trigger(e) {
    e?.stopPropagation?.()
    if (state === 'submitting') return
    setState('submitting'); setMsg(null)
    try {
      const { data, error } = await supabase.rpc('request_run_now', { agent })
      if (error) {
        setState('err'); setMsg(error.message)
      } else if (data && data.ok) {
        // DB heeft nu manual_run_requested_at gezet — zodra useDashboard
        // refetcht zien we dat via `pending` en kan state weer terug naar idle.
        setState('ok')
        setMsg(data.status === 'already_requested'
          ? 'Aanvraag stond al open — wacht op orchestrator.'
          : 'Aangevraagd — orchestrator pakt hem bij volgende poll op.')
        setTimeout(() => { setState('idle'); setMsg(null) }, 3000)
      } else {
        setState('err')
        const reason = data?.reason || 'unknown'
        setMsg(({
          agent_not_found:               'Agent niet gevonden.',
          agent_not_manually_triggerable:'Deze agent triggert niet handmatig.',
          agent_disabled:                'Agent staat uit.',
          already_running:               'Draait al.',
        })[reason] || `Niet gelukt (${reason}).`)
        setTimeout(() => { setState('idle'); setMsg(null) }, 6000)
      }
    } catch (err) {
      setState('err'); setMsg(err.message || 'Netwerkfout')
      setTimeout(() => { setState('idle'); setMsg(null) }, 6000)
    }
  }

  // Toon persistent de "wacht op orchestrator" status tot agent heeft gedraaid
  const effectiveState = state !== 'idle' ? state : (pending ? 'pending' : 'idle')
  const effectiveMsg = pending && state === 'idle'
    ? `Aangevraagd ${formatAgoShort(schedule.manual_run_requested_at)} — wacht op orchestrator-poll`
    : msg

  return { state: effectiveState, msg: effectiveMsg, trigger, pending }
}

function formatAgoShort(iso) {
  if (!iso) return ''
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'zojuist'
  if (min < 60) return `${min}m geleden`
  return `${Math.round(min / 60)}u geleden`
}

const STATUS_ICON = {
  success: '●',
  warning: '●',
  error:   '●',
  empty:   '○',
  running: '●',
}

const METRIC_MAP = {
  'auto-draft':           { key: 'drafts_created',  label: 'drafts' },
  'hubspot-daily-sync':   { key: 'deals_updated',   label: 'deals' },
  'linkedin-connect':     { key: 'connects_sent',   label: 'connects' },
  'kilometerregistratie': { key: null,              label: 'maand' },
  'orchestrator':         { key: 'agents_ran',      label: 'agents' },
  'sales-todos':          { key: 'drafts_prepared', label: 'drafts' },
  'sales-on-road':        { key: null,              label: '' },
}

function formatPast(iso) {
  if (!iso) return '—'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'zojuist'
  if (mins < 60) return `${mins}m geleden`
  const h = Math.round(mins / 60)
  if (h < 24) return `${h}u geleden`
  return `${Math.round(h / 24)}d geleden`
}

function formatFuture(iso) {
  if (!iso) return '—'
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000)
  if (mins <= 0) return 'nu'
  if (mins < 60) return `over ${mins}m`
  const h = Math.floor(mins / 60)
  const remM = mins % 60
  if (h < 24) return remM > 0 ? `over ${h}u ${remM}m` : `over ${h}u`
  return `over ${Math.round(mins / (24 * 60))}d`
}

function CompactQuestion({ q }) {
  const ctx = (q && typeof q.context === 'object' && !Array.isArray(q.context)) ? q.context : null
  const company = ctx?.company || ctx?.bedrijf || null
  const time    = ctx?.meeting_time || ctx?.time || null
  const email   = ctx?.email || (Array.isArray(ctx?.emails) ? ctx.emails[0] : null) || null
  const date    = ctx?.date || null

  // Alleen data-rij tonen als we minstens company OF time hebben; anders fallback naar korte tekst.
  const hasData = company || time || email
  if (!hasData) {
    const text = (q.question || '').split(/[.?!]/)[0].slice(0, 80)
    return (
      <div className={`agent-card__question agent-card__question--${q.urgency}`}>
        {text || '—'}
      </div>
    )
  }

  return (
    <div className={`agent-card__question agent-card__question--${q.urgency}`}>
      <div className="agent-card__question-row">
        {company && <span className="agent-card__question-company">{company}</span>}
        {time && <span className="agent-card__question-meta">{time}</span>}
        {date && !time && <span className="agent-card__question-meta">{date}</span>}
      </div>
      {email && <div className="agent-card__question-email mono">{email}</div>}
    </div>
  )
}

export default function AgentCard({ agent, schedule, latestRun, history, openQuestions = [], extras = {} }) {
  const isRunning = !!schedule?.is_running
  const status = isRunning ? 'running' : (latestRun?.status || 'empty')
  const statusClass = isRunning ? 's-running'
                    : status === 'success' && openQuestions.length > 0 ? 's-warning'
                    : `s-${status === 'empty' ? 'idle' : status}`

  const metric = METRIC_MAP[agent] || { key: null, label: '' }
  const metricValue = metric.key ? latestRun?.stats?.[metric.key] : undefined

  const canManualTrigger = schedule?.enabled && !NO_MANUAL_TRIGGER.has(agent) && !isRunning
  const runNow = useRunNow(agent, schedule)
  const needsAction = openQuestions.length > 0

  return (
    <div className={`agent-card ${isRunning ? 'is-running' : ''}`}>
      <div className="agent-card__head">
        <div className="agent-card__title">
          <span className={statusClass} style={{ fontSize: 10 }}>
            {isRunning ? <span className="dot dot--pulse" /> : STATUS_ICON[status]}
          </span>
          <span className="agent-card__name">{schedule?.display_name || agent}</span>
          {schedule?.slack_channel && (
            <span className="agent-card__channel">#{schedule.slack_channel}</span>
          )}
          {needsAction && (
            <span className="agent-card__badge agent-card__badge--action">
              actie nodig · {openQuestions.length}
            </span>
          )}
          {!needsAction && latestRun?.status === 'success' && !runNow.pending && (
            <span className="agent-card__badge agent-card__badge--ok">
              geen actie
            </span>
          )}
        </div>
        <Sparkline history={history} />
      </div>

      <div className="agent-card__summary">
        {isRunning
          ? <em className="dim">Draait nu…</em>
          : (latestRun || agent === 'sales-on-road')
            ? <AgentRunSnippet agent={agent} run={latestRun} extras={extras} />
            : <span className="muted">geen runs</span>}
      </div>

      <div className="agent-card__footer">
        <span>laatste {formatPast(latestRun?.started_at)}</span>
        {schedule?.next_run_at && !isRunning && (
          <span>volgende {formatFuture(schedule.next_run_at)}</span>
        )}
        {metricValue !== undefined && metricValue !== null && (
          <span className="agent-card__metric">
            {metricValue}<span className="agent-card__metric-label">{metric.label}</span>
          </span>
        )}
        {canManualTrigger && (
          <button
            type="button"
            className={`agent-card__run-now agent-card__run-now--${runNow.state}`}
            onClick={runNow.trigger}
            title={runNow.msg || 'Markeer voor volgende orchestrator-poll'}
            aria-label="Run nu"
            disabled={runNow.state === 'submitting' || runNow.state === 'pending'}
          >
            {runNow.state === 'submitting' ? '…'
             : runNow.state === 'pending'   ? '⟳ wacht'
             : runNow.state === 'ok'        ? '✓ aangevraagd'
             : runNow.state === 'err'       ? '! mislukt'
             : '↻ run nu'}
          </button>
        )}
      </div>
      {runNow.msg && runNow.state !== 'idle' && (
        <div className={`agent-card__run-msg agent-card__run-msg--${runNow.state}`}>
          {runNow.msg}
        </div>
      )}

      {openQuestions.length > 0 && (
        <div className="agent-card__questions">
          {openQuestions.slice(0, 3).map(q => (
            <CompactQuestion key={q.id} q={q} />
          ))}
          {openQuestions.length > 3 && (
            <div className="muted" style={{ fontSize: 11 }}>
              +{openQuestions.length - 3} meer — zie {agent === 'hubspot-daily-sync' ? 'HubSpot-pagina' : 'detail'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
