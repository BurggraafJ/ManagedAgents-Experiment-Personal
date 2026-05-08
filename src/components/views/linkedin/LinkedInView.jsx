import { useMemo } from 'react'
import { useSupabaseQuery } from '../../../hooks/useSupabaseQuery'
import { computeLinkedInKpis } from '../../../lib/linkedin'
import LinkedInTargetsTable from './LinkedInTargetsTable'
import LinkedInActivityLog from './LinkedInActivityLog'
import LinkedInStrategyPanel from './LinkedInStrategyPanel'
import LinkedInKpis from './LinkedInKpis'

/**
 * LinkedInView — targets-tabel + activity-log + strategie + KPI-cijfers voor
 * de linkedin-connect agent.
 *
 * Refactor 20 (Golf D): geen `data`-prop meer. 3× useSupabaseQuery direct
 * voor linkedin_targets, linkedin_activity_log, linkedin_strategy. Strategy
 * is single-row (id=1) → maybeSingle.
 */
export default function LinkedInView() {
  const targetsQ = useSupabaseQuery('linkedin_targets', {
    orderBy: ['created_at', { ascending: false }],
    limit: 500,
  })
  const activityQ = useSupabaseQuery('linkedin_activity_log', {
    orderBy: ['created_at', { ascending: false }],
    limit: 200,
  })
  const strategyQ = useSupabaseQuery('linkedin_strategy', {
    filters: { id: 1 },
    maybeSingle: true,
  })

  const targets  = targetsQ.data  || []
  const activity = activityQ.data || []
  const strategy = strategyQ.data

  const kpis = useMemo(() => computeLinkedInKpis(targets), [targets])

  return (
    <div className="stack" style={{ gap: 'var(--s-7)' }}>
      <LinkedInTargetsTable targets={targets} />
      <LinkedInActivityLog activity={activity} />
      <LinkedInStrategyPanel strategy={strategy} onSaved={strategyQ.refresh} />
      <LinkedInKpis kpis={kpis} />
    </div>
  )
}
