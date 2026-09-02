import InConstruction from '../../components/ui/InConstruction'
import { MSetHead } from './MobileSettingsBits'
import '../mobile-settings.css'

// Long running tasks op mobiel (v1.127) — module vanuit de Meer-sheet, zelfde
// kop-ritme als Instellingen (eyebrow MEER + Host Grotesk-titel). Stub tot de
// module inhoud krijgt; scrolt mee in .m-main.
export default function MobileLongRunning() {
  return (
    <div className="m-dash m-set">
      <MSetHead eyebrow="Meer" title="Long running tasks" sub="Taken die langer lopen dan één agent-run." />
      <div className="m-set__body">
        <InConstruction what="Long running tasks is in opbouw. Hier komt straks het overzicht van taken die meerdere runs of dagen lopen." />
      </div>
    </div>
  )
}
