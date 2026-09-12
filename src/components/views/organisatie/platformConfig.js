// Read-only project-info voor het Config-paneel van Platform.
//
// Stond tot v1.172 in admin/pages/ConfiguratiePage.jsx; die pagina is opgegaan
// in PlatformPage (spoor 20, optie B). De rijen zijn ongewijzigd overgenomen —
// wijzigen doe je in Supabase / Vercel zelf, hier lees je alleen.
export const CONFIG_ITEMS = [
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
