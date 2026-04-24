import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

// Agent-instructies — vrije-tekst per agent die de skill leest bij elke run.
// Hier stuurt Jelle gedrag ("maak alleen taken voor Sales Pipeline", "bij
// Customer Base geen task maar een reminder-note", etc.) zonder de SKILL.md
// zelf te hoeven aanpassen.
//
// Opgeslagen in `agent_config.custom_instructions` als JSON
// ({text, updated_by, updated_at}). Skills lezen deze key vóór ze voorstellen
// genereren en voegen 'm toe aan hun prompt.
const PLACEHOLDERS = {
  'hubspot-daily-sync':
    'Bijv.:\n- Maak alleen tasks voor deals in de Sales Pipeline (niet Customer Base).\n- Bij Customer Base: schrijf een note, geen task — tenzij er een expliciete actie in de mail staat.\n- Recruitment-kaarten altijd met assignee = huidige eigenaar in de kanban.\n- Bij partner-items: Jira-ticket op board Partnerships.',
  'auto-draft':
    'Bijv.:\n- Geen drafts voor nieuwsbrieven of noreply-afzenders.\n- Bij Nederlandse mails altijd tutoyeren.\n- Drafts max 5 zinnen tenzij de input-mail lang is.',
  'sales-on-road':
    'Bijv.:\n- Altijd een follow-up-mail klaarzetten in map "SalesAgent".\n- Deal-stage "Kennismaking" alleen als de match voldoende helder is — anders needs_info.',
  'sales-todos':
    'Bijv.:\n- Offerte-reminders: 3 dagen na verzenden, daarna elke 5 dagen.\n- Trial eindigt binnen 7 dagen → altijd een draft-mail voorbereiden.',
}

function friendlyName(schedule) {
  return schedule.display_name || schedule.agent_name
}

export default function AgentInstructions({ schedules, agentInstructions }) {
  // Filter orchestrator/agent-manager — die hebben geen eigen werk-instructies.
  const agents = useMemo(() => {
    return (schedules || [])
      .filter(s => !['orchestrator', 'agent-manager', 'dashboard-refresh'].includes(s.agent_name))
      .slice()
      .sort((a, b) => (a.agent_name === 'hubspot-daily-sync' ? -1 : b.agent_name === 'hubspot-daily-sync' ? 1 : 0))
  }, [schedules])

  const lookup = useMemo(() => {
    const m = {}
    for (const row of agentInstructions || []) m[row.agent_name] = row
    return m
  }, [agentInstructions])

  const [collapsed, setCollapsed] = useState(true)
  const [activeAgent, setActiveAgent] = useState(null)

  useEffect(() => {
    if (!activeAgent && agents.length > 0) setActiveAgent(agents[0].agent_name)
  }, [agents, activeAgent])

  const activeSchedule = agents.find(a => a.agent_name === activeAgent) || null
  const activeRow = activeAgent ? lookup[activeAgent] : null

  return (
    <section id="agent-instructions">
      <div className="section__head">
        <h2 className="section__title">
          Agent-instructies <span className="section__count">{agents.length}</span>
        </h2>
        <button
          type="button"
          className="btn btn--ghost"
          style={{ fontSize: 12, padding: '4px 10px' }}
          onClick={() => setCollapsed(v => !v)}
        >
          {collapsed ? '▸ toon editor' : '▾ verberg editor'}
        </button>
      </div>
      <div className="section__hint" style={{ marginBottom: 10 }}>
        Vrije-tekst richtlijnen per agent. Bijvoorbeeld: "maak alleen tasks voor Sales Pipeline, niet Customer Base" of "bij Customer Base alleen een note". De agent leest deze bij elke run en volgt ze als aanvulling op de SKILL.md.
      </div>

      {collapsed ? (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {agents.map(s => {
            const row = lookup[s.agent_name]
            const text = row?.config_value?.text || ''
            const hasInstructions = text.trim().length > 0
            return (
              <button
                key={s.agent_name}
                type="button"
                className="card"
                style={{ textAlign: 'left', cursor: 'pointer' }}
                onClick={() => { setActiveAgent(s.agent_name); setCollapsed(false) }}
              >
                <div className="kpi__label" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {friendlyName(s)}
                  <span
                    className="mono"
                    style={{ fontSize: 10, color: hasInstructions ? 'var(--success, #16a34a)' : 'var(--text-muted)' }}
                  >
                    {hasInstructions ? '● ingesteld' : '○ leeg'}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 12, lineHeight: 1.4, minHeight: 32 }}>
                  {hasInstructions
                    ? text.slice(0, 110) + (text.length > 110 ? '…' : '')
                    : 'Geen instructies — agent gebruikt alleen SKILL.md.'}
                </div>
                <div className="muted" style={{ fontSize: 10, marginTop: 8 }}>
                  agent: <span className="mono">{s.agent_name}</span>
                </div>
              </button>
            )
          })}
          {agents.length === 0 && (
            <div className="empty empty--compact">
              Geen agents geladen — check of <span className="mono">agent_schedules</span> rijen heeft.
            </div>
          )}
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ display: 'flex', gap: 2, padding: '8px 8px 0 8px', overflowX: 'auto', borderBottom: '1px solid var(--border)' }}>
            {agents.map(s => {
              const isActive = s.agent_name === activeAgent
              const hasInstructions = (lookup[s.agent_name]?.config_value?.text || '').trim().length > 0
              return (
                <button
                  key={s.agent_name}
                  type="button"
                  onClick={() => setActiveAgent(s.agent_name)}
                  className="btn btn--ghost"
                  style={{
                    fontSize: 12,
                    padding: '6px 12px',
                    borderRadius: '6px 6px 0 0',
                    border: 'none',
                    background: isActive ? 'var(--bg-2)' : 'transparent',
                    color: isActive ? 'var(--text)' : 'var(--text-muted)',
                    fontWeight: isActive ? 600 : 400,
                    whiteSpace: 'nowrap',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {friendlyName(s)}
                  <span style={{ fontSize: 10, color: hasInstructions ? 'var(--success, #16a34a)' : 'var(--text-muted)' }}>
                    {hasInstructions ? '●' : '○'}
                  </span>
                </button>
              )
            })}
          </div>
          {activeSchedule && (
            <InstructionsEditor
              schedule={activeSchedule}
              row={activeRow}
            />
          )}
        </div>
      )}
    </section>
  )
}

