import { SettingsPage } from '../SettingsLayout'

/**
 * ConfiguratiePage (v2) — read-only project-info en runtime-settings.
 * Wijzigingen vinden plaats in Supabase / Vercel zelf.
 */

const ITEMS = [
  {
    label: 'Supabase project',
    value: 'ezxihctobrqoklufawim',
    mono: true,
    hint: 'Project-reference voor alle DB- en functions-calls.',
    link: 'https://supabase.com/dashboard/project/ezxihctobrqoklufawim',
  },
  {
    label: 'Regio',
    value: 'EU-West-1 (Frankfurt)',
    hint: 'Datacenter — alle data blijft binnen de EU.',
  },
  {
    label: 'Frontend',
    value: 'Vite + React 18 · JavaScript',
    hint: 'Build-stack van dit dashboard.',
  },
  {
    label: 'Hosting',
    value: 'Vercel · auto-deploy via main',
    hint: 'Pushes naar branch main triggeren een productie-deploy.',
    link: 'https://vercel.com/jelle-burggraaf/legal-mind-dashboard',
  },
  {
    label: 'Realtime',
    value: 'Supabase postgres_changes',
    hint: 'Live updates via Postgres replication slot.',
  },
  {
    label: 'Polling fallback',
    value: 'elke 2 minuten',
    hint: 'Als realtime tijdelijk uitvalt, ververst de UI elke 2 min handmatig.',
  },
  {
    label: 'Knowledge base',
    value: 'text-embedding-3-large · 3072d',
    mono: true,
    hint: 'Embedding-model en dimensies voor de RAG-pipeline.',
  },
  {
    label: 'Scheduler',
    value: 'Supabase pg_cron',
    hint: 'Cron-engine die alle agent-runs aftrapt.',
  },
  {
    label: 'Frontend deploy URL',
    value: 'legal-mind-dashboard.vercel.app',
    mono: true,
    hint: 'Productie-domein van dit dashboard.',
    link: 'https://legal-mind-dashboard-git-main-jelle-burggraaf.vercel.app',
  },
]

export default function ConfiguratiePage() {
  return (
    <SettingsPage
      title="Configuratie"
      intro="Algemene project-info en runtime-settings. Read-only — wijzigingen vinden plaats in Supabase / Vercel zelf."
    >
      <div className="set-config">
        {ITEMS.map(item => (
          <div key={item.label} className="set-config__row">
            <div>
              <div className="set-config__main">{item.label}</div>
              <div className="set-config__hint">{item.hint}</div>
            </div>
            <div>
              <span className={item.mono ? 'set-config__val' : 'set-config__val set-config__val--plain'}>
                {item.value}
              </span>
            </div>
            <div>
              {item.link && (
                <a
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="set-btn set-btn--ghost set-btn--sm"
                >
                  Open ↗
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </SettingsPage>
  )
}
