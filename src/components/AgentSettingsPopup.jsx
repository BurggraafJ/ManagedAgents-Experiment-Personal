import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const NO_MANUAL_TRIGGER = new Set(['orchestrator', 'dashboard-refresh', 'agent-manager'])

const CADENCE_PRESETS = [
  { value: '*/10 6-22 * * *',     label: 'Elke 10 min (06:00–22:00)' },
  { value: '*/15 6-22 * * *',     label: 'Elke 15 min (06:00–22:00)' },
  { value: '*/15 7-20 * * *',     label: 'Elke 15 min (07:00–20:00)' },
  { value: '*/30 6-22 * * *',     label: 'Elke 30 min (06:00–22:00)' },
  { value: '0 6-22 * * *',        label: 'Elk uur (06:00–22:00)' },
  { value: '0 8-20 * * 1-5',      label: 'Elk uur werkdagen (08:00–20:00)' },
  { value: '0 7-18 * * 1-5',      label: 'Elk uur werkdagen (07:00–18:00)' },
  { value: '0 */2 * * *',         label: 'Elke 2 uur (24/7)' },
  { value: '0 8,12,17 * * 1-5',   label: 'Werkdagen 08:00, 12:00, 17:00' },
  { value: '0 8 * * *',           label: 'Dagelijks 08:00' },
  { value: '0 8 * * 1-5',         label: 'Werkdagen 08:00' },
  { value: '0 17 * * 1-5',        label: 'Werkdagen 17:00' },
  { value: '0 9 * * 1',           label: 'Elke maandag 09:00' },
  { value: '0 9 2 * *',           label: '2e van de maand 09:00' },
  { value: '__custom__',          label: 'Aangepast (custom cron)…' },
]

