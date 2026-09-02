import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export const DEFAULT_CHAT_PROMPT = `Je bent een Nederlandse RAG-assistent. Gebruik alleen de meegegeven context. Citeer per feit met [bron #N].`

/**
 * useChatSystemPrompt — system-prompt van de RAG-chat-assistent.
 * Bron: agent_config('rag-chat', 'system_prompt'). Editable, geen secret.
 *
 * Gedeeld door de desktop ChatPage en de mobiele Chat-assistent-pagina.
 */
export function useChatSystemPrompt() {
  const [prompt, setPrompt] = useState('')
  const [origPrompt, setOrigPrompt] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data, error: e } = await supabase.from('agent_config')
        .select('config_value, updated_at')
        .eq('agent_name', 'rag-chat')
        .eq('config_key', 'system_prompt')
        .maybeSingle()
      if (e) throw new Error(e.message)
      const val = typeof data?.config_value === 'string'
        ? data.config_value
        : (data?.config_value ? String(data.config_value) : DEFAULT_CHAT_PROMPT)
      setPrompt(val); setOrigPrompt(val)
      setUpdatedAt(data?.updated_at || null)
    } catch (e) { setError(e.message || String(e)) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const save = useCallback(async () => {
    if (saving || prompt === origPrompt) return
    setSaving(true); setError(null)
    try {
      const { error: e } = await supabase.from('agent_config').upsert({
        agent_name: 'rag-chat',
        config_key: 'system_prompt',
        config_value: prompt,
        is_secret: false,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'agent_name,config_key' })
      if (e) throw new Error(e.message)
      setOrigPrompt(prompt)
      setSavedAt(Date.now())
      setUpdatedAt(new Date().toISOString())
      setTimeout(() => setSavedAt(null), 3000)
    } catch (e) { setError(e.message || String(e)) }
    finally { setSaving(false) }
  }, [prompt, origPrompt, saving])

  const reset = useCallback(() => setPrompt(origPrompt), [origPrompt])
  const resetDefault = useCallback(() => setPrompt(DEFAULT_CHAT_PROMPT), [])

  return {
    prompt, setPrompt, origPrompt, dirty: prompt !== origPrompt,
    loading, saving, error, savedAt, updatedAt,
    save, reset, resetDefault,
  }
}
