import { useChatSystemPrompt } from '../../hooks/useChatSystemPrompt'
import WritingStylesEditor from '../../components/views/settings/pages/WritingStylesEditor'
import MailVerrijkingPage from '../../components/views/settings/pages/uitleg/MailVerrijkingPage'
import AutoDraftPage from '../../components/views/settings/pages/uitleg/AutoDraftPage'
import { MSetHead } from './MobileSettingsBits'

// Chat-assistent op mobiel (v1.126): system prompt (agent_config rag-chat /
// system_prompt) in een kaart + Opslaan/Annuleer/Reset. De schrijfstijlen-
// editor (rag_chat_writing_styles) komt 1:1 uit de desktop-pagina, ingebed
// in een .set-app-scope zodat z'n tokens kloppen.
export function MobileSettingsChat({ onBack }) {
  const c = useChatSystemPrompt()
  const chars = c.prompt.length
  const tokens = Math.ceil(chars / 4)

  return (
    <div className="m-dash m-set">
      <MSetHead back={onBack} backLabel="Instellingen" title="Chat-assistent"
        sub="System prompt voor de Home-chat. Wijzigingen gelden bij de volgende vraag." />
      <div className="m-set__body">
        {c.error && <div className="m-set__errline">⚠ {c.error}</div>}
        <div className="m-set-ed__card">
          <div className="m-set-ed__bar">
            <span className="m-set-ed__lbl">System prompt</span>
            <span className="m-set-ed__chars">
              {chars.toLocaleString('nl-NL')} tekens · ~{tokens.toLocaleString('nl-NL')} tokens
            </span>
          </div>
          <textarea
            className="m-set__textarea"
            value={c.prompt}
            onChange={e => c.setPrompt(e.target.value)}
            disabled={c.loading}
            spellCheck={false}
            rows={12}
          />
        </div>
        {c.updatedAt && (
          <div className="m-set__ver">
            opgeslagen {new Date(c.updatedAt).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
        <div className="m-set__actions">
          <button type="button" className="m-set__btn m-set__btn--primary" onClick={c.save} disabled={!c.dirty || c.saving || c.loading}>
            {c.saving ? 'Opslaan…' : c.savedAt ? '✓ Opgeslagen' : 'Opslaan'}
          </button>
          <button type="button" className="m-set__btn" onClick={c.reset} disabled={!c.dirty || c.saving}>Annuleer</button>
          <button type="button" className="m-set__btn" onClick={c.resetDefault} disabled={c.saving || c.loading} title="Reset naar minimale default-prompt">Reset default</button>
        </div>

        <div className="set-app m-set-embed">
          <WritingStylesEditor />
        </div>
      </div>
    </div>
  )
}

// Uitleg-pagina's (Mail-verrijking / AutoDraft) als drill-in: de desktop-
// content 1:1, gereflowd binnen de mobiele shell. Verhuizen naar Kennisbank
// staat open (NOTES.md) — tot Jelle beslist blijven ze hier bereikbaar.
export function MobileSettingsUitleg({ page, onBack }) {
  return (
    <div className="m-dash m-set">
      <MSetHead back={onBack} backLabel="Instellingen" eyebrow="Uitleg" />
      <div className="m-set__body">
        <div className="set-app m-set-embed">
          {page === 'mail-verrijking' ? <MailVerrijkingPage /> : <AutoDraftPage />}
        </div>
      </div>
    </div>
  )
}
