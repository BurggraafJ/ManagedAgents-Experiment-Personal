import { SettingsV2Page } from '../SettingsV2Layout'

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
    <SettingsV2Page
      title="Configuratie"
      intro="Algemene project-info en runtime-settings. Read-only — wijzigingen vinden plaats in Supabase / Vercel zelf."
    >
      <div className="sv2-config">
        {ITEMS.map(item => (
          <div key={item.label} className="sv2-config__row">
            <div>
              <div className="sv2-config__main">{item.label}</div>
              <div className="sv2-config__hint">{item.hint}</div>
            </div>
            <div>
              <span className={item.mono ? 'sv2-config__val' : 'sv2-config__val sv2-config__val--plain'}>
                {item.value}
              </span>
            </div>
            <div>
              {item.link && (
                <a
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="sv2-btn sv2-btn--ghost sv2-btn--sm"
                >
                  Open ↗
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </SettingsV2Page>
  )
}
