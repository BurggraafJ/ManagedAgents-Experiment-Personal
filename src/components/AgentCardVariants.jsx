import { useState, useEffect } from 'react'
import Sparkline from './Sparkline'
import AgentRunSnippet from './AgentRunSnippet'
import AgentSettingsPopup from './AgentSettingsPopup'
import { supabase } from '../lib/supabase'

// ─────────────────────────────────────────────────────────────────────────
//  DRIE AGENT-CARD VOORSTELLEN — drastisch verschillende indelingen.
//
//  Voorstel A — "Stat Tile"
//      Vierkante compacte tegel. Groot getal in het midden (laatste-run-
//      output of dag-totaal). Geen snippet, geen feed. 4-koloms grid.
//      Voor wie cijfers wil, niet uitleg.
//
//  Voorstel B — "Side-by-Side"
//      Brede kaart met links een paneel (status + naam + sparkline +
//      tijden) en rechts de run-snippet groot in beeld. Klik = settings.
//
//  Voorstel C — "Activity Feed"
//      Header + timeline-stijl lijst van de laatste runs (per regel
//      tijd + status + summary). Voelt als een logboek.
//
//  Allemaal: status-pill (klik-cycle live/onderhoud/uit), cog voor
//  settings-popup, geen Run-nu op de card.
// ─────────────────────────────────────────────────────────────────────────

const NO_STATUS_TOGGLE = new Set(['orchestrator'])
const NO_RUN_NOW = new Set(['orchestrator', 'dashboard-refresh', 'agent-manager'])
function statusOf(s) { return !s?.enabled ? 'off' : s?.is_maintenance ? 'maintenance' : 'live' }
const STATUS_LABEL = { live: 'Live', maintenance: 'Onderhoud', off: 'Uit' }
const NEXT_STATUS  = { live: 'maintenance', maintenance: 'off', off: 'live' }

