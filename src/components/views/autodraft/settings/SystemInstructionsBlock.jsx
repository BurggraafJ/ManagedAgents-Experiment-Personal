import { useState, useEffect } from 'react'
import { supabase } from '../../../../lib/supabase'
import { AGENT } from '../../../../lib/autodraft'

export default function SystemInstructionsBlock({ agentInstructions, alwaysOpen }) {
  const [openLocal, setOpen] = useState(!!alwaysOpen)
  const open = alwaysOpen ? true : openLocal
  const instructionsRow = (agentInstructions || []).find(r => r.agent_name === AGENT)
  const [text, setText] = useState(instructionsRow?.config_value?.text || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setText(instructionsRow?.config_value?.text || '')
    setErr(null); setSaved(false)
  }, [instructionsRow?.updated_at])

  const dirty = text !== (instructionsRow?.config_value?.text || '')

  async function save() {
    setBusy(true); setErr(null); setSaved(false)
    try {
      const { data: rpcRes, error } = await supabase.rpc('upsert_agent_instructions', {
        p_agent_name: AGENT, p_instructions: text, p_updated_by: 'dashboard',
      })
      if (error) setErr(error.message)
      else if (rpcRes && rpcRes.ok === false) setErr(rpcRes.reason || 'mislukt')
      else setSaved(true)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <section className="va-block">
      <button type="button" className="va-block__head" onClick={() => setOpen(v => !v)}>
        <span className="va-block__caret">{open ? '▾' : '▸'}</span>
        <span className="va-block__title">Systeem-instructies</span>
        <span className="muted va-block__hint">globaal · wordt door elke run bovenop categorieën gelezen</span>
      </button>
      {open && (
        <div className="va-block__body" style={{ display: 'grid', gap: 10 }}>
          <textarea value={text} onChange={e => setText(e.target.value)} disabled={busy} rows={8}
            className="ad-textarea"
            placeholder={'Bijvoorbeeld:\n- Nederlandse mails altijd tutoyeren.\n- Max 6 zinnen tenzij de mail lang is.\n- Nooit mijn telefoonnummer sturen.'} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn--accent" onClick={save} disabled={busy || !dirty}>
              {busy ? 'Opslaan…' : 'Opslaan'}
            </button>
            {saved && <span style={{ color: 'var(--success)', fontSize: 12 }}>✓ opgeslagen</span>}
            {err   && <span style={{ color: 'var(--error)', fontSize: 12 }}>⚠ {err}</span>}
          </div>
        </div>
      )}
    </section>
  )
}
