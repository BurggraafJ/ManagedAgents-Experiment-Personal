import { SettingsPage, SettingsRow } from './SettingsLayout'

// ConfiguratiePage — algemene project-info (Supabase project-ID, regio, host).
// Pure read-only voor nu; geen velden om aan te passen. Format past bij de
// settings-row pattern uit het Claude-screenshot: label links, waarde rechts.

const ITEMS = [
  { label: 'Supabase project',  value: 'ezxihctobrqoklufawim', mono: true,
    hint: 'Project-reference voor alle DB- en functions-calls.' },
  { label: 'Regio',             value: 'EU-West-1',
    hint: 'Datacenter — alle data blijft binnen de EU.' },
  { label: 'Frontend',          value: 'Vite + React 18',
    hint: 'Build-stack van dit dashboard.' },
  { label: 'Hosting',           value: 'Vercel · auto-deploy via main',
    hint: 'Pushes naar branch main triggeren een productie-deploy.' },
  { label: 'Realtime',          value: 'Supabase postgres_changes',
    hint: 'Live updates via Postgres replication slot.' },
  { label: 'Polling fallback',  value: 'elke 2 minuten',
    hint: 'Als realtime tijdelijk uitvalt, ververst de UI elke 2 min handmatig.' },
]

export default function ConfiguratiePage() {
  return (
    <SettingsPage
      title="Configuratie"
      intro="Algemene project-info en runtime-settings. Read-only — wijzigingen vinden plaats in Supabase / Vercel zelf."
    >
      {ITEMS.map(item => (
        <SettingsRow key={item.label} label={item.label} hint={item.hint}>
          <span className={item.mono ? 'mono settings-value' : 'settings-value'}>
            {item.value}
          </span>
        </SettingsRow>
      ))}
    </SettingsPage>
  )
}
