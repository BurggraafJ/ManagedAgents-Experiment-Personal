// Edge-functions die op de Agents-pagina als "Functies" worden getoond. Geen
// werk-agents (eigen agent-card), maar wel relevant voor wat de werk-agents
// + dashboard onder water gebruiken. Per fn een korte uitleg + 'usedBy' om te
// snappen waar in het ecosysteem hij past.
//
// Truth-of-source syncs (mail-sync / hubspot-sync / jira-sync) staan hier NIET
// in — die hebben hun eigen tab. Volledig technisch overzicht: /Functies.

export const AGENT_PAGE_FUNCTIONS = [
  {
    agent: 'chunker',
    label: 'Chunker',
    desc: 'Chunkt + embedt 9 source-types naar chunks-tabel met contextual prefix (text-embedding-3-large 3072d halfvec + GPT-5-nano).',
    usedBy: 'auto-draft (RAG-context), Search-tab, autodraft-rag-prefill',
  },
  {
    agent: 'autodraft-rag-prefill',
    label: 'AutoDraft RAG prefill',
    desc: 'Pakt per nieuwe inkomende mail relevante eerdere context (mails, deals, contacten, Jira-issues) en zet die in autodraft_mails.rag_context.',
    usedBy: 'auto-draft (leest context ipv zelf RAG te doen)',
  },
  {
    agent: 'mail-backfill',
    label: 'Mail backfill',
    desc: '12 maanden historische Outlook-mail ophalen in batches. Eenmalige job per folder; daarna idle.',
    usedBy: 'mail-sync (initiële vulling), RAG-historie',
  },
  {
    agent: 'hubspot-engagements-sync',
    label: 'HubSpot engagements',
    desc: 'Sync van calls, mails, notes, tasks en meetings — alle interactie-historie van deals/contacten.',
    usedBy: 'daily-admin, sales-followups',
  },
  {
    agent: 'rag-search',
    label: 'RAG search',
    desc: 'On-demand vector-search over alle bronnen via match_all_sources RPC.',
    usedBy: 'Search-tab in dashboard, ad-hoc context-queries',
    noTracking: true,
  },
  {
    agent: 'transcribe',
    label: 'Transcribe (Whisper)',
    desc: 'Spraak-naar-tekst via OpenAI Whisper.',
    usedBy: 'Dashboard mic-knop (quick-capture taken, agenda)',
    noTracking: true,
  },
  {
    agent: 'vercel-control',
    label: 'Vercel control',
    desc: 'Lijst/promote/cancel/redeploy van het dashboard via de Vercel API.',
    usedBy: 'Functies-pagina deploy-knoppen, dashboard-refresh skill',
  },
]

// Tier-based grouping (zie agent_schedules.tier):
//   primary   = hoofdagent — altijd zichtbaar.
//   secondary = ondersteunend (auto-draft-execute, task-organizer) —
//               default ingeklapt onder "Helper-agents (N)".
//   source    = truth-of-source sync (mail-sync/hubspot-sync/jira-sync) — verborgen,
//               eigen plek in TruthOfSourcesView.
//   infra     = orchestrator/dashboard-refresh/agent-manager — helemaal verborgen.
//
// NEVER_SHOW dekt:
// - infra-agents die wel een schedule-rij hebben.
// - edge-functions met eigen pg_cron (chunker, mail-backfill,
//   hubspot-engagements-sync) die in agent_runs verschijnen maar geen agent zijn —
//   die staan in FunctionsView en TruthOfSourcesView.
export const NEVER_SHOW = new Set([
  'orchestrator', 'dashboard-refresh', 'agent-manager',
  'chunker', 'mail-backfill', 'hubspot-engagements-sync', 'autodraft-rag-prefill',
])

export function relTime(iso) {
  if (!iso) return 'nooit'
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'zojuist'
  if (min < 60) return `${min}m geleden`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}u geleden`
  return `${Math.floor(h / 24)}d geleden`
}
