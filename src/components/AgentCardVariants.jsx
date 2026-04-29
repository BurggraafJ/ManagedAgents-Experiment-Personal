import { useState, useEffect } from 'react'
import Sparkline from './Sparkline'
import AgentRunSnippet from './AgentRunSnippet'
import AgentSettingsPopup from './AgentSettingsPopup'
import { supabase } from '../lib/supabase'

// ─────────────────────────────────────────────────────────────────────────
//  Drie alternatieve agent-card-layouts. Allemaal gebruiken dezelfde props
//  en delen StatusPill + cog-knop. Geen "Run nu"-knop op de card zelf —
//  Jelle vond die niet handig; staat nu alleen in de settings-popup.
//
//  Variant 'list' — dichte lijst-rij: 1 regel per agent
//  Variant 'work' — herontworpen kaart: meer hiërarchie, betere ademruimte
//  Variant 'hero' — opgeschoonde tegel met grote titel en sparkline-band
// ─────────────────────────────────────────────────────────────────────────

const NO_STATUS_TOGGLE = new Set(['orchestrator'])

function statusOf(schedule) {
  if (!schedule?.enabled) return 'off'
  if (schedule?.is_maintenance) return 'maintenance'
  return 'live'
}
const STATUS_LABEL = { live: 'Live', maintenance: 'Onderhoud', off: 'Uit' }
const NEXT_STATUS  = { live: 'maintenance', maintenance: 'off', off: 'live' }

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

// ─── Gedeelde StatusPill (klik-cycle, optimistic UI) ──────────────────
function StatusPill({ agent, schedule, size = 'md' }) {
  const dbStatus = statusOf(schedule)
  const [optimistic, setOptimistic] = useState(null)
  const current = optimistic || dbStatus
  const [busy, setBusy] = useState(false)
  const disabled = NO_STATUS_TOGGLE.has(agent)

  useEffect(() => {
    if (optimistic && optimistic === dbStatus) setOptimistic(null)
  }, [dbStatus, optimistic])

  async function onClick(e) {
    e.stopPropagation(); e.preventDefault()
    if (busy || disabled) return
    const next = NEXT_STATUS[current] || 'live'
    setOptimistic(next); setBusy(true)
    try {
      const { data, error } = await supabase.rpc('set_agent_status', { p_agent_name: agent, p_status: next })
      if (error || data?.ok === false) { setOptimistic(null); console.error('set_agent_status', error || data) }
    } catch (ex) { setOptimistic(null); console.error('set_agent_status', ex) }
    setBusy(false)
  }

  const title = disabled
    ? 'Orchestrator kan niet via dashboard uitgezet worden.'
    : current === 'maintenance' ? 'Onderhoud — agent draait, gemarkeerd als beta. Klik = naar Uit.'
    : current === 'off'         ? 'Uit — agent draait niet. Klik = weer Live.'
    :                             'Live — agent draait volgens schedule. Klik = naar Onderhoud.'

  return (
    <button
      type="button" onClick={onClick} disabled={busy || disabled}
      className={`agent-card__status-pill agent-card__status-pill--${current} ${size === 'lg' ? 'agent-card__status-pill--lg' : ''}`}
      title={title}
    >
      <span className="agent-card__status-pill-dot" />
      <span>{STATUS_LABEL[current]}</span>
    </button>
  )
}

function CogButton({ onClick }) {
  return (
    <button
      type="button" onClick={onClick}
      className="agent-card__settings-btn"
      aria-label="Instellingen voor deze agent"
      title="Instellingen — cadence, timeout, run nu, logboek"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    </button>
  )
}

function NameWithSubtitle({ schedule, agent }) {
  const showSubtitle = schedule?.display_name && schedule.display_name.toLowerCase() !== agent.toLowerCase()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <span className="agent-card__name">{schedule?.display_name || agent}</span>
      {showSubtitle && (
        <span className="mono muted" style={{ fontSize: 10, lineHeight: 1.1, marginTop: 1 }}>{agent}</span>
      )}
    </div>
  )
}

// ─── Variant 1: List Row ──────────────────────────────────────────────
// Compacte horizontale lijst-rij; alle agents stapelen onder elkaar.
export function AgentCardList({ agent, schedule, latestRun, history }) {
  const [open, setOpen] = useState(false)
  const isRunning = !!schedule?.is_running
  const status = isRunning ? 'running' : (latestRun?.status || 'empty')
  const tone = status === 'success' ? 's-success' : status === 'error' ? 's-error' : status === 'warning' ? 's-warning' : 's-idle'
  const scheduleStatus = statusOf(schedule)

  return (
    <div className={`agent-card-list agent-card--status-${scheduleStatus}`}>
      <span className={tone} style={{ fontSize: 12, width: 14, textAlign: 'center' }}>
        {isRunning ? <span className="dot dot--pulse" /> : '●'}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <NameWithSubtitle schedule={schedule} agent={agent} />
      </div>
      {schedule && <StatusPill agent={agent} schedule={schedule} />}
      <div className="agent-card-list__sparkline"><Sparkline history={history} /></div>
      <div className="agent-card-list__times">
        <span className="muted" style={{ fontSize: 11 }}>laatste {formatPast(latestRun?.started_at)}</span>
        {schedule?.next_run_at && !isRunning && (
          <span className="muted" style={{ fontSize: 11 }}>volgende {formatFuture(schedule.next_run_at)}</span>
        )}
      </div>
      {schedule && <CogButton onClick={(e) => { e.stopPropagation(); setOpen(true) }} />}
      {open && <AgentSettingsPopup agent={agent} schedule={schedule} onClose={() => setOpen(false)} />}
    </div>
  )
}

