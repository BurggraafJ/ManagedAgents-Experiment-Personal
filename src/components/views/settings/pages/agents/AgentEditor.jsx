import { useState, useEffect } from 'react'
import { supabase } from '../../../../../lib/supabase'
import { PLACEHOLDERS } from '../../../../../lib/agentInstructions'
import RichTextEditor from '../../../../ui/RichTextEditor'

/**
 * AgentEditor — RichTextEditor + opslaan/ongedaan-acties voor één agent.
 * Schrijft via upsert_agent_instructions RPC. State reset bij agent-wissel
 * of nieuwe updated_at-stempel.
 */
export default function AgentEditor({ schedule, row }) {
  const initialText = row?.config_value?.text || ''
  const [text, setText] = useState(initialText)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [saved, setSaved] = useState(false)
  const [resetKey, setResetKey] = useState(0)

  useEffect(() => {
    setText(row?.config_value?.text || '')
    setErr(null); setSaved(false)
    setResetKey(k => k + 1)
  }, [schedule.agent_name, row?.updated_at])

  const dirty = text !== (row?.config_value?.text || '')

  async function onSave() {
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
  }

  function onReset() {
    setText(row?.config_value?.text || '')
    setErr(null); setSaved(false)
    setResetKey(k => k + 1)
  }

  const updatedAt = row?.updated_at ? new Date(row.updated_at) : null
  const updatedBy = row?.config_value?.updated_by
  const charCount = (text || '').length

  return (
    <>
      <div className="sv2-meta-row">
        <span>agent: {schedule.agent_name}</span>
        <span className="sv2-meta-row__sep">·</span>
        <span>
          {updatedAt
            ? `bewerkt ${updatedAt.toLocaleString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}${updatedBy ? ` door ${updatedBy}` : ''}`
            : 'nog geen instructies opgeslagen'}
        </span>
        <span className="sv2-meta-row__spacer" />
        <span className="sv2-meta-row__kbd">⌘ B</span>
        <span>voor vet</span>
      </div>

      <div className="sv2-editor">
        <div className="sv2-editor__toolbar">
          <span className="sv2-editor__meta">{charCount.toLocaleString('nl-NL')} chars</span>
        </div>
        <div className="sv2-editor__body sv2-editor__body--rte">
          <RichTextEditor
            valueMd={text}
            onChangeMd={setText}
            resetKey={resetKey}
            disabled={busy}
            placeholder={PLACEHOLDERS[schedule.agent_name] || 'Bijv.: wanneer wel/niet een actie maken; welke pipelines/stages; naamconventies voor notes.'}
            minHeight={380}
          />
        </div>
      </div>

      <div className="sv2-actions">
        <button
          type="button"
          className="sv2-btn sv2-btn--primary"
          onClick={onSave}
          disabled={busy || !dirty}
        >
          {busy ? 'Opslaan…' : 'Opslaan'}
        </button>
        <button
          type="button"
          className="sv2-btn sv2-btn--ghost"
          onClick={onReset}
          disabled={busy || !dirty}
        >
          Ongedaan maken
        </button>
        {!dirty && !saved && !err && (
          <span className="sv2-actions__hint">geen wijzigingen</span>
        )}
        {saved && (
          <span className="sv2-actions__hint sv2-actions__hint--success">✓ Opgeslagen</span>
        )}
        {err && (
          <span className="sv2-actions__hint sv2-actions__hint--error">⚠ {err}</span>
        )}
      </div>
    </>
  )
}
