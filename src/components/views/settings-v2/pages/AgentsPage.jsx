import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../../../lib/supabase'
import { friendlyName, PLACEHOLDERS } from '../../../../lib/agentInstructions'
import RichTextEditor from '../../../ui/RichTextEditor'
import { SettingsV2Page } from '../SettingsV2Layout'

/**
 * AgentsPage (v2) — vrije-tekst instructies per agent.
 *
 * Eerste concrete page in Settings v2. Hergebruikt:
 *  - Data: schedules + agentInstructions (props uit parent)
 *  - RPC: upsert_agent_instructions
 *  - Editor: RichTextEditor (ui/RichTextEditor)
 *
 * Eigen styling (.sv2-*) — geen overlay op v1.
 */
export default function AgentsPage({ schedules, agentInstructions, autodraftCategories }) {
  const [view, setView] = useState('agents')

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
    <SettingsV2Page
      title="Agents"
      intro="Vrije-tekst richtlijnen per agent. De agent leest deze bij elke run als aanvulling op de SKILL.md."
      right={
        <span className="sv2-pill sv2-pill--ok">
          <span className="sv2-pill__dot" />
          Live
        </span>
      }
    >
      {/* View-switch */}
      <div className="sv2-toggle">
        {[
          { id: 'agents',      label: 'Per agent' },
          { id: 'preferences', label: 'Voorkeuren per categorie / tone' },
        ].map(opt => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setView(opt.id)}
            className={`sv2-toggle__btn ${view === opt.id ? 'is-active' : ''}`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {view === 'preferences' ? (
        <div className="sv2-stub">
          <div className="sv2-stub__title">Voorkeuren per categorie / tone — komt later</div>
          <div className="sv2-stub__hint">
            Deze view (AutoDraft-categorieën met tone-guides) wordt in een volgende
            iteratie naar v2 gemigreerd. Tot dan: gebruik <a href="/instellingen/agents">v1</a>.
          </div>
        </div>
      ) : agents.length === 0 ? (
        <div className="sv2-stub">
          <div className="sv2-stub__title">Geen agents geladen</div>
          <div className="sv2-stub__hint">
            Check of <code>agent_schedules</code> rijen heeft.
          </div>
        </div>
      ) : (
        <>
          <AgentTabs
            agents={agents}
            activeAgent={activeAgent}
            setActiveAgent={setActiveAgent}
            lookup={lookup}
          />
          {activeSchedule && (
            <AgentEditor
              key={activeSchedule.agent_name}
              schedule={activeSchedule}
              row={activeRow}
            />
          )}
        </>
      )}
    </SettingsV2Page>
  )
}

function AgentTabs({ agents, activeAgent, setActiveAgent, lookup }) {
  return (
    <div className="sv2-tabs" role="tablist">
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
            className={`sv2-tab ${active ? 'is-active' : ''}`}
            onClick={() => setActiveAgent(s.agent_name)}
          >
            <span>{friendlyName(s)}</span>
            <span
              className={`sv2-tab__dot ${has ? '' : 'is-empty'}`}
              title={has ? 'Instructies ingesteld' : 'Geen instructies — alleen SKILL.md'}
            />
          </button>
        )
      })}
    </div>
  )
}

function AgentEditor({ schedule, row }) {
  const initialText = row?.config_value?.text || ''
  const [text, setText] = useState(initialText)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [saved, setSaved] = useState(false)
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
  const charCount = (text || '').length

  return (
    <>
      <div className="sv2-meta-row">
        <span>agent: {schedule.agent_name}</span>
        <span className="sv2-meta-row__sep">·</span>
        <span>
          {updatedAt
            ? `bewerkt ${updatedAt.toLocaleString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}${updatedBy ? ` door ${updatedBy}` : ''}`
            : 'nog geen instructies opgeslagen'}
        </span>
        <span className="sv2-meta-row__spacer" />
        <span className="sv2-meta-row__kbd">⌘ B</span>
        <span>voor vet</span>
      </div>

      <div className="sv2-editor">
        <div className="sv2-editor__toolbar">
          <span className="sv2-editor__meta">{charCount.toLocaleString('nl-NL')} chars</span>
        </div>
        <div className="sv2-editor__body" style={{ padding: 0 }}>
          <RichTextEditor
            valueMd={text}
            onChangeMd={setText}
            resetKey={resetKey}
            disabled={busy}
            placeholder={PLACEHOLDERS[schedule.agent_name] || 'Bijv.: wanneer wel/niet een actie maken; welke pipelines/stages; naamconventies voor notes.'}
            minHeight={380}
          />
        </div>
      </div>

      <div className="sv2-actions">
        <button
          type="button"
          className="sv2-btn sv2-btn--primary"
          onClick={onSave}
          disabled={busy || !dirty}
        >
          {busy ? 'Opslaan…' : 'Opslaan'}
        </button>
        <button
          type="button"
          className="sv2-btn sv2-btn--ghost"
          onClick={onReset}
          disabled={busy || !dirty}
        >
          Ongedaan maken
        </button>
        {!dirty && !saved && !err && (
          <span className="sv2-actions__hint">geen wijzigingen</span>
        )}
        {saved && (
          <span className="sv2-actions__hint sv2-actions__hint--success">✓ Opgeslagen</span>
        )}
        {err && (
          <span className="sv2-actions__hint sv2-actions__hint--error">⚠ {err}</span>
        )}
      </div>
    </>
  )
}
