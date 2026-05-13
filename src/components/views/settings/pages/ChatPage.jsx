import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../../../lib/supabase'
import { SettingsPage } from '../SettingsLayout'

const DEFAULT_PROMPT = `Je bent een Nederlandse RAG-assistent. Gebruik alleen de meegegeven context. Citeer per feit met [bron #N].`

/**
 * ChatPage (v2) — system-prompt voor de RAG-chat-assistent.
 * Bron: agent_config('rag-chat', 'system_prompt'). Editable, no secret.
 */
export default function ChatPage() {
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
        : (data?.config_value ? String(data.config_value) : DEFAULT_PROMPT)
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

  const dirty = prompt !== origPrompt
  const charCount = prompt.length
  const tokenEstimate = Math.ceil(charCount / 4)

  return (
    <SettingsPage
      title="Chat-assistent"
      intro={<>System prompt die de RAG-assistent op de <Link to="/zoeken">Zoeken-pagina</Link> volgt.
        Komt vóór elke vraag samen met de retrieved context-stukken. Wijzigingen werken direct —
        volgende vraag gebruikt de nieuwe instructies.</>}
    >
      {error && <div className="set-banner set-banner--err">⚠ {error}</div>}

      <div className="set-editor">
        <div className="set-editor__toolbar">
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--set-n-500)', textTransform: 'uppercase', letterSpacing: '.06em', padding: '0 6px' }}>
            System Prompt
          </span>
          <span className="set-editor__meta">
            {charCount.toLocaleString('nl-NL')} chars · ~{tokenEstimate.toLocaleString('nl-NL')} tokens
            {updatedAt && <> · opgeslagen {new Date(updatedAt).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</>}
          </span>
        </div>
        <div style={{ padding: '6px' }}>
          <textarea
            className="set-textarea set-textarea--mono"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            disabled={loading}
            spellCheck={false}
            rows={18}
            style={{ minHeight: 360, border: 0, boxShadow: 'none' }}
          />
        </div>
      </div>

      <div className="set-actions">
        <button
          type="button"
          className="set-btn set-btn--primary"
          onClick={save}
          disabled={!dirty || saving || loading}
        >
          {saving ? 'Opslaan…' : 'Opslaan'}
        </button>
        <button
          type="button"
          className="set-btn set-btn--ghost"
          onClick={() => setPrompt(origPrompt)}
          disabled={!dirty || saving}
        >
          Annuleer
        </button>
        <button
          type="button"
          className="set-btn set-btn--ghost"
          onClick={() => setPrompt(DEFAULT_PROMPT)}
          disabled={saving || loading}
          title="Reset naar minimale default-prompt"
        >
          Reset default
        </button>
        {savedAt && <span className="set-actions__hint set-actions__hint--success">✓ Opgeslagen</span>}
      </div>

      <div className="set-panel" style={{ marginTop: 22, padding: 18 }}>
        <div className="set-kcat" style={{ marginTop: 0 }}>Tips voor het schrijven</div>
        <ul style={{ fontSize: 13, color: 'var(--set-n-500)', lineHeight: 1.6, paddingLeft: 18, margin: 0 }}>
          <li>Begin met de rol ("Je bent…") en de context (Legal Mind, klanten = advocatenkantoren).</li>
          <li>Schrijf duidelijke regels in een bullet-lijst — die volgt de assistent goed op.</li>
          <li>Verplicht expliciet citeren met <code>[bron #N]</code>; de zoekpagina hoogt deze zelf op.</li>
          <li>Geef "weet ik niet"-instructie zodat hij niet hallucinert.</li>
          <li>Houd het kort — alles boven ~2.000 tokens kost merkbaar meer per query.</li>
          <li>De Anthropic-key moet in <Link to="/instellingen/api-keys">API Keys</Link> staan onder <code>skill:anthropic:api_key</code>.</li>
        </ul>
      </div>
    </SettingsPage>
  )
}
