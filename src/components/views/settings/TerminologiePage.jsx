import { SettingsPage } from './SettingsLayout'
import Terminology from '../../sections/Terminology'

// TerminologiePage — wikkelt de bestaande Terminology-section in een
// SettingsPage zodat header + intro consistent zijn met de andere pagina's.
// De Terminology-component zelf is al een goede lijst met inline edit;
// die is hier prima.

export default function TerminologiePage({ rows }) {
  return (
    <SettingsPage
      title="Terminologie"
      intro="Wat spraak-naar-tekst verkeerd hoort → wat het moet worden. Agents die jouw vrije tekst verwerken (Slack-aantekeningen, amendments, chat) vervangen deze termen vóór inhoudelijke verwerking."
    >
      <Terminology rows={rows} />
    </SettingsPage>
  )
}
