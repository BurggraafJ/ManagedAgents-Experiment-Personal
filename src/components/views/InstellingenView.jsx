import NoteTemplates     from '../sections/NoteTemplates'
import Terminology       from '../sections/Terminology'
import AgentInstructions from '../sections/AgentInstructions'

// Instellingen — alles wat stuurt HOE agents schrijven én WANNEER ze iets doen.
// Drie secties: agent-instructies (per-agent richtlijnen over wanneer wel/niet
// een taak of actie), notitie-templates (schrijfstijl per context), en
// terminologie-correcties (spraak-input).
export default function InstellingenView({ data }) {
  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>
      <AgentInstructions schedules={data.schedules} agentInstructions={data.agentInstructions} />
      <NoteTemplates templates={data.noteTemplates} />
      <Terminology rows={data.terminology} />
    </div>
  )
}
