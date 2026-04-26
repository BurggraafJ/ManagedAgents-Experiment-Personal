import NoteTemplates     from '../sections/NoteTemplates'
import Terminology       from '../sections/Terminology'
import AgentInstructions from '../sections/AgentInstructions'

// Instructies — alles wat stuurt HOE agents schrijven en welke richtlijnen ze
// volgen. Drie secties:
//  1. Agent-instructies — vrije-tekst per agent (system-message-laag boven SKILL.md).
//  2. Notitie-templates — schrijfstijl per context (Sales / Customer Base / Partner / Recruitment).
//  3. Terminologie-correcties — spraak-input naar correcte spelling.
//
// Wijzigingen zijn live voor de volgende run. De hardere "hoe vaak / aan-uit"
// settings zitten in SettingsView (gear-icoon rechtsboven).
export default function InstructiesView({ data }) {
  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>
      <AgentInstructions schedules={data.schedules} agentInstructions={data.agentInstructions} />
      <NoteTemplates templates={data.noteTemplates} />
      <Terminology rows={data.terminology} />
    </div>
  )
}