function InstructionsEditor({ schedule, row }) {
  const initial = row?.config_value?.text || ''
  const [text, setText] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [saved, setSaved] = useState(false)

  // Reset bij wissel van agent of als de server een nieuwe versie pusht.
  useEffect(() => {
    setText(row?.config_value?.text || '')
    setErr(null); setSaved(false)
  }, [schedule.agent_name, row?.updated_at])

  const dirty = text !== (row?.config_value?.text || '')

  async function onSave() {
    setBusy(true); setErr(null); setSaved(false)
    try {
      const { data, error } = await supabase.rpc('upsert_agent_instructions', {
        p_agent_name: schedule.agent_name,
        p_instructions: text,
        p_updated_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
      else setSaved(true)
    } catch (e) {
      setErr(e.message || 'netwerkfout')
    }
    setBusy(false)
  }

  function onReset() {
    setText(row?.config_value?.text || '')
    setErr(null); setSaved(false)
  }

  const updatedAt = row?.updated_at ? new Date(row.updated_at) : null
  const updatedBy = row?.config_value?.updated_by

  return (
    <div style={{ padding: 16, display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="mono muted" style={{ fontSize: 11 }}>agent: {schedule.agent_name}</span>
        {updatedAt && (
          <span className="muted" style={{ fontSize: 11 }}>
            · laatst bewerkt {updatedAt.toLocaleString('nl-NL')}{updatedBy ? ` door ${updatedBy}` : ''}
          </span>
        )}
        {!updatedAt && (
          <span className="muted" style={{ fontSize: 11 }}>· nog geen instructies opgeslagen</span>
        )}
      </div>

      <div>
        <div className="kpi__label" style={{ marginBottom: 4 }}>Instructies voor deze agent</div>
        <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
          Vrije tekst. De agent leest dit bij elke run en past het toe als richtlijn bovenop de SKILL.md. Wees concreet: noem pipelines, stages, types of voorbeelden.
        </div>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          disabled={busy}
          rows={12}
          placeholder={PLACEHOLDERS[schedule.agent_name] || 'Bijv.: wanneer wel/niet een actie maken; welke pipelines/stages; naamconventies voor notes.'}
          style={{
            width: '100%', padding: 10, borderRadius: 6, border: '1px solid var(--border)',
            background: 'var(--bg)', color: 'var(--text)', fontFamily: 'inherit',
            fontSize: 13, lineHeight: 1.5, resize: 'vertical', minHeight: 200,
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          className="btn btn--accent"
          onClick={onSave}
          disabled={busy || !dirty}
        >
          {busy ? 'Opslaan…' : 'Opslaan'}
        </button>
        <button className="btn btn--ghost" onClick={onReset} disabled={busy || !dirty}>
          Ongedaan maken
        </button>
        {saved && <span style={{ color: 'var(--success, #16a34a)', fontSize: 12 }}>✓ Opgeslagen</span>}
        {err   && <span style={{ color: 'var(--error, #dc2626)',   fontSize: 12 }}>⚠ {err}</span>}
      </div>
    </div>
  )
}
