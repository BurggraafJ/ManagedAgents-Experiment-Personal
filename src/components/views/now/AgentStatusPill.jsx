import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { STATUS_LABEL, NEXT_STATUS, NO_STATUS_TOGGLE, statusOf } from '../../../lib/now'

// Herbruikbare status-pill (live / onderhoud / uit). Eén klik = volgende state.
// Gebruikt door MaestroAgentCard (overzicht) én AgentVisibilityModal (zichtbaar
// + verborgen kolommen). Optimistic UI: pill verandert direct, DB volgt.
export default function AgentStatusPill({ agent, schedule, compact = false }) {
  const dbStatus = statusOf(schedule)
  const [optimistic, setOptimistic] = useState(null)
  const current = optimistic || dbStatus
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const disabled = NO_STATUS_TOGGLE.has(agent)

  useEffect(() => {
    if (optimistic && optimistic === dbStatus) setOptimistic(null)
  }, [dbStatus, optimistic])

  async function onClick(e) {
    e.stopPropagation(); e.preventDefault()
    if (busy || disabled) return
    const next = NEXT_STATUS[current] || 'live'
    setOptimistic(next); setBusy(true); setErr(null)
    try {
      const { data, error } = await supabase.rpc('set_agent_status', {
        p_agent_name: agent,
        p_status: next,
      })
      if (error) { setOptimistic(null); setErr(error.message); console.error('set_agent_status', error) }
      else if (data?.ok === false) { setOptimistic(null); setErr(data.reason || 'mislukt') }
    } catch (ex) {
      setOptimistic(null); setErr(ex.message || 'netwerkfout'); console.error(ex)
    }
    setBusy(false)
  }

  const baseTitle = disabled
    ? 'Orchestrator kan niet via dashboard uitgezet worden — dat zou alle agents stilleggen.'
    : `Klik = volgende status (nu: ${STATUS_LABEL[current]})`
  const title = err ? `${baseTitle} · ⚠ ${err}` : baseTitle

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={`now-agent__pill ${compact ? 'now-agent__pill--compact' : ''} now-agent__pill--${current}`}
      aria-label={`Status: ${STATUS_LABEL[current]} (klik om te wisselen)`}
      title={title}
    >
      <span className="now-agent__pill-dot" />
      <span>{STATUS_LABEL[current]}</span>
    </button>
  )
}
