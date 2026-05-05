import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../../lib/supabase'

// Settings-pagina: edit de system-prompt voor de RAG-chat-assistent.
// Bron: agent_config('rag-chat', 'system_prompt'). Editable, geen secret.

const DEFAULT_PROMPT = `Je bent een Nederlandse RAG-assistent. Gebruik alleen de meegegeven context. Citeer per feit met [bron #N].`

export default function ChatInstructiesPage() {
  const [prompt, setPrompt] = useState('')
  const [origPrompt, setOrigPrompt] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
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
      setPrompt(val)
      setOrigPrompt(val)
      setUpdatedAt(data?.updated_at || null)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const save = useCallback(async () => {
    if (saving || prompt === origPrompt) return
    setSaving(true)
    setError(null)
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
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setSaving(false)
    }
  }, [prompt, origPrompt, saving])

  const reset = useCallback(() => {
    setPrompt(DEFAULT_PROMPT)
  }, [])

  const dirty = prompt !== origPrompt
  const charCount = prompt.length
  const tokenEstimate = Math.ceil(charCount / 4)   // ruwe schatting

  return (
    <div className="stack" style={{ gap: 'var(--s-5)' }}>
      <div>
        <h2 className="section__title" style={{ marginBottom: 4 }}>Chat-instructies</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0, lineHeight: 1.55 }}>
          System prompt die de RAG-assistent op de <Link to="/zoeken">Zoeken-pagina</Link> volgt.
          Komt vóór elke vraag van Jelle, samen met de retrieved context-stukken.
          Bijwerken werkt direct — volgende vraag gebruikt de nieuwe instructies.
        </p>
      </div>

      {error && (
        <div className="card" style={{ padding: 'var(--s-3)', borderLeft: '3px solid #ef4444', color: '#ef4444', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div className="card" style={{ padding: 'var(--s-4)', display: 'flex', flexDirection: 'column', gap: 'var(--s-3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            System Prompt
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {charCount.toLocaleString('nl-NL')} chars · ~{tokenEstimate.toLocaleString('nl-NL')} tokens
            {updatedAt && <> · laatst opgeslagen {new Date(updatedAt).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</>}
          </span>
        </div>

        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={loading}
          spellCheck={false}
          rows={20}
          style={{
            width: '100%', fontSize: 13, lineHeight: 1.55,
            fontFamily: 'var(--font-mono, monospace)',
            padding: 'var(--s-3)',
            border: '1px solid var(--border)', borderRadius: 6,
            background: 'var(--bg-input, var(--bg))', color: 'var(--text)',
            resize: 'vertical', minHeight: 320, boxSizing: 'border-box',
          }}
        />

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
          {savedAt && (
            <span style={{ fontSize: 12, color: '#22c55e', marginRight: 'auto' }}>
              ✓ Opgeslagen
            </span>
          )}
          <button type="button" className="btn" onClick={reset} disabled={loading || saving}>
            Reset naar default
          </button>
          <button type="button" className="btn" onClick={() => setPrompt(origPrompt)} disabled={!dirty || saving}>
            Annuleer
          </button>
          <button type="button" className="btn btn--accent" onClick={save} disabled={!dirty || saving || loading}>
            {saving ? 'Opslaan…' : 'Opslaan'}
          </button>
        </div>
      </div>

      <div className="card" style={{ padding: 'var(--s-4)' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 'var(--s-3)' }}>
          Tips voor het schrijven
        </div>
        <ul style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6, paddingLeft: 18, margin: 0 }}>
          <li>Begin met de rol ("Je bent…") en de context (Legal Mind, klanten = advocatenkantoren).</li>
          <li>Schrijf duidelijke regels in een bullet-lijst — die volgt de assistent goed op.</li>
          <li>Verplicht expliciet citeren met <code>[bron #N]</code>; de zoekpagina hoogt deze zelf op.</li>
          <li>Geef "weet ik niet"-instructie zodat hij niet hallucinert: <em>"Als de context geen antwoord geeft, zeg dat letterlijk."</em></li>
          <li>Houd het kort — alles boven ~2.000 tokens kost merkbaar meer per query.</li>
          <li>De Anthropic-key moet in <Link to="/instellingen/api-keys">API Keys</Link> staan onder <code>skill:anthropic:api_key</code>.</li>
        </ul>
      </div>
    </div>
  )
}
