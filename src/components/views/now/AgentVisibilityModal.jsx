import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { initialsOf, agentTone } from '../../../lib/now'
import AgentStatusPill from './AgentStatusPill'
import Icon from './Icon'

// AgentVisibilityModal — beheert welke agents in het hoofd-overzicht
// staan. 2 kolommen (zichtbaar / verborgen), HTML5 drag-drop tussen
// kolommen. Save via set_agent_overview_visibility RPC. Onafhankelijk
// van enabled (active) — een agent kan live draaien maar verborgen zijn.
export default function AgentVisibilityModal({ schedules, onClose, onSave }) {
  // Lokale optimistic state — actuele DB-waardes uit prop, lokale wijzigingen
  // worden bij Save naar DB gepusht.
  const [local, setLocal] = useState(() => {
    const map = {}
    ;(schedules || []).forEach(s => {
      // Default: agents zonder show_in_overview-veld blijven zichtbaar.
      map[s.agent_name] = s.show_in_overview !== false
    })
    return map
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const [dragging, setDragging] = useState(null)

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const visible = (schedules || []).filter(s => local[s.agent_name])
  const hidden  = (schedules || []).filter(s => !local[s.agent_name])

  const dirty = (schedules || []).some(s => {
    const dbVal = s.show_in_overview !== false
    return dbVal !== local[s.agent_name]
  })

  function move(agentName, toVisible) {
    setLocal(prev => ({ ...prev, [agentName]: toVisible }))
  }

  function onDragStart(e, agentName) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', agentName)
    setDragging(agentName)
  }
  function onDragOver(e) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }
  function onDrop(e, toVisible) {
    e.preventDefault()
    const agentName = e.dataTransfer.getData('text/plain') || dragging
    if (agentName) move(agentName, toVisible)
    setDragging(null)
  }
  function onDragEnd() { setDragging(null) }

  async function save() {
    if (busy || !dirty) return
    setBusy(true); setErr(null); setSavedFlash(false)
    try {
      const changes = (schedules || [])
        .filter(s => (s.show_in_overview !== false) !== local[s.agent_name])
        .map(s => ({ agent: s.agent_name, visible: local[s.agent_name] }))

      for (const c of changes) {
        const { error, data } = await supabase.rpc('set_agent_overview_visibility', {
          p_agent_name: c.agent,
          p_visible: c.visible,
        })
        if (error) { setErr(error.message); break }
        if (data && data.ok === false) { setErr(data.reason || 'mislukt'); break }
      }
      setSavedFlash(true)
      if (onSave) onSave()
      window.setTimeout(() => { setSavedFlash(false); onClose() }, 800)
    } catch (e) {
      setErr(e.message || 'netwerkfout')
    }
    setBusy(false)
  }

  return (
    <div className="now-vmodal__overlay" onClick={onClose}>
      <div className="now-vmodal" onClick={e => e.stopPropagation()}>
        <header className="now-vmodal__head">
          <div>
            <div className="now-vmodal__kicker">Agent-zichtbaarheid</div>
            <div className="now-vmodal__title">Welke agents staan in het overzicht?</div>
            <div className="now-vmodal__sub">
              Sleep agents tussen de kolommen. Verborgen ≠ uit — zichtbaarheid is alleen een filter
              voor het Dashboard hoofdgrid.
            </div>
          </div>
          <button type="button" className="now-vmodal__close" onClick={onClose} aria-label="Sluiten">×</button>
        </header>

        <div className="now-vmodal__body">
          <Column
            title="In overzicht"
            count={visible.length}
            tone="visible"
            agents={visible}
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, true)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onToggle={(name) => move(name, false)}
            actionLabel="Verberg"
            dragging={dragging}
          />
          <Column
            title="Verborgen"
            count={hidden.length}
            tone="hidden"
            agents={hidden}
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, false)}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onToggle={(name) => move(name, true)}
            actionLabel="Toon"
            dragging={dragging}
          />
        </div>

        <footer className="now-vmodal__foot">
          {err && <span className="now-vmodal__err">⚠ {err}</span>}
          {savedFlash && <span className="now-vmodal__ok">✓ Opgeslagen</span>}
          <span className="now-vmodal__spacer" />
          <button type="button" className="now-btn now-btn--ghost" onClick={onClose} disabled={busy}>
            Annuleer
          </button>
          <button
            type="button"
            className="now-btn now-btn--primary"
            onClick={save}
            disabled={busy || !dirty}
          >
            {busy ? 'Opslaan…' : dirty ? 'Opslaan' : 'Geen wijzigingen'}
          </button>
        </footer>
      </div>
    </div>
  )
}

function Column({
  title, count, tone, agents,
  onDragOver, onDrop, onDragStart, onDragEnd,
  onToggle, actionLabel, dragging,
}) {
  return (
    <div
      className={`now-vmodal__col now-vmodal__col--${tone}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="now-vmodal__col-head">
        <span className="now-vmodal__col-title">{title}</span>
        <span className="now-vmodal__col-count">{count}</span>
      </div>
      <div className="now-vmodal__col-body">
        {agents.length === 0 ? (
          <div className="now-vmodal__col-empty">leeg — sleep een agent hierheen</div>
        ) : (
          agents.map(s => (
            <AgentRow
              key={s.agent_name}
              schedule={s}
              draggable
              onDragStart={(e) => onDragStart(e, s.agent_name)}
              onDragEnd={onDragEnd}
              onToggle={() => onToggle(s.agent_name)}
              actionLabel={actionLabel}
              isDragging={dragging === s.agent_name}
            />
          ))
        )}
      </div>
    </div>
  )
}

function AgentRow({ schedule, draggable, onDragStart, onDragEnd, onToggle, actionLabel, isDragging }) {
  const tone = agentTone(schedule.agent_name)
  const initials = initialsOf(schedule.display_name || schedule.agent_name)
  return (
    <div
      className={`now-vmodal__row ${isDragging ? 'is-dragging' : ''}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <span className="now-vmodal__drag-grip" aria-hidden>
        <Icon size={12}><circle cx="9" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="18" r="1"/></Icon>
      </span>
      <div className={`now-vmodal__row-icon now-agent__icon--${tone}`}>{initials}</div>
      <div className="now-vmodal__row-text">
        <div className="now-vmodal__row-name">{schedule.display_name || schedule.agent_name}</div>
        <div className="now-vmodal__row-agent">{schedule.agent_name}</div>
      </div>
      <AgentStatusPill agent={schedule.agent_name} schedule={schedule} compact />
      <button type="button" className="now-vmodal__row-toggle" onClick={onToggle} title={actionLabel}>
        {actionLabel}
      </button>
    </div>
  )
}
