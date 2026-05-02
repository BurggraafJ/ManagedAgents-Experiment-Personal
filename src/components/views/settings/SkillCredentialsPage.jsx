import { SettingsPage } from './SettingsLayout'
import SkillSecrets from '../../sections/SkillSecrets'

// SkillCredentialsPage — skill-specifieke credentials in Postgres Vault.
// Hier sta je per-skill tokens en API-keys in (encrypted at rest, browser
// ziet alleen last-4). Apart van API Keys omdat dit specifiek skills-namespaced
// is en SkillSecrets z'n eigen RPC-pad (set_skill_secret) heeft.

export default function SkillCredentialsPage({ skillSecrets, secretsInventory }) {
  return (
    <SettingsPage
      title="Skill Credentials"
      intro="Tokens en API-keys die specifieke skills nodig hebben (per-skill namespace). Opgeslagen in Supabase Vault — dashboard ziet alleen de laatste 4 tekens. Plak hier nieuwe waardes na rotatie."
    >
      <SkillSecrets secrets={skillSecrets} secretsInventory={secretsInventory} />
    </SettingsPage>
  )
}
