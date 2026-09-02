import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

/**
 * useAgentInstructionsEditor — tekst-state + opslaan/ongedaan voor de
 * vrije-tekst instructies van één agent (agent_config.custom_instructions).
 *
 * Gedeeld door de desktop AgentEditor en de mobiele MobileSettingsAgents-
 * editor. Schrijft via upsert_agent_instructions RPC. State reset bij
 * agent-wissel of nieuwe updated_at-stempel (realtime-refetch na save).
 */
export function useAgentInstructionsEditor(schedule, row) {
  const original = row?.config_value?.text || ''
  const [text, setText] = useState(original)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [saved, setSaved] = useState(false)
  const [resetKey, setResetKey] = useState(0)

  useEffect(() => {
    setText(row?.config_value?.text || '')
    setErr(null); setSaved(false)
    setResetKey(k => k + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule?.agent_name, row?.updated_at])

  const dirty = text !== original

  const save = useCallback(async () => {
    if (!schedule) return
    setBusy(true); setErr(null); setSaved(false)
    try {
      const { data, error } = await supabase.rpc('upsert_agent_instructions', {
        p_agent_name: schedule.agent_name,
        p_instructions: text,
        p_updated_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (data && data.ok === false) setErr(data.reason || 'mislukt')
      else setSaved(true)
    } catch (e) {
      setErr(e.message || 'netwerkfout')
    }
    setBusy(false)
  }, [schedule, text])

  const reset = useCallback(() => {
    setText(row?.config_value?.text || '')
    setErr(null); setSaved(false)
    setResetKey(k => k + 1)
  }, [row])

  return { text, setText, original, dirty, busy, err, saved, resetKey, save, reset }
}