function fmt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function AgentSettingsPopup({ agent, schedule, onClose }) {
  const isOrchestrator = agent === 'orchestrator'
  const canManualTrigger = schedule?.enabled && !NO_MANUAL_TRIGGER.has(agent)

  const matchingPreset = CADENCE_PRESETS.find(p => p.value === schedule?.cron_expression)
  const initialSelection = matchingPreset ? matchingPreset.value : '__custom__'

  const [enabled, setEnabled]       = useState(!!schedule?.enabled)
  const [selection, setSelection]   = useState(initialSelection)
  const [customCron, setCustomCron] = useState(schedule?.cron_expression || '')
  const [timeout, setTimeout_]      = useState(schedule?.timeout_minutes ?? 15)
  const [busy, setBusy]             = useState(false)
  const [err, setErr]               = useState(null)
  const [saved, setSaved]           = useState(false)
  const [runState, setRunState]     = useState('idle')
  const [runMsg, setRunMsg]         = useState(null)

  // Sluiten met Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const cronToSave = selection === '__custom__' ? customCron.trim() : selection
  const dirty =
    enabled !== !!schedule?.enabled ||
    cronToSave !== (schedule?.cron_expression || '') ||
    Number(timeout) !== Number(schedule?.timeout_minutes ?? 15)

  async function onSave() {
    if (busy) return
    if (!cronToSave) { setErr('cron mag niet leeg zijn'); return }
    if (cronToSave.split(/\s+/).length !== 5) {
      setErr('cron moet 5 velden hebben: minute hour day month dayofweek')
      return
    }
    setBusy(true); setErr(null); setSaved(false)
    try {
      const { data, error } = await supabase.rpc('update_agent_schedule', {
        p_agent_name: agent,
        p_enabled: enabled,
        p_cron_expression: cronToSave,
        p_timeout_minutes: Number(timeout),
        p_updated_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
      else { setSaved(true); window.setTimeout(() => setSaved(false), 1500) }
    } catch (e) {
      setErr(e.message || 'netwerkfout')
    }
    setBusy(false)
  }

  async function onRunNow() {
    if (runState === 'submitting' || runState === 'pending') return
    setRunState('submitting'); setRunMsg(null)
    try {
      const { data, error } = await supabase.rpc('request_run_now', { agent })
      if (error) {
        setRunState('err'); setRunMsg(error.message)
      } else if (data && data.ok) {
        setRunState('ok')
        setRunMsg(data.status === 'already_requested'
          ? 'Aanvraag stond al open — wacht op orchestrator-poll.'
          : 'Aangevraagd — orchestrator pakt hem bij volgende poll op.')
        window.setTimeout(() => { setRunState('idle'); setRunMsg(null) }, 4000)
      } else {
        setRunState('err')
        const reason = data?.reason || 'unknown'
        setRunMsg(({
          agent_not_found:               'Agent niet gevonden.',
          agent_not_manually_triggerable:'Deze agent triggert niet handmatig.',
          agent_disabled:                'Agent staat uit — eerst aanzetten en opslaan.',
          already_running:               'Draait al.',
        })[reason] || `Niet gelukt (${reason}).`)
        window.setTimeout(() => { setRunState('idle'); setRunMsg(null) }, 6000)
      }
    } catch (e) {
      setRunState('err'); setRunMsg(e.message || 'netwerkfout')
      window.setTimeout(() => { setRunState('idle'); setRunMsg(null) }, 6000)
    }
  }

  function onSelectionChange(e) {
    const next = e.target.value
    setSelection(next)
    if (next !== '__custom__') setCustomCron(next)
  }

  return (
    <div
      className="agent-settings-popup__overlay"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16, zIndex: 1000,
      }}
    >
      <div
        className="agent-settings-popup card"
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 520, padding: 0, maxHeight: '90vh', overflow: 'auto' }}
      >
        <header style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div className="kpi__label" style={{ marginBottom: 2 }}>Agent-instellingen</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>
              {schedule?.display_name || agent}
            </div>
            <div className="mono muted" style={{ fontSize: 11, marginTop: 2 }}>{agent}</div>
          </div>
          <button className="btn btn--ghost" onClick={onClose} aria-label="Sluiten" style={{ fontSize: 18 }}>×</button>
        </header>

        <div style={{ padding: 20, display: 'grid', gap: 18 }}>

          {/* Status */}
          <div>
            <div className="kpi__label" style={{ marginBottom: 6 }}>Status</div>
            <button
              type="button"
              className={`schedule-toggle ${enabled ? 'is-on' : 'is-off'}`}
              onClick={() => setEnabled(v => !v)}
              disabled={busy || isOrchestrator}
              title={isOrchestrator ? 'Orchestrator kan niet via dashboard uitgezet worden — dat zou alle agents stilleggen.' : ''}
            >
              <span className="schedule-toggle__knob" />
              <span className="schedule-toggle__label">{enabled ? 'Aan' : 'Uit'}</span>
            </button>
            {isOrchestrator && (
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                De orchestrator kun je niet uitzetten via het dashboard — dat zou alle agents stilleggen.
              </div>
            )}
          </div>

          {/* Cadence */}
          <div>
            <div className="kpi__label" style={{ marginBottom: 6 }}>Hoe vaak draait deze agent?</div>
            <select
              value={selection}
              onChange={onSelectionChange}
              disabled={busy}
              className="schedule-cadence-select"
              style={{ width: '100%' }}
            >
              {CADENCE_PRESETS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            {selection === '__custom__' && (
              <input
                type="text"
                value={customCron}
                onChange={e => setCustomCron(e.target.value)}
                placeholder="*/15 7-20 * * *"
                className="mono"
                disabled={busy}
                style={{ width: '100%', marginTop: 8, padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
              />
            )}
            <div className="mono muted" style={{ fontSize: 11, marginTop: 6 }}>
              huidige cron: {schedule?.cron_expression || '—'}
            </div>
          </div>

          {/* Timeout */}
          <div>
            <div className="kpi__label" style={{ marginBottom: 6 }}>Timeout (minuten)</div>
            <input
              type="number"
              min={1}
              max={120}
              value={timeout}
              onChange={e => setTimeout_(e.target.value)}
              disabled={busy}
              style={{ width: 120, padding: 8, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
            />
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              Na deze tijd reset de orchestrator een vastzittende run-lock.
            </div>
          </div>

          {/* Run-meta */}
          <div className="card" style={{ background: 'var(--bg-2)', padding: 12, fontSize: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span className="muted">Laatste run</span>
              <span>{fmt(schedule?.last_run_at)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span className="muted">Volgende run</span>
              <span>{fmt(schedule?.next_run_at)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="muted">Slack-kanaal</span>
              <span className="mono">{schedule?.slack_channel || '—'}</span>
            </div>
          </div>

          {/* Run-now */}
          {canManualTrigger && (
            <div>
              <button
                type="button"
                className="btn btn--accent"
                onClick={onRunNow}
                disabled={runState === 'submitting' || runState === 'pending' || schedule?.is_running}
                style={{ width: '100%' }}
              >
                {runState === 'submitting' ? '…aanvragen'
                 : runState === 'pending'   ? '⟳ wacht op orchestrator'
                 : runState === 'ok'        ? '✓ aangevraagd'
                 : runState === 'err'       ? '! mislukt'
                 : '↻ Run nu'}
              </button>
              {runMsg && (
                <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{runMsg}</div>
              )}
              {schedule?.manual_run_requested_at && !schedule?.is_running && (
                <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                  Openstaande aanvraag van {fmt(schedule.manual_run_requested_at)} — orchestrator pakt hem bij eerstvolgende poll.
                </div>
              )}
            </div>
          )}

        </div>

        <footer style={{ padding: '14px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
          {err   && <span style={{ color: 'var(--error)',   fontSize: 12, marginRight: 'auto' }}>⚠ {err}</span>}
          {saved && <span style={{ color: 'var(--success, #16a34a)', fontSize: 12, marginRight: 'auto' }}>✓ Opgeslagen</span>}
          <button className="btn btn--ghost" onClick={onClose} disabled={busy}>Sluiten</button>
          <button className="btn btn--accent" onClick={onSave} disabled={busy || !dirty}>
            {busy ? 'Opslaan…' : 'Opslaan'}
          </button>
        </footer>
      </div>
    </div>
  )
}
