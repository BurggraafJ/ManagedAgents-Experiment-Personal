import { useState } from 'react'
import Schedules         from '../sections/Schedules'
import LinkedInProgress  from '../sections/LinkedInProgress'
import Config            from '../sections/Config'
import SkillSecrets      from '../sections/SkillSecrets'
import AgentInstructions from '../sections/AgentInstructions'
import NoteTemplates     from '../sections/NoteTemplates'
import Terminology       from '../sections/Terminology'

// Settings — overkoepelende configuratie achter het ⚙-icoon rechtsboven.
// Tab-indeling zodat het overzichtelijk blijft i.p.v. één lange scroll:
//   - Agents      : schedules + per-agent instructies (system messages)
//   - Inhoud      : note-templates + terminologie-correcties (was 'Instructies')
//   - Systeem     : skill-secrets + LinkedIn voortgang + DB-config
//
// Per-agent cadence kun je ook bewerken via het ⋯-menu op zijn kaart op het
// Dashboard. Beide routes muteren via `update_agent_schedule` RPC.

const TABS = [
  { id: 'agents',  label: 'Agents',   hint: 'Schedules + per-agent instructies (system messages)' },
  { id: 'inhoud',  label: 'Inhoud',   hint: 'Notitie-templates + terminologie-correcties' },
  { id: 'systeem', label: 'Systeem',  hint: 'Skill-secrets, integraties, configuratie' },
]

export default function SettingsView({ data }) {
  const [tab, setTab] = useState('agents')

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

      {tab === 'agents' && (
        <div className="stack" style={{ gap: 'var(--s-7)' }}>
          <Schedules schedules={data.schedules} />
          <AgentInstructions
            schedules={data.schedules}
            agentInstructions={data.agentInstructions}
          />
        </div>
      )}

      {tab === 'inhoud' && (
        <div className="stack" style={{ gap: 'var(--s-7)' }}>
          <NoteTemplates templates={data.noteTemplates} />
          <Terminology   rows={data.terminology} />
        </div>
      )}

      {tab === 'systeem' && (
        <div className="stack" style={{ gap: 'var(--s-7)' }}>
          <SkillSecrets     secrets={data.skillSecrets} />
          <LinkedInProgress rows={data.linkedin} />
          <Config />
        </div>
      )}
    </div>
  )
}
