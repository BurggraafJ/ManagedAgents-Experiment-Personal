import { useState } from 'react'
import Config            from '../sections/Config'
import SkillSecrets      from '../sections/SkillSecrets'
import SecretsInventory  from '../sections/SecretsInventory'
import AgentInstructions from '../sections/AgentInstructions'
import NoteTemplates     from '../sections/NoteTemplates'
import Terminology       from '../sections/Terminology'

// Settings — overkoepelende configuratie achter het ⚙-icoon op het Dashboard.
// Twee tabs:
//   - Instructies : alles wat agents inhoudelijk stuurt — system messages
//                   per agent, notitie-templates per context, terminologie-
//                   correcties voor spraak-input.
//   - Systeem     : skill-secrets, integraties (LinkedIn voortgang),
//                   algemene config (anon-key, env).
//
// Schedules / cadence per agent zijn HIER NIET meer — dat regel je via het
// ⋯-menu op de agent-card op het Dashboard. Voorkomt dubbele bron.

const TABS = [
  { id: 'instructies', label: 'Instructies', hint: 'System messages per agent + templates + terminologie' },
  { id: 'systeem',     label: 'Systeem',     hint: 'Skill-secrets, integraties, configuratie' },
]

export default function SettingsView({ data }) {
  const [tab, setTab] = useState('instructies')

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <div
        className="card"
        style={{
          padding: 4,
          display: 'flex',
          gap: 4,
          background: 'var(--bg-2)',
          width: 'fit-content',
        }}
      >
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className="btn btn--ghost"
            title={t.hint}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: tab === t.id ? 600 : 400,
              background: tab === t.id ? 'var(--bg)' : 'transparent',
              color: tab === t.id ? 'var(--text)' : 'var(--text-muted)',
              border: tab === t.id ? '1px solid var(--border)' : '1px solid transparent',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'instructies' && (
        <div className="stack" style={{ gap: 'var(--s-7)' }}>
          <AgentInstructions
            schedules={data.schedules}
            agentInstructions={data.agentInstructions}
          />
          <NoteTemplates templates={data.noteTemplates} />
          <Terminology   rows={data.terminology} />
        </div>
      )}

      {tab === 'systeem' && (
        <div className="stack" style={{ gap: 'var(--s-7)' }}>
          <SecretsInventory secretsInventory={data.secretsInventory} />
          <SkillSecrets secrets={data.skillSecrets} />
          <Config />
          <div className="card" style={{ padding: 'var(--s-4)', fontSize: 12, color: 'var(--text-muted)', borderStyle: 'dashed' }}>
            <strong style={{ color: 'var(--text-dim)' }}>Tip:</strong> cadence en aan/uit per agent regel je via het
            <span style={{ margin: '0 4px' }} aria-hidden>⋯</span>menu op de agent-kaart op het Dashboard.
            Wat je daar instelt komt direct in <span className="mono">agent_schedules</span> terecht.
          </div>
        </div>
      )}
    </div>
  )
}
