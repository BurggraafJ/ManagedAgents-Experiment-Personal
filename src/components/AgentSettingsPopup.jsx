import { useState, useEffect, Fragment } from 'react'
import { supabase } from '../lib/supabase'
import { useMediaQuery } from '../hooks/useMediaQuery'

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

function fmtDuration(startIso, endIso) {
  if (!startIso) return '—'
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  const sec = Math.max(0, Math.round((end - start) / 1000))
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`
  const h = Math.floor(m / 60)
  return `${h}u ${m % 60}m`
}

const STATUS_LABEL = {
  success: 'ok',
  warning: 'let op',
  error:   'fout',
  running: 'draait',
  empty:   'leeg',
}

function statusTone(status) {
  if (status === 'success') return 's-success'
  if (status === 'error')   return 's-error'
  if (status === 'warning') return 's-warning'
  if (status === 'running') return 's-running'
  return 's-idle'
}

// Logboek rechts in de popup — gebruikt agent_runs (truth-of-source voor agent-runs).
// Lichtgewicht: 25 laatste runs, 1 query per popup-open.
function RunsLog({ agent }) {
  const [runs, setRuns] = useState(null)
  const [err, setErr]   = useState(null)

  useEffect(() => {
    let cancelled = false
    setRuns(null); setErr(null)
    supabase
      .from('agent_runs')
      .select('id, status, summary, started_at, completed_at, stats')
      .eq('agent_name', agent)
      .order('started_at', { ascending: false })
      .limit(25)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setErr(error.message)
        else setRuns(data || [])
      })
    return () => { cancelled = true }
  }, [agent])

  if (err) {
    return <div style={{ color: 'var(--error)', fontSize: 12 }}>⚠ {err}</div>
  }
  if (runs === null) {
    return <div className="muted" style={{ fontSize: 12 }}>laden…</div>
  }
  if (runs.length === 0) {
    return <div className="muted" style={{ fontSize: 12 }}>nog geen runs vastgelegd voor deze agent.</div>
  }

  const okCount = runs.filter(r => r.status === 'success').length
  const errCount = runs.filter(r => r.status === 'error').length
  const warnCount = runs.filter(r => r.status === 'warning').length

  // Groepeer per dag voor de visuele separator. Dagsleutel = lokale datum
  // in nl-NL formaat zodat avond/ochtend van dezelfde dag bij elkaar staan.
  const dayKey = (iso) => new Date(iso).toLocaleDateString('nl-NL')
  const dayLabel = (iso) => {
    const d = new Date(iso)
    const today = new Date(); today.setHours(0,0,0,0)
    const start = new Date(d);  start.setHours(0,0,0,0)
    const diffDays = Math.round((today.getTime() - start.getTime()) / 86400000)
    if (diffDays === 0) return 'vandaag'
    if (diffDays === 1) return 'gisteren'
    return d.toLocaleDateString('nl-NL', { weekday: 'short', day: '2-digit', month: 'short' })
  }

  let prevDay = null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
      <div className="muted" style={{ fontSize: 11, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <span>laatste {runs.length}</span>
        <span className="s-success">● {okCount} ok</span>
        {warnCount > 0 && <span className="s-warning">● {warnCount} let op</span>}
        {errCount > 0 && <span className="s-error">● {errCount} fout</span>}
      </div>
      <div style={{ margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', flex: 1 }}>
        {runs.map(r => {
          const k = dayKey(r.started_at)
          const showDay = k !== prevDay
          prevDay = k
          return (
            <Fragment key={r.id}>
              {showDay && (
                <div className="agent-runs-log__day">
                  <span>{dayLabel(r.started_at)}</span>
                </div>
              )}
              <div
                className="card"
                style={{
                  padding: '8px 10px',
                  background: 'var(--bg-2)',
                  border: '1px solid var(--border)',
                  fontSize: 12,
                  display: 'flex', flexDirection: 'column', gap: 4,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span className={statusTone(r.status)} style={{ fontSize: 11, fontWeight: 600 }}>
                    ● {STATUS_LABEL[r.status] || r.status}
                  </span>
                  <span className="mono muted" style={{ fontSize: 11 }}>
                    {fmt(r.started_at)} · {fmtDuration(r.started_at, r.completed_at)}
                  </span>
                </div>
                {r.summary && (
                  <div style={{ color: 'var(--text)', lineHeight: 1.35, wordBreak: 'break-word' }}>
                    {r.summary}
                  </div>
                )}
              </div>
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

export default function AgentSettingsPopup({ agent, schedule, onClose }) {
  const canManualTrigger = schedule?.enabled && !NO_MANUAL_TRIGGER.has(agent)
  const isNarrow = useMediaQuery('(max-width: 760px)')

  const matchingPreset = CADENCE_PRESETS.find(p => p.value === schedule?.cron_expression)
  const initialSelection = matchingPreset ? matchingPreset.value : '__custom__'

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
      // status (live/maintenance/off) wordt rechtstreeks vanaf de agent-card
      // gewijzigd via set_agent_status — hier alleen cadence + timeout opslaan,
      // dus enabled doorgeven we ongewijzigd terug.
      const { data, error } = await supabase.rpc('update_agent_schedule', {
        p_agent_name: agent,
        p_enabled: !!schedule?.enabled,
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
        style={{ width: '100%', maxWidth: 880, padding: 0, maxHeight: '90vh', overflow: 'auto', display: 'flex', flexDirection: 'column' }}
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

        <div
          className="agent-settings-popup__body"
          style={{
            display: 'grid',
            gridTemplateColumns: isNarrow ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: 0, flex: 1, minHeight: 0,
          }}
        >
          <div
            style={{
              padding: 20, display: 'grid', gap: 18, alignContent: 'start',
              borderRight: isNarrow ? 'none' : '1px solid var(--border)',
              borderBottom: isNarrow ? '1px solid var(--border)' : 'none',
            }}
          >

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

          {/* Logboek — laatste 25 runs uit agent_runs */}
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--bg)' }}>
            <div className="kpi__label" style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Logboek</span>
              <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>agent_runs</span>
            </div>
            <RunsLog agent={agent} />
          </div>

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
