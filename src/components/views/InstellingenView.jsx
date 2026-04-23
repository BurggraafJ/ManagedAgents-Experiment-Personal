import NoteTemplates from '../sections/NoteTemplates'
import Terminology   from '../sections/Terminology'

// Instellingen — alles wat stuurt HOE agents schrijven. Bewust los van Systeem
// (infra/schedules) zodat Jelle schrijf-configuratie op één plek beheert:
// schrijfstijl per context + terminologie-correcties voor spraak-input.
export default function InstellingenView({ data }) {
  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>
      <NoteTemplates templates={data.noteTemplates} />
      <Terminology rows={data.terminology} />
    </div>
  )
}
