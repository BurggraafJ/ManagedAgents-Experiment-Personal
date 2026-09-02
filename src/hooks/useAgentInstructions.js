import { useMemo } from 'react'
import { useSupabaseQuery } from './useSupabaseQuery'

/**
 * useAgentInstructions — alleen de custom_instructions-rijen uit agent_config.
 *
 * Lichte tegenhanger van useAutoDraft().agentInstructions (die 15 tabellen
 * laadt) voor de mobiele Instellingen. Zelfde rij-vorm: { agent_name,
 * config_key, config_value: { text, updated_by }, updated_at }.
 *
 * Returns: { rows, lookup (agent_name → rij), loading, refresh }
 */
export function useAgentInstructions() {
  const { data, loading, refresh } = useSupabaseQuery('agent_config', {
    select: 'agent_name,config_key,config_value,updated_at',
    filters: { config_key: 'custom_instructions' },
    realtime: true,
  })
  const lookup = useMemo(() => {
    const m = {}
    for (const row of data || []) m[row.agent_name] = row
    return m
  }, [data])
  return { rows: data || [], lookup, loading, refresh }
}
