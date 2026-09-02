import { PLACEHOLDERS } from '../../../../../lib/agentInstructions'
import { useAgentInstructionsEditor } from '../../../../../hooks/useAgentInstructionsEditor'
import RichTextEditor from '../../../../ui/RichTextEditor'
import RteFormatButtons from '../../../../ui/RteFormatButtons'

/**
 * AgentEditor — RichTextEditor + opslaan/ongedaan-acties voor één agent.
 * State + RPC (upsert_agent_instructions) in useAgentInstructionsEditor,
 * gedeeld met de mobiele editor. Reset bij agent-wissel of nieuwe updated_at.
 */
export default function AgentEditor({ schedule, row }) {
  const ed = useAgentInstructionsEditor(schedule, row)

  const updatedAt = row?.updated_at ? new Date(row.updated_at) : null
  const updatedBy = row?.config_value?.updated_by
  const charCount = (ed.text || '').length

  return (
    <>
      <div className="set-meta-row">
        <span>agent: {schedule.agent_name}</span>
        <span className="set-meta-row__sep">·</span>
        <span>
          {updatedAt
            ? `bewerkt ${updatedAt.toLocaleString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}${updatedBy ? ` door ${updatedBy}` : ''}`
            : 'nog geen instructies opgeslagen'}
        </span>
        <span className="set-meta-row__spacer" />
        <span className="set-meta-row__kbd">⌘ B</span>
        <span>voor vet</span>
      </div>

      <div className="set-editor">
        <div className="set-editor__toolbar">
          <RteFormatButtons disabled={ed.busy} />
          <span className="set-editor__meta">{charCount.toLocaleString('nl-NL')} chars</span>
        </div>
        <div className="set-editor__body set-editor__body--rte">
          <RichTextEditor
            valueMd={ed.text}
            onChangeMd={ed.setText}
            resetKey={ed.resetKey}
            disabled={ed.busy}
            placeholder={PLACEHOLDERS[schedule.agent_name] || 'Bijv.: wanneer wel/niet een actie maken; welke pipelines/stages; naamconventies voor notes.'}
            minHeight={380}
          />
        </div>
      </div>

      <div className="set-actions">
        <button
          type="button"
          className="set-btn set-btn--primary"
          onClick={ed.save}
          disabled={ed.busy || !ed.dirty}
        >
          {ed.busy ? 'Opslaan…' : 'Opslaan'}
        </button>
        <button
          type="button"
          className="set-btn set-btn--ghost"
          onClick={ed.reset}
          disabled={ed.busy || !ed.dirty}
        >
          Ongedaan maken
        </button>
        {!ed.dirty && !ed.saved && !ed.err && (
          <span className="set-actions__hint">geen wijzigingen</span>
        )}
        {ed.saved && (
          <span className="set-actions__hint set-actions__hint--success">✓ Opgeslagen</span>
        )}
        {ed.err && (
          <span className="set-actions__hint set-actions__hint--error">⚠ {ed.err}</span>
        )}
      </div>
    </>
  )
}
