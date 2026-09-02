import { Link } from 'react-router-dom'
import { useChatSystemPrompt } from '../../../../hooks/useChatSystemPrompt'
import { SettingsPage } from '../SettingsLayout'
import WritingStylesEditor from './WritingStylesEditor'

/**
 * ChatPage (v2) — system-prompt voor de RAG-chat-assistent.
 * Bron: agent_config('rag-chat', 'system_prompt'). Editable, no secret.
 * State + fetch/save in useChatSystemPrompt (gedeeld met mobiel, v1.126).
 */
export default function ChatPage() {
  const c = useChatSystemPrompt()
  const charCount = c.prompt.length
  const tokenEstimate = Math.ceil(charCount / 4)

  return (
    <SettingsPage
      title="Chat-assistent"
      intro={<>System prompt die de RAG-assistent op de <Link to="/">Home-pagina (vragenbak)</Link> volgt.
        Komt vóór elke vraag samen met de retrieved context-stukken. Wijzigingen werken direct —
        volgende vraag gebruikt de nieuwe instructies.</>}
    >
      {c.error && <div className="set-banner set-banner--err">⚠ {c.error}</div>}

      <div className="set-editor">
        <div className="set-editor__toolbar">
          <span className="set-editor__label">System Prompt</span>
          <span className="set-editor__meta">
            {charCount.toLocaleString('nl-NL')} chars · ~{tokenEstimate.toLocaleString('nl-NL')} tokens
            {c.updatedAt && <> · opgeslagen {new Date(c.updatedAt).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</>}
          </span>
        </div>
        <div className="set-editor__body set-editor__body--flush">
          <textarea
            className="set-textarea set-textarea--mono set-textarea--bare"
            value={c.prompt}
            onChange={e => c.setPrompt(e.target.value)}
            disabled={c.loading}
            spellCheck={false}
            rows={18}
          />
        </div>
      </div>

      <div className="set-actions">
        <button
          type="button"
          className="set-btn set-btn--primary"
          onClick={c.save}
          disabled={!c.dirty || c.saving || c.loading}
        >
          {c.saving ? 'Opslaan…' : 'Opslaan'}
        </button>
        <button
          type="button"
          className="set-btn set-btn--ghost"
          onClick={c.reset}
          disabled={!c.dirty || c.saving}
        >
          Annuleer
        </button>
        <button
          type="button"
          className="set-btn set-btn--ghost"
          onClick={c.resetDefault}
          disabled={c.saving || c.loading}
          title="Reset naar minimale default-prompt"
        >
          Reset default
        </button>
        {c.savedAt && <span className="set-actions__hint set-actions__hint--success">✓ Opgeslagen</span>}
      </div>

      <WritingStylesEditor />

      <div className="set-panel set-panel--tips">
        <div className="set-kcat">Tips voor het schrijven</div>
        <ul className="set-tips">
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