function formatPast(iso) {
  if (!iso) return '—'
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return 'zojuist'
  if (m < 60) return `${m}m geleden`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}u geleden`
  return `${Math.round(h / 24)}d geleden`
}
function formatFuture(iso) {
  if (!iso) return '—'
  const m = Math.round((new Date(iso).getTime() - Date.now()) / 60000)
  if (m <= 0) return 'nu'
  if (m < 60) return `over ${m}m`
  const h = Math.floor(m / 60), r = m % 60
  if (h < 24) return r > 0 ? `over ${h}u ${r}m` : `over ${h}u`
  return `over ${Math.round(m / 1440)}d`
}

// Per agent een primary-metric voor de stat-tile (Voorstel A) en
// activity-context (Voorstel C). Labels zijn nederlands.
const PRIMARY_METRIC = {
  'auto-draft':           { key: 'drafts_created',  label: 'drafts',    fallback: 'mails' },
  'daily-admin':          { key: 'deals_updated',   label: 'updates',   fallback: 'voorstellen' },
  'sales-followups':      { key: 'drafts_prepared', label: 'taken',     fallback: 'todos' },
  'task-organizer':       { key: 'tasks_total',     label: 'taken',     fallback: 'taken' },
  'auto-draft-execute':   { key: 'sent_count',      label: 'verstuurd', fallback: 'acties' },
}
function primaryValue(agent, run) {
  const m = PRIMARY_METRIC[agent]
  if (!m) return { value: null, label: '' }
  const v = run?.stats?.[m.key]
  if (v !== undefined && v !== null) return { value: v, label: m.label }
  return { value: null, label: m.fallback }
}

// ─── Gedeelde StatusPill ──────────────────────────────────────────────
function StatusPill({ agent, schedule, size = 'md' }) {
  const dbStatus = statusOf(schedule)
  const [optimistic, setOptimistic] = useState(null)
  const current = optimistic || dbStatus
  const [busy, setBusy] = useState(false)
  const disabled = NO_STATUS_TOGGLE.has(agent)

  useEffect(() => { if (optimistic && optimistic === dbStatus) setOptimistic(null) }, [dbStatus, optimistic])

  async function onClick(e) {
    e.stopPropagation(); e.preventDefault()
    if (busy || disabled) return
    const next = NEXT_STATUS[current] || 'live'
    setOptimistic(next); setBusy(true)
    try {
      const { data, error } = await supabase.rpc('set_agent_status', { p_agent_name: agent, p_status: next })
      if (error || data?.ok === false) { setOptimistic(null); console.error('set_agent_status', error || data) }
    } catch (ex) { setOptimistic(null); console.error(ex) }
    setBusy(false)
  }
  return (
    <button
      type="button" onClick={onClick} disabled={busy || disabled}
      className={`agent-card__status-pill agent-card__status-pill--${current} ${size === 'lg' ? 'agent-card__status-pill--lg' : ''}`}
      title={disabled ? 'Niet via dashboard te wisselen' : `Klik = volgende status (nu: ${STATUS_LABEL[current]})`}
    >
      <span className="agent-card__status-pill-dot" />
      <span>{STATUS_LABEL[current]}</span>
    </button>
  )
}
function CogButton({ onClick }) {
  return (
    <button type="button" onClick={onClick} className="agent-card__settings-btn" aria-label="Instellingen" title="Instellingen — cadence, timeout, logboek">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    </button>
  )
}

// Run-nu icon-knop — direct naast de cog. Vraagt aan via request_run_now;
// orchestrator pakt 'm bij eerstvolgende poll. Heeft optimistic feedback.
function RunNowButton({ agent, schedule }) {
  const disabled = !schedule?.enabled || schedule?.is_running || NO_RUN_NOW.has(agent)
  const [state, setState] = useState('idle') // idle | submitting | ok | err
  const [pendingRequested, setPendingRequested] = useState(false)

  // Pending = manual_run_requested_at staat na last_run_at
  const dbPending = schedule?.manual_run_requested_at
    && (!schedule?.last_run_at
        || new Date(schedule.last_run_at) < new Date(schedule.manual_run_requested_at))
  const isPending = dbPending || pendingRequested

  async function onClick(e) {
    e.stopPropagation(); e.preventDefault()
    if (state === 'submitting' || disabled || isPending) return
    setState('submitting')
    try {
      const { data, error } = await supabase.rpc('request_run_now', { agent })
      if (error) {
        setState('err')
        setTimeout(() => setState('idle'), 3000)
        console.error('request_run_now', error)
      } else if (data?.ok) {
        setState('ok')
        setPendingRequested(true)
        setTimeout(() => setState('idle'), 2500)
      } else {
        setState('err')
        setTimeout(() => setState('idle'), 3000)
        console.error('request_run_now', data)
      }
    } catch (ex) {
      setState('err')
      setTimeout(() => setState('idle'), 3000)
      console.error(ex)
    }
  }

  // Reset pending zodra de DB-state het overneemt
  useEffect(() => { if (dbPending) setPendingRequested(false) }, [dbPending])

  const title = disabled
    ? (NO_RUN_NOW.has(agent) ? 'Niet handmatig te triggeren' : !schedule?.enabled ? 'Agent staat uit' : 'Draait al')
    : isPending ? 'Aangevraagd — orchestrator pakt hem bij volgende poll'
    : 'Run nu — markeer voor volgende orchestrator-poll'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || state === 'submitting' || isPending}
      className={`agent-card__run-btn ${state === 'ok' || isPending ? 'is-pending' : ''} ${state === 'err' ? 'is-err' : ''}`}
      aria-label="Run nu"
      title={title}
    >
      {state === 'submitting' ? (
        <span className="agent-card__run-btn-spin">⟳</span>
      ) : state === 'err' ? (
        <span>!</span>
      ) : isPending ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="6 4 20 12 6 20 6 4"/>
        </svg>
      )}
    </button>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// VOORSTEL A — Stat Tile (compact vierkant, getal-centric)
// ═══════════════════════════════════════════════════════════════════════
export function AgentCardA({ agent, schedule, latestRun, history }) {
  const [open, setOpen] = useState(false)
  const isRunning = !!schedule?.is_running
  const scheduleStatus = statusOf(schedule)
  const { value, label } = primaryValue(agent, latestRun)
  const showSubtitle = schedule?.display_name && schedule.display_name.toLowerCase() !== agent.toLowerCase()

  return (
    <div className={`agent-card agent-card--tile ${isRunning ? 'is-running' : ''} agent-card--status-${scheduleStatus}`}>
      <div className="agent-card-tile__head">
        <div style={{ minWidth: 0 }}>
          <div className="agent-card-tile__name">{schedule?.display_name || agent}</div>
          {showSubtitle && <div className="mono muted" style={{ fontSize: 9 }}>{agent}</div>}
        </div>
        {schedule && <CogButton onClick={(e) => { e.stopPropagation(); setOpen(true) }} />}
      </div>

      <div className="agent-card-tile__metric">
        <span className="agent-card-tile__num">{value ?? '—'}</span>
        <span className="agent-card-tile__label">{label}</span>
      </div>

      <div className="agent-card-tile__foot">
        {schedule && <StatusPill agent={agent} schedule={schedule} />}
        <Sparkline history={history} />
      </div>

      {open && <AgentSettingsPopup agent={agent} schedule={schedule} onClose={() => setOpen(false)} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// VOORSTEL B — Side-by-Side (links info-paneel, rechts run-snippet)
// ═══════════════════════════════════════════════════════════════════════
export function AgentCardB({ agent, schedule, latestRun, history }) {
  const [open, setOpen] = useState(false)
  const isRunning = !!schedule?.is_running
  const status = isRunning ? 'running' : (latestRun?.status || 'empty')
  const tone = status === 'success' ? 's-success' : status === 'error' ? 's-error' : status === 'warning' ? 's-warning' : 's-idle'
  const scheduleStatus = statusOf(schedule)
  const showSubtitle = schedule?.display_name && schedule.display_name.toLowerCase() !== agent.toLowerCase()

  return (
    <div className={`agent-card agent-card--split ${isRunning ? 'is-running' : ''} agent-card--status-${scheduleStatus}`}>
      <div className="agent-card-split__left">
        <div className="agent-card-split__top">
          {schedule && <StatusPill agent={agent} schedule={schedule} />}
        </div>
        <div className="agent-card-split__name">
          <span className={tone} style={{ fontSize: 10, marginRight: 6 }}>
            {isRunning ? <span className="dot dot--pulse" /> : '●'}
          </span>
          {schedule?.display_name || agent}
        </div>
        {showSubtitle && <div className="mono muted" style={{ fontSize: 10, marginTop: 2 }}>{agent}</div>}
        <div className="agent-card-split__spark"><Sparkline history={history} /></div>
        <div className="agent-card-split__times">
          <div><span className="muted">laatste</span> {formatPast(latestRun?.started_at)}</div>
          {schedule?.next_run_at && !isRunning && (
            <div><span className="muted">volgende</span> {formatFuture(schedule.next_run_at)}</div>
          )}
        </div>
      </div>

      <div className="agent-card-split__right">
        <div className="agent-card-split__right-head">
          <span className="kpi__label" style={{ margin: 0 }}>Wat de agent laatst deed</span>
          {schedule && <CogButton onClick={(e) => { e.stopPropagation(); setOpen(true) }} />}
        </div>
        <div className="agent-card-split__snippet">
          {isRunning
            ? <em className="dim">Draait nu…</em>
            : latestRun
              ? <AgentRunSnippet agent={agent} run={latestRun} />
              : <span className="muted">Nog geen runs</span>}
        </div>
      </div>

      {open && <AgentSettingsPopup agent={agent} schedule={schedule} onClose={() => setOpen(false)} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════
// VOORSTEL C — Activity Feed (timeline-stijl logboek)
// ═══════════════════════════════════════════════════════════════════════
const FEED_STATUS_ICON = {
  success: { ch: '✓', cls: 's-success' },
  warning: { ch: '⚠', cls: 's-warning' },
  error:   { ch: '✗', cls: 's-error' },
  running: { ch: '⟳', cls: 's-running' },
  empty:   { ch: '○', cls: 's-idle' },
}
function fmtClock(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
}
export function AgentCardC({ agent, schedule, latestRun, history }) {
  const [open, setOpen] = useState(false)
  const [recent, setRecent] = useState(null)
  const isRunning = !!schedule?.is_running
  const scheduleStatus = statusOf(schedule)
  const showSubtitle = schedule?.display_name && schedule.display_name.toLowerCase() !== agent.toLowerCase()

  // Lichte fetch bij open van de pagina — laatste 5 runs voor de feed.
  useEffect(() => {
    let cancelled = false
    supabase.from('agent_runs')
      .select('id, status, summary, started_at')
      .eq('agent_name', agent)
      .order('started_at', { ascending: false })
      .limit(5)
      .then(({ data }) => { if (!cancelled) setRecent(data || []) })
    return () => { cancelled = true }
  }, [agent, latestRun?.id])

  return (
    <div className={`agent-card agent-card--feed ${isRunning ? 'is-running' : ''} agent-card--status-${scheduleStatus}`}>
      <div className="agent-card-feed__head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="agent-card-feed__name">
            <span className="agent-card-feed__statusdot">
              {isRunning ? <span className="dot dot--pulse" /> : '●'}
            </span>
            {schedule?.display_name || agent}
          </div>
          {showSubtitle && <div className="mono muted" style={{ fontSize: 10, marginTop: 2 }}>{agent}</div>}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {schedule && <StatusPill agent={agent} schedule={schedule} />}
          {schedule && <RunNowButton agent={agent} schedule={schedule} />}
          {schedule && <CogButton onClick={(e) => { e.stopPropagation(); setOpen(true) }} />}
        </div>
      </div>

      <div className="agent-card-feed__list">
        {recent === null && <div className="muted" style={{ fontSize: 11, padding: 8 }}>laden…</div>}
        {recent && recent.length === 0 && <div className="muted" style={{ fontSize: 11, padding: 8 }}>nog geen runs</div>}
        {recent && recent.map(r => {
          const ic = FEED_STATUS_ICON[r.status] || FEED_STATUS_ICON.empty
          return (
            <div key={r.id} className="agent-card-feed__row">
              <span className="agent-card-feed__time">{fmtClock(r.started_at)}</span>
              <span className={`agent-card-feed__icon ${ic.cls}`}>{ic.ch}</span>
              <span className="agent-card-feed__msg">
                {r.summary ? (r.summary.length > 60 ? r.summary.slice(0, 60) + '…' : r.summary) : <span className="muted">—</span>}
              </span>
            </div>
          )
        })}
      </div>

      <div className="agent-card-feed__foot">
        {schedule?.next_run_at && !isRunning ? (
          <span className="muted" style={{ fontSize: 11 }}>volgende run {formatFuture(schedule.next_run_at)}</span>
        ) : (
          <span className="muted" style={{ fontSize: 11 }}>{isRunning ? 'draait nu' : '—'}</span>
        )}
        <Sparkline history={history} />
      </div>

      {open && <AgentSettingsPopup agent={agent} schedule={schedule} onClose={() => setOpen(false)} />}
    </div>
  )
}

export const CARD_VARIANTS = {
  'proposal-a': AgentCardA,
  'proposal-b': AgentCardB,
  'proposal-c': AgentCardC,
}
