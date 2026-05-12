import { useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import {
  NO_RUN_NOW,
  agentTone, initialsOf, truncate, relTime,
} from '../../../lib/now'
import AgentSettingsPopup from '../../AgentSettingsPopup'
import AgentStatusPill from './AgentStatusPill'
import Icon from './Icon'

// MaestroAgentCard — 1 agent in mockup-stijl met functies:
//   • Status-pill links onder (klik = cycle live/onderhoud/uit)
//   • Run Now ▶ via request_run_now RPC
//   • ⚙ Cog opent AgentSettingsPopup (cadence/timeout/logboek)
//   • ⋯ 3-puntjes opent dropdown met:
//       - "Verberg uit overzicht" (set_agent_overview_visibility false)
//       - "Beheer alle agents" (opent visibility-modal via parent)
export default function MaestroAgentCard({
  schedule,
  latestRun,
  history,
  onOpenVisibilityModal,
  onLocalHide,
}) {
  const [popupOpen, setPopupOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const agent = schedule.agent_name
  const tone = agentTone(agent)
  const initials = initialsOf(schedule.display_name || agent)

  const total = (history || []).length || (latestRun ? 1 : 0)
  const errors = (history || []).filter(r => r.status === 'error').length
  const successPct = total === 0 ? 0 : Math.round(((total - errors) / total) * 100)

  return (
    <div className="now-agent">
      <div className="now-agent__top">
        <div className={`now-agent__icon now-agent__icon--${tone}`}>{initials}</div>
        <div className="now-agent__name">{schedule.display_name || agent}</div>
        <AgentStatusPill agent={agent} schedule={schedule} />
      </div>
      {schedule.description && (
        <div className="now-agent__sub">{truncate(schedule.description, 140)}</div>
      )}
      <div className="now-agent__bar">
        <span style={{
          width: successPct + '%',
          background: errors > 0 ? 'var(--warning)' : 'var(--success)',
        }} />
      </div>
      <div className="now-agent__foot">
        <div className="now-agent__stats">
          <span><strong>{successPct}%</strong> akkoord</span>
          <span><strong>{total}</strong> runs</span>
          <span>{relTime(latestRun?.started_at)}</span>
        </div>
        <div className="now-agent__actions">
          <MaestroRunNow agent={agent} schedule={schedule} />
          <button
            type="button"
            className="now-agent__cog"
            onClick={() => setPopupOpen(true)}
            aria-label="Instellingen"
            title="Instellingen — cadence, timeout, logboek"
          >
            <Icon size={14}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></Icon>
          </button>
          <DotMenuButton
            agent={agent}
            isOpen={menuOpen}
            onToggle={() => setMenuOpen(o => !o)}
            onClose={() => setMenuOpen(false)}
            onHide={() => { setMenuOpen(false); onLocalHide?.(agent) }}
            onOpenManager={() => { setMenuOpen(false); onOpenVisibilityModal?.() }}
          />
        </div>
      </div>
      {popupOpen && (
        <AgentSettingsPopup
          agent={agent}
          schedule={schedule}
          onClose={() => setPopupOpen(false)}
        />
      )}
    </div>
  )
}

function DotMenuButton({ agent, isOpen, onToggle, onClose, onHide, onOpenManager }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!isOpen) return
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('mousedown', onDoc)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDoc)
      window.removeEventListener('keydown', onKey)
    }
  }, [isOpen, onClose])

  return (
    <div className="now-agent__dot-wrap" ref={ref}>
      <button
        type="button"
        className="now-agent__dot"
        onClick={onToggle}
        aria-label="Meer opties"
        title="Meer opties"
      >
        <Icon size={14}><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/></Icon>
      </button>
      {isOpen && (
        <div className="now-agent__dot-menu">
          <button type="button" className="now-agent__dot-item" onClick={onHide}>
            <Icon size={13}><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><path d="M2 2l20 20"/></Icon>
            Verberg uit overzicht
          </button>
          <button type="button" className="now-agent__dot-item" onClick={onOpenManager}>
            <Icon size={13}><path d="M3 6h18M3 12h18M3 18h18"/></Icon>
            Beheer alle agents…
          </button>
        </div>
      )}
    </div>
  )
}

function MaestroRunNow({ agent, schedule }) {
  const disabled = !schedule?.enabled || schedule?.is_running || NO_RUN_NOW.has(agent)
  const [state, setState] = useState('idle')
  const [pendingRequested, setPendingRequested] = useState(false)
  const dbPending = schedule?.manual_run_requested_at
    && (!schedule?.last_run_at || new Date(schedule.last_run_at) < new Date(schedule.manual_run_requested_at))
  const isPending = dbPending || pendingRequested

  useEffect(() => { if (dbPending) setPendingRequested(false) }, [dbPending])

  async function onClick(e) {
    e.stopPropagation(); e.preventDefault()
    if (state === 'submitting' || disabled || isPending) return
    setState('submitting')
    try {
      const { data, error } = await supabase.rpc('request_run_now', { agent })
      if (error) { setState('err'); setTimeout(() => setState('idle'), 3000); console.error(error) }
      else if (data?.ok) { setState('ok'); setPendingRequested(true); setTimeout(() => setState('idle'), 2500) }
      else { setState('err'); setTimeout(() => setState('idle'), 3000) }
    } catch (ex) { setState('err'); setTimeout(() => setState('idle'), 3000); console.error(ex) }
  }

  const title = disabled
    ? (NO_RUN_NOW.has(agent) ? 'Niet handmatig te triggeren' : !schedule?.enabled ? 'Agent staat uit' : 'Draait al')
    : isPending ? 'Aangevraagd — orchestrator pakt hem bij volgende poll'
    : 'Run nu'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || state === 'submitting' || isPending}
      className={`now-agent__run ${state === 'ok' || isPending ? 'is-pending' : ''} ${state === 'err' ? 'is-err' : ''}`}
      aria-label="Run nu"
      title={title}
    >
      {state === 'submitting' ? (
        <span className="now-spin">⟳</span>
      ) : state === 'err' ? (
        <span>!</span>
      ) : isPending ? (
        <Icon size={13}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></Icon>
      ) : (
        <Icon size={13}><polygon points="6 4 20 12 6 20 6 4"/></Icon>
      )}
    </button>
  )
}
