import { useState, useEffect } from 'react'
import { supabase } from '../../../../lib/supabase'
import RichTextEditor from '../../../ui/RichTextEditor'
import { PLACEHOLDERS } from '../../../../lib/agentInstructions'

export default function InstructionsEditor({ schedule, row }) {
  const initialMd = row?.config_value?.text || ''
  const [text, setText] = useState(initialMd)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [saved, setSaved] = useState(false)
  // resetKey triggert re-render van editor's innerHTML alleen bij agent-wissel
  // of wanneer server een nieuwe versie pusht — niet bij elke toetsaanslag.
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

  return (
    <div className="instructies__editor">
      <div className="instructies__meta">
        <span className="mono muted" style={{ fontSize: 11 }}>
          agent: {schedule.agent_name}
        </span>
        {updatedAt ? (
          <span className="muted" style={{ fontSize: 11 }}>
            · laatst bewerkt {updatedAt.toLocaleString('nl-NL')}
            {updatedBy ? ` door ${updatedBy}` : ''}
          </span>
        ) : (
          <span className="muted" style={{ fontSize: 11 }}>
            · nog geen instructies opgeslagen
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: 11 }}>
          <kbd className="kbd">Ctrl/Cmd</kbd> + <kbd className="kbd">B</kbd> voor vet
        </span>
      </div>

      <div className="pcv7__note-rte" style={{ border: '1px solid var(--border, rgba(0,0,0,0.10))', borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
        <RichTextEditor
          valueMd={text}
          onChangeMd={setText}
          resetKey={resetKey}
          disabled={busy}
          placeholder={PLACEHOLDERS[schedule.agent_name] || 'Bijv.: wanneer wel/niet een actie maken; welke pipelines/stages; naamconventies voor notes.'}
          minHeight={420}
        />
      </div>

      <div className="instructies__actions">
        <button
          className="btn btn--accent"
          onClick={onSave}
          disabled={busy || !dirty}
        >
          {busy ? 'Opslaan…' : 'Opslaan'}
        </button>
        <button
          className="btn btn--ghost"
          onClick={onReset}
          disabled={busy || !dirty}
        >
          Ongedaan maken
        </button>
        {saved && <span style={{ color: 'var(--success)', fontSize: 13 }}>✓ Opgeslagen</span>}
        {err && <span style={{ color: 'var(--error)', fontSize: 13 }}>⚠ {err}</span>}
      </div>
    </div>
  )
}
