import { SettingsPage } from './SettingsLayout'
import SecretsInventory from '../../sections/SecretsInventory'

// ApiKeysPage — centrale registry van alle API keys/secrets met rotation-status.
// Wrap rond de bestaande SecretsInventory-section.

export default function ApiKeysPage({ secretsInventory }) {
  return (
    <SettingsPage
      title="API Keys"
      intro="Alle externe service-keys en eigen infrastructuur-tokens met rotation-status. 🔴 betekent: ooit via chat geleverd → roteren. 🟢 betekent: alleen via dashboard ingesteld → veilig."
    >
      <SecretsInventory secretsInventory={secretsInventory} />
    </SettingsPage>
  )
}