// ─── Variant 2: Work Card ────────────────────────────────────────────
// Herontworpen kaart met duidelijke hiërarchie: header → snippet → footer.
// Sparkline rechtsonder, status-pill prominent, settings rechtsboven.
export function AgentCardWork({ agent, schedule, latestRun, history, extras = {} }) {
  const [open, setOpen] = useState(false)
  const isRunning = !!schedule?.is_running
  const status = isRunning ? 'running' : (latestRun?.status || 'empty')
  const tone = status === 'success' ? 's-success' : status === 'error' ? 's-error' : status === 'warning' ? 's-warning' : 's-idle'
  const scheduleStatus = statusOf(schedule)

  return (
    <div className={`agent-card agent-card--work ${isRunning ? 'is-running' : ''} agent-card--status-${scheduleStatus}`}>
      <div className="agent-card-work__head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <span className={tone} style={{ fontSize: 10 }}>
            {isRunning ? <span className="dot dot--pulse" /> : '●'}
          </span>
          <NameWithSubtitle schedule={schedule} agent={agent} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {schedule && <StatusPill agent={agent} schedule={schedule} />}
          {schedule && <CogButton onClick={(e) => { e.stopPropagation(); setOpen(true) }} />}
        </div>
      </div>

      <div className="agent-card-work__body">
        {isRunning
          ? <em className="dim" style={{ fontSize: 13 }}>Draait nu…</em>
          : (latestRun || agent === 'sales-on-road')
            ? <AgentRunSnippet agent={agent} run={latestRun} extras={extras} />
            : <span className="muted">Nog geen runs</span>}
      </div>

      <div className="agent-card-work__footer">
        <div className="agent-card-work__times">
          <span className="agent-card-work__time-row">
            <span className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.04em' }}>laatste</span>
            <span style={{ fontSize: 12 }}>{formatPast(latestRun?.started_at)}</span>
          </span>
          {schedule?.next_run_at && !isRunning && (
            <span className="agent-card-work__time-row">
              <span className="muted" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.04em' }}>volgende</span>
              <span style={{ fontSize: 12 }}>{formatFuture(schedule.next_run_at)}</span>
            </span>
          )}
        </div>
        <Sparkline history={history} />
      </div>

      {open && <AgentSettingsPopup agent={agent} schedule={schedule} onClose={() => setOpen(false)} />}
    </div>
  )
}

// ─── Variant 3: Hero ─────────────────────────────────────────────────
// Grote titel, status-pill prominent, sparkline-band onderin.
// Klik op de card zelf opent settings (geen losse cog).
export function AgentCardHero({ agent, schedule, latestRun, history }) {
  const [open, setOpen] = useState(false)
  const isRunning = !!schedule?.is_running
  const status = isRunning ? 'running' : (latestRun?.status || 'empty')
  const tone = status === 'success' ? 's-success' : status === 'error' ? 's-error' : status === 'warning' ? 's-warning' : 's-idle'
  const scheduleStatus = statusOf(schedule)
  const showSubtitle = schedule?.display_name && schedule.display_name.toLowerCase() !== agent.toLowerCase()

  return (
    <div
      className={`agent-card agent-card--hero ${isRunning ? 'is-running' : ''} agent-card--status-${scheduleStatus}`}
      onClick={() => setOpen(true)}
      role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true) } }}
    >
      <div className="agent-card-hero__top">
        <div className="agent-card-hero__statusrow">
          <span className={tone} style={{ fontSize: 10 }}>
            {isRunning ? <span className="dot dot--pulse" /> : '●'}
          </span>
          <span className="muted" style={{ fontSize: 11 }}>
            {isRunning ? 'draait nu' : `laatste ${formatPast(latestRun?.started_at)}`}
          </span>
        </div>
        {schedule && <StatusPill agent={agent} schedule={schedule} size="lg" />}
      </div>

      <div className="agent-card-hero__title">
        {schedule?.display_name || agent}
      </div>
      {showSubtitle && <div className="mono muted" style={{ fontSize: 11 }}>{agent}</div>}

      <div className="agent-card-hero__next muted" style={{ fontSize: 11 }}>
        {isRunning
          ? 'orchestrator pakt hem op…'
          : schedule?.next_run_at ? `volgende run ${formatFuture(schedule.next_run_at)}` : '—'}
      </div>

      <div className="agent-card-hero__spark">
        <Sparkline history={history} />
      </div>

      {open && <AgentSettingsPopup agent={agent} schedule={schedule} onClose={() => setOpen(false)} />}
    </div>
  )
}

// Map die Agents.jsx gebruikt om op basis van localStorage de juiste
// component te kiezen. 'current' = bestaande AgentCard.jsx (geen entry hier).
export const CARD_VARIANTS = {
  list: AgentCardList,
  work: AgentCardWork,
  hero: AgentCardHero,
}
