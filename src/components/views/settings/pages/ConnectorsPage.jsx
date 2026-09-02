import { SettingsPage } from '../SettingsLayout'
import InConstruction from '../../../ui/InConstruction'

/**
 * ConnectorsPage (v1.127) — plek voor het beheer van koppelingen met externe
 * systemen. Nu nog een stub: de pagina staat in de navigatie zodat de
 * IA klopt, de inhoud volgt in een aparte iteratie.
 */
export default function ConnectorsPage() {
  return (
    <SettingsPage
      title="Connectors"
      intro="Koppelingen met externe systemen beheer je straks hier — status, autorisatie en synchronisatie per connector."
    >
      <InConstruction what="Connectors is in opbouw. Er is hier nog niets in te stellen; bestaande koppelingen blijven gewoon werken." />
    </SettingsPage>
  )
}
