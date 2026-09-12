import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Laatste run-status per Edge Function uit agent_runs.
//
// Stond tot v1.172 in admin/pages/EdgeFunctionsPage.jsx; die pagina is opgegaan
// in PlatformPage (spoor 20, optie B). De query is ongewijzigd — één select
// over de laatste 7 dagen, elke 30 s ververst. Hier als hook zodat de
// data-laag los staat van de render (CLAUDE.md: hooks scheiden van UI).

const REFRESH_MS = 30_000

export const EDGE_FUNCTIONS = [
  { slug: 'mail-sync-etl-v2',          agent: 'mail-sync',                category: 'Data',    label: 'Mail sync',             desc: 'Outlook delta sync — live elke 5 min',                              consumedBy: ['auto-draft', 'autodraft-rag-prefill', 'rag-search', 'daily-admin'] },
  { slug: 'mail-backfill',             agent: 'mail-backfill',            category: 'Data',    label: 'Mail backfill',         desc: '12 mnd historische mail ophalen, in batches',                       consumedBy: ['chunker'] },
  { slug: 'hubspot-sync-etl',          agent: 'hubspot-sync',             category: 'Data',    label: 'HubSpot sync',          desc: 'Deals / companies / contacts / owners / pipelines',                 consumedBy: ['daily-admin', 'sales-followups', 'rag-search'] },
  { slug: 'hubspot-engagements-sync',  agent: 'hubspot-engagements-sync', category: 'Data',    label: 'HubSpot engagements',   desc: 'Calls / emails / notes / tasks / meetings',                         consumedBy: ['daily-admin', 'sales-followups', 'rag-search'] },
  { slug: 'jira-sync-etl',             agent: 'jira-sync',                category: 'Data',    label: 'Jira sync',             desc: 'Sales / Management / Recruitment / Partnerships boards',            consumedBy: ['daily-admin', 'task-organizer', 'rag-search'] },
  { slug: 'fireflies-sync-etl',        agent: 'fireflies-sync',           category: 'Data',    label: 'Fireflies sync',        desc: 'Meeting-transcripts + summaries',                                    consumedBy: ['task-organizer', 'daily-admin', 'rag-search'] },
  { slug: 'outlook-calendar-sync-etl', agent: 'outlook-calendar-sync',    category: 'Data',    label: 'Outlook calendar sync', desc: 'Agenda-events + attendees',                                          consumedBy: ['daily-admin', 'agenda'] },
  { slug: 'chunker',                   agent: 'chunker',                  category: 'AI',      label: 'Chunker',               desc: 'Chunkt + embedt 9 source-types (3072d halfvec)',                    consumedBy: ['rag-search', 'autodraft-rag-prefill', 'auto-draft'] },
  { slug: 'autodraft-rag-prefill',     agent: 'autodraft-rag-prefill',    category: 'AI',      label: 'AutoDraft RAG prefill', desc: 'Vult per nieuwe mail rag_context in autodraft_mails',               consumedBy: ['auto-draft'] },
  { slug: 'task-organizer-fireflies',  agent: 'task-organizer-fireflies', category: 'AI',      label: 'Task-organizer Fireflies', desc: 'Parsed action-items uit Fireflies-meetings',                      consumedBy: ['task-organizer'] },
  { slug: 'rag-search',                agent: null,                       category: 'AI',      label: 'RAG search',            desc: 'On-demand vector-search over alle bronnen', noTracking: true, consumedBy: ['dashboard zoek-tab', 'auto-draft'] },
  { slug: 'transcribe',                agent: null,                       category: 'AI',      label: 'Transcribe (Whisper)',  desc: 'Voice-to-text via OpenAI Whisper',          noTracking: true, consumedBy: ['voice-input', 'agenda'] },
]

export function useEdgeFunctionHealth() {
  const [latestByAgent, setLatestByAgent] = useState({})
  const [runs7dByAgent, setRuns7dByAgent] = useState({})
  const [fetchedAt, setFetchedAt] = useState(null)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString()
      const knownAgents = EDGE_FUNCTIONS.filter(f => f.agent).map(f => f.agent)
      const { data, error: err } = await supabase.from('agent_runs')
        .select('agent_name,status,summary,started_at,stats')
        .in('agent_name', knownAgents)
        .gte('started_at', sevenDaysAgo)
        .order('started_at', { ascending: false })
        .limit(500)
      if (err) throw err
      const latest = {}, runs7d = {}
      for (const r of data || []) {
        if (!latest[r.agent_name]) latest[r.agent_name] = r
        if (!runs7d[r.agent_name]) runs7d[r.agent_name] = []
        runs7d[r.agent_name].push(r)
      }
      setLatestByAgent(latest)
      setRuns7dByAgent(runs7d)
      setFetchedAt(new Date())
      setError(null)
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(id)
  }, [refresh])

  return { latestByAgent, runs7dByAgent, fetchedAt, error, refresh }
}
