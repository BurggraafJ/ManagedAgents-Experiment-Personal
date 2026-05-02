import { useState, useMemo, useEffect } from 'react'
import { supabase } from '../../../lib/supabase'
import { SettingsPage } from './SettingsLayout'
import RichTextEditor from './RichTextEditor'

// InstructiesPage — system-messages per agent. Vervangt de oude AgentInstructions
// section die in een grid van kleine kaartjes met collapse-toggle stond. Hier:
// agent-picker als horizontale tab-rij bovenaan, daaronder ÉÉN groot editor-vlak.
// Bedoeld om uitnodigend te zijn — instructies aanpassen is een van de meest
// terugkerende beheer-acties, dus geen muis-circus en niet "verstopt".

const PLACEHOLDERS = {
  'daily-admin':
    'Bijv.:\n- Maak alleen tasks voor deals in de Sales Pipeline (niet Customer Base).\n- Bij Customer Base: schrijf een note, geen task — tenzij er een expliciete actie in de mail staat.\n- Recruitment-kaarten altijd met assignee = huidige eigenaar in de kanban.\n- Bij partner-items: Jira-ticket op board Partnerships.',
  'auto-draft':
    'Bijv.:\n- Geen drafts voor nieuwsbrieven of noreply-afzenders.\n- Bij Nederlandse mails altijd tutoyeren.\n- Drafts max 5 zinnen tenzij de input-mail lang is.',
  'sales-on-road':
    'Bijv.:\n- Altijd een follow-up-mail klaarzetten in map "SalesAgent".\n- Deal-stage "Kennismaking" alleen als de match voldoende helder is — anders needs_info.',
  'sales-todos':
    'Bijv.:\n- Offerte-reminders: 3 dagen na verzenden, daarna elke 5 dagen.\n- Trial eindigt binnen 7 dagen → altijd een draft-mail voorbereiden.',
}

function friendlyName(s) {
  return s.display_name || s.agent_name
}

export default function InstructiesPage({ schedules, agentInstructions }) {
  const agents = useMemo(() => {
    return (schedules || [])
      .filter(s => !['orchestrator', 'agent-manager', 'dashboard-refresh'].includes(s.agent_name))
      .slice()
      .sort((a, b) => {
        if (a.agent_name === 'daily-admin') return -1
        if (b.agent_name === 'daily-admin') return 1
        return friendlyName(a).localeCompare(friendlyName(b))
      })
  }, [schedules])

  const lookup = useMemo(() => {
    const m = {}
    for (const row of agentInstructions || []) m[row.agent_name] = row
    return m
  }, [agentInstructions])

  const [activeAgent, setActiveAgent] = useState(null)

  useEffect(() => {
    if (!activeAgent && agents.length > 0) setActiveAgent(agents[0].agent_name)
  }, [agents, activeAgent])

  const activeSchedule = agents.find(a => a.agent_name === activeAgent) || null
  const activeRow = activeAgent ? lookup[activeAgent] : null

  return (
    <SettingsPage
      title="Agent Instructies"
      intro="Vrije-tekst richtlijnen per agent. De agent leest deze bij elke run als aanvulling op de SKILL.md. Plak gerust uit ChatGPT — bold en regel­einden blijven behouden."
    >
      {agents.length === 0 ? (
        <div className="empty empty--compact">
          Geen agents geladen — check of <span className="mono">agent_schedules</span> rijen heeft.
        </div>
      ) : (
        <div className="instructies">
          <div className="instructies__tabs" role="tablist">
            {agents.map(s => {
              const active = s.agent_name === activeAgent
              const text = (lookup[s.agent_name]?.config_value?.text || '').trim()
              const has = text.length > 0
              return (
                <button
                  key={s.agent_name}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`instructies__tab ${active ? 'is-active' : ''}`}
                  onClick={() => setActiveAgent(s.agent_name)}
                >
                  <span className="instructies__tab-label">{friendlyName(s)}</span>
                  <span
                    className={`instructies__tab-dot ${has ? 'is-set' : 'is-empty'}`}
                    title={has ? 'Instructies ingesteld' : 'Geen instructies — gebruikt alleen SKILL.md'}
                  />
                </button>
              )
            })}
          </div>

          {activeSchedule && (
            <InstructionsEditor
              key={activeSchedule.agent_name}
              schedule={activeSchedule}
              row={activeRow}
            />
          )}
        </div>
      )}
    </SettingsPage>
  )
}

function InstructionsEditor({ schedule, row }) {
  const initialMd = row?.config_value?.text || ''
  const [text, setText] = useState(initialMd)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [saved, setSaved] = useState(false)
  // resetKey triggert re-render van editor's innerHTML alleen bij agent-wissel
  // of wanneer server een nieuwe versie pusht — niet bij elke toetsaanslag.
  const [resetKey, setResetKey] = useState(0)

  useEffect(() => {
    setText(row?.config_value?.text || '')
    setErr(null); setSaved(false)
    setResetKey(k => k + 1)
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
    setResetKey(k => k + 1)
  }

  const updatedAt = row?.updated_at ? new Date(row.updated_at) : null
  const updatedBy = row?.config_value?.updated_by

  return (
    <div className="instructies__editor">
      <div className="instructies__meta">
        <span className="mono muted" style={{ fontSize: 11 }}>
          agent: {schedule.agent_name}
        </span>
        {updatedAt ? (
          <span className="muted" style={{ fontSize: 11 }}>
            · laatst bewerkt {updatedAt.toLocaleString('nl-NL')}
            {updatedBy ? ` door ${updatedBy}` : ''}
          </span>
        ) : (
          <span className="muted" style={{ fontSize: 11 }}>
            · nog geen instructies opgeslagen
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: 11 }}>
          <kbd className="kbd">Ctrl/Cmd</kbd> + <kbd className="kbd">B</kbd> voor vet
        </span>
      </div>

      <RichTextEditor
        valueMd={text}
        onChangeMd={setText}
        resetKey={resetKey}
        disabled={busy}
        placeholder={PLACEHOLDERS[schedule.agent_name] || 'Bijv.: wanneer wel/niet een actie maken; welke pipelines/stages; naamconventies voor notes.'}
        minHeight={420}
      />

      <div className="instructies__actions">
        <button
          className="btn btn--accent"
          onClick={onSave}
          disabled={busy || !dirty}
        >
          {busy ? 'Opslaan…' : 'Opslaan'}
        </button>
        <button
          className="btn btn--ghost"
          onClick={onReset}
          disabled={busy || !dirty}
        >
          Ongedaan maken
        </button>
        {saved && <span style={{ color: 'var(--success)', fontSize: 13 }}>✓ Opgeslagen</span>}
        {err && <span style={{ color: 'var(--error)', fontSize: 13 }}>⚠ {err}</span>}
      </div>
    </div>
  )
}
