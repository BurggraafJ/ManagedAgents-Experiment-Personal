import { useState, useEffect } from 'react'
import Sparkline from './Sparkline'
import AgentRunSnippet from './AgentRunSnippet'
import AgentSettingsPopup from './AgentSettingsPopup'
import { supabase } from '../lib/supabase'

const NO_MANUAL_TRIGGER = new Set(['orchestrator', 'dashboard-refresh', 'agent-manager'])

// Orchestrator is een infrastructuur-component die nooit "uit" mag —
// dat zou alle agents stilleggen. Daarom geen status-control op die card.
const NO_STATUS_TOGGLE = new Set(['orchestrator'])

// Schedule-status voor de UI: drie opties.
// - live        = enabled=true,  is_maintenance=false
// - maintenance = enabled=true,  is_maintenance=true   (draait gewoon, gemarkeerd als beta)
// - off         = enabled=false, is_maintenance=false
function statusOf(schedule) {
  if (!schedule?.enabled) return 'off'
  if (schedule?.is_maintenance) return 'maintenance'
  return 'live'
}

const STATUS_LABEL = {
  live:        'Live',
  maintenance: 'Onderhoud',
  off:         'Uit',
}

// Cycle-volgorde: één klik schuift naar de volgende state.
const NEXT_STATUS = {
  live:        'maintenance',
  maintenance: 'off',
  off:         'live',
}

function StatusPill({ agent, schedule }) {
  const dbStatus = statusOf(schedule)
  // Optimistic UI: pill verandert direct van kleur, daarna ververst de DB
  // via realtime-subscription en wordt deze override weer gewist.
  const [optimistic, setOptimistic] = useState(null)
  const current = optimistic || dbStatus
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState(null)
  const disabled = NO_STATUS_TOGGLE.has(agent)

  // Zodra de DB de optimistic-waarde heeft ingehaald, override weghalen.
  useEffect(() => {
    if (optimistic && optimistic === dbStatus) setOptimistic(null)
  }, [dbStatus, optimistic])

  async function onClick(e) {
    e.stopPropagation()
    e.preventDefault()
    if (busy || disabled) return
    const next = NEXT_STATUS[current] || 'live'
    setOptimistic(next)
    setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc('set_agent_status', {
        p_agent_name: agent,
        p_status: next,
      })
      if (error) {
        setErr(error.message); setOptimistic(null)
        console.error('set_agent_status error', error)
      } else if (data?.ok === false) {
        setErr(data.reason || 'mislukt'); setOptimistic(null)
        console.error('set_agent_status failed', data)
      }
    } catch (ex) {
      setErr(ex.message || 'netwerkfout'); setOptimistic(null)
      console.error('set_agent_status exception', ex)
    }
    setBusy(false)
  }

  const title = disabled
    ? 'Orchestrator kan niet via dashboard uitgezet worden — dat zou alle agents stilleggen.'
    : current === 'maintenance'
    ? 'Onderhoud — agent draait normaal, gemarkeerd als beta/in ontwikkeling. Klik om naar Uit te gaan.'
    : current === 'off'
    ? 'Uit — agent draait niet. Klik om weer Live te zetten.'
    : 'Live — agent draait volgens schedule. Klik om naar Onderhoud te gaan.'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={`agent-card__status-pill agent-card__status-pill--${current}`}
      aria-label={`Agent-status: ${STATUS_LABEL[current]} (klik om te wisselen)`}
      title={err ? `${title} · ⚠ ${err}` : title}
    >
      <span className="agent-card__status-pill-dot" />
      <span>{STATUS_LABEL[current]}</span>
    </button>
  )
}

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
  'daily-admin':          { key: 'deals_updated',   label: 'deals' },
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

export default function AgentCard({ agent, schedule, latestRun, history, openQuestions = [], extras = {}, hideOpenQuestions = false }) {
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
  const [settingsOpen, setSettingsOpen] = useState(false)

  const scheduleStatus = statusOf(schedule)

  // Toon de mono-naam alleen als hij echt afwijkt van de display_name
  // (anders is het ruis: "Orchestrator / orchestrator").
  const showAgentSubtitle = schedule?.display_name && schedule.display_name.toLowerCase() !== agent.toLowerCase()

  return (
    <div className={`agent-card ${isRunning ? 'is-running' : ''} agent-card--status-${scheduleStatus}`}>
      <div className="agent-card__head">
        <div className="agent-card__title">
          <span className={statusClass} style={{ fontSize: 10 }}>
            {isRunning ? <span className="dot dot--pulse" /> : STATUS_ICON[status]}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span className="agent-card__name">{schedule?.display_name || agent}</span>
            {showAgentSubtitle && (
              <span className="mono muted" style={{ fontSize: 10, lineHeight: 1.1, marginTop: 1 }}>
                {agent}
              </span>
            )}
          </div>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {schedule && <StatusPill agent={agent} schedule={schedule} />}
          <Sparkline history={history} />
          {schedule && (
            <button
              type="button"
              className="agent-card__settings-btn"
              onClick={(e) => { e.stopPropagation(); setSettingsOpen(true) }}
              aria-label="Instellingen voor deze agent"
              title="Instellingen — cadence, timeout, run nu"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
          )}
        </div>
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

      {!hideOpenQuestions && openQuestions.length > 0 && (
        <div className="agent-card__questions">
          {openQuestions.slice(0, 3).map(q => (
            <CompactQuestion key={q.id} q={q} />
          ))}
          {openQuestions.length > 3 && (
            <div className="muted" style={{ fontSize: 11 }}>
              +{openQuestions.length - 3} meer — zie {agent === 'daily-admin' ? 'HubSpot-pagina' : 'detail'}
            </div>
          )}
        </div>
      )}

      {settingsOpen && (
        <AgentSettingsPopup
          agent={agent}
          schedule={schedule}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}
