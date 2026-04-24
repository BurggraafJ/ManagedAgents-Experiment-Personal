import { useState } from 'react'
import { supabase } from '../../lib/supabase'

function fmt(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('nl-NL', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// Relatieve tijd t.o.v. nu. Positief = in de toekomst, negatief = overdue.
// Gebruikt voor de "Volgende run"-kolom — belangrijker dan de absolute datum
// omdat je in één blik wilt zien of een agent achterloopt.
function fmtRelative(iso) {
  if (!iso) return { text: 'wordt herberekend', tone: 'pending' }
  const now = Date.now()
  const t = new Date(iso).getTime()
  const diff = t - now
  const absMin = Math.abs(diff) / 60000
  const fmtDur = (m) => {
    if (m < 1)        return 'nu'
    if (m < 60)       return `${Math.round(m)} min`
    if (m < 24 * 60)  return `${Math.round(m / 60)} u`
    return `${Math.round(m / (60 * 24))} d`
  }
  if (diff < -60000)      return { text: `${fmtDur(absMin)} te laat`,  tone: 'overdue' }
  if (diff < 60000)       return { text: 'nu',                          tone: 'due' }
  return                      { text: `over ${fmtDur(absMin)}`,         tone: 'ok' }
}

// Minimale heuristiek: klopt next_run_at qua orde van grootte met de cron?
// We berekenen geen volledige cron-parser client-side, maar kunnen een paar
// simpele regels toepassen om duidelijke discrepanties aan te stippen.
function detectScheduleMismatch(schedule) {
  if (!schedule.enabled || !schedule.next_run_at) return null
  const cron = schedule.cron_expression || ''
  const nowTs = Date.now()
  const nextTs = new Date(schedule.next_run_at).getTime()
  const diffH = (nextTs - nowTs) / 3600000

  // "Elk uur" patronen: */N of 0 H-H — next_run_at moet binnen ~1-2u zitten
  const isHourlyish = /^\*\/\d+ \d+-\d+|^\*\/\d+ \*|^0 \d+-\d+ \* \* \*/.test(cron)
  if (isHourlyish && diffH > 3) {
    return { severity: 'warn', hint: 'cron zegt ~elk uur maar next_run_at ligt ver in de toekomst — wijziging niet doorgekomen?' }
  }
  // Werkdagen-patronen: als next_run_at in het weekend valt, iets klopt niet
  if (/\* 1-5$/.test(cron)) {
    const day = new Date(schedule.next_run_at).getDay() // 0=zo, 6=za
    if (day === 0 || day === 6) {
      return { severity: 'warn', hint: 'cron is werkdagen-only maar next_run_at valt in het weekend' }
    }
  }
  return null
}

// Cadence-presets die Jelle vaak wil. Mooie cron-syntax zodat de orchestrator
// niet hoeft te raden. De waarden zijn in user's lokale tijd (orchestrator
// interpreteert cron als lokale tijd, consistent met overige agents).
// De volgorde gaat van "heel vaak" naar "heel zelden" + speciale patronen.
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

export default function Schedules({ schedules }) {
  return (
    <section id="schedules">
      <div className="section__head">
        <h2 className="section__title">Schedules</h2>
        <span className="section__hint">per agent: aan/uit + hoe vaak. Orchestrator zelf kun je niet via dashboard uitzetten — zou alles stilleggen.</span>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="schedules-list">
          <div className="schedules-list__head">
            <div>Agent</div>
            <div>Status</div>
            <div>Hoe vaak</div>
            <div>Laatste run</div>
            <div>Volgende run</div>
          </div>
          {schedules.map(s => <ScheduleRow key={s.agent_name} schedule={s} />)}
        </div>
      </div>
    </section>
  )
}

function ScheduleRow({ schedule }) {
  const isOrchestrator = schedule.agent_name === 'orchestrator'
  // Bepaal of huidige cron-expression overeenkomt met een preset. Zo niet,
  // toont de dropdown "Aangepast (custom)" en is de read-only cron-string
  // zichtbaar eronder.
  const matchingPreset = CADENCE_PRESETS.find(p => p.value === schedule.cron_expression)
  const initialSelection = matchingPreset ? matchingPreset.value : '__custom__'

  const [selection, setSelection]     = useState(initialSelection)
  const [customCron, setCustomCron]   = useState(schedule.cron_expression || '')
  const [customEdit, setCustomEdit]   = useState(false)
  const [busy, setBusy]               = useState(false)
  const [err, setErr]                 = useState(null)
  const [okFlash, setOkFlash]         = useState(false)

  async function callRpc(payload) {
    setBusy(true); setErr(null); setOkFlash(false)
    try {
      const { data, error } = await supabase.rpc('update_agent_schedule', payload)
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
      else { setOkFlash(true); setTimeout(() => setOkFlash(false), 1500) }
    } catch (e) {
      setErr(e.message || 'netwerkfout')
    }
    setBusy(false)
  }

  async function onToggleEnabled() {
    await callRpc({
      p_agent_name: schedule.agent_name,
      p_enabled: !schedule.enabled,
      p_updated_by: 'dashboard',
    })
  }

  async function onCadenceChange(e) {
    const next = e.target.value
    setSelection(next)
    if (next === '__custom__') {
      setCustomEdit(true) // toon custom text-input, niet meteen saven
      return
    }
    // Preset gekozen — meteen opslaan.
    await callRpc({
      p_agent_name: schedule.agent_name,
      p_cron_expression: next,
      p_updated_by: 'dashboard',
    })
  }

  async function onSaveCustom() {
    if (!customCron.trim()) { setErr('cron mag niet leeg zijn'); return }
    await callRpc({
      p_agent_name: schedule.agent_name,
      p_cron_expression: customCron.trim(),
      p_updated_by: 'dashboard',
    })
    setCustomEdit(false)
  }

  return (
    <div className={`schedules-list__row ${schedule.is_running ? 'is-running' : ''} ${!schedule.enabled ? 'is-disabled' : ''}`}>
      <div className="schedules-list__agent">
        {schedule.is_running && <span className="dot dot--pulse s-running" style={{ marginRight: 8 }} />}
        <div>
          <div style={{ color: 'var(--text)', fontWeight: 500 }}>{schedule.display_name || schedule.agent_name}</div>
          {schedule.description && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{schedule.description}</div>}
        </div>
      </div>

      <div>
        <button
          type="button"
          className={`schedule-toggle ${schedule.enabled ? 'is-on' : 'is-off'}`}
          onClick={onToggleEnabled}
          disabled={busy || isOrchestrator}
          title={isOrchestrator
            ? 'Orchestrator kun je niet via dashboard uitzetten — zou alle agents stilleggen.'
            : (schedule.enabled ? 'Klik om te pauzeren' : 'Klik om te activeren')}
        >
          <span className="schedule-toggle__knob" />
          <span className="schedule-toggle__label">{schedule.enabled ? 'Aan' : 'Uit'}</span>
        </button>
      </div>

      <div>
        <select
          value={selection}
          onChange={onCadenceChange}
          disabled={busy}
          className="schedule-cadence-select"
          title={`Cron: ${schedule.cron_expression}`}
        >
          {CADENCE_PRESETS.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        {(selection === '__custom__' || customEdit) && (
          <div className="schedule-custom-input">
            <input
              type="text"
              value={customCron}
              onChange={e => setCustomCron(e.target.value)}
              placeholder="*/15 7-20 * * *"
              className="mono"
              disabled={busy}
            />
            <button type="button" className="btn btn--accent" style={{ fontSize: 11, padding: '4px 8px' }}
              onClick={onSaveCustom} disabled={busy || !customCron.trim()}>💾</button>
          </div>
        )}
        {selection !== '__custom__' && !customEdit && (
          <div className="mono muted" style={{ fontSize: 10, marginTop: 2 }}>{schedule.cron_expression}</div>
        )}
      </div>

      <div className="muted" style={{ fontSize: 12 }}>{fmt(schedule.last_run_at)}</div>
      <div style={{ fontSize: 12 }}>
        {(() => {
          const rel = fmtRelative(schedule.next_run_at)
          const mismatch = detectScheduleMismatch(schedule)
          const color =
            rel.tone === 'overdue' ? 'var(--error)'
          : rel.tone === 'due'     ? 'var(--accent)'
          : rel.tone === 'pending' ? 'var(--warning, #d98f00)'
                                   : 'var(--muted, inherit)'
          return (
            <>
              <div style={{ color }}>{rel.text}</div>
              {schedule.next_run_at && (
                <div className="muted" style={{ fontSize: 10 }}>{fmt(schedule.next_run_at)}</div>
              )}
              {mismatch && (
                <div style={{ fontSize: 10, color: 'var(--warning, #d98f00)', marginTop: 2 }}
                     title={mismatch.hint}>
                  ⚠ {mismatch.hint}
                </div>
              )}
            </>
          )
        })()}
      </div>

      {(err || okFlash) && (
        <div className="schedules-list__status">
          {err && <span style={{ color: 'var(--error)' }}>⚠ {err}</span>}
          {okFlash && <span style={{ color: 'var(--success, #4ade80)' }}>✓ opgeslagen</span>}
        </div>
      )}
    </div>
  )
}
